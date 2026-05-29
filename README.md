# shotfun-creator

shotfun-creator 面向所有 AI 内容生产场景，是覆盖图片、视频、声音、数字人等能力的 skill 集合。它负责理解用户目标、自主选择合适的可用技能，并完成内容生产。用户只需要输入内容目标，它会帮助拆解任务、规划流程、完成工作任务，并可把已实现的工作流程沉淀为用户自己的 skill。

项目分为四层：

- `SKILL.md`：主 skill，负责理解用户目标，并路由到合适的工作流、任务 skill 或原子服务。
- `workflow-skills/`（如存在）：复杂工作流。当前仓库暂未包含独立 workflow skill 文件，已实现工作流位于 `scripts/workflows/`。
- `task-skills/`：输入输出明确的任务能力，例如公众号封面、抖音视频下载、参考视频分析、口播视频、声音、数字人等内容生产任务。
- `scripts/services/`：稳定的 API 原子服务，例如生图、图生视频、TTS、视频处理、素材管理等。

优先使用能完整覆盖目标的最高层能力；只有没有合适 workflow/task skill 时，才下钻到 CLI 或 atomic service。

## 安装和使用

### 推荐安装方式

这是一个标准的 agent skill 项目。最简单的方式是复制 GitHub 地址，直接发给你的 agent 客户端，例如 CC、Codex、OpenClaw、Hermes 或其他支持 skill 的客户端：

```text
帮我把这个 GitHub 项目安装为 skill：https://github.com/shotfun-ai/shotfun-creator.git
```

agent 会帮你把项目 clone 到本地 skills 目录，并在需要时提示你重启或重新加载 skill。

### 手动安装

如果你想手动安装，可以执行：

```bash
mkdir -p ~/.codex/skills
git clone https://github.com/shotfun-ai/shotfun-creator.git ~/.codex/skills/shotfun-creator || \
  (cd ~/.codex/skills/shotfun-creator && git pull --ff-only)
```

安装完成后，重启 Codex，让 `shotfun-creator` skill 生效。

### 配置 ShotFun API Key

大部分生成任务需要 ShotFun API Key。在安装目录创建 `.env.local`：

```bash
cd ~/.codex/skills/shotfun-creator
printf "SHOTFUN_API_KEY=your_api_key_here\nSHOTFUN_PROJECT_CODE=default\n" > .env.local
```

请不要公开 `.env.local`。该文件已被 git 忽略。

### 验证安装

重启 Codex 后，可以直接问：

```text
使用 shotfun-creator 列一下当前可用 skill
```

也可以做一次 CLI 检查：

```bash
cd ~/.codex/skills/shotfun-creator/scripts
npm run doctor
```

### 更新项目

后续更新：

```bash
cd ~/.codex/skills/shotfun-creator
git pull --ff-only
```

更新后请再次重启 Codex，因为 `SKILL.md` 和子 skill 文件通常在启动时加载。

## 当前可用 Skill

### 主 Skill

- `shotfun-creator`：主入口。理解用户目标，并路由到合适的 workflow skill、task skill 或原子服务。

### Workflow Skills

当前仓库暂未包含独立 `workflow-skills/` 入口。工作流级能力目前位于 `scripts/workflows/`，通过 CLI 调用。

### Task Skills

- `wechat-write-publish-allinone`：生成公众号文章、封面图，并发布到公众号草稿箱。
- `wechat-cover-image`：生成微信公众号封面图。
- `xhs-images-gen`：生成小红书/RedNote 图片卡片。
- `universal-content-to-image`：把任意内容生成展示图片，例如产品促销图、培训说明图、信息图等。
- `douyin-video-download`：使用本地 Chrome DevTools 抓取抖音视频并保存 MP4 和 manifest。
- `reference-video-analysis`：分析参考视频，抽帧、识别节奏、总结视觉风格。
- `talking-head-scene-image`：根据要求、主播照片和可选场景图生成口播场景图。
- `scripted-talking-video`：统一的口播视频生成 skill，支持短脚本单镜头和多镜头口播/B-roll 视频包。
- `hyperframes-project`：创建、检查并可选渲染可编辑的 HyperFrames 视频项目。
- `workbench-web-skill`：为指定 skill run 和产物生成简单 Web 工作台。

## 许可证

本项目采用 [PolyForm Noncommercial License 1.0.0](./LICENSE)。

允许个人学习、研究、实验和非商业评估。商业使用需要获得 ShotFun 单独书面商业授权。

商业使用包括但不限于：用于商业产品、SaaS 或托管服务、客户交付、生产业务流程、付费内部服务、转售、再授权、白标或其他变现用途。

如需商业授权，请查看 [COMMERCIAL_LICENSE.md](./COMMERCIAL_LICENSE.md)。

---

# shotfun-creator English Guide

shotfun-creator is a skill collection for AI content production across images, video, audio, digital humans, and related formats. It understands the user's content goal, autonomously selects the right available skills, completes the production task, and can turn implemented workflows into the user's own reusable skills.

The repository is organized into four layers:

- `SKILL.md`: the main routing skill. It interprets the user's goal, chooses an available workflow skill, task skill, or atomic service, and reports final artifacts.
- `workflow-skills/` (if present): curated multi-step workflows for complex outcomes. This repository currently keeps implemented workflows under `scripts/workflows/`.
- `task-skills/`: reusable task-level skills with clear inputs and outputs, such as cover images, video download and analysis, talking-head videos, audio, digital humans, and other content production tasks.
- `scripts/services/`: atomic API-level services. Keep these stable and implementation-focused.

Use the highest layer that fully matches the user's intent. Drop down only when the higher layer does not exist or is too broad.

## Install And Use

### Quick Install

This repository is a standard agent skill package.

Recommended: copy the GitHub URL and send it directly to your agent client, such as CC, Codex, OpenClaw, Hermes, or another skill-capable agent:

```text
Install this GitHub project as a skill: https://github.com/shotfun-ai/shotfun-creator.git
```

The agent should clone it into its local skills directory and restart/reload skills if needed.

### Manual Install

If you prefer installing manually, run:

```bash
mkdir -p ~/.codex/skills
git clone https://github.com/shotfun-ai/shotfun-creator.git ~/.codex/skills/shotfun-creator || \
  (cd ~/.codex/skills/shotfun-creator && git pull --ff-only)
```

Then restart Codex so the `shotfun-creator` skill is loaded.

### Configure ShotFun API Key

Most generation tasks need a ShotFun API key. Create `~/.codex/skills/shotfun-creator/.env.local`:

```bash
cd ~/.codex/skills/shotfun-creator
printf "SHOTFUN_API_KEY=your_api_key_here\nSHOTFUN_PROJECT_CODE=default\n" > .env.local
```

Keep `.env.local` private. It is ignored by git.

### Verify

After restarting Codex, ask:

```text
List the currently available skills for shotfun-creator.
```

For a CLI smoke test:

```bash
cd ~/.codex/skills/shotfun-creator/scripts
npm run doctor
```

### Update

To update later:

```bash
cd ~/.codex/skills/shotfun-creator
git pull --ff-only
```

Restart Codex again after updating, because `SKILL.md` and nested skill files are loaded at startup.

## Available Skills

### Main Skill

- `shotfun-creator`: the main entry point. It understands the user's goal and routes to a workflow skill, task skill, or atomic service.

### Workflow Skills

No standalone `workflow-skills/` entries are included in this repository yet. Workflow-level behavior currently lives in `scripts/workflows/` and is invoked through the CLI where available.

### Task Skills

- `wechat-write-publish-allinone`: generate a WeChat article, cover image, and draft-box publishing package.
- `wechat-cover-image`: generate a WeChat article cover image.
- `xhs-images-gen`: generate Xiaohongshu/RedNote image cards.
- `universal-content-to-image`: turn arbitrary content into display images, product images, training explainer images, and similar visuals.
- `douyin-video-download`: download Douyin videos with local Chrome DevTools inspection and save MP4 plus manifest for later analysis.
- `reference-video-analysis`: analyze reference videos, extract frames, prepare ASR/transcript artifacts, and summarize reusable visual style.
- `talking-head-scene-image`: generate a talking-head scene image.
- `scripted-talking-video`: unified talking video generation skill supporting short single-shot talking-head videos and longer multi-shot presenter/B-roll packages.
- `hyperframes-project`: create, inspect, and optionally render editable HyperFrames video projects.
- `workbench-web-skill`: build a simple web workbench for a specified skill run and its artifacts.

See `CREDITS.md` for external design-methodology acknowledgements used by specific workflows.

## License

This project is source-available under the [PolyForm Noncommercial License 1.0.0](./LICENSE).

Personal learning, research, experimentation, and non-commercial evaluation are allowed. Commercial use requires a separate written commercial license from ShotFun.

Commercial use includes using this project or modified versions in commercial products, SaaS or hosted services, customer delivery, production business operations, paid internal services, resale, sublicensing, white-labeling, or other monetized scenarios.

For commercial permission, see [COMMERCIAL_LICENSE.md](./COMMERCIAL_LICENSE.md).
