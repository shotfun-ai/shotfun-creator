export const REGISTRY_VERSION = '2026.05.21'

/**
 * ShotFun 任务注册表。
 *
 * 统一维护模型别名、taskCode、能力标签和未验证价格信息，避免 CLI
 * 与 service 分散硬编码同一批 OpenAPI 任务。
 */
const PRICE_UNKNOWN = Object.freeze({
  // credits：一次调用消耗的积分数；未知时置 0，避免误导成本估算。
  credits: 0,
  // pricePerCall：兼容旧字段名，含义与 credits 相同。
  pricePerCall: 0,
  // priceTier：成本分层，驱动模型选择和高成本确认逻辑。
  priceTier: 'unverified',
  // currency：成本单位，目前统一按积分计算。
  currency: 'credits',
  // verified：价格是否经过真实账单或后端配置校验。
  verified: false,
})

/**
 * 任务定义字段说明：
 * - id：registry 内部稳定 ID，用于 workflow sidecar、成本估算和断点续跑。
 * - key：CLI / service 面向调用方暴露的短别名，例如 --model nano2。
 * - label：给 catalog、日志和调试输出看的可读名称，不参与 OpenAPI 请求。
 * - taskCode：后端 OpenAPI 接收的业务任务编码，是实际提交任务的核心字段。
 * - resolution / durationSeconds：模型级默认规格，service 构造 inputParams 时可复用。
 * - assetPipeline：素材报白模式的处理流程配置，如资产组复用、创建资产、返回资产引用。
 * - price：成本信息；未验证价格必须保留 verified=false。
 * - taxonomy：业务分类，用于 catalog 分组和展示。
 * - selection：模型选择元数据，影响 AI 决策、排序和推荐说明。
 * - supports：能力硬约束，service 会用它阻断不支持的输入。
 * - inputDefaults：写入最终 inputParams 的 task 级默认入参，优先级低于用户显式入参。
 * - inputLocked：写入最终 inputParams 的 task 级固化入参，优先级高于用户显式入参。
 * - inputConstraints：最终 inputParams 的 task 级校验规则，用于表达最小时长、枚举等限制。
 * - recommendedFor：简短推荐场景，作为 selection.scenarios 的兜底来源。
 *
 * 嵌套字段说明：
 * - price.credits / pricePerCall：单次调用积分成本；pricePerCall 是兼容字段。
 * - price.priceTier：成本等级，影响是否需要用户确认高成本调用。
 * - price.currency：成本单位；price.verified 表示价格是否已核验。
 * - taxonomy.primary / secondary：一级/二级业务分类，仅用于展示和文档。
 * - selection.recommendationScore：1-10 推荐分，越高越优先。
 * - selection.scenarios：适用场景关键词，用于语义匹配和 catalog 展示。
 * - selection.highlights / tradeoffs：推荐理由和取舍说明。
 * - selection.tags：机器可读标签，用于 default、reference_image 等规则辅助判断。
 * - selection.qualityTier / speedTier：可选质量/速度分层，供后续选择器扩展。
 * - supports.referenceImage：是否允许参考图输入。
 * - supports.imageEdit：是否支持图片编辑/合成。
 * - supports.assetMode：是否支持先创建素材再用 Asset:// 引用。
 * - supports.directUrlMode：是否支持直接把 URL 传给后端任务。
 * - inputConstraints.<field>.min / max：数值下限/上限。
 * - inputConstraints.<field>.exclusiveMin / exclusiveMax：是否使用开区间边界。
 * - inputConstraints.<field>.enumValues：允许的离散取值列表。
 */
const TASK_DEFINITIONS = Object.freeze([
  imageTask({
    id: 'image.gpt_image2',
    key: 'gpt-image2',
    label: 'GPT Image2 cheap image generation',
    taskCode: 'agent_ti2i_gpt_image2_cheap',
    price: { credits: 50, priceTier: 'high' },
    taxonomy: { primary: '图片生成', secondary: '文图生图' },
    selection: {
      recommendationScore: 10,
      scenarios: ['所有场景'],
      highlights: ['理解力最高的模型', '默认 2K 分辨率'],
      tags: ['gpt-image2', 'reference_image', 'image_edit', 'quality'],
    },
    supports: { referenceImage: true, imageEdit: true },
    recommendedFor: ['highest-comprehension image generation and edit'],
  }),
  imageTask({
    id: 'image.nano2',
    key: 'nano2',
    label: 'Nano2 image generation',
    taskCode: 'agent_ti2i_nano2_cheap',
    price: { credits: 75, priceTier: 'high' },
    taxonomy: { primary: '图片生成', secondary: '文图生图' },
    selection: {
      recommendationScore: 9,
      scenarios: ['所有场景'],
      highlights: ['综合能力最好的模型', '默认 2K 分辨率'],
      tags: ['shotfun_nanobanana_2', '香蕉2', 'gemini3.1-image-flash-preview', 'nanobanana2', 'default', 'reference_image', 'image_edit', 'balanced'],
    },
    supports: { referenceImage: true, imageEdit: true },
    inputDefaults: { generateAudio: true },
    inputConstraints: {
      durationSeconds: { min: 4, exclusiveMin: true },
    },
    recommendedFor: ['default image generation', 'reference image edit', 'image composition'],
  }),
  imageTask({
    id: 'image.seedream5',
    key: 'seedream5',
    label: 'Seedream5 image generation',
    taskCode: 'agent_ti2i_seedream5',
    price: { credits: 50, priceTier: 'high' },
    taxonomy: { primary: '图片生成', secondary: '文图生图' },
    selection: {
      recommendationScore: 7,
      scenarios: ['所有场景'],
      highlights: ['速度较快', '理解力一般，适合作为备选', '默认 2K 分辨率'],
      tags: ['seedream5_image', 'seedream5.0', 'reference_image'],
    },
    supports: { referenceImage: true, imageEdit: true },
    recommendedFor: ['higher realism image generation'],
  }),
  imageTask({
    id: 'image.z_image',
    key: 'z-image',
    label: 'Z-Image fast text-to-image',
    taskCode: 'agent_t2i_zimage',
    resolution: '720p',
    price: { credits: 13, priceTier: 'standard' },
    taxonomy: { primary: '图片生成', secondary: '文生图' },
    selection: {
      recommendationScore: 9,
      scenarios: ['快速出图', '价格敏感', '审美好'],
      highlights: ['最快', '日常场景够用', '默认 720p 分辨率'],
      tags: ['z-image', 'low_cost', 'fast', 'text_only'],
    },
    inputDefaults: { width: 1280, height: 720 },
    supports: { referenceImage: false, imageEdit: false },
    recommendedFor: ['fast low-cost text-to-image'],
  }),
  videoTask({
    id: 'video.sd2_720p',
    key: 'sd2.0-720p',
    label: 'Seedance 2.0 reference video 720p',
    taskCode: 'agent_r2v_sd2_720p',
    resolution: '720p',
    inputLocked: { resolution: '720p' },
    price: { credits: 250, priceTier: 'premium' },
    taxonomy: { primary: '视频生成', secondary: '参考生视频' },
    selection: {
      recommendationScore: 10,
      scenarios: ['支持真人', '支持音画同出', '支持时长 4-15s'],
      highlights: ['支持真人', '当前最好的视频生成模型', '理解力好', '一致性强'],
      tags: ['seedance2.0', 'sota模型', '720p', 'reference_image', 'human', 'audio_video'],
    },
    inputDefaults: { generateAudio: true, durationSeconds: 5, aspectRatio: '16:9' },
    supports: { referenceImage: true, assetMode: true, directUrlMode: true },
    assetPipeline: {
      mode: 'allowlist-asset',
      group: {
        taskCode: 'sd_asset_group_create_linkaihub',
        reuseScope: 'user',
        defaultName: 'shotfun-reference-assets',
      },
      asset: {
        taskCode: 'sd_asset_create_linkaihub',
        assetType: 'Image',
        refOutput: 'assetRef',
      },
    },
    recommendedFor: ['best 720p reference video generation with human subjects'],
  }),
  videoTask({
    id: 'video.sd2_1080p',
    key: 'sd2.0-1080p',
    label: 'Seedance 2.0 reference video 1080p',
    taskCode: 'agent_r2v_sd2_1080p',
    resolution: '1080p',
    inputLocked: { resolution: '1080p' },
    price: { credits: 1250, priceTier: 'premium' },
    taxonomy: { primary: '视频生成', secondary: '参考生视频' },
    selection: {
      recommendationScore: 9,
      scenarios: ['支持真人', '支持音画同出', '支持时长 4-15s'],
      highlights: ['支持真人', '当前最好的视频生成模型', '理解力好', '一致性强'],
      tags: ['seedance2.0', 'sota模型', '1080p', 'reference_image', 'human', 'audio_video'],
    },
    inputDefaults: { generateAudio: true, durationSeconds: 5, aspectRatio: '16:9' },
    supports: { referenceImage: true, assetMode: true, directUrlMode: true },
    assetPipeline: {
      mode: 'allowlist-asset',
      group: {
        taskCode: 'sd_asset_group_create_linkaihub',
        reuseScope: 'user',
        defaultName: 'shotfun-reference-assets',
      },
      asset: {
        taskCode: 'sd_asset_create_linkaihub',
        assetType: 'Image',
        refOutput: 'assetRef',
      },
    },
    recommendedFor: ['best 1080p reference video generation with human subjects'],
  }),
  videoTask({
    id: 'video.sd2_fast_720p',
    key: 'sd2.0-fast-720p',
    label: 'Seedance 2.0 fast reference video 720p',
    taskCode: 'agent_r2v_sd2_fast_720p',
    resolution: '720p',
    inputLocked: { resolution: '720p' },
    price: { credits: 200, priceTier: 'premium' },
    taxonomy: { primary: '视频生成', secondary: '参考生视频' },
    selection: {
      recommendationScore: 10,
      scenarios: ['支持真人', '支持音画同出', '支持时长 4-15s'],
      highlights: ['支持真人', '当前最好的视频生成模型', '理解力好', '一致性强'],
      tags: ['seedance2.0-fast', '720p', 'reference_image', 'human', 'audio_video', 'fast'],
    },
    supports: { referenceImage: true, assetMode: true, directUrlMode: true },
    inputDefaults: { generateAudio: true, durationSeconds: 5, aspectRatio: '16:9' },
    inputConstraints: {
      durationSeconds: { min: 4, exclusiveMin: true },
    },
    assetPipeline: {
      mode: 'allowlist-asset',
      group: {
        taskCode: 'sd_asset_group_create_linkaihub',
        reuseScope: 'user',
        defaultName: 'shotfun-reference-assets',
      },
      asset: {
        taskCode: 'sd_asset_create_linkaihub',
        assetType: 'Image',
        refOutput: 'assetRef',
      },
    },
    recommendedFor: ['fast 720p reference video generation with human subjects'],
  }),
  videoTask({
    id: 'video.sd2_fast_1080p',
    key: 'sd2.0-fast-1080p',
    label: 'Seedance 2.0 fast reference video 1080p',
    taskCode: 'agent_r2v_sd2_fast_1080p',
    resolution: '1080p',
    inputLocked: { resolution: '1080p' },
    price: { credits: 1000, priceTier: 'premium' },
    taxonomy: { primary: '视频生成', secondary: '参考生视频' },
    selection: {
      recommendationScore: 9,
      scenarios: ['支持真人', '支持音画同出', '支持时长 4-15s'],
      highlights: ['支持真人', '当前最好的视频生成模型', '理解力好', '一致性强'],
      tags: ['seedance2.0-fast', '1080p', 'reference_image', 'human', 'audio_video', 'fast'],
    },
    inputDefaults: { generateAudio: true, durationSeconds: 5, aspectRatio: '16:9' },
    supports: { referenceImage: true, assetMode: true, directUrlMode: true },
    assetPipeline: {
      mode: 'allowlist-asset',
      group: {
        taskCode: 'sd_asset_group_create_linkaihub',
        reuseScope: 'user',
        defaultName: 'shotfun-reference-assets',
      },
      asset: {
        taskCode: 'sd_asset_create_linkaihub',
        assetType: 'Image',
        refOutput: 'assetRef',
      },
    },
    recommendedFor: ['fast 1080p reference video generation with human subjects'],
  }),
  videoTask({
    id: 'video.happy_horse_720p',
    key: 'happy-horse-720p',
    label: 'Happy Horse reference video 720p',
    taskCode: 'agent_r2v_happy_horse_720p',
    resolution: '720P',
    // happy horse要求大写
    inputLocked: { resolution: '720P' },
    price: { credits: 180, priceTier: 'premium' },
    taxonomy: { primary: '视频生成', secondary: '参考生视频' },
    selection: {
      recommendationScore: 9,
      scenarios: ['支持真人', '支持音画同出', '支持时长 3-15s'],
      highlights: ['排第二的视频生成模型', '便宜', '画面精美'],
      tags: ['happy_horse', '720p', 'reference_image', 'human', 'audio_video'],
    },
    inputDefaults: { generateAudio: true, durationSeconds: 5, aspectRatio: '16:9' },
    supports: { referenceImage: true, directUrlMode: true },
    recommendedFor: ['high-quality 720p reference video at lower cost'],
  }),
  videoTask({
    id: 'video.happy_horse_1080p',
    key: 'happy-horse-1080p',
    label: 'Happy Horse reference video 1080p',
    taskCode: 'agent_r2v_happy_horse_1080p',
    resolution: '1080P',
    inputLocked: { resolution: '1080P' },
    price: { credits: 320, priceTier: 'premium' },
    taxonomy: { primary: '视频生成', secondary: '参考生视频' },
    selection: {
      recommendationScore: 9,
      scenarios: ['支持真人', '支持音画同出', '支持时长 3-15s'],
      highlights: ['排第二的视频生成模型', '便宜', '画面精美'],
      tags: ['happy_horse', '1080p', 'reference_image', 'human', 'audio_video'],
    },
    inputDefaults: { generateAudio: true, durationSeconds: 5, aspectRatio: '16:9' },
    supports: { referenceImage: true, directUrlMode: true },
    recommendedFor: ['high-quality 1080p reference video at lower cost'],
  }),

  // 音频生成任务
  audioTask({
    id: 'audio.tts_single_voice',
    key: 'single',
    label: 'single text-to-speech generation',
    taskCode: 'agent_tts_minimax',
    price: { credits: 1, priceTier: 'low' },
    taxonomy: { primary: '音频生成', secondary: 'single text-to-speech generation' },
    selection: {
      recommendationScore: 7,
      scenarios: ['single text-to-speech generation'],
      highlights: ['语音生成基础能力'],
      tags: ['audio'],
    },
    recommendedFor: ['single text-to-speech generation'],
  }),
  audioTask({
    id: 'audio.voice_clone',
    key: 'clone',
    label: 'voice clone then text-to-speech generation',
    taskCode: 'agent_tts_clone',
    price: PRICE_UNKNOWN,
    taxonomy: { primary: '音频生成', secondary: '声音克隆 + TTS' },
    selection: {
      recommendationScore: 8,
      scenarios: ['clone a voice from audio URL and generate speech'],
      highlights: ['先克隆音色，再用克隆 voiceId 合成目标文本'],
      tags: ['audio', 'voice_clone'],
    },
    recommendedFor: ['voice cloning text-to-speech generation'],
  }),
  audioTask({
    id: 'audio.tts_voice_preview',
    key: 'preview',
    label: 'voice preview',
    taskCode: 'agent_tts_minimax',
    price: { credits: 1, priceTier: 'low' },
    taxonomy: { primary: '音频生成', secondary: 'voice preview' },
    selection: {
      recommendationScore: 7,
      scenarios: ['voice preview'],
      highlights: ['语音生成基础能力'],
      tags: ['audio', 'preview'],
    },
    recommendedFor: ['voice preview before full narration synthesis'],
  }),
  audioTask({
    id: 'audio.tts_voice_list',
    key: 'list',
    label: 'available voice list',
    taskCode: 'agent_tts_minimax',
    price: { credits: 1, priceTier: 'low' },
    taxonomy: { primary: '音频生成', secondary: 'available voice list' },
    selection: {
      recommendationScore: 7,
      scenarios: ['available voice list'],
      highlights: ['语音生成基础能力'],
      tags: ['audio', 'list'],
    },
    recommendedFor: ['listing available voices before selecting a narrator'],
  }),
  audioTask({
    id: 'audio.tts_script_task',
    key: 'task',
    label: 'script task voice generation',
    taskCode: 'agent_tts_minimax',
    price: { credits: 1, priceTier: 'low' },
    taxonomy: { primary: '音频生成', secondary: 'script task voice generation' },
    selection: {
      recommendationScore: 7,
      scenarios: ['script task voice generation'],
      highlights: ['语音生成基础能力'],
      tags: ['audio', 'task'],
    },
    recommendedFor: ['script-level voice generation tasks'],
  }),

  videoProcessTask({
    id: 'video_process.upscale',
    key: 'upscale',
    taskCode: 'tencentcloud_mps_transcode',
  }),
  videoProcessTask({
    id: 'video_process.subtitle_remove',
    key: 'subtitle-remove',
    taskCode: 'tencentcloud_mps_smart_erase',
  }),

  assetTask({
    id: 'asset.group_create',
    key: 'group-create',
    taskCode: 'sd_asset_group_create',
  }),
  assetTask({
    id: 'asset.create',
    key: 'create',
    taskCode: 'sd_asset_create',
  }),
])

const BY_ID = new Map(TASK_DEFINITIONS.map((task) => [task.id, task]))
const BY_CATEGORY_AND_KEY = new Map(TASK_DEFINITIONS.map((task) => [`${task.category}:${task.key}`, task]))

/**
 * 按稳定 registry id 获取任务定义。
 */
export function getTaskDefinition(id) {
  const task = BY_ID.get(id)
  if (!task) throw new Error(`Unknown ShotFun registry id: ${id}`)
  return clone(task)
}

/**
 * 列出任务定义，可按 capability 或 category 做轻量筛选。
 */
export function listTaskDefinitions(filters = {}) {
  return TASK_DEFINITIONS.filter((task) => {
    if (filters.capability && task.capability !== filters.capability) return false
    if (filters.category && task.category !== filters.category) return false
    return true
  }).map(clone)
}

/**
 * 将 CLI 使用的 category + preset key 解析为完整任务定义。
 */
export function resolveTaskPreset(category, key) {
  const task = BY_CATEGORY_AND_KEY.get(`${category}:${key}`)
  if (!task) throw new Error(`Unknown ShotFun ${category} preset: ${key}`)
  return clone(task)
}

/**
 * 为旧版 service 生成 `model -> taskCode` 兼容映射。
 */
export function createLegacyModelMap(category) {
  return Object.fromEntries(
    listTaskDefinitions({ category }).map((task) => [
      task.key,
      {
        // key：保留模型别名，便于 service 在错误信息中指出具体模型。
        key: task.key,
        // taskCode：旧 service 仍从这里取后端任务编码。
        taskCode: task.taskCode,
        // assetPipeline：参考图资产模式的资产组复用和资产创建流程配置。
        assetPipeline: task.assetPipeline,
        // resolution：模型默认分辨率，service 未指定时可直接采用。
        resolution: task.defaults.resolution,
        // durationSeconds：模型固定或推荐时长，service 用于默认值和固定时长校验。
        durationSeconds: task.defaults.durationSeconds,
        // inputDefaults：透传 task 级默认入参，提交前由 applyTaskInputRules 合并。
        inputDefaults: task.inputDefaults,
        // inputLocked：透传 task 级固化入参，用户不能覆盖。
        inputLocked: task.inputLocked,
        // inputConstraints：透传 task 级入参约束，提交前统一校验。
        inputConstraints: task.inputConstraints,
        // supports：能力约束，如是否支持参考图、素材模式、直接 URL。
        supports: task.supports,
      },
    ]),
  )
}

/**
 * 为音频等简单能力生成 `kind -> taskCode` 兼容映射。
 */
export function createLegacyTaskMap(category) {
  return Object.fromEntries(listTaskDefinitions({ category }).map((task) => [task.key, task.taskCode]))
}

/**
 * 将注册表中定义的 inputParams 默认值和约束应用到最终请求参数。
 *
 * 合并优先级：task 默认值 < service/CLI 构造出的实际入参 < task 固化值。
 */
export function applyTaskInputRules(task, inputParams = {}) {
  const locked = task.inputLocked || {}

  for (const [name, lockedValue] of Object.entries(locked)) {
    const userValue = inputParams[name]
    if (userValue !== undefined && userValue !== lockedValue) {
      throw new Error(`${task.key}.${name} is fixed to ${lockedValue}. Do not pass ${name}.`)
    }
  }

  const merged = {
    ...(task.inputDefaults || {}),
    ...inputParams,
    ...locked,
  }

  for (const [name, rule] of Object.entries(task.inputConstraints || {})) {
    validateInputConstraint(task, name, merged[name], rule)
  }

  return merged
}

function imageTask(task) {
  return buildTask({
    category: 'image',
    capability: 'text-to-image',
    docs: 'references/model-catalog.md#图片生成',
    ...task,
  })
}

function videoTask(task) {
  return buildTask({
    category: 'video',
    capability: 'image-to-video',
    docs: 'references/model-catalog.md#视频生成图生视频',
    supports: { referenceImage: true, assetMode: false, directUrlMode: false, ...task.supports },
    ...task,
  })
}

function audioTask(task) {
  return buildTask({
    category: 'audio',
    capability: 'audio-generation',
    docs: 'references/model-catalog.md#音频--tts',
    ...task,
  })
}

function videoProcessTask(task) {
  return buildTask({
    label: `${task.key} video processing`,
    category: 'video-process',
    capability: 'video-processing',
    docs: 'references/model-catalog.md#视频处理',
    price: { credits: 2, priceTier: 'standard' },
    taxonomy: { primary: '视频处理', secondary: task.key === 'upscale' ? '超分' : '去字幕' },
    selection: {
      recommendationScore: 7,
      scenarios: [`${task.key} video processing`],
      highlights: ['视频后处理能力'],
      tags: ['video_process'],
    },
    recommendedFor: [`${task.key} video processing`],
    ...task,
  })
}

function assetTask(task) {
  return buildTask({
    label: `${task.key} asset task`,
    category: 'asset',
    capability: 'project',
    docs: 'references/model-catalog.md#项目素材',
    price: { credits: 0, priceTier: 'free' },
    taxonomy: { primary: '素材管理', secondary: task.key === 'group-create' ? '素材组创建' : '素材创建' },
    selection: {
      recommendationScore: 6,
      scenarios: [`${task.key} asset management`],
      highlights: ['项目素材管理'],
      tags: ['asset'],
    },
    recommendedFor: [`${task.key} asset management`],
    ...task,
  })
}

/**
 * 组装不可变任务定义，保证外部读取后不能意外修改注册表。
 */
function buildTask({
  // id：注册表内部稳定标识，不应随后端 taskCode 调整而轻易变化。
  id,
  // key：CLI 和 service 的用户侧短别名。
  key,
  // label：人类可读标题，用于文档和日志。
  label,
  // category：模型/任务大类，驱动列表筛选和 capability schema 枚举派生。
  category,
  // capability：服务能力标识，对应 capability-schema.js 中的 capability id。
  capability,
  // taskCode：后端 OpenAPI 实际接收的任务编码。
  taskCode,
  // docs：该任务在 model-catalog 中的文档锚点。
  docs,
  // resolution：模型默认分辨率；未配置表示由调用方或后端决定。
  resolution = undefined,
  // durationSeconds：模型固定或推荐时长；未配置时 service 可使用自身默认。
  durationSeconds = undefined,
  // assetPipeline：素材模式依赖的资产组复用/创建资产流程配置。
  assetPipeline = undefined,
  // price：成本元数据，供选择器、catalog 和工作流成本估算使用。
  price = {},
  // priceTier：成本分层；默认沿用 price.priceTier，否则标记为未验证。
  priceTier = price.priceTier || PRICE_UNKNOWN.priceTier,
  // taxonomy：业务分类展示字段，不影响提交请求。
  taxonomy = {},
  // selection：模型选择元数据，包含推荐分、适用场景、亮点和标签。
  selection = {},
  // supports：模型能力约束，service 依此做前置阻断。
  supports = {},
  // inputDefaults：task 级 inputParams 默认值，会在 service 构造参数后补齐。
  inputDefaults = {},
  // inputLocked：task 级 inputParams 固化值，会在 service 构造参数后强制覆盖。
  inputLocked = {},
  // inputConstraints：task 级 inputParams 约束，提交前统一校验。
  inputConstraints = {},
  // recommendedFor：推荐用途列表，也作为 selection.scenarios 的兜底值。
  recommendedFor = [],
}) {
  const credits = Number(price.credits ?? price.pricePerCall ?? PRICE_UNKNOWN.credits)
  return Object.freeze({
    // id：对外读取和 workflow 持久化使用的稳定 registry ID。
    id,
    // key：CLI/service 使用的模型或任务短别名。
    key,
    // label：catalog 和调试输出中的可读名称。
    label,
    // category：任务大类，如 image / video / text。
    category,
    // capability：该任务归属的原子能力。
    capability,
    // taskCode：提交给 ShotFun OpenAPI 的后端任务编码。
    taskCode,
    // assetPipeline：素材报白模式流程配置；普通任务为 undefined。
    assetPipeline: assetPipeline ? freezeNested(assetPipeline) : undefined,
    // price：规范化后的成本对象，保证 credits 与 pricePerCall 同步。
    price: Object.freeze({
      ...PRICE_UNKNOWN,
      ...price,
      credits,
      pricePerCall: credits,
      priceTier,
    }),
    // taxonomy：展示分类，缺省时回落到 category / label。
    taxonomy: Object.freeze({
      primary: taxonomy.primary || category,
      secondary: taxonomy.secondary || label,
    }),
    // selection：AI 模型选择所需的排序、场景和标签信息。
    selection: Object.freeze({
      recommendationScore: clampScore(selection.recommendationScore ?? 5),
      scenarios: Object.freeze([...(selection.scenarios || recommendedFor)]),
      highlights: Object.freeze([...(selection.highlights || [])]),
      tradeoffs: Object.freeze([...(selection.tradeoffs || [])]),
      tags: Object.freeze([...(selection.tags || [])]),
      qualityTier: selection.qualityTier,
      speedTier: selection.speedTier,
    }),
    // supports：能力布尔开关，供 service 判断输入是否可被该任务处理。
    supports: Object.freeze({ ...supports }),
    // defaults：模型规格默认值，不直接等同于最终 inputParams。
    defaults: Object.freeze({ resolution, durationSeconds }),
    // inputDefaults：最终 inputParams 默认值，低优先级合并。
    inputDefaults: Object.freeze({ ...inputDefaults }),
    // inputLocked：最终 inputParams 固化值，用户入参不能覆盖。
    inputLocked: Object.freeze({ ...inputLocked }),
    // inputConstraints：最终 inputParams 约束，支持 min/max/enumValues 等规则。
    inputConstraints: freezeNested(inputConstraints),
    // recommendedFor：面向人类和 catalog 的推荐用途。
    recommendedFor: Object.freeze([...recommendedFor]),
    // docs：对应文档锚点，便于 catalog 和错误排查跳转。
    docs,
    // registryVersion：记录定义来源版本，workflow 恢复时用于检测漂移。
    registryVersion: REGISTRY_VERSION,
  })
}

function validateInputConstraint(task, name, value, rule) {
  if (value === undefined || value === null || value === '') return

  if (rule.min !== undefined) {
    const numberValue = Number(value)
    const ok = rule.exclusiveMin ? numberValue > rule.min : numberValue >= rule.min
    if (!Number.isFinite(numberValue) || !ok) {
      throw new Error(`${task.key}.${name} must be ${rule.exclusiveMin ? '>' : '>='} ${rule.min}.`)
    }
  }

  if (rule.max !== undefined) {
    const numberValue = Number(value)
    const ok = rule.exclusiveMax ? numberValue < rule.max : numberValue <= rule.max
    if (!Number.isFinite(numberValue) || !ok) {
      throw new Error(`${task.key}.${name} must be ${rule.exclusiveMax ? '<' : '<='} ${rule.max}.`)
    }
  }

  if (rule.enumValues && !rule.enumValues.includes(value)) {
    throw new Error(`${task.key}.${name} must be one of: ${rule.enumValues.join(', ')}.`)
  }
}

function freezeNested(value = {}) {
  return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, entry && typeof entry === 'object' && !Array.isArray(entry) ? Object.freeze({ ...entry }) : entry])))
}

function clampScore(value) {
  const score = Number(value)
  if (!Number.isFinite(score)) return 5
  return Math.min(10, Math.max(1, score))
}

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}
