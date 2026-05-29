#!/usr/bin/env node
// 自动生成 references/model-catalog.md。
// 合并 task-registry.js（model 元数据）与 capability-schema.js（capability 入参/出参/语义 SSOT），
// 按 capability 分节输出统一决策与契约文档，供 AI 在调用 service 前一站式参考。
// 用法：node scripts/core/dump-model-catalog.js

import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listTaskDefinitions, REGISTRY_VERSION } from './task-registry.js';
import { CAPABILITY_SCHEMA, CAPABILITY_ORDER, OUTPUT_SCHEMA, resolveEnumValues } from './capability-schema.js';

const __filename = fileURLToPath(import.meta.url);
const ROOT = resolve(dirname(__filename), '..', '..');
const OUTPUT = resolve(ROOT, 'references/model-catalog.md');

function main() {
  const sections = CAPABILITY_ORDER.map(renderCapability).filter(Boolean);

  const doc = [
    '<!-- 此文件由 scripts/core/dump-model-catalog.js 自动生成，禁止手动修改。 -->',
    '<!-- 修改 scripts/core/task-registry.js 或 scripts/core/capability-schema.js 后，',
    '     重新运行 `node scripts/core/dump-model-catalog.js`。 -->',
    '',
    '# ShotFun Model Catalog',
    '',
    `Registry version: \`${REGISTRY_VERSION}\``,
    '',
    'AI 在调任何 ShotFun service 之前必须读本文件。每个 capability 一节，覆盖：',
    '适用场景 → 不适用场景 → 模型决策表 → 入参规范 → 出参 → 失败处理。',
    '入参与出参的 SSOT 在 `scripts/core/capability-schema.js`，service / CLI 从 schema 派生默认值与校验。',
    '调用模板与代码示例见 [`calling-conventions.md`](./calling-conventions.md)，',
    '决策协议见 [`../SKILL.md`](../SKILL.md) 的「模型决策协议」节。',
    '',
    renderToc(),
    '',
    renderLegend(),
    '',
    sections.join('\n\n'),
  ].join('\n');

  writeFileSync(OUTPUT, doc.endsWith('\n') ? doc : `${doc}\n`, 'utf8');
  process.stdout.write(`[dump-model-catalog] wrote ${OUTPUT}\n`);
}

function renderToc() {
  const items = CAPABILITY_ORDER.map((id) => {
    const meta = CAPABILITY_SCHEMA[id];
    return `- [${meta.label}](#${meta.anchor})`;
  });
  return ['## 目录', '', ...items].join('\n');
}

function renderLegend() {
  return [
    '## 字段说明',
    '',
    '**决策表列**',
    '- `key`：传给 CLI `--model` / `--kind` / `--operation` 的别名',
    '- `priceTier`：`low` / `standard` → 静默推进；`high` / `premium` → 必须向用户复述确认',
    '- `推荐分`：0–10，越高越优先',
    '- `能力/约束`：参考图、图编辑、素材模式、固定时长等硬约束',
    '',
    '**入参表列**',
    '- `字段`：service / CLI 共享的命名（CLI flag 见对应列）',
    '- `必填`：✅ 必填；条件必填会注明触发条件',
    '- `类型`：string / number / boolean / flag / json / enum / string[]',
    '- `默认值`：未传时使用',
    '- `CLI flag`：命令行 flag；`[alias]` 列出别名；`[repeatable]` 表示可重复传',
    '',
    '**通用出参 schema**：',
    '',
    renderOutputSchema('standardTaskOutput'),
    '',
    '工作流出参 schema：',
    '',
    renderOutputSchema('workflowOutput'),
  ].join('\n');
}

function renderCapability(id) {
  const schema = CAPABILITY_SCHEMA[id];
  if (!schema) return '';

  const lines = [
    `## ${schema.label}`,
    '',
    `**Service**：\`${schema.service}\` ｜ **CLI**：\`${schema.entry}\``,
    schema.schemaMode === 'documentation' ? '\n> 入参规范为文档说明，runtime 不强制校验（workflow 入口有自定义解析）。' : '',
    '',
    renderScenarios(schema),
    '',
    renderNotApplicable(schema),
    '',
  ];

  if (schema.category) {
    lines.push(renderDecisionTable(schema.category));
    lines.push('');
  }

  lines.push(renderInputs(schema));
  lines.push('');
  lines.push(renderOutputs(schema));
  lines.push('');
  lines.push(renderFailures(schema));

  if (schema.note) {
    lines.push('');
    lines.push(`> ${schema.note}`);
  }

  return lines.filter((line) => line !== '').length ? lines.join('\n') : '';
}

function renderScenarios(schema) {
  if (!schema.scenarios?.length) return '';
  return ['### 适用场景', '', ...schema.scenarios.map((s) => `- ${s}`)].join('\n');
}

function renderNotApplicable(schema) {
  if (!schema.notApplicable?.length) return '';
  return ['### 不适用场景', '', ...schema.notApplicable.map((s) => `- ${s}`)].join('\n');
}

function renderDecisionTable(category) {
  const items = listTaskDefinitions({ category }).sort(rowCompare);
  if (!items.length) return '';
  return [
    '### 模型决策表',
    '',
    '| key | 价格 (credits) | priceTier | 推荐分 | 适用场景 | 能力 / 约束 | 亮点 | 取舍 |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
    ...items.map(renderRow),
  ].join('\n');
}

function rowCompare(a, b) {
  const scoreDelta = (b.selection.recommendationScore || 0) - (a.selection.recommendationScore || 0);
  if (scoreDelta !== 0) return scoreDelta;
  return (a.price.credits || 0) - (b.price.credits || 0);
}

function renderRow(task) {
  const cells = [
    `\`${task.key}\``,
    formatCredits(task.price),
    `\`${task.price.priceTier || 'unverified'}\``,
    String(task.selection.recommendationScore ?? '-'),
    joinList(task.selection.scenarios),
    formatSupports(task),
    joinList(task.selection.highlights),
    joinList(task.selection.tradeoffs) || '—',
  ].map(cell);
  return `| ${cells.join(' | ')} |`;
}

function renderInputs(schema) {
  const inputs = schema.inputs;
  if (!inputs || !Object.keys(inputs).length) return '';
  const rows = Object.entries(inputs).map(([name, spec]) => {
    const required = formatRequired(spec);
    const type = formatType(spec);
    const def = spec.default !== undefined ? `\`${formatDefault(spec.default)}\`` : '—';
    const cli = formatCliFlag(spec);
    return `| \`${name}\` | ${required} | ${type} | ${def} | ${cli} | ${escape(spec.desc || '')} |`;
  });
  return [
    '### 入参规范',
    '',
    '| 字段 | 必填 | 类型 | 默认值 | CLI flag | 说明 |',
    '| --- | --- | --- | --- | --- | --- |',
    ...rows,
  ].join('\n');
}

function renderOutputs(schema) {
  const outputs = schema.outputs;
  if (!outputs) return '';
  const refKey = outputs.$ref;
  if (refKey) {
    return ['### 出参 schema', '', `引用通用 schema：\`${refKey}\`（见顶部「字段说明」节）。`].join('\n');
  }
  return '';
}

function renderFailures(schema) {
  if (!schema.failures?.length) return '';
  return ['### 失败处理', '', ...schema.failures.map((s) => `- ${s}`)].join('\n');
}

function renderOutputSchema(key) {
  const schema = OUTPUT_SCHEMA[key];
  if (!schema) return '';
  const rows = Object.entries(schema).map(([name, spec]) => {
    const type = spec.values ? `enum<${spec.values.join('|')}>` : spec.type;
    const opt = spec.optional ? '可选' : '—';
    return `| \`${name}\` | ${type} | ${opt} | ${escape(spec.desc || '')} |`;
  });
  return [
    `**${key}**`,
    '',
    '| 字段 | 类型 | 可选 | 说明 |',
    '| --- | --- | --- | --- |',
    ...rows,
  ].join('\n');
}

function formatRequired(spec) {
  if (spec.required) return '✅';
  const when = spec.conditional?.requiredWhen;
  if (when) {
    const parts = Object.entries(when).map(([field, values]) =>
      `${field}∈[${Array.isArray(values) ? values.join(',') : values}]`,
    );
    return `条件 (${parts.join(' AND ')})`;
  }
  return '—';
}

function formatType(spec) {
  if (!spec.type) return 'any';
  const enums = resolveEnumValues(spec);
  if (spec.type === 'enum' && enums) return `enum<${enums.join('\\|')}>`;
  return spec.type;
}

function formatCliFlag(spec) {
  if (!spec.cli) return '—';
  const parts = [`\`${spec.cli}\``];
  if (spec.aliases?.length) parts.push(`alias: ${spec.aliases.map((a) => `\`${a}\``).join(', ')}`);
  if (spec.negate) parts.push(`negate: \`${spec.negate}\``);
  if (spec.repeatable) parts.push('repeatable');
  return parts.join('<br>');
}

function cell(value) {
  return String(value ?? '—').replace(/\|/g, '\\|');
}

function escape(value) {
  return String(value ?? '').replace(/\|/g, '\\|');
}

function joinList(items) {
  if (!items || !items.length) return '';
  return items.join(' / ');
}

function formatCredits(price) {
  if (!price) return '—';
  if (price.priceTier === 'free') return '0';
  if (!price.verified && price.priceTier === 'unverified') return `${price.credits ?? 0} (unverified)`;
  return String(price.credits ?? 0);
}

function formatSupports(task) {
  const parts = [];
  const s = task.supports || {};
  if (s.referenceImage) parts.push('参考图');
  if (s.imageEdit) parts.push('图编辑');
  if (s.assetMode) parts.push('asset 模式');
  if (s.directUrlMode) parts.push('direct URL');
  if (task.defaults?.resolution) parts.push(`默认 ${task.defaults.resolution}`);
  if (task.defaults?.durationSeconds) parts.push(`固定 ${task.defaults.durationSeconds}s`);
  return parts.length ? parts.join(' / ') : '—';
}

function formatDefault(value) {
  if (Array.isArray(value) && value.length === 0) return '[]';
  if (typeof value === 'object' && value !== null && Object.keys(value).length === 0) return '{}';
  return JSON.stringify(value);
}

main();
