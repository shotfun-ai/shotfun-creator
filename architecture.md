# ShotFun Agent 分层架构方案（综合版 v2）

本文档定义 `shotfun-creator` 的目标分层、目录职责、调用流程和落地验收标准。目标是让 Agent 能稳定选择 ShotFun 能力、调用对应服务、组合多步骤工作流，并把生成结果放到可预期的位置。

## 目标

- 将 OpenAPI 调用、业务能力封装、能力说明、Agent 路由和多步骤工作流分层。
- 让每个能力都能回答：适合什么场景、调用哪个 service、需要什么输入、输出在哪里、失败后怎么处理、需要多少成本。
- 让顶层 `SKILL.md` 保持轻量，只做统一路由、总原则和安全约束。
- 避免 `task_code`、价格、能力说明、调用参数在多个文件中无序漂移。
- 让 workflow 可 dry-run、可断点续跑、有并发控制、有成本预估门禁。

## 设计原则

- **KISS + 单一职责**：每一层只解决一件事；不引入未要求的灵活性。
- **Service 是给 Agent 用的，CLI 是给人用的**：业务逻辑必须沉到可 `import` 的纯函数 service；CLI 只做参数解析后转调 service，不承载业务主流程。
- **双事实来源、各司其职**：
  - `task-registry.js` **独占**：能力 ID、`taskCode`、内部/旧兼容用 `serviceType` 元数据、积分价格、一级/二级分类、适用场景、特色说明、推荐值、能力支持、默认参数、文档指针。
  - `task-selector.js` **独占**：基于 registry 元数据、用户偏好和输入上下文的自动模型选择规则。
  - `references/*-usage.md` **只写**：`capability`、`registry_ids`、`service`、`cli`、`selection_strategy`、`avoid_when`、调用流程说明、失败处理策略。
  - OpenAPI `inputParams` 不再传 `type`；任何示例请求体中的 `taskCode` 字符串应由 registry 在文档生成期注入，或显式标注「非权威，以 registry 为准」。
- **失败优先于沉默**：缺少凭证、必填参数或文件不存在时立即失败，不静默兜底。
- **可观测、可恢复**：每次 workflow 运行落盘 `manifest.json` + 每步 `step-XX.json`，失败可从中间步骤续跑。

## 目标目录结构

```text
shotfun-creator/
├── SKILL.md                              # 顶层：Agent 路由决策树（精简）
├── architecture.md                       # 本文
├── scripts/
│   ├── core/
│   │   ├── api-client.js                 # OpenAPI HTTP 基础层
│   │   ├── shotfun-service.js            # 公共 service（资产组/项目码/输出格式）
│   │   ├── task-registry.js              # 能力与 task_code 单一事实来源
│   │   ├── task-selector.js              # 自动模型选择：预算 / 场景 / 能力约束 / 推荐分
│   │   ├── workflow-runtime.js           # 并发 / manifest / 成本 / 日志原语
│   │   └── output-paths.js               # 输出目录解析与 run-id 生成
│   ├── services/                         # 纯函数业务 service（供 workflow 与 CLI 共用）
│   │   ├── asset-service.js
│   │   ├── text-to-image-service.js
│   │   ├── image-to-video-service.js
│   │   ├── audio-generation-service.js
│   │   └── video-processing-service.js
│   ├── cli/                              # 薄 CLI 包装：参数 → service
│   │   ├── image-generate.js
│   │   ├── video-generate.js
│   │   ├── audio-generate.js
│   │   ├── video-process.js
│   │   └── run-workflow.js               # workflow 通用入口（--workflow / --dry-run / --resume）
│   └── workflows/
│       ├── short-drama-workflow.js
│       ├── character-pack-workflow.js
│       ├── video-scene-workflow.js
│       └── single-shot-workflow.js
└── references/
    ├── README.md
    ├── agent-layered-architecture.md     # 本文档的对外索引版（可选）
    ├── project-usage.md                  # 项目创建 + 环境变量 + 项目码
    ├── output-conventions.md             # 输出目录约定 + manifest schema
    ├── style-guide.md                    # 风格库 + prompt 模板 + 镜头语法
    ├── troubleshooting.md                # 错误码 + 重试 + 余额 + 超时
    ├── text-to-image-usage.md
    ├── image-to-video-usage.md
    ├── audio-generation-usage.md
    ├── video-processing-usage.md
    └── workflows/
        ├── short-drama-usage.md
        ├── character-pack-usage.md
        ├── video-scene-usage.md
        └── single-shot-usage.md
```

## 分层职责

### 1. OpenAPI Client 层

文件：`scripts/core/api-client.js`

职责：

- 使用固定 OpenAPI 域名 `https://open.shotfun.cn`，读取 `SHOTFUN_API_KEY`、超时和轮询配置。
- 封装 HTTP 请求、鉴权、JSON/FormData 提交、重试、轮询、响应解包。
- 提供基础方法：创建任务、查询任务、等待任务、上传文件、查询文件、查询余额。
- 提供响应提取工具：`taskNo`、状态、结果 URL、资产引用、资产组 ID。

边界：

- 不写任何具体业务能力。
- 不知道文生图、短剧、TTS、风格、角色等业务概念。
- 只在后端 OpenAPI 协议变化时修改。

### 2. 公共 Service 层

文件：`scripts/core/shotfun-service.js`、`scripts/core/workflow-runtime.js`、`scripts/core/output-paths.js`

`shotfun-service.js` 职责：

- 创建 client、解析 project code、解析 JSON/数字/布尔参数。
- 统一上传文件、创建资产组、创建资产、提交任务并格式化输出。
- 提供所有业务 service 共用的结果格式。

`workflow-runtime.js` 职责（新增）：

- `createLimiter(concurrency)`：基于 `SHOTFUN_CONCURRENCY`（默认 3）的轻量并发闸门。
- `estimateCost(steps)`：根据 registry 中每步能力的 `price.credits` 汇总预估积分成本；兼容字段 `pricePerCall` 只用于旧调用方。
- `withCostGuard({ estimated, confirm, balance })`：跑前比对余额、必要时要求 `--confirm` 二次确认。
- `jsonlLogger(runDir)`：向 `logs/run.jsonl` 追加结构化日志（单事件 ≤ 4096B），stdout 仍输出最终结果 JSON。
- `writeStep(runDir, stepId, payload)` / `loadStep(runDir, stepId)`：步骤级 sidecar 持久化（tmp + rename 原子写），支持 `--resume`。
- `writeManifest(runDir, manifest)`：单线程串行写入 `manifest.json`（tmp + rename）。
- `hashInputs(value)`：SHA-256 摘要，统一计算 `runSpecHash` 与 `step.inputHash`。
- `persistText({ runDir, stepId, name, content, ext })`：把文本类产出落盘到 `outputDir/texts/`，返回绝对路径。供文本类 service / workflow 满足"产出物只能是路径/URL"。
- `buildUserArtifacts(sidecars, options)`：从 step sidecars 提取面向用户的 `kind` / `url` / `localPath` / `expiresAt` / `signed`，组装成"Agent 产出物契约"中的 `userArtifacts` 数组；过滤无用户产物的内部步骤。
- `sanitizeUrl(url)`：剥离预签名参数，用于需要分享的 manifest 导出。

`output-paths.js` 职责（新增）：

- 按 `references/output-conventions.md` 规则计算 `runDir`。
- 生成 `run-id`（默认 `<yyyymmdd-HHMMSS>-<8 位 uuid>`）。
- 为每类产物准备子目录（`images/`、`videos/`、`audio/`、`raw/`、`logs/`、`inputs/`）。

**两类输出形态**（严格区分）：

1. **内部输出**（写入 step sidecar 与 manifest 内部字段）：保留 `taskNo`、`status`、`resultUrls`、`assetRefs`、`task` 等审计字段，供续跑与排查。
2. **用户最终输出**（stdout 最终 JSON）：必须遵守"Agent 产出物契约"，只暴露 `userArtifacts`、`runId`、`outputDir`、`manifest`、`cost`、`ok` 等字段。

step sidecar 内部审计形态：

```json
{
  "ok": true,
  "taskNo": "task-123",
  "status": "success",
  "resultUrls": ["https://example.com/result.png"],
  "assetRefs": ["Asset://asset-123"],
  "outputDir": "./shotfun-output/run-123",
  "task": {}
}
```

失败 sidecar：

```json
{
  "ok": false,
  "errorCode": "TASK_FAILED",
  "message": "Task failed with status=failed",
  "taskNo": "task-123",
  "recoverable": true,
  "details": {}
}
```

CLI / workflow 在 stdout 输出时由 runtime 转换为"Agent 产出物契约"形状（见下方"Agent 产出物契约"章节）。失败时 stdout 输出 `{ ok: false, runId, outputDir, manifest, errorCode, message, recoverable }`，**不**附带 `details` 大对象（`details` 留在 sidecar）。

### 3. 业务 Service 层

文件示例：

- `scripts/services/text-to-image-service.js`
- `scripts/services/image-to-video-service.js`
- `scripts/services/audio-generation-service.js`
- `scripts/services/video-processing-service.js`
- `scripts/services/asset-service.js`

职责：

- 将用户意图转换为后端 `taskCode` 和 `inputParams`。
- 调用公共 service 和 OpenAPI client。
- 处理本能力真实可达的失败路径（缺参、模型不支持的参数等）。
- 导出可被 workflow 和 CLI **共同 import 的纯函数**：

```js
export async function generateImage({ client, projectCode, model, prompt, ...opts }) { ... }
export async function generateVideo({ client, projectCode, model, imageUrl, ...opts }) { ... }
```

- 输出统一 JSON，供 Agent 或 workflow 继续消费。

边界：

- 不直接处理 Agent 路由说明。
- 不写长篇能力介绍。
- 不把多步骤剧集生成逻辑塞进单一能力 service。
- 不直接 `process.exit`、不直接写 `console.log` 最终结果（交给 CLI 层），只在出错时 throw 结构化错误。

### 4. 能力说明层

目录：`references/`

每个 `*-usage.md` 描述一个能力族，面向 Agent 阅读，不面向最终用户营销。推荐结构：**机器可读 frontmatter + 人类可读正文**。

**重要约束**：usage frontmatter 与正文中**不出现裸 `task_code` / `inputParams.type` / 价格数字**等代码事实字段；`taskCode`、内部/旧兼容用 `serviceType` 元数据、积分价格、分类和选择元数据独占归 `task-registry.js`。OpenAPI `inputParams` 不再传 `type`。usage 只通过 `registry_ids` 引用能力 ID，并提供选择策略与不适用场景说明。示例请求体若出现，必须由 registry 在构建期生成，或显式标注「非权威示例，以 registry 为准」。

```md
---
capability: text-to-image
service: scripts/services/text-to-image-service.js
cli: scripts/cli/image-generate.js
default_model: nano2
registry_ids:                  # ← 只引用，不复制 task_code/type/price
  - image.nano2
  - image.basic
  - image.qwen
  - image.seedream5
  - image.nano2_stable
  - image.nano_pro
  - image.nano_pro_stable
selection_strategy:
  default: image.nano2
  prefer_high_realism: image.seedream5
  prefer_low_cost: image.nano2
  prefer_stable: image.nano2_stable
avoid_when:
  - 需要 4K 出片
  - 需要严格的角色一致性（请走 character-pack workflow）
---

# 文生图

## 一级分类

## 二级分类

## 接口名称

## 文档地址

## 适用场景

## 不适用场景

## 价格

## 特色说明

## 推荐用途

## 默认 task_code

## 输入要求

## 输出结果

## 调用方式（Service / CLI）

## 失败处理

## 其它说明
```

能力说明层必须明确：

- 什么用户需求应该调用这个能力。
- 调用哪个 service 或 workflow。
- 哪些参数必填，哪些参数有默认值。
- 生成结果默认保存在哪里。
- 失败时 Agent 应该重试、换模型、补参数，还是停止并说明原因。
- 单次预估成本范围（与 `task-registry.js` 同步）。

### 5. 基础能力文档（references 下的 4 篇必读）

| 文件 | 内容要点 |
| --- | --- |
| `references/project-usage.md` | 项目创建 / 项目码 / 环境变量 / 安全约束 |
| `references/output-conventions.md` | 输出目录解析顺序 / run-id / manifest schema / step sidecar |
| `references/style-guide.md` | prompt 风格库 / 负面词模板 / 镜头语法 / 角色风格一致性策略 |
| `references/troubleshooting.md` | 常见错误码 / 余额不足 / 超时 / 重试策略 / 任务断点续跑指南 |

`references/project-usage.md` 至少包含：

- 项目创建和项目码使用方式。
- 必需环境变量：`SHOTFUN_API_KEY`、`SHOTFUN_PROJECT_CODE`。
- 可选环境变量：`SHOTFUN_OUTPUT_DIR`、`SHOTFUN_TIMEOUT_MS`、`SHOTFUN_POLL_INTERVAL_MS`、`SHOTFUN_CONCURRENCY`、`SHOTFUN_DRY_RUN`、`SHOTFUN_CONFIRM_COST_ABOVE`。
- 默认输出目录规则与覆盖优先级。
- 风格、参考图、生成资产和中间 JSON 的推荐目录。
- 不提交 `.env.local`、生成资产、响应中的 token 或私有 URL。

推荐默认输出目录优先级：

```text
1. SHOTFUN_OUTPUT_DIR
2. 当前工作目录 ./shotfun-output/<run-id>/
3. 如果当前目录不可写，使用 ~/ShotFun/outputs/<run-id>/
```

### 6. Workflow 层

目录：`scripts/workflows/`，配套文档 `references/workflows/*-usage.md`

职责：

- 编排多个业务 service 完成复合目标。
- 例如「生成一部剧」应拆为分镜、角色图、场景图、图生视频、TTS、视频处理等步骤。
- 每一步消费上一层输出的结构化 JSON，不直接解析后端原始响应。
- 必须支持：`--dry-run`（打印 DAG 不真调）、`--resume <run-id>`（断点续跑）、`--confirm`（成本门禁通过）。

边界：

- workflow 只做编排和状态传递。
- 具体 OpenAPI 参数仍由业务 service 负责。
- workflow usage 文档必须说明每一步的输入、输出、失败恢复和停止条件，并标注**预估总成本范围**与**是否需要 `--confirm`**。

必备能力（由 `workflow-runtime.js` 统一提供）：

- **并发控制**：基于 `SHOTFUN_CONCURRENCY` 限并发；可并发步骤经 `createLimiter`。
- **成本预估**：跑前汇总 `price.credits × 步数`，超阈值（默认 5 积分）必须 `--confirm`。
- **结构化日志**：`logs/run.jsonl` 每行一个事件（step start/end/fail、taskNo、耗时、URL），事件超出 4096B 必须分片或截断 `details`，保证 POSIX 追加原子性。
- **步骤 sidecar**：每步写 `steps/<NN>-<name>.json`，含 `inputParams`、`taskNo`、`resultUrls`、`cost`、时间、`inputHash`、`registryVersion`、`workflowVersion`、`serviceVersion`。
- **断点续跑**：`--resume <run-id>` 必须校验四个一致性条件后才跳过已成功步骤。

#### 断点续跑一致性校验（防止"跳错步骤产出脏结果"）

每次 workflow 启动时计算并写入 manifest：

- `runSpecHash`：对整个 workflow 输入（用户 goal + 所有用户输入参数 + 引用文件内容摘要）做 SHA-256。
- `registryVersion`：从 `task-registry.js` 读取的版本号。
- `workflowVersion`：workflow 模块顶部声明的语义版本号（每次输入契约或步骤拓扑变更必须 +1）。

每个 step sidecar 额外记录：

- `step.inputHash`：对该步实际传入 service 的 `inputParams + 上游引用` 做 SHA-256。
- `step.serviceVersion`：service 模块声明的语义版本号。

`--resume <run-id>` 的判定：

| 条件 | 行为 |
| --- | --- |
| `runSpecHash` 不一致 | 默认拒绝；需要 `--force-resume` 才允许 |
| `registryVersion` 不一致 | 默认拒绝；需要 `--force-resume` |
| `workflowVersion` 不一致 | 默认拒绝；不允许 `--force-resume`（拓扑变更必须重跑） |
| 某 step 的 `inputHash` 与当前计算不一致 | 该步及其下游不可跳过，从该步开始重跑 |
| 全部一致 | 按 sidecar 跳过 `status: success` 的步骤 |

`--force-resume` 会在 manifest 追加 `forceResumed: true` 与原 hash，用于审计。

短剧工作流示例：

```text
用户需求：生成一部剧
1. 读取 workflow-short-drama-usage.md
2. 解析或生成 run-id，准备输出目录
3. 预估成本（registry × 步数）→ 超阈值要求 --confirm
4. 准备故事、角色、分镜输入（来自用户或工作流本地处理）
5. 调用 text-to-image-service 生成角色图和场景图（并发受闸门控制）
6. 调用 image-to-video-service 生成分镜视频（并发受闸门控制）
7. 调用 audio-generation-service 生成旁白或角色语音（并发）
8. 调用 video-processing-service 做必要增强或处理
9. 写入 outputDir 下的 manifest.json 与 logs/run.jsonl
```

### 7. Agent 指导层

文件：`SKILL.md`

职责：

- 提供统一入口和能力大纲（**用户意图 → 必读文档 → 调用对象**的决策树）。
- 根据用户意图路由到 `references/*-usage.md`。
- 指导 Agent 先读 usage，再调用对应 service 或 workflow。
- 说明安全要求、环境变量要求、输出目录规则、成本门禁与错误处理原则。
- 明确「必读前置」：任意任务前先看 `project-usage.md` + `output-conventions.md`。

`SKILL.md` 不应包含全部 task 参数细节；细节放在 `references/*-usage.md`，代码事实放在 `scripts/core/task-registry.js`，业务实现放在 `scripts/services/`。

## 能力路由建议

| 用户意图 | 先读文档 | 调用对象 |
| --- | --- | --- |
| 创建 ShotFun 素材组或素材 | `references/project-usage.md` | `scripts/services/asset-service.js` |
| 文生图、图生图、图片编辑 | `references/text-to-image-usage.md` | `scripts/services/text-to-image-service.js` |
| 图生视频、参考图生视频 | `references/image-to-video-usage.md` | `scripts/services/image-to-video-service.js` |
| TTS、音频生成、音色预览 | `references/audio-generation-usage.md` | `scripts/services/audio-generation-service.js` |
| 视频高清、字幕去除等处理 | `references/video-processing-usage.md` | `scripts/services/video-processing-service.js` |
| 单镜头：文 → 图 → 视频 | `references/workflows/single-shot-usage.md` | `scripts/workflows/single-shot-workflow.js` |
| 生成一部短剧或多镜头视频 | `references/workflows/short-drama-usage.md` | `scripts/workflows/short-drama-workflow.js` |
| 角色资产包（多视角统一角色） | `references/workflows/character-pack-usage.md` | `scripts/workflows/character-pack-workflow.js` |
| 单场景多镜头生成 | `references/workflows/video-scene-usage.md` | `scripts/workflows/video-scene-workflow.js` |

## task_code 管理

必须避免同一 `task_code` 同时散落在 `SKILL.md`、usage 文档和多个脚本中。

事实来源分工：

- **代码事实来源**：`scripts/core/task-registry.js`，独占 `taskCode`、内部/旧兼容用 `serviceType` 元数据、积分价格、一级/二级分类、适用场景、特色说明、推荐值、能力技术属性、默认参数和后端文档地址。
- **选择规则来源**：`scripts/core/task-selector.js`，独占自动选择的硬过滤与评分逻辑；不保存 taskCode、价格或分类事实。
- **文档事实来源**：`references/*-usage.md`，只写 `capability`、`registry_ids`、`service`、`cli`、`selection_strategy`、`avoid_when`、调用流程、失败处理。
- **顶层索引来源**：`references/README.md` 和 `SKILL.md`。

`task-registry.js` 维护（**唯一字段归属地**）：

- 能力 ID（如 `image.nano2`）
- 一级分类、二级分类
- 默认 `taskCode`
- 内部/旧兼容用 `serviceType` 元数据；OpenAPI `inputParams` 不再传 `type`
- 积分价格 `price.credits` / 计费标签 / 单次预估成本（用于 workflow 成本汇总）
- 是否支持参考图、参考视频、资产模式
- 适用场景、特色说明、推荐值（1-10 分）、推荐用途与不推荐场景
- 后端文档地址
- `registryVersion`（一个独立模块级常量，每次有破坏性字段调整必须 +1，用于 `--resume` 一致性校验）

usage 文档**不允许**复制 `taskCode` / `inputParams.type` / 价格字符串；只通过 `registry_ids` 引用能力 ID。需要展示具体 task_code 时，由 registry 在构建期或调用期生成；手写的示例必须显式标注「非权威示例」。所有 OpenAPI 示例请求体都不得包含 `inputParams.type`。

## 自动模型选择

`scripts/core/task-selector.js` 负责在调用方未显式指定模型，或传入 `auto` 时选择 registry preset。选择器只读取 `task-registry.js` 的元数据，不复制价格、分类或 taskCode。

输入维度：

- `category`：能力类别，如 `image`、`video`。
- `userModel`：用户显式模型；非 `auto` 时直接解析并返回。
- `userPrefs`：用户偏好，如 `budget`（`low` / `balanced` / `quality`）、`scenario`、`quality`、`stability`。
- `context`：当前输入约束，如是否有参考图、是否需要图片编辑、`assetMode`、`durationSeconds`、`resolution`。

选择流程：

1. 用户显式指定模型时，直接走 `resolveTaskPreset(category, userModel)`；未知模型立即失败。
2. 按真实能力硬过滤：参考图、图片编辑、资产模式、直接 URL 模式、固定时长、分辨率等不满足时排除。
3. 对候选项评分：推荐值、场景匹配、预算匹配、能力匹配、质量/稳定偏好加分，积分成本扣分。
4. 返回 `{ task, reason, candidates }`；`reason` 用于 dry-run、manifest 和 step sidecar 的可审计说明。

当前 `single-shot` 工作流默认 `imageModel=auto`、`videoModel=auto`。默认图片场景偏向“低成本出图”，默认视频场景偏向“默认图生视频”；当 `durationSeconds=10` 时视频场景偏向“固定 10s 视频”。CLI 可通过 `--budget`、`--image-scenario`、`--video-scenario` 覆盖选择偏好，也可通过 `--image-model`、`--video-model` 强制指定。

## 错误处理原则

- 缺少 API Key、项目码、必填 prompt、文件不存在：立即失败并给出可操作错误。
- 后端任务失败：返回 `ok: false`、`taskNo`、状态、错误信息和原始详情。
- 任务超时：返回可恢复错误，提示可用 `taskNo` 后续查询；写入 step sidecar，支持 `--resume`。
- 模型不支持参考图或某个参数：在 service 层拒绝，而不是让后端报错。
- workflow 中某一步失败：按 usage 中声明的策略（重试 / 换模型 / 停止）处理；默认停止并保留 manifest，等待 `--resume`。
- 非必要场景不添加复杂兜底，不自动切换昂贵模型，除非 usage 文档明确允许。

## 输出目录规范

每次运行产生一个独立 `run-id`，并在输出目录中保留结构化清单与每步 sidecar。

推荐结构（带注释标明是否默认创建）：

```text
shotfun-output/
└── <run-id>/
    ├── manifest.json          # 始终创建（runtime 串行写入）
    ├── inputs/                # 始终创建：用户原始输入、参考图副本
    ├── steps/                 # 始终创建：每步 sidecar（断点续跑用）
    │   ├── 01-storyboard.json
    │   ├── 02-character-image.json
    │   └── 03-shot-01-video.json
    ├── logs/
    │   └── run.jsonl          # 始终创建：结构化事件流
    ├── images/                # 仅 --fetch-remote 时创建
    ├── videos/                # 仅 --fetch-remote 时创建
    ├── audio/                 # 仅 --fetch-remote 时创建
    └── raw/                   # 仅 SHOTFUN_KEEP_RAW=1 时创建
```

`manifest.json` 至少记录：

- `runId`、`projectCode`、`workflow`、`createdAt`、`finishedAt`
- 用户原始目标 `goal`
- `runSpecHash`、`registryVersion`、`workflowVersion`、`forceResumed?`
- 调用过的能力清单与 taskNo
- `modelSelection`：自动模型选择摘要，记录每步选中的 registry id、模型 key、选择原因、推荐值、积分价格和分类
- `resultUrls`、`assetRefs`（**内部审计字段**，不直接面向用户）
- `userArtifacts`：与 stdout 最终 JSON 完全一致的产出物清单（路径或 URL），是面向用户的唯一权威列表
- 本地文件路径（按类型分组，仅 `--fetch-remote` 时存在）
- `cost.estimated`、`cost.actual`、`balanceBefore`、`balanceAfter`（来自 balance diff）
- `failedSteps`、`status`（`success` / `partial` / `failed` / `aborted`）

`steps/<NN>-<name>.json` 至少记录：

- `stepId`、`name`、`status`、`startedAt`、`finishedAt`
- `service`、`function`、`inputParams`
- `selection`：该步骤的模型选择摘要（显式指定模型时也记录选择来源）
- `taskNo`、`resultUrls`、`assetRefs`、`localFiles`
- `costEstimated`、`costActual?`、`error?`
- `inputHash`、`registryVersion`、`workflowVersion`、`serviceVersion`（断点续跑校验用）

### 并发写入与原子性

并发步骤同时写 `manifest.json` 会有 lost-update。约束：

- **每步 sidecar**：写文件用 `tmp + rename` 原子写（在同一目录下写 `steps/<NN>-<name>.json.tmp.<pid>`，再 `fs.rename` 到目标名）。
- **`manifest.json`**：由 runtime 单一聚合协程串行写入，不允许业务 service 或 workflow 步骤直接写 manifest；同样用 tmp + rename。
- **`logs/run.jsonl`**：append-only，单事件序列化后必须 ≤ 4096 字节（POSIX `PIPE_BUF`）以保证多并发追加不裂行；超长时拆 `summary` + `details_truncated: true`，原始体丢 `raw/` 目录另存。
- **跨进程协作**：本架构不支持多进程并发写同一 run-id；若未来要支持，由 runtime 在 `runDir/.lock` 加文件锁。

## 成本与并发控制

- **成本预估门禁**：所有 workflow 启动前必须计算总预估积分；超过 `SHOTFUN_CONFIRM_COST_ABOVE`（默认 5 积分）必须显式 `--confirm` 才执行。预估摘要与 `getBalance()` 余额**写到 stderr 与 `logs/run.jsonl`**，不进 stdout。
- **实际成本回填**：workflow 跑完后通过余额前后差值或步骤累计填 `cost.actual`，写入 manifest，并作为字段并入 stdout 最终 JSON（见下方"可观测性"）。
- **并发闸门**：所有可并发步骤（生成多张角色图 / 多个镜头视频）必须经过 `createLimiter(SHOTFUN_CONCURRENCY)`，默认 3。
- **节流默认值**：`SHOTFUN_POLL_INTERVAL_MS=3000`、`SHOTFUN_TIMEOUT_MS=120000` 与 client 保持一致；workflow 不重新发明轮询节奏。
- **高成本 workflow 标记**：在 workflow usage frontmatter 标 `cost_tier: high`，SKILL.md 路由表标⚠️。

## 可观测性

输出通道职责严格分离：

| 通道 | 内容 | 说明 |
| --- | --- | --- |
| **stdout** | 仅最终结果 JSON（单个对象） | 供上层 Agent / pipe 消费；不允许打印任何过程信息 |
| **stderr** | 人类可读进度、确认提示、余额、成本摘要、错误堆栈 | 用户/Agent 实时阅读 |
| **`logs/run.jsonl`** | 结构化事件流（每行一个 JSON） | 程序化解析、回放、监控 |

stdout 最终 JSON 的字段形状由"Agent 产出物契约"章节定义；本节只约束**通道**：成本与余额必须出现在 stdout 最终 JSON 的 `cost` 字段，过程信息必须只走 stderr 与 `logs/run.jsonl`。具体 JSON 例见下文"Agent 产出物契约"。

`logs/run.jsonl` 事件示例：

```json
{"t":"2026-05-14T03:12:11.123Z","event":"cost_estimate","estimated":4.8,"balanceBefore":152.30,"requiresConfirm":false}
{"t":"...","event":"step_start","stepId":"03","name":"shot-01-video"}
{"t":"...","event":"step_end","stepId":"03","status":"success","taskNo":"task-789","ms":42100,"cost":0.45}
{"t":"...","event":"cost_summary","estimated":4.8,"actual":4.92,"balanceAfter":147.38}
```

其他约束：

- **dry-run**：所有 service 和 workflow 必须支持 `--dry-run`；只打印将要发送的请求体或步骤 DAG 到 stderr，stdout 输出 `{ok: true, dryRun: true, plan: ...}`，不真调 API。
- **resume**：workflow 必须支持 `--resume <run-id>`，按 `steps/*.json` 跳过已成功步骤，并按上节一致性规则校验。

## Agent 产出物契约

**铁律**：本 skill 服务于 Agent，最终对用户暴露的所有"产出物"必须是**本地文件路径**或**网址**，不允许内联返回内容主体。

### 适用范围

所有 service、workflow、CLI 入口在 stdout 输出的最终 JSON 与写入 manifest 的 `userArtifacts` 字段都必须遵守。Agent 在向用户复述结果时只引用这些字段。

### 强制规则

1. **图像 / 视频 / 音频**：只返回 URL 或本地路径，禁止 base64、二进制 buffer、data URI。
2. **文本类产出**（角色卡、分镜脚本、旁白文案、音色匹配结果、Prompt 集合）：必须**写入本地文件**（`outputDir/texts/<stepId>-<name>.<ext>`），stdout 只返回该文件路径；同一文本若同时落盘和远程托管，两者并列返回。
3. **结构化结果**（如分镜 JSON、角色 JSON）：写入 `outputDir/texts/<stepId>-<name>.json`，返回路径；不要把整个对象塞进 stdout。
4. **日志、错误堆栈、中间任务详情**：只在 stderr 与 `logs/run.jsonl` 出现，不进入 `userArtifacts`。
5. **路径形式**：本地路径优先返回**绝对路径**（便于 Agent 跨工作目录引用）；同时在 manifest 中保留相对 `outputDir` 的路径，便于打包迁移。
6. **URL 形式**：保留原始 URL；若为带 token 的预签名 URL，stdout 字段中标 `expiresAt`、`signed: true`，提醒 Agent 提示用户尽快下载或开启 `--fetch-remote`。
7. **空产出**：若某步只是中间编排（如建立资产组）、没有面向用户的产物，不写入 `userArtifacts`；不能用空字符串或占位符。

### stdout 最终 JSON 形状（约束版）

```json
{
  "ok": true,
  "runId": "20260514-031211-a1b2c3d4",
  "outputDir": "/abs/path/to/shotfun-output/20260514-031211-a1b2c3d4",
  "manifest": "/abs/path/to/.../manifest.json",
  "userArtifacts": [
    {
      "kind": "image",
      "name": "character-hero",
      "url": "https://cdn.shotfun.cn/.../hero.png?...",
      "localPath": "/abs/.../images/02-character-hero-1.png",
      "expiresAt": "2026-05-14T07:12:11Z",
      "signed": true
    },
    {
      "kind": "video",
      "name": "shot-01",
      "url": "https://cdn.shotfun.cn/.../shot01.mp4",
      "localPath": null
    },
    {
      "kind": "text",
      "name": "storyboard",
      "localPath": "/abs/.../texts/01-storyboard.json"
    }
  ],
  "cost": { "estimated": 10, "actual": 10, "currency": "credits", "balanceBefore": 152, "balanceAfter": 142 }
}
```

字段定义：

- `userArtifacts[].kind`：`image` | `video` | `audio` | `text` | `asset_ref`（指 ShotFun 内部资产引用 `Asset://...`）。
- `userArtifacts[].url`：远程 URL，可选。
- `userArtifacts[].localPath`：本地绝对路径，可选。
- `url` 与 `localPath` 至少有一个；都为空的产出物不允许存在。

### 与现有 service 输出的关系

现有 `formatTaskOutput` 返回的 `resultUrls`、`assetRefs`、`task` 仍保留在 step sidecar 与 manifest 中，作为内部审计与续跑依据；但**不会原样进 stdout 最终 JSON 的 `userArtifacts`**。runtime 负责将 sidecar 信息转换为 `userArtifacts`。

### 文本产物的落盘命名

- 文本默认扩展名：纯文本 `.txt`、Markdown `.md`、结构化 `.json`。
- 命名：`<stepId>-<name>.<ext>`，与图像/视频命名风格一致。
- 内容编码：UTF-8 无 BOM；末尾保留一个换行。

### 反例（必须拒绝）

```json
// ❌ 不允许
{ "ok": true, "storyboard": "第一幕：主角走进酒馆..." }
{ "ok": true, "image_base64": "iVBORw0K..." }
{ "ok": true, "characters": [{ "name": "李雷", "desc": "黑发男主..." }] }

// ✅ 正确
{ "ok": true, "userArtifacts": [
  { "kind": "text", "name": "storyboard", "localPath": "/abs/.../texts/01-storyboard.md" },
  { "kind": "text", "name": "characters", "localPath": "/abs/.../texts/02-characters.json" }
] }
```

## 远程产物落地策略

ShotFun 任务成功后大多返回远程 URL（且可能为带 token 的预签名 URL，存在过期与泄漏风险）。本架构明确以下策略：

- **默认模式**：`mode=record-only`，只把 URL 写入 manifest 与 step sidecar，不下载。
  - `images/`、`videos/`、`audio/` 目录在 `record-only` 模式下**不创建**。
- **下载模式**：`mode=download`（通过 `SHOTFUN_FETCH_REMOTE=1` 或 CLI `--fetch-remote` 启用）。runtime 在每步成功后顺序下载到对应子目录。
- **本地文件命名**：`<stepId>-<name>-<index>.<ext>`，扩展名从 Content-Type 推断；同时把 SHA-256 写入 sidecar 的 `localFiles[i].sha256`。
- **过期处理**：runtime 解析 URL 中的 expires/X-Amz-Expires；若距过期 < 5 分钟，立刻下载或在 stderr 提示用户尽快持久化。
- **下载失败**：单文件 2 次重试（与 `api-client` 重试策略复用），仍失败标记 `localFiles[i].error`，不阻塞 workflow。
- **私有 URL 脱敏**：写入 manifest 与 sidecar 的 URL 默认保留原值用于回放；若需要分享 manifest，提供 `scripts/core/sanitize-manifest.js`，剥离 query 中常见 token 字段（`X-Amz-*`、`Signature`、`Expires`、`token`、`sig`）后另存。
- **`raw/` 原始响应**：默认不落盘；`SHOTFUN_KEEP_RAW=1` 时落盘，且在 `.gitignore` 中保持忽略。

## 安全要求

- 凭证只能从环境变量读取。
- 不提交 `.env.local`、生成资产、私有 URL、token 或完整敏感响应。
- 不用用户输入拼接 shell 命令。
- OpenAPI 请求体使用 JSON 或 `FormData` 结构化提交。
- 高成本 workflow 在 usage 文档中标记 `cost_tier: high`，并在执行前提示成本风险与余额，要求 `--confirm`。
- `raw/` 目录默认不入库；若包含可分享的预签名 URL，必须经 `sanitize-manifest.js` 脱敏后再导出。

### `.gitignore` 同步约定

现状 `shotfun-creator/.gitignore` 已忽略 `outputs/`、`*.mp4`、`*.png`、`*.log` 等，但默认输出目录名为 `shotfun-output/`，不一致。落地时必须在 `shotfun-creator/.gitignore` 中追加：

```text
shotfun-output/
ShotFun/outputs/
```

并在 `references/project-usage.md` 中显式列出三种输出目录候选与对应忽略规则，避免目录约定漂移。`SHOTFUN_OUTPUT_DIR` 指向自定义路径时，由用户自行维护其 `.gitignore`。

## 落地顺序

1. 维护本架构文档（已完成）。
2. 新增 `references/project-usage.md`、`output-conventions.md`、`style-guide.md`、`troubleshooting.md`，统一基础约束。
3. 新增 `scripts/core/task-registry.js`，把现有 `IMAGE_MODELS`、`VIDEO_MODELS`、`TEXT_TASKS`、`VIDEO_PROCESS_TASKS` 迁入，补积分价格、一级/二级分类、适用场景、特色说明、推荐值、`recommended_for` 等字段；引入 `registryVersion` 常量。
4. 新增 `scripts/core/output-paths.js` 和 `scripts/core/workflow-runtime.js`（限并发 / manifest / step sidecar / jsonl 日志 / hash 校验 / 原子写 / `persistText` 文本落盘 / `buildUserArtifacts` 产出物组装 / `sanitizeUrl` 脱敏）。
5. ~~新增 `scripts/core/registry-lint.js`，扫描 usage 是否出现裸 task_code~~（usage 文档已收编到 `model-catalog.md`，lint 已废弃删除）。
6. 将现有分类脚本中的业务逻辑抽到 `scripts/services/*.js`（纯函数、可 import）。
7. 把 `scripts/` 根级原 CLI 改成 thin wrapper（转调 `scripts/cli/<name>.js`），并加 deprecation 提示；同步更新 `scripts/package.json`。
8. 把 `references/*.md` 逐个改造为带 frontmatter 的 `*-usage.md`，与 registry 对齐；usage 中去掉所有裸 task_code。
9. 新增 `scripts/core/task-selector.js`，实现按用户设定与 registry 元数据自动选择模型；为预算、场景、能力过滤和固定时长选择补测试。
10. 新增 `scripts/workflows/`，以 `single-shot-workflow.js` 起步，再做 `short-drama-workflow.js`；接入 hash 校验、`--resume` 和 `modelSelection`。
11. 新增 `scripts/cli/run-workflow.js` 通用入口（`--workflow`、`--dry-run`、`--resume`、`--force-resume`、`--confirm`、`--fetch-remote`）。
12. 精简并重写 `SKILL.md`，只保留路由决策树、必读前置、安全与成本约束；同步更新根级 README。
13. 为每个 service 与 workflow 补 `--dry-run` 测试；为 runtime 的原子写与 hash 校验补单测。
14. 同步 `.gitignore`：把 `shotfun-output/`、`ShotFun/outputs/` 加入忽略；保留现有 `outputs/`、`*.mp4`、`*.png` 等规则。
15. 到达兼容窗口后，删除根级旧入口，`registryVersion` +1，发布破坏性变更说明。

## 验收标准

- 新增能力时，只需要新增或更新一个 service、一个 usage 文档、一个 registry 条目。
- Agent 能通过 `SKILL.md` 找到正确 usage 文档，并据此调用正确 service 或 workflow。
- 单能力脚本和 workflow 都返回统一 JSON（stdout 一行最终结果，含成本字段）。
- 所有生成结果都有明确输出目录、`manifest.json`、每步 sidecar 与 `logs/run.jsonl`；manifest 与 sidecar 全部经 tmp + rename 原子写入。
- `task_code`、`serviceType` 元数据、积分价格、分类、适用场景、特色说明和推荐值有唯一代码事实来源（`task-registry.js`）；capability 级语义与入参/出参 schema 的唯一来源是 `capability-schema.js`，service/CLI 通过 `schema-runtime.js` 派生默认值与校验；OpenAPI `inputParams` 不传 `type`。
- 未显式指定模型的 workflow 能通过 `task-selector.js` 自动选择模型，并在 dry-run、manifest 和 step sidecar 中写入 `modelSelection` / `selection` 选择原因。
- 缺少环境变量、输入不完整、任务失败和超时都有清晰错误输出（stderr 人类可读 + stdout JSON）。
- 所有 workflow 支持 `--dry-run` 与 `--resume`；`--resume` 强制校验 `runSpecHash`、`registryVersion`、`workflowVersion`、`step.inputHash`；不一致时拒绝或要求 `--force-resume`。
- 高成本 workflow 在不带 `--confirm` 时拒绝执行；预估与实际成本写入 stdout 最终 JSON 与 manifest。
- 所有可并发步骤经过 `createLimiter` 控制；不会出现失控并发刷接口。
- `references/` 至少包含决策与契约文档（`model-catalog.md` 自动生成）+ 调用约定（`calling-conventions.md`）+ 横切基础文档（`output-conventions.md` / `style-guide.md` / `troubleshooting.md`）。
- CLI 唯一入口位于 `scripts/cli/`；不再保留根级兼容包装器。
- `.gitignore` 包含 `shotfun-output/` 与 `ShotFun/outputs/`；远程 URL 默认只记录、不下载；`--fetch-remote` 时才创建 `images/` `videos/` `audio/` 子目录。
- Agent 最终向用户暴露的产出物**只有文件路径与网址**（见下节"Agent 产出物契约"）。
