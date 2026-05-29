// 覆盖共享 service 工具的参数解析和 Agent 输出格式。
import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { formatAgentTaskOutput, formatTaskOutput, runTask } from '../../scripts/core/shotfun-service.js';

const originalFetch = globalThis.fetch;
const originalOutputDir = process.env.SHOTFUN_OUTPUT_DIR;
const tempDirs = [];

describe('shotfun service helpers', () => {
  afterEach(async () => {
    globalThis.fetch = originalFetch;
    restoreEnv('SHOTFUN_OUTPUT_DIR', originalOutputDir);
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('formats single task output for agent consumption without raw task data', () => {
    const output = formatAgentTaskOutput({
      ok: true,
      taskNo: 'T-001',
      status: 'success',
      category: 'image',
      resultUrls: ['https://cdn.example.com/hero.png'],
      task: { raw: true },
    });

    assert.deepEqual(output, {
      ok: true,
      taskNo: 'T-001',
      status: 'success',
      category: 'image',
      userArtifacts: [
        {
          kind: 'image',
          name: 'image',
          url: 'https://cdn.example.com/hero.png',
        },
      ],
    });
    assert.equal(Object.hasOwn(output, 'task'), false);
  });

  it('formats Java DTO task result into unified fields', () => {
    const output = formatTaskOutput({
      taskNo: 'T-VID',
      status: 'success',
      resultData: {
        videoUrl: 'https://cdn.example.com/video.mp4',
        lastFrameUrl: 'https://cdn.example.com/last.png',
        resolution: '720p',
      },
    }, { category: 'video' });

    assert.deepEqual(output.resultUrls, [
      'https://cdn.example.com/video.mp4',
      'https://cdn.example.com/last.png',
    ]);
    assert.deepEqual(output.result, {
      type: 'video',
      urls: ['https://cdn.example.com/video.mp4'],
      lastFrameUrl: 'https://cdn.example.com/last.png',
      resolution: '720p',
    });
    assert.equal(output.category, 'video');
  });

  it('keeps text artifacts in agent output', () => {
    const output = formatAgentTaskOutput({
      ok: true,
      taskNo: 'T-TEXT',
      status: 'success',
      category: 'text',
      artifacts: [{ kind: 'text', name: 'content', text: '脚本文案' }],
    });

    assert.deepEqual(output.userArtifacts, [
      { kind: 'text', name: 'content', text: '脚本文案' },
    ]);
  });

  it('downloads media artifacts for waited tasks and exposes local paths', async () => {
    const outputDir = await tempDir();
    process.env.SHOTFUN_OUTPUT_DIR = outputDir;
    globalThis.fetch = async () => new Response(Buffer.from('png-bytes'), {
      status: 200,
      headers: { 'content-type': 'image/png' },
    });

    const result = await runTask({
      client: {
        createTaskAndWait: async () => ({
          taskNo: 'T-IMG',
          status: 'success',
          resultData: { imageUrl: 'https://cdn.example.com/hero.png' },
        }),
      },
      projectCode: 'demo',
      taskCode: 'image-task',
      inputParams: { prompt: 'hello' },
      wait: true,
      meta: { category: 'image', model: 'gpt-image2' },
    });

    assert.equal(result.localFiles.length, 1);
    assert.equal(result.artifacts[0].localPath, result.localFiles[0].path);
    assert.match(result.localFiles[0].path, /shotfun-output|projects|demo|runs|image-/);
    assert.equal(await readFile(result.localFiles[0].path, 'utf8'), 'png-bytes');

    const agentOutput = formatAgentTaskOutput(result);
    assert.equal(agentOutput.userArtifacts[0].url, 'https://cdn.example.com/hero.png');
    assert.equal(agentOutput.userArtifacts[0].localPath, result.localFiles[0].path);
  });
});

async function tempDir() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'shotfun-service-'));
  tempDirs.push(dir);
  return dir;
}

function restoreEnv(name, value) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
