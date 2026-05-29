import { ShotFunOpenApiError } from '../core/api-client.js';
import { normalizeInputs } from '../core/schema-runtime.js';
import { applyTaskInputRules } from '../core/task-registry.js';
import {
  VIDEO_MODELS,
  createClient,
  resolveProjectCode,
  resolveReferenceAssets,
  runTask,
  uploadFiles,
} from '../core/shotfun-service.js';
import { buildInputParams } from './input-params.js';

/**
 * 图生视频服务。
 *
 * 负责处理图片 URL、Asset 引用、本地文件上传和 sd-reference 的资产模式，再提交视频任务。
 * 入参 schema 见 capability-schema.js#image-to-video。
 */
export const SERVICE_VERSION = '2026.05.14';

/**
 * 生成或规划图生视频任务。
 */
export async function generateVideo(options, deps = {}) {
  const normalized = normalizeInputs('image-to-video', options);

  const preset = VIDEO_MODELS[normalized.model];
  if (!preset) throw new ShotFunOpenApiError(`Unknown video model: ${normalized.model}`);

  const client = normalized.dryRun ? undefined : deps.client || createClient();
  let uploadedUrls = [];
  if (normalized.imageFiles.length && !normalized.dryRun) {
    const upload = await uploadFiles(client, normalized.imageFiles, normalized.uploadPath);
    uploadedUrls = upload.urls;
    normalized.uploads = upload.uploads;
  }

  const projectCode = resolveProjectCode(normalized.projectCode);
  const refs = [...normalized.imageRefs, ...normalized.imageUrls, ...uploadedUrls];
  let imageValues = refs;
  let assetMeta = {};
  let taskCode = normalized.taskCode || preset.taskCode;
  const assetMode = normalized.assetMode || (normalized.model === 'sd-reference' ? 'asset' : 'none');

  if ((normalized.model === 'sd-reference' || assetMode === 'asset') && refs.length === 0) {
    throw new ShotFunOpenApiError(`${normalized.model} video generation requires at least one --image-url, --image-ref, or --image-file.`);
  }

  if (assetMode === 'asset') {
    if (normalized.dryRun) {
      const assetPipeline = preset.assetPipeline || buildDefaultAssetPipeline();
      assetMeta = {
        assetPlan: {
          mode: assetPipeline.mode,
          refs,
          resolveAssetGroup: true,
          ...(normalized.assetGroupId ? { assetGroupId: normalized.assetGroupId } : {}),
          assetPipeline,
        },
      };
      imageValues = refs.map((ref) => (ref.startsWith('Asset://') ? ref : `Asset://<created-from:${ref}>`));
    } else {
      const resolved = await resolveReferenceAssets({
        client,
        projectCode,
        refs,
        groupId: normalized.assetGroupId,
        groupName: normalized.assetGroupName,
        assetPipeline: preset.assetPipeline,
      });
      imageValues = resolved.assetRefs;
      assetMeta = resolved;
    }
  } else if (assetMode === 'direct-url' && preset.directTaskCode && !normalized.taskCode) {
    taskCode = preset.directTaskCode;
  } else if (assetMode !== 'none' && assetMode !== 'direct-url') {
    throw new ShotFunOpenApiError(`Unknown asset mode: ${assetMode}`);
  }

  if (
    preset.durationSeconds !== undefined &&
    normalized.durationSeconds !== undefined &&
    Number(normalized.durationSeconds) !== Number(preset.durationSeconds)
  ) {
    throw new ShotFunOpenApiError(`${normalized.model} only supports ${preset.durationSeconds}s video generation.`);
  }

  const durationSeconds = Number(normalized.durationSeconds ?? preset.durationSeconds ?? 5);
  const inputParams = applyTaskInputRules(
    preset,
    buildInputParams('video', {
      prompt: normalized.prompt,
      imageUrls: imageValues,
      aspectRatio: normalized.aspectRatio,
      resolution: normalized.resolution || preset.resolution,
      durationSeconds,
      generateAudio: normalized.generateAudio,
      input: normalized.input,
    }),
  );

  return await runTask({
    client,
    projectCode,
    taskCode,
    inputParams,
    wait: normalized.wait,
    dryRun: normalized.dryRun,
    meta: {
      category: 'video',
      model: normalized.model,
      assetMode,
      ...(uploadedUrls.length ? { uploadedImageUrls: uploadedUrls } : {}),
      ...(normalized.uploads ? { uploads: normalized.uploads } : {}),
      ...assetMeta,
    },
  });
}

function buildDefaultAssetPipeline() {
  return {
    mode: 'default-asset',
    group: {
      reuseScope: 'run',
    },
    asset: {
      assetType: 'Image',
      refOutput: 'assetRef',
    },
  };
}
