import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  loadRuntimeEnvironment,
  parseEnvFile,
  parseExtendEnv,
  resetRuntimeEnvironmentForTest,
} from '../../scripts/core/env-loader.js';
import { ShotFunOpenApiClient } from '../../scripts/core/api-client.js';
import { buildOutputPaths, ensureRunDirectories } from '../../scripts/core/output-paths.js';
import { resolveProjectCode } from '../../scripts/core/shotfun-service.js';

const trackedEnv = [
  'SHOTFUN_API_KEY',
  'SHOTFUN_PROJECT_CODE',
  'SHOTFUN_TIMEOUT_MS',
  'SHOTFUN_POLL_INTERVAL_MS',
];
const originals = new Map(trackedEnv.map((name) => [name, process.env[name]]));
const tempDirs = [];

describe('runtime environment loader', () => {
  afterEach(async () => {
    resetRuntimeEnvironmentForTest();
    for (const name of trackedEnv) restoreEnv(name, originals.get(name));
    while (tempDirs.length) {
      await rm(tempDirs.pop(), { recursive: true, force: true });
    }
  });

  it('parses dotenv files with optional export and quotes', () => {
    assert.deepEqual(parseEnvFile('SHOTFUN_API_KEY=home\nexport SHOTFUN_TIMEOUT_MS="42"\n# ignored\nbad=value'), {
      SHOTFUN_API_KEY: 'home',
      SHOTFUN_TIMEOUT_MS: '42',
    });
  });

  it('parses EXTEND.md front matter env values', () => {
    const env = parseExtendEnv(`---
env:
  SHOTFUN_API_KEY: extend-key
  SHOTFUN_PROJECT_CODE: extend-project
SHOTFUN_TIMEOUT_MS: "9000"
---
# Extend
`);

    assert.deepEqual(env, {
      SHOTFUN_API_KEY: 'extend-key',
      SHOTFUN_PROJECT_CODE: 'extend-project',
      SHOTFUN_TIMEOUT_MS: '9000',
    });
  });

  it('loads home env, cwd env, process env, EXTEND.md, and .env.local in priority order', async () => {
    const home = await tempDir();
    const cwd = await tempDir();
    await mkdir(path.join(home, '.shotfun-agent'), { recursive: true });
    await mkdir(path.join(cwd, '.shotfun-agent'), { recursive: true });
    await writeFile(path.join(home, '.shotfun-agent', '.env'), 'SHOTFUN_API_KEY=home-key\nSHOTFUN_PROJECT_CODE=home-project\n');
    await writeFile(path.join(cwd, '.shotfun-agent', '.env'), 'SHOTFUN_API_KEY=cwd-key\nSHOTFUN_TIMEOUT_MS=1000\n');
    await writeFile(path.join(cwd, '.shotfun-agent', 'EXTEND.md'), `---
env:
  SHOTFUN_API_KEY: extend-key
  SHOTFUN_POLL_INTERVAL_MS: 250
---
`);
    await writeFile(path.join(cwd, '.env.local'), 'SHOTFUN_API_KEY=local-key\n');
    process.env.SHOTFUN_TIMEOUT_MS = '2000';

    loadRuntimeEnvironment({ cwd, home, force: true });

    assert.equal(process.env.SHOTFUN_API_KEY, 'local-key');
    assert.equal(process.env.SHOTFUN_PROJECT_CODE, 'home-project');
    assert.equal(process.env.SHOTFUN_TIMEOUT_MS, '2000');
    assert.equal(process.env.SHOTFUN_POLL_INTERVAL_MS, '250');
  });

  it('prefers cwd .env.local over process env for SHOTFUN_API_KEY', async () => {
    const home = await tempDir();
    const cwd = await tempDir();
    await writeFile(path.join(cwd, '.env.local'), 'SHOTFUN_API_KEY=local-file-key\n');
    process.env.SHOTFUN_API_KEY = 'process-key';

    loadRuntimeEnvironment({ cwd, home, force: true });

    assert.equal(process.env.SHOTFUN_API_KEY, 'local-file-key');
  });

  it('prefers cwd .env over home .env for the same key', async () => {
    const home = await tempDir();
    const cwd = await tempDir();
    delete process.env.SHOTFUN_API_KEY;
    await mkdir(path.join(home, '.shotfun-agent'), { recursive: true });
    await mkdir(path.join(cwd, '.shotfun-agent'), { recursive: true });
    await writeFile(path.join(home, '.shotfun-agent', '.env'), 'SHOTFUN_API_KEY=home-key\n');
    await writeFile(path.join(cwd, '.shotfun-agent', '.env'), 'SHOTFUN_API_KEY=cwd-key\n');

    loadRuntimeEnvironment({ cwd, home, force: true });

    assert.equal(process.env.SHOTFUN_API_KEY, 'cwd-key');
  });

  it('keeps explicit constructor options above loaded environment', async () => {
    const cwd = await tempDir();
    const home = await tempDir();
    await mkdir(path.join(cwd, '.shotfun-agent'), { recursive: true });
    await writeFile(path.join(cwd, '.shotfun-agent', '.env'), 'SHOTFUN_API_KEY=file-key\nSHOTFUN_TIMEOUT_MS=1000\n');

    loadRuntimeEnvironment({ cwd, home, force: true });
    const client = new ShotFunOpenApiClient({ apiKey: 'cli-key', timeoutMs: 3000 });

    assert.equal(client.apiKey, 'cli-key');
    assert.equal(client.timeoutMs, 3000);
  });

  it('uses SHOTFUN_PROJECT_CODE only when CLI project code is absent', () => {
    process.env.SHOTFUN_PROJECT_CODE = 'env-project';

    assert.equal(resolveProjectCode('cli-project'), 'cli-project');
    assert.equal(resolveProjectCode(undefined), 'env-project');
  });

  it('loads env-file output settings before resolving output path defaults', async () => {
    delete process.env.SHOTFUN_OUTPUT_DIR;
    delete process.env.SHOTFUN_PROJECT_NAME;
    const cwd = await tempDir();
    const home = await tempDir();
    const outputDir = path.join(cwd, 'configured-output');
    await mkdir(path.join(cwd, '.shotfun-agent'), { recursive: true });
    await writeFile(path.join(cwd, '.shotfun-agent', '.env'), `SHOTFUN_OUTPUT_DIR=${outputDir}\nSHOTFUN_PROJECT_NAME=Configured Project\n`);

    const paths = buildOutputPaths({ runId: 'env-output', cwd });

    assert.equal(paths.baseDir, outputDir);
    assert.equal(paths.projectName, 'Configured Project');
  });

  it('treats env-file output directory as explicit when directory creation fails', async () => {
    delete process.env.SHOTFUN_OUTPUT_DIR;
    const cwd = await tempDir();
    const home = await tempDir();
    const outputDir = path.join(cwd, 'not-a-directory');
    await writeFile(outputDir, 'file blocks directory creation');
    await mkdir(path.join(cwd, '.shotfun-agent'), { recursive: true });
    await writeFile(path.join(cwd, '.shotfun-agent', '.env'), `SHOTFUN_OUTPUT_DIR=${outputDir}\n`);

    const paths = buildOutputPaths({ runId: 'bad-output', cwd, fallbackOutputDir: path.join(cwd, 'fallback') });

    await assert.rejects(() => ensureRunDirectories(paths), { code: 'ENOTDIR' });
  });
});

async function tempDir() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'shotfun-env-'));
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
