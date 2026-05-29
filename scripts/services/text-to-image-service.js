import { ShotFunOpenApiError } from '../core/api-client.js';
import { normalizeInputs } from '../core/schema-runtime.js';
import { applyTaskInputRules } from '../core/task-registry.js';
import {
  IMAGE_MODELS,
  createClient,
  runTask,
  uploadFiles,
} from '../core/shotfun-service.js';
import { buildInputParams } from './input-params.js';

/**
 * 文生图/图像编辑服务。
 *
 * 按模型能力处理参考图、基础尺寸参数和自定义 inputParams。
 * 入参 schema 见 scripts/core/capability-schema.js#text-to-image，默认值与校验由 schema-runtime 提供。
 */
export const SERVICE_VERSION = '2026.05.14';

/**
 * 生成或规划图片任务。
 */
export async function generateImage(options, deps = {}) {
  const normalized = normalizeInputs('text-to-image', options);

  const preset = IMAGE_MODELS[normalized.model];
  if (!preset) throw new ShotFunOpenApiError(`Unknown image model: ${normalized.model}`);

  const client = normalized.dryRun ? undefined : deps.client || createClient();
  let uploadedUrls = [];
  if (normalized.imageFiles.length && !normalized.dryRun) {
    const upload = await uploadFiles(client, normalized.imageFiles, normalized.uploadPath);
    uploadedUrls = upload.urls;
    normalized.uploads = upload.uploads;
  }

  const imageUrls = [...normalized.imageUrls, ...uploadedUrls];
  const inputParams = applyTaskInputRules(
    preset,
    buildImageInputParams({ preset, options: normalized, imageUrls }),
  );

  return await runTask({
    client,
    projectCode: normalized.projectCode,
    taskCode: normalized.taskCode || preset.taskCode,
    inputParams,
    wait: normalized.wait,
    dryRun: normalized.dryRun,
    meta: {
      category: 'image',
      model: normalized.model,
      ...(uploadedUrls.length ? { uploadedImageUrls: uploadedUrls } : {}),
      ...(normalized.uploads ? { uploads: normalized.uploads } : {}),
    },
  });
}

/**
 * 根据模型差异构造图片任务 inputParams。
 */
export function buildImageInputParams({ preset, options, imageUrls }) {
  const providerResolution = preset.resolution && options.resolution === '2K' ? preset.resolution : options.resolution;

  if (preset.supports?.referenceImage === false && imageUrls.length) {
    throw new ShotFunOpenApiError(`The ${options.model} image model is text-to-image only; use nano2 or another reference-capable model.`);
  }

  if (options.model === 'basic') {
    return buildInputParams('image', {
      ...options,
      imageUrls,
      resolution: undefined,
      width: options.width || 1280,
      height: options.height || 720,
    });
  }

  return buildInputParams('image', {
    ...options,
    imageUrls,
    resolution: providerResolution,
  });
}
