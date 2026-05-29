// 覆盖图生视频服务的默认请求、资产模式规划和引用校验。
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { generateVideo } from '../../scripts/services/image-to-video-service.js';

describe('image-to-video service', () => {
  it('builds the default Seedance 2.0 fast 720p dry-run request', async () => {
    const result = await generateVideo({
      projectCode: 'demo',
      prompt: 'A lake',
      imageUrls: ['https://example.com/a.png'],
      assetMode: 'none',
      dryRun: true,
    });

    assert.equal(result.request.taskCode, 'agent_r2v_sd2_fast_720p');
    assert.equal('type' in result.request.inputParams, false);
    assert.deepEqual(result.request.inputParams.imageUrls, ['https://example.com/a.png']);
    assert.equal(result.category, 'video');
    assert.equal(result.model, 'sd2.0-fast-720p');
  });

  it('plans allowlist asset pipeline for Seedance 2.0 dry-run asset mode', async () => {
    const result = await generateVideo({
      projectCode: 'demo',
      model: 'sd2.0-720p',
      prompt: 'Animate this character',
      imageUrls: ['https://example.com/character.png'],
      assetMode: 'asset',
      dryRun: true,
    });

    assert.deepEqual(result.assetPlan, {
      mode: 'allowlist-asset',
      refs: ['https://example.com/character.png'],
      resolveAssetGroup: true,
      assetPipeline: {
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
      },
    });
    assert.deepEqual(result.request.inputParams.imageUrls, ['Asset://<created-from:https://example.com/character.png>']);
  });

  it('requires references for asset-mode reference video', async () => {
    await assert.rejects(
      () =>
        generateVideo({
          projectCode: 'demo',
          model: 'sd2.0-720p',
          prompt: 'Animate this character',
          assetMode: 'asset',
          dryRun: true,
        }),
      /requires at least one/,
    );
  });

  it('builds Happy Horse 720p reference video dry-run request', async () => {
    const result = await generateVideo({
      projectCode: 'demo',
      model: 'happy-horse-720p',
      prompt: 'Animate this character',
      imageUrls: ['https://example.com/character.png'],
      assetMode: 'none',
      dryRun: true,
    });

    assert.equal(result.request.taskCode, 'agent_r2v_happy_horse_720p');
    assert.equal('type' in result.request.inputParams, false);
    assert.equal(result.request.inputParams.duration, 5);
    assert.equal(result.request.inputParams.durationSeconds, 5);
    assert.equal(result.request.inputParams.resolution, '720P');
    assert.deepEqual(result.request.inputParams.imageUrls, ['https://example.com/character.png']);
  });

  it('builds the new Seedance 2.0 fast 720p dry-run request', async () => {
    const result = await generateVideo({
      projectCode: 'demo',
      model: 'sd2.0-fast-720p',
      prompt: 'Animate this character',
      imageUrls: ['https://example.com/character.png'],
      assetMode: 'direct-url',
      dryRun: true,
    });

    assert.equal(result.request.taskCode, 'agent_r2v_sd2_fast_720p');
    assert.equal(result.request.inputParams.resolution, '720p');
    assert.deepEqual(result.request.inputParams.imageUrls, ['https://example.com/character.png']);
  });

  it('locks 1080p registry video presets against user resolution overrides', async () => {
    const result = await generateVideo({
      projectCode: 'demo',
      model: 'sd2.0-fast-1080p',
      prompt: 'Animate this character',
      imageUrls: ['https://example.com/character.png'],
      assetMode: 'direct-url',
      dryRun: true,
    });

    assert.equal(result.request.inputParams.resolution, '1080p');

    await assert.rejects(
      () =>
        generateVideo({
          projectCode: 'demo',
          model: 'sd2.0-fast-1080p',
          prompt: 'Animate this character',
          imageUrls: ['https://example.com/character.png'],
          assetMode: 'direct-url',
          resolution: '720p',
          dryRun: true,
        }),
      /sd2.0-fast-1080p.resolution is fixed to 1080p/,
    );
  });

  it('applies registry input defaults and constraints to video requests', async () => {
    const result = await generateVideo({
      projectCode: 'demo',
      model: 'sd2.0-fast-720p',
      prompt: 'Animate this character',
      imageUrls: ['https://example.com/character.png'],
      assetMode: 'none',
      dryRun: true,
    });

    assert.equal(result.request.inputParams.generateAudio, true);

    await assert.rejects(
      () =>
        generateVideo({
          projectCode: 'demo',
          model: 'sd2.0-fast-720p',
          prompt: 'Animate this character',
          imageUrls: ['https://example.com/character.png'],
          assetMode: 'none',
          durationSeconds: 4,
          dryRun: true,
        }),
      /sd2.0-fast-720p.durationSeconds must be > 4/,
    );
  });

  it('creates allowlist assets and submits video with asset refs', async () => {
    const calls = [];
    const client = {
      async createTaskAndWait(request) {
        calls.push({ method: 'createTaskAndWait', request });
        if (request.taskCode === 'sd_asset_group_create_linkaihub') {
          return { data: { groupId: 321 } };
        }
        if (request.taskCode === 'sd_asset_create_linkaihub') {
          return { data: { resultData: 'Asset://allowlist/reference-1' } };
        }
        throw new Error(`unexpected taskCode: ${request.taskCode}`);
      },
      async createTask(request) {
        calls.push({ method: 'createTask', request });
        return { taskNo: 'video-task-1', data: { taskNo: 'video-task-1' } };
      },
    };

    const result = await generateVideo({
      projectCode: 'demo',
      model: 'sd2.0-720p',
      prompt: 'Animate this character',
      imageUrls: ['https://example.com/character.png'],
      assetMode: 'asset',
    }, { client });

    assert.equal(result.taskNo, 'video-task-1');
    assert.equal(calls[0].request.taskCode, 'sd_asset_group_create_linkaihub');
    assert.deepEqual(calls[0].request.inputParams, {
      name: 'shotfun-reference-assets',
      description: 'Auto-created by shotfun-js-api-template',
      projectName: '',
    });
    assert.equal(calls[1].request.taskCode, 'sd_asset_create_linkaihub');
    assert.equal(calls[1].request.inputParams.groupId, 321);
    assert.equal(calls[1].request.inputParams.url, 'https://example.com/character.png');
    assert.equal(calls[2].request.taskCode, 'agent_r2v_sd2_720p');
    assert.deepEqual(calls[2].request.inputParams.imageUrls, ['Asset://allowlist/reference-1']);
  });

  it('uses backend asset group resolver when available', async () => {
    const calls = [];
    const client = {
      async resolveOrCreateAssetGroup(request) {
        calls.push({ method: 'resolveOrCreateAssetGroup', request });
        return { data: { assetGroupId: 654 } };
      },
      async createTaskAndWait(request) {
        calls.push({ method: 'createTaskAndWait', request });
        return { data: { resultData: 'Asset://allowlist/reference-2' } };
      },
      async createTask(request) {
        calls.push({ method: 'createTask', request });
        return { taskNo: 'video-task-2', data: { taskNo: 'video-task-2' } };
      },
    };

    await generateVideo({
      projectCode: 'demo',
      model: 'sd2.0-720p',
      prompt: 'Animate this character',
      imageUrls: ['https://example.com/character.png'],
      assetMode: 'asset',
    }, { client });

    assert.deepEqual(calls[0], {
      method: 'resolveOrCreateAssetGroup',
      request: {
        projectCode: 'demo',
        name: 'shotfun-reference-assets',
        description: 'Auto-created by shotfun-js-api-template',
        reuseScope: 'user',
        taskCode: 'sd_asset_group_create_linkaihub',
      },
    });
    assert.equal(calls[1].request.taskCode, 'sd_asset_create_linkaihub');
    assert.equal(calls[1].request.inputParams.groupId, 654);
    assert.deepEqual(calls[2].request.inputParams.imageUrls, ['Asset://allowlist/reference-2']);
  });
});
