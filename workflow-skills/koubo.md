# Koubo Workflow Skill

## Goal

Produce a complete talking-head content package from a user's content goal, script, or topic.

Use this workflow when the user wants to:

- generate a talking-head video from a script or topic;
- create or reuse a presenter identity for repeated口播 runs;
- prepare a cover image together with the talking-head video;
- keep scripts, prompts, video clips, cover images, and manifests organized for later regeneration;
- turn a repeated口播 production pattern into the user's own reusable skill.

Default deliverables:

- confirmed口播形象图 / presenter image;
- spoken script or exact-script segmentation;
- talking-head video or ordered clip package;
- optional cover image;
- run manifest and reusable artifacts.

## Required Inputs

- `projectCode`: ShotFun project name/code passed to `--project-code`.
- One of:
  - `script`: final spoken script text or path to a script file;
  - `topic` / `title` / rough notes: only if the user wants the agent to draft the script first.

## Required Preparation Before Video Generation

Before submitting any real talking-head video task, complete these preparation steps:

1. **Presenter image first**: generate or confirm the口播形象图 before video generation.
2. **Use `gpt-image2` (also referred to as gpt-image-2) by default for the presenter image** because it has strong instruction following and supports reference/editing workflows.
3. Confirm the presenter image is suitable for video:
   - one clear person;
   - front-facing or slight three-quarter view;
   - stable head-and-shoulders or half-body composition;
   - clean hands and face;
   - no text, logos, watermarks, or extra people;
   - enough background space for the target format.
4. Prepare a voice reference if the user expects voice consistency:
   - local audio path, remote audio URL, or `Asset://...`;
   - if omitted, ask whether to proceed without voice reference or generate only a visual talking-head style clip.
5. Confirm output format before paid generation:
   - `16:9` for horizontal explainers, courses, Bilibili, WeChat article embeds;
   - `9:16` for Douyin, Xiaohongshu, Shorts, Reels;
   - recommend `720p` for first-pass generation;
   - use `1080p` only after explicit user confirmation.

Because `gpt-image2` (also referred to as gpt-image-2) is a high price-tier model, follow the root `SKILL.md` confirmation policy before real generation unless the user explicitly says to generate directly or use recommended defaults.

## Optional Inputs

- `anchorImage`: existing presenter image path/URL/`Asset://...`. If present and good enough, skip image generation after confirmation.
- `voiceSample`: voice sample path/URL/`Asset://...`.
- `coverTitle`: title text for cover image.
- `coverSubtitle`: optional subtitle. Default: no subtitle.
- `targetPlatform`: `douyin`, `xiaohongshu`, `wechat-video`, `bilibili`, `course`, or custom.
- `aspectRatio`: `9:16`, `16:9`, or custom.
- `resolution`: `720p` or `1080p`.
- `style`: presenter wardrobe, background, tone, camera framing, lighting, pacing, and brand identity.
- `finalAssembly`: whether to stitch generated clips into one final video when assembly is available.

## Recommended Task Skills

- `task-skills/universal-content-to-image.md`: generate the initial口播形象图 with `gpt-image2` (also referred to as gpt-image-2).
- `task-skills/talking-head-scene-image.md`: refine the presenter scene/image when an anchor photo or scene reference exists.
- `task-skills/scripted-talking-video.md`: plan and generate the talking-head video or clip package.
- `task-skills/wechat-cover-image.md` or `task-skills/universal-content-to-image.md`: generate a matching cover when requested.

## Workflow Stages

### 1. Intake

Confirm:

- the user's content goal;
- whether they already have a final spoken script;
- `projectCode`;
- target platform and aspect ratio;
- whether a voice reference is needed;
- whether a cover image is needed.

If the user only provides a topic or title, offer to draft the spoken script first. Do not submit video generation until the spoken text is ready or the user explicitly approves a draft.

### 2. Script Preparation

If the user provides exact spoken copy:

- treat it as the source of truth;
- do not summarize, rewrite, reorder, or add/remove claims;
- only split it into speakable segments for clip planning;
- save/return both original script and segment plan when possible.

If the user provides rough notes:

- write a spoken script first;
- keep the opening hook visible in the first few seconds;
- use short speakable lines;
- avoid article-like prose;
- ask for confirmation before using the script for paid video generation.

### 3. Presenter Image Generation

If no suitable presenter image exists, generate one before video work:

```bash
node {baseDir}/scripts/cli/image-generate.js \
  --project-code <project-name> \
  --prompt "<presenter image prompt>" \
  --model gpt-image2 \
  --aspect-ratio <9:16-or-16:9> \
  --resolution 2K \
  --wait \
  --agent-output
```

Prompt requirements:

- describe presenter identity, age range, wardrobe, expression, camera framing, lighting, background, and target platform;
- specify one person only;
- specify no text, no logo, no watermark;
- keep the face realistic and stable;
- prefer front-facing, video-friendly composition over dramatic motion or complex pose.

If the user provides a reference portrait, use it as an image reference/editing input with `gpt-image2` (also referred to as gpt-image-2) unless the user explicitly chooses another model.

### 4. Voice And Asset Preparation

If voice consistency is required:

- confirm the voice sample is available;
- convert unsupported local formats when necessary;
- create ShotFun project assets when the downstream model requires `Asset://...`;
- never store voice samples, private asset URLs, or signed URLs in tracked skill files.

### 5. Video Planning

Call `task-skills/scripted-talking-video.md`.

Pass:

- confirmed presenter image;
- final script or exact script segments;
- voice sample/reference when available;
- projectCode;
- target platform;
- aspect ratio and resolution;
- pacing notes.

Planning rules:

- short script: use single-shot mode only when the whole script safely fits the selected model's practical clip length;
- longer script: split into ordered clips and keep all segments traceable to the source script;
- include each exact script segment in the task prompt/input payload when exact-script mode applies;
- use `--dry-run` first for ambiguous, multi-shot, high-cost, or publishing-grade runs.

### 6. Video Generation

After user confirms the plan and cost-sensitive settings, generate with `--wait --agent-output`.

Operational rules:

- preserve presenter identity as much as the selected model supports;
- include script text in each relevant video task input;
- rerun only failed clips when a multi-shot run partially succeeds;
- keep per-shot task numbers and JSON outputs;
- if final assembly is unavailable, return an ordered clip package clearly.

### 7. Cover Generation

If the user wants a cover:

- use the final title or `coverTitle`;
- use the confirmed presenter image as visual reference when appropriate;
- default to one main title unless the user asks for subtitle/labels;
- use `gpt-image2` (also referred to as gpt-image-2) for cover generation by default when instruction following or reference editing matters;
- avoid extra badges, footer text, watermarks, or clutter unless requested.

### 8. Output Packaging

Store outputs under the project output directory, preferably grouped by project and run id:

```text
shotfun-output/projects/<project-slug>/runs/<run-id>/
  manifest.json
  script/
  presenter/
  video/
  cover/
```

Return:

- presenter image path/URL;
- final video path/URL or ordered clip package;
- cover image path/URL when generated;
- output directory;
- manifest path;
- model choices and key settings;
- any failed clips and retry instructions.

## Quality Checks

- Presenter image exists before video generation.
- Presenter image was generated or confirmed with a video-friendly composition.
- `gpt-image2` (also referred to as gpt-image-2) was used for the default presenter image path unless the user explicitly chose another model.
- The spoken script is ready before paid video generation.
- Exact user-provided script is preserved except for segmentation/whitespace.
- Each clip has a script segment and a clear visual prompt.
- Aspect ratio and resolution match the target platform.
- High-cost choices were confirmed.
- No credentials, private URLs, user-specific default paths, or generated assets are written into tracked skill files.

## Limitations

- Strict lip-sync or digital-human behavior is not guaranteed unless a dedicated supported model/service is selected.
- Final stitching depends on available assembly tools.
- Publishing to external platforms should be handled by a separate publishing workflow after review.

