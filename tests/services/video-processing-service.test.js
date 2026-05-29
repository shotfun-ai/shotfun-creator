// 覆盖视频处理服务的请求构造和输入来源校验。
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { processVideo } from '../../scripts/services/video-processing-service.js';

describe('video processing service', () => {
  it('builds an upscale dry-run request', async () => {
    const result = await processVideo({
      projectCode: 'demo',
      operation: 'upscale',
      videoUrl: 'https://example.com/a.mp4',
      dryRun: true,
    });

    assert.deepEqual(result.request, {
      projectCode: 'demo',
      taskCode: 'tencentcloud_mps_transcode',
      inputParams: {
        url: 'https://example.com/a.mp4',
        durationSeconds: 5,
      },
    });
    assert.equal(result.category, 'video-processing');
    assert.equal(result.operation, 'upscale');
  });

  it('requires either videoUrl or videoFile', async () => {
    await assert.rejects(
      () =>
        processVideo({
          projectCode: 'demo',
          operation: 'upscale',
          dryRun: true,
        }),
      /Missing --video-url or --video-file/,
    );
  });
});
