// Schema runtime：service.normalize / CLI parseArgs / CLI printUsage 的通用实现。
//
// 入口约定：
//   normalizeInputs(capabilityId, options) → 填默认值、校验 required/conditional/enum，返回 normalized options
//   parseCliArgs(capabilityId, argv)       → 按 schema 解析 flag → options，返回 { options, help }
//   printCliUsage(capabilityId)            → 输出 --help 文本
//
// 所有 service / CLI 都应调本文件，不要再手写 normalizeXxxOptions / parseArgs / printUsage。

import { ShotFunOpenApiError } from './api-client.js';
import { CAPABILITY_SCHEMA, resolveEnumValues } from './capability-schema.js';

const RESERVED = new Set(['--help', '-h']);

/** 取 capability schema；未注册或 documentation-only 时抛错。 */
function getSsoSchema(capabilityId) {
  const schema = CAPABILITY_SCHEMA[capabilityId];
  if (!schema) throw new Error(`Unknown capability: ${capabilityId}`);
  if (schema.schemaMode !== 'sso') {
    throw new Error(`Capability "${capabilityId}" is documentation-only; runtime not applicable.`);
  }
  return schema;
}

/**
 * 填默认值 + 校验 required / conditional / enum。
 * 入参 options 可由 service 调用方或 CLI parseCliArgs 提供。
 */
export function normalizeInputs(capabilityId, options = {}) {
  const schema = getSsoSchema(capabilityId);
  // 保留传入的未声明字段（service 内部 mutate 加的辅助状态如 uploads 应能透传）
  const normalized = { ...options };

  for (const [name, spec] of Object.entries(schema.inputs)) {
    let value = options[name];
    if (value === undefined && spec.default !== undefined) {
      value = clone(spec.default);
    }
    if (value !== undefined) {
      validateType(name, value, spec);
      validateEnum(name, value, spec);
      normalized[name] = value;
    } else {
      // 未声明默认值的字段保持 undefined（不要写入 normalized）
      delete normalized[name];
    }
  }

  // required 校验（无 conditional 的全局必填）
  for (const [name, spec] of Object.entries(schema.inputs)) {
    if (spec.required && isEmpty(normalized[name])) {
      throw new ShotFunOpenApiError(`Missing ${spec.cli || `--${name}`}.`);
    }
  }

  // conditional required 校验
  for (const [name, spec] of Object.entries(schema.inputs)) {
    const cond = spec.conditional?.requiredWhen;
    if (!cond) continue;
    const triggered = Object.entries(cond).every(([field, values]) => {
      const fieldValue = normalized[field];
      return Array.isArray(values) ? values.includes(fieldValue) : fieldValue === values;
    });
    if (triggered && isEmpty(normalized[name])) {
      // asset-create 支持远程 URL 或本地文件上传。schema 仍保留 url 的条件必填语义，
      // 这里放行 file 入口，避免调用方为了本地素材资产化被迫先手工上传。
      if (capabilityId === 'asset' && name === 'url' && !isEmpty(normalized.file)) continue;
      throw new ShotFunOpenApiError(`Missing ${spec.cli || `--${name}`}.`);
    }
  }

  return normalized;
}

/**
 * 按 schema 解析 CLI argv。
 * 返回 { options, help }。help=true 时 main 应只打印 usage 退出。
 */
export function parseCliArgs(capabilityId, argv) {
  const schema = getSsoSchema(capabilityId);
  const flagMap = buildFlagMap(schema);

  const options = {};
  // 先填默认值（数组类深拷贝）
  for (const [name, spec] of Object.entries(schema.inputs)) {
    if (spec.default !== undefined) options[name] = clone(spec.default);
  }

  let help = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (RESERVED.has(arg)) {
      help = true;
      continue;
    }
    const entry = flagMap.get(arg);
    if (!entry) throw new ShotFunOpenApiError(`Unknown option: ${arg}`);
    const { name, spec, isNegate } = entry;

    if (spec.type === 'flag') {
      options[name] = !isNegate;
      continue;
    }

    i += 1;
    if (i >= argv.length) throw new ShotFunOpenApiError(`${arg} requires a value.`);
    const raw = argv[i];

    if (spec.repeatable) {
      options[name] = [...(options[name] || []), raw];
    } else {
      options[name] = coerceValue(raw, spec, arg);
    }
  }

  return { options, help };
}

/** 输出 --help 文本。从 schema 自动生成。 */
export function printCliUsage(capabilityId) {
  const schema = getSsoSchema(capabilityId);
  const lines = [];
  lines.push(`ShotFun ${schema.label}`);
  lines.push('');
  lines.push('Usage:');
  lines.push(`  node ${baseName(schema.entry)} [options]`);
  lines.push('');
  lines.push('Options:');

  for (const [name, spec] of Object.entries(schema.inputs)) {
    const flag = spec.cli || `--${kebab(name)}`;
    const aliases = spec.aliases?.length ? ` (alias: ${spec.aliases.join(', ')})` : '';
    const negate = spec.negate ? ` | ${spec.negate}` : '';
    const requiredMark = spec.required ? ' [REQUIRED]' : '';
    const repeatMark = spec.repeatable ? ' [REPEATABLE]' : '';
    const enumValues = resolveEnumValues(spec);
    const enumPart = enumValues?.length ? ` <${enumValues.join('|')}>` : valueHint(spec);
    const defaultPart = spec.default !== undefined ? ` (default: ${formatDefault(spec.default)})` : '';
    const condPart = spec.conditional?.requiredWhen ? ` [required when ${describeWhen(spec.conditional.requiredWhen)}]` : '';
    const desc = spec.desc ? `  ${spec.desc}` : '';
    lines.push(`  ${(flag + enumPart + negate).padEnd(40)}${requiredMark}${repeatMark}${condPart}${defaultPart}${desc}${aliases}`);
  }
  lines.push('');
  console.log(lines.join('\n'));
}

// ---- helpers ----

function buildFlagMap(schema) {
  const map = new Map();
  for (const [name, spec] of Object.entries(schema.inputs)) {
    if (spec.cli) map.set(spec.cli, { name, spec, isNegate: false });
    for (const alias of spec.aliases || []) {
      map.set(alias, { name, spec, isNegate: false });
    }
    if (spec.negate) map.set(spec.negate, { name, spec, isNegate: true });
  }
  return map;
}

function coerceValue(raw, spec, flag) {
  switch (spec.type) {
    case 'number': {
      const n = Number(raw);
      if (!Number.isFinite(n)) throw new ShotFunOpenApiError(`${flag} expects a number.`);
      return n;
    }
    case 'boolean': {
      if (raw === 'true') return true;
      if (raw === 'false') return false;
      throw new ShotFunOpenApiError(`${flag} expects true / false.`);
    }
    case 'json': {
      try { return JSON.parse(raw); }
      catch { throw new ShotFunOpenApiError(`${flag} expects JSON.`); }
    }
    default:
      return raw;
  }
}

function validateType(name, value, spec) {
  if (value === null) return;
  switch (spec.type) {
    case 'string':
    case 'enum':
      if (typeof value !== 'string') throw new ShotFunOpenApiError(`${name} must be a string.`);
      break;
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) throw new ShotFunOpenApiError(`${name} must be a number.`);
      break;
    case 'boolean':
    case 'flag':
      if (typeof value !== 'boolean') throw new ShotFunOpenApiError(`${name} must be a boolean.`);
      break;
    case 'string[]':
      if (!Array.isArray(value)) throw new ShotFunOpenApiError(`${name} must be an array.`);
      break;
    case 'json':
      if (typeof value !== 'object') throw new ShotFunOpenApiError(`${name} must be an object.`);
      break;
    default:
      // 未知 type 不校验，留给业务自处理
  }
}

function validateEnum(name, value, spec) {
  if (spec.type !== 'enum') return;
  const values = resolveEnumValues(spec);
  if (!values || values.length === 0) return;
  if (!values.includes(value)) {
    throw new ShotFunOpenApiError(`${name} must be one of: ${values.join(', ')}.`);
  }
}

function isEmpty(value) {
  if (value === undefined || value === null) return true;
  if (typeof value === 'string' && value.length === 0) return true;
  return false;
}

function clone(value) {
  if (value === null || typeof value !== 'object') return value;
  return JSON.parse(JSON.stringify(value));
}

function baseName(path) {
  return path?.split('/')?.pop() || path;
}

function kebab(name) {
  return name.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
}

function valueHint(spec) {
  if (spec.type === 'string[]') return ' <value>';
  if (spec.type === 'json') return ' <json>';
  if (spec.type === 'number') return ' <number>';
  if (spec.type === 'flag') return '';
  if (spec.type === 'boolean') return ' <true|false>';
  return ' <value>';
}

function formatDefault(value) {
  if (Array.isArray(value) && value.length === 0) return '[]';
  if (typeof value === 'object' && value !== null && Object.keys(value).length === 0) return '{}';
  return JSON.stringify(value);
}

function describeWhen(when) {
  return Object.entries(when).map(([field, values]) => `${field}∈[${Array.isArray(values) ? values.join(',') : values}]`).join(' AND ');
}
