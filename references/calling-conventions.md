---
capability: calling-conventions
service: scripts/core/api-client.js
cli: scripts/cli/*.js
---

# Calling Conventions

ShotFun 所有 service / CLI 共享的统一调用约定。各 capability 的语义、入参、出参、失败处理见 [`model-catalog.md`](./model-catalog.md)；本文件只承担「调用模板 + 通用 CLI 选项 + 环境变量 + 输出 schema」。

## 认证与项目

- 认证：优先从当前工作目录的 `.env.local` 读取 `SHOTFUN_API_KEY`，作为 `X-Api-Key` 发送；未配置时才读取其他运行时环境。凭证不能写入代码、manifest、日志或 git。缺少 API Key 时，引导用户到 [shotfun.cn/agent](https://shotfun.cn/agent) 注册/登录 ShotFun 账户并获取 API Key，再写入本地 `.env.local`。
- 项目名称：CLI 通过 `--project-code <project-name>` 传 ShotFun 项目名；未传时读取 `SHOTFUN_PROJECT_CODE`，仍为空则使用 `default`。OpenAPI 字段名仍叫 `projectCode`。
- 本地归档：CLI 通过 `--project-name` 覆盖本地 `shotfun-output/projects/<slug>/` 目录名；未传时读取 `SHOTFUN_PROJECT_NAME`，仍为空则使用 `default`。

输出目录结构详见 [`output-conventions.md`](./output-conventions.md)。

## 环境变量

Load priority:

1. CLI args
2. `<cwd>/.env.local`
3. `EXTEND.md`
4. env vars
5. `<cwd>/.shotfun-agent/.env`
6. `~/.shotfun-agent/.env`

`.env.local` 和 `.env` 使用普通 `KEY=value` 格式。新用户获取 API Key 后默认写入 `<cwd>/.env.local`，例如 `SHOTFUN_API_KEY=...`；该文件被 `.gitignore` 的 `.env.*` 规则忽略。`EXTEND.md` 支持 YAML front matter 中的 `env:` / `environment:` 字段，也支持顶层大写环境变量键。支持的 `EXTEND.md` 位置为 `<cwd>/.shotfun-agent/EXTEND.md`、`~/.shotfun-agent/EXTEND.md`，其中 cwd 级配置覆盖 home 级配置。`<cwd>/.shotfun-agent/` 已被 git 忽略；不要把包含密钥的 `EXTEND.md` 放到仓库跟踪路径。

必需：

- `SHOTFUN_API_KEY`

可选：

| 变量 | 作用 |
| --- | --- |
| `SHOTFUN_OUTPUT_DIR` | 自定义输出根目录 |
| `SHOTFUN_PROJECT_CODE` | 未传 `--project-code` 时的默认 ShotFun 项目名 |
| `SHOTFUN_TIMEOUT_MS` | 单任务轮询超时，默认 300000（5 分钟） |
| `SHOTFUN_POLL_INTERVAL_MS` | 任务轮询间隔 |
| `SHOTFUN_CONCURRENCY` | 工作流并发度上限 |
| `SHOTFUN_DRY_RUN` | 全局开启 dry-run，等价于所有 CLI 追加 `--dry-run` |
| `SHOTFUN_CONFIRM_COST_ABOVE` | 成本超过该 credits 阈值时强制确认 |
| `SHOTFUN_FETCH_REMOTE` | 工作流远程下载预留开关；单能力 `--wait` 任务默认会下载媒体产物 |
| `SHOTFUN_KEEP_RAW` | 保留 `raw/` 目录中的原始响应 |

## 输出目录解析顺序

1. `SHOTFUN_OUTPUT_DIR`
2. `SKILL.md` 同级目录下 `./shotfun-output/projects/<project-slug>/runs/<run-id>/`
3. 当前目录不可写时使用 `~/ShotFun/outputs/projects/<project-slug>/runs/<run-id>/`

未指定 `--project-name` / `SHOTFUN_PROJECT_NAME` 时 `<project-slug>` 为 `default`。仓库 `.gitignore` 已忽略 `shotfun-output/` 与 `ShotFun/outputs/`；自定义路径由用户自行维护忽略规则。

## 安全约束

- 不提交 `.env.local`、生成资产、响应中的 token 或私有 URL
- OpenAPI 请求体必须通过 JSON 或 `FormData` 结构化提交
- 不用用户输入拼接 shell 命令
- 高成本 workflow 必须先做成本估算，并在超过门槛时要求显式确认（详见 [`../SKILL.md`](../SKILL.md) 模型决策协议第 3 节）

## 通用 CLI 选项

| 选项 | 作用 |
| --- | --- |
| `--wait` | 阻塞轮询直到任务终态（SUCCESS / FAILED）。不传时只返回创建响应。 |
| `--dry-run` | 不调用 OpenAPI，只输出执行计划，用于含糊请求或高成本任务的预演。 |
| `--agent-output` | 单能力 CLI 返回稳定的 `userArtifacts` JSON，剥离原始 `task` 对象。Agent 调用时建议默认带上。 |
| `--input '{"k":"v"}'` | 合并到 `inputParams`，覆盖脚本默认字段，用于传递 registry 未列入的扩展参数。 |
| `--confirm` | 工作流入口使用：表示用户已同意真实执行；未传时部分工作流强制 dry-run。 |
| `--resume <run-id>` | 工作流断点续跑。 |

模型选择不在 CLI 层决定。AI 必须按 [`../SKILL.md`](../SKILL.md) 的「模型决策协议」选 `--model` / `--kind` / `--operation`，可用清单见 [`./model-catalog.md`](./model-catalog.md)。

## OpenAPI 路由

- 提交任务：`POST /open-api/v1/task/create`
- 查询任务：`GET /open-api/v1/task/query/{taskNo}`
- 文件上传：`POST /open-api/v1/file/upload`

## 单能力 CLI 标准输出

```json
{
  "ok": true,
  "taskNo": "task-123",
  "status": "SUCCESS",
  "resultUrls": ["https://..."],
  "assetRefs": ["Asset://asset-..."],
  "task": {},
  "category": "image"
}
```

- `resultUrls`：从 `resultUrl` / `resultData` 及嵌套字段递归提取的 HTTP URL。
- `assetRefs`：递归提取的 `Asset://...` 或 `asset-...` 引用。
- 加 `--agent-output` 后：剥离 `task`，只暴露稳定的 `userArtifacts`。

## 工作流标准输出

```json
{
  "ok": true,
  "runId": "20260514-031211-a1b2c3d4",
  "outputDir": "/abs/path/to/shotfun-output/...",
  "manifest": "/abs/path/to/manifest.json",
  "userArtifacts": [
    { "kind": "video", "name": "video", "url": "https://..." }
  ],
  "cost": { "estimated": 0, "currency": "CNY" }
}
```

stdout 只输出最终 JSON。进度、余额、成本摘要、人类可读错误和堆栈只写 stderr 或 `logs/run.jsonl`。

## 各 capability 调用入口

### 图片生成

```js
import { generateImage } from './scripts/services/text-to-image-service.js';

await generateImage({ projectCode, prompt, model, imageUrls, wait: true });
```

```bash
node scripts/cli/image-generate.js --project-code <project-name> --prompt "..." --wait --agent-output
```

带参考图时附 `--image-url <url>` 或 `--image-file <path>`。详见 [`model-catalog.md#图片生成`](./model-catalog.md#图片生成)。

### 视频生成（图生视频）

```js
import { generateVideo } from './scripts/services/image-to-video-service.js';

await generateVideo({ projectCode, prompt, imageUrls, model, wait: true });
```

```bash
node scripts/cli/video-generate.js --project-code <project-name> --prompt "..." --image-url <url> --wait --agent-output
```

`--asset-mode` 取值 `asset` / `direct-url` / `none`。详见 [`model-catalog.md#视频生成图生视频`](./model-catalog.md#视频生成图生视频)。

### 音频 / TTS

```js
import { generateAudio } from './scripts/services/audio-generation-service.js';

await generateAudio({ projectCode, kind: 'single', voiceName, text, wait: true });
```

```bash
node scripts/cli/audio-generate.js --project-code <project-name> --kind single --voice-platform <platform> --text "..." --wait
```

音色列表放在 `references/voice_<platform>.json`，格式见 [`voice-catalog-format.md`](./voice-catalog-format.md)。用户指定音色时传 `--voice-id`；未指定时会从该平台文件中自动推荐默认音色，并把表中的 `voiceId` 传给任务。

详见 [`model-catalog.md#音频--tts`](./model-catalog.md#音频--tts)。

### 视频处理

```js
import { processVideo } from './scripts/services/video-processing-service.js';

await processVideo({ projectCode, operation: 'upscale', videoUrl, wait: true });
```

```bash
node scripts/cli/video-process.js --project-code <project-name> --operation upscale --video-url <url> --wait --agent-output
```

详见 [`model-catalog.md#视频处理`](./model-catalog.md#视频处理)。

### 项目素材

```bash
node scripts/cli/project-assets.js --project-code <project-name> --action asset-group-create --name "Hero refs" --wait
node scripts/cli/project-assets.js --project-code <project-name> --action asset-create --group-id 123 --url <url> --name hero --asset-type Image --wait
node scripts/cli/project-assets.js --project-code <project-name> --action asset-create --group-id 123 --file ./voice.m4a --name voice --asset-type Audio --wait
```

详见 [`model-catalog.md#项目素材`](./model-catalog.md#项目素材)。

### 单镜头工作流

```bash
node scripts/cli/one-shot.js --project-code <project-name> --prompt "..." --confirm
node scripts/cli/run-workflow.js --workflow single-shot --project-code <project-name> --prompt "..." --image-url <url> --confirm
```

详见 [`model-catalog.md#单镜头工作流`](./model-catalog.md#单镜头工作流)。
