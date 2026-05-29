#!/usr/bin/env node
/**
 * 一句话生成图片和视频的快捷 CLI，底层复用 single-shot 工作流。
 */
import process from 'node:process';

import { ShotFunOpenApiError } from '../core/api-client.js';
import { parseBoolean, parseJson, parseNumber, takeOption, writeJson } from '../core/shotfun-service.js';
import { runSingleShotWorkflow } from '../workflows/single-shot-workflow.js';

function printUsage() {
  console.log(`ShotFun one-shot image + video

Usage:
  node one-shot.js --prompt <text> [options]

Options:
  --prompt <text>             One-sentence visual direction. Generates image, then video.
  --project-code <name>       ShotFun project name passed as OpenAPI projectCode. Default: default.
  --project-name <name>       Local project folder name for grouping multiple runs.
  --project-slug <slug>       Optional local project folder slug.
  --dry-run                   Plan without calling API.
  --confirm                   Allow execution when estimated cost exceeds threshold.
  --run-id <id>               Create or dry-run with a fixed run id.
  --resume <run-id>           Resume an existing run id.
  --force-resume              Allow changed input or registry version. Workflow version changes still fail.
  --output-dir <path>         Overrides SHOTFUN_OUTPUT_DIR for this run.
  --image-url <url>           Existing image URL. Can be repeated; skips image generation.
  --image-ref <ref>           Existing Asset:// reference. Can be repeated.
  --image-file <path>         Upload local image for video generation. Can be repeated.
  --image-model <name>        Default: auto.
  --video-model <name>        Default: auto.
  --budget <value>            low, balanced, quality. Default: balanced.
  --image-scenario <text>     Override image model selection scenario.
  --video-scenario <text>     Override video model selection scenario.
  --image-prompt <text>       Override image prompt.
  --video-prompt <text>       Override video prompt.
  --negative-prompt <text>    Negative prompt for image generation.
  --asset-mode <mode>         none, asset, direct-url. Default: none.
  --aspect-ratio <ratio>      Default: 16:9.
  --image-resolution <value>  Default: 2K.
  --video-resolution <value>  Default: 720p.
  --duration-seconds <n>      Default: 5.
  --generate-audio            Set generateAudio=true for video task.
  --generate-audio-value <b>  Explicit boolean for generateAudio.
  --image-input <json>        Extra image service options merged into inputParams.
  --video-input <json>        Extra video service options merged into inputParams.
`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) return printUsage();
  const result = await runSingleShotWorkflow(options);
  writeJson(result);
}

/**
 * 将 one-shot CLI 参数转换为工作流 options。
 */
function parseArgs(args) {
  const options = {
    imageUrls: [],
    imageRefs: [],
    imageFiles: [],
    imageInput: {},
    videoInput: {},
    dryRun: false,
    confirm: false,
    forceResume: false,
    generateAudio: false,
    help: false,
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--confirm') options.confirm = true;
    else if (arg === '--force-resume') options.forceResume = true;
    else if (arg === '--generate-audio') options.generateAudio = true;
    else if (arg === '--prompt') options.prompt = takeOption(args, i++, arg);
    else if (arg === '--project-code') options.projectCode = takeOption(args, i++, arg);
    else if (arg === '--project-name') options.projectName = takeOption(args, i++, arg);
    else if (arg === '--project-slug') options.projectSlug = takeOption(args, i++, arg);
    else if (arg === '--run-id') options.runId = takeOption(args, i++, arg);
    else if (arg === '--resume') options.resumeRunId = takeOption(args, i++, arg);
    else if (arg === '--output-dir') options.outputDir = takeOption(args, i++, arg);
    else if (arg === '--image-url') options.imageUrls.push(takeOption(args, i++, arg));
    else if (arg === '--image-ref') options.imageRefs.push(takeOption(args, i++, arg));
    else if (arg === '--image-file') options.imageFiles.push(takeOption(args, i++, arg));
    else if (arg === '--image-model') options.imageModel = takeOption(args, i++, arg);
    else if (arg === '--video-model') options.videoModel = takeOption(args, i++, arg);
    else if (arg === '--budget') options.budget = takeOption(args, i++, arg);
    else if (arg === '--image-scenario') options.imageScenario = takeOption(args, i++, arg);
    else if (arg === '--video-scenario') options.videoScenario = takeOption(args, i++, arg);
    else if (arg === '--image-prompt') options.imagePrompt = takeOption(args, i++, arg);
    else if (arg === '--video-prompt') options.videoPrompt = takeOption(args, i++, arg);
    else if (arg === '--negative-prompt') options.negativePrompt = takeOption(args, i++, arg);
    else if (arg === '--asset-mode') options.assetMode = takeOption(args, i++, arg);
    else if (arg === '--aspect-ratio') options.aspectRatio = takeOption(args, i++, arg);
    else if (arg === '--image-resolution') options.imageResolution = takeOption(args, i++, arg);
    else if (arg === '--video-resolution') options.videoResolution = takeOption(args, i++, arg);
    else if (arg === '--duration-seconds') options.durationSeconds = parseNumber(takeOption(args, i++, arg), arg);
    else if (arg === '--generate-audio-value') options.generateAudio = parseBoolean(takeOption(args, i++, arg));
    else if (arg === '--image-input') options.imageInput = parseJson(takeOption(args, i++, arg), arg);
    else if (arg === '--video-input') options.videoInput = parseJson(takeOption(args, i++, arg), arg);
    else throw new ShotFunOpenApiError(`Unknown option: ${arg}`);
  }

  return options;
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error.message, details: error.details }, null, 2));
  process.exit(1);
});
