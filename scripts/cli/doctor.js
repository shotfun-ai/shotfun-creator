#!/usr/bin/env node
/**
 * 本地诊断 CLI：检查 Node 版本、环境变量和输出路径。
 */
import process from 'node:process';

import { loadRuntimeEnvironment } from '../core/env-loader.js';
import { buildOutputPaths } from '../core/output-paths.js';
import { writeJson } from '../core/shotfun-service.js';

async function main() {
  loadRuntimeEnvironment();
  const checks = [];
  checks.push(checkNodeVersion());
  checks.push(checkEnv('SHOTFUN_API_KEY'));
  checks.push(checkOutputPath());

  const result = {
    ok: checks.every((check) => check.ok),
    checks,
  };
  writeJson(result);
  if (!result.ok) process.exit(1);
}

function checkNodeVersion() {
  const major = Number(process.versions.node.split('.')[0]);
  return {
    name: 'node',
    ok: major >= 18,
    message: `Node ${process.versions.node}; requires >=18.`,
  };
}

function checkEnv(name) {
  return {
    name,
    ok: Boolean(process.env[name]),
    message: process.env[name] ? 'set' : `Missing ${name}.`,
  };
}

function checkOutputPath() {
  const paths = buildOutputPaths({ runId: 'doctor' });
  return {
    name: 'output-dir',
    ok: true,
    message: paths.runDir,
  };
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error.message, details: error.details }, null, 2));
  process.exit(1);
});
