import { readFileSync } from 'node:fs';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { ShotFunOpenApiClient, ShotFunOpenApiError } from '../core/api-client.js';
import { buildOutputPaths, ensureRunDirectories, writeProjectRunSummary } from '../core/output-paths.js';
import { resolveProjectCode } from '../core/shotfun-service.js';
import { REGISTRY_VERSION, resolveTaskPreset } from '../core/task-registry.js';
import {
  buildUserArtifacts,
  estimateCost,
  hashInputs,
  jsonlLogger,
  withCostGuard,
  writeManifest,
  writeStep,
} from '../core/workflow-runtime.js';

export const WORKFLOW_ID = 'news-broadcast-video';
export const WORKFLOW_VERSION = '2026.05.25';

const MIN_STORY_COUNT = 1;
const MAX_STORY_COUNT = 5;
const DEFAULT_WIDTH = 1080;
const DEFAULT_HEIGHT = 1920;
const DEFAULT_FPS = 30;
const DEFAULT_COVER_SECONDS = 4;
const DEFAULT_STORY_SECONDS = 12;
const DEFAULT_CLOSE_SECONDS = 8;
const NARRATION_TAIL_PAD_SECONDS = 1;
const DEFAULT_VISUAL_MODEL = 'gpt-image2';
const DEFAULT_VISUAL_ASPECT_RATIO = '3:4';
const DEFAULT_VISUAL_RESOLUTION = '2K';
const DEFAULT_VISUAL_TIMEOUT_MS = 300000;
const DEFAULT_AUDIENCE_PROFILE = '小白 / 通用业务观众';
const DEFAULT_STYLE_PRESET = 'impeccable-editorial-broadcast';
const DEFAULT_LOOK_AND_FEEL = 'light editorial broadcast, commute-readable, precise, premium, high-contrast';
const DEFAULT_BGM_STYLE = 'morning commute, upbeat, ready-to-work editorial bed';
const DEFAULT_TTS_PREVIEW_TEXT = '今天这条播报会用清晰、克制、适合快速理解的语气完成。';
const CONFIRMATION_STEP_ID = '00-confirmation-plan';
const AUDIENCE_CONFIRMATION_STEP_ID = '00-audience-confirmation';
const STORY_PLAN_CONFIRMATION_STEP_ID = '01-story-plan-confirmation';
const VOICE_PREVIEW_STEP_ID = '02-voice-preview';
const NARRATION_REVIEW_STEP_ID = '02-narration-review';
const BGM_STYLE_STEP_ID = '02-bgm-style';
const BGM_PREVIEW_STEP_ID = '02-bgm-preview';
const VISUAL_PROMPT_STEP_ID = '03-story-visual-prompts';
const BROADCAST_INPUT_REQUEST_STEP_ID = '00-broadcast-input-request';
const HISTORICAL_INPUT_CONFIRMATION_CODE = 'historical-input-requires-explicit-approval';
const VISUAL_GRAMMAR_GALLERY_PATH = 'examples/visual-grammar-gallery/index.html';

const VISUAL_GRAMMAR_LIBRARY = {
  mechanism_xray: {
    label: 'Mechanism X-Ray',
    bestFor: 'cause/effect mechanisms, supply chains, policy effects, model internals, and business drivers',
    motion: 'reveal the polished surface first, then wipe in layered cause/effect bands and pressure paths',
    exampleImage: {
      path: 'examples/visual-grammar-gallery/mechanism_xray.svg',
      alt: 'A polished surface opened into translucent x-ray layers, pressure bands, and clean overlay lanes.',
      prompt: 'Portrait editorial preview: polished central system surface opened into translucent x-ray layers, cause/effect bands, thin pressure paths, paper/graphite/navy palette, quiet lanes for DOM overlays.',
    },
  },
  verification_rail: {
    label: 'Verification Rail',
    bestFor: 'proof, evaluation, trust, model quality, acceptance, and compliance',
    motion: 'move across separated evidence stops, then resolve into a verified state',
    exampleImage: {
      path: 'examples/visual-grammar-gallery/verification_rail.svg',
      alt: 'A vertical evidence rail with separated proof stops and a final verified state.',
      prompt: 'Portrait editorial preview: vertical evidence rail with three separated proof stops, document tabs, check-state endpoint, restrained green accent, open space around each stop for later labels.',
    },
  },
  market_ledger: {
    label: 'Market Ledger',
    bestFor: 'finance recap, product-market loops, pricing, KPI shifts, and strategic comparisons',
    motion: 'open ledger columns, reveal calm numeric hierarchy, then land a thesis strip',
    exampleImage: {
      path: 'examples/visual-grammar-gallery/market_ledger.svg',
      alt: 'Calm ledger columns with one thesis strip and subdued numeric hierarchy.',
      prompt: 'Portrait editorial preview: premium market ledger board, calm columns, subtle numeric hierarchy, bottom thesis strip, thin rules, warm paper and deep ink palette, no fake readable numbers.',
    },
  },
  runtime_lens: {
    label: 'Runtime Lens',
    bestFor: 'agents, software systems, operating surfaces, workflows, and architecture',
    motion: 'focus a central lens or hub, orbit perimeter concepts, then lock one operating thesis',
    exampleImage: {
      path: 'examples/visual-grammar-gallery/runtime_lens.svg',
      alt: 'A central operating lens with perimeter concepts orbiting around one system thesis.',
      prompt: 'Portrait editorial preview: central operating lens or hub, restrained orbit lanes around it, a few perimeter concept nodes, one clear thesis zone, technical but not cyberpunk.',
    },
  },
  before_after_surface: {
    label: 'Before / After Surface',
    bestFor: 'product evolution, strategy change, old/new state comparisons',
    motion: 'split old and new states, animate the bridge, then emphasize what changed',
    exampleImage: {
      path: 'examples/visual-grammar-gallery/before_after_surface.svg',
      alt: 'A split old/new surface with a visible bridge showing what changed.',
      prompt: 'Portrait editorial preview: split before-and-after panels, clear center divider, bridge path between old and new states, restrained delta area, clean text-safe zones.',
    },
  },
  signal_board: {
    label: 'Signal Board',
    bestFor: 'daily recaps or multiple weak signals without verified causality',
    motion: 'group signal lanes, light up each lane, then finish on a watch-next line',
    exampleImage: {
      path: 'examples/visual-grammar-gallery/signal_board.svg',
      alt: 'Grouped signal lanes ending in a watch-next strip rather than a causal diagram.',
      prompt: 'Portrait editorial preview: grouped signal lanes, small bulletin markers, calm watch-next strip at bottom, no causal arrows, morning briefing palette and generous breathing room.',
    },
  },
  cinematic_anchor: {
    label: 'Cinematic Anchor',
    bestFor: 'stories with one strong visual object or scene',
    motion: 'slowly reveal one premium image, push in on detail, then add two or three callouts',
    exampleImage: {
      path: 'examples/visual-grammar-gallery/cinematic_anchor.svg',
      alt: 'One inspectable hero object with two or three precise editorial callouts.',
      prompt: 'Portrait editorial preview: one premium inspectable hero object or scene, slow-push composition, two or three small callout zones, documentary lighting, no dark generic stock atmosphere.',
    },
  },
  data_on_plate: {
    label: 'Data On Plate',
    bestFor: 'chart-led scenes and data that must be rebuilt accurately in HTML',
    motion: 'bring in a subdued image plate, then layer real chart/data marks over it',
    exampleImage: {
      path: 'examples/visual-grammar-gallery/data_on_plate.svg',
      alt: 'A subdued visual plate with an open region for real chart and data overlays.',
      prompt: 'Portrait editorial preview: subdued analytical plate, large clean chart region left open, faint grid and paper texture, no fake labels, designed for accurate HTML data overlays.',
    },
  },
  timeline_ribbon: {
    label: 'Timeline Ribbon',
    bestFor: 'timelines, release sequences, policy changes, and research-to-product stories',
    motion: 'draw a ribbon rail, reveal milestone dots, then end with a sequence verdict',
    exampleImage: {
      path: 'examples/visual-grammar-gallery/timeline_ribbon.svg',
      alt: 'A ribbon rail with milestone dots, phase cards, and a final sequence verdict.',
      prompt: 'Portrait editorial preview: timeline ribbon rail crossing the board, milestone dots, sparse phase cards, final verdict zone, clear lower text-safe band.',
    },
  },
  radar_sweep: {
    label: 'Radar Sweep',
    bestFor: 'multiple weak signals converging into an editorial trend judgment',
    motion: 'scan a radar field, collect signal cards, then converge toward a central trend read',
    exampleImage: {
      path: 'examples/visual-grammar-gallery/radar_sweep.svg',
      alt: 'A radar-like sweep field collecting weak signals into a central editorial read.',
      prompt: 'Portrait editorial preview: restrained radar sweep field, short signal cards around the perimeter, subtle convergence lines toward central trend read, no neon or military sci-fi styling.',
    },
  },
  quote_architecture: {
    label: 'Quote Architecture',
    bestFor: 'official announcements, interviews, papers, and executive statements',
    motion: 'set the quote as a beam, split its logic into pillars, then land the judgment base',
    exampleImage: {
      path: 'examples/visual-grammar-gallery/quote_architecture.svg',
      alt: 'A quote beam supported by explanatory pillars and a judgment base.',
      prompt: 'Portrait editorial preview: quote beam across the top, two or three explanatory pillars beneath it, judgment base at bottom, official-paper mood, no generated readable quote text.',
    },
  },
  layer_stack: {
    label: 'Layer Stack',
    bestFor: 'tech stacks, agent architecture, model/product layers, platform refactors',
    motion: 'separate layers vertically, reveal each role, then recompress into one system thesis',
    exampleImage: {
      path: 'examples/visual-grammar-gallery/layer_stack.svg',
      alt: 'Separated system layers that recompress into one architecture thesis.',
      prompt: 'Portrait editorial preview: vertical architecture layer stack, shallow perspective, clear layer boundaries, recompression thesis zone, technical editorial palette, no dense boxes.',
    },
  },
  ecosystem_orbit: {
    label: 'Ecosystem Orbit',
    bestFor: 'stakeholder relationships, platform effects, partner networks',
    motion: 'place the central actor, orbit stakeholders, then finish with an ecosystem read',
    exampleImage: {
      path: 'examples/visual-grammar-gallery/ecosystem_orbit.svg',
      alt: 'A central actor with stakeholder nodes arranged on restrained orbit rings.',
      prompt: 'Portrait editorial preview: central actor or platform in the middle, stakeholder nodes on restrained orbit rings, relationship gravity, clean center and orbit lanes for overlays.',
    },
  },
  decision_tree_path: {
    label: 'Decision Tree Path',
    bestFor: 'policy options, roadmap forks, strategic choices, and risk/upside paths',
    motion: 'start at one decision root, branch into few truthful consequences, then mark watch-next',
    exampleImage: {
      path: 'examples/visual-grammar-gallery/decision_tree_path.svg',
      alt: 'A sparse decision root branching into truthful consequence paths and a watch-next mark.',
      prompt: 'Portrait editorial preview: one decision root, two or three sparse branching paths, consequence endpoints, watch-next verdict area, restrained line weight and ample label space.',
    },
  },
  metric_pulse: {
    label: 'Metric Pulse',
    bestFor: 'one key number, benchmark delta, cost drop, latency shift, or growth rate',
    motion: 'pulse the key metric, reveal source/delta chips, then compare against a baseline strip',
    exampleImage: {
      path: 'examples/visual-grammar-gallery/metric_pulse.svg',
      alt: 'One central metric with source chips and a small baseline comparison strip.',
      prompt: 'Portrait editorial preview: one large central metric zone without fake numerals, small source/delta chips, baseline comparison strip, precise editorial data mood.',
    },
  },
};

Object.defineProperty(VISUAL_GRAMMAR_LIBRARY, '__meta', {
  value: {
    name: 'built-in-commercial-visual-motion-grammar',
    description: 'Built-in visual grammar choices with lightweight structure previews for News Broadcast videos.',
    sourceType: 'built-in',
  },
  enumerable: false,
  configurable: true,
});

const DELIVERY_REVISION_OPTIONS = [
  {
    area: '文案',
    examples: ['标题', '口播稿', '字幕密度', '每条故事的结论', '结尾 CTA'],
  },
  {
    area: '视觉语法',
    examples: ['换一条故事的 grammar', '让两条故事使用更不同的结构', '调整画面层级和安全区'],
  },
  {
    area: '动效和节奏',
    examples: ['放慢信息进入', '加强关键节点', '减少转场', '调整 BGM 与配音关系'],
  },
  {
    area: '视觉资产',
    examples: ['重出某张 GPT image plate', '换参考图', '补关键帧 review 图'],
  },
];

const VISUAL_GRAMMAR_EXPANSION_STEPS = [
  '先命名新的 grammar，并写清楚它最适合什么故事。',
  '定义 composition、motion、safeZones、useCase 和 keywords，让选择器能自动匹配。',
  '补一张 exampleImage：至少包含 alt 和 prompt，用来告诉用户这种 grammar 大概长什么样。',
  '用一条真实故事跑示例图或示例帧，确认视觉方向以后再加入 JSON library。',
  '保存成 visual-grammar-library.json，并用 --visual-grammar-library 复用到后续播报。',
];

const VISUAL_GRAMMAR_LAYOUTS = {
  mechanism_xray: 'xray',
  verification_rail: 'rail',
  market_ledger: 'ledger',
  runtime_lens: 'lens',
  before_after_surface: 'before-after',
  signal_board: 'signal',
  cinematic_anchor: 'hero',
  data_on_plate: 'plate',
  timeline_ribbon: 'timeline',
  radar_sweep: 'radar',
  quote_architecture: 'quote',
  layer_stack: 'stack',
  ecosystem_orbit: 'orbit',
  decision_tree_path: 'tree',
  metric_pulse: 'metric',
};

const VISUAL_GRAMMAR_PROMPT_HINTS = {
  mechanism_xray: {
    useCase: 'infographic-diagram',
    composition: 'Reveal a polished surface first, then expose layered cause/effect bands and pressure paths underneath.',
    safeZones: 'Leave quiet lanes for later overlays and avoid dense labels near the main mechanism.',
  },
  verification_rail: {
    useCase: 'infographic-diagram',
    composition: 'Use three separated evidence stops on a clear rail, ending in a verified state.',
    safeZones: 'Keep the rail readable and leave open space around the stops for later check marks and callouts.',
  },
  market_ledger: {
    useCase: 'infographic-diagram',
    composition: 'Build calm ledger columns with one thesis strip and restrained numeric hierarchy.',
    safeZones: 'Keep the bottom strip and column edges open for later typeset overlays.',
  },
  runtime_lens: {
    useCase: 'infographic-diagram',
    composition: 'Center a lens or hub, orbit a few perimeter concepts, and land on one operating thesis.',
    safeZones: 'Reserve the center and outer orbit lanes for later rings and labels.',
  },
  before_after_surface: {
    useCase: 'infographic-diagram',
    composition: 'Split old and new states clearly and make the bridge or transition the main thing.',
    safeZones: 'Keep the divider and bridge clean so later DOM labels can sit without collision.',
  },
  signal_board: {
    useCase: 'infographic-diagram',
    composition: 'Group weak signals into lanes and end with a watch-next line instead of a fake causal graph.',
    safeZones: 'Leave the lane headers and lower watch strip quiet for later copy.',
  },
  cinematic_anchor: {
    useCase: 'stylized-concept',
    composition: 'Use one premium hero image and keep the focus on a single strong object or scene.',
    safeZones: 'Leave a generous text-safe band for later headline and callout motion.',
  },
  data_on_plate: {
    useCase: 'infographic-diagram',
    composition: 'Create a subdued image plate that can carry the real chart or data layer later.',
    safeZones: 'Leave the chart region open and avoid fake chart labels.',
  },
  timeline_ribbon: {
    useCase: 'infographic-diagram',
    composition: 'Draw a ribbon rail with milestone dots and leave room for one final verdict.',
    safeZones: 'Keep the milestone lane and lower verdict band open for later sequencing copy.',
  },
  radar_sweep: {
    useCase: 'infographic-diagram',
    composition: 'Place weak signals around a sweep field and converge them toward one editorial read.',
    safeZones: 'Avoid clutter near the center sweep line and leave space for the watch-next strip.',
  },
  quote_architecture: {
    useCase: 'infographic-diagram',
    composition: 'Use a quote beam above a few explanatory pillars that split claim, proof, and impact.',
    safeZones: 'Leave the pillar tops clear so later typeset quote text can land cleanly.',
  },
  layer_stack: {
    useCase: 'infographic-diagram',
    composition: 'Stack system layers vertically and recompress them into one clean architecture thesis.',
    safeZones: 'Keep the layer boundaries readable and avoid extra boxes inside each layer.',
  },
  ecosystem_orbit: {
    useCase: 'infographic-diagram',
    composition: 'Place the central actor in the middle and let stakeholders orbit around it with restraint.',
    safeZones: 'Reserve the orbit arcs and center hub for later DOM emphasis and labels.',
  },
  decision_tree_path: {
    useCase: 'infographic-diagram',
    composition: 'Start from one decision root, branch into a few truthful paths, and end in a verdict.',
    safeZones: 'Keep the branches sparse so later labels and arrows do not collide.',
  },
  metric_pulse: {
    useCase: 'infographic-diagram',
    composition: 'Center one key metric, pulse it once or twice, and land on a small baseline strip.',
    safeZones: 'Leave the metric center and baseline strip open for later numeric overlays.',
  },
};

async function loadVisualGrammarLibrary(source) {
  if (!source) return VISUAL_GRAMMAR_LIBRARY;
  if (typeof source === 'string') {
    const filePath = path.resolve(source);
    const raw = JSON.parse(await readFile(filePath, 'utf8'));
    return resolveVisualGrammarLibrary(raw);
  }
  if (typeof source === 'object') return resolveVisualGrammarLibrary(source);
  return VISUAL_GRAMMAR_LIBRARY;
}

function loadVisualGrammarLibrarySync(source) {
  if (!source) return VISUAL_GRAMMAR_LIBRARY;
  if (typeof source === 'string') {
    const filePath = path.resolve(source);
    const raw = JSON.parse(readFileSync(filePath, 'utf8'));
    return resolveVisualGrammarLibrary(raw);
  }
  if (typeof source === 'object') return resolveVisualGrammarLibrary(source);
  return VISUAL_GRAMMAR_LIBRARY;
}

function resolveVisualGrammarLibrary(source) {
  const normalized = normalizeVisualGrammarLibrary(source);
  const merged = { ...VISUAL_GRAMMAR_LIBRARY, ...normalized };
  Object.defineProperty(merged, '__meta', {
    value: {
      name: normalized.__meta?.name || source?.__meta?.name || source?.name || source?.title || source?.libraryName || 'custom-visual-grammar-library',
      description: normalized.__meta?.description || source?.__meta?.description || source?.description || '',
      sourceType: normalized.__meta?.sourceType || source?.__meta?.sourceType || source?.sourceType || 'custom',
    },
    enumerable: false,
    configurable: true,
  });
  return merged;
}

function normalizeVisualGrammarLibrary(source) {
  if (!source || typeof source !== 'object') return {};
  const rawEntries = Array.isArray(source)
    ? source
    : Array.isArray(source.grammars)
      ? source.grammars
      : Array.isArray(source.items)
        ? source.items
        : typeof source.grammars === 'object'
          ? Object.entries(source.grammars).map(([key, value]) => ({ key, ...value }))
          : Object.entries(source).map(([key, value]) => ({ key, ...value }));

  const catalog = {};
  for (const entry of rawEntries) {
    const key = normalizeGrammarKey(entry.key || entry.id || entry.slug || entry.name || entry.label);
    if (!key) continue;
    catalog[key] = normalizeGrammarEntry(key, entry);
  }
  Object.defineProperty(catalog, '__meta', {
    value: {
      name: source.__meta?.name || source.name || source.title || source.libraryName || '',
      description: source.__meta?.description || source.description || '',
      sourceType: source.__meta?.sourceType || source.sourceType || source.type || 'custom',
    },
    enumerable: false,
    configurable: true,
  });
  return catalog;
}

function normalizeGrammarEntry(key, entry = {}) {
  return {
    key,
    label: entry.label || entry.name || titleCase(key),
    bestFor: entry.bestFor || entry.best_for || entry.description || '',
    motion: entry.motion || entry.animation || '',
    composition: entry.composition || entry.layout || '',
    safeZones: entry.safeZones || entry.safe_zones || '',
    useCase: entry.useCase || entry.use_case || '',
    exampleImage: normalizeExampleImage(entry.exampleImage || entry.example_image || entry.sampleImage || entry.sample_image || entry.previewImage || entry.preview_image),
    keywords: normalizeKeywords(entry.keywords || entry.tags || entry.signals || entry.match || []),
  };
}

function normalizeExampleImage(value) {
  if (!value) return undefined;
  if (typeof value === 'string') {
    return { path: value };
  }
  if (typeof value !== 'object') return undefined;
  return {
    path: value.path || value.file || value.url || '',
    alt: value.alt || value.description || '',
    prompt: value.prompt || '',
  };
}

function normalizeKeywords(value) {
  const list = Array.isArray(value) ? value : String(value || '').split(/[,\s/|]+/);
  return list.map((item) => String(item || '').trim().toLowerCase()).filter(Boolean);
}

function normalizeGrammarKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s]+/g, '_')
    .replace(/[^\p{L}\p{N}_-]+/gu, '')
    .replace(/-+/g, '_');
}

function titleCase(value) {
  return String(value || '')
    .split(/[_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function grammarCssClass(grammarKey) {
  return String(grammarKey || 'signal_board').replace(/_/g, '-');
}

function grammarLayoutKey(grammarKey) {
  return VISUAL_GRAMMAR_LAYOUTS[grammarKey] || 'signal';
}

function grammarLayoutSummary(layoutKey) {
  switch (layoutKey) {
    case 'timeline':
      return 'horizontal ribbon with phase cards and a bottom plate';
    case 'rail':
      return 'vertical evidence rail with a side plate and verdict band';
    case 'quote':
      return 'quote beam on top, explanatory pillars below, and a supporting plate';
    case 'before-after':
      return 'split before/after panels bridged by the change';
    case 'signal':
    default:
      return 'hero plate on top with stacked signal lanes beneath';
  }
}

function grammarCatalogMeta(catalog) {
  return catalog?.__meta || {};
}

function getGrammarEntry(catalog, key) {
  return catalog?.[key] || VISUAL_GRAMMAR_LIBRARY[key];
}

function visualGrammarCatalogItems(catalog = VISUAL_GRAMMAR_LIBRARY) {
  const source = catalog && typeof catalog === 'object' ? catalog : VISUAL_GRAMMAR_LIBRARY;
  return Object.entries(source)
    .filter(([key]) => key !== '__meta')
    .map(([key, entry]) => {
      const normalized = normalizeGrammarEntry(key, entry);
      return {
        key,
        label: normalized.label,
        bestFor: normalized.bestFor,
        motion: normalized.motion,
        composition: normalized.composition,
        safeZones: normalized.safeZones,
        useCase: normalized.useCase,
        exampleImage: normalized.exampleImage,
        keywords: normalized.keywords,
      };
    });
}

function visualGrammarCatalogSummary(catalog = VISUAL_GRAMMAR_LIBRARY) {
  return visualGrammarCatalogItems(catalog).map((item) => ({
    key: item.key,
    label: item.label,
    bestFor: item.bestFor,
    motion: item.motion,
    exampleImage: item.exampleImage,
  }));
}

function selectVisualGrammar(story, index, payload, catalog = VISUAL_GRAMMAR_LIBRARY) {
  const availableCatalog = catalog && typeof catalog === 'object' ? catalog : VISUAL_GRAMMAR_LIBRARY;
  const explicitKey = normalizeGrammarKey(story.visualGrammar || story.visualGrammarKey || story.visualGrammarId || '');
  if (explicitKey && availableCatalog[explicitKey]) return explicitKey;

  const text = [story.title, story.summary, story.takeaway, story.source, payload.title, payload.seriesTitle].join(' ').toLowerCase();
  const scored = bestScoredGrammar(availableCatalog, text);
  if (scored.score > 0) return scored.key;

  const heuristics = [
    ['before_after_surface', ['before', 'after', 'change', 'switch', 'replaced', 'transition', 'shift', 'migration', 'upgrade']],
    ['timeline_ribbon', ['timeline', 'release', 'launch', 'version', 'rollout', 'roadmap', 'sequence']],
    ['runtime_lens', ['model', 'agent', 'workflow', 'architecture', 'system', 'runtime', 'pipeline', 'stack']],
    ['verification_rail', ['proof', 'verify', 'evaluation', 'benchmark', 'trust', 'accept', 'compliance', 'review']],
    ['metric_pulse', ['metric', 'number', 'growth', 'cost', 'latency', 'profit', 'rate', 'kpi']],
    ['market_ledger', ['market', 'finance', 'price', 'trade', 'ledger', 'revenue', 'earnings']],
    ['ecosystem_orbit', ['ecosystem', 'partner', 'platform', 'stakeholder', 'orbit']],
    ['decision_tree_path', ['decision', 'option', 'choose', 'fork', 'path', 'risk', 'upside']],
    ['quote_architecture', ['quote', 'statement', 'said', 'announced']],
    ['signal_board', ['signal', 'weak', 'trend', 'watch', 'recap', 'multiple']],
  ];
  for (const [key, needles] of heuristics) {
    if (needles.some((needle) => text.includes(needle)) && availableCatalog[key]) return key;
  }

  return scored.key || (availableCatalog.signal_board ? 'signal_board' : Object.keys(availableCatalog)[0]) || 'signal_board';
}

function bestScoredGrammar(catalog, text) {
  let bestKey = catalog.signal_board ? 'signal_board' : Object.keys(catalog)[0];
  let score = -1;
  for (const [entryKey, entry] of Object.entries(catalog)) {
    if (entryKey === '__meta') continue;
    const entryScore = scoreVisualGrammarEntry(entry, text);
    if (entryScore > score) {
      score = entryScore;
      bestKey = entryKey;
    }
  }
  return { key: bestKey || 'signal_board', score };
}

function scoreVisualGrammarEntry(entry, text) {
  if (!entry) return 0;
  let score = 0;
  const label = String(entry.label || '').toLowerCase();
  const bestFor = String(entry.bestFor || '').toLowerCase();
  const motion = String(entry.motion || '').toLowerCase();
  const keywords = normalizeKeywords(entry.keywords);

  for (const keyword of keywords) {
    if (keyword && text.includes(keyword)) score += 5;
  }
  for (const token of [label, bestFor, motion]) {
    if (!token) continue;
    for (const word of token.split(/[\s,;:()/-]+/).filter(Boolean)) {
      if (word.length > 2 && text.includes(word)) score += 1;
    }
  }
  if (label && text.includes(label)) score += 4;
  return score;
}

export function buildNewsBroadcastVideoPlan(options = {}) {
  const normalized = normalizeOptions(options);
  const visualGrammarLibrary = loadVisualGrammarLibrarySync(options.visualGrammarLibrary ?? normalized.visualGrammarLibraryFile);
  const resolvedInput = resolveBroadcastInputSyncBoundary(normalized);
  const payload = decorateBroadcastPayload(normalizeInputPayload(resolvedInput.input), normalized, visualGrammarLibrary);
  const confirmationPlan = buildConfirmationPlan({ payload, normalized, visualGrammarLibrary });
  const paths = buildOutputPaths({
    runId: normalized.resumeRunId || normalized.runId,
    cwd: normalized.cwd,
    outputDir: normalized.outputDir,
    projectName: normalized.projectName || payload.seriesTitle || 'News Broadcast Video',
    projectSlug: normalized.projectSlug,
  });
  const runSpec = {
    workflow: WORKFLOW_ID,
    inputFile: normalized.inputFile,
    projectCode: normalized.projectCode,
    projectName: normalized.projectName,
    projectSlug: normalized.projectSlug,
    render: normalized.render,
    draft: normalized.draft,
    width: normalized.width,
    height: normalized.height,
    fps: normalized.fps,
    prompt: normalized.prompt,
    useShotfunTts: normalized.useShotfunTts,
    voicePlatform: normalized.voicePlatform,
    voiceName: normalized.voiceName,
    voiceId: normalized.voiceId,
    confirm: normalized.confirm,
    allowHistoricalInput: normalized.allowHistoricalInput,
    confirmationApproved: normalized.confirmationApproved,
    confirmationPlanOnly: normalized.confirmationPlanOnly,
    checkpoint: normalized.checkpoint,
    audienceProfile: normalized.audienceProfile,
    visualStylePreset: normalized.visualStylePreset,
    visualStyleNote: normalized.visualStyleNote,
    bgmStyle: normalized.bgmStyle,
    visualGrammarLibraryFile: normalized.visualGrammarLibraryFile,
    audienceStyleApproved: normalized.audienceStyleApproved,
    storyPlanApproved: normalized.storyPlanApproved,
    bgmStyleApproved: normalized.bgmStyleApproved,
    visualPromptPlanApproved: normalized.visualPromptPlanApproved,
    narrationAudioApproved: normalized.narrationAudioApproved,
    bgmPreviewApproved: normalized.bgmPreviewApproved,
    ttsPreviewApproved: normalized.ttsPreviewApproved,
    visualPlatesApproved: normalized.visualPlatesApproved,
    hyperframesApproved: normalized.hyperframesApproved,
    generateStoryVisuals: normalized.generateStoryVisuals,
    visualModel: normalized.visualModel,
    visualAspectRatio: normalized.visualAspectRatio,
    visualResolution: normalized.visualResolution,
    visualTimeoutMs: normalized.visualTimeoutMs,
  };
  const steps = buildPlanSteps(normalized, payload);
  const cost = estimateCost(steps
    .filter((step) => step.registryId && step.includeInCost !== false)
    .map((step) => ({ registryId: step.registryId, count: step.count })));

  return {
    workflow: WORKFLOW_ID,
    workflowVersion: WORKFLOW_VERSION,
    registryVersion: REGISTRY_VERSION,
    runId: paths.runId,
    outputDir: paths.runDir,
    manifest: paths.manifestPath,
    runSpecHash: hashInputs(runSpec),
    projectName: paths.projectName,
    projectSlug: paths.projectSlug,
    cost,
    payloadSummary: summarizePayload(payload),
    confirmationPlan,
    steps,
  };
}

export async function runNewsBroadcastVideoWorkflow(options = {}, deps = {}) {
  const normalized = normalizeOptions(options, { allowMissingInput: true });
  const paths = await ensureRunDirectories(buildOutputPaths({
    runId: normalized.resumeRunId || normalized.runId,
    cwd: normalized.cwd,
    outputDir: normalized.outputDir,
    projectName: normalized.projectName || 'News Broadcast Video',
    projectSlug: normalized.projectSlug,
  }), { fetchRemote: true, keepRaw: normalized.keepRaw });

  const logger = jsonlLogger(paths.runDir);
  const startedAt = new Date().toISOString();
  const manifest = {
    ok: true,
    runId: paths.runId,
    projectCode: normalized.projectCode,
    projectName: paths.projectName,
    projectSlug: paths.projectSlug,
    workflow: WORKFLOW_ID,
    workflowVersion: WORKFLOW_VERSION,
    registryVersion: REGISTRY_VERSION,
    createdAt: startedAt,
    startedAt,
    cost: { estimated: 0, currency: 'credits' },
    outputDir: paths.runDir,
    userArtifacts: [],
    status: normalized.dryRun ? 'dry-run' : 'running',
  };

  await writeManifest(paths.runDir, manifest);
  await logger.write({ event: 'workflow_start', workflow: WORKFLOW_ID, dryRun: normalized.dryRun });

  const visualGrammarLibrary = await loadVisualGrammarLibrary(normalized.visualGrammarLibraryFile);
  const inputResolution = await resolveBroadcastInput(normalized);
  if (inputResolution.kind === 'needs-broadcast-input') {
    return await finishNeedsBroadcastInputRun({
      paths,
      manifest,
      logger,
      normalized,
      problem: inputResolution.problem,
    });
  }

  const payload = decorateBroadcastPayload(normalizeInputPayload(inputResolution.input), normalized, visualGrammarLibrary);
  const shouldGenerateVisuals = shouldGenerateStoryVisuals(normalized, payload);
  const plan = buildNewsBroadcastVideoPlan({ ...normalized, inputPayload: payload, visualGrammarLibraryFile: normalized.visualGrammarLibraryFile, visualGrammarLibrary });
  plan.runId = paths.runId;
  plan.outputDir = paths.runDir;
  plan.manifest = paths.manifestPath;
  const confirmationPlan = plan.confirmationPlan;
  Object.assign(manifest, {
    goal: payload.title,
    runSpecHash: plan.runSpecHash,
    runId: paths.runId,
    outputDir: paths.runDir,
    manifest: paths.manifestPath,
    cost: plan.cost,
    payloadSummary: plan.payloadSummary,
    confirmationPlan: confirmationSummary(confirmationPlan),
  });
  await logger.write({ event: 'cost_estimate', estimated: plan.cost.estimated, currency: plan.cost.currency });

  const sidecars = [];
  const copiedInput = await persistInputPayload(paths, inputResolution.kind === 'json' ? normalized.inputFile : undefined, payload);
  const inputSidecar = makeSidecar({
    stepId: '01-input',
    name: 'input',
    status: 'success',
    localFiles: [{ kind: 'text', name: 'broadcast-input', path: copiedInput }],
    summary: plan.payloadSummary,
  });
  sidecars.push(inputSidecar);
  await writeStep(paths.runDir, inputSidecar.stepId, inputSidecar);

  const confirmationSidecar = await persistConfirmationPlan({ paths, payload, normalized, confirmationPlan });
  sidecars.push(confirmationSidecar);
  await writeStep(paths.runDir, confirmationSidecar.stepId, confirmationSidecar);

  if (normalized.confirmationPlanOnly || (!normalized.confirmationApproved && !normalized.dryRun)) {
    return await finishWorkflowRun({
      paths,
      manifest,
      sidecars,
      plan,
      logger,
      dryRun: normalized.dryRun,
      status: 'needs-confirmation',
      extra: {
        awaitingConfirmation: true,
        checkpoint: 'confirmation-plan',
        nextAction: '我已经把这期播报整理成一份确认清单。下一步请你确认受众、整体风格和每条故事的表达方向；确认后，我会继续做配音、画面和最终项目。',
      },
    });
  }

  if (!normalized.dryRun && !normalized.audienceStyleApproved) {
    const audienceStyleSidecar = await persistAudienceStyleGate({ paths, payload, normalized, confirmationPlan });
    sidecars.push(audienceStyleSidecar);
    await writeStep(paths.runDir, audienceStyleSidecar.stepId, audienceStyleSidecar);
    return await finishWorkflowRun({
      paths,
      manifest,
      sidecars,
      plan,
      logger,
      dryRun: normalized.dryRun,
      status: 'needs-audience-style-approval',
      extra: {
        awaitingConfirmation: true,
        checkpoint: 'audience-and-style',
        nextAction: '我已经进入受众和整体风格确认这一步。下一步请你确认这条播报给谁看、想要什么画面气质；确认后，我会继续细化每条故事的讲法和画面语法。',
      },
    });
  }

  if (!normalized.dryRun && !normalized.storyPlanApproved) {
    const storyPlanSidecar = await persistStoryPlanGate({ paths, payload, normalized, confirmationPlan });
    sidecars.push(storyPlanSidecar);
    await writeStep(paths.runDir, storyPlanSidecar.stepId, storyPlanSidecar);
    return await finishWorkflowRun({
      paths,
      manifest,
      sidecars,
      plan,
      logger,
      dryRun: normalized.dryRun,
      status: 'needs-story-plan-approval',
      extra: {
        awaitingConfirmation: true,
        checkpoint: 'story-plan',
        nextAction: '我已经把每条新闻整理成重点和画面表达方案。下一步请你确认每条故事最想让观众记住什么；确认后，我会开始做配音、图片提示词和画面素材。',
      },
    });
  }

  if (normalized.useShotfunTts && !normalized.dryRun && !normalized.ttsPreviewApproved) {
    const previewSidecar = await generateTtsPreviewWithShotFun({ normalized, payload, paths, deps });
    sidecars.push(previewSidecar);
    await writeStep(paths.runDir, previewSidecar.stepId, previewSidecar);
    return await finishWorkflowRun({
      paths,
      manifest,
      sidecars,
      plan,
      logger,
      dryRun: normalized.dryRun,
      status: 'needs-tts-approval',
      extra: {
        awaitingConfirmation: true,
        checkpoint: 'tts-preview',
        nextAction: '我已经准备好播报声音预览。下一步请你听一下音色、语速和语气是否合适；确认后，我会生成完整配音。',
      },
    });
  }

  if (!normalized.dryRun && !normalized.bgmStyleApproved) {
    const bgmStyleSidecar = await persistBgmStyleGate({ paths, payload, normalized });
    sidecars.push(bgmStyleSidecar);
    await writeStep(paths.runDir, bgmStyleSidecar.stepId, bgmStyleSidecar);
    return await finishWorkflowRun({
      paths,
      manifest,
      sidecars,
      plan,
      logger,
      dryRun: normalized.dryRun,
      status: 'needs-bgm-style-approval',
      extra: {
        awaitingConfirmation: true,
        checkpoint: 'bgm-style',
        nextAction: '我已经准备进入背景音乐这一步。下一步请你确认想要的音乐气质，如果你有现成音乐也可以一起给我；确认后，我会继续做预览或混音。',
      },
    });
  }

  if (payload.bgm.file && !normalized.dryRun && !normalized.bgmPreviewApproved) {
    const bgmSidecar = await persistBgmPreview({ paths, payload, normalized });
    sidecars.push(bgmSidecar);
    await writeStep(paths.runDir, bgmSidecar.stepId, bgmSidecar);
    return await finishWorkflowRun({
      paths,
      manifest,
      sidecars,
      plan,
      logger,
      dryRun: normalized.dryRun,
      status: 'needs-bgm-approval',
      extra: {
        awaitingConfirmation: true,
        checkpoint: 'bgm-preview',
        nextAction: '我已经选好背景音乐预览。下一步请你听一下它会不会抢播报声音；确认后，我会继续往下做项目。',
      },
    });
  }

  if (!normalized.dryRun) {
    withCostGuard({ estimated: plan.cost.estimated, confirm: normalized.confirm });
  }

  if (normalized.useShotfunTts && !normalized.dryRun) {
    const narrationSidecar = await generateNarrationWithShotFun({ normalized, payload, paths, deps });
    const generatedAudio = firstAudioPath(narrationSidecar);
    if (generatedAudio) payload.narration.audioFile = generatedAudio;
    await ensureNarrationDuration({ payload, sidecar: narrationSidecar, deps, source: 'shotfun-tts' });
    sidecars.push(narrationSidecar);
    await writeStep(paths.runDir, narrationSidecar.stepId, narrationSidecar);
    if (!normalized.narrationAudioApproved) {
      const narrationReviewSidecar = await persistNarrationReviewGate({ paths, payload, normalized });
      sidecars.push(narrationReviewSidecar);
      await writeStep(paths.runDir, narrationReviewSidecar.stepId, narrationReviewSidecar);
      return await finishWorkflowRun({
        paths,
        manifest,
        sidecars,
        plan,
        logger,
        dryRun: normalized.dryRun,
        status: 'needs-narration-approval',
        extra: {
          awaitingConfirmation: true,
          checkpoint: 'narration-audio',
          nextAction: '我已经合成了完整配音。下一步请你听一遍整段音频，确认内容、语速和停顿都对；确认后，我会继续生成画面和项目。',
        },
      });
    }
  } else {
    if (!normalized.dryRun) await ensureNarrationDuration({ payload, deps, source: 'input-audio' });
    const narrationSidecar = makeSidecar({
      stepId: '02-narration-plan',
      name: 'narration',
      status: normalized.useShotfunTts ? 'planned' : 'skipped',
      registryId: normalized.useShotfunTts ? 'audio.tts_single_voice' : undefined,
      textArtifacts: [{ name: 'narration-script', path: await persistTextFile(paths.textsDir, 'narration-script.txt', payload.narration.text) }],
      summary: {
        mode: normalized.useShotfunTts ? 'shotfun-tts-dry-run' : 'external-audio-or-text-only',
        voicePlatform: normalized.voicePlatform,
        voiceName: normalized.voiceName,
        voiceId: normalized.voiceId,
      },
    });
    sidecars.push(narrationSidecar);
    await writeStep(paths.runDir, narrationSidecar.stepId, narrationSidecar);
  }

  if (!shouldGenerateVisuals && normalized.render && normalized.generateStoryVisuals === false && missingVisualStories(payload).length) {
    throw new ShotFunOpenApiError('news-broadcast-video render requires story visuals. Provide stories[].visual.file or keep story visual generation enabled.');
  }

  if (shouldGenerateVisuals) {
    if (!normalized.dryRun && !normalized.visualPromptPlanApproved) {
      const visualPromptPlanSidecar = await planStoryVisualPrompts({ paths, payload, normalized, hasGeneratedVisuals: shouldGenerateVisuals });
      sidecars.push(visualPromptPlanSidecar);
      await writeStep(paths.runDir, visualPromptPlanSidecar.stepId, visualPromptPlanSidecar);
      return await finishWorkflowRun({
        paths,
        manifest,
        sidecars,
        plan,
        logger,
        dryRun: normalized.dryRun,
        status: 'needs-visual-prompt-approval',
        extra: {
          awaitingConfirmation: true,
          checkpoint: 'story-visual-prompt-plan',
          nextAction: '我已经准备好每条新闻的图片提示词。下一步请你确认这些提示词是否准确；确认后，我会开始生成配图。',
        },
      });
    }

    const visualSidecar = normalized.dryRun
      ? await planStoryVisuals({ paths, payload, normalized, hasGeneratedVisuals: shouldGenerateVisuals })
      : await generateStoryVisuals({ paths, payload, normalized, deps, hasGeneratedVisuals: shouldGenerateVisuals });
    sidecars.push(visualSidecar);
    await writeStep(paths.runDir, visualSidecar.stepId, visualSidecar);
    if (!normalized.dryRun && !normalized.visualPlatesApproved) {
      return await finishWorkflowRun({
        paths,
        manifest,
        sidecars,
        plan,
        logger,
        dryRun: normalized.dryRun,
        status: 'needs-visual-plate-approval',
        extra: {
          awaitingConfirmation: true,
          checkpoint: 'story-visuals',
          nextAction: '我已经把新闻配图生成好了。下一步请你确认它们是否贴合内容和版式；确认后，我会把它们放进 HyperFrames 项目。',
        },
      });
    }
  }

  const hfSidecar = normalized.dryRun
    ? await planHyperFramesProject({ paths, payload, normalized, hasGeneratedVisuals: shouldGenerateVisuals })
    : await writeHyperFramesProject({ paths, payload, normalized, hasGeneratedVisuals: shouldGenerateVisuals });
  sidecars.push(hfSidecar);
  await writeStep(paths.runDir, hfSidecar.stepId, hfSidecar);

  if (normalized.render && !normalized.dryRun && !normalized.hyperframesApproved) {
    return await finishWorkflowRun({
      paths,
      manifest,
      sidecars,
      plan,
      logger,
      dryRun: normalized.dryRun,
      status: 'needs-hyperframes-approval',
      extra: {
        awaitingConfirmation: true,
        checkpoint: 'hyperframes-project',
        nextAction: '我已经把完整视频项目组装好了。下一步请你确认 `DESIGN.md`、`storyboard.json` 和预览文件；确认后，我会开始渲染最终 MP4。',
      },
    });
  }

  if (normalized.render && !normalized.dryRun) {
    const renderSidecar = await renderHyperFramesProject({ paths, payload, normalized, deps, projectDir: hfSidecar.projectDir, hasGeneratedVisuals: shouldGenerateVisuals });
    sidecars.push(renderSidecar);
    await writeStep(paths.runDir, renderSidecar.stepId, renderSidecar);
  }

  return await finishWorkflowRun({
    paths,
    manifest,
    sidecars,
    plan,
    logger,
    dryRun: normalized.dryRun,
    status: normalized.dryRun ? 'dry-run' : 'success',
  });
}

function buildPlanSteps(options, payload) {
  const visualStories = missingVisualStories(payload);
  const needsVisuals = shouldGenerateStoryVisuals(options, payload);
  const visualRegistryId = needsVisuals ? imageRegistryId(options.visualModel) : undefined;
  const hyperframesStepId = needsVisuals ? '05-hyperframes-project' : '04-hyperframes-project';
  const renderStepId = needsVisuals ? '06-render' : '05-render';
  const steps = [
    {
      stepId: CONFIRMATION_STEP_ID,
      name: 'confirmation-plan',
      service: 'local-file',
      function: 'writeConfirmationPlan',
    },
    { stepId: '01-input', name: 'input', service: 'local-file', function: 'validateInput' },
    {
      stepId: options.useShotfunTts ? '02-narration' : '02-narration-plan',
      name: 'narration',
      service: options.useShotfunTts ? 'audio-generation-service' : 'local-file',
      function: options.useShotfunTts ? 'generateAudio' : 'persistNarrationText',
      registryId: options.useShotfunTts ? 'audio.tts_single_voice' : undefined,
      includeInCost: !options.dryRun,
      inputHash: hashInputs({ text: payload.narration.text, voiceName: options.voiceName, voiceId: options.voiceId }),
    },
  ];
  if (needsVisuals) {
    steps.push({
      stepId: '03-story-visuals',
      name: 'story-visuals',
      service: 'text-to-image-service',
      function: 'generateImage',
      registryId: visualRegistryId,
      count: visualStories.length,
      includeInCost: !options.dryRun,
      inputHash: hashInputs({
        stories: visualStories.map((story) => ({ id: story.id, title: story.title, summary: story.summary, takeaway: story.takeaway })),
        visualModel: options.visualModel,
        visualAspectRatio: options.visualAspectRatio,
        visualResolution: options.visualResolution,
        visualTimeoutMs: options.visualTimeoutMs,
      }),
    });
  }
  steps.push({ stepId: hyperframesStepId, name: 'hyperframes-project', service: 'hyperframes', function: 'writeProject' });
  if (options.render) {
    steps.push({ stepId: renderStepId, name: 'render', service: 'hyperframes-cli', function: 'render' });
  }
  return steps;
}

async function generateNarrationWithShotFun({ normalized, payload, paths, deps }) {
  const generateAudio = deps.generateAudio || (await import('../services/audio-generation-service.js')).generateAudio;
  const result = await generateAudio({
    projectCode: normalized.projectCode,
    kind: 'single',
    voicePlatform: normalized.voicePlatform,
    voiceName: normalized.voiceName,
    voiceId: normalized.voiceId,
    text: payload.narration.text,
    wait: true,
    agentOutput: true,
  });
  return makeSidecar({
    stepId: '02-narration',
    name: 'narration',
    status: 'success',
    registryId: 'audio.tts_single_voice',
    taskNo: result.taskNo,
    resultUrls: result.resultUrls,
    assetRefs: result.assetRefs,
    localFiles: result.localFiles,
    textArtifacts: [{ name: 'narration-script', path: await persistTextFile(paths.textsDir, 'narration-script.txt', payload.narration.text) }],
    summary: { kind: 'shotfun-tts', voicePlatform: normalized.voicePlatform, voiceName: normalized.voiceName, voiceId: normalized.voiceId },
  });
}

async function planStoryVisuals({ paths, payload, normalized, hasGeneratedVisuals }) {
  const visualStories = missingVisualStories(payload);
  const promptManifest = [];
  const textArtifacts = [];

  for (const { story, index } of visualStories) {
    const prompt = storyVisualPrompt({ payload, story, index });
    promptManifest.push({ storyId: story.id, title: story.title, prompt });
    textArtifacts.push({
      name: `story-${index + 1}-visual-prompt`,
      path: await persistTextFile(paths.textsDir, `story-${index + 1}-visual-prompt.txt`, prompt),
    });
  }

  return makeSidecar({
    stepId: '03-story-visuals',
    name: 'story-visuals',
    status: 'planned',
    registryId: imageRegistryId(normalized.visualModel),
    textArtifacts: [
      ...textArtifacts,
      { name: 'story-visual-prompts', path: await persistTextFile(paths.textsDir, 'story-visual-prompts.json', JSON.stringify(promptManifest, null, 2)) },
    ],
    summary: {
      mode: 'planned-gpt-story-plates',
      model: normalized.visualModel,
      aspectRatio: normalized.visualAspectRatio,
      resolution: normalized.visualResolution,
      timeoutMs: normalized.visualTimeoutMs,
      storyCount: visualStories.length,
      hasGeneratedVisuals,
    },
  });
}

async function generateStoryVisuals({ paths, payload, normalized, deps }) {
  const usesInjectedGenerateImage = Boolean(deps.generateImage);
  const generateImage = deps.generateImage || (await import('../services/text-to-image-service.js')).generateImage;
  const visualClient = deps.visualClient || deps.client || (usesInjectedGenerateImage
    ? { timeoutMs: normalized.visualTimeoutMs }
    : new ShotFunOpenApiClient({ timeoutMs: normalized.visualTimeoutMs }));
  const visualStories = missingVisualStories(payload);
  const localFiles = [];
  const resultUrls = [];
  const taskNos = [];
  const promptManifest = [];
  const textArtifacts = [];

  for (const { story, index } of visualStories) {
    const prompt = storyVisualPrompt({ payload, story, index });
    const promptPath = await persistTextFile(paths.textsDir, `story-${index + 1}-visual-prompt.txt`, prompt);
    textArtifacts.push({ name: `story-${index + 1}-visual-prompt`, path: promptPath });
    promptManifest.push({ storyId: story.id, title: story.title, prompt });

    const result = await generateImage({
      projectCode: normalized.projectCode,
      model: normalized.visualModel,
      prompt,
      aspectRatio: normalized.visualAspectRatio,
      resolution: normalized.visualResolution,
      wait: true,
      agentOutput: true,
    }, { client: visualClient });
    const generatedImage = firstImagePath(result);
    if (!generatedImage) {
      throw new ShotFunOpenApiError(`Story visual generation did not return a downloadable image for "${story.title}".`, {
        storyId: story.id,
        taskNo: result.taskNo,
      });
    }
    story.visual.file = generatedImage;
    story.visual.alt = story.visual.alt || `Generated editorial visual for ${story.title}`;
    story.visual.caption = story.visual.caption || story.takeaway || story.summary || story.title;
    taskNos.push(result.taskNo);
    resultUrls.push(...(result.resultUrls || []));
    localFiles.push({ kind: 'image', name: `story-${index + 1}-visual`, path: generatedImage, storyId: story.id });
  }

  textArtifacts.push({
    name: 'story-visual-prompts',
    path: await persistTextFile(paths.textsDir, 'story-visual-prompts.json', JSON.stringify(promptManifest, null, 2)),
  });

  return makeSidecar({
    stepId: '03-story-visuals',
    name: 'story-visuals',
    status: 'success',
    registryId: imageRegistryId(normalized.visualModel),
    taskNos,
    resultUrls,
    localFiles,
    textArtifacts,
    summary: {
      mode: 'gpt-story-plates',
      model: normalized.visualModel,
      aspectRatio: normalized.visualAspectRatio,
      resolution: normalized.visualResolution,
      timeoutMs: normalized.visualTimeoutMs,
      storyCount: visualStories.length,
      hasGeneratedVisuals: true,
      taskNos,
    },
  });
}

async function planHyperFramesProject({ paths, payload, normalized, hasGeneratedVisuals }) {
  const projectDir = path.join(paths.runDir, 'hyperframes', safeSlug(payload.slug || payload.title || 'news-broadcast'));
  const storyboardPath = await persistTextFile(paths.textsDir, 'storyboard.json', JSON.stringify(buildStoryboard(payload), null, 2));
  const scriptPath = await persistTextFile(paths.textsDir, 'script.txt', payload.narration.text);
  const designPath = await persistTextFile(paths.textsDir, 'design.md', renderDesignMarkdown(payload));
  return makeSidecar({
    stepId: hasGeneratedVisuals ? '05-hyperframes-project' : '04-hyperframes-project',
    name: 'hyperframes-project',
    status: 'planned',
    projectDir,
    localFiles: [
      { kind: 'text', name: 'storyboard', path: storyboardPath },
      { kind: 'text', name: 'script', path: scriptPath },
      { kind: 'text', name: 'design', path: designPath },
    ],
    summary: {
      width: normalized.width,
      height: normalized.height,
      durationSeconds: totalDuration(payload),
      narrationDurationSeconds: narrationDuration(payload) || undefined,
      render: normalized.render,
      hasGeneratedVisuals,
    },
  });
}

async function writeHyperFramesProject({ paths, payload, normalized, hasGeneratedVisuals }) {
  const slug = safeSlug(payload.slug || payload.title || 'news-broadcast');
  const projectDir = path.join(paths.runDir, 'hyperframes', slug);
  const assetsDir = path.join(projectDir, 'assets');
  const rendersDir = path.join(projectDir, 'renders');
  await mkdir(assetsDir, { recursive: true });
  await mkdir(rendersDir, { recursive: true });

  const storyboard = buildStoryboard(payload);
  const scriptPath = path.join(projectDir, 'script.txt');
  const storyboardPath = path.join(projectDir, 'storyboard.json');
  const designPath = path.join(projectDir, 'DESIGN.md');
  const packagePath = path.join(projectDir, 'package.json');
  const hyperframesPath = path.join(projectDir, 'hyperframes.json');
  const indexPath = path.join(projectDir, 'index.html');
  const manifestInputPath = path.join(projectDir, 'broadcast-input.json');

  await Promise.all([
    writeFile(scriptPath, ensureTrailingNewline(payload.narration.text), 'utf8'),
    writeFile(storyboardPath, `${JSON.stringify(storyboard, null, 2)}\n`, 'utf8'),
    writeFile(designPath, renderDesignMarkdown(payload), 'utf8'),
    writeFile(packagePath, renderPackageJson(slug), 'utf8'),
    writeFile(hyperframesPath, renderHyperframesJson(), 'utf8'),
    writeFile(manifestInputPath, `${JSON.stringify(payload.original, null, 2)}\n`, 'utf8'),
    writeFile(indexPath, renderIndexHtml({ payload, storyboard, normalized }), 'utf8'),
  ]);

  await copyOptionalAsset(payload.narration.audioFile, assetsDir, 'narration');
  await copyOptionalAsset(payload.bgm?.file, assetsDir, 'bgm');
  for (const [index, story] of payload.stories.entries()) {
    await copyOptionalAsset(story.visual?.file, assetsDir, `story-${index + 1}`);
  }

  return makeSidecar({
    stepId: hasGeneratedVisuals ? '05-hyperframes-project' : '04-hyperframes-project',
    name: 'hyperframes-project',
    status: 'success',
    projectDir,
    localFiles: [
      { kind: 'text', name: 'hyperframes-index', path: indexPath },
      { kind: 'text', name: 'storyboard', path: storyboardPath },
      { kind: 'text', name: 'script', path: scriptPath },
      { kind: 'text', name: 'design', path: designPath },
    ],
    summary: {
      width: normalized.width,
      height: normalized.height,
      durationSeconds: totalDuration(payload),
      narrationDurationSeconds: narrationDuration(payload) || undefined,
      render: normalized.render,
      hasGeneratedVisuals,
    },
  });
}

async function renderHyperFramesProject({ projectDir, payload, normalized, deps, hasGeneratedVisuals }) {
  const render = deps.renderHyperFrames || defaultRenderHyperFrames;
  const outputName = `${path.basename(projectDir)}-${normalized.draft ? 'draft' : 'standard'}.mp4`;
  const outputPath = path.join(projectDir, 'renders', outputName);
  await render({ projectDir, outputPath, draft: normalized.draft });
  const mediaProbe = await probeRenderedVideo(outputPath, deps);
  return makeSidecar({
    stepId: hasGeneratedVisuals ? '06-render' : '05-render',
    name: 'render',
    status: 'success',
    localFiles: [{ kind: 'video', name: 'news-broadcast-video', path: outputPath }],
    summary: {
      outputPath,
      hasGeneratedVisuals,
      ...summarizeRenderedVideoProbe({ mediaProbe, payload }),
    },
  });
}

async function defaultRenderHyperFrames({ projectDir, outputPath, draft }) {
  const { spawn } = await import('node:child_process');
  await new Promise((resolve, reject) => {
    const args = ['--yes', 'hyperframes@0.6.30', 'render', '--output', outputPath];
    if (draft) args.push('--quality', 'draft');
    const child = spawn('npx', args, { cwd: projectDir, stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new ShotFunOpenApiError(`HyperFrames render failed with exit code ${code}.`));
    });
  });
}

async function probeRenderedVideo(outputPath, deps = {}) {
  const probe = deps.probeRenderedVideo || defaultProbeRenderedVideo;
  try {
    return await probe(outputPath);
  } catch (error) {
    return { ok: false, warning: error?.message || String(error) };
  }
}

async function defaultProbeRenderedVideo(outputPath) {
  const { spawn } = await import('node:child_process');
  const raw = await new Promise((resolve, reject) => {
    const child = spawn('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration:stream=index,codec_type,codec_name,width,height,r_frame_rate,avg_frame_rate,duration',
      '-of', 'json',
      outputPath,
    ]);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve(stdout);
      else reject(new ShotFunOpenApiError(`ffprobe failed for rendered video with exit code ${code}: ${stderr.trim()}`));
    });
  });
  return { ok: true, raw: JSON.parse(raw) };
}

function summarizeRenderedVideoProbe({ mediaProbe, payload }) {
  if (!mediaProbe?.ok) return { validation: { warning: mediaProbe?.warning || 'Rendered video probe was not available.' } };
  const raw = mediaProbe.raw || {};
  const streams = Array.isArray(raw.streams) ? raw.streams : [];
  const videoStreams = streams.filter((stream) => stream.codec_type === 'video').map((stream) => ({
    codec: stream.codec_name,
    width: stream.width,
    height: stream.height,
    fps: round(parseFrameRate(stream.avg_frame_rate || stream.r_frame_rate || '0/0')),
    durationSeconds: numericDuration(stream.duration),
  }));
  const audioStreams = streams.filter((stream) => stream.codec_type === 'audio').map((stream) => ({
    codec: stream.codec_name,
    durationSeconds: numericDuration(stream.duration),
  }));
  const durationSeconds = numericDuration(raw.format?.duration) || Math.max(
    0,
    ...videoStreams.map((stream) => stream.durationSeconds || 0),
    ...audioStreams.map((stream) => stream.durationSeconds || 0),
  );
  const narrationDurationSeconds = narrationDuration(payload);
  return {
    media: {
      durationSeconds,
      videoStreams,
      audioStreams,
    },
    validation: {
      hasVideo: videoStreams.length > 0,
      hasAudio: audioStreams.length > 0,
      narrationDurationSeconds: narrationDurationSeconds || undefined,
      durationCoversNarration: narrationDurationSeconds ? durationSeconds + 0.01 >= narrationDurationSeconds : undefined,
      tailPadSeconds: narrationDurationSeconds ? round(durationSeconds - narrationDurationSeconds) : undefined,
    },
  };
}

function numericDuration(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? round(number) : undefined;
}

function parseFrameRate(value) {
  const [numerator, denominator] = String(value || '').split('/').map(Number);
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) return 0;
  return numerator / denominator;
}

function normalizeOptions(options = {}) {
  const inputFile = options.inputFile || options.input || options.broadcastInput;
  return {
    inputFile,
    inputPayload: options.inputPayload,
    prompt: options.prompt || options.brief || options.topic || options.broadcastPrompt || '',
    projectCode: resolveProjectCode(options.projectCode),
    projectName: options.projectName,
    projectSlug: options.projectSlug,
    runId: options.runId,
    resumeRunId: options.resumeRunId,
    outputDir: options.outputDir,
    cwd: options.cwd,
    dryRun: Boolean(options.dryRun),
    render: Boolean(options.render),
    draft: options.draft !== false,
    keepRaw: Boolean(options.keepRaw),
    confirm: Boolean(options.confirm),
    allowHistoricalInput: Boolean(options.allowHistoricalInput || options.reuseHistoricalInput),
    confirmationApproved: Boolean(options.approveConfirmationPlan || options.confirmationApproved),
    confirmationPlanOnly: Boolean(options.confirmationPlanOnly),
    checkpoint: options.checkpoint || '',
    audienceProfile: options.audienceProfile || '',
    visualStylePreset: options.visualStylePreset || '',
    visualStyleNote: options.visualStyleNote || '',
    visualGrammarLibraryFile: options.visualGrammarLibraryFile || options.visualGrammarLibrary || '',
    audienceStyleApproved: Boolean(options.approveAudienceAndStyle || options.audienceStyleApproved),
    storyPlanApproved: Boolean(options.approveStoryPlan || options.storyPlanApproved),
    bgmStyleApproved: Boolean(options.approveBgmStyle || options.bgmStyleApproved),
    visualPromptPlanApproved: Boolean(options.approveVisualPromptPlan || options.visualPromptPlanApproved),
    narrationAudioApproved: Boolean(options.approveNarrationAudio || options.narrationAudioApproved),
    useShotfunTts: Boolean(options.useShotfunTts),
    voicePlatform: options.voicePlatform || 'minimax',
    voiceName: options.voiceName || '播报男声',
    voiceId: options.voiceId,
    ttsPreviewApproved: Boolean(options.approveTtsPreview || options.ttsPreviewApproved),
    bgmPreviewApproved: Boolean(options.approveBgmPreview || options.bgmPreviewApproved),
    visualPlatesApproved: Boolean(options.approveStoryVisuals || options.visualPlatesApproved),
    hyperframesApproved: Boolean(options.approveHyperframesProject || options.hyperframesApproved),
    bgmStyle: options.bgmStyle || '',
    generateStoryVisuals: options.generateStoryVisuals !== false,
    visualModel: options.visualModel || DEFAULT_VISUAL_MODEL,
    visualAspectRatio: options.visualAspectRatio || DEFAULT_VISUAL_ASPECT_RATIO,
    visualResolution: options.visualResolution || DEFAULT_VISUAL_RESOLUTION,
    visualTimeoutMs: Number(options.visualTimeoutMs || DEFAULT_VISUAL_TIMEOUT_MS),
    width: Number(options.width || DEFAULT_WIDTH),
    height: Number(options.height || DEFAULT_HEIGHT),
    fps: Number(options.fps || DEFAULT_FPS),
  };
}

async function readJsonInput(inputFile) {
  return JSON.parse(await readFile(path.resolve(inputFile), 'utf8'));
}

async function resolveBroadcastInput(options) {
  if (options.inputPayload) return { kind: 'json', input: options.inputPayload };
  if (options.inputFile) {
    const historicalProblem = historicalInputProblem(options);
    if (historicalProblem) return { kind: 'needs-broadcast-input', problem: historicalProblem };
    try {
      return { kind: 'json', input: await readJsonInput(options.inputFile) };
    } catch (error) {
      if (!isBroadcastInputReadError(error)) throw error;
      const prompt = extractBroadcastPrompt(options);
      if (prompt) return { kind: 'prompt', input: buildBroadcastInputFromPrompt(prompt, options) };
      return { kind: 'needs-broadcast-input', problem: error };
    }
  }
  const prompt = extractBroadcastPrompt(options);
  if (prompt) return { kind: 'prompt', input: buildBroadcastInputFromPrompt(prompt, options) };
  return { kind: 'needs-broadcast-input', problem: undefined };
}

function resolveBroadcastInputSyncBoundary(options) {
  if (options.inputPayload) return { kind: 'json', input: options.inputPayload };
  const prompt = extractBroadcastPrompt(options);
  if (options.inputFile) {
    const historicalProblem = historicalInputProblem(options);
    if (historicalProblem) return { kind: 'needs-broadcast-input', problem: historicalProblem };
    try {
      return { kind: 'json', input: JSON.parse(readFileSync(path.resolve(options.inputFile), 'utf8')) };
    } catch (error) {
      if (!isBroadcastInputReadError(error) && !(error instanceof SyntaxError)) throw error;
      if (prompt) return { kind: 'prompt', input: buildBroadcastInputFromPrompt(prompt, options) };
      return { kind: 'needs-broadcast-input', problem: error };
    }
  }
  if (prompt) return { kind: 'prompt', input: buildBroadcastInputFromPrompt(prompt, options) };
  return { kind: 'needs-broadcast-input', problem: undefined };
}

function normalizeInputPayload(input) {
  const original = input;
  const title = requiredString(input.title || input.headline, 'input.title');
  const stories = asArray(input.stories).slice(0, MAX_STORY_COUNT).map((story, index) => normalizeStory(story, index));
  if (stories.length < MIN_STORY_COUNT) throw new ShotFunOpenApiError('input.stories must include at least one story.');
  const quickHits = asArray(input.quickHits || input.quick_hits).map(normalizeQuickHit);
  const narrationText = String(input.narration?.text || input.script || buildNarrationFromStories({ title, stories, quickHits })).trim();
  if (!narrationText) throw new ShotFunOpenApiError('input.narration.text or input.script is required when stories cannot build narration.');
  return {
    original,
    slug: input.slug,
    seriesTitle: input.seriesTitle || input.series_title || 'News Broadcast',
    title,
    subtitle: input.subtitle || '',
    date: input.date || '',
    language: input.language || 'zh-CN',
    narratorLabel: input.narratorLabel || input.narrator_label || 'NEWS DESK',
    cover: input.cover || {},
    stories,
    quickHits,
    narration: {
      text: narrationText,
      audioFile: input.narration?.audioFile || input.narration?.audio_file || input.audioFile || input.audio_file,
      durationSeconds: Number(input.narration?.durationSeconds || input.narration?.duration_seconds || input.durationSeconds || 0),
    },
    bgm: {
      file: input.bgm?.file || input.bgmFile || input.bgm_file,
      title: input.bgm?.title || '',
      attribution: input.bgm?.attribution || '',
    },
    prompt: input.originalPrompt || input.prompt || '',
    inputSource: input.source || (input.originalPrompt ? 'prompt' : 'json'),
  };
}

function historicalInputProblem(options) {
  if (!options.inputFile || options.allowHistoricalInput) return undefined;
  if (!isHistoricalBroadcastInputPath(options.inputFile, options.cwd)) return undefined;
  return new ShotFunOpenApiError(
    'This broadcast input is inside shotfun-output, so it looks like a previous run artifact. Ask the user what they want to broadcast now, or pass --allow-historical-input only after they explicitly approve reusing this exact file.',
    {
      code: HISTORICAL_INPUT_CONFIRMATION_CODE,
      inputFile: path.resolve(options.cwd || process.cwd(), options.inputFile),
    },
  );
}

function isHistoricalBroadcastInputPath(inputFile, cwd = process.cwd()) {
  const resolved = path.resolve(cwd || process.cwd(), inputFile);
  return resolved.split(path.sep).includes('shotfun-output');
}

function extractBroadcastPrompt(options) {
  return normalizePromptText(options.prompt || options.brief || options.topic || options.broadcastPrompt);
}

function buildBroadcastInputFromPrompt(prompt, options = {}) {
  const cleanPrompt = normalizePromptText(prompt);
  const topic = deriveBroadcastTopic(cleanPrompt);
  const segments = splitBroadcastPromptClauses(cleanPrompt).slice(0, MAX_STORY_COUNT);
  const storySeeds = segments.length ? segments : [`${topic}的核心消息`, `${topic}的影响和后续`];
  const stories = storySeeds.map((segment, index) => buildPromptStory(segment, index, topic, cleanPrompt));
  const title = deriveBroadcastTitle(cleanPrompt, topic);
  return {
    source: 'prompt',
    originalPrompt: cleanPrompt,
    seriesTitle: options.seriesTitle || 'News Broadcast',
    title,
    subtitle: deriveBroadcastSubtitle(cleanPrompt),
    date: options.date || '',
    language: options.language || 'zh-CN',
    narratorLabel: options.narratorLabel || 'NEWS DESK',
    cover: {
      dek: 'A concise briefing built for quick understanding.',
      caption: 'A quick scan of the main signal.',
      closeCaption: 'That is the briefing.',
    },
    narration: {
      text: buildNarrationFromPrompt({ title, prompt: cleanPrompt, stories }),
      durationSeconds: Math.max(20, Math.min(90, 12 + stories.length * 10)),
    },
    stories,
    quickHits: buildPromptQuickHits(cleanPrompt, topic),
  };
}

function deriveBroadcastTopic(prompt) {
  const firstClause = splitBroadcastPromptClauses(prompt)[0] || normalizePromptText(prompt) || '播报主题';
  const cleaned = firstClause
    .replace(/^(请|帮我|麻烦|我想|想要|给我|做个|做一个|做一期|做一条|生成|制作|播报一下|播报|讲讲|介绍一下|说说|聊聊)\s*/u, '')
    .replace(/^(今天|本期|这期|这条|这次)\s*/u, '')
    .replace(/^(关于|围绕|主题是|内容是|请播报|要播报|播报)\s*/u, '')
    .trim();
  return truncateText(cleaned || firstClause, 18);
}

function deriveBroadcastTitle(prompt, topic) {
  const source = topic || deriveBroadcastTopic(prompt);
  return source ? `${source}简报` : '播报简报';
}

function deriveBroadcastSubtitle(prompt) {
  const text = normalizePromptText(prompt);
  if (!text) return '';
  return truncateText(text, 54);
}

function splitBroadcastPromptClauses(prompt) {
  return normalizePromptText(prompt)
    .split(/(?:\n+|[。！？!?；;]+|\b\d+[.)、]\s*)/u)
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function buildPromptStory(segment, index, topic, prompt) {
  const cleanSegment = normalizePromptText(segment);
  const title = makePromptStoryTitle(cleanSegment, index, topic);
  return {
    id: `story-${index + 1}`,
    title,
    summary: `${title}，把这条播报的重点讲清楚。原始 brief：${truncateText(prompt || cleanSegment || topic, 96)}`,
    takeaway: index === 0 ? `先让观众记住 ${topic || title}。` : `继续补充 ${title} 的影响和后续。`,
    source: '',
    bullets: [
      index === 0 ? '先交代最重要的事实。' : '再补一条可验证的信号。',
      `Brief source: ${truncateText(cleanSegment || topic || prompt, 100)}`,
    ],
    durationSeconds: 12,
  };
}

function makePromptStoryTitle(segment, index, topic) {
  const cleaned = normalizePromptText(segment)
    .replace(/^(首先|其次|再者|另外|然后|接着|最后|第一|第二|第三)\s*/u, '')
    .replace(/^(关注|重点看|先看|再看|最后看)\s*/u, '')
    .trim();
  if (cleaned) return truncateText(cleaned, 16);
  if (index === 0) return topic || '核心消息';
  if (index === 1) return `${topic || '影响'}解读`;
  return `${topic || '后续'}观察`;
}

function buildPromptQuickHits(prompt, topic) {
  const text = normalizePromptText(prompt);
  if (!text) return [];
  return [{ label: topic || 'Brief', text: truncateText(text, 80) }];
}

function buildNarrationFromPrompt({ title, prompt, stories }) {
  const lines = [`${title}。`];
  if (prompt) lines.push(`今天我们关注：${prompt}。`);
  stories.forEach((story, index) => {
    lines.push(`第 ${index + 1} 条，${story.title}。${story.summary}`);
  });
  lines.push('以上是本期播报。');
  return lines.join(' ');
}

function normalizePromptText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function truncateText(value, limit) {
  const text = normalizePromptText(value);
  if (!text) return '';
  return text.length > limit ? `${text.slice(0, Math.max(0, limit - 1))}…` : text;
}

function normalizeStory(story, index) {
  const title = requiredString(story.title || story.headline, `input.stories[${index}].title`);
  return {
    id: story.id || `story-${index + 1}`,
    title,
    summary: story.summary || story.dek || story.description || '',
    takeaway: story.takeaway || story.signal || '',
    source: story.source || story.url || '',
    visual: {
      file: story.visual?.file || story.visualFile || story.visual_file,
      caption: story.visual?.caption || '',
      alt: story.visual?.alt || '',
    },
    visualGrammar: story.visualGrammar || story.visual_grammar || story.grammar || '',
    visualGrammarKey: story.visualGrammarKey || story.visual_grammar_key || '',
    visualGrammarId: story.visualGrammarId || story.visual_grammar_id || '',
    bullets: asArray(story.bullets || story.points).map(String).filter(Boolean).slice(0, 4),
    durationSeconds: Number(story.durationSeconds || story.duration_seconds || DEFAULT_STORY_SECONDS),
  };
}

function normalizeQuickHit(item) {
  if (typeof item === 'string') return { label: '', text: item };
  return { label: item.label || item.title || '', text: item.text || item.summary || '' };
}

function buildStoryboard(payload) {
  let cursor = 0;
  const scenes = [];
  scenes.push({
    id: 'cover',
    start: cursor,
    duration: DEFAULT_COVER_SECONDS,
    title: payload.title,
    subtitle: payload.subtitle,
  });
  cursor += DEFAULT_COVER_SECONDS;
  for (const story of payload.stories) {
    const duration = clampDuration(story.durationSeconds, 8, 18);
    scenes.push({ id: story.id, start: cursor, duration, title: story.title, source: story.source });
    cursor += duration;
  }
  const closeBaseDuration = payload.quickHits.length ? DEFAULT_CLOSE_SECONDS + 4 : DEFAULT_CLOSE_SECONDS;
  const closeDuration = Math.max(closeBaseDuration, targetTotalDuration(payload) - cursor);
  scenes.push({
    id: 'close',
    start: cursor,
    duration: closeDuration,
    title: payload.quickHits.length ? 'Quick hits' : 'Closing',
  });
  cursor += closeDuration;
  return {
    meta: {
      title: payload.title,
      date: payload.date,
      language: payload.language,
      durationSeconds: round(cursor),
      narrationDurationSeconds: narrationDuration(payload) || undefined,
    },
    scenes,
  };
}

function totalDuration(payload) {
  return targetTotalDuration(payload);
}

function baseVisualDuration(payload) {
  return DEFAULT_COVER_SECONDS
    + payload.stories.reduce((sum, story) => sum + clampDuration(story.durationSeconds, 8, 18), 0)
    + (payload.quickHits.length ? DEFAULT_CLOSE_SECONDS + 4 : DEFAULT_CLOSE_SECONDS);
}

function targetTotalDuration(payload) {
  const visualDuration = baseVisualDuration(payload);
  const audioDuration = narrationDuration(payload);
  if (!audioDuration) return visualDuration;
  return Math.max(visualDuration, Math.ceil(audioDuration + NARRATION_TAIL_PAD_SECONDS));
}

function narrationDuration(payload) {
  const duration = Number(payload.narration?.durationSeconds || 0);
  return Number.isFinite(duration) && duration > 0 ? duration : 0;
}

function shouldGenerateStoryVisuals(options, payload) {
  if (options.generateStoryVisuals === false) return false;
  return missingVisualStories(payload).length > 0;
}

async function ensureNarrationDuration({ payload, sidecar, deps, source }) {
  const audioPath = payload.narration.audioFile;
  const measured = audioPath ? await probeAudioDurationSeconds(audioPath, deps) : 0;
  if (measured > 0) {
    payload.narration.durationSeconds = measured;
    if (sidecar?.summary) sidecar.summary.measuredDurationSeconds = measured;
    return measured;
  }
  return narrationDuration(payload);
}

async function probeAudioDurationSeconds(filePath, deps) {
  const probe = deps.probeAudioDuration || defaultProbeAudioDuration;
  return await probe(filePath);
}

async function defaultProbeAudioDuration(filePath) {
  const { spawn } = await import('node:child_process');
  return await new Promise((resolve) => {
    const child = spawn('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'json',
      filePath,
    ], { stdio: ['ignore', 'pipe', 'ignore'] });
    let stdout = '';
    child.stdout.on('data', (chunk) => { stdout += String(chunk); });
    child.on('error', () => resolve(0));
    child.on('close', (code) => {
      if (code !== 0) return resolve(0);
      try {
        const parsed = JSON.parse(stdout);
        const duration = Number(parsed?.format?.duration || 0);
        resolve(Number.isFinite(duration) ? duration : 0);
      } catch {
        resolve(0);
      }
    });
  });
}

function imageRegistryId(modelKey) {
  const preset = resolveTaskPreset('image', modelKey || DEFAULT_VISUAL_MODEL);
  return preset.id;
}

function missingVisualStories(payload) {
  return payload.stories
    .map((story, index) => ({ story, index }))
    .filter(({ story }) => !story.visual?.file);
}

function storyVisualPrompt({ payload, story, index }) {
  const storyNumber = String(index + 1).padStart(2, '0');
  const visualNotes = [story.summary, story.takeaway].filter(Boolean).join(' ');
  const grammarLabel = story.visualGrammarLabel || VISUAL_GRAMMAR_LIBRARY[story.visualGrammar]?.label || VISUAL_GRAMMAR_LIBRARY.signal_board.label;
  const grammarMotion = story.visualGrammarMotion || VISUAL_GRAMMAR_LIBRARY[story.visualGrammar]?.motion || VISUAL_GRAMMAR_LIBRARY.signal_board.motion;
  const grammarKey = story.visualGrammar || 'signal_board';
  const layoutKey = grammarLayoutKey(grammarKey);
  const promptHint = normalizePromptHint(story, grammarKey);
  const styleNote = payload.visualStyleNote || DEFAULT_LOOK_AND_FEEL;
  return [
    `Use case: ${promptHint.useCase}`,
    'Asset type: editorial visual plate for a news broadcast story',
    `Primary request: create one strong portrait-format story plate for story ${storyNumber} in the broadcast "${payload.title}".`,
    `Canvas / slot: ${DEFAULT_WIDTH}x${DEFAULT_HEIGHT} portrait video scene, generated as ${DEFAULT_VISUAL_ASPECT_RATIO} story plate for later HyperFrames placement.`,
    'Glance target: a non-expert viewer should understand the story in about 2-4 seconds before narration finishes explaining it.',
    `Story headline: ${story.title}`,
    `Story context: ${visualNotes || 'Use the headline as the visual thesis.'}`,
    `Visual grammar: ${grammarLabel} (${grammarKey}).`,
    `Visual grammar layout: ${grammarLayoutSummary(layoutKey)}.`,
    `Grammar motion: ${grammarMotion}.`,
    `Composition direction: ${promptHint.composition}`,
    `Safe zones: ${promptHint.safeZones}`,
    `Audience: ${payload.audienceProfile || DEFAULT_AUDIENCE_PROFILE}.`,
    `Style note: ${styleNote}.`,
    'Scene/backdrop: an official bulletin or security-education plate, document-forward and restrained, not a generic dashboard or text box.',
    'Subject: the key subject, object, or system implied by the story.',
    'Style/medium: documentary-style official bulletin art direction with structured composition and controlled negative space.',
    'Composition/framing: strong focal point, room for later text overlays, no dense typography, no decorative UI framing.',
    'Lighting/mood: sober, clear, authoritative, newspaper-report or bulletin-board calm, not playful or noisy.',
    'Color palette: paper white, graphite gray, deep navy, and restrained warning red accents; keep saturation low and hierarchy clear.',
    'Materials/textures: paper, file tabs, printed dossier surfaces, restrained evidence-board textures, tailored to the story domain.',
    'Text (verbatim): none, avoid readable paragraphs or fake UI copy.',
    'Constraints: do not repeat the same layout as the other story plates; the layout family must materially change the geometry, not just the labels; do not generate generic large headline blocks; leave a clear hero subject; avoid stock-photo blandness; avoid commercial gloss.',
    'Avoid: identical template cards, thick boxed text, random icons, fake logos, watermarks, unreadable lettering, empty placeholder rectangles, or upbeat promotional styling.',
    `Why this grammar: ${story.visualGrammarReason || grammarReason(story, grammarKey, payload)}`,
  ].join('\n');
}

function normalizePromptHint(story, grammarKey) {
  const fallback = VISUAL_GRAMMAR_PROMPT_HINTS[grammarKey] || VISUAL_GRAMMAR_PROMPT_HINTS.signal_board;
  return {
    useCase: story.visualGrammarUseCase || fallback.useCase,
    composition: story.visualGrammarComposition || fallback.composition,
    safeZones: story.visualGrammarSafeZones || fallback.safeZones,
  };
}

function firstImagePath(result) {
  const file = result.localFiles?.find((item) => item.kind === 'image' && (item.path || item.localPath));
  if (file?.path || file?.localPath) return file.path || file.localPath;
  const artifact = result.artifacts?.find((item) => item.kind === 'image' && (item.localPath || item.url));
  return artifact?.localPath || artifact?.url;
}

function renderDesignMarkdown(payload) {
  return `# ${payload.seriesTitle} HyperFrames Broadcast

## Visual Identity

- Format: 1080x1920 portrait news briefing.
- Register: brand/editorial surface. The design is part of the video product, not only decoration.
- Scene sentence: a busy operator catches a one-minute briefing on a phone during a bright commute, so the surface stays light, high-contrast, and instantly scannable.
- Audience default: ${DEFAULT_AUDIENCE_PROFILE}. Confirm before generation if the target shifts to a professional group.
- Style preset default: ${DEFAULT_STYLE_PRESET}. Confirm the final look and feel, typography scale, corner treatment, and density before generation.
- Color strategy: full palette with tinted neutrals, broadcast blue, signal green, warm red, and brass. Colors are defined in OKLCH in the HTML template.
- Typography: large newspaper-scale headlines, compact humanist sans body, and short mono labels for broadcast metadata.
- Motion: decisive editorial reveals with exponential-feeling ease-out timing. No bounce, elastic, or layout-property animation.

## Content

- Title: ${payload.title}
- Date: ${payload.date || 'not specified'}
- Stories: ${payload.stories.map((story) => story.title).join(' / ')}

## Impeccable-Inspired Broadcast Adapter

- This workflow references Impeccable as a design-review influence, but does not vendor or copy Impeccable source files.
- Avoid generic AI-video clichés: gradient text, glassmorphism-by-default, nested cards, identical card grids, and colored side-stripe callouts.
- Every story frame should answer one question fast: what happened, why it matters, and what signal the viewer should retain.
- The template can be polished with an external Impeccable pass, especially brand, typeset, layout, animate, and polish.

## Confirmation Gates

1. Confirm audience profile before generation.
2. Confirm visual style and the final Impeccable-inspired look and feel.
3. Confirm each story's visual grammar choice from \`commercial-visual-motion-grammar\` or the supplied visual grammar library.
4. Confirm TTS voice by preview before full narration synthesis.
5. Confirm full synthesized narration audio before visual generation or render.
6. Confirm BGM style, then confirm the selected BGM preview before mix/render use.
7. Confirm GPT image prompts before any GPT image request is sent.
8. Confirm generated GPT image plates before HyperFrames project generation.
9. Confirm the HyperFrames project and storyboard before final render.
10. Final delivery must include input JSON, narration script, TTS preview, full narration audio, BGM choice/preview, GPT image prompts and outputs, visual grammar picks and reasons, DESIGN.md, storyboard, HyperFrames project, review frames, duration checks, and warnings.

## Guardrails

- HTML is the source of truth.
- Keep every story readable in 2-4 seconds.
- Avoid private keys, signed URLs, or production-only notes in visible copy.
- Render through HyperFrames; do not replace the video with a static export.
- Final delivery must include the input JSON, narration script, TTS preview, full narration audio, BGM choice/preview, GPT image prompts and outputs, visual grammar picks and reasons, DESIGN.md, storyboard, HyperFrames project, review frames, duration checks, and warnings.
`;
}

function buildConfirmationPlan({ payload, normalized, visualGrammarLibrary = VISUAL_GRAMMAR_LIBRARY }) {
  const audienceProfile = normalized.audienceProfile || payload.audienceProfile || DEFAULT_AUDIENCE_PROFILE;
  const visualStylePreset = normalized.visualStylePreset || payload.visualStylePreset || DEFAULT_STYLE_PRESET;
  const visualStyleNote = normalized.visualStyleNote || payload.visualStyleNote || DEFAULT_LOOK_AND_FEEL;
  const libraryMeta = grammarCatalogMeta(visualGrammarLibrary);
  const ttsVoice = {
    platform: normalized.voicePlatform,
    name: normalized.voiceName,
    id: normalized.voiceId || null,
    previewText: DEFAULT_TTS_PREVIEW_TEXT,
  };
  const bgmStyle = normalized.bgmStyle || payload.bgm?.style || DEFAULT_BGM_STYLE;
  const stories = payload.stories.map((story) => {
    const visualGrammar = story.visualGrammar || selectVisualGrammar(story, 0, payload, visualGrammarLibrary);
    const grammarInfo = getGrammarEntry(visualGrammarLibrary, visualGrammar) || getGrammarEntry(VISUAL_GRAMMAR_LIBRARY, visualGrammar) || VISUAL_GRAMMAR_LIBRARY.signal_board;
    return {
      storyId: story.id,
      title: story.title,
      summary: story.summary,
      takeaway: story.takeaway,
      visualGrammar,
      visualGrammarLabel: grammarInfo.label,
      visualGrammarReason: story.visualGrammarReason || grammarReason(story, visualGrammar, payload, visualGrammarLibrary),
      visualGrammarMotion: grammarInfo.motion,
      visualGrammarComposition: grammarInfo.composition || story.visualGrammarComposition || '',
      visualGrammarSafeZones: grammarInfo.safeZones || story.visualGrammarSafeZones || '',
      visualGrammarUseCase: grammarInfo.useCase || story.visualGrammarUseCase || '',
      visualGrammarExampleImage: grammarInfo.exampleImage,
      visualGrammarSource: libraryMeta.name || 'built-in-commercial-visual-motion-grammar',
      promptTarget: `Use ${grammarInfo.label} for this story plate and keep the motion logic aligned with ${grammarInfo.motion}.`,
    };
  });

  return {
    audienceProfile,
    visualStylePreset,
    visualStyleNote,
    visualGrammarLibrary: {
      name: libraryMeta.name || 'built-in-commercial-visual-motion-grammar',
      description: libraryMeta.description || '',
      sourceType: libraryMeta.sourceType || 'built-in',
      gallery: VISUAL_GRAMMAR_GALLERY_PATH,
      grammars: visualGrammarCatalogSummary(visualGrammarLibrary),
    },
    revisionOptions: DELIVERY_REVISION_OPTIONS,
    visualGrammarExpansion: VISUAL_GRAMMAR_EXPANSION_STEPS,
    ttsVoice,
    bgmStyle,
    stories,
    gates: [
      { id: 'audience', title: 'Audience', approved: Boolean(normalized.confirmationApproved), status: 'needs-user-confirmation' },
      { id: 'audience_style', title: 'Audience And Visual Style', approved: Boolean(normalized.audienceStyleApproved), status: 'needs-user-confirmation' },
      { id: 'story_plan', title: 'Story Objective And Visual Grammar', approved: Boolean(normalized.storyPlanApproved), status: 'needs-user-confirmation' },
      { id: 'tts', title: 'TTS Voice', approved: Boolean(normalized.ttsPreviewApproved), status: 'needs-user-confirmation' },
      { id: 'narration_audio', title: 'Full Narration Audio', approved: Boolean(normalized.narrationAudioApproved), status: 'needs-user-confirmation' },
      { id: 'bgm_style', title: 'BGM Style', approved: Boolean(normalized.bgmStyleApproved), status: 'needs-user-confirmation' },
      { id: 'bgm_preview', title: 'BGM Track Preview', approved: Boolean(normalized.bgmPreviewApproved), status: 'needs-user-confirmation' },
      { id: 'visual_prompt_plan', title: 'Per-story GPT Image Prompts', approved: Boolean(normalized.visualPromptPlanApproved), status: 'needs-user-confirmation' },
      { id: 'visual_plates', title: 'Generated Story Visual Plates', approved: Boolean(normalized.visualPlatesApproved), status: 'needs-user-confirmation' },
      { id: 'hyperframes', title: 'HyperFrames Project', approved: Boolean(normalized.hyperframesApproved), status: 'needs-user-confirmation' },
    ],
  };
}

function confirmationSummary(plan) {
  return {
    audienceProfile: plan.audienceProfile,
    visualStylePreset: plan.visualStylePreset,
    visualStyleNote: plan.visualStyleNote,
    visualGrammarLibrary: plan.visualGrammarLibrary,
    revisionOptions: plan.revisionOptions,
    visualGrammarExpansion: plan.visualGrammarExpansion,
    ttsVoice: plan.ttsVoice,
    bgmStyle: plan.bgmStyle,
    storyCount: plan.stories.length,
    gates: plan.gates,
  };
}

function decorateBroadcastPayload(payload, normalized, visualGrammarLibrary = VISUAL_GRAMMAR_LIBRARY) {
  const libraryMeta = grammarCatalogMeta(visualGrammarLibrary);
  const stories = payload.stories.map((story, index) => {
    const visualGrammar = selectVisualGrammar(story, index, payload, visualGrammarLibrary);
    const grammarInfo = getGrammarEntry(visualGrammarLibrary, visualGrammar) || getGrammarEntry(VISUAL_GRAMMAR_LIBRARY, visualGrammar) || VISUAL_GRAMMAR_LIBRARY.signal_board;
    return {
      ...story,
      visualGrammar,
      visualGrammarLabel: grammarInfo.label,
      visualGrammarReason: grammarReason(story, visualGrammar, payload, visualGrammarLibrary),
      visualGrammarMotion: grammarInfo.motion,
      visualGrammarComposition: grammarInfo.composition || '',
      visualGrammarSafeZones: grammarInfo.safeZones || '',
      visualGrammarUseCase: grammarInfo.useCase || '',
      visualGrammarExampleImage: grammarInfo.exampleImage,
      visualGrammarSource: libraryMeta.name || 'built-in-commercial-visual-motion-grammar',
    };
  });
  return {
    ...payload,
    audienceProfile: normalized.audienceProfile || payload.audienceProfile || DEFAULT_AUDIENCE_PROFILE,
    visualStylePreset: normalized.visualStylePreset || payload.visualStylePreset || DEFAULT_STYLE_PRESET,
    visualStyleNote: normalized.visualStyleNote || payload.visualStyleNote || DEFAULT_LOOK_AND_FEEL,
    bgm: {
      ...payload.bgm,
      style: normalized.bgmStyle || payload.bgm?.style || DEFAULT_BGM_STYLE,
    },
    stories,
  };
}

function grammarReason(story, grammar, payload, visualGrammarLibrary = VISUAL_GRAMMAR_LIBRARY) {
  const grammarInfo = getGrammarEntry(visualGrammarLibrary, grammar) || getGrammarEntry(VISUAL_GRAMMAR_LIBRARY, grammar) || VISUAL_GRAMMAR_LIBRARY.signal_board;
  const libraryMeta = grammarCatalogMeta(visualGrammarLibrary);
  const source = libraryMeta.name ? ` from ${libraryMeta.name}` : '';
  return `Selected ${grammarInfo.label}${source} because this story is about ${shortStorySignal(story, payload)} and the plate should move like ${grammarInfo.motion}.`;
}

function shortStorySignal(story, payload) {
  return [story.title, story.summary, story.takeaway, payload.title].filter(Boolean).slice(0, 2).join(' / ');
}

async function persistConfirmationPlan({ paths, payload, normalized, confirmationPlan }) {
  const markdown = renderConfirmationPlanMarkdown(confirmationPlan, payload);
  const markdownPath = await persistTextFile(paths.textsDir, 'confirmation-plan.md', markdown);
  const jsonPath = await persistTextFile(paths.textsDir, 'confirmation-plan.json', JSON.stringify(confirmationPlan, null, 2));
  return makeSidecar({
    stepId: CONFIRMATION_STEP_ID,
    name: 'confirmation-plan',
    status: normalized.confirmationPlanOnly || !normalized.confirmationApproved ? 'planned' : 'success',
    localFiles: [
      { kind: 'text', name: 'confirmation-plan', path: markdownPath },
      { kind: 'text', name: 'confirmation-plan-json', path: jsonPath },
    ],
    summary: confirmationSummary(confirmationPlan),
  });
}

async function persistAudienceStyleGate({ paths, payload, normalized, confirmationPlan }) {
  const markdown = renderAudienceStyleGateMarkdown(confirmationPlan, payload);
  const markdownPath = await persistTextFile(paths.textsDir, 'audience-style-gate.md', markdown);
  return makeSidecar({
    stepId: AUDIENCE_CONFIRMATION_STEP_ID,
    name: 'audience-style-gate',
    status: 'planned',
    localFiles: [{ kind: 'text', name: 'audience-style-gate', path: markdownPath }],
    summary: {
      audienceProfile: confirmationPlan.audienceProfile,
      visualStylePreset: confirmationPlan.visualStylePreset,
      visualStyleNote: confirmationPlan.visualStyleNote,
    },
  });
}

async function persistStoryPlanGate({ paths, payload, normalized, confirmationPlan }) {
  const markdown = renderStoryPlanGateMarkdown(confirmationPlan, payload);
  const markdownPath = await persistTextFile(paths.textsDir, 'story-plan-gate.md', markdown);
  const jsonPath = await persistTextFile(paths.textsDir, 'story-plan-gate.json', JSON.stringify(confirmationPlan.stories, null, 2));
  return makeSidecar({
    stepId: STORY_PLAN_CONFIRMATION_STEP_ID,
    name: 'story-plan-gate',
    status: 'planned',
    localFiles: [
      { kind: 'text', name: 'story-plan-gate', path: markdownPath },
      { kind: 'text', name: 'story-plan-gate-json', path: jsonPath },
    ],
    summary: {
      storyCount: confirmationPlan.stories.length,
      stories: confirmationPlan.stories.map((story) => ({
      storyId: story.storyId,
      title: story.title,
      visualGrammar: story.visualGrammar,
      visualGrammarLabel: story.visualGrammarLabel,
      visualGrammarSource: story.visualGrammarSource,
    })),
    },
  });
}

async function persistNarrationReviewGate({ paths, payload, normalized }) {
  const markdown = renderNarrationReviewGateMarkdown(payload, normalized);
  const markdownPath = await persistTextFile(paths.textsDir, 'narration-review-gate.md', markdown);
  const audioPath = payload.narration.audioFile ? await copyOptionalAsset(payload.narration.audioFile, paths.audioDir, 'narration-review') : undefined;
  const localFiles = [{ kind: 'text', name: 'narration-review-gate', path: markdownPath }];
  if (audioPath) localFiles.unshift({ kind: 'audio', name: 'narration-review', path: audioPath });
  return makeSidecar({
    stepId: NARRATION_REVIEW_STEP_ID,
    name: 'narration-review',
    status: 'planned',
    localFiles,
    summary: {
      narrationAudioFile: payload.narration.audioFile || '',
      measuredDurationSeconds: payload.narration.durationSeconds || 0,
      reviewInstruction: 'Play the full narration before continuing.',
    },
  });
}

async function persistBgmStyleGate({ paths, payload, normalized }) {
  const markdown = renderBgmStyleGateMarkdown(payload, normalized);
  const markdownPath = await persistTextFile(paths.textsDir, 'bgm-style-gate.md', markdown);
  return makeSidecar({
    stepId: BGM_STYLE_STEP_ID,
    name: 'bgm-style-gate',
    status: 'planned',
    localFiles: [{ kind: 'text', name: 'bgm-style-gate', path: markdownPath }],
    summary: {
      bgmStyle: normalized.bgmStyle || payload.bgm?.style || DEFAULT_BGM_STYLE,
      hasBgmFile: Boolean(payload.bgm?.file),
    },
  });
}

async function planStoryVisualPrompts({ paths, payload, normalized, hasGeneratedVisuals }) {
  const visualStories = missingVisualStories(payload);
  const promptManifest = [];
  const textArtifacts = [];

  for (const { story, index } of visualStories) {
    const prompt = storyVisualPrompt({ payload, story, index });
    promptManifest.push({
      storyId: story.id,
      title: story.title,
      visualGrammar: story.visualGrammar,
      visualGrammarLabel: story.visualGrammarLabel,
      visualGrammarReason: story.visualGrammarReason,
      visualGrammarSource: story.visualGrammarSource,
      visualGrammarComposition: story.visualGrammarComposition,
      visualGrammarSafeZones: story.visualGrammarSafeZones,
      prompt,
    });
    textArtifacts.push({
      name: `story-${index + 1}-visual-prompt`,
      path: await persistTextFile(paths.textsDir, `story-${index + 1}-visual-prompt.txt`, prompt),
    });
  }

  return makeSidecar({
    stepId: VISUAL_PROMPT_STEP_ID,
    name: 'story-visual-prompts',
    status: 'planned',
    registryId: imageRegistryId(normalized.visualModel),
    textArtifacts: [
      ...textArtifacts,
      { name: 'story-visual-prompts', path: await persistTextFile(paths.textsDir, 'story-visual-prompts.json', JSON.stringify(promptManifest, null, 2)) },
    ],
    summary: {
      mode: 'prompt-plan-only',
      model: normalized.visualModel,
      aspectRatio: normalized.visualAspectRatio,
      resolution: normalized.visualResolution,
      timeoutMs: normalized.visualTimeoutMs,
      storyCount: visualStories.length,
      hasGeneratedVisuals,
      requiresApproval: true,
    },
  });
}

function renderConfirmationPlanMarkdown(plan, payload) {
  const stories = plan.stories.map((story, index) => {
    const item = story;
    const exampleImage = item.visualGrammarExampleImage || {};
    return [
      `### Story ${index + 1}: ${item.title}`,
      `- Grammar: ${item.visualGrammarLabel} (\`${item.visualGrammar}\`)`,
      `- Library: ${item.visualGrammarSource || plan.visualGrammarLibrary?.name || 'built-in-commercial-visual-motion-grammar'}`,
      renderExampleImageMarkdown(exampleImage, `${item.visualGrammarLabel} example`),
      `- Why: ${item.visualGrammarReason}`,
      `- Motion: ${item.visualGrammarMotion}`,
      exampleImage.alt ? `- Example image: ${exampleImage.alt}` : '',
      exampleImage.prompt ? `- Example prompt: ${exampleImage.prompt}` : '',
    ].filter(Boolean).join('\n');
  }).join('\n\n');

  const grammarLibraryLines = (plan.visualGrammarLibrary?.grammars || []).map((item) => {
    const exampleImage = item.exampleImage || {};
    return [
      `- ${item.label} (\`${item.key}\`)`,
      `  - Best for: ${item.bestFor || 'not specified'}`,
      `  - Motion: ${item.motion || 'not specified'}`,
      exampleImage.path || exampleImage.url ? `  - Preview: ${exampleImage.path || exampleImage.url}` : '',
      exampleImage.alt ? `  - Example: ${exampleImage.alt}` : '  - Example: not provided',
    ].filter(Boolean).join('\n');
  }).join('\n');
  const revisionLines = plan.revisionOptions.map((item) => `- ${item.area}: ${item.examples.join(' / ')}`).join('\n');
  const expansionLines = plan.visualGrammarExpansion.map((line) => `- ${line}`).join('\n');

  return `# Broadcast Confirmation Plan

## Audience

- Recommended audience: ${plan.audienceProfile}
- Confirm whether this is for beginners, professionals, or a mixed audience before generation.

## Visual Style

- Recommended preset: ${plan.visualStylePreset}
- Look and feel: ${plan.visualStyleNote}
- Confirm typography scale, density, edges/corners, and overall polish before proceeding.

## TTS

- Voice platform: ${plan.ttsVoice.platform}
- Voice name: ${plan.ttsVoice.name}
- Voice id: ${plan.ttsVoice.id || 'recommended by catalog'}
- Preview text: ${plan.ttsVoice.previewText}

## BGM

- Recommended style: ${plan.bgmStyle}
- If the user has a track, preview it first and ask for approval before mix/render.

## Story Grammars

- Library: ${plan.visualGrammarLibrary?.name || 'built-in-commercial-visual-motion-grammar'}

### Built-in visual grammar library

${grammarLibraryLines}

### You can still revise

${revisionLines}

### How to expand the grammar library

${expansionLines}

${stories}

## Payload Reminder

- Title: ${payload.title}
- Stories: ${payload.stories.length}
- Final delivery includes the MP4, but it also keeps the editable project, prompts, story grammar choices, and review materials so you can keep adjusting after delivery.
`;
}

function renderAudienceStyleGateMarkdown(plan, payload) {
  return `# 确认受众和整体风格

## 当前进度

- 我已经把这期播报整理好了，现在要先定这条视频给谁看、长什么样。

## 下一步请你确认

- 推荐受众：${plan.audienceProfile}
- 推荐风格：${plan.visualStylePreset}
- 画面感觉：${plan.visualStyleNote}
- 你可以告诉我这是给小白、专业观众，还是某个具体群体看的。

## 确认后我会继续

- 我会继续细化每条故事的讲法和画面语法，再往下做配音、图片和项目。

## 播报标题

- ${payload.title}
- 共 ${payload.stories.length} 条故事
`;
}

function renderStoryPlanGateMarkdown(plan, payload) {
  const lines = plan.stories.map((story, index) => {
    const exampleImage = story.visualGrammarExampleImage || {};
    return [
      `## 第 ${index + 1} 条：${story.title}`,
      `- 这条新闻要讲清楚什么：${story.summary || story.takeaway || '请帮观众在 2 到 4 秒内看懂重点。'}`,
      `- 画面语法：${story.visualGrammarLabel} (\`${story.visualGrammar}\`)`,
      `- 来源：${story.visualGrammarSource || plan.visualGrammarLibrary?.name || 'built-in-commercial-visual-motion-grammar'}`,
      '',
      '### 语法示意图',
      '',
      renderExampleImageMarkdown(exampleImage, `${story.visualGrammarLabel} 示意图`),
      '',
      '- 这张图只是画面结构方向，正式视频会基于这条新闻重新生成 story plate，并在 HyperFrames 里重建准确文案、标签和动效。',
      `- 大概长什么样：${exampleImage.alt || '这条 grammar 暂时还没有示例图描述。'}`,
      `- 示例图提示词：${exampleImage.prompt || '可以先补一张 exampleImage.prompt，再生成示例图。'}`,
      `- 为什么这样选：${story.visualGrammarReason}`,
      `- 画面怎么动：${story.visualGrammarMotion}`,
      `- 提示词目标：${story.promptTarget}`,
    ].join('\n');
  }).join('\n\n');

  return `# 确认每条故事怎么讲

## 当前进度

- 我在把每条新闻拆成更容易快速看懂的故事和画面方案。

## 下一步请你确认

- 每条故事最想让观众记住什么。
- 每条故事该用什么画面语法。
- 如果你想换语法，可以直接说 grammar key，比如 \`timeline_ribbon\`、\`verification_rail\`、\`metric_pulse\`。

## 确认后我会继续

- 我会开始做配音、图片提示词和画面素材。
- 后续交付后也还能继续调文案、视觉语法、动效节奏，或者一起扩充新的 visual grammar。

${lines}
`;
}

function renderExampleImageMarkdown(exampleImage = {}, fallbackAlt = 'Visual grammar example') {
  const source = exampleImage.path || exampleImage.url;
  if (!source) return '- 示意图：暂无示意图文件。';
  const imagePath = /^https?:\/\//.test(source) ? source : path.resolve(source);
  const alt = exampleImage.alt || fallbackAlt;
  return `![${escapeMarkdownAlt(alt)}](${imagePath})`;
}

function escapeMarkdownAlt(value) {
  return String(value || '')
    .replace(/\\/g, '\\\\')
    .replace(/]/g, '\\]');
}

function renderNarrationReviewGateMarkdown(payload, normalized) {
  return `# 确认播报配音

## 当前进度

- 我已经把整段播报音频准备好了，现在要请你听一遍，确认声音对不对。

## 下一步请你确认

- 平台：${normalized.voicePlatform}
- 声音：${normalized.voiceName}
- 声音 id：${normalized.voiceId || 'catalog default'}
- 音频文件：${payload.narration.audioFile || 'not yet persisted'}
- 时长：${payload.narration.durationSeconds || 0}s

## 确认后我会继续

- 我会继续生成画面和完整项目。
`;
}

function renderBgmStyleGateMarkdown(payload, normalized) {
  return `# 确认背景音乐方向

## 当前进度

- 我在给这条播报选背景音乐的方向。

## 下一步请你确认

- 推荐风格：${normalized.bgmStyle || payload.bgm?.style || DEFAULT_BGM_STYLE}
- 如果你已经有现成音乐，也可以直接发给我。

## 确认后我会继续

- 我会继续做预览、混音和最终项目。
`;
}

async function generateTtsPreviewWithShotFun({ normalized, payload, paths, deps }) {
  const generateAudio = deps.generateAudio || (await import('../services/audio-generation-service.js')).generateAudio;
  const previewText = DEFAULT_TTS_PREVIEW_TEXT;
  const result = await generateAudio({
    projectCode: normalized.projectCode,
    kind: 'preview',
    voicePlatform: normalized.voicePlatform,
    voiceName: normalized.voiceName,
    voiceId: normalized.voiceId,
    text: previewText,
    wait: true,
    agentOutput: true,
  });
  const textPath = await persistTextFile(paths.textsDir, 'tts-preview-text.txt', previewText);
  return makeSidecar({
    stepId: VOICE_PREVIEW_STEP_ID,
    name: 'tts-preview',
    status: 'planned',
    registryId: 'audio.tts_voice_preview',
    taskNo: result.taskNo,
    resultUrls: result.resultUrls,
    assetRefs: result.assetRefs,
    localFiles: result.localFiles,
    textArtifacts: [{ name: 'tts-preview-text', path: textPath }],
    summary: {
      kind: 'voice-preview',
      voicePlatform: normalized.voicePlatform,
      voiceName: normalized.voiceName,
      voiceId: normalized.voiceId,
      previewText,
      storyTitle: payload.title,
    },
  });
}

async function persistBgmPreview({ paths, payload, normalized }) {
  const previewText = `BGM style: ${normalized.bgmStyle || payload.bgm?.style || DEFAULT_BGM_STYLE}`;
  const localFiles = [];
  if (payload.bgm?.file) {
    const sourcePath = path.resolve(payload.bgm.file);
    const previewPath = path.join(paths.audioDir, `bgm-preview${path.extname(sourcePath) || '.bin'}`);
    await copyFile(sourcePath, previewPath);
    localFiles.push({ kind: 'audio', name: 'bgm-preview', path: previewPath });
  }
  const markdownPath = await persistTextFile(paths.textsDir, 'bgm-preview.md', [
    '# BGM Preview',
    '',
    `- Style: ${normalized.bgmStyle || payload.bgm?.style || DEFAULT_BGM_STYLE}`,
    `- Title: ${payload.bgm?.title || 'Selected by user or source input'}`,
    `- Attribution: ${payload.bgm?.attribution || 'Pending user selection'}`,
    `- Preview note: play the selected track for the user before final mix/render.`,
  ].join('\n'));
  return makeSidecar({
    stepId: BGM_PREVIEW_STEP_ID,
    name: 'bgm-preview',
    status: 'planned',
    localFiles: [
      ...localFiles,
      { kind: 'text', name: 'bgm-preview', path: markdownPath },
    ],
    summary: {
      bgmStyle: normalized.bgmStyle || payload.bgm?.style || DEFAULT_BGM_STYLE,
      title: payload.bgm?.title || '',
      attribution: payload.bgm?.attribution || '',
      previewText,
    },
  });
}

async function finishWorkflowRun({ paths, manifest, sidecars, plan, logger, dryRun, status, extra = {} }) {
  const userArtifacts = buildUserArtifacts(sidecars);
  const finalManifest = {
    ...manifest,
    status,
    finishedAt: new Date().toISOString(),
    steps: sidecars.map(summaryFromSidecar),
    userArtifacts,
    delivery: buildDeliverySummary({ status, plan, paths, manifest, userArtifacts }),
    ...extra,
  };
  await writeManifest(paths.runDir, finalManifest);
  await writeProjectRunSummary(paths, finalManifest);
  await logger.write({ event: 'workflow_end', status: finalManifest.status });
  return finalOutput({ plan, paths, manifest: finalManifest, userArtifacts, dryRun });
}

function buildDeliverySummary({ status, plan, paths, manifest, userArtifacts = [] }) {
  const storyGrammars = plan?.confirmationPlan?.stories?.map((story) => ({
    storyId: story.storyId,
    title: story.title,
    visualGrammar: story.visualGrammar,
    visualGrammarLabel: story.visualGrammarLabel,
    visualGrammarReason: story.visualGrammarReason,
    exampleImage: story.visualGrammarExampleImage,
  })) || [];
  const grammarLibrary = plan?.confirmationPlan?.visualGrammarLibrary || manifest?.confirmationPlan?.visualGrammarLibrary || {};
  const revisionOptions = plan?.confirmationPlan?.revisionOptions || DELIVERY_REVISION_OPTIONS;
  const visualGrammarExpansion = plan?.confirmationPlan?.visualGrammarExpansion || VISUAL_GRAMMAR_EXPANSION_STEPS;
  const renderedVideo = userArtifacts.find((item) => item.kind === 'video' && String(item.localPath || item.url || '').match(/\.(mp4|mov|m4v|webm)(\?|$)/));

  return {
    title: '交付说明',
    message: renderedVideo
      ? `我已经把这版播报视频和可编辑工程整理好了：最终视频是 ${renderedVideo.localPath || renderedVideo.url}。这不是一次性封稿，你还可以继续让我改文案、视觉语法、动效节奏、BGM 和单张画面。`
      : `我已经把这版播报视频工程整理好了，当前状态是 ${status}。你还可以继续让我改文案、视觉语法、动效节奏、BGM 和单张画面。`,
    outputDir: paths.runDir,
    manifest: paths.manifestPath,
    revisionOptions,
    visualGrammarLibrary: {
      name: grammarLibrary.name || 'built-in-commercial-visual-motion-grammar',
      sourceType: grammarLibrary.sourceType || 'built-in',
      gallery: grammarLibrary.gallery || VISUAL_GRAMMAR_GALLERY_PATH,
      grammars: grammarLibrary.grammars || visualGrammarCatalogSummary(),
    },
    visualGrammarExpansion,
    storyGrammars,
    nextAction: '你可以直接说想改哪一块，比如“第二条换成 timeline_ribbon”“口播更克制一点”“动效慢一点”“给我再加一种适合政策解读的 visual grammar”。',
  };
}

function maybeSummary(values) {
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined && value !== null && value !== ''));
}

function renderPackageJson(slug) {
  return `${JSON.stringify({
    name: slug,
    private: true,
    type: 'module',
    scripts: {
      check: 'npx --yes hyperframes@0.6.30 lint && npx --yes hyperframes@0.6.30 validate && npx --yes hyperframes@0.6.30 inspect',
      render: 'npx --yes hyperframes@0.6.30 render',
      preview: 'npx --yes hyperframes@0.6.30 preview',
    },
  }, null, 2)}\n`;
}

function renderHyperframesJson() {
  return `${JSON.stringify({
    $schema: 'https://hyperframes.heygen.com/schema/hyperframes.json',
    registry: 'https://raw.githubusercontent.com/heygen-com/hyperframes/main/registry',
    paths: { blocks: 'compositions', components: 'compositions/components', assets: 'assets' },
  }, null, 2)}\n`;
}

function renderIndexHtml({ payload, storyboard, normalized }) {
  const duration = storyboard.meta.durationSeconds;
  const storyScenes = storyboard.scenes.filter((scene) => scene.id !== 'cover' && scene.id !== 'close');
  const closeScene = storyboard.scenes.find((scene) => scene.id === 'close');
  const headerDate = payload.date || 'BROADCAST';
  const storyCards = payload.stories.map((story, index) => `
              <div class="cover-story"><em>${String(index + 1).padStart(2, '0')}</em><span>${escapeHtml(story.title)}</span></div>`).join('');
  const storySections = storyScenes.map((scene, index) => renderStorySection(payload.stories[index], scene, index)).join('\n');
  const quickRows = (payload.quickHits.length ? payload.quickHits : [{ label: 'NEXT', text: '继续关注下一条重要进展。' }])
    .slice(0, 4)
    .map((item) => `<div class="close-row"><em>${escapeHtml(item.label || '•')}</em><b>${escapeHtml(item.text)}</b></div>`)
    .join('\n');
  const audioTags = [
    payload.bgm?.file ? `<audio id="audio-bgm" class="clip" data-start="0" data-duration="${duration}" data-track-index="0" src="assets/${assetName(payload.bgm.file, 'bgm')}" data-volume="0.42"></audio>` : '',
    payload.narration.audioFile ? `<audio id="audio-tts" class="clip" data-start="0" data-duration="${payload.narration.durationSeconds || duration}" data-track-index="1" src="assets/${assetName(payload.narration.audioFile, 'narration')}" data-volume="1"></audio>` : '',
  ].filter(Boolean).join('\n      ');
  let storySceneIndex = -1;
  const scenesJs = storyboard.scenes.map((scene) => {
    const isStoryScene = scene.id !== 'cover' && scene.id !== 'close';
    const story = isStoryScene ? payload.stories[++storySceneIndex] : undefined;
    const layout = story ? grammarLayoutKey(normalizeGrammarKey(story.visualGrammar || 'signal_board')) : 'meta';
    return `{ id: "#scene-${cssId(scene.id)}", start: ${round(scene.start)}, duration: ${round(scene.duration)}, layout: "${layout}" }`;
  }).join(',\n        ');

  return `<!doctype html>
<html lang="${escapeHtml(payload.language)}">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
    <title>${escapeHtml(payload.title)}</title>
    <style>
      :root {
        --paper: oklch(94.8% 0.021 86);
        --paper-2: oklch(97.2% 0.017 82);
        --ink: oklch(22% 0.017 132);
        --muted: oklch(49% 0.029 135);
        --line: rgba(23, 27, 22, 0.2);
        --line-strong: rgba(23, 27, 22, 0.78);
        --blue: oklch(23% 0.105 259);
        --green: oklch(53% 0.13 158);
        --red: oklch(53% 0.17 34);
        --gold: oklch(61% 0.105 78);
        --mono: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
        --sans: "Avenir Next", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
        --serif: "Iowan Old Style", "Songti SC", "Times New Roman", serif;
      }
      * { box-sizing: border-box; }
      html, body {
        margin: 0;
        width: ${normalized.width}px;
        height: ${normalized.height}px;
        overflow: hidden;
        background: var(--paper);
        color: var(--ink);
        font-family: var(--sans);
      }
      #news-broadcast {
        position: relative;
        width: ${normalized.width}px;
        height: ${normalized.height}px;
        overflow: hidden;
        background:
          linear-gradient(90deg, rgba(30, 95, 201, 0.07), transparent 42%, rgba(10, 139, 98, 0.06)),
          linear-gradient(rgba(23, 27, 22, 0.045) 1px, transparent 1px),
          linear-gradient(90deg, rgba(23, 27, 22, 0.045) 1px, transparent 1px),
          var(--paper);
        background-size: auto, 128px 128px, 128px 128px, auto;
      }
      .frame {
        position: absolute;
        inset: 74px 46px;
        border: 2px solid rgba(173, 123, 53, 0.72);
        z-index: 30;
        pointer-events: none;
      }
      .header {
        position: absolute;
        top: 58px;
        left: 66px;
        right: 66px;
        z-index: 31;
        display: flex;
        justify-content: space-between;
        font-family: var(--mono);
        font-size: 24px;
        color: rgba(23, 27, 22, 0.72);
      }
      .progress {
        position: absolute;
        left: 70px;
        right: 70px;
        bottom: 92px;
        height: 8px;
        z-index: 31;
        background: rgba(23, 27, 22, 0.11);
      }
      .progress i {
        display: block;
        width: 100%;
        height: 100%;
        transform: scaleX(0);
        transform-origin: left center;
        background: linear-gradient(90deg, var(--blue), var(--green), var(--gold));
      }
      .scene, .cover-poster {
        position: absolute;
        inset: 0;
        overflow: hidden;
      }
      .scene {
        opacity: 0;
        z-index: 3;
      }
      .scene-shell {
        position: absolute;
        inset: 138px 80px 146px;
      }
      .kicker {
        font-family: var(--mono);
        font-size: 25px;
        line-height: 1;
        color: var(--blue);
        text-transform: uppercase;
      }
      .title {
        margin: 0;
        font-family: var(--serif);
        font-size: 76px;
        line-height: 1.08;
        font-weight: 900;
        letter-spacing: 0;
        max-width: 100%;
        overflow-wrap: anywhere;
        word-break: break-word;
      }
      .title .red { color: var(--red); }
      .dek {
        margin: 24px 0 0;
        max-width: 860px;
        font-size: 34px;
        line-height: 1.34;
        font-weight: 720;
        color: var(--muted);
      }
      .red-rule {
        width: 330px;
        height: 5px;
        background: var(--red);
        transform-origin: left center;
      }
      .caption {
        position: absolute;
        left: 0;
        right: 0;
        bottom: 0;
        min-height: 150px;
        display: flex;
        align-items: center;
        border-top: 3px solid var(--line-strong);
        border-bottom: 1px solid rgba(23, 27, 22, 0.25);
        padding: 0 18px;
        font-size: 34px;
        line-height: 1.25;
        font-weight: 820;
      }
      .cover-poster {
        z-index: 12;
        background:
          linear-gradient(90deg, rgba(30, 95, 201, 0.07), transparent 45%, rgba(10, 139, 98, 0.06)),
          linear-gradient(rgba(23, 27, 22, 0.045) 1px, transparent 1px),
          linear-gradient(90deg, rgba(23, 27, 22, 0.045) 1px, transparent 1px),
          var(--paper);
        background-size: auto, 128px 128px, 128px 128px, auto;
      }
      .cover-inner {
        position: absolute;
        inset: 74px 46px;
        border: 2px solid var(--gold);
        padding: 116px 34px 74px;
      }
      .cover-edition {
        display: flex;
        justify-content: space-between;
        font-family: var(--mono);
        font-size: 25px;
        color: rgba(23, 27, 22, 0.7);
      }
      .cover-kicker {
        margin-top: 176px;
        font-family: var(--mono);
        font-size: 28px;
        color: var(--red);
      }
      .cover-title {
        margin: 66px 0 0;
        max-width: 820px;
        font-family: var(--serif);
        font-size: 92px;
        line-height: 1.04;
        font-weight: 900;
        letter-spacing: 0;
        overflow-wrap: anywhere;
        word-break: break-word;
      }
      .cover-title b { color: var(--red); }
      .cover-dek {
        margin-top: 30px;
        max-width: 780px;
        font-size: 36px;
        line-height: 1.35;
        font-weight: 760;
        color: var(--muted);
      }
      .cover-stack {
        position: absolute;
        left: 34px;
        right: 34px;
        bottom: 342px;
        display: grid;
        grid-template-columns: repeat(${Math.min(payload.stories.length, 3)}, 1fr);
        gap: 18px;
      }
      .cover-story {
        min-height: 144px;
        border: 1px solid rgba(23, 27, 22, 0.18);
        background: rgba(255, 250, 241, 0.78);
        padding: 24px;
      }
      .cover-story em {
        display: block;
        font-family: var(--mono);
        font-size: 22px;
        font-style: normal;
        color: var(--ink);
      }
      .cover-story span {
        display: block;
        margin-top: 20px;
        font-size: 29px;
        line-height: 1.16;
        font-weight: 820;
        overflow-wrap: anywhere;
        word-break: break-word;
      }
      .cover-footer {
        position: absolute;
        left: 34px;
        right: 34px;
        bottom: 72px;
        display: flex;
        justify-content: space-between;
        font-family: var(--mono);
        font-size: 22px;
        color: rgba(23, 27, 22, 0.68);
        border-top: 1px solid var(--line);
        padding-top: 24px;
      }
      .story-shell {
        position: relative;
        height: 100%;
        padding-bottom: 176px;
      }
      .story-shell-head {
        position: relative;
        z-index: 4;
      }
      .story-shell-head .title {
        max-width: 820px;
      }
      .story-shell-head .dek {
        max-width: 810px;
      }
      .story-grid {
        display: grid;
        grid-template-columns: 0.98fr 1.02fr;
        gap: 34px;
        height: 100%;
        padding-bottom: 176px;
      }
      .story-grid-signal-board {
        grid-template-columns: 1.08fr 0.92fr;
      }
      .story-grid-timeline-ribbon {
        grid-template-columns: 0.9fr 1.1fr;
      }
      .story-grid-verification-rail {
        grid-template-columns: 0.84fr 1.16fr;
      }
      .story-copy {
        min-width: 0;
        display: flex;
        flex-direction: column;
        justify-content: center;
      }
      .story-visual {
        position: relative;
        height: 760px;
        align-self: center;
        border: 1px solid rgba(23, 27, 22, 0.18);
        background:
          linear-gradient(135deg, rgba(30, 95, 201, 0.12), rgba(10, 139, 98, 0.08)),
          rgba(255, 250, 241, 0.78);
        overflow: hidden;
      }
      .story-visual img {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        object-fit: cover;
        display: block;
      }
      .story-visual.no-image {
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 42px;
      }
      .story-visual-signal-board {
        background:
          linear-gradient(180deg, rgba(30, 95, 201, 0.14), rgba(255, 250, 241, 0.08) 22%, rgba(10, 139, 98, 0.12)),
          repeating-linear-gradient(0deg, rgba(23, 27, 22, 0.08) 0, rgba(23, 27, 22, 0.08) 1px, transparent 1px, transparent 92px),
          rgba(255, 250, 241, 0.72);
      }
      .story-visual-timeline-ribbon {
        background:
          linear-gradient(135deg, rgba(173, 123, 53, 0.14), rgba(255, 250, 241, 0.08) 28%, rgba(30, 95, 201, 0.1)),
          linear-gradient(90deg, rgba(23, 27, 22, 0.12) 0, rgba(23, 27, 22, 0.12) 4px, transparent 4px, transparent 100%),
          rgba(255, 250, 241, 0.72);
      }
      .story-visual-verification-rail {
        background:
          linear-gradient(180deg, rgba(30, 95, 201, 0.08), rgba(255, 250, 241, 0.08) 35%, rgba(204, 65, 43, 0.12)),
          linear-gradient(90deg, rgba(23, 27, 22, 0.16) 0, rgba(23, 27, 22, 0.16) 4px, transparent 4px, transparent 100%),
          rgba(255, 250, 241, 0.72);
      }
      .story-visual-quote-architecture {
        background:
          linear-gradient(180deg, rgba(23, 27, 22, 0.08), rgba(255, 250, 241, 0.1) 45%, rgba(30, 95, 201, 0.1)),
          rgba(255, 250, 241, 0.72);
      }
      .story-visual-before-after-surface {
        background:
          linear-gradient(90deg, rgba(23, 27, 22, 0.08), transparent 48%, rgba(10, 139, 98, 0.12)),
          rgba(255, 250, 241, 0.72);
      }
      .grammar-tag {
        position: absolute;
        top: 18px;
        left: 18px;
        z-index: 2;
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 10px 14px;
        border: 1px solid rgba(23, 27, 22, 0.18);
        background: rgba(255, 250, 241, 0.82);
        font-family: var(--mono);
        font-size: 19px;
        letter-spacing: 0.02em;
        text-transform: uppercase;
        color: var(--ink);
      }
      .signal-board-stage {
        margin-top: 28px;
        display: grid;
        grid-template-columns: 1fr;
        gap: 18px;
      }
      .signal-board-plate {
        width: 100%;
        height: 560px;
      }
      .signal-board-lanes {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 16px;
      }
      .signal-lane {
        min-height: 172px;
        border-top: 4px solid var(--blue);
        border-bottom: 1px solid rgba(23, 27, 22, 0.2);
        padding: 20px 18px;
        background:
          linear-gradient(180deg, rgba(30, 95, 201, 0.08), rgba(255, 250, 241, 0.78)),
          rgba(255, 250, 241, 0.76);
      }
      .signal-lane em,
      .signal-watch span,
      .timeline-stop em,
      .timeline-foot span,
      .proof-badge,
      .quote-beam span,
      .quote-pillar em,
      .before-panel span,
      .after-panel span,
      .before-after-chip em {
        font-family: var(--mono);
        font-style: normal;
        letter-spacing: 0.02em;
        text-transform: uppercase;
      }
      .signal-lane em {
        display: block;
        font-size: 23px;
        color: var(--blue);
      }
      .signal-lane b {
        display: block;
        margin-top: 18px;
        font-size: 29px;
        line-height: 1.16;
        overflow-wrap: anywhere;
        word-break: break-word;
      }
      .signal-watch {
        min-height: 112px;
        display: grid;
        grid-template-columns: 150px 1fr;
        align-items: center;
        gap: 24px;
        border: 2px solid rgba(23, 27, 22, 0.22);
        background: rgba(255, 250, 241, 0.82);
        padding: 20px 24px;
      }
      .signal-watch span {
        font-size: 22px;
        color: var(--green);
      }
      .signal-watch b {
        font-size: 33px;
        line-height: 1.12;
        overflow-wrap: anywhere;
        word-break: break-word;
      }
      .timeline-stage {
        position: relative;
        margin-top: 34px;
        min-height: 372px;
        border-top: 2px solid var(--line-strong);
        border-bottom: 1px solid rgba(23, 27, 22, 0.22);
        padding: 58px 0 34px;
      }
      .timeline-ribbon {
        position: absolute;
        left: 18px;
        right: 18px;
        top: 98px;
        height: 6px;
        transform-origin: left center;
        background: linear-gradient(90deg, var(--blue), var(--gold), var(--red));
      }
      .timeline-stop-grid {
        position: relative;
        z-index: 2;
        display: grid;
        gap: 18px;
      }
      .timeline-stop {
        min-height: 230px;
        padding: 72px 20px 22px;
        border: 1px solid rgba(23, 27, 22, 0.22);
        background: rgba(255, 250, 241, 0.84);
      }
      .timeline-stop::before {
        content: '';
        position: absolute;
      }
      .timeline-stop em {
        display: block;
        font-size: 22px;
        color: var(--blue);
      }
      .timeline-stop b {
        display: block;
        margin-top: 14px;
        font-size: 29px;
        line-height: 1.16;
        overflow-wrap: anywhere;
        word-break: break-word;
      }
      .timeline-plate {
        margin-top: 26px;
        width: 100%;
        height: 360px;
      }
      .timeline-foot {
        margin-top: 18px;
        display: grid;
        grid-template-columns: 150px 1fr;
        gap: 22px;
        align-items: center;
        border-top: 2px solid var(--line-strong);
        padding-top: 18px;
      }
      .timeline-foot span {
        font-size: 22px;
        color: var(--red);
      }
      .timeline-foot b {
        font-size: 32px;
        line-height: 1.14;
        overflow-wrap: anywhere;
        word-break: break-word;
      }
      .verification-stage {
        margin-top: 34px;
        display: grid;
        grid-template-columns: 0.86fr 1.14fr;
        gap: 32px;
        align-items: stretch;
      }
      .verification-plate {
        height: 660px;
      }
      .proof-badge {
        position: absolute;
        right: 18px;
        top: 18px;
        z-index: 3;
        padding: 10px 14px;
        border: 1px solid rgba(23, 27, 22, 0.24);
        background: rgba(255, 250, 241, 0.86);
        font-size: 19px;
        color: var(--green);
      }
      .visual-type {
        font-family: var(--serif);
        font-size: 48px;
        line-height: 1.08;
        font-weight: 900;
        color: rgba(23, 27, 22, 0.78);
        max-width: 100%;
        overflow-wrap: anywhere;
        word-break: break-word;
        text-align: center;
      }
      .bullet-stack {
        margin-top: 42px;
        display: grid;
        gap: 16px;
      }
      .bullet {
        border: 1px solid rgba(23, 27, 22, 0.22);
        box-shadow: inset 0 0 0 2px rgba(30, 95, 201, 0.12);
        padding: 14px 18px;
        background:
          linear-gradient(90deg, rgba(30, 95, 201, 0.08), rgba(255, 250, 241, 0.72) 45%),
          rgba(255, 250, 241, 0.72);
        font-size: 27px;
        line-height: 1.24;
        font-weight: 720;
      }
      .signal-board {
        margin-top: 34px;
        display: grid;
        gap: 16px;
      }
      .signal-row {
        display: grid;
        grid-template-columns: 106px 1fr;
        gap: 18px;
        align-items: start;
        min-height: 102px;
        border-top: 1px solid rgba(23, 27, 22, 0.26);
        padding-top: 16px;
      }
      .signal-row em {
        font-family: var(--mono);
        font-size: 24px;
        font-style: normal;
        color: var(--blue);
      }
      .signal-row b {
        font-size: 31px;
        line-height: 1.18;
        overflow-wrap: anywhere;
        word-break: break-word;
      }
      .timeline-track {
        position: relative;
        margin-top: 38px;
        padding-left: 58px;
        display: grid;
        gap: 18px;
      }
      .timeline-track::before {
        content: '';
        position: absolute;
        left: 18px;
        top: 6px;
        bottom: 6px;
        width: 4px;
        background: linear-gradient(180deg, var(--blue), var(--red));
      }
      .timeline-step {
        position: relative;
        min-height: 112px;
        padding: 20px 18px 18px 26px;
        border: 1px solid rgba(23, 27, 22, 0.22);
        background: rgba(255, 250, 241, 0.76);
      }
      .timeline-step::before {
        content: '';
        position: absolute;
        left: -41px;
        top: 27px;
        width: 18px;
        height: 18px;
        border-radius: 50%;
        border: 4px solid var(--paper);
        background: var(--red);
        box-shadow: 0 0 0 1px rgba(23, 27, 22, 0.14);
      }
      .timeline-step em {
        display: block;
        font-family: var(--mono);
        font-size: 22px;
        font-style: normal;
        color: var(--blue);
      }
      .timeline-step b {
        display: block;
        margin-top: 14px;
        font-size: 29px;
        line-height: 1.18;
        overflow-wrap: anywhere;
        word-break: break-word;
      }
      .verification-rail {
        position: relative;
        margin-top: 30px;
        padding-left: 58px;
        display: grid;
        gap: 16px;
      }
      .verification-rail::before {
        content: '';
        position: absolute;
        left: 18px;
        top: 6px;
        bottom: 6px;
        width: 4px;
        background: linear-gradient(180deg, var(--blue), var(--green), var(--red));
      }
      .verification-stop {
        position: relative;
        display: grid;
        grid-template-columns: 88px 1fr;
        gap: 18px;
        min-height: 108px;
        padding: 18px 18px 18px 24px;
        border: 1px solid rgba(23, 27, 22, 0.22);
        background: rgba(255, 250, 241, 0.76);
      }
      .verification-stop::before {
        content: '';
        position: absolute;
        left: -41px;
        top: 27px;
        width: 18px;
        height: 18px;
        border-radius: 50%;
        border: 4px solid var(--paper);
        background: var(--green);
        box-shadow: 0 0 0 1px rgba(23, 27, 22, 0.14);
      }
      .verification-stop em {
        font-family: var(--mono);
        font-size: 22px;
        font-style: normal;
        color: var(--red);
      }
      .verification-stop b {
        font-size: 29px;
        line-height: 1.18;
        overflow-wrap: anywhere;
        word-break: break-word;
      }
      .verdict-band {
        position: absolute;
        left: 18px;
        right: 18px;
        bottom: 18px;
        z-index: 3;
        padding: 20px 20px 18px;
        border-top: 2px solid var(--line-strong);
        background: linear-gradient(90deg, rgba(204, 65, 43, 0.12), rgba(255, 250, 241, 0.9));
      }
      .verdict-band em {
        display: block;
        font-family: var(--mono);
        font-size: 20px;
        font-style: normal;
        color: var(--red);
      }
      .verdict-band b {
        display: block;
        margin-top: 10px;
        font-size: 32px;
        line-height: 1.16;
        font-weight: 860;
        overflow-wrap: anywhere;
        word-break: break-word;
      }
      .story-shell-quote-architecture {
        display: grid;
        grid-template-rows: auto 1fr auto 150px;
        gap: 22px;
      }
      .quote-beam {
        min-height: 226px;
        border-top: 4px solid var(--line-strong);
        border-bottom: 1px solid rgba(23, 27, 22, 0.22);
        padding: 28px 28px 22px;
        background: rgba(255, 250, 241, 0.82);
      }
      .quote-beam span {
        display: block;
        font-size: 23px;
        color: var(--blue);
      }
      .quote-beam b {
        display: block;
        margin-top: 24px;
        font-family: var(--serif);
        font-size: 68px;
        line-height: 1.04;
        overflow-wrap: anywhere;
        word-break: break-word;
      }
      .quote-body {
        display: grid;
        grid-template-columns: 0.86fr 1.14fr;
        gap: 26px;
        min-height: 0;
      }
      .quote-plate {
        height: 500px;
      }
      .quote-pillars {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 14px;
      }
      .quote-pillar {
        min-height: 500px;
        display: flex;
        flex-direction: column;
        justify-content: flex-end;
        border: 1px solid rgba(23, 27, 22, 0.22);
        background: linear-gradient(180deg, rgba(30, 95, 201, 0.04), rgba(255, 250, 241, 0.86));
        padding: 24px 18px;
      }
      .quote-pillar em {
        font-size: 21px;
        color: var(--blue);
      }
      .quote-pillar b {
        display: block;
        margin-top: 18px;
        font-size: 28px;
        line-height: 1.15;
        overflow-wrap: anywhere;
        word-break: break-word;
      }
      .quote-verdict {
        min-height: 108px;
        display: flex;
        align-items: center;
        border-top: 2px solid var(--line-strong);
        padding: 0 18px;
        background: rgba(255, 250, 241, 0.7);
      }
      .quote-verdict b {
        font-size: 35px;
        line-height: 1.15;
        overflow-wrap: anywhere;
        word-break: break-word;
      }
      .before-after-stage {
        position: relative;
        margin-top: 30px;
        min-height: 820px;
        display: grid;
        grid-template-columns: 1fr 1fr;
        grid-template-rows: 290px 330px 1fr;
        gap: 18px;
      }
      .before-panel,
      .after-panel {
        padding: 26px;
        border: 1px solid rgba(23, 27, 22, 0.22);
        background: rgba(255, 250, 241, 0.78);
      }
      .before-panel {
        border-top: 5px solid var(--muted);
      }
      .after-panel {
        border-top: 5px solid var(--green);
      }
      .before-panel span,
      .after-panel span {
        display: block;
        font-size: 22px;
        color: var(--blue);
      }
      .before-panel b,
      .after-panel b {
        display: block;
        margin-top: 22px;
        font-size: 34px;
        line-height: 1.14;
        overflow-wrap: anywhere;
        word-break: break-word;
      }
      .before-after-bridge {
        position: absolute;
        left: calc(50% - 3px);
        top: 0;
        bottom: 0;
        width: 6px;
        background: linear-gradient(180deg, var(--blue), var(--green), var(--red));
        transform-origin: top center;
      }
      .before-after-plate {
        grid-column: 1 / -1;
        height: 330px;
      }
      .before-after-notes {
        grid-column: 1 / -1;
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 14px;
      }
      .before-after-chip {
        min-height: 140px;
        padding: 18px;
        border: 1px solid rgba(23, 27, 22, 0.2);
        background: rgba(255, 250, 241, 0.8);
      }
      .before-after-chip em {
        display: block;
        font-size: 20px;
        color: var(--red);
      }
      .before-after-chip b {
        display: block;
        margin-top: 14px;
        font-size: 25px;
        line-height: 1.14;
        overflow-wrap: anywhere;
        word-break: break-word;
      }
      .signal {
        position: absolute;
        left: 0;
        right: 0;
        bottom: 190px;
        display: flex;
        justify-content: space-between;
        align-items: center;
        border-top: 2px solid var(--line-strong);
        border-bottom: 1px solid var(--line);
        padding: 22px 0;
        font-family: var(--mono);
        font-size: 26px;
        color: var(--green);
      }
      .close-grid {
        margin-top: 54px;
        display: grid;
        gap: 18px;
      }
      .close-row {
        min-height: 118px;
        border-top: 1px solid rgba(23, 27, 22, 0.28);
        display: grid;
        grid-template-columns: 112px 1fr;
        align-items: center;
        gap: 28px;
      }
      .close-row em {
        font-family: var(--mono);
        font-size: 25px;
        font-style: normal;
        color: var(--ink);
      }
      .close-row b {
        font-size: 38px;
        line-height: 1.16;
        overflow-wrap: anywhere;
        word-break: break-word;
      }
    </style>
  </head>
  <body>
    <div id="news-broadcast" data-composition-id="news-broadcast" data-width="${normalized.width}" data-height="${normalized.height}" data-start="0" data-duration="${duration}">
      <div class="frame"></div>
      <div class="header"><span>${escapeHtml(payload.narratorLabel)}</span><span>${escapeHtml(headerDate)}</span></div>
      <div class="progress"><i id="progress-bar"></i></div>
      <div class="cover-poster">
        <div class="cover-inner">
          <div class="cover-edition"><span>${escapeHtml(payload.seriesTitle)}</span><span>${escapeHtml(headerDate)}</span></div>
          <div class="cover-kicker">${escapeHtml(payload.narratorLabel)} broadcast briefing</div>
          <h1 class="cover-title"><b>${escapeHtml(payload.title)}</b></h1>
          <div class="cover-dek">${escapeHtml(payload.subtitle || payload.cover.dek || 'A concise briefing built for quick understanding.')}</div>
          <div class="cover-stack">${storyCards}
          </div>
          <div class="cover-footer"><span>HyperFrames editorial workflow</span><span>${escapeHtml(payload.language)}</span></div>
        </div>
      </div>
      <section id="scene-cover" class="scene clip" data-start="0" data-duration="${DEFAULT_COVER_SECONDS}" data-track-index="2">
        <div class="scene-shell">
          <div class="red-rule"></div>
          <p class="kicker" style="margin-top: 50px;">${escapeHtml(payload.seriesTitle)}</p>
          <h2 class="title">${escapeHtml(payload.title)}</h2>
          <p class="dek">${escapeHtml(payload.subtitle || payload.cover.dek || payload.stories.map((story) => story.title).join(' / '))}</p>
          <div class="signal"><b>${payload.stories.length} STORIES</b><span>${escapeHtml(headerDate)}</span></div>
          <div class="caption">${escapeHtml(payload.cover.caption || payload.subtitle || '接下来快速看今天最值得关注的几条新闻。')}</div>
        </div>
      </section>
${storySections}
      <section id="scene-close" class="scene clip" data-start="${round(closeScene.start)}" data-duration="${round(closeScene.duration)}" data-track-index="2">
        <div class="scene-shell">
          <div class="red-rule"></div>
          <p class="kicker" style="margin-top: 50px;">quick hits</p>
          <h2 class="title">${escapeHtml(payload.quickHits.length ? '补充快讯' : '本期收束')}</h2>
          <p class="dek">${escapeHtml(payload.quickHits.length ? '还有几条可以顺手记住的信号。' : '以上是本期新闻播报。')}</p>
          <div class="close-grid">
            ${quickRows}
          </div>
          <div class="caption">${escapeHtml(payload.cover.closeCaption || '播报结束，继续关注下一次更新。')}</div>
        </div>
      </section>
      ${audioTags}
    </div>
    <script>
      window.__timelines = window.__timelines || {};
      const tl = gsap.timeline({ paused: true, defaults: { ease: "power2.out" } });
      const has = (selector) => document.querySelector(selector);
      const to = (selector, vars, position) => { if (has(selector)) tl.to(selector, vars, position); };
      const fromTo = (selector, fromVars, toVars, position) => { if (has(selector)) tl.fromTo(selector, fromVars, toVars, position); };
      const scenes = [
        ${scenesJs}
      ];
      tl.to(".cover-poster", { opacity: 0, duration: 0.32, ease: "power2.inOut" }, 0.42);
      tl.to("#progress-bar", { scaleX: 1, duration: ${duration}, ease: "none" }, 0);
      scenes.forEach((scene, index) => {
        const end = scene.start + scene.duration;
        const layoutKey = scene.layout;
        to(scene.id, { opacity: 1, duration: 0.18 }, scene.start);
        fromTo(scene.id + " .red-rule", { scaleX: 0 }, { scaleX: 1, duration: 0.42 }, scene.start + 0.08);
        fromTo(scene.id + " .grammar-tag", { y: 18, opacity: 0 }, { y: 0, opacity: 1, duration: 0.24 }, scene.start + 0.06);
        fromTo(scene.id + " .kicker", { y: 24, opacity: 0 }, { y: 0, opacity: 1, duration: 0.38 }, scene.start + 0.12);
        fromTo(scene.id + " .title", { y: 32, opacity: 0 }, { y: 0, opacity: 1, duration: 0.56 }, scene.start + 0.25);
        fromTo(scene.id + " .dek", { y: 24, opacity: 0 }, { y: 0, opacity: 1, duration: 0.46 }, scene.start + 0.52);
        fromTo(scene.id + " .caption", { y: 28, opacity: 0 }, { y: 0, opacity: 1, duration: 0.48 }, scene.start + 0.86);
        fromTo(scene.id + " .story-visual", { scale: 0.96, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.7 }, scene.start + 0.62);
        if (layoutKey === 'signal') {
          fromTo(scene.id + " .signal-board-plate", { scale: 0.98, y: 18, opacity: 0 }, { scale: 1, y: 0, opacity: 1, duration: 0.58 }, scene.start + 0.78);
          fromTo(scene.id + " .signal-lane", { y: 24, opacity: 0 }, { y: 0, opacity: 1, duration: 0.34, stagger: 0.11 }, scene.start + 1.02);
          fromTo(scene.id + " .signal-watch", { y: 22, opacity: 0 }, { y: 0, opacity: 1, duration: 0.34 }, scene.start + 1.52);
        } else if (layoutKey === 'timeline') {
          fromTo(scene.id + " .timeline-ribbon", { scaleX: 0 }, { scaleX: 1, duration: 0.56 }, scene.start + 0.72);
          fromTo(scene.id + " .timeline-stop", { y: 24, opacity: 0 }, { y: 0, opacity: 1, duration: 0.34, stagger: 0.1 }, scene.start + 1.0);
          fromTo(scene.id + " .timeline-plate", { scale: 0.97, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.52 }, scene.start + 1.32);
          fromTo(scene.id + " .timeline-foot", { y: 18, opacity: 0 }, { y: 0, opacity: 1, duration: 0.3 }, scene.start + 1.7);
        } else if (layoutKey === 'rail') {
          fromTo(scene.id + " .proof-badge", { y: -12, opacity: 0 }, { y: 0, opacity: 1, duration: 0.24 }, scene.start + 0.58);
          fromTo(scene.id + " .verification-stop", { x: 22, opacity: 0 }, { x: 0, opacity: 1, duration: 0.34, stagger: 0.1 }, scene.start + 0.98);
          fromTo(scene.id + " .verdict-band", { y: 22, opacity: 0 }, { y: 0, opacity: 1, duration: 0.36 }, scene.start + 1.48);
        } else if (layoutKey === 'quote') {
          fromTo(scene.id + " .quote-beam", { y: 24, opacity: 0 }, { y: 0, opacity: 1, duration: 0.38 }, scene.start + 0.68);
          fromTo(scene.id + " .quote-pillar", { y: 24, opacity: 0 }, { y: 0, opacity: 1, duration: 0.34, stagger: 0.09 }, scene.start + 1.0);
          fromTo(scene.id + " .quote-verdict", { y: 18, opacity: 0 }, { y: 0, opacity: 1, duration: 0.3 }, scene.start + 1.62);
        } else if (layoutKey === 'before-after') {
          fromTo(scene.id + " .before-panel", { x: -28, opacity: 0 }, { x: 0, opacity: 1, duration: 0.32 }, scene.start + 0.82);
          fromTo(scene.id + " .after-panel", { x: 28, opacity: 0 }, { x: 0, opacity: 1, duration: 0.32 }, scene.start + 0.82);
          fromTo(scene.id + " .before-after-bridge", { scaleY: 0 }, { scaleY: 1, duration: 0.42 }, scene.start + 1.08);
          fromTo(scene.id + " .before-after-chip", { y: 20, opacity: 0 }, { y: 0, opacity: 1, duration: 0.32, stagger: 0.08 }, scene.start + 1.28);
        }
        fromTo(scene.id + " .bullet", { y: 22, opacity: 0 }, { y: 0, opacity: 1, duration: 0.34, stagger: 0.08 }, scene.start + 1.05);
        to(scene.id, { opacity: 0, y: -12, duration: 0.22, ease: "power2.in" }, end - 0.22);
      });
      tl.fromTo(".close-row", { y: 30, opacity: 0 }, { y: 0, opacity: 1, duration: 0.42, stagger: 0.18 }, ${round(closeScene.start + 1.1)});
      window.__timelines["news-broadcast"] = tl;
    </script>
  </body>
</html>
`;
}

function renderStorySection(story, scene, index) {
  const grammarKey = normalizeGrammarKey(story.visualGrammar || 'signal_board');
  const grammarClass = grammarCssClass(grammarKey);
  const grammarLabel = story.visualGrammarLabel || titleCase(grammarKey);
  const layoutKey = grammarLayoutKey(grammarKey);
  const visual = story.visual?.file
    ? `<img src="assets/${assetName(story.visual.file, `story-${index + 1}`)}" alt="${escapeHtml(story.visual.alt || '')}" />`
    : `<div class="visual-type">${escapeHtml(story.title)}</div>`;
  const bullets = (story.bullets.length ? story.bullets : [story.summary, story.takeaway].filter(Boolean)).slice(0, 3);
  if (layoutKey === 'timeline') {
    return renderTimelineStorySection({ story, scene, index, grammarKey, grammarClass, grammarLabel, visual, bullets });
  }
  if (layoutKey === 'rail') {
    return renderVerificationStorySection({ story, scene, index, grammarKey, grammarClass, grammarLabel, visual, bullets });
  }
  if (layoutKey === 'quote') {
    return renderQuoteStorySection({ story, scene, index, grammarKey, grammarClass, grammarLabel, visual, bullets });
  }
  if (layoutKey === 'before-after') {
    return renderBeforeAfterStorySection({ story, scene, index, grammarKey, grammarClass, grammarLabel, visual, bullets });
  }
  return renderSignalBoardStorySection({ story, scene, index, grammarKey, grammarClass, grammarLabel, visual, bullets });
}

function renderSignalBoardStorySection({ story, scene, index, grammarKey, grammarClass, grammarLabel, visual, bullets }) {
  const laneBullets = (bullets.length ? bullets : [story.summary, story.takeaway].filter(Boolean)).slice(0, 3);
  return `      <section id="scene-${cssId(scene.id)}" class="scene clip story-grammar story-grammar-${grammarClass}" data-grammar="${grammarKey}" data-start="${round(scene.start)}" data-duration="${round(scene.duration)}" data-track-index="2">
        <div class="scene-shell">
          <div class="story-shell story-shell-signal-board">
            <div class="story-shell-head">
              <div class="red-rule"></div>
              <p class="kicker" style="margin-top: 18px;">signal board</p>
              <h2 class="title">${escapeHtml(story.title)}</h2>
              <p class="dek">${escapeHtml(story.summary || story.takeaway || '这是一条需要快速理解的新闻信号。')}</p>
            </div>
            <div class="signal-board-stage">
              <div class="story-visual story-visual-${grammarClass} signal-board-plate${story.visual?.file ? '' : ' no-image'}">
                <div class="grammar-tag">${escapeHtml(grammarLabel)}</div>
                ${visual}
              </div>
              <div class="signal-board-lanes">
                ${laneBullets.map((bullet, bulletIndex) => `<div class="signal-lane"><em>${String(bulletIndex + 1).padStart(2, '0')}</em><b>${escapeHtml(bullet)}</b></div>`).join('\n')}
              </div>
              <div class="signal-watch"><span>WATCH NEXT</span><b>${escapeHtml(story.takeaway || story.summary || story.title)}</b></div>
            </div>
            <div class="caption">${escapeHtml(story.takeaway || story.summary || story.title)}</div>
          </div>
        </div>
      </section>`;
}

function renderTimelineStorySection({ story, scene, index, grammarKey, grammarClass, grammarLabel, visual, bullets }) {
  const phaseBullets = (bullets.length ? bullets : [story.summary, story.takeaway].filter(Boolean)).slice(0, 3);
  return `      <section id="scene-${cssId(scene.id)}" class="scene clip story-grammar story-grammar-${grammarClass}" data-grammar="${grammarKey}" data-start="${round(scene.start)}" data-duration="${round(scene.duration)}" data-track-index="2">
        <div class="scene-shell">
          <div class="story-shell story-shell-timeline-ribbon">
            <div class="story-shell-head">
              <div class="red-rule"></div>
              <p class="kicker" style="margin-top: 18px;">timeline ribbon</p>
              <h2 class="title">${escapeHtml(story.title)}</h2>
              <p class="dek">${escapeHtml(story.summary || story.takeaway || '这是一条需要快速理解的新闻信号。')}</p>
            </div>
            <div class="timeline-stage">
              <div class="timeline-ribbon"></div>
              <div class="timeline-stop-grid" style="grid-template-columns: repeat(${Math.max(2, Math.min(phaseBullets.length, 3))}, minmax(0, 1fr));">
                ${phaseBullets.map((bullet, bulletIndex) => `<div class="timeline-stop"><em>PHASE ${String(bulletIndex + 1).padStart(2, '0')}</em><b>${escapeHtml(bullet)}</b></div>`).join('\n')}
              </div>
            </div>
            <div class="story-visual story-visual-${grammarClass} timeline-plate${story.visual?.file ? '' : ' no-image'}">
              <div class="grammar-tag">${escapeHtml(grammarLabel)}</div>
              ${visual}
            </div>
            <div class="timeline-foot"><span>sequence</span><b>${escapeHtml(story.takeaway || story.summary || story.title)}</b></div>
            <div class="caption">${escapeHtml(story.takeaway || story.summary || story.title)}</div>
          </div>
        </div>
      </section>`;
}

function renderVerificationStorySection({ story, scene, index, grammarKey, grammarClass, grammarLabel, visual, bullets }) {
  const proofBullets = (bullets.length ? bullets : [story.summary, story.takeaway].filter(Boolean)).slice(0, 3);
  return `      <section id="scene-${cssId(scene.id)}" class="scene clip story-grammar story-grammar-${grammarClass}" data-grammar="${grammarKey}" data-start="${round(scene.start)}" data-duration="${round(scene.duration)}" data-track-index="2">
        <div class="scene-shell">
          <div class="story-shell story-shell-verification-rail">
            <div class="story-shell-head">
              <div class="red-rule"></div>
              <p class="kicker" style="margin-top: 18px;">verification rail</p>
              <h2 class="title">${escapeHtml(story.title)}</h2>
              <p class="dek">${escapeHtml(story.summary || story.takeaway || '这是一条需要快速理解的新闻信号。')}</p>
            </div>
            <div class="verification-stage">
              <div class="story-visual story-visual-${grammarClass} verification-plate${story.visual?.file ? '' : ' no-image'}">
                <div class="grammar-tag">${escapeHtml(grammarLabel)}</div>
                <div class="proof-badge">verified path</div>
                ${visual}
                <div class="verdict-band">
                  <em>verified verdict</em>
                  <b>${escapeHtml(story.takeaway || story.summary || story.title)}</b>
                </div>
              </div>
              <div class="verification-rail">
                ${proofBullets.map((bullet, bulletIndex) => `<div class="verification-stop"><em>${String(bulletIndex + 1).padStart(2, '0')}</em><b>${escapeHtml(bullet)}</b></div>`).join('\n')}
              </div>
            </div>
            <div class="signal"><b>${escapeHtml(story.takeaway || 'KEY SIGNAL')}</b><span>${escapeHtml(story.source ? 'SOURCE LINKED' : 'BROADCAST NOTE')}</span></div>
            <div class="caption">${escapeHtml(story.takeaway || story.summary || story.title)}</div>
          </div>
        </div>
      </section>`;
}

function renderQuoteStorySection({ story, scene, index, grammarKey, grammarClass, grammarLabel, visual, bullets }) {
  const quoteBullets = (bullets.length ? bullets : [story.summary, story.takeaway].filter(Boolean)).slice(0, 3);
  return `      <section id="scene-${cssId(scene.id)}" class="scene clip story-grammar story-grammar-${grammarClass}" data-grammar="${grammarKey}" data-start="${round(scene.start)}" data-duration="${round(scene.duration)}" data-track-index="2">
        <div class="scene-shell">
          <div class="story-shell story-shell-quote-architecture">
            <div class="quote-beam">
              <span>${escapeHtml(grammarLabel)}</span>
              <b>${escapeHtml(story.title)}</b>
            </div>
            <div class="quote-body">
              <div class="story-visual story-visual-${grammarClass} quote-plate${story.visual?.file ? '' : ' no-image'}">
                <div class="grammar-tag">${escapeHtml(grammarLabel)}</div>
                ${visual}
              </div>
              <div class="quote-pillars">
                ${quoteBullets.map((bullet, bulletIndex) => `<div class="quote-pillar"><em>PILLAR ${String(bulletIndex + 1).padStart(2, '0')}</em><b>${escapeHtml(bullet)}</b></div>`).join('\n')}
              </div>
            </div>
            <div class="quote-verdict"><b>${escapeHtml(story.takeaway || story.summary || story.title)}</b></div>
            <div class="caption">${escapeHtml(story.takeaway || story.summary || story.title)}</div>
          </div>
        </div>
      </section>`;
}

function renderBeforeAfterStorySection({ story, scene, index, grammarKey, grammarClass, grammarLabel, visual, bullets }) {
  const beforeText = story.summary || bullets[0] || story.title;
  const afterText = story.takeaway || bullets[1] || story.title;
  const compareBullets = (bullets.length ? bullets : [story.summary, story.takeaway].filter(Boolean)).slice(0, 3);
  return `      <section id="scene-${cssId(scene.id)}" class="scene clip story-grammar story-grammar-${grammarClass}" data-grammar="${grammarKey}" data-start="${round(scene.start)}" data-duration="${round(scene.duration)}" data-track-index="2">
        <div class="scene-shell">
          <div class="story-shell story-shell-before-after">
            <div class="story-shell-head">
              <div class="red-rule"></div>
              <p class="kicker" style="margin-top: 18px;">before / after</p>
              <h2 class="title">${escapeHtml(story.title)}</h2>
              <p class="dek">${escapeHtml(story.summary || story.takeaway || '这是一条需要快速理解的新闻信号。')}</p>
            </div>
            <div class="before-after-stage">
              <div class="before-panel">
                <span>before</span>
                <b>${escapeHtml(beforeText)}</b>
              </div>
              <div class="after-panel">
                <span>after</span>
                <b>${escapeHtml(afterText)}</b>
              </div>
              <div class="before-after-bridge"></div>
              <div class="story-visual story-visual-${grammarClass} before-after-plate${story.visual?.file ? '' : ' no-image'}">
                <div class="grammar-tag">${escapeHtml(grammarLabel)}</div>
                ${visual}
              </div>
              <div class="before-after-notes">
                ${compareBullets.map((bullet, bulletIndex) => `<div class="before-after-chip"><em>${String(bulletIndex + 1).padStart(2, '0')}</em><b>${escapeHtml(bullet)}</b></div>`).join('\n')}
              </div>
            </div>
            <div class="caption">${escapeHtml(story.takeaway || story.summary || story.title)}</div>
          </div>
        </div>
      </section>`;
}

async function persistInputPayload(paths, inputFile, payload) {
  const target = path.join(paths.inputsDir, 'broadcast-input.json');
  if (inputFile) {
    await copyFile(path.resolve(inputFile), target);
  } else {
    await writeFile(target, `${JSON.stringify(payload.original, null, 2)}\n`, 'utf8');
  }
  return target;
}

async function finishNeedsBroadcastInputRun({ paths, manifest, logger, normalized, problem }) {
  const requestSidecar = await persistBroadcastInputRequest({ paths, problem });
  const sidecars = [requestSidecar];
  await writeStep(paths.runDir, requestSidecar.stepId, requestSidecar);

  const nextAction = '我现在准备进入播报视频制作流程。下一步请你直接告诉我想播报什么内容，我会先帮你整理成结构化素材，再继续写播报稿、配音、画面和最终视频。';
  const finalManifest = {
    ...manifest,
    status: 'needs-broadcast-input',
    finishedAt: new Date().toISOString(),
    awaitingConfirmation: true,
    checkpoint: 'broadcast-input',
    nextAction,
    inputProblem: problem?.message,
    steps: sidecars.map(summaryFromSidecar),
    userArtifacts: buildUserArtifacts(sidecars),
  };
  finalManifest.delivery = buildDeliverySummary({
    status: finalManifest.status,
    plan: {
      runId: paths.runId,
      confirmationPlan: {
        visualGrammarLibrary: {
          name: 'built-in-commercial-visual-motion-grammar',
          sourceType: 'built-in',
          gallery: VISUAL_GRAMMAR_GALLERY_PATH,
          grammars: visualGrammarCatalogSummary(),
        },
        revisionOptions: DELIVERY_REVISION_OPTIONS,
        visualGrammarExpansion: VISUAL_GRAMMAR_EXPANSION_STEPS,
        stories: [],
      },
    },
    paths,
    manifest: finalManifest,
    userArtifacts: finalManifest.userArtifacts,
  });
  await writeManifest(paths.runDir, finalManifest);
  await writeProjectRunSummary(paths, finalManifest);
  await logger.write({ event: 'workflow_end', status: finalManifest.status });

  return finalOutput({
    plan: {
      runId: paths.runId,
      cost: manifest.cost || { estimated: 0, currency: 'credits' },
    },
    paths,
    manifest: finalManifest,
    userArtifacts: finalManifest.userArtifacts,
    dryRun: normalized.dryRun,
    extra: {
      status: finalManifest.status,
      awaitingConfirmation: true,
      checkpoint: 'broadcast-input',
      nextAction,
      needsBroadcastInput: true,
    },
  });
}

async function persistBroadcastInputRequest({ paths, problem }) {
  const markdown = renderBroadcastInputRequestMarkdown(problem);
  const markdownPath = await persistTextFile(paths.textsDir, 'broadcast-input-request.md', markdown);
  const jsonPath = await persistTextFile(paths.textsDir, 'broadcast-input-request.json', JSON.stringify({
    needsBroadcastInput: true,
    checkpoint: 'broadcast-input',
    nextAction: '下一步请告诉我你想播报什么内容',
    problem: problem?.message || '',
    problemCode: problem?.details?.code || '',
    inputFile: problem?.details?.inputFile || '',
  }, null, 2));
  return makeSidecar({
    stepId: BROADCAST_INPUT_REQUEST_STEP_ID,
    name: 'broadcast-input-request',
    status: 'planned',
    localFiles: [
      { kind: 'text', name: 'broadcast-input-request', path: markdownPath },
      { kind: 'text', name: 'broadcast-input-request-json', path: jsonPath },
    ],
    summary: {
      needsBroadcastInput: true,
      checkpoint: 'broadcast-input',
      problemCode: problem?.details?.code,
    },
  });
}

function renderBroadcastInputRequestMarkdown(problem) {
  const isHistoricalInput = problem?.details?.code === HISTORICAL_INPUT_CONFIRMATION_CODE;
  const problemMessage = isHistoricalInput
    ? `你给到的输入路径看起来来自历史输出目录：${problem.details.inputFile}`
    : problem?.message;
  const nextInputLine = isHistoricalInput
    ? '如果你就是想复用这份历史 JSON，请明确说“复用这个文件”，然后用 `--allow-historical-input` 继续。'
    : '如果你已有一份新的播报 JSON，也可以直接给我路径。';
  return `# 先告诉我你想播报什么

## 当前进度

- 我现在准备进入播报视频制作流程。下一步请你先告诉我这次想播报什么内容。
- 我不会自动从历史输出目录里挑旧素材当作本次主题。

## 你可以直接这样说

- 你想播报的主题
- 你最想让我讲清楚的几条内容
- 如果有的话，也可以顺手告诉我你想要的语气或重点
- ${nextInputLine}

## 收到后我会继续

- 我会先把你的自然语言需求整理成结构化播报素材。
- 然后我会继续生成确认清单、播报稿、配音、画面和最终项目。

${problemMessage ? `## 我看到的输入问题\n\n- ${problemMessage}\n` : ''}
`;
}

function isBroadcastInputReadError(error) {
  return ['ENOENT', 'ENOTDIR', 'EISDIR'].includes(error?.code);
}

async function copyOptionalAsset(source, assetsDir, prefix) {
  if (!source) return undefined;
  const sourcePath = path.resolve(source);
  const target = path.join(assetsDir, assetName(sourcePath, prefix));
  await copyFile(sourcePath, target);
  return target;
}

function assetName(source, prefix) {
  const ext = path.extname(String(source || '')) || '.bin';
  return `${safeSlug(prefix)}${ext}`;
}

async function persistTextFile(dir, name, content) {
  await mkdir(dir, { recursive: true });
  const filePath = path.join(dir, name);
  await writeFile(filePath, ensureTrailingNewline(content), 'utf8');
  return filePath;
}

function makeSidecar(payload) {
  return {
    ok: payload.status !== 'failed',
    workflowVersion: WORKFLOW_VERSION,
    registryVersion: REGISTRY_VERSION,
    ...payload,
  };
}

function summaryFromSidecar(sidecar) {
  return {
    stepId: sidecar.stepId,
    name: sidecar.name,
    status: sidecar.status,
    registryId: sidecar.registryId,
    taskNo: sidecar.taskNo,
    resultUrls: sidecar.resultUrls,
    localFiles: sidecar.localFiles,
    summary: sidecar.summary,
  };
}

function finalOutput({ plan, paths, manifest, userArtifacts, dryRun, extra = {} }) {
  return {
    ok: true,
    ...(dryRun ? { dryRun: true, plan: publicPlan(plan) } : {}),
    runId: plan?.runId || paths.runId,
    projectName: paths.projectName,
    projectSlug: paths.projectSlug,
    outputDir: paths.runDir,
    manifest: paths.manifestPath,
    userArtifacts,
    delivery: manifest.delivery,
    cost: manifest.cost,
    ...extra,
  };
}

function publicPlan(plan) {
  if (!plan?.steps) {
    return {
      workflow: WORKFLOW_ID,
      workflowVersion: WORKFLOW_VERSION,
      registryVersion: REGISTRY_VERSION,
      cost: plan?.cost || { estimated: 0, currency: 'credits' },
      steps: [],
    };
  }
  return {
    workflow: plan.workflow,
    workflowVersion: plan.workflowVersion,
    registryVersion: plan.registryVersion,
    runSpecHash: plan.runSpecHash,
    cost: plan.cost,
    payloadSummary: plan.payloadSummary,
    confirmationPlan: plan.confirmationPlan,
    steps: plan.steps.map((step) => ({
      stepId: step.stepId,
      name: step.name,
      service: step.service,
      function: step.function,
      registryId: step.registryId,
    })),
  };
}

function firstAudioPath(narrationSidecar) {
  const file = narrationSidecar.localFiles?.find((item) => item.kind === 'audio' && (item.path || item.localPath));
  return file?.path || file?.localPath;
}

function summarizePayload(payload) {
  return {
    title: payload.title,
    date: payload.date,
    seriesTitle: payload.seriesTitle,
    storyCount: payload.stories.length,
    quickHitCount: payload.quickHits.length,
    hasNarrationAudio: Boolean(payload.narration.audioFile),
    hasBgm: Boolean(payload.bgm.file),
  };
}

function buildNarrationFromStories({ title, stories, quickHits }) {
  const lines = [`${title}。`];
  stories.forEach((story, index) => {
    lines.push(`第 ${index + 1} 条，${story.title}。${story.summary || ''}${story.takeaway ? ` 重点是，${story.takeaway}。` : ''}`);
  });
  if (quickHits.length) lines.push(`快讯：${quickHits.map((item) => item.text).join('；')}。`);
  lines.push('以上是本期播报。');
  return lines.join('\n');
}

function asArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function requiredString(value, label) {
  const text = String(value || '').trim();
  if (!text) throw new ShotFunOpenApiError(`${label} is required.`);
  return text;
}

function clampDuration(value, min, max) {
  const number = Number(value || DEFAULT_STORY_SECONDS);
  if (!Number.isFinite(number)) return DEFAULT_STORY_SECONDS;
  return Math.max(min, Math.min(max, number));
}

function round(value) {
  return Number(Number(value).toFixed(2));
}

function safeSlug(value) {
  return String(value || 'news-broadcast')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}._-]+/gu, '-')
    .replace(/^-+|-+$/g, '') || 'news-broadcast';
}

function cssId(value) {
  return safeSlug(value).replace(/[._]+/g, '-');
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function ensureTrailingNewline(value) {
  const text = String(value ?? '');
  return text.endsWith('\n') ? text : `${text}\n`;
}
