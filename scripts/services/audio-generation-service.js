import { ShotFunOpenApiError } from '../core/api-client.js';
import { normalizeInputs } from '../core/schema-runtime.js';
import {
  AUDIO_TASKS,
  createClient,
  formatTaskOutput,
  resolveProjectCode,
  runTask,
} from '../core/shotfun-service.js';
import { extractResultPayload } from '../core/result-adapter.js';
import { buildInputParams } from './input-params.js';
import { resolveVoice } from './voice-catalog.js';

/**
 * 音频生成服务。
 *
 * 支持单句 TTS 和声音克隆后生成语音。
 * 入参 schema 见 capability-schema.js#audio-generation；conditional required 校验由 schema-runtime 处理。
 */
export const SERVICE_VERSION = '2026.05.14';
const SUPPORTED_AUDIO_KINDS = new Set(['single', 'clone']);

/**
 * 生成或规划音频任务。
 */
export async function generateAudio(options, deps = {}) {
  const normalized = normalizeInputs('audio-generation', options);
  if (!SUPPORTED_AUDIO_KINDS.has(normalized.kind)) {
    throw new ShotFunOpenApiError(`kind must be one of: ${[...SUPPORTED_AUDIO_KINDS].join(', ')}`);
  }
  if (!AUDIO_TASKS[normalized.kind]) throw new ShotFunOpenApiError(`Unknown audio kind: ${normalized.kind}`);
  if (normalized.kind === 'clone') return await generateClonedAudio(normalized, deps);
  validateVoiceSelector(normalized);
  const voice = await resolveVoice(normalized);
  const taskCode = normalized.taskCode || AUDIO_TASKS[normalized.kind];
  const inputParams = buildInputParams('audio', applyResolvedVoice(normalized, voice));

  return await runTask({
    client: normalized.dryRun ? undefined : deps.client || createClient(),
    projectCode: normalized.projectCode,
    taskCode,
    inputParams,
    wait: normalized.wait,
    dryRun: normalized.dryRun,
    meta: {
      category: 'audio',
      ...(voice ? { voice } : {}),
    },
  });
}

async function generateClonedAudio(options, deps = {}) {
  const projectCode = resolveProjectCode(options.projectCode);
  const cloneTaskCode = options.cloneTaskCode || AUDIO_TASKS.clone;
  const ttsTaskCode = options.ttsTaskCode || options.taskCode || AUDIO_TASKS.single;
  const cloneInputParams = buildInputParams('audio-clone', options);
  const ttsBaseOptions = {
    ...options,
    kind: 'single',
    voiceId: '<voiceId from clone result>',
    voiceName: undefined,
    voicePlatform: undefined,
  };
  const plannedTtsInputParams = buildInputParams('audio', ttsBaseOptions);

  if (options.dryRun) {
    return {
      ok: true,
      dryRun: true,
      category: 'audio',
      kind: 'clone',
      clonePlan: {
        request: { projectCode, taskCode: cloneTaskCode, inputParams: cloneInputParams },
      },
      ttsPlan: {
        request: { projectCode, taskCode: ttsTaskCode, inputParams: plannedTtsInputParams },
      },
    };
  }

  const client = deps.client || createClient();
  const cloneTask = await client.createTaskAndWait({
    projectCode,
    taskCode: cloneTaskCode,
    inputParams: cloneInputParams,
  });
  const cloneVoiceId = extractCloneVoiceId(cloneTask);
  if (!cloneVoiceId) {
    throw new ShotFunOpenApiError('Clone task result did not include resultData.voiceId.', cloneTask);
  }

  const ttsInputParams = buildInputParams('audio', {
    ...ttsBaseOptions,
    voiceId: cloneVoiceId,
  });
  const output = await runTask({
    client,
    projectCode,
    taskCode: ttsTaskCode,
    inputParams: ttsInputParams,
    wait: options.wait,
    dryRun: false,
    meta: {
      category: 'audio',
      kind: 'clone',
      cloneVoiceId,
      cloneTask: formatTaskOutput(cloneTask, { category: 'audio', kind: 'voice-clone' }),
    },
  });
  return output;
}

function extractCloneVoiceId(task) {
  const payload = extractResultPayload(task);
  return typeof payload.voiceId === 'string' && payload.voiceId.length ? payload.voiceId : undefined;
}

function validateVoiceSelector(options) {
  if (options.kind === 'list') return;
  if (options.voiceId || options.voiceName || options.voicePlatform) return;
  throw new ShotFunOpenApiError('Missing voice selector. Provide --voice-platform for automatic recommendation, or pass --voice-id / --voice-name.');
}

function applyResolvedVoice(options, voice) {
  if (!voice) return options;
  return {
    ...options,
    voiceId: voice.id,
    voiceName: voice.name,
    voicePlatform: voice.platform,
    language: options.language === 'auto' && voice.language ? voice.language : options.language,
  };
}
