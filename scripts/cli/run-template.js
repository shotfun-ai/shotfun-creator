#!/usr/bin/env node
/**
 * 低层通用任务 CLI：直接提交任意 taskCode，供没有专用 service 的能力兜底使用。
 */
import process from 'node:process';

import { ShotFunOpenApiClient, ShotFunOpenApiError, extractResultUrls, extractTaskNo } from '../core/api-client.js';
import { resolveProjectCode } from '../core/shotfun-service.js';

function printUsage() {
  console.log(`ShotFun JS OpenAPI skill template

Usage:
  node run-template.js --project-code <project-name> --task-code <code> [options]

Options:
  --project-code <name>       ShotFun project name passed as OpenAPI projectCode. Default: default.
  --task-code <code>          ShotFun taskCode, for example sd_reference.
  --prompt <text>             Convenience field merged into inputParams.prompt.
  --input <json>              JSON object used as inputParams.
  --file <path>               Upload local file before task creation.
  --file-param <name>         Input param that receives uploaded URL. Default: imageUrls.
  --upload-path <path>        Optional OpenAPI upload path field.
  --wait                      Poll /task/query/{taskNo} until a terminal status.
  --dry-run                   Print the request payload without calling the API.
  --help                      Show this help.

Environment:
  SHOTFUN_API_KEY             Required unless --dry-run is used.
  SHOTFUN_TIMEOUT_MS          Default: 300000
  SHOTFUN_POLL_INTERVAL_MS    Default: 3000

Examples:
  node run-template.js --project-code demo --task-code sd_reference --prompt "A lake" --dry-run
  node run-template.js --project-code demo --task-code sd_reference --input '{"prompt":"A lake"}' --wait
  node run-template.js --project-code demo --task-code runninghub_nanobanana_2 --file ./input.png --prompt "Edit this image"
`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printUsage();
    return;
  }

  const projectCode = resolveProjectCode(options.projectCode);
  if (!options.taskCode) throw new ShotFunOpenApiError('Missing required --task-code option.');

  const inputParams = { ...options.input };
  if (options.prompt) inputParams.prompt = options.prompt;

  if (options.dryRun) {
    writeJson({
      ok: true,
      dryRun: true,
      upload: options.file ? { file: options.file, path: options.uploadPath, fileParam: options.fileParam } : undefined,
      task: {
        projectCode,
        taskCode: options.taskCode,
        inputParams,
      },
      wait: options.wait,
    });
    return;
  }

  const client = new ShotFunOpenApiClient();

  if (options.file) {
    const file = await client.uploadFile(options.file, { path: options.uploadPath });
    mergeUploadedFile(inputParams, options.fileParam, file);
  }

  const taskRequest = {
    projectCode,
    taskCode: options.taskCode,
    inputParams,
  };

  const createdTask = options.wait ? await client.createTaskAndWait(taskRequest) : await client.createTask(taskRequest);
  const taskNo = extractTaskNo(createdTask);

  writeJson({
    ok: true,
    taskNo,
    task: createdTask,
    resultUrls: extractResultUrls(createdTask),
  });
}

function parseArgs(args) {
  const options = {
    fileParam: 'imageUrls',
    input: {},
    dryRun: false,
    help: false,
    wait: false,
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--wait') {
      options.wait = true;
    } else if (arg === '--project-code' && args[i + 1]) {
      options.projectCode = args[++i];
    } else if (arg === '--task-code' && args[i + 1]) {
      options.taskCode = args[++i];
    } else if (arg === '--prompt' && args[i + 1]) {
      options.prompt = args[++i];
    } else if (arg === '--input' && args[i + 1]) {
      options.input = parseJson(args[++i], '--input');
    } else if (arg === '--file' && args[i + 1]) {
      options.file = args[++i];
    } else if (arg === '--file-param' && args[i + 1]) {
      options.fileParam = args[++i];
    } else if (arg === '--upload-path' && args[i + 1]) {
      options.uploadPath = args[++i];
    } else {
      throw new ShotFunOpenApiError(`Unknown or incomplete option: ${arg}`);
    }
  }

  return options;
}

function mergeUploadedFile(inputParams, fileParam, file) {
  const url = file?.url;
  if (!url) throw new ShotFunOpenApiError('Upload response did not include data.url.', file);

  if (fileParam.endsWith('Urls')) {
    const existing = inputParams[fileParam];
    inputParams[fileParam] = Array.isArray(existing) ? [...existing, url] : [url];
  } else {
    inputParams[fileParam] = url;
  }
}

function parseJson(value, label) {
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('expected object');
    }
    return parsed;
  } catch (error) {
    throw new ShotFunOpenApiError(`${label} must be a JSON object: ${error.message}`);
  }
}

function writeJson(payload) {
  console.log(JSON.stringify(payload, null, 2));
}

main().catch((error) => {
  const payload = {
    ok: false,
    error: error.message,
  };
  if (error.details) payload.details = error.details;
  console.error(JSON.stringify(payload, null, 2));
  process.exit(1);
});
