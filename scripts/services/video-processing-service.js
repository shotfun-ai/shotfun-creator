import { ShotFunOpenApiError } from '../core/api-client.js';
import { normalizeInputs } from '../core/schema-runtime.js';
import {
  VIDEO_PROCESS_TASKS,
  createClient,
  runTask,
  uploadFiles,
} from '../core/shotfun-service.js';
import { buildInputParams } from './input-params.js';

/**
 * 视频处理服务。
 *
 * 支持超分、字幕擦除等后处理任务。
 * 入参 schema 见 capability-schema.js#video-processing。
 */
export const SERVICE_VERSION = '2026.05.14';

/**
 * 生成或规划视频处理任务。
 */
export async function processVideo(options, deps = {}) {
  const normalized = normalizeInputs('video-processing', options);
  const preset = VIDEO_PROCESS_TASKS[normalized.operation];
  if (!preset) throw new ShotFunOpenApiError(`Unknown video process operation: ${normalized.operation}`);

  const client = normalized.dryRun ? undefined : deps.client || createClient();
  let uploadedUrl;
  if (normalized.videoFile && !normalized.dryRun) {
    const upload = await uploadFiles(client, [normalized.videoFile], normalized.uploadPath);
    uploadedUrl = upload.urls[0];
    normalized.uploads = upload.uploads;
  }

  const url = uploadedUrl || normalized.videoUrl;
  if (!url) throw new ShotFunOpenApiError('Missing --video-url or --video-file.');

  const inputParams = buildInputParams('video-process', {
    url,
    durationSeconds: normalized.durationSeconds,
    input: normalized.input,
  });

  return await runTask({
    client,
    projectCode: normalized.projectCode,
    taskCode: normalized.taskCode || preset.taskCode,
    inputParams,
    wait: normalized.wait,
    dryRun: normalized.dryRun,
    meta: {
      category: 'video-processing',
      operation: normalized.operation,
      ...(uploadedUrl ? { uploadedVideoUrl: uploadedUrl } : {}),
      ...(normalized.uploads ? { uploads: normalized.uploads } : {}),
    },
  });
}
