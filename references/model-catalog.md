<!-- 此文件由 scripts/core/dump-model-catalog.js 自动生成，禁止手动修改。 -->
<!-- 修改 scripts/core/task-registry.js 或 scripts/core/capability-schema.js 后，
     重新运行 `node scripts/core/dump-model-catalog.js`。 -->

# ShotFun Model Catalog

Registry version: `2026.05.21`

AI 在调任何 ShotFun service 之前必须读本文件。每个 capability 一节，覆盖：
适用场景 → 不适用场景 → 模型决策表 → 入参规范 → 出参 → 失败处理。
入参与出参的 SSOT 在 `scripts/core/capability-schema.js`，service / CLI 从 schema 派生默认值与校验。
调用模板与代码示例见 [`calling-conventions.md`](./calling-conventions.md)，
决策协议见 [`../SKILL.md`](../SKILL.md) 的「模型决策协议」节。

## 目录

- [图片生成](#text-to-image)
- [视频生成（图生视频）](#image-to-video)
- [音频 / TTS](#audio-generation)
- [视频处理](#video-processing)
- [项目素材](#asset)
- [单镜头工作流](#workflow-single-shot)

## 字段说明

**决策表列**
- `key`：传给 CLI `--model` / `--kind` / `--operation` 的别名
- `priceTier`：`low` / `standard` → 静默推进；`high` / `premium` → 必须向用户复述确认
- `推荐分`：0–10，越高越优先
- `能力/约束`：参考图、图编辑、素材模式、固定时长等硬约束

**入参表列**
- `字段`：service / CLI 共享的命名（CLI flag 见对应列）
- `必填`：✅ 必填；条件必填会注明触发条件
- `类型`：string / number / boolean / flag / json / enum / string[]
- `默认值`：未传时使用
- `CLI flag`：命令行 flag；`[alias]` 列出别名；`[repeatable]` 表示可重复传

**通用出参 schema**：

**standardTaskOutput**

| 字段 | 类型 | 可选 | 说明 |
| --- | --- | --- | --- |
| `ok` | boolean | — | 是否成功 |
| `taskNo` | string | — | 后端任务号 |
| `status` | enum<SUCCESS|FAILED|PENDING> | — | 任务状态 |
| `resultUrls` | string[] | — | 提取的 HTTP URL |
| `assetRefs` | string[] | — | Asset://... 或 asset-... 引用 |
| `textArtifacts` | object[] | 可选 | 文本类结果产物，如 LLM content / response |
| `artifacts` | object[] | 可选 | 按 Java TaskResult DTO 归一后的产物列表，包含 image / video / audio / text / asset_ref / asset_group |
| `result` | object | 可选 | 按 Java TaskResult DTO 归一后的业务结果摘要，包含 type 与核心字段 |
| `resultPayload` | object | 可选 | 从 resultData / data.resultData 解出的原始结果 DTO |
| `task` | object | — | 原始任务对象（--agent-output 时剥离） |
| `category` | string | — | capability 标识 |
| `model` | string | 可选 | 使用的模型 key（image / video） |
| `kind` | string | 可选 | 任务 kind（text / audio） |
| `operation` | string | 可选 | 操作 key（video-process / asset） |

工作流出参 schema：

**workflowOutput**

| 字段 | 类型 | 可选 | 说明 |
| --- | --- | --- | --- |
| `ok` | boolean | — |  |
| `runId` | string | — |  |
| `outputDir` | string | — | 本次运行的绝对输出目录 |
| `manifest` | string | — | 本次运行 manifest.json 绝对路径 |
| `userArtifacts` | object[] | — | 面向用户的最终产物（URL / 本地路径） |
| `cost` | object | — | { estimated, currency } 预估成本 |

## 图片生成

**Service**：`scripts/services/text-to-image-service.js` ｜ **CLI**：`scripts/cli/image-generate.js`


### 适用场景

- 文生图
- 参考图生图 / 参考图编辑
- 图片合成（人物 + 场景）
- 封面图、海报、场景图

### 不适用场景

- 需要多镜头角色一致性 → 先走 character-pack workflow
- 需要从图片直接生成视频 → 走 image-to-video

### 模型决策表

| key | 价格 (credits) | priceTier | 推荐分 | 适用场景 | 能力 / 约束 | 亮点 | 取舍 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `gpt-image2` | 50 | `high` | 10 | 所有场景 | 参考图 / 图编辑 | 理解力最高的模型 / 默认 2K 分辨率 | — |
| `z-image` | 13 | `standard` | 9 | 快速出图 / 价格敏感 / 审美好 | 默认 720p | 最快 / 日常场景够用 / 默认 720p 分辨率 | — |
| `nano2` | 75 | `high` | 9 | 所有场景 | 参考图 / 图编辑 | 综合能力最好的模型 / 默认 2K 分辨率 | — |
| `seedream5` | 50 | `high` | 7 | 所有场景 | 参考图 / 图编辑 | 速度较快 / 理解力一般，适合作为备选 / 默认 2K 分辨率 | — |

### 入参规范

| 字段 | 必填 | 类型 | 默认值 | CLI flag | 说明 |
| --- | --- | --- | --- | --- | --- |
| `prompt` | ✅ | string | — | `--prompt` | 图片描述提示词 |
| `model` | — | enum<gpt-image2\|nano2\|seedream5\|z-image> | `"nano2"` | `--model` | 图片模型 key，候选见决策表；未传时按 SKILL.md 决策协议选择 |
| `imageUrls` | — | string[] | `[]` | `--image-url`<br>repeatable | 参考图 URL，可重复；仅决策表标「参考图」的 model 可用 |
| `imageFiles` | — | string[] | `[]` | `--image-file`<br>repeatable | 本地参考图路径，自动上传，可重复 |
| `aspectRatio` | — | string | `"16:9"` | `--aspect-ratio` | 宽高比，如 9:16 / 16:9 / 4:3 / 1:1 |
| `resolution` | — | string | `"2K"` | `--resolution` | 分辨率（除 basic 外的 model 使用） |
| `width` | — | number | — | `--width` | basic 模型使用；默认 1280 |
| `height` | — | number | — | `--height` | basic 模型使用；默认 720 |
| `negativePrompt` | — | string | `""` | `--negative-prompt` | 负面词，限制 extra limbs / distorted hands 等 |
| `mode` | — | string | — | `--mode` | model 支持时切换 generate / edit / compose |
| `uploadPath` | — | string | — | `--upload-path` | 可选的远程上传路径 |
| `projectCode` | — | string | — | `--project-code` | 用户填写的 ShotFun 项目名；未传时 fallback 到 SHOTFUN_PROJECT_CODE / default |
| `input` | — | json | `{}` | `--input` | JSON，合并到 inputParams 并覆盖默认字段，用于传递扩展参数 |
| `taskCode` | — | string | — | `--task-code` | 覆盖 registry 默认 taskCode（高级用法） |
| `wait` | — | flag | `false` | `--wait` | 阻塞轮询直到任务终态 |
| `dryRun` | — | flag | `false` | `--dry-run` | 不调 OpenAPI，只输出执行计划 |
| `agentOutput` | — | flag | `false` | `--agent-output` | 返回稳定的 userArtifacts JSON，剥离原始 task 对象 |

### 出参 schema

引用通用 schema：`standardTaskOutput`（见顶部「字段说明」节）。

### 失败处理

- 缺 prompt → service 层拒绝
- 文生图-only 模型（如 basic）收到参考图 → service 层拒绝
- 后端任务失败 / 超时 → 保留 task 输出，由调用方决定是否换模型或重试

## 视频生成（图生视频）

**Service**：`scripts/services/image-to-video-service.js` ｜ **CLI**：`scripts/cli/video-generate.js`


### 适用场景

- 图生视频（参考图驱动）
- 参考图视频（asset 模式 / direct-url 模式）
- 轻量文生视频（少数模型支持）
- 固定 10s 短视频（ref2v-grok-cheap）

### 不适用场景

- 没有参考图且要求严格角色一致性 → 先走 text-to-image 或 character-pack
- 需要剪辑编排或多步增强 → 走 workflow
- 创建素材组 / 素材 → 走「项目素材」capability

### 模型决策表

| key | 价格 (credits) | priceTier | 推荐分 | 适用场景 | 能力 / 约束 | 亮点 | 取舍 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `sd2.0-fast-720p` | 200 | `premium` | 10 | 支持真人 / 支持音画同出 / 支持时长 4-15s | 参考图 / asset 模式 / direct URL / 默认 720p | 支持真人 / 当前最好的视频生成模型 / 理解力好 / 一致性强 | — |
| `sd2.0-720p` | 250 | `premium` | 10 | 支持真人 / 支持音画同出 / 支持时长 4-15s | 参考图 / asset 模式 / direct URL / 默认 720p | 支持真人 / 当前最好的视频生成模型 / 理解力好 / 一致性强 | — |
| `happy-horse-720p` | 180 | `premium` | 9 | 支持真人 / 支持音画同出 / 支持时长 3-15s | 参考图 / direct URL / 默认 720P | 排第二的视频生成模型 / 便宜 / 画面精美 | — |
| `happy-horse-1080p` | 320 | `premium` | 9 | 支持真人 / 支持音画同出 / 支持时长 3-15s | 参考图 / direct URL / 默认 1080P | 排第二的视频生成模型 / 便宜 / 画面精美 | — |
| `sd2.0-fast-1080p` | 1000 | `premium` | 9 | 支持真人 / 支持音画同出 / 支持时长 4-15s | 参考图 / asset 模式 / direct URL / 默认 1080p | 支持真人 / 当前最好的视频生成模型 / 理解力好 / 一致性强 | — |
| `sd2.0-1080p` | 1250 | `premium` | 9 | 支持真人 / 支持音画同出 / 支持时长 4-15s | 参考图 / asset 模式 / direct URL / 默认 1080p | 支持真人 / 当前最好的视频生成模型 / 理解力好 / 一致性强 | — |

### 入参规范

| 字段 | 必填 | 类型 | 默认值 | CLI flag | 说明 |
| --- | --- | --- | --- | --- | --- |
| `prompt` | ✅ | string | — | `--prompt` | 视频动作 / 镜头描述 |
| `model` | — | enum<sd2.0-720p\|sd2.0-1080p\|sd2.0-fast-720p\|sd2.0-fast-1080p\|happy-horse-720p\|happy-horse-1080p> | `"sd2.0-fast-720p"` | `--model` | 视频模型 key，候选见决策表 |
| `imageUrls` | — | string[] | `[]` | `--image-url`<br>repeatable | 参考图 URL，可重复 |
| `imageRefs` | — | string[] | `[]` | `--image-ref`<br>repeatable | URL 或 Asset:// 引用，可重复 |
| `imageFiles` | — | string[] | `[]` | `--image-file`<br>repeatable | 本地参考图，自动上传，可重复 |
| `assetMode` | — | enum<asset\|direct-url\|none> | — | `--asset-mode` | 默认：sd-reference 为 asset，其他为 none |
| `assetGroupName` | — | string | — | `--asset-group-name` | 资产模式下的资产组名；未传时自动生成 run id |
| `assetGroupId` | — | number | — | `--asset-group-id` | 资产模式下复用的已有资产组 ID；未传时按用户维度查找或创建 |
| `aspectRatio` | — | string | `"16:9"` | `--aspect-ratio` | 宽高比 |
| `resolution` | — | string | — | `--resolution` | 分辨率，1080P 触发高成本确认 |
| `durationSeconds` | — | number | — | `--duration-seconds` | 时长秒数；固定时长 model（如 ref2v-grok-cheap）只接受 10 |
| `generateAudio` | — | flag | — | `--generate-audio`<br>negate: `--no-generate-audio` | 是否生成音轨（仅部分 model 支持） |
| `uploadPath` | — | string | — | `--upload-path` | 可选的远程上传路径 |
| `projectCode` | — | string | — | `--project-code` | 用户填写的 ShotFun 项目名；未传时 fallback 到 SHOTFUN_PROJECT_CODE / default |
| `input` | — | json | `{}` | `--input` | JSON，合并到 inputParams 并覆盖默认字段，用于传递扩展参数 |
| `taskCode` | — | string | — | `--task-code` | 覆盖 registry 默认 taskCode（高级用法） |
| `wait` | — | flag | `false` | `--wait` | 阻塞轮询直到任务终态 |
| `dryRun` | — | flag | `false` | `--dry-run` | 不调 OpenAPI，只输出执行计划 |
| `agentOutput` | — | flag | `false` | `--agent-output` | 返回稳定的 userArtifacts JSON，剥离原始 task 对象 |

### 出参 schema

引用通用 schema：`standardTaskOutput`（见顶部「字段说明」节）。

### 失败处理

- 参考资产模式 model 缺参考图 → 停止并要求补图
- assetMode 非法 → service 层拒绝
- 资产创建失败 → 停止并保留已完成资产步骤

## 音频 / TTS

**Service**：`scripts/services/audio-generation-service.js` ｜ **CLI**：`scripts/cli/audio-generate.js`


### 适用场景

- TTS 单音频生成 (single)
- 声音克隆后生成语音 (clone)
- 按平台读取 references/voice_<platform>.json 自动选择 voice_id

### 不适用场景

- 只需要文本类音色匹配建议 → 暂不支持

### 模型决策表

| key | 价格 (credits) | priceTier | 推荐分 | 适用场景 | 能力 / 约束 | 亮点 | 取舍 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `clone` | 0 (unverified) | `unverified` | 8 | clone a voice from audio URL and generate speech | — | 先克隆音色，再用克隆 voiceId 合成目标文本 | — |
| `single` | 1 | `low` | 7 | single text-to-speech generation | — | 语音生成基础能力 | — |
| `preview` | 1 | `low` | 7 | voice preview | — | 语音生成基础能力 | — |
| `list` | 1 | `low` | 7 | available voice list | — | 语音生成基础能力 | — |
| `task` | 1 | `low` | 7 | script task voice generation | — | 语音生成基础能力 | — |

### 入参规范

| 字段 | 必填 | 类型 | 默认值 | CLI flag | 说明 |
| --- | --- | --- | --- | --- | --- |
| `kind` | — | enum<single\|clone\|preview\|list\|task> | `"single"` | `--kind` | single / clone |
| `voiceName` | — | string | — | `--voice-name` | 音色名；传 --voice-platform 时会从 references/voice_<platform>.json 查找对应 voice_id |
| `voiceId` | — | string | — | `--voice-id` | 音色 ID；提交后端时写入 voiceName 字段 |
| `voicePlatform` | — | string | — | `--voice-platform` | 音色平台，对应 references/voice_<platform>.json |
| `text` | 条件 (kind∈[single,clone,task]) | string | — | `--text` | 待合成文本 |
| `voiceUrl` | 条件 (kind∈[clone]) | string | — | `--voice-url` | 用于声音克隆的音频 URL；kind=clone 时必填 |
| `cloneName` | — | string | — | `--clone-name` | 克隆音色名称，可选 |
| `cloneTaskCode` | — | string | — | `--clone-task-code` | 覆盖声音克隆 taskCode；默认 agent_tts_clone |
| `ttsTaskCode` | — | string | — | `--tts-task-code` | 覆盖克隆后 TTS taskCode；默认 agent_tts_minimax |
| `characterName` | — | string | `""` | `--character-name` | 关联角色名 |
| `language` | — | string | `"auto"` | `--language` | 语言代码 |
| `speed` | — | number | — | `--speed` | 语速 |
| `temperature` | — | number | — | `--temperature` | 随机度 |
| `projectCode` | — | string | — | `--project-code` | 用户填写的 ShotFun 项目名；未传时 fallback 到 SHOTFUN_PROJECT_CODE / default |
| `input` | — | json | `{}` | `--input` | JSON，合并到 inputParams 并覆盖默认字段，用于传递扩展参数 |
| `taskCode` | — | string | — | `--task-code` | 覆盖 registry 默认 taskCode（高级用法） |
| `wait` | — | flag | `false` | `--wait` | 阻塞轮询直到任务终态 |
| `dryRun` | — | flag | `false` | `--dry-run` | 不调 OpenAPI，只输出执行计划 |
| `agentOutput` | — | flag | `false` | `--agent-output` | 返回稳定的 userArtifacts JSON，剥离原始 task 对象 |

### 出参 schema

引用通用 schema：`standardTaskOutput`（见顶部「字段说明」节）。

### 失败处理

- 当前 kind 必填字段缺失 → service 层拒绝
- 只想找音色 → 暂不支持独立 list / preview

## 视频处理

**Service**：`scripts/services/video-processing-service.js` ｜ **CLI**：`scripts/cli/video-process.js`


### 适用场景

- 视频高清放大 (upscale)
- 字幕去除 (subtitle-remove)

### 不适用场景

- 从图片生成视频 → 走 image-to-video
- 多步骤剪辑 / 增强 → 走 workflow

### 模型决策表

| key | 价格 (credits) | priceTier | 推荐分 | 适用场景 | 能力 / 约束 | 亮点 | 取舍 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `upscale` | 2 | `standard` | 7 | upscale video processing | — | 视频后处理能力 | — |
| `subtitle-remove` | 2 | `standard` | 7 | subtitle-remove video processing | — | 视频后处理能力 | — |

### 入参规范

| 字段 | 必填 | 类型 | 默认值 | CLI flag | 说明 |
| --- | --- | --- | --- | --- | --- |
| `operation` | ✅ | enum<upscale\|subtitle-remove> | — | `--operation` | upscale / subtitle-remove |
| `videoUrl` | — | string | — | `--video-url` | 远程视频 URL，与 --video-file 二选一 |
| `videoFile` | — | string | — | `--video-file` | 本地视频，自动上传后使用 |
| `durationSeconds` | — | number | `5` | `--duration-seconds` | 处理时长上限 |
| `uploadPath` | — | string | — | `--upload-path` | 可选的远程上传路径 |
| `projectCode` | — | string | — | `--project-code` | 用户填写的 ShotFun 项目名；未传时 fallback 到 SHOTFUN_PROJECT_CODE / default |
| `input` | — | json | `{}` | `--input` | JSON，合并到 inputParams 并覆盖默认字段，用于传递扩展参数 |
| `taskCode` | — | string | — | `--task-code` | 覆盖 registry 默认 taskCode（高级用法） |
| `wait` | — | flag | `false` | `--wait` | 阻塞轮询直到任务终态 |
| `dryRun` | — | flag | `false` | `--dry-run` | 不调 OpenAPI，只输出执行计划 |
| `agentOutput` | — | flag | `false` | `--agent-output` | 返回稳定的 userArtifacts JSON，剥离原始 task 对象 |

### 出参 schema

引用通用 schema：`standardTaskOutput`（见顶部「字段说明」节）。

### 失败处理

- 缺视频输入 → 停止并要求补 URL 或文件
- 未知 operation → service 层拒绝
- 处理失败 → 保留 step sidecar，等待续跑

## 项目素材

**Service**：`scripts/services/asset-service.js` ｜ **CLI**：`scripts/cli/project-assets.js`


### 适用场景

- 创建资产组 (asset-group-create)
- 创建资产 (asset-create)
- 为后续 asset 模式视频生成准备素材

### 不适用场景

- 缺 ShotFun OpenAPI 凭证

### 模型决策表

| key | 价格 (credits) | priceTier | 推荐分 | 适用场景 | 能力 / 约束 | 亮点 | 取舍 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `group-create` | 0 | `free` | 6 | group-create asset management | — | 项目素材管理 | — |
| `create` | 0 | `free` | 6 | create asset management | — | 项目素材管理 | — |

### 入参规范

| 字段 | 必填 | 类型 | 默认值 | CLI flag | 说明 |
| --- | --- | --- | --- | --- | --- |
| `action` | — | enum<asset-group-create\|asset-create> | `"asset-group-create"` | `--action` | 资产动作 |
| `name` | ✅ | string | — | `--name` | 资产组或资产名称 |
| `description` | — | string | — | `--description` | 仅 asset-group-create 使用 |
| `groupId` | 条件 (action∈[asset-create]) | any | — | `--group-id` | 资产组 ID（string 或 number） |
| `url` | 条件 (action∈[asset-create]) | string | — | `--url` | 远程资产 URL，与 --file 二选一 |
| `file` | — | string | — | `--file` | 本地资产文件；创建资产前自动上传，与 --url 二选一 |
| `assetType` | — | string | `"Image"` | `--asset-type` | 资产类型，默认 Image |
| `projectName` | — | string | — | `--project-name` | 可选的 ShotFun 项目显示名 |
| `projectCode` | — | string | — | `--project-code` | 用户填写的 ShotFun 项目名；未传时 fallback 到 SHOTFUN_PROJECT_CODE / default |
| `taskCode` | — | string | — | `--task-code` | 覆盖 registry 默认 taskCode（高级用法） |
| `input` | — | json | `{}` | `--input` | JSON，合并到 inputParams 并覆盖默认字段，用于传递扩展参数 |
| `wait` | — | flag | `true` | `--wait`<br>negate: `--no-wait` | 阻塞轮询；默认 true，可用 --no-wait 关闭 |
| `dryRun` | — | flag | `false` | `--dry-run` | 不调 OpenAPI，只输出执行计划 |

### 出参 schema

引用通用 schema：`standardTaskOutput`（见顶部「字段说明」节）。

### 失败处理

- 缺凭证 → 立即失败
- 资产组不存在 → asset-create 失败

## 单镜头工作流

**Service**：`scripts/workflows/single-shot-workflow.js` ｜ **CLI**：`scripts/cli/one-shot.js`

> 入参规范为文档说明，runtime 不强制校验（workflow 入口有自定义解析）。

### 适用场景

- 用户输入一句话，同时得到图片和视频
- 短镜头、开场镜头、产品展示镜头
- 已有角色图 / 场景图，快速转视频

### 不适用场景

- 多镜头短剧、分镜脚本、旁白、配音 → 走短剧 workflow（暂未实现）
- 角色多视角一致性 → 先走角色资产包 workflow（暂未实现）
- 只要静态图 → 走 text-to-image

### 入参规范

| 字段 | 必填 | 类型 | 默认值 | CLI flag | 说明 |
| --- | --- | --- | --- | --- | --- |
| `prompt` | ✅ | string | — | `--prompt` | 镜头描述 |
| `projectCode` | ✅ | string | — | `--project-code` | 用户填写的 ShotFun 项目名，未传时 default |
| `projectName` | — | string | — | `--project-name` | 本地归档目录名，未传时与 projectCode 一致 |
| `imageUrl` | — | string | — | `--image-url` | 现有图片 URL，任一存在时跳过图片步骤 |
| `imageRef` | — | string | — | `--image-ref` | 现有 Asset:// 引用 |
| `imageFile` | — | string | — | `--image-file` | 现有本地图片 |
| `imageModel` | — | string | — | `--image-model` | 图片步骤 model；未传时按决策协议选 |
| `videoModel` | — | string | — | `--video-model` | 视频步骤 model；未传时按决策协议选 |
| `budget` | — | enum<low\|balanced\|quality> | `"balanced"` | `--budget` | 预算偏好 |
| `durationSeconds` | — | number | — | `--duration-seconds` | 视频时长 |
| `aspectRatio` | — | string | — | `--aspect-ratio` | 宽高比 |
| `imageResolution` | — | string | — | `--image-resolution` | 图片分辨率 |
| `videoResolution` | — | string | — | `--video-resolution` | 视频分辨率 |

### 出参 schema

引用通用 schema：`workflowOutput`（见顶部「字段说明」节）。

### 失败处理

- 缺 prompt 或必需图片输入 → 立即失败
- 图片步骤成功 / 视频步骤失败 → 保留图片 sidecar，可 --resume 续跑
- 任务失败 / 超时 → 保留失败 sidecar 和 manifest
- workflow 版本与 resume 不一致 → 必须重跑

> 断点续跑：`--resume <run-id>`。校验 registry 版本、workflow 版本、整体输入 hash、每步输入 hash。
