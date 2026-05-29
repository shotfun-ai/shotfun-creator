import { ShotFunOpenApiError } from '../core/api-client.js';
import { normalizeInputs } from '../core/schema-runtime.js';
import { getTaskDefinition } from '../core/task-registry.js';
import { createClient, runTask, uploadFiles } from '../core/shotfun-service.js';
import { buildInputParams } from './input-params.js';

/**
 * 资产创建服务。
 *
 * 封装资产组创建和资产创建任务，供 CLI 或工作流复用。
 * 入参 schema 见 capability-schema.js#asset。两个函数共用一份 schema，
 * conditional requiredWhen { action } 在 normalizeInputs 中校验，
 * 调用方应在 options 中显式传 action 以触发对应校验。
 */
export const SERVICE_VERSION = '2026.05.14';

/**
 * 创建资产组。
 */
export async function createAssetGroup(options = {}, deps = {}) {
  const normalized = normalizeInputs('asset', { ...options, action: 'asset-group-create' });

  const task = getTaskDefinition('asset.group_create');
  return await runTask({
    client: normalized.dryRun ? undefined : deps.client || createClient(),
    projectCode: normalized.projectCode,
    taskCode: normalized.taskCode || task.taskCode,
    inputParams: buildInputParams('asset-group', {
      name: normalized.name,
      description: normalized.description || '',
      projectName: normalized.projectName || '',
      input: normalized.input,
    }),
    wait: normalized.wait,
    dryRun: normalized.dryRun,
    meta: {
      category: 'asset',
      operation: 'asset-group-create',
      serviceVersion: SERVICE_VERSION,
    },
  });
}

/**
 * 创建资产记录，当前默认资产类型为 Image。
 */
export async function createAsset(options = {}, deps = {}) {
  const normalized = normalizeInputs('asset', { ...options, action: 'asset-create' });
  const client = normalized.dryRun ? undefined : deps.client || createClient();
  let uploadedUrl;
  let uploads;

  if (normalized.file && !normalized.dryRun) {
    const upload = await uploadFiles(client, [normalized.file]);
    uploadedUrl = upload.urls[0];
    uploads = upload.uploads;
  }

  const url = normalized.url || uploadedUrl || (normalized.dryRun && normalized.file ? `https://<uploaded-from:${normalized.file}>` : undefined);

  const task = getTaskDefinition('asset.create');
  return await runTask({
    client,
    projectCode: normalized.projectCode,
    taskCode: normalized.taskCode || task.taskCode,
    inputParams: buildInputParams('asset', {
      groupId: normalized.groupId,
      url,
      name: normalized.name,
      assetType: normalized.assetType,
      projectName: normalized.projectName || '',
      input: normalized.input,
    }),
    wait: normalized.wait,
    dryRun: normalized.dryRun,
    meta: {
      category: 'asset',
      operation: 'asset-create',
      serviceVersion: SERVICE_VERSION,
      ...(normalized.file ? { sourceFile: normalized.file } : {}),
      ...(uploads ? { uploads } : {}),
    },
  });
}
