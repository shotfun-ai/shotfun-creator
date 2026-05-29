# Scripted Talking Video Task Skill

## Goal

Generate a talking-head video from a presenter image, spoken script, and optional voice reference.

This is the unified task skill for both simple and scripted talking videos:

- `single-shot mode`: for short scripts or fast MVP runs, generate one talking-head style video from one portrait/reference image and one script.
- `multi-shot mode`: for longer scripts or richer storytelling, first design a shot manifest, then generate multiple clips with presenter-on-camera shots and relevant content/B-roll shots.

Use this task skill when the user provides a real-person photo/reference image and a talking script, and expects a talking video or clip package. It does not decide the topic, write the article, or manage a full content publishing pipeline.

Current video models generally generate short clips up to about 15 seconds. If the script exceeds the practical single-clip length, or the user asks for inserted visuals/B-roll, use `multi-shot mode`.

## Inputs

Required:

- `anchorImage`: local image path, remote image URL, or existing `Asset://...` reference for the presenter. Accept `portrait` as an alias.
- `script`: spoken script text or path to a script file.
- `projectCode`: ShotFun project name/code passed to `--project-code`.

Optional:

- `voiceoverAudio`: optional existing voice sample or narration audio URL/path. A short voice sample can be used as a voice reference.
- `sceneImage`: optional scene/background image for presenter shots.
- `contentImages`: optional reference images for B-roll/content shots.
- `targetPlatform`: `wechat-video`, `douyin`, `xiaohongshu`, `bilibili`, course, landing-page, or custom.
- `aspectRatio`: confirm before real generation. Use `9:16` for vertical short video and `16:9` for horizontal explainers.
- `resolution`: confirm before real generation. Recommend `720p` for the first full-flow run; use `1080p` only after user confirms higher cost/latency.
- `durationSeconds`: target duration. Default to estimating from script length when possible.
- `clipMaxSeconds`: default `15`.
- `mode`: `single-shot`, `multi-shot`, or `auto`. Default `auto`.
- `model`: selected video model. Must be confirmed by the user unless they explicitly say to use the recommended default.
- `style`: camera framing, background, wardrobe, lighting, tone, pace, visual identity, and speaking style.

## Atomic Services

- `scripts/cli/video-generate.js`
- `scripts/services/image-to-video-service.js`
- Optional: `scripts/cli/image-generate.js` for B-roll reference images when no content image exists.
- Optional future service: final video stitching/editing when available.
- Optional future service: dedicated strict lip-sync or digital-human generation when registered.

## Mode Selection

Use `single-shot mode` when all are true:

- the script can fit within one practical model clip, usually `clipMaxSeconds <= 15`;
- the user wants a quick talking-head result or a simple one-video MVP;
- no explicit request for content/B-roll inserts, multi-scene structure, or full-script coverage beyond one clip.

Use `multi-shot mode` when any are true:

- the script is longer than one practical clip;
- the user asks for inserted visuals, B-roll, examples, product/workflow shots, or richer pacing;
- the output is intended for publishing and needs reviewable shot planning;
- the user provides `contentImages` or asks to cover the whole script.

In `auto` mode, estimate script duration first, then choose the simplest mode that safely covers the script.

## Model Choice Guidance

Before real generation, present available model choices and ask the user to choose when the choice affects price, quality, or latency.

Available model guidance from the current registry:

- `sd-reference`: recommended for presenter identity/reference consistency and SD2/asset-mode talking-head work.
- `seedance`: lower-cost/default 720p image-to-video. Good for MVP tests, B-roll, and fast iteration.
- `seedance-1080p`: higher-resolution Seedance. Better quality, higher cost tier.
- `wan`: pro 720p video generation. Good when motion quality matters more than cheapest testing.
- `wan-1080p`: pro 1080p generation. Better quality, higher cost tier.
- `sora2`: high-end image-to-video with optional reference image. Use only when the user accepts higher cost/latency.

If the user does not choose a model:

1. Recommend `sd-reference` for presenter shots when identity consistency or voice reference matters.
2. Recommend `seedance` for low-cost B-roll/MVP shots.
3. Ask for confirmation before submitting real paid tasks, unless the user explicitly says to use recommended defaults.

## Script Duration And Shot Planning

Estimate spoken duration before generation:

- Chinese: roughly 240-300 Chinese characters per minute for steady narration.
- English: roughly 130-160 words per minute.
- If the user provides a target duration, use it as the primary constraint.

For `single-shot mode`:

- Keep the selected script segment within one model clip.
- Build one concise video prompt with identity preservation, speaking style, scene, and constraints.
- If the full script is too long, ask whether to shorten it or switch to `multi-shot mode`.

For `multi-shot mode`, split the script into clips:

- Each clip must be `clipMaxSeconds` or shorter, default 15 seconds.
- Use presenter-on-camera shots for thesis, transitions, key claims, and calls to action.
- Use content/B-roll shots for examples, abstract concepts, product/workflow visuals, data/process explanations, and visual variety.
- Alternate shots to avoid monotonous talking head. A common pattern is opening presenter shot, B-roll explanation, presenter interpretation, B-roll example, presenter conclusion.

## Shot Manifest

Before generating multi-shot video, produce a shot manifest for user confirmation.

Each shot should include:

- `shotId`
- `type`: `presenter` or `content`
- `scriptSegment`
- `estimatedSeconds`
- `referenceSource`: `anchorImage`, `sceneImage`, `contentImages`, generated still, or text-only prompt
- `videoPrompt`
- `modelRecommendation`
- `aspectRatio`
- `resolution`
- `needsUserConfirmation`

Example:

```json
{
  "shotId": "shot-01",
  "type": "presenter",
  "scriptSegment": "AI 下一场竞争，可能不是谁的模型更强。",
  "estimatedSeconds": 6,
  "referenceSource": "anchorImage",
  "videoPrompt": "Presenter faces camera in a futuristic studio, calm professional delivery...",
  "modelRecommendation": "sd-reference",
  "aspectRatio": "9:16",
  "resolution": "720p",
  "needsUserConfirmation": true
}
```

## Execution Pattern

1. Confirm `SHOTFUN_API_KEY`, `projectCode`, `anchorImage`, and `script`.
2. Confirm the presenter image exists or the remote URL/reference is usable.
3. Confirm output format before paid generation:
   - 横屏 `16:9` or 竖屏 `9:16`.
   - `720p` or `1080p`.
   - Suggested default for personal IP short videos: `9:16 + 720p`.
4. Read the script and estimate duration.
5. Select mode:
   - `single-shot mode` for short/simple talking-head generation.
   - `multi-shot mode` for long scripts or presenter + B-roll structure.
6. Show model options with price/effect guidance and ask the user to choose when needed:
   - one model for all shots; or
   - `sd-reference` for presenter shots plus cheaper/default model for B-roll.
7. Run `--dry-run` for ambiguous, representative, high-cost, or multi-shot requests.
8. After user confirms, generate with `--wait --agent-output`.
9. Return clickable local paths and remote URLs for final videos/clips, plus task numbers and manifest/output directory when available.

## SD2 Asset Submission Notes

When using `sd2.0-*` / `sd-reference` style models with presenter photo and voice reference, do not pass local files directly into video generation. First create SD2/LinkAIHub assets:

- Submit local/remote presenter image as an Image asset before video generation.
- Submit local/remote voice sample as an Audio asset before video generation.
- Use SD2/LinkAIHub task codes, not generic asset task codes:
  - group: `sd_asset_group_create_linkaihub`
  - asset: `sd_asset_create_linkaihub`
- Pass the Image asset with `--image-ref "Asset://..."`.
- Pass the Audio asset through `--input '{"audioUrls":["Asset://..."],"voiceReference":"Asset://..."}'`.
- If the user's voice sample is `.m4a` and asset creation fails because only `mp3`/`wav` is supported, transcode it first.
- A short voice sample can be a voice reference; it does not need to match the target video duration unless the user requests exact narration audio.

## User Confirmation Rules

Ask for confirmation when:

- the user has not selected horizontal/vertical format or resolution;
- the user has not selected a model and model choice affects cost/quality;
- the script requires multiple clips;
- the request uses 1080p, `sora2`, or other high-cost/high-latency choices;
- the generated output will be used for publishing;
- there is no clear split between presenter shots and content shots.

Do not ask again when:

- the user explicitly says to use recommended defaults;
- the run is only a `--dry-run`;
- the next step is regenerating a failed shot with the same confirmed settings.

## Quality Checks

- The presenter image should show one clear person unless the user explicitly wants otherwise.
- The script should fit the selected mode and requested duration.
- Every multi-shot script segment should map to one shot or be intentionally summarized.
- Presenter shots should preserve the anchor identity as much as the selected model supports.
- Content/B-roll shots should visually explain the nearby script content.
- Avoid clips longer than the model's practical limit.
- Avoid claiming strict lip sync unless a dedicated lip-sync/digital-human service exists.
- If the result is not a true lip-sync video, describe it as "talking-head style" rather than "strict mouth-sync digital human".
- Keep shot prompts short enough to be controllable, but specific about subject, camera, motion, background, and style.

## Output

For `single-shot mode`, return:

- final video clickable local path and remote URL;
- task number;
- model choice used;
- manifest/output directory if available.

For `multi-shot mode`, return:

- shot manifest path or inline summary;
- generated clip clickable local paths and remote URLs grouped by shot ID;
- task numbers;
- model choices used;
- unresolved shots and retry suggestions.

If final stitching is not available, clearly say the output is a clip package ready for editing, not a single final edited video.

## Fallbacks

- If no `contentImages` are provided in multi-shot mode, create B-roll prompts from script context.
- If reference identity is critical, use more presenter shots with `sd-reference`; otherwise use B-roll to reduce identity drift risk.
- If the script is too long for `single-shot mode`, offer to shorten the script or switch to `multi-shot mode`.
- If the script is too long for a full run, offer to generate only the first section as a pilot.
- If the user wants one single final video, explain that clip generation can proceed now and final assembly requires an editing step/service.
