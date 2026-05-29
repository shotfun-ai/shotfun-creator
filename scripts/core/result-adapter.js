import { extractAssetRefs, extractResultUrls } from './api-client.js';

/**
 * 按 Java TaskResult DTO 的字段语义，将不同服务结果归一成 Agent 侧稳定结构。
 */
export function adaptTaskResult(task) {
  const payload = extractResultPayload(task);
  const resultUrls = unique([
    ...extractResultUrls(task),
    ...knownUrls(payload),
  ]);
  const assetRefs = unique([
    ...extractAssetRefs(task),
    ...knownAssetRefs(payload),
  ]);
  const textArtifacts = knownTextArtifacts(payload);
  const result = buildResult(payload, resultUrls, assetRefs);
  const artifacts = buildArtifacts(payload, result, textArtifacts, assetRefs);

  return cleanObject({
    resultPayload: payload,
    result,
    resultUrls,
    assetRefs,
    textArtifacts,
    artifacts,
  });
}

export function extractResultPayload(task) {
  const candidates = [
    task?.resultData,
    task?.data?.resultData,
    task?.result,
    task?.data?.result,
    task?.data,
    task,
  ];
  for (const candidate of candidates) {
    const parsed = parseJsonObject(candidate);
    if (parsed && Object.keys(parsed).length) return parsed;
  }
  return {};
}

function buildResult(payload, resultUrls, assetRefs) {
  const imageUrls = unique([...toArray(payload.imageUrl), ...toArray(payload.images)].filter(isHttpUrl));
  if (imageUrls.length) {
    return cleanObject({
      type: 'image',
      urls: imageUrls,
      model: payload.model,
      steps: payload.steps,
      width: payload.width,
      height: payload.height,
    });
  }

  const videoUrls = unique(toArray(payload.videoUrl).filter(isHttpUrl));
  if (videoUrls.length) {
    return cleanObject({
      type: 'video',
      urls: videoUrls,
      lastFrameUrl: isHttpUrl(payload.lastFrameUrl) ? payload.lastFrameUrl : undefined,
      status: payload.status,
      resolution: payload.resolution,
      duration: payload.duration ?? payload.durationSeconds,
      fps: payload.fps,
      seed: payload.seed,
    });
  }

  const audioUrls = unique([
    ...toArray(payload.url),
    ...collectValues(payload.fileInfos, ['url', 'audioUrl', 'fileUrl']),
  ].filter(isHttpUrl));
  if (audioUrls.length) {
    return cleanObject({
      type: 'audio',
      urls: audioUrls,
      audioInfo: payload.audioInfo,
      success: payload.success,
      message: payload.message,
    });
  }

  if (isNonEmptyString(payload.content) || isNonEmptyString(payload.response)) {
    return cleanObject({
      type: 'text',
      content: payload.content ?? payload.response,
      model: payload.model,
      usage: payload.usage,
    });
  }

  if (isNonEmptyString(payload.assetUri) || isNonEmptyString(payload.providerAssetId)) {
    return cleanObject({
      type: 'asset',
      refs: assetRefs,
      providerAssetId: payload.providerAssetId,
      assetUri: payload.assetUri,
      providerUrl: payload.providerUrl,
      sourceUrl: payload.sourceUrl,
      status: payload.status,
      errorCode: payload.errorCode,
      errorMessage: payload.errorMessage,
    });
  }

  if (payload.groupId !== undefined || payload.providerGroupId !== undefined) {
    return cleanObject({
      type: 'asset_group',
      groupId: payload.groupId,
      providerGroupId: payload.providerGroupId,
      groupType: payload.groupType,
    });
  }

  if (isPlainTextResult(payload)) {
    return { type: 'text', content: payload.result };
  }

  return { type: 'data', data: payload };
}

function buildArtifacts(payload, result, textArtifacts, assetRefs) {
  const artifacts = [];
  for (const url of result?.type === 'image' ? result.urls : []) {
    artifacts.push({ kind: 'image', name: 'image', url });
  }
  for (const url of result?.type === 'video' ? result.urls : []) {
    artifacts.push({ kind: 'video', name: 'video', url });
  }
  if (result?.type === 'video' && isHttpUrl(result.lastFrameUrl)) {
    artifacts.push({ kind: 'image', name: 'last-frame', url: result.lastFrameUrl });
  }
  for (const url of result?.type === 'audio' ? result.urls : []) {
    artifacts.push({ kind: 'audio', name: 'audio', url });
  }
  for (const text of textArtifacts) {
    artifacts.push({ kind: 'text', name: text.name, text: text.text });
  }
  for (const ref of assetRefs) {
    artifacts.push({ kind: 'asset_ref', name: payload.name || 'asset', url: ref });
  }
  if (result?.type === 'asset_group') {
    artifacts.push(cleanObject({
      kind: 'asset_group',
      name: 'asset-group',
      ref: result.providerGroupId ?? result.groupId,
    }));
  }
  return artifacts;
}

function knownUrls(payload) {
  return unique([
    ...toArray(payload.imageUrl),
    ...toArray(payload.images),
    ...toArray(payload.videoUrl),
    ...toArray(payload.lastFrameUrl),
    ...toArray(payload.url),
    ...toArray(payload.resultUrl),
    ...toArray(payload.providerUrl),
    ...toArray(payload.sourceUrl),
    ...collectValues(payload.fileInfos, ['url', 'audioUrl', 'fileUrl']),
  ].filter(isHttpUrl));
}

function knownAssetRefs(payload) {
  return unique([
    payload.assetUri,
    payload.providerAssetId,
  ].filter(isAssetRef).map(normalizeAssetRef));
}

function knownTextArtifacts(payload) {
  const artifacts = [];
  if (isNonEmptyString(payload.content)) artifacts.push({ name: 'content', text: payload.content });
  if (isNonEmptyString(payload.response)) artifacts.push({ name: 'response', text: payload.response });
  if (isNonEmptyString(payload.result) && !isHttpUrl(payload.result)) artifacts.push({ name: 'result', text: payload.result });
  return artifacts;
}

function collectValues(value, keys) {
  const matches = [];
  const wanted = new Set(keys);

  function walk(node) {
    if (!node) return;
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (typeof node !== 'object') return;
    for (const [key, nested] of Object.entries(node)) {
      if (wanted.has(key)) matches.push(nested);
      walk(nested);
    }
  }

  walk(value);
  return matches.flatMap(toArray);
}

function parseJsonObject(value) {
  if (!value) return undefined;
  if (typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value !== 'string') return undefined;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function toArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function isHttpUrl(value) {
  return typeof value === 'string' && (value.startsWith('http://') || value.startsWith('https://'));
}

function isAssetRef(value) {
  return typeof value === 'string' && (value.startsWith('Asset://') || /^asset-[A-Za-z0-9_-]+$/.test(value));
}

function normalizeAssetRef(value) {
  return value.startsWith('Asset://') ? value : `Asset://${value}`;
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isPlainTextResult(payload) {
  return Object.keys(payload).length === 1 && isNonEmptyString(payload.result) && !isHttpUrl(payload.result);
}

function unique(values) {
  return [...new Set(values.filter((value) => value !== undefined && value !== null && value !== ''))];
}

function cleanObject(value) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}
