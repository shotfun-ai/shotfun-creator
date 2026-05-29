// 覆盖输出路径规划、项目索引写入和目录回退逻辑。
import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  buildOutputPaths,
  DEFAULT_PROJECT_NAME,
  ensureRunDirectories,
  generateRunId,
  normalizeProjectSlug,
  SKILL_ROOT_DIR,
  writeProjectRunSummary,
} from '../../scripts/core/output-paths.js';

const originalOutputDir = process.env.SHOTFUN_OUTPUT_DIR;
const originalProjectName = process.env.SHOTFUN_PROJECT_NAME;
const tempDirs = [];

describe('output paths', () => {
  afterEach(async () => {
    restoreEnv('SHOTFUN_OUTPUT_DIR', originalOutputDir);
    restoreEnv('SHOTFUN_PROJECT_NAME', originalProjectName);
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('generates sortable run ids with an eight character suffix', () => {
    assert.match(generateRunId(new Date('2026-05-14T03:12:11Z')), /^20260514-031211-[a-f0-9]{8}$/);
  });

  it('uses SHOTFUN_OUTPUT_DIR when provided', () => {
    process.env.SHOTFUN_OUTPUT_DIR = path.join(os.tmpdir(), 'shotfun-custom-output');

    const paths = buildOutputPaths({ runId: 'run-001', cwd: '/workspace' });

    assert.equal(paths.projectName, DEFAULT_PROJECT_NAME);
    assert.equal(paths.projectSlug, DEFAULT_PROJECT_NAME);
    assert.equal(paths.runDir, path.join(os.tmpdir(), 'shotfun-custom-output', 'projects', DEFAULT_PROJECT_NAME, 'runs', 'run-001'));
    assert.equal(paths.manifestPath, path.join(paths.runDir, 'manifest.json'));
    assert.equal(paths.logsDir, path.join(paths.runDir, 'logs'));
    assert.equal(paths.stepsDir, path.join(paths.runDir, 'steps'));
  });

  it('uses the SKILL.md sibling shotfun-output when no env override exists', () => {
    delete process.env.SHOTFUN_OUTPUT_DIR;

    const paths = buildOutputPaths({ runId: 'run-002', cwd: '/workspace' });

    assert.equal(paths.projectName, DEFAULT_PROJECT_NAME);
    assert.equal(paths.projectDir, path.join(SKILL_ROOT_DIR, 'shotfun-output', 'projects', 'default'));
    assert.equal(paths.runDir, path.join(SKILL_ROOT_DIR, 'shotfun-output', 'projects', 'default', 'runs', 'run-002'));
  });

  it('uses SHOTFUN_PROJECT_NAME when no project name is provided', () => {
    process.env.SHOTFUN_PROJECT_NAME = 'Env Project';
    delete process.env.SHOTFUN_OUTPUT_DIR;

    const paths = buildOutputPaths({ runId: 'run-env', cwd: '/workspace' });

    assert.equal(paths.projectName, 'Env Project');
    assert.equal(paths.projectSlug, 'env-project');
    assert.equal(paths.runDir, path.join(SKILL_ROOT_DIR, 'shotfun-output', 'projects', 'env-project', 'runs', 'run-env'));
  });

  it('groups runs under a local project directory', () => {
    delete process.env.SHOTFUN_OUTPUT_DIR;

    const paths = buildOutputPaths({
      runId: 'run-004',
      cwd: '/workspace',
      projectName: '雨夜 短片',
    });

    assert.equal(paths.projectName, '雨夜 短片');
    assert.equal(paths.projectSlug, '雨夜-短片');
    assert.equal(paths.projectDir, path.join(SKILL_ROOT_DIR, 'shotfun-output', 'projects', '雨夜-短片'));
    assert.equal(paths.runDir, path.join(SKILL_ROOT_DIR, 'shotfun-output', 'projects', '雨夜-短片', 'runs', 'run-004'));
    assert.equal(paths.projectIndexPath, path.join(SKILL_ROOT_DIR, 'shotfun-output', 'projects', '雨夜-短片', 'index.jsonl'));
    assert.equal(paths.projectLatestPath, path.join(SKILL_ROOT_DIR, 'shotfun-output', 'projects', '雨夜-短片', 'latest.json'));
  });

  it('normalizes project slugs conservatively', () => {
    assert.equal(normalizeProjectSlug(' Product Launch! 2026 '), 'product-launch-2026');
    assert.match(normalizeProjectSlug('!!!'), /^project-[a-f0-9]{8}$/);
  });

  it('writes project summary files for grouped runs', async () => {
    const outputDir = await makeTempDir('shotfun-project-output-');
    const paths = buildOutputPaths({
      runId: 'run-005',
      outputDir,
      projectName: 'Launch',
    });
    await ensureRunDirectories(paths);

    await writeProjectRunSummary(paths, {
      ok: true,
      status: 'success',
      runId: 'run-005',
      prompt: 'A product shot',
      userArtifacts: [{ kind: 'video', url: 'https://example.com/a.mp4' }],
      createdAt: '2026-05-14T00:00:00.000Z',
    });

    const project = JSON.parse(await readFile(paths.projectMetaPath, 'utf8'));
    const latest = JSON.parse(await readFile(paths.projectLatestPath, 'utf8'));
    const indexLine = (await readFile(paths.projectIndexPath, 'utf8')).trim();

    assert.equal(project.projectName, 'Launch');
    assert.equal(project.projectSlug, 'launch');
    assert.equal(latest.runId, 'run-005');
    assert.match(indexLine, /"runId":"run-005"/);
  });

  it('uses the home fallback output directory when default output is unavailable', async () => {
    delete process.env.SHOTFUN_OUTPUT_DIR;
    const fallback = await makeTempDir('shotfun-output-fallback-');

    const paths = buildOutputPaths({
      runId: 'run-003',
      defaultOutputDir: await makeTempFile('shotfun-output-blocked-'),
      fallbackOutputDir: fallback,
    });
    const prepared = await ensureRunDirectories(paths);

    assert.equal(prepared.projectName, DEFAULT_PROJECT_NAME);
    assert.equal(prepared.runDir, path.join(fallback, 'projects', DEFAULT_PROJECT_NAME, 'runs', 'run-003'));
  });
});

async function makeTempDir(prefix) {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function makeTempFile(prefix) {
  const dir = await makeTempDir(prefix);
  const file = path.join(dir, 'blocked');
  await writeFile(file, 'not a directory');
  return file;
}

function restoreEnv(name, value) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
