import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadRuntimeEnvironment } from './env-loader.js';

/**
 * ShotFun OpenAPI 的低层 HTTP 客户端。
 *
 * 负责统一鉴权、JSON/Form 请求、任务轮询、文件上传与响应解析；上层 service
 * 只需要传入业务 taskCode 和 inputParams。
 */
const SHOTFUN_BASE_URL = 'https://open.shotfun.cn';
const SUCCESS_STATUSES = new Set(['success', 'succeeded', 'completed', 'done']);
const FAILURE_STATUSES = new Set(['failed', 'failure', 'error', 'cancelled', 'canceled', 'timeout']);

export class ShotFunOpenApiError extends Error {
  constructor(message, details = undefined) {
    super(message);
    this.name = 'ShotFunOpenApiError';
    this.details = details;
  }
}

export class ShotFunOpenApiClient {
  /**
   * 创建 OpenAPI 客户端。OpenAPI 域名固定，凭证和运行参数从显式参数或环境变量读取。
   */
  constructor(options = {}) {
    loadRuntimeEnvironment();
    this.baseUrl = trimTrailingSlash(SHOTFUN_BASE_URL);
    this.apiKey = options.apiKey || process.env.SHOTFUN_API_KEY;
    this.timeoutMs = Number(options.timeoutMs || process.env.SHOTFUN_TIMEOUT_MS || 300_000);
    this.pollIntervalMs = Number(options.pollIntervalMs || process.env.SHOTFUN_POLL_INTERVAL_MS || 3_000);
    this.maxRetries = Number(options.maxRetries || 2);

    if (!this.apiKey) {
      throw new ShotFunOpenApiError('Missing SHOTFUN_API_KEY. Get an API Key from https://shotfun.cn/agent and save it to .env.local as SHOTFUN_API_KEY=<key>.');
    }
  }

  /**
   * 创建一个 ShotFun 任务。
   */
  async createTask({ projectCode, taskCode, inputParams }) {
    if (!projectCode) throw new ShotFunOpenApiError('createTask requires projectCode.');
    if (!taskCode) throw new ShotFunOpenApiError('createTask requires taskCode.');
    if (!inputParams || typeof inputParams !== 'object' || Array.isArray(inputParams)) {
      throw new ShotFunOpenApiError('createTask requires inputParams object.');
    }

    return await this.requestJson('POST', '/open-api/v1/task/create', {
      projectCode,
      taskCode,
      inputParams,
    });
  }

  /**
   * 创建任务并轮询到终态，适合 CLI 的 --wait 模式。
   */
  async createTaskAndWait(taskRequest, waitOptions = {}) {
    const createdTask = await this.createTask(taskRequest);
    const taskNo = extractTaskNo(createdTask);
    if (!taskNo) {
      throw new ShotFunOpenApiError('Task create response did not include taskNo.', createdTask);
    }
    return await this.waitForTask(taskNo, waitOptions);
  }

  /**
   * 查询单个任务的当前状态和结果。
   */
  async queryTask(taskNo) {
    if (!taskNo) throw new ShotFunOpenApiError('queryTask requires taskNo.');
    return await this.requestJson('GET', `/open-api/v1/task/query/${encodeURIComponent(taskNo)}`);
  }

  /**
   * 按固定间隔轮询任务，成功返回最终任务，失败或超时抛出 OpenAPI 错误。
   */
  async waitForTask(taskNo, options = {}) {
    const timeoutMs = Number(options.timeoutMs || this.timeoutMs);
    const pollIntervalMs = Number(options.pollIntervalMs || this.pollIntervalMs);
    const deadline = Date.now() + timeoutMs;
    let lastTask;

    while (Date.now() < deadline) {
      lastTask = await this.queryTask(taskNo);
      const status = extractStatus(lastTask);

      if (isSuccessStatus(status)) return lastTask;
      if (isFailureStatus(status)) {
        throw new ShotFunOpenApiError(
          `Task ${taskNo} failed with status=${status}: ${lastTask.errorMessage || 'no error message'}`,
          lastTask,
        );
      }

      await sleep(pollIntervalMs);
    }

    throw new ShotFunOpenApiError(`Task ${taskNo} timed out after ${timeoutMs}ms.`, lastTask);
  }

  /**
   * 上传本地文件并返回 ShotFun 文件服务响应。
   */
  async uploadFile(filePath, options = {}) {
    const file = normalizeFilePath(filePath);
    await stat(file.value);

    const fileBuffer = await readFile(file.value);
    const form = new FormData();
    form.set('file', new Blob([fileBuffer]), file.name);
    if (options.path) form.set('path', options.path);

    return await this.requestForm('POST', '/open-api/v1/file/upload', form);
  }

  /**
   * 查询账号余额。
   */
  async getBalance() {
    return await this.requestJson('GET', '/open-api/v1/account/balance');
  }

  /**
   * 发送 JSON 请求并解包 ShotFun 标准响应。
   */
  async requestJson(method, endpoint, payload = undefined) {
    const headers = this.buildHeaders({
      Accept: 'application/json',
    });

    let body;
    if (payload !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(payload);
    }

    return await this.withRetry(async () => {
      const response = await fetch(this.resolveUrl(endpoint), {
        method,
        headers,
        body,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      return unwrapShotFunResponse(await parseJsonResponse(response));
    });
  }

  /**
   * 发送 multipart/form-data 请求并解包 ShotFun 标准响应。
   */
  async requestForm(method, endpoint, form) {
    return await this.withRetry(async () => {
      const response = await fetch(this.resolveUrl(endpoint), {
        method,
        headers: this.buildHeaders({ Accept: 'application/json' }),
        body: form,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      return unwrapShotFunResponse(await parseJsonResponse(response));
    });
  }

  /**
   * 将相对 OpenAPI 路径解析为完整 URL。
   */
  resolveUrl(endpoint) {
    if (endpoint.startsWith('http://') || endpoint.startsWith('https://')) return endpoint;
    return `${this.baseUrl}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;
  }

  /**
   * 构造包含 API Key 的公共请求头。
   */
  buildHeaders(extraHeaders = {}) {
    return {
      'X-Api-Key': this.apiKey,
      'User-Agent': 'shotfun-js-open-api-client/1.0',
      ...extraHeaders,
    };
  }

  /**
   * 对网络错误、超时和 429/5xx 响应做有限指数退避重试。
   */
  async withRetry(fn) {
    let lastError;
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;
        if (attempt === this.maxRetries || !isRetryableError(error)) break;
        await sleep(500 * 2 ** attempt);
      }
    }
    throw lastError;
  }
}

/**
 * 解包 ShotFun 的 `{ code, msg, data }` 响应，非成功 code 统一抛错。
 */
export function unwrapShotFunResponse(payload) {
  if (!payload || typeof payload !== 'object') {
    throw new ShotFunOpenApiError('Invalid ShotFun response payload.', payload);
  }

  const code = payload.code;
  if (code !== 200 && code !== '200' && code !== 0 && code !== '0') {
    throw new ShotFunOpenApiError(payload.msg || `ShotFun OpenAPI request failed with code=${code}`, payload);
  }

  return payload.data;
}

/**
 * 从不同历史响应结构中提取任务编号。
 */
export function extractTaskNo(task) {
  return firstString(
    task?.taskNo,
    task?.task_no,
    task?.id,
    task?.data?.taskNo,
    task?.data?.task_no,
    task?.data?.id,
  );
}

export function extractTaskId(task) {
  return extractTaskNo(task);
}

/**
 * 规范化任务状态为小写字符串。
 */
export function extractStatus(task) {
  return String(task?.status || task?.data?.status || '').toLowerCase();
}

/**
 * 判断任务状态是否属于成功终态。
 */
export function isSuccessStatus(status) {
  return SUCCESS_STATUSES.has(String(status).toLowerCase());
}

/**
 * 判断任务状态是否属于失败终态。
 */
export function isFailureStatus(status) {
  return FAILURE_STATUSES.has(String(status).toLowerCase());
}

/**
 * 从嵌套任务响应中收集可展示的结果 URL。
 */
export function extractResultUrls(task) {
  const urls = [];
  collectUrls(task?.resultUrl, urls);
  collectUrls(task?.resultData, urls);
  collectUrls(task?.data?.resultUrl, urls);
  collectUrls(task?.data?.resultData, urls);
  return [...new Set(urls)];
}

/**
 * 从任务响应中收集 Asset:// 引用，兼容裸 asset-id。
 */
export function extractAssetRefs(task) {
  const refs = [];
  collectAssetRefs(task, refs);
  return [...new Set(refs)];
}

/**
 * 从资产组创建响应中提取 groupId，兼容不同字段名。
 */
export function extractGroupId(task) {
  const candidates = findValuesByKey(task, ['groupId', 'assetGroupId', 'id']);
  for (const candidate of candidates) {
    if (Number.isInteger(candidate)) return candidate;
    if (typeof candidate === 'string' && /^\d+$/.test(candidate)) return Number(candidate);
  }
  return undefined;
}

/**
 * 解析 HTTP 响应体，并在非 2xx 时保留服务端 payload 便于排查。
 */
async function parseJsonResponse(response) {
  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    throw new ShotFunOpenApiError(`Expected JSON response but received: ${text.slice(0, 300)}`);
  }

  if (!response.ok) {
    throw new ShotFunOpenApiError(`HTTP ${response.status} ${response.statusText}`, {
      status: response.status,
      payload,
    });
  }

  return payload;
}

function collectUrls(value, urls) {
  if (!value) return;
  if (typeof value === 'string') {
    if (value.startsWith('http://') || value.startsWith('https://')) urls.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectUrls(item, urls);
    return;
  }
  if (typeof value === 'object') {
    for (const nested of Object.values(value)) collectUrls(nested, urls);
  }
}

function collectAssetRefs(value, refs) {
  if (!value) return;
  if (typeof value === 'string') {
    if (value.startsWith('Asset://')) refs.push(value);
    if (/^asset-[A-Za-z0-9_-]+$/.test(value)) refs.push(`Asset://${value}`);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectAssetRefs(item, refs);
    return;
  }
  if (typeof value === 'object') {
    for (const nested of Object.values(value)) collectAssetRefs(nested, refs);
  }
}

function findValuesByKey(value, keys) {
  const matches = [];
  const loweredKeys = new Set(keys.map((key) => key.toLowerCase()));

  function walk(node) {
    if (!node) return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    if (typeof node !== 'object') return;
    for (const [key, nested] of Object.entries(node)) {
      if (loweredKeys.has(key.toLowerCase())) matches.push(nested);
      walk(nested);
    }
  }

  walk(value);
  return matches;
}

function normalizeFilePath(filePath) {
  if (filePath instanceof URL) {
    return {
      value: filePath,
      name: path.basename(fileURLToPath(filePath)),
    };
  }
  const resolved = path.resolve(String(filePath));
  return {
    value: resolved,
    name: path.basename(resolved),
  };
}

function isRetryableError(error) {
  if (error?.name === 'TimeoutError' || error?.name === 'AbortError') return true;
  if (!(error instanceof ShotFunOpenApiError)) return true;
  const status = Number(error.details?.status);
  return status === 429 || (status >= 500 && status < 600);
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value;
    if (typeof value === 'number') return String(value);
  }
  return undefined;
}

function trimTrailingSlash(value) {
  return String(value).replace(/\/+$/, '');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export { ShotFunOpenApiClient as ThirdPartyApiClient, ShotFunOpenApiError as ApiClientError };
