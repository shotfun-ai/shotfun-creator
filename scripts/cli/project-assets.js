#!/usr/bin/env node
/**
 * 资产 CLI：从 capability-schema 派生参数解析与 --help。
 * 根据 --action 分发到 createAssetGroup / createAsset。
 */
import process from 'node:process';

import { ShotFunOpenApiError } from '../core/api-client.js';
import { parseCliArgs, printCliUsage } from '../core/schema-runtime.js';
import { writeJson } from '../core/shotfun-service.js';
import { createAsset, createAssetGroup } from '../services/asset-service.js';

const CAPABILITY = 'asset';

async function main() {
  const { options, help } = parseCliArgs(CAPABILITY, process.argv.slice(2));
  if (help) {
    printCliUsage(CAPABILITY);
    return;
  }
  let result;
  if (options.action === 'asset-group-create') {
    result = await createAssetGroup(options);
  } else if (options.action === 'asset-create') {
    result = await createAsset(options);
  } else {
    throw new ShotFunOpenApiError(`Unknown asset action: ${options.action}`);
  }
  writeJson(result);
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error.message, details: error.details }, null, 2));
  process.exit(1);
});
