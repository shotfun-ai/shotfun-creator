// 覆盖图片服务的默认模型请求和不支持参考图的模型约束。
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { generateImage } from '../../scripts/services/text-to-image-service.js';

describe('text-to-image service', () => {
  it('builds the default nano2 dry-run request', async () => {
    const result = await generateImage({
      projectCode: 'demo',
      prompt: 'A lake',
      dryRun: true,
    });

    assert.deepEqual(result, {
      ok: true,
      dryRun: true,
      request: {
        projectCode: 'demo',
        taskCode: 'agent_ti2i_nano2_cheap',
        inputParams: {
          generateAudio: true,
          prompt: 'A lake',
          aspectRatio: '16:9',
          resolution: '2K',
        },
      },
      wait: false,
      category: 'image',
      model: 'nano2',
    });
  });

  it('rejects text-only image references before calling the API', async () => {
    await assert.rejects(
      () =>
        generateImage({
          projectCode: 'demo',
          model: 'z-image',
          prompt: 'A character',
          imageUrls: ['https://example.com/ref.png'],
          dryRun: true,
        }),
      /text-to-image only/,
    );
  });

  it('builds the GPT Image2 cheap API dry-run request', async () => {
    const result = await generateImage({
      projectCode: 'demo',
      model: 'gpt-image2',
      prompt: 'A product poster',
      imageUrls: ['https://example.com/ref.png'],
      dryRun: true,
    });

    assert.equal(result.request.taskCode, 'agent_ti2i_gpt_image2_cheap');
    assert.deepEqual(result.request.inputParams, {
      prompt: 'A product poster',
      aspectRatio: '16:9',
      resolution: '2K',
      imageUrls: ['https://example.com/ref.png'],
    });
  });

  it('builds the Z-Image dry-run request with its registry resolution default', async () => {
    const result = await generateImage({
      projectCode: 'demo',
      model: 'z-image',
      prompt: 'A quick product sketch',
      dryRun: true,
    });

    assert.equal(result.request.taskCode, 'agent_t2i_zimage');
    assert.equal(result.request.inputParams.resolution, '720p');
  });
});
