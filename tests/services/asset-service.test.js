// 覆盖资产组和资产创建任务的 dry-run 请求构造。
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createAsset, createAssetGroup } from '../../scripts/services/asset-service.js';

describe('asset service', () => {
  it('builds an asset group dry-run request from the registry', async () => {
    const result = await createAssetGroup({
      projectCode: 'demo',
      name: 'hero references',
      description: 'Reference images for the hero',
      dryRun: true,
    });

    assert.equal(result.ok, true);
    assert.equal(result.dryRun, true);
    assert.equal(result.category, 'asset');
    assert.equal(result.operation, 'asset-group-create');
    assert.equal(result.request.taskCode, 'sd_asset_group_create');
    assert.deepEqual(result.request.inputParams, {
      name: 'hero references',
      description: 'Reference images for the hero',
    });
  });

  it('builds an asset dry-run request from the registry', async () => {
    const result = await createAsset({
      projectCode: 'demo',
      groupId: 123,
      url: 'https://example.com/hero.png',
      name: 'hero',
      dryRun: true,
    });

    assert.equal(result.request.taskCode, 'sd_asset_create');
    assert.deepEqual(result.request.inputParams, {
      groupId: 123,
      url: 'https://example.com/hero.png',
      name: 'hero',
      assetType: 'Image',
    });
  });

  it('builds an asset dry-run request from a local file upload plan', async () => {
    const result = await createAsset({
      projectCode: 'demo',
      groupId: 123,
      file: '/tmp/voice.m4a',
      name: 'voice',
      assetType: 'Audio',
      dryRun: true,
    });

    assert.equal(result.sourceFile, '/tmp/voice.m4a');
    assert.deepEqual(result.request.inputParams, {
      groupId: 123,
      url: 'https://<uploaded-from:/tmp/voice.m4a>',
      name: 'voice',
      assetType: 'Audio',
    });
  });

  it('requires group name and asset inputs before calling the API', async () => {
    await assert.rejects(
      () => createAssetGroup({ projectCode: 'demo', dryRun: true }),
      /Missing --name/,
    );
    // 传齐 name 与 groupId，缺 url 时校验仍要抛错（schema conditional requiredWhen action=asset-create）
    await assert.rejects(
      () => createAsset({ projectCode: 'demo', name: 'hero', groupId: 123, dryRun: true }),
      /Missing --url/,
    );
  });
});
