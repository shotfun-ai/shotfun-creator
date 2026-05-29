# XHS Images Gen Task Skill

## Goal

Generate a Xiaohongshu/RedNote-ready image card or a short image-card series from a topic, outline, article, product brief, or social post idea.

This task skill produces 1-10 vertical social image cards optimized for Chinese social feeds. It uses a dimensional selection pattern for type, style, palette, rendering, text level, and mood, with ShotFun image generation as the execution backend.

## Inputs

Required:

- `content`: source text, article summary, topic idea, product brief, or key points to turn into image cards.
- `projectCode`: ShotFun project name/code passed to `--project-code`.

Optional:

- `title`: main title or hook. If missing, derive one from `content`.
- `count`: number of cards. Default `3`; allowed range `1-10`.
- `seriesName`: project/series name used to keep cards visually unified. Default: derive from `title` or topic.
- `audience`: target reader, such as 新手妈妈, AI 从业者, 企业老板, 留学生, or fitness beginners.
- `style`: preset shorthand such as editorial, cute, luxury, tech, hand-drawn, clean, or bold.
- `layout`: cover, listicle, comparison, timeline, checklist, quote, data-card, step-by-step, story, or mixed.
- `palette`: warm, elegant, cool, vivid, pastel, mono, retro, duotone, macaron, or brand.
- `rendering`: flat-vector, hand-drawn, painterly, digital, collage, screenshot-like, or photo-editorial.
- `textLevel`: none, title-only, title-subtitle, bullet-rich, or text-rich. Default `bullet-rich`.
- `mood`: subtle, balanced, or bold. Default `balanced`.
- `aspectRatio`: default `3:4`, suitable for XHS image cards. Use `4:5` or `1:1` only when requested.
- `resolution`: default `2K`.
- `referenceImage`: optional image URL or local file for brand style, product appearance, character identity, or palette reference.
- `model`: preferred ShotFun image model. Default `gpt-image2`.

## Atomic Services

- `scripts/cli/image-generate.js`
- `scripts/services/text-to-image-service.js`

## Model Selection

- Default model: `gpt-image2`.
- Use `gpt-image2` for normal XHS cards because it has the best instruction following and supports reference images/editing.
- Use `z-image` only when the user explicitly asks for cheap drafts, fast rough exploration, or many low-cost variants without reference images.
- Use `seedream5` as a fallback when `gpt-image2` fails or is unavailable and reference image support is still needed.

Because `gpt-image2` is a high price-tier model in the ShotFun catalog, follow the root `SKILL.md` confirmation policy before real generation unless the user has already said to generate directly or use the default.

## Execution Pattern

1. Read `references/model-catalog.md#图片生成` before selecting the final `--model`.
2. Analyze `content` into a card plan:
   - one cover hook;
   - one key message per card;
   - concise visual direction per card;
   - no more than 3 short text blocks per card unless `textLevel` is `text-rich`.
3. Create a project-level **Style Bible** before writing card prompts:
   - `seriesName`: stable name for this image set;
   - `visualIdentity`: one sentence describing the overall look;
   - `palette`: 3-5 named colors and their roles, including background, text, accent, and optional warning/highlight color;
   - `typography`: font personality, title/body hierarchy, and whether Chinese text is high-density or sparse;
   - `layoutSystem`: shared margins, card header/footer pattern, grid rhythm, icon style, divider style, and recurring motif;
   - `illustrationLanguage`: shared rendering method, shape vocabulary, texture, lighting, and depth level;
   - `doNotChange`: visual rules that must remain consistent across all cards.
4. Choose dimensions:
   - `layout`: based on content structure;
   - `style`: based on audience and topic;
   - `palette`: based on brand/category or content emotion;
   - `rendering`: based on topic credibility needs;
   - `textLevel`: default `bullet-rich`;
   - `mood`: default `balanced`.
5. If `count >= 5`, if the request is a batch for publishing/client use, or if the user did not explicitly approve real generation, summarize the card plan and Style Bible before submitting tasks.
6. Generate the cover/first card first. Treat its local downloaded image as the **style anchor** for the rest of the series.
7. Generate remaining cards with the same Style Bible. When the model supports reference images, pass the first card's local image with `--image-file` in addition to any user-provided `referenceImage`; this anchors palette, spacing, rendering, and visual motif. Do not use the first card as a content reference that copies its text.
8. Use `--model gpt-image2 --aspect-ratio 3:4 --resolution 2K --wait --agent-output` by default.
9. Pass user-provided `referenceImage` with `--image-url` or `--image-file` on every card where brand/product/character consistency matters.
10. The CLI downloads completed image URLs into the local `shotfun-output/projects/<project>/runs/<run-id>/images/` directory. Return the local image paths first, then remote URLs as backups, plus task numbers, model, aspect ratio, and the card order.

## Batch Execution

For multi-card XHS/RedNote series, submit image tasks concurrently instead of blocking on each card one by one.

- Build all card prompts first so the series has a coherent visual system.
- Use bounded concurrency: `SHOTFUN_CONCURRENCY` if set, otherwise `3`; lower to `2` for `gpt-image2` or unstable network.
- Persist one sidecar per card with prompt, reference URLs, `taskNo`, model, aspect ratio, resolution, and intended card order.
- Poll all submitted task numbers until terminal status.
- If a card times out locally while remote status is still `RUNNING`, continue polling by `taskNo`; do not resubmit automatically.
- Preserve final card order when returning URLs and local paths.

## Prompt Pattern

For each card, write a concise prompt with this shape:

```text
Create one Xiaohongshu/RedNote vertical image card, aspect ratio 3:4, polished social media editorial design.
Series identity: <seriesName>. This card must match the same visual system as every other card in the series.
Style Bible: <visualIdentity>; palette <3-5 stable colors and roles>; typography <stable hierarchy>; layout system <shared margins/grid/header/footer/motif>; illustration language <stable rendering/texture/depth>; do not change <fixed rules>.
Topic: <topic>.
Card <n>/<count>: <card role>.
On-card copy: <short title>; <1-3 short supporting lines>.
Visual direction: <layout>, <style>, <palette>, <rendering>, <mood>.
Audience: <audience>.
Consistency constraints: keep the same color roles, typography hierarchy, border radius, icon style, illustration depth, whitespace rhythm, and recurring motif across the whole series. Vary only the card-specific composition and message.
Use clean Chinese typography if text is included. Keep text large and readable. No QR code, no fake app UI, no watermark, no brand logo unless provided as reference. Avoid tiny dense text, malformed Chinese characters, extra limbs, distorted faces, and clutter.
```

If exact Chinese text is mission-critical, prefer a low-text composition and report that final typography may need manual polish.

## Series Consistency

For `count > 1`, consistency is a hard requirement:

- Do not let each card independently choose a new palette, illustration style, font personality, background treatment, or icon language.
- Keep one recurring visual motif, such as a data-flow ribbon, notebook tab, rounded evidence card, gradient-free signal line, or modular block system.
- Keep card numbers, title placement, margin size, and footer/header treatment consistent.
- Use the first generated card as the visual anchor for later cards whenever possible.
- If a later card drifts in style, regenerate that card from the same Style Bible and first-card reference rather than changing the whole series.
- If user-provided brand/product references conflict with the generated first-card style, brand/product identity wins, but preserve the shared layout and palette as much as possible.

## Command Template

```bash
node scripts/cli/image-generate.js \
  --project-code <project-code> \
  --model gpt-image2 \
  --prompt "<card prompt>" \
  --aspect-ratio 3:4 \
  --resolution 2K \
  --wait \
  --agent-output
```

With a reference image:

```bash
node scripts/cli/image-generate.js \
  --project-code <project-code> \
  --model gpt-image2 \
  --prompt "<card prompt>" \
  --image-file "<local-reference-image>" \
  --aspect-ratio 3:4 \
  --resolution 2K \
  --wait \
  --agent-output
```

For cards 2+ in a series, include the downloaded first card as a style anchor:

```bash
node scripts/cli/image-generate.js \
  --project-code <project-code> \
  --model gpt-image2 \
  --prompt "<card prompt with the same Style Bible>" \
  --image-file "<local-card-1-path>" \
  --aspect-ratio 3:4 \
  --resolution 2K \
  --wait \
  --agent-output
```

## Output

Return:

- ordered card list with final local image path first and remote URL as backup;
- same-batch aggregation path for every card, so the whole series lives under one batch folder;
- ShotFun `taskNo` for each card when available;
- model, aspect ratio, resolution, count, and selected dimensions;
- output directory for each card or batch, plus a stable batch index file;
- any failed card index with the failure reason and suggested retry model.

### Batch Output Rule

For `count > 1`, the default output contract should group the whole series into one batch folder under `shotfun-output/`.

- Keep the original per-task `runs/<run-id>/images/` path for traceability.
- Also copy or link each final image into a single batch directory named after the project/run date, for example:

```text
shotfun-output/<batch-name>/images/card-01.png
shotfun-output/<batch-name>/images/card-02.png
...
shotfun-output/<batch-name>/index.json
```

- The batch `index.json` should record:
  - card order;
  - title / prompt summary;
  - `taskNo`;
  - `localPath` in the batch folder;
  - `originalPath` in the underlying run folder;
  - model, aspect ratio, and resolution.
- When returning results to the user, prefer the batch folder path first, then the original run path as provenance.
- Do not leave multi-card batches scattered only across individual run folders unless the user explicitly asks for raw run paths.

## Quality Checks

- Each card should be understandable on its own and coherent as a series.
- Cards in the same project should look like one designed set: same palette, typography hierarchy, layout rhythm, motif, and rendering language.
- The first card must have a strong XHS-style hook and visual hierarchy.
- Text should be large enough for mobile viewing and should not crowd the edges.
- Avoid relying on long paragraphs inside generated images.
- Avoid logos, QR codes, watermarks, fake notification UI, or platform impersonation unless explicitly requested.
- For product or brand images, preserve visible product identity when a reference image is provided.
- For people, avoid claiming identity-critical likeness unless the result has been inspected.

## Fallbacks

- If `SHOTFUN_API_KEY` is missing, stop and ask the user to configure it.
- If `projectCode` is missing, use the root skill default resolution order: explicit project code, `SHOTFUN_PROJECT_CODE`, then `default`.
- If `gpt-image2` fails, retry one failed card with `seedream5` for reference-based work or `z-image` for text-only cheap drafts.
- If the remote image succeeds but local download fails, do not regenerate; query/download the existing result URL and save it under `shotfun-output/xhs-images/` or the run `images/` directory.
- If generated Chinese text is malformed, regenerate with less on-card text or produce a cleaner no-text/low-text image and suggest adding final text in design software.
