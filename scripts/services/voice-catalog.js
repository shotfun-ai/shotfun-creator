import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ShotFunOpenApiError } from '../core/api-client.js';

const DEFAULT_REFERENCE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../references');

/**
 * 从 references/voice_<platform>.json 读取音色表，并按用户指定或默认策略选出 voice_id。
 */
export async function resolveVoice(options = {}) {
  if (!options.voicePlatform) return null;

  const catalog = await loadVoiceCatalog(options.voicePlatform, options.voiceReferenceDir);
  const voice = findRequestedVoice(catalog, options) || recommendVoice(catalog);
  if (!voice) throw new ShotFunOpenApiError(`No voices found in ${catalog.filePath}.`);

  return {
    platform: catalog.platform,
    provider: catalog.provider,
    id: voice.voice_id,
    name: voice.voice_name,
    language: voice.language,
    description: voice.description,
    recommended: !options.voiceId && !options.voiceName,
  };
}

async function loadVoiceCatalog(platform, referenceDir = DEFAULT_REFERENCE_DIR) {
  const safePlatform = String(platform).trim();
  if (!safePlatform || safePlatform.includes('/') || safePlatform.includes('\\') || safePlatform.includes('..')) {
    throw new ShotFunOpenApiError(`Invalid voice platform: ${platform}`);
  }

  const jsonCatalog = await tryLoadJsonCatalog(referenceDir, safePlatform);
  if (jsonCatalog) return jsonCatalog;

  return await loadMarkdownCatalog(referenceDir, safePlatform);
}

function findRequestedVoice(catalog, options) {
  if (options.voiceId) {
    const voice = catalog.voices.find((entry) => equals(entry.voice_id, options.voiceId));
    if (!voice) throw new ShotFunOpenApiError(`Voice id "${options.voiceId}" was not found in ${catalog.filePath}.`);
    return voice;
  }

  if (options.voiceName) {
    const voice = catalog.voices.find((entry) => equals(entry.voice_name, options.voiceName) || equals(entry.voice_id, options.voiceName));
    if (!voice) throw new ShotFunOpenApiError(`Voice "${options.voiceName}" was not found in ${catalog.filePath}.`);
    return voice;
  }

  return null;
}

function recommendVoice(catalog) {
  if (catalog.defaultVoiceId) {
    const voice = catalog.voices.find((entry) => equals(entry.voice_id, catalog.defaultVoiceId));
    if (voice) return voice;
  }

  return catalog.voices.find((entry) => isDefaultVoice(entry)) || catalog.voices[0];
}

async function tryLoadJsonCatalog(referenceDir, platform) {
  const filePath = path.join(referenceDir, `voice_${platform}.json`);
  let content;
  try {
    content = await readFile(filePath, 'utf8');
  } catch {
    return null;
  }

  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    throw new ShotFunOpenApiError(`Invalid voice catalog JSON: ${filePath}`, { cause: error.message });
  }

  return {
    filePath,
    platform: parsed.platform || platform,
    provider: parsed.provider || '',
    defaultVoiceId: parsed.defaultVoiceId || parsed.default_voice_id || '',
    voices: (parsed.voices || []).map(normalizeJsonVoice).filter((voice) => voice.voice_id && voice.voice_name),
  };
}

async function loadMarkdownCatalog(referenceDir, platform) {
  const filePath = path.join(referenceDir, `voice_${platform}.md`);
  let content;
  try {
    content = await readFile(filePath, 'utf8');
  } catch (error) {
    throw new ShotFunOpenApiError(`Voice reference file not found for platform "${platform}": ${path.join(referenceDir, `voice_${platform}.json`)} or ${filePath}`, { cause: error.message });
  }

  const { frontMatter, body } = splitFrontMatter(content);
  const voices = parseVoiceTable(body);
  return {
    filePath,
    platform: frontMatter.platform || platform,
    provider: frontMatter.provider,
    defaultVoiceId: frontMatter.default_voice_id || frontMatter.defaultVoiceId,
    voices,
  };
}

function normalizeJsonVoice(voice = {}) {
  return {
    voice_id: voice.voiceId || voice.voice_id || '',
    voice_name: voice.voiceName || voice.voice_name || '',
    language: voice.language || '',
    description: voice.description || '',
    tags: Array.isArray(voice.tags) ? voice.tags.join(',') : voice.tags || '',
    default: voice.default || '',
  };
}

function splitFrontMatter(content) {
  if (!content.startsWith('---\n')) return { frontMatter: {}, body: content };
  const end = content.indexOf('\n---', 4);
  if (end === -1) return { frontMatter: {}, body: content };
  return {
    frontMatter: parseSimpleYaml(content.slice(4, end)),
    body: content.slice(end + 4),
  };
}

function parseSimpleYaml(content) {
  return Object.fromEntries(
    content
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
      .map((line) => {
        const index = line.indexOf(':');
        if (index === -1) return null;
        const key = line.slice(0, index).trim();
        const value = line.slice(index + 1).trim().replace(/^["']|["']$/g, '');
        return [key, value];
      })
      .filter(Boolean),
  );
}

function parseVoiceTable(markdown) {
  const lines = markdown.split('\n').map((line) => line.trim()).filter((line) => line.startsWith('|'));
  for (let index = 0; index < lines.length - 1; index += 1) {
    const headers = splitTableRow(lines[index]).map(normalizeHeader);
    const separator = splitTableRow(lines[index + 1]);
    if (!headers.includes('voice_id') || !headers.includes('voice_name') || !isSeparator(separator)) continue;

    return lines.slice(index + 2)
      .map(splitTableRow)
      .filter((cells) => cells.length >= headers.length)
      .map((cells) => Object.fromEntries(headers.map((header, cellIndex) => [header, cells[cellIndex] || ''])))
      .filter((entry) => entry.voice_id && entry.voice_name);
  }
  return [];
}

function splitTableRow(line) {
  return line.replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim());
}

function normalizeHeader(header) {
  const normalized = header.toLowerCase().replace(/<br\s*\/?>/g, ' ').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  if (normalized === 'id' || normalized === 'voiceid') return 'voice_id';
  if (normalized === 'name' || normalized === 'voicename') return 'voice_name';
  return normalized;
}

function isSeparator(cells) {
  return cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function isDefaultVoice(voice) {
  return equals(voice.default, 'true') || String(voice.tags || '').split(',').some((tag) => equals(tag.trim(), 'default'));
}

function equals(left, right) {
  return String(left || '').trim().toLowerCase() === String(right || '').trim().toLowerCase();
}
