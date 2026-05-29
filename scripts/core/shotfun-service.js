import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  ShotFunOpenApiClient,
  ShotFunOpenApiError,
  extractAssetRefs,
  extractGroupId,
  extractTaskNo,
} from './api-client.js';
import { createLegacyModelMap, createLegacyTaskMap, getTaskDefinition } from './task-registry.js';
import { buildOutputPaths, ensureRunDirectories } from './output-paths.js';
import { loadRuntimeEnvironment } from './env-loader.js';
import { adaptTaskResult } from './result-adapter.js';
import { buildUserArtifacts } from './workflow-runtime.js';

/**
 * 面向各业务 service 的共享封装层。
 *
 * 这里把低层 OpenAPI 客户端、任务注册表、项目名称解析和 CLI 参数解析工具集中起来，
 * 让 image/video/audio/process/asset 等 service 保持薄而一致。
 */
export const IMAGE_MODELS = createLegacyModelMap('image');
export const VIDEO_MODELS = createLegacyModelMap('video');
export const AUDIO_TASKS = createLegacyTaskMap('audio');
export const VIDEO_PROCESS_TASKS = createLegacyModelMap('video-process');
export const DEFAULT_PROJECT_CODE = 'default';

loadRuntimeEnvironment();

/**
 * 使用环境变量创建默认 OpenAPI 客户端。
 */
export function createClient() {
  return new ShotFunOpenApiClient();
}

/**
 * 执行一个标准 ShotFun 任务；dryRun 模式只返回请求结构，不触发外部调用。
 */
export async function runTask({ client, projectCode, taskCode, inputParams, wait = false, dryRun = false, meta = {} }) {
  const request = { projectCode: resolveProjectCode(projectCode), taskCode, inputParams };
  if (dryRun) {
    return { ok: true, dryRun: true, request, wait, ...meta };
  }

  const task = wait
    ? await client.createTaskAndWait(request)
    : await client.createTask(request);

  const output = formatTaskOutput(task, meta);
  if (wait && output.resultUrls?.length) {
    await attachDownloadedArtifacts(output, { projectCode: request.projectCode, category: meta.category });
  }
  return output;
}

/**
 * 批量上传本地文件，返回可直接放入 inputParams 的远程 URL。
 */
export async function uploadFiles(client, files, uploadPath = undefined) {
  const urls = [];
  const uploads = [];
  for (const filePath of files) {
    const upload = await client.uploadFile(filePath, { path: uploadPath });
    if (!upload?.url) throw new ShotFunOpenApiError('Upload response did not include data.url.', upload);
    uploads.push(upload);
    urls.push(upload.url);
  }
  return { urls, uploads };
}

/**
 * 将 URL/Asset 混合引用解析为资产引用；必要时按 pipeline 复用或创建资产组和资产。
 */
export async function resolveReferenceAssets({
  client,
  projectCode,
  refs,
  groupId = undefined,
  groupName,
  description,
  assetPipeline = undefined,
}) {
  const pipeline = normalizeAssetPipeline(assetPipeline);
  const assetRefs = refs.filter((ref) => ref.startsWith('Asset://'));
  const remoteUrls = refs.filter((ref) => ref.startsWith('http://') || ref.startsWith('https://'));
  const invalidRefs = refs.filter((ref) => !assetRefs.includes(ref) && !remoteUrls.includes(ref));
  if (invalidRefs.length) {
    throw new ShotFunOpenApiError(`Asset mode requires remote URLs or Asset refs. Invalid refs: ${invalidRefs.join(', ')}`);
  }
  if (!remoteUrls.length) return { assetRefs, assetGroupResponse: undefined, assetCreateResponses: [] };

  const resolvedGroup = await resolveOrCreateAssetGroup(client, projectCode, {
    groupId,
    name: groupName || pipeline.group.defaultName || `shotfun-js-assets-${Date.now()}`,
    description: description || 'Auto-created by shotfun-js-api-template',
    pipeline,
  });

  const createResponses = [];
  for (const [index, url] of remoteUrls.entries()) {
    const response = await createAsset(
      client,
      projectCode,
      resolvedGroup.groupId,
      url,
      `reference-${index + 1}`,
      pipeline.asset.taskCode,
      pipeline.asset.assetType,
    );
    const createdRefs = extractAssetRefs(response);
    if (!createdRefs.length) throw new ShotFunOpenApiError('Unable to extract Asset ref from asset create response.', response);
    assetRefs.push(createdRefs[0]);
    createResponses.push(response);
  }

  return {
    assetRefs,
    assetGroupId: resolvedGroup.groupId,
    assetGroupResponse: resolvedGroup.response,
    assetGroupReused: resolvedGroup.reused,
    assetPipeline: pipeline,
    assetCreateResponses: createResponses,
  };
}

async function resolveOrCreateAssetGroup(client, projectCode, { groupId, name, description, pipeline }) {
  if (groupId !== undefined) return { groupId, response: undefined, reused: true };

  if (typeof client.resolveOrCreateAssetGroup === 'function') {
    const response = await client.resolveOrCreateAssetGroup({
      projectCode: resolveProjectCode(projectCode),
      name,
      description,
      reuseScope: pipeline.group.reuseScope,
      taskCode: pipeline.group.taskCode,
    });
    const resolvedGroupId = extractGroupId(response);
    if (resolvedGroupId === undefined) throw new ShotFunOpenApiError('Unable to extract groupId from resolved asset group response.', response);
    return { groupId: resolvedGroupId, response, reused: true };
  }

  const response = await createAssetGroup(client, projectCode, {
    name,
    description,
    taskCode: pipeline.group.taskCode,
  });
  const resolvedGroupId = extractGroupId(response);
  if (resolvedGroupId === undefined) throw new ShotFunOpenApiError('Unable to extract groupId from asset group response.', response);
  return { groupId: resolvedGroupId, response, reused: false };
}

function normalizeAssetPipeline(assetPipeline = {}) {
  return {
    mode: assetPipeline.mode || 'default-asset',
    group: {
      taskCode: assetPipeline.group?.taskCode,
      reuseScope: assetPipeline.group?.reuseScope || 'run',
      defaultName: assetPipeline.group?.defaultName,
    },
    asset: {
      taskCode: assetPipeline.asset?.taskCode,
      assetType: assetPipeline.asset?.assetType || 'Image',
      refOutput: assetPipeline.asset?.refOutput || 'assetRef',
    },
  };
}

/**
 * 创建 ShotFun 资产组。
 */
export async function createAssetGroup(client, projectCode, { name, description, taskCode }) {
  const task = getTaskDefinition('asset.group_create');
  return await client.createTaskAndWait({
    projectCode: resolveProjectCode(projectCode),
    taskCode: taskCode || task.taskCode,
    inputParams: {
      name,
      description,
      projectName: '',
    },
  });
}

/**
 * 在指定资产组下创建一个远程图片资产。
 */
export async function createAsset(client, projectCode, groupId, url, name, taskCode, assetType = 'Image') {
  const task = getTaskDefinition('asset.create');
  return await client.createTaskAndWait({
    projectCode: resolveProjectCode(projectCode),
    taskCode: taskCode || task.taskCode,
    inputParams: {
      groupId,
      url,
      name,
      assetType,
      projectName: '',
    },
  });
}

/**
 * 解析 ShotFun 项目名称。OpenAPI 字段仍叫 projectCode。
 */
export function resolveProjectCode(value) {
  const projectCode = String(value || process.env.SHOTFUN_PROJECT_CODE || '').trim();
  return projectCode || DEFAULT_PROJECT_CODE;
}

/**
 * 解析 CLI 传入的 JSON 对象参数，并提供统一错误信息。
 */
export function parseJson(value, label) {
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('expected object');
    return parsed;
  } catch (error) {
    throw new ShotFunOpenApiError(`${label} must be a JSON object: ${error.message}`);
  }
}

/**
 * 解析 CLI 数字参数。
 */
export function parseNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new ShotFunOpenApiError(`${label} must be a number.`);
  return number;
}

/**
 * 解析显式布尔值，避免字符串被 JavaScript 隐式转为 truthy。
 */
export function parseBoolean(value) {
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  throw new ShotFunOpenApiError(`Expected boolean value, received ${value}.`);
}

/**
 * 读取成对 CLI 选项的值，并拒绝缺失或误写成下一个 flag 的输入。
 */
export function takeOption(args, index, label) {
  const value = args[index + 1];
  if (!value || value.startsWith('--')) throw new ShotFunOpenApiError(`Missing value for ${label}.`);
  return value;
}

/**
 * 以稳定 JSON 格式写出 CLI 结果。
 */
export function writeJson(payload) {
  console.log(JSON.stringify(payload, null, 2));
}

/**
 * 将底层任务结果收敛为 Agent 友好的 userArtifacts 输出。
 */
export function formatAgentTaskOutput(result) {
  const userArtifacts = Array.isArray(result.artifacts) && result.artifacts.length
    ? result.artifacts.map((artifact) => cleanObject({
      kind: artifact.kind,
      name: artifact.name,
      url: artifact.url,
      localPath: artifact.localPath,
      ref: artifact.ref,
      text: artifact.text,
    })).filter((artifact) => artifact.url || artifact.localPath || artifact.ref || artifact.text)
    : buildUserArtifacts([{
      name: result.operation || result.category || 'artifact',
      resultUrls: result.resultUrls,
      assetRefs: result.assetRefs,
      textArtifacts: result.textArtifacts,
    }]);

  return cleanObject({
    ok: result.ok === true,
    ...(result.dryRun ? { dryRun: true, request: result.request } : {}),
    taskNo: result.taskNo,
    status: result.status,
    category: result.category,
    kind: result.kind,
    model: result.model,
    operation: result.operation,
    userArtifacts,
  });
}

/**
 * 统一普通任务输出结构，保留原始 task 方便排查。
 */
export function formatTaskOutput(task, meta = {}) {
  const adapted = adaptTaskResult(task);
  return {
    ok: true,
    taskNo: extractTaskNo(task),
    status: task?.status || task?.data?.status,
    resultUrls: adapted.resultUrls,
    assetRefs: adapted.assetRefs,
    textArtifacts: adapted.textArtifacts,
    artifacts: adapted.artifacts,
    result: adapted.result,
    resultPayload: adapted.resultPayload,
    task,
    ...meta,
  };
}

export function makeRunId(prefix) {
  return `${prefix}-${randomUUID().slice(0, 8)}`;
}

/**
 * 下载已完成任务中的远程媒体产物，并把本地路径挂回 artifacts/localFiles。
 */
export async function attachDownloadedArtifacts(output, { projectCode, category } = {}) {
  const mediaArtifacts = Array.isArray(output.artifacts)
    ? output.artifacts.filter((artifact) => artifact?.url && isDownloadableKind(artifact.kind))
    : [];
  if (!mediaArtifacts.length) return output;

  const paths = buildOutputPaths({
    runId: makeRunId(category || 'task'),
    projectName: projectCode || DEFAULT_PROJECT_CODE,
  });
  const readyPaths = await ensureRunDirectories(paths, { fetchRemote: true });

  const localFiles = [];
  for (const [index, artifact] of mediaArtifacts.entries()) {
    const localPath = await downloadArtifact(artifact.url, {
      outputDir: directoryForKind(readyPaths, artifact.kind),
      name: artifact.name || artifact.kind || 'artifact',
      index: index + 1,
    });
    artifact.localPath = localPath;
    localFiles.push({ kind: artifact.kind, url: artifact.url, path: localPath });
  }

  output.outputDir = readyPaths.runDir;
  output.localFiles = localFiles;
  return output;
}

function cleanObject(value) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}

async function downloadArtifact(url, { outputDir, name, index }) {
  await mkdir(outputDir, { recursive: true });
  const response = await fetch(url);
  if (!response.ok) {
    throw new ShotFunOpenApiError(`Failed to download generated artifact: ${response.status} ${response.statusText}`, { url });
  }
  const contentType = response.headers?.get?.('content-type') || '';
  const ext = extensionFromUrlOrContentType(url, contentType);
  const localPath = path.join(outputDir, `${safeFileName(name)}-${String(index).padStart(2, '0')}${ext}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  await writeFile(localPath, bytes);
  return localPath;
}

function directoryForKind(paths, kind) {
  if (kind === 'video') return paths.videosDir;
  if (kind === 'audio') return paths.audioDir;
  return paths.imagesDir;
}

function isDownloadableKind(kind) {
  return kind === 'image' || kind === 'video' || kind === 'audio';
}

function extensionFromUrlOrContentType(url, contentType) {
  try {
    const ext = path.extname(new URL(url).pathname);
    if (ext) return ext;
  } catch {
    // fall through to content-type
  }
  if (contentType.includes('png')) return '.png';
  if (contentType.includes('jpeg') || contentType.includes('jpg')) return '.jpg';
  if (contentType.includes('webp')) return '.webp';
  if (contentType.includes('mp4')) return '.mp4';
  if (contentType.includes('mpeg')) return '.mp3';
  return '.bin';
}

function safeFileName(value) {
  return String(value || 'artifact')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '') || 'artifact';
}
