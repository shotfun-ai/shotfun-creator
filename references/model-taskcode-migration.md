# ShotFun Agent Model TaskCode Migration

本文件整理 2026-05-21 输入的 Agent 模型 taskCode 迁移表，供运营建任务、Agent registry 和模型选择规则对齐。

## 字段说明

| 字段 | 说明 |
| --- | --- |
| 一级分类 / 二级分类 | ShotFun 能力分类 |
| 模型名称 | Agent 对外展示或 CLI `--model` 候选名称 |
| 新 taskCode | Agent 应优先调用的新任务编码 |
| 从哪个 taskCode 复制 | 后台新建任务时参考复制的原任务编码 |
| tags | 后台标签或模型别名 |
| 价格（积分） | Agent catalog 中的 credits |
| 推荐值 | 0-10，越高越优先 |

## 图片生成

| 一级分类 | 二级分类 | 模型名称 | 新 taskCode | 从哪个 taskCode 复制 | tags | 适用场景 | 价格（积分） | 价格说明 | 特色说明 | 推荐值 | 其他说明 |
| --- | --- | --- | --- | --- | --- | --- | ---: | --- | --- | ---: | --- |
| 图片生成 | 文图生图 | gpt_image2 | `agent_ti2i_gpt_image2_cheap` | `gpt_image2_cheap_api` | gpt-image2 | 所有场景 | 50 | 0.2元/张 | 理解力最高的模型，默认2k分辨率 | 10 | — |
| 图片生成 | 文图生图 | nano2 | `agent_ti2i_nano2_cheap` | `shotfun_nanobanana_2` | 香蕉2, gemini3.1-image-flash-preview, nanobanana2 | 所有场景 | 75 | 0.3元/张 | 综合能力最好的模型，默认2k分辨率 | 9 | — |
| 图片生成 | 文图生图 | seedream5 | `agent_ti2i_seedream5` | `seedream5_image` | seedream5.0 | 所有场景 | 50 | 0.2元/张 | 速度较快，理解力一般，适合作为备选，默认2k分辨率 | 7 | — |
| 图片生成 | 文生图 | z-image | `agent_t2i_zimage` | `env_image_comfy_zimage` | z-image | 快速出图；价格敏感；审美好 | 13 | 0.05元/张 | 最快，日常场景够用，默认720p分辨率 | 9 | — |

## 视频生成

| 一级分类 | 二级分类 | 模型名称 | 新 taskCode | 从哪个 taskCode 复制 | tags | 适用场景 | 价格（积分） | 价格说明 | 特色说明 | 推荐值 | 其他说明 |
| --- | --- | --- | --- | --- | --- | --- | ---: | --- | --- | ---: | --- |
| 视频生成 | 参考生视频 | sd2.0-720p | `agent_r2v_sd2_720p` | `sd_reference_linkaihub_transcode` | seedance2.0, sota模型, 720p | 支持真人；支持音画同出；支持时长4-15s | 250 | 1元/s | 支持真人，当前最好的视频生成模型，理解力好，一致性强 | 10 | 调用前需要调用报白逻辑直接进行报白（支持真人）；对应资产组/资产 taskCode：`sd_asset_group_create_linkaihub` / `sd_asset_create_linkaihub` |
| 视频生成 | 参考生视频 | sd2.0-1080p | `agent_r2v_sd2_1080p` | `sd_reference_linkaihub_transcode` | seedance2.0, sota模型, 1080p | 支持真人；支持音画同出；支持时长4-15s | 1250 | 2.5元/s | 支持真人，当前最好的视频生成模型，理解力好，一致性强 | 9 | 需要在调用参数中增加/确认分辨率 |
| 视频生成 | 参考生视频 | sd2.0-fast-720p | `agent_r2v_sd2_fast_720p` | `sd_reference_fast_linkaihub_transcode` | seedance2.0-fast, 720p | 支持真人；支持音画同出；支持时长4-15s | 200 | 0.8元/s | 支持真人，当前最好的视频生成模型，理解力好，一致性强 | 10 | — |
| 视频生成 | 参考生视频 | sd2.0-fast-1080p | `agent_r2v_sd2_fast_1080p` | `sd_reference_fast_linkaihub_transcode` | seedance2.0-fast, 1080p | 支持真人；支持音画同出；支持时长4-15s | 1000 | 2元/s | 支持真人，当前最好的视频生成模型，理解力好，一致性强 | 9 | 需要在调用参数中增加/确认分辨率 |
| 视频生成 | 参考生视频 | happy-horse-720p | `agent_r2v_happy_horse_720p` | `ref2v_happy_horse_bailian` | happy_horse, 720p | 支持真人；支持音画同出；支持时长3-15s | 180 | 0.7元/s | 排第二的视频生成模型，便宜，画面精美 | 9 | — |
| 视频生成 | 参考生视频 | happy-horse-1080p | `agent_r2v_happy_horse_1080p` | `ref2v_happy_horse_bailian` | happy_horse, 1080p | 支持真人；支持音画同出；支持时长3-15s | 320 | 1.25元/s | 排第二的视频生成模型，便宜，画面精美 | 9 | 需要在调用参数中增加/确认分辨率 |

## Registry 同步

- 已同步到 `scripts/core/task-registry.js` 的 Agent 模型 key：`gpt-image2-cheap`, `nano2`, `seedream5`, `z-image`, `sd2.0-720p`, `sd2.0-1080p`, `sd2.0-fast-720p`, `sd2.0-fast-1080p`, `happy-horse-720p`, `happy-horse-1080p`。
- `references/model-catalog.md` 由 registry 自动生成，不直接手改。
- Seedance 2.0 LinkAIHub 资产组/资产 taskCode 已同步到 registry，并会在视频 `assetMode=asset` 时传给 `resolveReferenceAssets`。
