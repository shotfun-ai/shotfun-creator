// 覆盖 Java 端不同 TaskResult DTO 到 Agent 统一结果结构的适配。
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { adaptTaskResult } from '../../scripts/core/result-adapter.js';

describe('result adapter', () => {
  it('adapts RunningHub/Comfy image results', () => {
    const output = adaptTaskResult({
      taskNo: 'T-IMG',
      status: 'success',
      resultData: {
        imageUrl: 'https://cdn.example.com/image.png',
        model: 'runninghub',
        steps: 28,
        width: 1024,
        height: 1024,
      },
    });

    assert.deepEqual(output.resultUrls, ['https://cdn.example.com/image.png']);
    assert.deepEqual(output.result, {
      type: 'image',
      urls: ['https://cdn.example.com/image.png'],
      model: 'runninghub',
      steps: 28,
      width: 1024,
      height: 1024,
    });
    assert.deepEqual(output.artifacts, [
      {
        kind: 'image',
        name: 'image',
        url: 'https://cdn.example.com/image.png',
      },
    ]);
  });

  it('adapts Bailian-style video results with last frame metadata', () => {
    const output = adaptTaskResult({
      data: {
        resultData: {
          videoUrl: 'https://cdn.example.com/video.mp4',
          lastFrameUrl: 'https://cdn.example.com/last.png',
          status: 'SUCCEEDED',
          resolution: '720p',
          duration: 5,
          fps: 24,
          seed: 123,
        },
      },
    });

    assert.deepEqual(output.resultUrls, [
      'https://cdn.example.com/video.mp4',
      'https://cdn.example.com/last.png',
    ]);
    assert.deepEqual(output.result, {
      type: 'video',
      urls: ['https://cdn.example.com/video.mp4'],
      lastFrameUrl: 'https://cdn.example.com/last.png',
      status: 'SUCCEEDED',
      resolution: '720p',
      duration: 5,
      fps: 24,
      seed: 123,
    });
    assert.deepEqual(output.artifacts.map((artifact) => artifact.kind), ['video', 'image']);
  });

  it('adapts LLM text results without requiring URLs', () => {
    const output = adaptTaskResult({
      resultData: {
        content: '分镜脚本内容',
        model: 'qwen',
        usage: { totalTokens: 12 },
      },
    });

    assert.deepEqual(output.resultUrls, []);
    assert.deepEqual(output.textArtifacts, [{ name: 'content', text: '分镜脚本内容' }]);
    assert.deepEqual(output.result, {
      type: 'text',
      content: '分镜脚本内容',
      model: 'qwen',
      usage: { totalTokens: 12 },
    });
  });

  it('adapts audio URL and asset results', () => {
    const audioOutput = adaptTaskResult({
      resultData: {
        url: 'https://cdn.example.com/soundtrack.mp3',
        audioInfo: { duration: 4.2 },
        success: true,
      },
    });

    assert.deepEqual(audioOutput.result, {
      type: 'audio',
      urls: ['https://cdn.example.com/soundtrack.mp3'],
      audioInfo: { duration: 4.2 },
      success: true,
    });

    const assetOutput = adaptTaskResult({
      resultData: {
        assetUri: 'Asset://asset-abc',
        providerAssetId: 'asset-abc',
        providerUrl: 'https://cdn.example.com/ref.png',
        status: 'ready',
      },
    });

    assert.deepEqual(assetOutput.assetRefs, ['Asset://asset-abc']);
    assert.deepEqual(assetOutput.result, {
      type: 'asset',
      refs: ['Asset://asset-abc'],
      providerAssetId: 'asset-abc',
      assetUri: 'Asset://asset-abc',
      providerUrl: 'https://cdn.example.com/ref.png',
      status: 'ready',
    });
  });

  it('parses JSON string resultData and keeps unknown data as structured result', () => {
    const output = adaptTaskResult({
      resultData: '{"result":"ok","score":0.8}',
    });

    assert.deepEqual(output.result, {
      type: 'data',
      data: { result: 'ok', score: 0.8 },
    });
  });
});
