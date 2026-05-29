#!/usr/bin/env node
/**
 * 工作流 CLI：解析通用工作流参数并路由到具体工作流实现。
 */
import process from 'node:process';

import { ShotFunOpenApiError } from '../core/api-client.js';
import { parseBoolean, parseJson, parseNumber, takeOption, writeJson } from '../core/shotfun-service.js';
import { runNewsBroadcastVideoWorkflow } from '../workflows/news-broadcast-video-workflow.js';
import { runSingleShotWorkflow } from '../workflows/single-shot-workflow.js';

function printUsage() {
  console.log(`ShotFun workflow runner

Usage:
  node run-workflow.js --workflow single-shot --prompt <text> [options]
  node run-workflow.js --workflow news-broadcast-video --input-file <json> [options]

Options:
  --workflow <name>           single-shot or news-broadcast-video. Default: single-shot.
  --prompt <text>             User goal or shot prompt.
  --project-code <name>       ShotFun project name passed as OpenAPI projectCode. Default: default.
  --project-name <name>       Local project folder name for grouping multiple runs.
  --project-slug <slug>       Optional local project folder slug.
  --run-id <id>               Create or dry-run with a fixed run id.
  --resume <run-id>           Resume an existing run id.
  --force-resume              Allow changed input or registry version. Workflow version changes still fail.
  --confirm                   Allow execution when estimated cost exceeds threshold.
  --dry-run                   Write manifest and planned sidecars without calling API.
  --output-dir <path>         Overrides SHOTFUN_OUTPUT_DIR for this run.
  --fetch-remote              Reserved; currently rejected because downloads are not implemented.
  --keep-raw                  Create raw response directory when future raw persistence is enabled.

News broadcast video options:
  --prompt <text>             Natural-language broadcast brief. The workflow turns it into structured input.
  --input-file <path>         Optional. Advanced structured broadcast input JSON.
  --allow-historical-input    Allow --input-file to point inside shotfun-output after explicit user reuse approval.
  --render                    Render the generated HyperFrames project to MP4.
  --no-draft                  Use standard render quality instead of draft.
  --use-shotfun-tts           Generate narration through ShotFun TTS before writing HyperFrames.
  --confirmation-plan-only    Stop after writing the confirmation plan and decision packet.
  --approve-confirmation-plan Mark the confirmation plan gate as approved and continue.
  --approve-audience-and-style Mark audience and visual style as approved.
  --approve-story-plan       Mark story objectives and visual grammar choices as approved.
  --approve-tts-preview       Mark the TTS preview gate as approved and continue.
  --approve-narration-audio   Mark the full synthesized narration audio as approved.
  --approve-bgm-style         Mark BGM style direction as approved.
  --approve-visual-prompt-plan Mark GPT image prompts as approved before generation.
  --approve-bgm-preview       Mark the BGM preview gate as approved and continue.
  --approve-story-visuals     Mark generated story visuals as approved and continue.
  --approve-hyperframes-project Mark the HyperFrames project gate as approved and continue.
  --audience-profile <text>   Audience assumption to confirm. Default: beginner/general.
  --visual-style-preset <id>  Visual style preset. Default: impeccable-editorial-broadcast.
  --visual-style-note <text>  Look and feel details to confirm.
  --visual-grammar-library <path> JSON visual grammar library to choose from.
  --bgm-style <text>          BGM style recommendation to confirm.
  --generate-story-visuals     Generate per-story GPT image plates when stories lack visuals. Default: on.
  --no-generate-story-visuals  Disable generated story plates and require supplied story visuals.
  --visual-model <name>        Story visual generation model. Default: gpt-image2.
  --visual-aspect-ratio <r>    Story visual aspect ratio. Default: 3:4.
  --visual-resolution <value>  Story visual resolution. Default: 2K.
  --visual-timeout-ms <n>      Story visual task wait timeout. Default: 300000.
  --voice-platform <name>     Voice catalog platform. Default: minimax.
  --voice-name <name>         Voice catalog display name. Default: 播报男声.
  --voice-id <id>             Exact voice id from the catalog.
  --width <n>                 Composition width. Default: 1080.
  --height <n>                Composition height. Default: 1920.
  --fps <n>                   Composition fps metadata. Default: 30.

Single-shot options:
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
  let result;
  if (options.workflow === 'single-shot') result = await runSingleShotWorkflow(options);
  else if (options.workflow === 'news-broadcast-video') result = await runNewsBroadcastVideoWorkflow(options);
  else throw new ShotFunOpenApiError(`Unknown workflow: ${options.workflow}`);
  writeJson(result);
}

/**
 * 将工作流 CLI 参数转换为 single-shot 工作流 options。
 */
function parseArgs(args) {
  const options = {
    workflow: 'single-shot',
    imageUrls: [],
    imageRefs: [],
    imageFiles: [],
    imageInput: {},
    videoInput: {},
    dryRun: false,
    confirm: false,
    forceResume: false,
    generateAudio: false,
    render: false,
    draft: true,
    help: false,
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--confirm') options.confirm = true;
    else if (arg === '--force-resume') options.forceResume = true;
    else if (arg === '--fetch-remote') options.fetchRemote = true;
    else if (arg === '--keep-raw') options.keepRaw = true;
    else if (arg === '--generate-audio') options.generateAudio = true;
    else if (arg === '--render') options.render = true;
    else if (arg === '--no-draft') options.draft = false;
    else if (arg === '--allow-historical-input') options.allowHistoricalInput = true;
    else if (arg === '--use-shotfun-tts') options.useShotfunTts = true;
    else if (arg === '--confirmation-plan-only') options.confirmationPlanOnly = true;
    else if (arg === '--approve-confirmation-plan') options.approveConfirmationPlan = true;
    else if (arg === '--approve-audience-and-style') options.approveAudienceAndStyle = true;
    else if (arg === '--approve-story-plan') options.approveStoryPlan = true;
    else if (arg === '--approve-tts-preview') options.approveTtsPreview = true;
    else if (arg === '--approve-narration-audio') options.approveNarrationAudio = true;
    else if (arg === '--approve-bgm-style') options.approveBgmStyle = true;
    else if (arg === '--approve-visual-prompt-plan') options.approveVisualPromptPlan = true;
    else if (arg === '--approve-bgm-preview') options.approveBgmPreview = true;
    else if (arg === '--approve-story-visuals') options.approveStoryVisuals = true;
    else if (arg === '--approve-hyperframes-project') options.approveHyperframesProject = true;
    else if (arg === '--audience-profile') options.audienceProfile = takeOption(args, i++, arg);
    else if (arg === '--visual-style-preset') options.visualStylePreset = takeOption(args, i++, arg);
    else if (arg === '--visual-style-note') options.visualStyleNote = takeOption(args, i++, arg);
    else if (arg === '--visual-grammar-library') options.visualGrammarLibraryFile = takeOption(args, i++, arg);
    else if (arg === '--bgm-style') options.bgmStyle = takeOption(args, i++, arg);
    else if (arg === '--generate-story-visuals') options.generateStoryVisuals = true;
    else if (arg === '--no-generate-story-visuals') options.generateStoryVisuals = false;
    else if (arg === '--visual-model') options.visualModel = takeOption(args, i++, arg);
    else if (arg === '--visual-aspect-ratio') options.visualAspectRatio = takeOption(args, i++, arg);
    else if (arg === '--visual-resolution') options.visualResolution = takeOption(args, i++, arg);
    else if (arg === '--visual-timeout-ms') options.visualTimeoutMs = parseNumber(takeOption(args, i++, arg), arg);
    else if (arg === '--workflow') options.workflow = takeOption(args, i++, arg);
    else if (arg === '--prompt') options.prompt = takeOption(args, i++, arg);
    else if (arg === '--input-file') options.inputFile = takeOption(args, i++, arg);
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
    else if (arg === '--width') options.width = parseNumber(takeOption(args, i++, arg), arg);
    else if (arg === '--height') options.height = parseNumber(takeOption(args, i++, arg), arg);
    else if (arg === '--fps') options.fps = parseNumber(takeOption(args, i++, arg), arg);
    else if (arg === '--voice-platform') options.voicePlatform = takeOption(args, i++, arg);
    else if (arg === '--voice-name') options.voiceName = takeOption(args, i++, arg);
    else if (arg === '--voice-id') options.voiceId = takeOption(args, i++, arg);
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
