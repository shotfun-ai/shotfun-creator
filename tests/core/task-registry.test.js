// 覆盖任务注册表查询、preset 解析和旧版映射兼容性。
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  REGISTRY_VERSION,
  applyTaskInputRules,
  getTaskDefinition,
  listTaskDefinitions,
  resolveTaskPreset,
} from '../../scripts/core/task-registry.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const taskRegistryPath = path.resolve(__dirname, '../../scripts/core/task-registry.js');

describe('task registry', () => {
  it('lists the api-layer task_code registry entries first', () => {
    const taskCodes = listTaskDefinitions().map((task) => task.taskCode);

    assert.deepEqual(taskCodes.slice(0, 10), [
      'agent_ti2i_gpt_image2_cheap',
      'agent_ti2i_nano2_cheap',
      'agent_ti2i_seedream5',
      'agent_t2i_zimage',
      'agent_r2v_sd2_720p',
      'agent_r2v_sd2_1080p',
      'agent_r2v_sd2_fast_720p',
      'agent_r2v_sd2_fast_1080p',
      'agent_r2v_happy_horse_720p',
      'agent_r2v_happy_horse_1080p',
    ]);
    assert.ok(taskCodes.includes('agent_tts_minimax'));
    assert.equal(taskCodes.includes('character_desc'), false);
    assert.ok(taskCodes.includes('sd_asset_create'));
  });

  it('resolves image models from the single registry source', () => {
    const preset = resolveTaskPreset('image', 'nano2');

    assert.equal(REGISTRY_VERSION, '2026.05.21');
    assert.equal(preset.id, 'image.nano2');
    assert.equal(preset.taskCode, 'agent_ti2i_nano2_cheap');
    assert.equal('inputParams' in preset, false);
    assert.equal('serviceType' in preset, false);
    assert.equal(preset.price.currency, 'credits');
    assert.equal(preset.supports.referenceImage, true);
    assert.deepEqual(preset.inputDefaults, { generateAudio: true });
    assert.deepEqual(preset.inputConstraints.durationSeconds, { min: 4, exclusiveMin: true });
  });

  it('resolves the GPT Image2 image model', () => {
    const preset = resolveTaskPreset('image', 'gpt-image2');

    assert.equal(preset.id, 'image.gpt_image2');
    assert.equal(preset.taskCode, 'agent_ti2i_gpt_image2_cheap');
    assert.equal('directTaskCode' in preset, false);
    assert.equal('inputParams' in preset, false);
    assert.equal('serviceType' in preset, false);
    assert.equal(preset.supports.referenceImage, true);
    assert.equal(preset.price.currency, 'credits');
    assert.equal(preset.taxonomy.primary, '图片生成');
    assert.equal(preset.taxonomy.secondary, '文图生图');
    assert.equal(preset.selection.recommendationScore, 10);
    assert.ok(preset.selection.scenarios.includes('所有场景'));
    assert.ok(preset.selection.highlights.includes('理解力最高的模型'));
  });

  it('resolves the new fast Z-Image text-to-image model', () => {
    const preset = resolveTaskPreset('image', 'z-image');

    assert.equal(preset.id, 'image.z_image');
    assert.equal(preset.taskCode, 'agent_t2i_zimage');
    assert.equal('serviceType' in preset, false);
    assert.equal(preset.defaults.resolution, '720p');
    assert.equal(preset.supports.referenceImage, false);
  });

  it('resolves the new Seedance 2.0 reference video presets', () => {
    const preset = resolveTaskPreset('video', 'sd2.0-fast-720p');

    assert.equal(preset.id, 'video.sd2_fast_720p');
    assert.equal(preset.taskCode, 'agent_r2v_sd2_fast_720p');
    assert.equal('directTaskCode' in preset, false);
    assert.equal(preset.defaults.resolution, '720p');
    assert.equal(preset.supports.referenceImage, true);
    assert.equal('assetTaskCodes' in preset, false);
    assert.deepEqual(preset.assetPipeline, {
      mode: 'allowlist-asset',
      group: {
        taskCode: 'sd_asset_group_create_linkaihub',
        reuseScope: 'user',
        defaultName: 'shotfun-reference-assets',
      },
      asset: {
        taskCode: 'sd_asset_create_linkaihub',
        assetType: 'Image',
        refOutput: 'assetRef',
      },
    });
  });

  it('resolves allowlist asset pipeline metadata for Seedance 2.0 allowlist presets', () => {
    const preset = resolveTaskPreset('video', 'sd2.0-720p');

    assert.equal('assetTaskCodes' in preset, false);
    assert.deepEqual(preset.assetPipeline, {
      mode: 'allowlist-asset',
      group: {
        taskCode: 'sd_asset_group_create_linkaihub',
        reuseScope: 'user',
        defaultName: 'shotfun-reference-assets',
      },
      asset: {
        taskCode: 'sd_asset_create_linkaihub',
        assetType: 'Image',
        refOutput: 'assetRef',
      },
    });
  });

  it('returns immutable task definitions by registry id', () => {
    const task = getTaskDefinition('image.nano2');
    task.taskCode = 'mutated';

    assert.equal(getTaskDefinition('image.nano2').taskCode, 'agent_ti2i_nano2_cheap');
  });

  it('defines audio tasks with object-style audioTask entries for readability', async () => {
    const source = await readFile(taskRegistryPath, 'utf8');

    assert.match(source, /audioTask\(\{\s+id: 'audio\.tts_single_voice'/);
    assert.doesNotMatch(source, /audioTask\('audio\.tts_single_voice'/);
  });

  it('defines video processing and asset tasks with object-style entries for readability', async () => {
    const source = await readFile(taskRegistryPath, 'utf8');

    assert.match(source, /videoProcessTask\(\{\s+id: 'video_process\.upscale'/);
    assert.match(source, /assetTask\(\{\s+id: 'asset\.group_create'/);
    assert.doesNotMatch(source, /videoProcessTask\('video_process\./);
    assert.doesNotMatch(source, /assetTask\('asset\./);
  });

  it('lists registry definitions by category', () => {
    const videoTasks = listTaskDefinitions({ category: 'video' });

    assert.deepEqual(videoTasks.map((task) => task.id), [
      'video.sd2_720p',
      'video.sd2_1080p',
      'video.sd2_fast_720p',
      'video.sd2_fast_1080p',
      'video.happy_horse_720p',
      'video.happy_horse_1080p',
    ]);
  });

  it('applies registry input defaults before user params', () => {
    const task = resolveTaskPreset('image', 'nano2');

    assert.deepEqual(applyTaskInputRules(task, { prompt: 'A lake' }), {
      generateAudio: true,
      prompt: 'A lake',
    });
    assert.deepEqual(applyTaskInputRules(task, { prompt: 'A lake', generateAudio: false }), {
      generateAudio: false,
      prompt: 'A lake',
    });
  });

  it('applies locked registry input params after user params', () => {
    const task = {
      key: 'aaa-1080p',
      inputDefaults: { resolution: '720p', generateAudio: true },
      inputLocked: { resolution: '1080p' },
    };

    assert.deepEqual(applyTaskInputRules(task, { prompt: 'A lake' }), {
      resolution: '1080p',
      generateAudio: true,
      prompt: 'A lake',
    });
  });

  it('rejects user params that conflict with locked registry input params', () => {
    const task = {
      key: 'aaa-1080p',
      inputLocked: { resolution: '1080p' },
    };

    assert.throws(
      () => applyTaskInputRules(task, { prompt: 'A lake', resolution: '720p' }),
      /aaa-1080p.resolution is fixed to 1080p/,
    );
  });

  it('rejects registry input constraints when a configured value is out of range', () => {
    const task = resolveTaskPreset('image', 'nano2');

    assert.throws(
      () => applyTaskInputRules(task, { prompt: 'A lake', durationSeconds: 4 }),
      /nano2.durationSeconds must be > 4/,
    );
    assert.doesNotThrow(() => applyTaskInputRules(task, { prompt: 'A lake', durationSeconds: 5 }));
  });
});
