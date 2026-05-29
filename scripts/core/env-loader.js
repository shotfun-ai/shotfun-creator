import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ENV_DIR = '.shotfun-agent';
const UPPERCASE_ENV_RE = /^[A-Z][A-Z0-9_]*$/;

let loaded = false;

/**
 * Load runtime environment with priority:
 * CLI args > <cwd>/.env.local > EXTEND.md > process.env > <cwd>/.shotfun-agent/.env > ~/.shotfun-agent/.env.
 *
 * CLI args stay outside this function; callers pass them explicitly through options.
 */
export function loadRuntimeEnvironment(options = {}) {
  if (loaded && !options.force) return;
  const cwd = options.cwd || process.cwd();
  const home = options.home || os.homedir();

  const fileEnv = {
    ...readEnvFile(path.join(home, ENV_DIR, '.env')),
    ...readEnvFile(path.join(cwd, ENV_DIR, '.env')),
  };
  applyEnv(fileEnv, { override: false });
  for (const extendPath of extendPaths({ cwd, home })) {
    loadExtendEnv(extendPath);
  }
  applyEnv(readEnvFile(path.join(cwd, '.env.local')), { override: true });

  loaded = true;
}

export function resetRuntimeEnvironmentForTest() {
  loaded = false;
}

export function parseEnvFile(content) {
  const env = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const assignment = line.startsWith('export ') ? line.slice('export '.length).trim() : line;
    const separatorIndex = assignment.indexOf('=');
    if (separatorIndex <= 0) continue;
    const key = assignment.slice(0, separatorIndex).trim();
    if (!UPPERCASE_ENV_RE.test(key)) continue;
    env[key] = unquoteEnvValue(assignment.slice(separatorIndex + 1).trim());
  }
  return env;
}

export function parseExtendEnv(content) {
  const frontMatter = extractFrontMatter(content);
  if (!frontMatter) return {};
  const env = {};
  const lines = frontMatter.split(/\r?\n/);
  let inEnvBlock = false;
  let envIndent = 0;

  for (const rawLine of lines) {
    if (!rawLine.trim() || rawLine.trimStart().startsWith('#')) continue;
    const indent = rawLine.match(/^\s*/)[0].length;
    const line = rawLine.trim();

    if (inEnvBlock && indent <= envIndent) inEnvBlock = false;

    if (line === 'env:' || line === 'environment:') {
      inEnvBlock = true;
      envIndent = indent;
      continue;
    }

    const match = line.match(/^([A-Z][A-Z0-9_]*):\s*(.*)$/);
    if (!match) continue;
    const [, key, value] = match;
    if (inEnvBlock || indent === 0) {
      env[key] = unquoteEnvValue(value);
    }
  }

  return env;
}

function readEnvFile(filePath) {
  if (!existsSync(filePath)) return {};
  return parseEnvFile(readFileSync(filePath, 'utf8'));
}

function loadExtendEnv(filePath) {
  if (!existsSync(filePath)) return;
  applyEnv(parseExtendEnv(readFileSync(filePath, 'utf8')), { override: true });
}

function applyEnv(env, { override }) {
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined || value === null) continue;
    if (override || process.env[key] === undefined) {
      process.env[key] = String(value);
    }
  }
}

function extendPaths({ cwd, home }) {
  return [
    path.join(home, ENV_DIR, 'EXTEND.md'),
    path.join(cwd, ENV_DIR, 'EXTEND.md'),
  ];
}

function extractFrontMatter(content) {
  const normalized = content.replace(/^\uFEFF/, '');
  const match = normalized.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  return match?.[1];
}

function unquoteEnvValue(value) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
    || (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}
