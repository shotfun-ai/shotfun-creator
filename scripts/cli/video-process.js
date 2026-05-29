#!/usr/bin/env node
/**
 * 视频处理 CLI：从 capability-schema 派生参数解析与 --help。
 */
import process from 'node:process';

import { parseCliArgs, printCliUsage } from '../core/schema-runtime.js';
import { formatAgentTaskOutput, writeJson } from '../core/shotfun-service.js';
import { processVideo } from '../services/video-processing-service.js';

const CAPABILITY = 'video-processing';

async function main() {
  const { options, help } = parseCliArgs(CAPABILITY, process.argv.slice(2));
  if (help) {
    printCliUsage(CAPABILITY);
    return;
  }
  const result = await processVideo(options);
  writeJson(options.agentOutput ? formatAgentTaskOutput(result) : result);
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error.message, details: error.details }, null, 2));
  process.exit(1);
});
