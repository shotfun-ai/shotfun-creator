import { ShotFunOpenApiError } from '../core/api-client.js'

// 这些能力依赖“提示词”驱动生成；缺失 prompt 时直接阻断，避免提交无效任务。
const PROMPT_REQUIRED_CAPABILITIES = new Set(['image', 'video'])

/**
 * 统一构造 ShotFun OpenAPI 的 `inputParams`。
 *
 * 设计目标：
 * 1) 针对不同 capability 产出对应结构，避免调用方散落拼接逻辑；
 * 2) 默认字段走“最小有效集”，仅在值有效时写入；
 * 3) 允许调用方通过 `options.input` 注入/覆盖字段，兼容后端扩展。
 *
 * 约束规则：
 * - image / video 必须提供 prompt；
 * - 未识别的 capability 直接抛错，避免静默失败。
 */
export function buildInputParams(capability, options = {}) {
  // 对提示词必填能力做前置校验，尽早失败。
  if (PROMPT_REQUIRED_CAPABILITIES.has(capability) && isAbsent(options.prompt)) {
    throw new ShotFunOpenApiError('Missing prompt.')
  }

  // 按能力路由到对应参数模板。
  switch (capability) {
    case 'image':
      return buildImageParams(options)
    case 'video':
      return buildVideoParams(options)
    case 'audio':
      // 音频能力中 kind=list 仅用于查询列表，不需要业务参数。
      if (options.kind === 'list') return mergeParams({}, options.input)
      // TTS/语音生成参数。
      return mergeParams(
        {
          voiceName: options.voiceId || options.voiceName, // 后端使用 voiceName 字段接收音色 ID / 名称。
          voicePlatform: options.voicePlatform, // 音色平台，用于服务端追踪和调试。
          text: options.text, // 要合成的文本内容。
          characterName: options.characterName, // 角色名（用于音色或角色路由）。
          language: options.language, // 语言代码或语言名。
          speed: options.speed, // 语速倍率。
          temperature: options.temperature, // 采样温度，影响表达随机性。
        },
        options.input,
      )
    case 'audio-clone':
      return mergeParams(
        {
          audioUrl: options.voiceUrl,
          name: options.cloneName,
        },
        options.input,
      )
    case 'video-process':
      // 视频处理任务（如超分/去字幕等）通常以源 URL + 可选时长入参。
      return mergeParams(
        {
          url: options.url, // 待处理视频 URL。
          durationSeconds: options.durationSeconds, // 可选：处理时长（秒）。
        },
        options.input,
      )
    case 'asset-group':
      // 素材组创建参数。
      return mergeParams(
        {
          name: options.name, // 素材组名称。
          description: options.description, // 素材组描述。
          projectName: options.projectName, // 所属项目名。
        },
        options.input,
      )
    case 'asset':
      // 素材创建参数（可绑定内部组 ID 或第三方 provider 组 ID）。
      return mergeParams(
        {
          groupId: options.groupId, // 平台内素材组 ID。
          providerGroupId: options.providerGroupId, // 第三方服务商素材组 ID。
          url: options.url, // 素材源 URL。
          name: options.name, // 素材名称。
          assetType: options.assetType, // 素材类型（image/video/audio 等）。
          projectName: options.projectName, // 所属项目名。
        },
        options.input,
      )
    default:
      // 显式抛错，避免 capability 写错时仍然提交请求。
      throw new ShotFunOpenApiError(`Unknown input params capability: ${capability}`)
  }
}

/**
 * 构造图片生成/编辑任务参数。
 * - 兼容文生图与参考图编辑；
 * - 保留 providerModel -> model 的映射，贴合后端字段约定。
 */
function buildImageParams(options) {
  return mergeParams(
    {
      prompt: options.prompt, // 必填：提示词，图片描述或编辑要求。
      negativePrompt: options.negativePrompt, // 可选：反向提示词，限制不希望出现的内容。
      aspectRatio: options.aspectRatio, // 可选：宽高比，如 1:1 / 16:9 / 9:16 / 3:2 / 2:3 / 4:3 / 3:4 / 5:4 / 4:5 / 21:9。
      imageUrls: options.imageUrls, // 可选：参考图片 URL 列表；纯文生图通常不传。
      resolution: options.resolution, // 可选：分辨率，如 720p / 1K / 2K / 4K。
      mode: options.mode, // 可选：模式，支持 generate(生图) / edit(编辑) / compose(合成)。
      model: options.providerModel, // 可选：服务商模型名；通常由 task 配置决定。
      width: options.width, // 可选：显式宽度（像素）。
      height: options.height, // 可选：显式高度（像素）。
      steps: options.steps, // 可选：生成步数，Comfy/Z-Image 类任务常用。
      cfg: options.cfg, // 可选：CFG 值，Comfy/Z-Image 类任务常用。
      seed: options.seed, // 可选：随机种子（Long）。
    },
    options.input,
  )
}

/**
 * 构造视频生成任务参数。
 * 说明：
 * - 同时写入 `duration` 与 `durationSeconds`，兼容不同后端字段命名；
 * - 支持 image/video/audio 多输入类型，覆盖图生视频或混合输入场景。
 */
function buildVideoParams(options) {
  const durationSeconds = options.durationSeconds
  return mergeParams(
    {
      prompt: options.prompt, // 必填：视频动作、镜头、风格描述。
      negativePrompt: options.negativePrompt, // 可选：反向提示词。
      imageFile: options.imageFile, // 可选：首帧图像 URL 或 Base64（支持 data:image/...;base64,...）。
      imageUrls: options.imageUrls, // 可选：参考图片 URL 或 Asset 引用列表。
      videoUrls: options.videoUrls, // 可选：参考视频列表。
      audioUrls: options.audioUrls, // 可选：参考音频列表。
      duration: durationSeconds, // 可选：兼容字段，值与 durationSeconds 一致。
      durationSeconds, // 可选：视频时长（秒），默认由模型或调用侧决定。
      resolution: options.resolution, // 可选：分辨率，如 720p / 1080p / 1920x1080。
      aspectRatio: options.aspectRatio, // 可选：视频宽高比，如 16:9 / 9:16 / 1:1 / 4:3 / 3:4。
      width: options.width, // 可选：视频宽（像素）。
      height: options.height, // 可选：视频高（像素）。
      fps: options.fps, // 可选：帧率。
      mode: options.mode, // 可选：使用模式。
      generateAudio: options.generateAudio, // 可选：是否生成音频（Boolean）。
      seed: options.seed, // 可选：种子整数；默认 -1 随机，取值范围 [-1, 2^32-1]。
    },
    options.input,
  )
}

/**
 * 合并基础参数与调用方覆写参数。
 * 先清洗两侧空值，再以 overrides 覆盖 base（后者优先级更高）。
 */
function mergeParams(base, overrides = {}) {
  return {
    ...cleanObject(base),
    ...cleanObject(overrides),
  }
}

/**
 * 清理对象中的“空值”字段，避免把无效字段发送给后端。
 * 空值定义见 `isAbsent`。
 */
function cleanObject(value = {}) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => !isAbsent(entry)))
}

/**
 * 判断是否为空值：
 * - undefined / null
 * - 空字符串 ''
 * - 空数组 []
 *
 * 注意：0、false、非空对象都视为有效值。
 */
function isAbsent(value) {
  if (value === undefined || value === null) return true
  if (typeof value === 'string' && value.length === 0) return true
  if (Array.isArray(value) && value.length === 0) return true
  return false
}
