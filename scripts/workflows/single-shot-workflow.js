import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { ShotFunOpenApiError } from '../core/api-client.js';
import { buildOutputPaths, ensureRunDirectories, writeProjectRunSummary } from '../core/output-paths.js';
import { resolveProjectCode } from '../core/shotfun-service.js';
import { selectTaskPreset } from '../core/task-selector.js';
import { REGISTRY_VERSION } from '../core/task-registry.js';
import {
  buildUserArtifacts,
  estimateCost,
  hashInputs,
  jsonlLogger,
  loadStep,
  withCostGuard,
  writeManifest,
  writeStep,
} from '../core/workflow-runtime.js';
import { generateVideo as defaultGenerateVideo, SERVICE_VERSION as VIDEO_SERVICE_VERSION } from '../services/image-to-video-service.js';
import { generateImage as defaultGenerateImage, SERVICE_VERSION as IMAGE_SERVICE_VERSION } from '../services/text-to-image-service.js';

/**
 * 单镜头工作流。
 *
 * 从一句提示词生成图片，再用该图片生成视频；如果调用方提供现成图片/Asset，则跳过图片步骤。
 * 工作流会写入 manifest、step sidecar 和项目级索引，支持 dry-run 与 resume。
 */
export const WORKFLOW_ID = 'single-shot';
export const WORKFLOW_VERSION = '2026.05.14';

const IMAGE_STEP_ID = '01-image';
const VIDEO_STEP_ID_WITH_IMAGE = '02-video';
const VIDEO_STEP_ID_DIRECT = '01-video';
const PLANNED_IMAGE_URL = 'https://example.invalid/shotfun/planned-image.png';

/**
 * 根据输入参数构建可执行计划，包含步骤、成本估算、输入哈希和输出路径。
 */
export function buildSingleShotPlan(options = {}) {
  const normalized = normalizeOptions(options);
  const paths = buildOutputPaths({
    runId: normalized.resumeRunId || normalized.runId,
    cwd: normalized.cwd,
    outputDir: normalized.outputDir,
    projectName: normalized.projectName,
    projectSlug: normalized.projectSlug,
  });
  const hasExternalImage = normalized.imageUrls.length || normalized.imageRefs.length || normalized.imageFiles.length;
  const steps = [];
  const modelSelection = [];

  if (!hasExternalImage) {
    const imageSelection = selectTaskPreset({
      category: 'image',
      userModel: normalized.imageModel,
      userPrefs: {
        budget: normalized.budget,
        scenario: normalized.imageScenario || '低成本出图',
      },
      context: {
        hasReferenceImage: false,
        requiresImageEdit: false,
      },
    });
    const imagePreset = imageSelection.task;
    modelSelection.push(selectionSummary(IMAGE_STEP_ID, imageSelection));
    const imageOptions = {
      projectCode: normalized.projectCode,
      prompt: normalized.imagePrompt || normalized.prompt,
      model: imagePreset.key,
      aspectRatio: normalized.aspectRatio,
      resolution: normalized.imageResolution,
      negativePrompt: normalized.negativePrompt,
      input: normalized.imageInput,
      wait: true,
    };
    steps.push(buildStep({
      stepId: IMAGE_STEP_ID,
      name: 'image',
      service: 'text-to-image-service',
      functionName: 'generateImage',
      registryId: imagePreset.id,
      serviceVersion: IMAGE_SERVICE_VERSION,
      options: imageOptions,
      upstream: [],
      selection: imageSelection,
    }));
  }

  const videoSelection = selectTaskPreset({
    category: 'video',
    userModel: normalized.videoModel,
    userPrefs: {
      budget: normalized.budget,
      scenario: normalized.videoScenario || (Number(normalized.durationSeconds) === 10 ? '固定 10s 视频' : '默认图生视频'),
    },
    context: {
      hasReferenceImage: true,
      assetMode: normalized.assetMode,
      durationSeconds: normalized.durationSeconds,
      resolution: normalized.videoResolution,
    },
  });
  const videoPreset = videoSelection.task;
  modelSelection.push(selectionSummary(hasExternalImage ? VIDEO_STEP_ID_DIRECT : VIDEO_STEP_ID_WITH_IMAGE, videoSelection));
  const videoOptions = {
    projectCode: normalized.projectCode,
    prompt: normalized.videoPrompt || normalized.prompt,
    model: videoPreset.key,
    imageUrls: hasExternalImage ? normalized.imageUrls : [PLANNED_IMAGE_URL],
    imageRefs: normalized.imageRefs,
    imageFiles: normalized.imageFiles,
    assetMode: normalized.assetMode,
    aspectRatio: normalized.aspectRatio,
    resolution: normalized.videoResolution,
    durationSeconds: normalized.durationSeconds,
    generateAudio: normalized.generateAudio,
    input: normalized.videoInput,
    wait: true,
  };
  steps.push(buildStep({
    stepId: hasExternalImage ? VIDEO_STEP_ID_DIRECT : VIDEO_STEP_ID_WITH_IMAGE,
    name: 'video',
    service: 'image-to-video-service',
    functionName: 'generateVideo',
    registryId: videoPreset.id,
    serviceVersion: VIDEO_SERVICE_VERSION,
    options: videoOptions,
    upstream: hasExternalImage ? [] : [IMAGE_STEP_ID],
    selection: videoSelection,
  }));

  const runSpec = {
    workflow: WORKFLOW_ID,
    projectCode: normalized.projectCode,
    prompt: normalized.prompt,
    imagePrompt: normalized.imagePrompt,
    videoPrompt: normalized.videoPrompt,
    imageModel: normalized.imageModel,
    videoModel: normalized.videoModel,
    imageUrls: normalized.imageUrls,
    imageRefs: normalized.imageRefs,
    imageFiles: normalized.imageFiles,
    assetMode: normalized.assetMode,
    aspectRatio: normalized.aspectRatio,
    imageResolution: normalized.imageResolution,
    videoResolution: normalized.videoResolution,
    durationSeconds: normalized.durationSeconds,
    generateAudio: normalized.generateAudio,
    imageInput: normalized.imageInput,
    videoInput: normalized.videoInput,
    budget: normalized.budget,
    imageScenario: normalized.imageScenario,
    videoScenario: normalized.videoScenario,
  };
  const cost = estimateCost(steps.map((step) => ({ registryId: step.registryId })));

  return {
    workflow: WORKFLOW_ID,
    workflowVersion: WORKFLOW_VERSION,
    registryVersion: REGISTRY_VERSION,
    runId: paths.runId,
    outputDir: paths.runDir,
    manifest: paths.manifestPath,
    runSpecHash: hashInputs(runSpec),
    projectName: paths.projectName,
    projectSlug: paths.projectSlug,
    cost,
    steps,
    modelSelection,
  };
}

/**
 * 执行单镜头工作流；dryRun 只落盘计划，不调用 ShotFun OpenAPI。
 */
export async function runSingleShotWorkflow(options = {}, deps = {}) {
  const normalized = normalizeOptions(options);
  if (normalized.fetchRemote) {
    throw new ShotFunOpenApiError('--fetch-remote is not implemented yet; rerun without --fetch-remote.');
  }
  const plan = buildSingleShotPlan(normalized);
  const paths = await ensureRunDirectories(buildOutputPaths({
    runId: plan.runId,
    cwd: normalized.cwd,
    outputDir: normalized.outputDir,
    projectName: normalized.projectName,
    projectSlug: normalized.projectSlug,
  }), { fetchRemote: normalized.fetchRemote, keepRaw: normalized.keepRaw });

  const logger = jsonlLogger(paths.runDir);
  const resumeManifest = normalized.resumeRunId ? await validateResume(paths.manifestPath, plan, normalized) : undefined;
  const startedAt = new Date().toISOString();
  const manifest = {
    ok: true,
    runId: plan.runId,
    projectCode: normalized.projectCode,
    projectName: paths.projectName,
    projectSlug: paths.projectSlug,
    workflow: WORKFLOW_ID,
    workflowVersion: WORKFLOW_VERSION,
    registryVersion: REGISTRY_VERSION,
    createdAt: resumeManifest?.createdAt || startedAt,
    startedAt,
    goal: normalized.prompt,
    runSpecHash: plan.runSpecHash,
    cost: plan.cost,
    modelSelection: plan.modelSelection,
    outputDir: paths.runDir,
    userArtifacts: [],
    status: normalized.dryRun ? 'dry-run' : 'running',
    ...(resumeManifest?.forceResumed ? { forceResumed: true } : {}),
  };

  await writeManifest(paths.runDir, manifest);
  await logger.write({ event: 'cost_estimate', estimated: plan.cost.estimated, currency: plan.cost.currency });
  if (!normalized.dryRun) {
    withCostGuard({ estimated: plan.cost.estimated, confirm: normalized.confirm });
  }

  if (normalized.dryRun) {
    const sidecars = [];
    for (const step of plan.steps) {
      const request = await dryRunStep(step, deps);
      const sidecar = stepSidecar(step, {
        ok: true,
        status: 'planned',
        request: request.request,
      });
      sidecars.push(sidecar);
      await writeStep(paths.runDir, step.stepId, sidecar);
    }
    const finalManifest = {
      ...manifest,
      finishedAt: new Date().toISOString(),
      steps: sidecars.map(summaryFromSidecar),
    };
    await writeManifest(paths.runDir, finalManifest);
    await writeProjectRunSummary(paths, finalManifest);
    return finalOutput({ plan, paths, manifest: finalManifest, dryRun: true });
  }

  const sidecars = [];
  let imageUrls = [...normalized.imageUrls];
  let mustRunDownstream = false;

  for (const plannedStep of plan.steps) {
    const step = plannedStep.stepId.startsWith('02-video')
      ? withVideoImageUrls(plannedStep, imageUrls)
      : plannedStep;
    const existing = !mustRunDownstream ? await loadOptionalStep(paths.runDir, step.stepId) : undefined;
    if (existing && canSkipStep(existing, step)) {
      await logger.write({ event: 'step_skip', stepId: step.stepId, name: step.name });
      sidecars.push(existing);
      if (step.stepId === IMAGE_STEP_ID) imageUrls = extractRequiredUrls(existing, step.stepId);
      continue;
    }

    mustRunDownstream = true;
    await logger.write({ event: 'step_start', stepId: step.stepId, name: step.name });
    try {
      const result = await executeStep(step, deps);
      const sidecar = stepSidecar(step, {
        ...result,
        ok: true,
        status: 'success',
      });
      await writeStep(paths.runDir, step.stepId, sidecar);
      await logger.write({ event: 'step_end', stepId: step.stepId, name: step.name, status: sidecar.status, taskNo: sidecar.taskNo });
      sidecars.push(sidecar);
      if (step.stepId === IMAGE_STEP_ID) imageUrls = extractRequiredUrls(sidecar, step.stepId);
    } catch (error) {
      const sidecar = stepSidecar(step, {
        ok: false,
        status: 'failed',
        errorCode: error.name || 'WORKFLOW_STEP_FAILED',
        message: error.message,
        recoverable: true,
      });
      await writeStep(paths.runDir, step.stepId, sidecar);
      await writeManifest(paths.runDir, {
        ...manifest,
        status: 'failed',
        failedSteps: [step.stepId],
        finishedAt: new Date().toISOString(),
      });
      await writeProjectRunSummary(paths, {
        ...manifest,
        status: 'failed',
        failedSteps: [step.stepId],
        finishedAt: new Date().toISOString(),
      });
      throw error;
    }
  }

  const userArtifacts = buildUserArtifacts(sidecars);
  const finalManifest = {
    ...manifest,
    status: 'success',
    finishedAt: new Date().toISOString(),
    steps: sidecars.map(summaryFromSidecar),
    userArtifacts,
  };
  await writeManifest(paths.runDir, finalManifest);
  await writeProjectRunSummary(paths, finalManifest);

  return finalOutput({ plan, paths, manifest: finalManifest, userArtifacts });
}

/**
 * 创建一步工作流描述，inputHash 用于 resume 时判断是否可复用已有 sidecar。
 */
function buildStep({ stepId, name, service, functionName, registryId, serviceVersion, options, upstream, selection }) {
  return {
    stepId,
    name,
    service,
    function: functionName,
    registryId,
    serviceVersion,
    options,
    upstream,
    selection: selection ? selectionSummary(stepId, selection) : undefined,
    inputHash: hashInputs({ service, functionName, options }),
    registryVersion: REGISTRY_VERSION,
    workflowVersion: WORKFLOW_VERSION,
  };
}

/**
 * 用 dryRun 参数执行 step，复用真实 service 的参数构造逻辑。
 */
async function dryRunStep(step, deps) {
  return await executeStep({ ...step, options: { ...step.options, dryRun: true } }, deps);
}

/**
 * 调度具体 service 函数执行 step。
 */
async function executeStep(step, deps) {
  if (step.function === 'generateImage') {
    return await (deps.generateImage || defaultGenerateImage)(step.options);
  }
  if (step.function === 'generateVideo') {
    return await (deps.generateVideo || defaultGenerateVideo)(step.options);
  }
  throw new ShotFunOpenApiError(`Unknown workflow step function: ${step.function}`);
}

/**
 * 图片步骤完成后，将真实图片 URL 注入视频步骤并重算 inputHash。
 */
function withVideoImageUrls(step, imageUrls) {
  const options = { ...step.options, imageUrls };
  return {
    ...step,
    options,
    inputHash: hashInputs({ service: step.service, functionName: step.function, options }),
  };
}

/**
 * 把 service 返回值包装为 step sidecar，便于恢复执行和最终产物汇总。
 */
function stepSidecar(step, payload) {
  return {
    stepId: step.stepId,
    name: step.name,
    service: step.service,
    function: step.function,
    registryId: step.registryId,
    inputParams: step.options,
    inputHash: step.inputHash,
    registryVersion: step.registryVersion,
    workflowVersion: step.workflowVersion,
    serviceVersion: step.serviceVersion,
    upstream: step.upstream,
    selection: step.selection,
    costEstimated: estimateCost([{ registryId: step.registryId }]).estimated,
    ...payload,
  };
}

/**
 * 校验 resume 目标 manifest 与当前计划兼容，避免参数变化导致错误复用旧产物。
 */
async function validateResume(manifestPath, plan, options) {
  const previous = JSON.parse(await readFile(manifestPath, 'utf8'));
  if (previous.workflowVersion !== plan.workflowVersion) {
    throw new ShotFunOpenApiError(`Workflow version changed from ${previous.workflowVersion} to ${plan.workflowVersion}; start a new run.`);
  }
  if (previous.registryVersion !== plan.registryVersion && !options.forceResume) {
    throw new ShotFunOpenApiError('Registry version changed; rerun with --force-resume or start a new run.');
  }
  if (previous.runSpecHash !== plan.runSpecHash && !options.forceResume) {
    throw new ShotFunOpenApiError('Workflow input changed; rerun with --force-resume or start a new run.');
  }
  return {
    ...previous,
    forceResumed: options.forceResume && (
      previous.registryVersion !== plan.registryVersion || previous.runSpecHash !== plan.runSpecHash
    ),
  };
}

/**
 * 尝试读取已有 step；不存在时返回 undefined，让执行器继续跑该步骤。
 */
async function loadOptionalStep(runDir, stepId) {
  try {
    return await loadStep(runDir, stepId);
  } catch (error) {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  }
}

/**
 * 判断已有 sidecar 是否可跳过执行。
 */
function canSkipStep(sidecar, step) {
  return (
    sidecar.ok === true &&
    sidecar.status === 'success' &&
    sidecar.inputHash === step.inputHash &&
    sidecar.registryVersion === REGISTRY_VERSION &&
    sidecar.workflowVersion === WORKFLOW_VERSION &&
    sidecar.serviceVersion === step.serviceVersion
  );
}

/**
 * 下游视频步骤需要上游图片 URL，缺失时直接失败而不是提交无效任务。
 */
function extractRequiredUrls(sidecar, stepId) {
  const urls = Array.isArray(sidecar.resultUrls) ? sidecar.resultUrls : [];
  if (!urls.length) throw new ShotFunOpenApiError(`Step ${stepId} did not produce a URL for downstream video generation.`);
  return urls;
}

/**
 * 生成 CLI/Agent 最终返回结构。
 */
function finalOutput({ plan, paths, manifest, userArtifacts = [], dryRun = false }) {
  return {
    ok: true,
    ...(dryRun ? { dryRun: true, plan: publicPlan(plan) } : {}),
    runId: plan.runId,
    projectName: paths.projectName,
    projectSlug: paths.projectSlug,
    outputDir: paths.runDir,
    manifest: paths.manifestPath,
    userArtifacts,
    cost: manifest.cost,
  };
}

/**
 * 对外暴露不含敏感执行细节的计划摘要。
 */
function publicPlan(plan) {
  return {
    workflow: plan.workflow,
    workflowVersion: plan.workflowVersion,
    registryVersion: plan.registryVersion,
    runSpecHash: plan.runSpecHash,
    cost: plan.cost,
    modelSelection: plan.modelSelection,
    steps: plan.steps.map((step) => ({
      stepId: step.stepId,
      name: step.name,
      service: step.service,
      function: step.function,
      registryId: step.registryId,
      upstream: step.upstream,
      selection: step.selection,
    })),
  };
}

/**
 * 从 sidecar 生成 manifest 中的 step 摘要。
 */
function summaryFromSidecar(sidecar) {
  return {
    stepId: sidecar.stepId,
    name: sidecar.name,
    status: sidecar.status,
    registryId: sidecar.registryId,
    selection: sidecar.selection,
    taskNo: sidecar.taskNo,
    resultUrls: sidecar.resultUrls,
    assetRefs: sidecar.assetRefs,
    inputHash: sidecar.inputHash,
  };
}

/**
 * 规范化工作流参数并填充默认值。
 */
function normalizeOptions(options = {}) {
  const prompt = options.prompt || options.goal;
  if (!prompt) throw new ShotFunOpenApiError('single-shot workflow requires --prompt.');
  return {
    projectCode: resolveProjectCode(options.projectCode),
    projectName: options.projectName,
    projectSlug: options.projectSlug,
    prompt,
    imagePrompt: options.imagePrompt,
    videoPrompt: options.videoPrompt,
    imageModel: options.imageModel || 'auto',
    videoModel: options.videoModel || 'auto',
    imageUrls: asArray(options.imageUrls),
    imageRefs: asArray(options.imageRefs),
    imageFiles: asArray(options.imageFiles),
    imageInput: options.imageInput || {},
    videoInput: options.videoInput || {},
    negativePrompt: options.negativePrompt || '',
    assetMode: options.assetMode || 'none',
    aspectRatio: options.aspectRatio || '16:9',
    imageResolution: options.imageResolution || '2K',
    videoResolution: options.videoResolution || '720p',
    durationSeconds: Number(options.durationSeconds || 5),
    budget: options.budget || 'balanced',
    imageScenario: options.imageScenario,
    videoScenario: options.videoScenario,
    generateAudio: Boolean(options.generateAudio),
    dryRun: Boolean(options.dryRun),
    confirm: Boolean(options.confirm),
    forceResume: Boolean(options.forceResume),
    fetchRemote: Boolean(options.fetchRemote),
    keepRaw: Boolean(options.keepRaw),
    runId: options.runId,
    resumeRunId: options.resumeRunId,
    outputDir: options.outputDir,
    cwd: options.cwd,
  };
}

function selectionSummary(stepId, selection) {
  return {
    stepId,
    selected: selection.task.id,
    key: selection.task.key,
    reason: selection.reason,
    recommendationScore: selection.task.selection.recommendationScore,
    credits: selection.task.price.credits,
    taxonomy: selection.task.taxonomy,
  };
}

function asArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}
