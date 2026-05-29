---
capability: style
service: scripts/services/text-to-image-service.js
cli: scripts/cli/run-workflow.js
avoid_when:
  - 用户明确提供了完整 prompt 且要求不要改写
---

# Style Guide

## Prompt 原则

- 先写主体，再写场景、构图、镜头、光线、材质和风格。
- 保持角色关键特征稳定：年龄、发型、服装、配色、体型、道具。
- 单镜头 prompt 只描述一个可执行动作，避免多事件混杂。
- 工作流产出的角色卡、分镜和资产清单必须落盘到 `texts/`。

## 负面词

图片和视频能力支持负面词时，优先限制真实失败模式：

- extra limbs
- distorted hands
- duplicate face
- unreadable text
- low quality
- watermark

## 镜头语法

推荐结构：

```text
Subject, action, environment, camera movement, lighting, style, quality constraints.
```

示例：

```text
A young inventor holding a brass compass, walking through a rainy neon alley, slow dolly-in, soft rim light, cinematic realism.
```

## 一致性策略

多镜头或多资产任务中，先生成角色卡和风格锚点，再让后续步骤引用同一份本地文本文件或同一组参考图。不要在每步重新自由发挥角色设定。
