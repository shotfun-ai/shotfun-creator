// ShotFun Capability Schema：所有 capability 的入参/出参 SSOT。
//
// schema-runtime.js 据此派生 service.normalize、CLI parseArgs、CLI printUsage。
// dump-model-catalog.js 据此生成 references/model-catalog.md。
// 改 schema 即改一切；不要在 service / CLI 中再手写默认值或参数解析。
//
// 字段约定：
//   inputs.<name>.type        'string' | 'number' | 'boolean' | 'flag' | 'json' | 'enum' | 'string[]'
//   inputs.<name>.required    true → 缺失时 service 抛错
//   inputs.<name>.default     未传时使用；object/array 会被深拷贝
//   inputs.<name>.cli         CLI 主 flag（如 '--prompt'）
//   inputs.<name>.aliases     CLI 备用 flag（如 ['--prompt'] 之于 --message）
//   inputs.<name>.repeatable  CLI 中可重复出现，值累加到数组（如 --image-url）
//   inputs.<name>.negate      反向 flag（如 '--no-wait'）
//   inputs.<name>.enumValues  枚举显式取值
//   inputs.<name>.enumFromCategory  从 task-registry 该 category 的 key 集合派生枚举（动态校验）
//   inputs.<name>.conditional 条件 required：{ when: { field: value }, requires: ['xxx'] }
//   inputs.<name>.exclusiveGroup  指定字段二选一组名；同组多于一个有值时报错（暂未启用，仅声明）

import { listTaskDefinitions } from './task-registry.js'

/** 出参 schema：声明所有可能的字段。formatTaskOutput 是事实实现。 */
export const OUTPUT_SCHEMA = {
  standardTaskOutput: {
    ok: { type: 'boolean', desc: '是否成功' },
    taskNo: { type: 'string', desc: '后端任务号' },
    status: { type: 'enum', values: ['SUCCESS', 'FAILED', 'PENDING'], desc: '任务状态' },
    resultUrls: { type: 'string[]', desc: '提取的 HTTP URL' },
    assetRefs: { type: 'string[]', desc: 'Asset://... 或 asset-... 引用' },
    textArtifacts: { type: 'object[]', desc: '文本类结果产物，如 LLM content / response', optional: true },
    artifacts: { type: 'object[]', desc: '按 Java TaskResult DTO 归一后的产物列表，包含 image / video / audio / text / asset_ref / asset_group', optional: true },
    result: { type: 'object', desc: '按 Java TaskResult DTO 归一后的业务结果摘要，包含 type 与核心字段', optional: true },
    resultPayload: { type: 'object', desc: '从 resultData / data.resultData 解出的原始结果 DTO', optional: true },
    task: { type: 'object', desc: '原始任务对象（--agent-output 时剥离）' },
    category: { type: 'string', desc: 'capability 标识' },
    model: { type: 'string', desc: '使用的模型 key（image / video）', optional: true },
    kind: { type: 'string', desc: '任务 kind（text / audio）', optional: true },
    operation: { type: 'string', desc: '操作 key（video-process / asset）', optional: true },
  },
  agentTaskOutput: {
    ok: { type: 'boolean' },
    taskNo: { type: 'string' },
    status: { type: 'string' },
    category: { type: 'string' },
    model: { type: 'string', optional: true },
    kind: { type: 'string', optional: true },
    operation: { type: 'string', optional: true },
    userArtifacts: { type: 'object[]', desc: '面向 Agent 的稳定产物列表' },
  },
  workflowOutput: {
    ok: { type: 'boolean' },
    runId: { type: 'string' },
    outputDir: { type: 'string', desc: '本次运行的绝对输出目录' },
    manifest: { type: 'string', desc: '本次运行 manifest.json 绝对路径' },
    userArtifacts: { type: 'object[]', desc: '面向用户的最终产物（URL / 本地路径）' },
    cost: { type: 'object', desc: '{ estimated, currency } 预估成本' },
  },
}

/** 通用入参片段：所有单能力 CLI 共享的 wait / dryRun / agentOutput / projectCode / input */
const COMMON_RUN_INPUTS = {
  projectCode: {
    type: 'string',
    cli: '--project-code',
    desc: '用户填写的 ShotFun 项目名；未传时 fallback 到 SHOTFUN_PROJECT_CODE / default',
  },
  input: {
    type: 'json',
    default: {},
    cli: '--input',
    desc: 'JSON，合并到 inputParams 并覆盖默认字段，用于传递扩展参数',
  },
  taskCode: {
    type: 'string',
    cli: '--task-code',
    desc: '覆盖 registry 默认 taskCode（高级用法）',
  },
  wait: {
    type: 'flag',
    default: false,
    cli: '--wait',
    desc: '阻塞轮询直到任务终态',
  },
  dryRun: {
    type: 'flag',
    default: false,
    cli: '--dry-run',
    desc: '不调 OpenAPI，只输出执行计划',
  },
  agentOutput: {
    type: 'flag',
    default: false,
    cli: '--agent-output',
    desc: '返回稳定的 userArtifacts JSON，剥离原始 task 对象',
  },
}

const UPLOAD_INPUT = {
  uploadPath: {
    type: 'string',
    cli: '--upload-path',
    desc: '可选的远程上传路径',
  },
}

/** 所有 capability 的完整 schema */
export const CAPABILITY_SCHEMA = {
  'text-to-image': {
    label: '图片生成',
    anchor: 'text-to-image',
    category: 'image',
    entry: 'scripts/cli/image-generate.js',
    service: 'scripts/services/text-to-image-service.js',
    serviceFn: 'generateImage',
    schemaMode: 'sso',

    scenarios: ['文生图', '参考图生图 / 参考图编辑', '图片合成（人物 + 场景）', '封面图、海报、场景图'],
    notApplicable: ['需要多镜头角色一致性 → 先走 character-pack workflow', '需要从图片直接生成视频 → 走 image-to-video'],
    failures: ['缺 prompt → service 层拒绝', '文生图-only 模型（如 basic）收到参考图 → service 层拒绝', '后端任务失败 / 超时 → 保留 task 输出，由调用方决定是否换模型或重试'],

    inputs: {
      prompt: { type: 'string', required: true, cli: '--prompt', desc: '图片描述提示词' },
      model: {
        type: 'enum',
        default: 'nano2',
        cli: '--model',
        enumFromCategory: 'image',
        desc: '图片模型 key，候选见决策表；未传时按 SKILL.md 决策协议选择',
      },
      imageUrls: { type: 'string[]', default: [], cli: '--image-url', repeatable: true, desc: '参考图 URL，可重复；仅决策表标「参考图」的 model 可用' },
      imageFiles: { type: 'string[]', default: [], cli: '--image-file', repeatable: true, desc: '本地参考图路径，自动上传，可重复' },
      aspectRatio: { type: 'string', default: '16:9', cli: '--aspect-ratio', desc: '宽高比，如 9:16 / 16:9 / 4:3 / 1:1' },
      resolution: { type: 'string', default: '2K', cli: '--resolution', desc: '分辨率（除 basic 外的 model 使用）' },
      width: { type: 'number', cli: '--width', desc: 'basic 模型使用；默认 1280' },
      height: { type: 'number', cli: '--height', desc: 'basic 模型使用；默认 720' },
      negativePrompt: { type: 'string', default: '', cli: '--negative-prompt', desc: '负面词，限制 extra limbs / distorted hands 等' },
      mode: { type: 'string', cli: '--mode', desc: 'model 支持时切换 generate / edit / compose' },
      ...UPLOAD_INPUT,
      ...COMMON_RUN_INPUTS,
    },

    outputs: { $ref: 'standardTaskOutput' },
  },

  'image-to-video': {
    label: '视频生成（图生视频）',
    anchor: 'image-to-video',
    category: 'video',
    entry: 'scripts/cli/video-generate.js',
    service: 'scripts/services/image-to-video-service.js',
    serviceFn: 'generateVideo',
    schemaMode: 'sso',

    scenarios: ['图生视频（参考图驱动）', '参考图视频（asset 模式 / direct-url 模式）', '轻量文生视频（少数模型支持）', '固定 10s 短视频（ref2v-grok-cheap）'],
    notApplicable: ['没有参考图且要求严格角色一致性 → 先走 text-to-image 或 character-pack', '需要剪辑编排或多步增强 → 走 workflow', '创建素材组 / 素材 → 走「项目素材」capability'],
    failures: ['参考资产模式 model 缺参考图 → 停止并要求补图', 'assetMode 非法 → service 层拒绝', '资产创建失败 → 停止并保留已完成资产步骤'],

    inputs: {
      prompt: { type: 'string', required: true, cli: '--prompt', desc: '视频动作 / 镜头描述' },
      model: {
        type: 'enum',
        default: 'sd2.0-fast-720p',
        cli: '--model',
        enumFromCategory: 'video',
        desc: '视频模型 key，候选见决策表',
      },
      imageUrls: { type: 'string[]', default: [], cli: '--image-url', repeatable: true, desc: '参考图 URL，可重复' },
      imageRefs: { type: 'string[]', default: [], cli: '--image-ref', repeatable: true, desc: 'URL 或 Asset:// 引用，可重复' },
      imageFiles: { type: 'string[]', default: [], cli: '--image-file', repeatable: true, desc: '本地参考图，自动上传，可重复' },
      assetMode: {
        type: 'enum',
        enumValues: ['asset', 'direct-url', 'none'],
        cli: '--asset-mode',
        desc: '默认：sd-reference 为 asset，其他为 none',
      },
      assetGroupName: { type: 'string', cli: '--asset-group-name', desc: '资产模式下的资产组名；未传时自动生成 run id' },
      assetGroupId: { type: 'number', cli: '--asset-group-id', desc: '资产模式下复用的已有资产组 ID；未传时按用户维度查找或创建' },
      aspectRatio: { type: 'string', default: '16:9', cli: '--aspect-ratio', desc: '宽高比' },
      resolution: { type: 'string', cli: '--resolution', desc: '分辨率，1080P 触发高成本确认' },
      durationSeconds: { type: 'number', cli: '--duration-seconds', desc: '时长秒数；固定时长 model（如 ref2v-grok-cheap）只接受 10' },
      generateAudio: { type: 'flag', cli: '--generate-audio', negate: '--no-generate-audio', desc: '是否生成音轨（仅部分 model 支持）' },
      ...UPLOAD_INPUT,
      ...COMMON_RUN_INPUTS,
    },

    outputs: { $ref: 'standardTaskOutput' },
  },

  'audio-generation': {
    label: '音频 / TTS',
    anchor: 'audio-generation',
    category: 'audio',
    entry: 'scripts/cli/audio-generate.js',
    service: 'scripts/services/audio-generation-service.js',
    serviceFn: 'generateAudio',
    schemaMode: 'sso',

    scenarios: ['TTS 单音频生成 (single)', '声音克隆后生成语音 (clone)', '按平台读取 references/voice_<platform>.json 自动选择 voice_id'],
    notApplicable: ['只需要文本类音色匹配建议 → 暂不支持'],
    failures: ['当前 kind 必填字段缺失 → service 层拒绝', '只想找音色 → 暂不支持独立 list / preview'],

    inputs: {
      kind: {
        type: 'enum',
        default: 'single',
        cli: '--kind',
        enumFromCategory: 'audio',
        desc: 'single / clone',
      },
      voiceName: {
        type: 'string',
        cli: '--voice-name',
        desc: '音色名；传 --voice-platform 时会从 references/voice_<platform>.json 查找对应 voice_id',
      },
      voiceId: { type: 'string', cli: '--voice-id', desc: '音色 ID；提交后端时写入 voiceName 字段' },
      voicePlatform: { type: 'string', cli: '--voice-platform', desc: '音色平台，对应 references/voice_<platform>.json' },
      text: {
        type: 'string',
        cli: '--text',
        desc: '待合成文本',
        conditional: { requiredWhen: { kind: ['single', 'clone', 'task'] } },
      },
      voiceUrl: {
        type: 'string',
        cli: '--voice-url',
        desc: '用于声音克隆的音频 URL；kind=clone 时必填',
        conditional: { requiredWhen: { kind: ['clone'] } },
      },
      cloneName: { type: 'string', cli: '--clone-name', desc: '克隆音色名称，可选' },
      cloneTaskCode: { type: 'string', cli: '--clone-task-code', desc: '覆盖声音克隆 taskCode；默认 agent_tts_clone' },
      ttsTaskCode: { type: 'string', cli: '--tts-task-code', desc: '覆盖克隆后 TTS taskCode；默认 agent_tts_minimax' },
      characterName: { type: 'string', default: '', cli: '--character-name', desc: '关联角色名' },
      language: { type: 'string', default: 'auto', cli: '--language', desc: '语言代码' },
      speed: { type: 'number', cli: '--speed', desc: '语速' },
      temperature: { type: 'number', cli: '--temperature', desc: '随机度' },
      ...COMMON_RUN_INPUTS,
    },

    outputs: { $ref: 'standardTaskOutput' },
  },

  'video-processing': {
    label: '视频处理',
    anchor: 'video-processing',
    category: 'video-process',
    entry: 'scripts/cli/video-process.js',
    service: 'scripts/services/video-processing-service.js',
    serviceFn: 'processVideo',
    schemaMode: 'sso',

    scenarios: ['视频高清放大 (upscale)', '字幕去除 (subtitle-remove)'],
    notApplicable: ['从图片生成视频 → 走 image-to-video', '多步骤剪辑 / 增强 → 走 workflow'],
    failures: ['缺视频输入 → 停止并要求补 URL 或文件', '未知 operation → service 层拒绝', '处理失败 → 保留 step sidecar，等待续跑'],

    inputs: {
      operation: {
        type: 'enum',
        required: true,
        cli: '--operation',
        enumFromCategory: 'video-process',
        desc: 'upscale / subtitle-remove',
      },
      videoUrl: { type: 'string', cli: '--video-url', desc: '远程视频 URL，与 --video-file 二选一' },
      videoFile: { type: 'string', cli: '--video-file', desc: '本地视频，自动上传后使用' },
      durationSeconds: { type: 'number', default: 5, cli: '--duration-seconds', desc: '处理时长上限' },
      ...UPLOAD_INPUT,
      ...COMMON_RUN_INPUTS,
    },

    outputs: { $ref: 'standardTaskOutput' },
  },

  asset: {
    label: '项目素材',
    anchor: 'asset',
    category: 'asset',
    entry: 'scripts/cli/project-assets.js',
    service: 'scripts/services/asset-service.js',
    serviceFn: ['createAssetGroup', 'createAsset'],
    schemaMode: 'sso',

    scenarios: ['创建资产组 (asset-group-create)', '创建资产 (asset-create)', '为后续 asset 模式视频生成准备素材'],
    notApplicable: ['缺 ShotFun OpenAPI 凭证'],
    failures: ['缺凭证 → 立即失败', '资产组不存在 → asset-create 失败'],

    inputs: {
      action: {
        type: 'enum',
        default: 'asset-group-create',
        cli: '--action',
        enumValues: ['asset-group-create', 'asset-create'],
        desc: '资产动作',
      },
      name: {
        type: 'string',
        required: true,
        cli: '--name',
        desc: '资产组或资产名称',
      },
      description: { type: 'string', cli: '--description', desc: '仅 asset-group-create 使用' },
      groupId: {
        // 后端 ID 可为 number 或 string，type 留空跳过强类型校验
        cli: '--group-id',
        desc: '资产组 ID（string 或 number）',
        conditional: { requiredWhen: { action: ['asset-create'] } },
      },
      url: {
        type: 'string',
        cli: '--url',
        desc: '远程资产 URL，与 --file 二选一',
        conditional: { requiredWhen: { action: ['asset-create'] } },
      },
      file: {
        type: 'string',
        cli: '--file',
        desc: '本地资产文件；创建资产前自动上传，与 --url 二选一',
      },
      assetType: { type: 'string', default: 'Image', cli: '--asset-type', desc: '资产类型，默认 Image' },
      projectName: { type: 'string', cli: '--project-name', desc: '可选的 ShotFun 项目显示名' },
      projectCode: COMMON_RUN_INPUTS.projectCode,
      taskCode: COMMON_RUN_INPUTS.taskCode,
      input: COMMON_RUN_INPUTS.input,
      wait: { type: 'flag', default: true, cli: '--wait', negate: '--no-wait', desc: '阻塞轮询；默认 true，可用 --no-wait 关闭' },
      dryRun: COMMON_RUN_INPUTS.dryRun,
    },

    outputs: { $ref: 'standardTaskOutput' },
  },

  // workflow doc-only：CLI / service 结构与单能力不同，schema 仅作为 catalog 文档
  'workflow-single-shot': {
    label: '单镜头工作流',
    anchor: 'workflow-single-shot',
    category: null,
    entry: 'scripts/cli/one-shot.js',
    service: 'scripts/workflows/single-shot-workflow.js',
    schemaMode: 'documentation',

    scenarios: ['用户输入一句话，同时得到图片和视频', '短镜头、开场镜头、产品展示镜头', '已有角色图 / 场景图，快速转视频'],
    notApplicable: ['多镜头短剧、分镜脚本、旁白、配音 → 走短剧 workflow（暂未实现）', '角色多视角一致性 → 先走角色资产包 workflow（暂未实现）', '只要静态图 → 走 text-to-image'],
    failures: [
      '缺 prompt 或必需图片输入 → 立即失败',
      '图片步骤成功 / 视频步骤失败 → 保留图片 sidecar，可 --resume 续跑',
      '任务失败 / 超时 → 保留失败 sidecar 和 manifest',
      'workflow 版本与 resume 不一致 → 必须重跑',
    ],
    note: '断点续跑：`--resume <run-id>`。校验 registry 版本、workflow 版本、整体输入 hash、每步输入 hash。',

    inputs: {
      prompt: { type: 'string', required: true, cli: '--prompt', desc: '镜头描述' },
      projectCode: { type: 'string', required: true, cli: '--project-code', desc: '用户填写的 ShotFun 项目名，未传时 default' },
      projectName: { type: 'string', cli: '--project-name', desc: '本地归档目录名，未传时与 projectCode 一致' },
      imageUrl: { type: 'string', cli: '--image-url', desc: '现有图片 URL，任一存在时跳过图片步骤' },
      imageRef: { type: 'string', cli: '--image-ref', desc: '现有 Asset:// 引用' },
      imageFile: { type: 'string', cli: '--image-file', desc: '现有本地图片' },
      imageModel: { type: 'string', cli: '--image-model', desc: '图片步骤 model；未传时按决策协议选' },
      videoModel: { type: 'string', cli: '--video-model', desc: '视频步骤 model；未传时按决策协议选' },
      budget: { type: 'enum', enumValues: ['low', 'balanced', 'quality'], default: 'balanced', cli: '--budget', desc: '预算偏好' },
      durationSeconds: { type: 'number', cli: '--duration-seconds', desc: '视频时长' },
      aspectRatio: { type: 'string', cli: '--aspect-ratio', desc: '宽高比' },
      imageResolution: { type: 'string', cli: '--image-resolution', desc: '图片分辨率' },
      videoResolution: { type: 'string', cli: '--video-resolution', desc: '视频分辨率' },
    },

    outputs: { $ref: 'workflowOutput' },
  },
}

export const CAPABILITY_ORDER = ['text-to-image', 'image-to-video', 'audio-generation', 'video-processing', 'asset', 'workflow-single-shot']

/**
 * 解析 enumFromCategory，返回该 category 下所有 model key 数组。
 * runtime 与 dump 共用，避免双方各自实现一份。
 */
export function resolveEnumValues(spec) {
  if (spec.enumValues) return [...spec.enumValues]
  if (spec.enumFromCategory) {
    return listTaskDefinitions({ category: spec.enumFromCategory }).map((task) => task.key)
  }
  return null
}
