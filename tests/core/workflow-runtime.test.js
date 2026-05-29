// 覆盖工作流运行时的成本、日志、产物归一化和敏感 URL 清理。
import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  buildUserArtifacts,
  createLimiter,
  estimateCost,
  hashInputs,
  jsonlLogger,
  persistText,
  sanitizeUrl,
  writeManifest,
  writeStep,
} from '../../scripts/core/workflow-runtime.js';

const tempDirs = [];

describe('workflow runtime', () => {
  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('hashes inputs deterministically independent of object key order', () => {
    assert.equal(hashInputs({ b: 2, a: 1 }), hashInputs({ a: 1, b: 2 }));
  });

  it('estimates costs from registry ids and counts', () => {
    const cost = estimateCost([
      { registryId: 'image.nano2', count: 2 },
      { registryId: 'audio.tts_single_voice' },
    ]);

    assert.equal(cost.currency, 'credits');
    assert.equal(cost.items.length, 2);
    assert.equal(cost.estimated, 2 * cost.items[0].pricePerCall + cost.items[1].pricePerCall);
  });

  it('limits concurrent work', async () => {
    const limit = createLimiter(2);
    let active = 0;
    let maxActive = 0;

    await Promise.all(
      Array.from({ length: 6 }, (_, index) =>
        limit(async () => {
          active += 1;
          maxActive = Math.max(maxActive, active);
          await new Promise((resolve) => setTimeout(resolve, 5));
          active -= 1;
          return index;
        }),
      ),
    );

    assert.equal(maxActive, 2);
  });

  it('writes manifest, step sidecars, logs, and text artifacts under the run directory', async () => {
    const runDir = await makeTempDir();

    await writeManifest(runDir, { ok: true, runId: 'run-001' });
    await writeStep(runDir, '01-storyboard', { ok: true, resultUrls: ['https://cdn.example.com/a.png'] });
    await persistText({ runDir, stepId: '01', name: 'storyboard', content: { title: 'Scene' }, ext: 'json' });
    const logger = jsonlLogger(runDir);
    await logger.write({ event: 'step_end', details: 'x'.repeat(5000) });

    const manifest = JSON.parse(await readFile(path.join(runDir, 'manifest.json'), 'utf8'));
    const step = JSON.parse(await readFile(path.join(runDir, 'steps', '01-storyboard.json'), 'utf8'));
    const text = JSON.parse(await readFile(path.join(runDir, 'texts', '01-storyboard.json'), 'utf8'));
    const logLine = JSON.parse((await readFile(path.join(runDir, 'logs', 'run.jsonl'), 'utf8')).trim());

    assert.equal(manifest.runId, 'run-001');
    assert.equal(step.resultUrls[0], 'https://cdn.example.com/a.png');
    assert.equal(text.title, 'Scene');
    assert.equal(logLine.details_truncated, true);
  });

  it('builds user artifacts from sidecars without exposing internal task details', () => {
    const artifacts = buildUserArtifacts([
      {
        stepId: '02',
        name: 'character',
        resultUrls: ['https://cdn.example.com/hero.png?X-Amz-Signature=secret&Expires=999'],
        localFiles: [{ path: '/tmp/hero.png', kind: 'image' }],
        assetRefs: ['Asset://asset-001'],
        task: { secret: true },
      },
      {
        stepId: '01',
        name: 'storyboard',
        textArtifacts: [{ path: '/tmp/storyboard.json', name: 'storyboard' }],
      },
    ]);

    assert.deepEqual(
      artifacts.map((artifact) => [artifact.kind, artifact.name, artifact.localPath ?? artifact.url]),
      [
        ['image', 'character', '/tmp/hero.png'],
        ['asset_ref', 'character', 'Asset://asset-001'],
        ['text', 'storyboard', '/tmp/storyboard.json'],
      ],
    );
    assert.equal(Object.hasOwn(artifacts[0], 'task'), false);
    assert.equal(artifacts[0].signed, true);
  });

  it('sanitizes signed URL query parameters for shareable manifests', () => {
    assert.equal(
      sanitizeUrl('https://cdn.example.com/a.png?X-Amz-Signature=secret&token=abc&width=1024'),
      'https://cdn.example.com/a.png?width=1024',
    );
  });
});

async function makeTempDir() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'shotfun-runtime-'));
  tempDirs.push(dir);
  return dir;
}
