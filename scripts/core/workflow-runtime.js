import { createHash } from 'node:crypto';
import { appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { getTaskDefinition } from './task-registry.js';

/**
 * 工作流运行时的通用工具。
 *
 * 这里集中处理并发限制、成本估算、manifest/step 持久化、日志裁剪和用户可见产物
 * 归一化，具体业务工作流只需要编排 step。
 */
const SIGNED_URL_PARAMS = [/^X-Amz-/i, /^Signature$/i, /^Expires$/i, /^token$/i, /^sig$/i];
const LOG_EVENT_LIMIT_BYTES = 4096;

/**
 * 创建一个简单的 Promise 并发限制器，用于后续多 step 并行扩展。
 */
export function createLimiter(concurrency = Number(process.env.SHOTFUN_CONCURRENCY || 3)) {
  const limit = Math.max(1, Number(concurrency) || 1);
  const queue = [];
  let active = 0;

  const runNext = () => {
    if (active >= limit || queue.length === 0) return;
    active += 1;
    const { task, resolve, reject } = queue.shift();
    Promise.resolve()
      .then(task)
      .then(resolve, reject)
      .finally(() => {
        active -= 1;
        runNext();
      });
  };

  return (task) =>
    new Promise((resolve, reject) => {
      queue.push({ task, resolve, reject });
      runNext();
    });
}

/**
 * 根据注册表价格估算工作流步骤成本。
 */
export function estimateCost(steps = []) {
  const items = steps.map((step) => {
    const task = getTaskDefinition(step.registryId);
    const count = Number(step.count || 1);
    const pricePerCall = Number(task.price?.pricePerCall || 0);
    return {
      registryId: step.registryId,
      count,
      pricePerCall,
      estimated: roundMoney(count * pricePerCall),
      currency: task.price?.currency || 'CNY',
      priceTier: task.price?.priceTier,
    };
  });
  const currency = items[0]?.currency || 'CNY';
  return {
    estimated: roundMoney(items.reduce((sum, item) => sum + item.estimated, 0)),
    currency,
    items,
  };
}

/**
 * 在执行前检查余额和确认阈值，避免未经确认的高成本调用。
 */
export function withCostGuard({ estimated, confirm = false, balance = undefined, threshold = process.env.SHOTFUN_CONFIRM_COST_ABOVE || 5 }) {
  const limit = Number(threshold);
  if (Number.isFinite(balance) && estimated > balance) {
    throw new Error(`Estimated cost ${estimated} exceeds balance ${balance}.`);
  }
  if (Number.isFinite(limit) && estimated > limit && !confirm) {
    throw new Error(`Estimated cost ${estimated} exceeds ${limit}; rerun with --confirm.`);
  }
  return true;
}

/**
 * 对输入做稳定序列化后计算哈希，用于恢复执行时检测参数漂移。
 */
export function hashInputs(value) {
  return createHash('sha256').update(stableStringify(value)).digest('hex');
}

/**
 * 创建 JSONL 运行日志写入器。
 */
export function jsonlLogger(runDir) {
  const logFile = path.join(runDir, 'logs', 'run.jsonl');
  return {
    async write(event) {
      await mkdir(path.dirname(logFile), { recursive: true });
      await appendFile(logFile, `${stringifyLogEvent(event)}\n`, 'utf8');
    },
  };
}

/**
 * 原子写入单个工作流 step 的 sidecar 文件。
 */
export async function writeStep(runDir, stepId, payload) {
  const filePath = path.join(runDir, 'steps', `${stepId}.json`);
  await atomicWriteJson(filePath, payload);
  return filePath;
}

/**
 * 读取已完成 step 的 sidecar，用于 resume 跳过可复用步骤。
 */
export async function loadStep(runDir, stepId) {
  return JSON.parse(await readFile(path.join(runDir, 'steps', `${stepId}.json`), 'utf8'));
}

/**
 * 原子写入工作流 manifest。
 */
export async function writeManifest(runDir, manifest) {
  const filePath = path.join(runDir, 'manifest.json');
  await atomicWriteJson(filePath, manifest);
  return filePath;
}

/**
 * 将文本类产物保存到本地 texts 目录，并返回文件路径。
 */
export async function persistText({ runDir, stepId, name, content, ext = 'txt' }) {
  const safeExt = String(ext).replace(/^\./, '') || 'txt';
  const filePath = path.resolve(runDir, 'texts', `${sanitizeFilePart(stepId)}-${sanitizeFilePart(name)}.${safeExt}`);
  await mkdir(path.dirname(filePath), { recursive: true });
  const body = typeof content === 'string' ? content : JSON.stringify(content, null, 2);
  await writeFile(filePath, body.endsWith('\n') ? body : `${body}\n`, 'utf8');
  return filePath;
}

/**
 * 将 step sidecar 中的 URL、本地文件、Asset 引用和文本文件归一化为用户可见产物。
 */
export function buildUserArtifacts(sidecars = []) {
  const artifacts = [];

  for (const sidecar of sidecars) {
    const name = sidecar.name || sidecar.stepId || 'artifact';
    const resultUrls = Array.isArray(sidecar.resultUrls) ? sidecar.resultUrls : [];
    const localFiles = Array.isArray(sidecar.localFiles) ? sidecar.localFiles : [];

    if (localFiles.length) {
      localFiles.forEach((file, index) => {
        artifacts.push(cleanArtifact({
          kind: file.kind || inferKind(file.path || resultUrls[index]),
          name: file.name || name,
          url: resultUrls[index],
          localPath: file.path || file.localPath,
          signed: isSignedUrl(resultUrls[index]),
        }));
      });
    } else {
      resultUrls.forEach((url, index) => {
        artifacts.push(cleanArtifact({
          kind: inferKind(url),
          name: resultUrls.length > 1 ? `${name}-${index + 1}` : name,
          url,
          signed: isSignedUrl(url),
        }));
      });
    }

    for (const ref of sidecar.assetRefs || []) {
      artifacts.push(cleanArtifact({ kind: 'asset_ref', name, url: ref }));
    }

    for (const text of sidecar.textArtifacts || []) {
      artifacts.push(cleanArtifact({
        kind: 'text',
        name: text.name || name,
        localPath: text.path || text.localPath,
      }));
    }
  }

  return artifacts.filter((artifact) => artifact.url || artifact.localPath);
}

/**
 * 删除签名 URL 中的敏感查询参数，便于安全展示或写入可共享清单。
 */
export function sanitizeUrl(url) {
  if (!url) return url;
  const parsed = new URL(url);
  for (const key of [...parsed.searchParams.keys()]) {
    if (SIGNED_URL_PARAMS.some((pattern) => pattern.test(key))) parsed.searchParams.delete(key);
  }
  const query = parsed.searchParams.toString();
  return `${parsed.origin}${parsed.pathname}${query ? `?${query}` : ''}${parsed.hash}`;
}

async function atomicWriteJson(filePath, payload) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp.${process.pid}.${Date.now()}`;
  await writeFile(tmpPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  await rename(tmpPath, filePath);
}

function stringifyLogEvent(event) {
  const payload = { t: new Date().toISOString(), ...event };
  let json = JSON.stringify(payload);
  if (Buffer.byteLength(json, 'utf8') <= LOG_EVENT_LIMIT_BYTES) return json;

  const truncated = { ...payload, details_truncated: true };
  delete truncated.details;
  delete truncated.raw;
  json = JSON.stringify(truncated);
  if (Buffer.byteLength(json, 'utf8') <= LOG_EVENT_LIMIT_BYTES) return json;

  return JSON.stringify({ t: payload.t, event: payload.event, details_truncated: true });
}

function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
    .join(',')}}`;
}

function cleanArtifact(artifact) {
  return Object.fromEntries(Object.entries(artifact).filter(([, value]) => value !== undefined));
}

function inferKind(value = '') {
  const lower = String(value).split('?')[0].toLowerCase();
  if (/\.(png|jpg|jpeg|webp|gif)$/.test(lower)) return 'image';
  if (/\.(mp4|mov|m4v|webm)$/.test(lower)) return 'video';
  if (/\.(mp3|wav|m4a|aac|flac)$/.test(lower)) return 'audio';
  return 'text';
}

function isSignedUrl(url) {
  if (!url || !String(url).startsWith('http')) return undefined;
  const parsed = new URL(url);
  return [...parsed.searchParams.keys()].some((key) => SIGNED_URL_PARAMS.some((pattern) => pattern.test(key))) || undefined;
}

function sanitizeFilePart(value) {
  return String(value)
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'artifact';
}

function roundMoney(value) {
  return Number(Number(value).toFixed(4));
}
