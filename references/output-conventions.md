---
capability: output
service: scripts/core/output-paths.js
cli: scripts/cli/run-workflow.js
avoid_when:
  - 需要把私有 URL 分享给第三方
---

# Output Conventions

## 目录结构

每次运行生成独立 `run-id`。默认输出根目录是 `SKILL.md` 同级的 `shotfun-output/`，运行目录统一位于项目目录下：

```text
<base>/projects/<project-slug>/runs/<run-id>/
```

未传 `--project-name` 且没有 `SHOTFUN_PROJECT_NAME` 时，项目名和目录 slug 均为 `default`。传入 `--project-name` 或 `SHOTFUN_PROJECT_NAME` 时，使用指定项目名生成 `<project-slug>`。

项目级文件位于 `<base>/projects/<project-slug>/`：

- `project.json`
- `latest.json`
- `index.jsonl`

始终创建：

- `manifest.json`
- `inputs/`
- `steps/`
- `logs/run.jsonl`
- `texts/`

远程媒体产物下载后会创建：

- `images/`
- `videos/`
- `audio/`

仅保留原始响应时创建：

- `raw/`

## Manifest

`manifest.json` 记录运行状态、用户目标、能力清单、内部审计字段、成本摘要和 `userArtifacts`。面向用户的最终产物只以 `userArtifacts` 为准。

## Step Sidecar

每个步骤写入 `steps/<step-id>.json`，用于断点续跑和排查。sidecar 可以保留任务号、状态、远程 URL、资产引用、输入摘要和错误详情。

## Agent 产出物

stdout 最终 JSON 只暴露：

- `ok`
- `runId`
- `outputDir`
- `manifest`
- `projectName`
- `projectSlug`
- `userArtifacts`
- `cost`

图片、视频、音频必须优先返回本地路径；远程 URL 只能作为备份信息。文本和结构化结果必须写入 `texts/`，stdout 只返回文件路径。

## 远程产物

单能力 CLI 在 `--wait` 成功拿到图片、视频或音频 URL 后，会自动下载到当前 run 目录的 `images/`、`videos/` 或 `audio/` 子目录，并在 `userArtifacts[].localPath` 中返回本地路径。

如果下载失败，不要重复提交生成任务；应保留任务号和远程 URL，重新查询或重新下载已有产物。
