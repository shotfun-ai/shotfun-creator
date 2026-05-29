import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';
import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadRuntimeEnvironment } from './env-loader.js';

/**
 * 输出目录规划工具。
 *
 * 统一生成项目目录、run 目录、manifest、step、日志和产物子目录路径，并在当前目录不可写时
 * 回退到用户主目录下的 ShotFun 输出目录。
 */
export const DEFAULT_PROJECT_NAME = 'default';
export const SKILL_ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * 生成 UTC 时间戳 + 随机后缀组成的 runId。
 */
export function generateRunId(now = new Date()) {
  const yyyymmdd = [
    now.getUTCFullYear(),
    pad2(now.getUTCMonth() + 1),
    pad2(now.getUTCDate()),
  ].join('');
  const hhmmss = [pad2(now.getUTCHours()), pad2(now.getUTCMinutes()), pad2(now.getUTCSeconds())].join('');
  return `${yyyymmdd}-${hhmmss}-${randomUUID().replaceAll('-', '').slice(0, 8)}`;
}

/**
 * 依据 outputDir/projectName/projectSlug 计算本次运行的所有输出路径。
 * 未显式指定输出目录时，固定写到 SKILL.md 同级目录，避免从 scripts/ 内执行时污染 scripts。
 */
export function buildOutputPaths({
  runId = generateRunId(),
  cwd = process.cwd(),
  outputDir,
  projectName,
  projectSlug,
  defaultOutputDir = path.join(SKILL_ROOT_DIR, 'shotfun-output'),
  fallbackOutputDir: fallbackBaseDir = fallbackOutputDir(),
} = {}) {
  loadRuntimeEnvironment({ cwd });
  const resolvedOutputDir = outputDir || process.env.SHOTFUN_OUTPUT_DIR;
  const resolvedProjectNameInput = projectName || process.env.SHOTFUN_PROJECT_NAME;
  const baseDir = resolvedOutputDir ? path.resolve(resolvedOutputDir) : path.resolve(defaultOutputDir);
  const resolvedProjectName = normalizeProjectName(resolvedProjectNameInput);
  const resolvedProjectSlug = normalizeProjectSlug(projectSlug || resolvedProjectName);
  const projectDir = path.join(baseDir, 'projects', resolvedProjectSlug);
  const runDir = path.join(projectDir, 'runs', runId);
  return {
    runId,
    baseDir,
    projectName: resolvedProjectName,
    projectSlug: resolvedProjectSlug,
    projectDir,
    projectMetaPath: path.join(projectDir, 'project.json'),
    projectIndexPath: path.join(projectDir, 'index.jsonl'),
    projectLatestPath: path.join(projectDir, 'latest.json'),
    fallbackBaseDir: path.resolve(fallbackBaseDir),
    explicitOutputDir: Boolean(resolvedOutputDir),
    runDir,
    manifestPath: path.join(runDir, 'manifest.json'),
    inputsDir: path.join(runDir, 'inputs'),
    stepsDir: path.join(runDir, 'steps'),
    logsDir: path.join(runDir, 'logs'),
    textsDir: path.join(runDir, 'texts'),
    imagesDir: path.join(runDir, 'images'),
    videosDir: path.join(runDir, 'videos'),
    audioDir: path.join(runDir, 'audio'),
    rawDir: path.join(runDir, 'raw'),
  };
}

/**
 * 创建运行所需目录；显式输出目录失败时直接抛错，默认目录失败时尝试主目录回退。
 */
export async function ensureRunDirectories(paths, options = {}) {
  const dirs = [paths.runDir, paths.inputsDir, paths.stepsDir, paths.logsDir, paths.textsDir];
  dirs.push(paths.projectDir);
  if (options.fetchRemote) dirs.push(paths.imagesDir, paths.videosDir, paths.audioDir);
  if (options.keepRaw) dirs.push(paths.rawDir);
  try {
    await Promise.all(dirs.map((dir) => mkdir(dir, { recursive: true })));
    return paths;
  } catch (error) {
    if (paths.explicitOutputDir || !isOutputUnavailable(error)) throw error;
    const fallbackPaths = buildOutputPaths({
      runId: paths.runId,
      outputDir: paths.fallbackBaseDir,
      projectName: paths.projectName,
      projectSlug: paths.projectSlug,
      defaultOutputDir: paths.fallbackBaseDir,
      fallbackOutputDir: paths.fallbackBaseDir,
    });
    await ensureRunDirectories(fallbackPaths, options);
    return fallbackPaths;
  }
}

/**
 * 将项目名规范化为稳定目录 slug，空值用哈希兜底。
 */
export function normalizeProjectSlug(value) {
  const source = String(value || '').trim();
  const slug = source
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
  if (slug) return slug;
  return `project-${createHash('sha1').update(source || randomUUID()).digest('hex').slice(0, 8)}`;
}

/**
 * 写入项目级索引、latest 和元数据，方便按项目追踪多次运行。
 */
export async function writeProjectRunSummary(paths, manifest) {
  const projectMeta = {
    projectName: paths.projectName,
    projectSlug: paths.projectSlug,
    projectDir: paths.projectDir,
    updatedAt: manifest.finishedAt || manifest.startedAt || new Date().toISOString(),
  };
  const summary = cleanObject({
    ok: manifest.ok,
    status: manifest.status,
    runId: manifest.runId,
    projectName: paths.projectName || manifest.projectName,
    projectSlug: paths.projectSlug || manifest.projectSlug,
    workflow: manifest.workflow,
    goal: manifest.goal || manifest.prompt,
    outputDir: manifest.outputDir,
    manifest: paths.manifestPath,
    userArtifacts: manifest.userArtifacts,
    createdAt: manifest.createdAt,
    startedAt: manifest.startedAt,
    finishedAt: manifest.finishedAt,
  });

  await mkdir(paths.projectDir, { recursive: true });
  await writeFile(paths.projectMetaPath, `${JSON.stringify(projectMeta, null, 2)}\n`, 'utf8');
  await writeFile(paths.projectLatestPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  await appendFile(paths.projectIndexPath, `${JSON.stringify(summary)}\n`, 'utf8');
}

/**
 * 默认回退输出目录，避免工作区不可写时丢失运行产物。
 */
export function fallbackOutputDir() {
  return path.join(os.homedir(), 'ShotFun', 'outputs');
}

function normalizeProjectName(value) {
  const name = String(value || '').trim();
  return name || DEFAULT_PROJECT_NAME;
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

function isOutputUnavailable(error) {
  return ['EACCES', 'ENOENT', 'ENOTDIR', 'EROFS'].includes(error?.code);
}

function cleanObject(value) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}
