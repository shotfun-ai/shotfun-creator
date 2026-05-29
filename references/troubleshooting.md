---
capability: troubleshooting
service: scripts/core/api-client.js
cli: scripts/cli/run-workflow.js
avoid_when:
  - 错误来自用户取消或显式停止
---

# Troubleshooting

## 立即失败

以下情况应立即失败，并给出可操作错误：

- 缺少 `SHOTFUN_API_KEY`
- 缺少 prompt、文本、URL 或本地文件等必填输入
- 本地文件不存在
- 指定模型不支持参考图或当前参数组合

## 可恢复失败

任务超时、远程下载失败、单个并发步骤失败通常可恢复。workflow 必须保留 `manifest.json`、`logs/run.jsonl` 和对应 step sidecar，用户可用 `--resume <run-id>` 继续。

## 断点续跑

续跑时必须校验：

- 整体输入摘要一致
- registry 版本一致
- workflow 版本一致
- step 输入摘要一致

整体输入或 registry 不一致时默认拒绝，可通过强制续跑覆盖。workflow 版本不一致时必须重跑。

## stdout / stderr

stdout 只输出最终 JSON。进度、余额、成本摘要、人类可读错误和堆栈只写 stderr 或 `logs/run.jsonl`。

## 私有 URL

包含签名参数或 token 的 URL 只用于回放和下载。需要分享 manifest 时，应先生成脱敏副本。
