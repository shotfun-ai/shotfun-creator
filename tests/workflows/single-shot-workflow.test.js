// 覆盖 single-shot 工作流的计划生成、dry-run、resume 和失败路径。
import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  WORKFLOW_VERSION,
  buildSingleShotPlan,
  runSingleShotWorkflow,
} from '../../scripts/workflows/single-shot-workflow.js';

const tempDirs = [];
const originalCostThreshold = process.env.SHOTFUN_CONFIRM_COST_ABOVE;

describe('single-shot workflow', () => {
  afterEach(async () => {
    restoreEnv('SHOTFUN_CONFIRM_COST_ABOVE', originalCostThreshold);
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('writes a dry-run manifest and planned step sidecars', async () => {
    const outputDir = await makeTempDir();

    const result = await runSingleShotWorkflow({
      projectCode: 'demo',
      prompt: 'A neon lake at sunrise',
      dryRun: true,
      runId: 'run-001',
      outputDir,
    });

    assert.equal(result.ok, true);
    assert.equal(result.dryRun, true);
    assert.equal(result.plan.steps.length, 2);
    assert.equal(result.projectName, 'default');
    assert.equal(result.projectSlug, 'default');
    assert.equal(result.outputDir, path.join(outputDir, 'projects', 'default', 'runs', 'run-001'));
    assert.equal(result.manifest, path.join(outputDir, 'projects', 'default', 'runs', 'run-001', 'manifest.json'));
    assert.deepEqual(result.userArtifacts, []);

    const runDir = path.join(outputDir, 'projects', 'default', 'runs', 'run-001');
    const manifest = await readJson(path.join(runDir, 'manifest.json'));
    const imageStep = await readJson(path.join(runDir, 'steps', '01-image.json'));
    const videoStep = await readJson(path.join(runDir, 'steps', '02-video.json'));

    assert.equal(manifest.status, 'dry-run');
    assert.equal(manifest.projectName, 'default');
    assert.equal(manifest.projectSlug, 'default');
    assert.equal(manifest.workflowVersion, WORKFLOW_VERSION);
    assert.equal(manifest.modelSelection.length, 2);
    assert.equal(manifest.modelSelection[0].selected, 'image.gpt_image2');
    assert.match(manifest.modelSelection[0].reason, /推荐值 10\/10/);
    assert.equal(imageStep.status, 'planned');
    assert.equal(imageStep.registryId, 'image.gpt_image2');
    assert.equal(imageStep.selection.selected, 'image.gpt_image2');
    assert.equal(imageStep.request.inputParams.prompt, 'A neon lake at sunrise');
    assert.equal(videoStep.registryId, 'video.sd2_fast_720p');
    assert.equal(videoStep.selection.selected, 'video.sd2_fast_720p');
    assert.deepEqual(videoStep.upstream, ['01-image']);
  });

  it('groups dry-run output under project name and writes project summaries', async () => {
    const outputDir = await makeTempDir();

    const result = await runSingleShotWorkflow({
      projectCode: 'demo',
      projectName: '雨夜短片',
      prompt: 'A rainy neon alley',
      dryRun: true,
      runId: 'run-project-001',
      outputDir,
    });

    const projectDir = path.join(outputDir, 'projects', '雨夜短片');
    assert.equal(result.projectName, '雨夜短片');
    assert.equal(result.projectSlug, '雨夜短片');
    assert.equal(result.outputDir, path.join(projectDir, 'runs', 'run-project-001'));

    const manifest = await readJson(path.join(result.outputDir, 'manifest.json'));
    const latest = await readJson(path.join(projectDir, 'latest.json'));
    const index = await readFile(path.join(projectDir, 'index.jsonl'), 'utf8');

    assert.equal(manifest.projectName, '雨夜短片');
    assert.equal(manifest.projectSlug, '雨夜短片');
    assert.equal(latest.runId, 'run-project-001');
    assert.match(index, /"runId":"run-project-001"/);
  });

  it('skips a matching successful image step when resuming', async () => {
    const outputDir = await makeTempDir();
    const plan = buildSingleShotPlan({
      projectCode: 'demo',
      prompt: 'A mountain temple',
      runId: 'run-002',
      outputDir,
    });
    const runDir = path.join(outputDir, 'projects', 'default', 'runs', 'run-002');
    await runSingleShotWorkflow({
      projectCode: 'demo',
      prompt: 'A mountain temple',
      dryRun: true,
      runId: 'run-002',
      outputDir,
    });
    await writeJson(path.join(runDir, 'steps', '01-image.json'), {
      ok: true,
      status: 'success',
      stepId: '01-image',
      name: 'image',
      registryId: 'image.gpt_image2_cheap_api',
      resultUrls: ['https://cdn.example.com/mountain.png'],
      inputHash: plan.steps[0].inputHash,
      registryVersion: plan.registryVersion,
      workflowVersion: plan.workflowVersion,
      serviceVersion: plan.steps[0].serviceVersion,
    });

    let imageCalls = 0;
    let videoInput;
    const result = await runSingleShotWorkflow(
      {
        projectCode: 'demo',
        prompt: 'A mountain temple',
        resumeRunId: 'run-002',
        outputDir,
        confirm: true,
      },
      {
        generateImage: async () => {
          imageCalls += 1;
          throw new Error('image step should have been skipped');
        },
        generateVideo: async (options) => {
          videoInput = options;
          return {
            ok: true,
            status: 'success',
            resultUrls: ['https://cdn.example.com/mountain.mp4'],
            taskNo: 'task-video-001',
          };
        },
      },
    );

    assert.equal(imageCalls, 0);
    assert.deepEqual(videoInput.imageUrls, ['https://cdn.example.com/mountain.png']);
    assert.equal(result.ok, true);
    assert.equal(result.userArtifacts.length, 2);
    assert.equal(result.userArtifacts[0].kind, 'image');
    assert.equal(result.userArtifacts[1].kind, 'video');
    assert.equal(result.resultUrls, undefined);
  });

  it('refuses resume when the workflow version changed', async () => {
    const outputDir = await makeTempDir();
    const runDir = path.join(outputDir, 'projects', 'default', 'runs', 'run-003');
    await writeJson(path.join(runDir, 'manifest.json'), {
      runId: 'run-003',
      runSpecHash: 'any',
      registryVersion: '2026.05.14',
      workflowVersion: '1900.01.01',
    });

    await assert.rejects(
      () =>
        runSingleShotWorkflow({
          projectCode: 'demo',
          prompt: 'A city street',
          resumeRunId: 'run-003',
          outputDir,
          forceResume: true,
        }),
      /Workflow version changed/,
    );
  });

  it('does not require cost confirmation for dry-run planning', async () => {
    process.env.SHOTFUN_CONFIRM_COST_ABOVE = '-1';
    const outputDir = await makeTempDir();

    const result = await runSingleShotWorkflow({
      projectCode: 'demo',
      prompt: 'A rainy alley',
      dryRun: true,
      runId: 'run-004',
      outputDir,
    });

    assert.equal(result.ok, true);
    assert.equal(result.dryRun, true);
  });

  it('rejects fetchRemote until remote downloading is implemented', async () => {
    await assert.rejects(
      () =>
        runSingleShotWorkflow({
          projectCode: 'demo',
          prompt: 'A rainy alley',
          fetchRemote: true,
        }),
      /--fetch-remote is not implemented/,
    );
  });
});

async function makeTempDir() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'shotfun-single-shot-'));
  tempDirs.push(dir);
  return dir;
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function writeJson(filePath, payload) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function restoreEnv(name, value) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
