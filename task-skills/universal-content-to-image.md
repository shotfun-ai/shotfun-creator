# Universal Content To Image Task Skill

## Goal

Turn arbitrary content into one polished generated image, such as a product promotion image, training explainer image, event announcement, feature poster, service introduction, infographic-style card, internal communication graphic, or any other content-driven visual.

Use this task skill when the user gives arbitrary content and asks for a generated image, poster, promo image, training explanation image, information card, or presentation-style graphic.

This task skill produces one image by first designing a visual brief and image-generation prompt, then calling ShotFun image generation.

## Inputs

Required:

- `content`: any source content, such as product copy, training notes, campaign details, service description, outline, article excerpt, or bullet points.
- `projectCode`: ShotFun project name/code passed to `--project-code`.

Optional:

- `purpose`: product promotion, training explainer, announcement, product feature, onboarding, sales one-pager, internal notice, event poster, infographic, or custom.
- `audience`: target viewer, such as customers, employees, trainees, founders, students, parents, developers, or enterprise buyers.
- `title`: main headline. If missing, derive one from `content`.
- `subtitle`: optional supporting line.
- `mustInclude`: key copy, product name, date, price, CTA, disclaimer, or brand phrase that should appear.
- `style`: tech, corporate, luxury, playful, education, minimalist, bold, editorial, warm, cinematic, or brand-specific.
- `layout`: poster, hero-card, comparison, checklist, timeline, process, feature-grid, before-after, quote, announcement, or infographic.
- `aspectRatio`: default `4:3`; use `16:9` for slides/training screens, `3:4` or `4:5` for social cards, `1:1` for square posts.
- `resolution`: default `2K`.
- `referenceImage`: optional local file or URL for product, brand, character, logo, or visual style reference.
- `model`: default `gpt-image2`.

## Atomic Services

- `scripts/cli/image-generate.js`
- `scripts/services/text-to-image-service.js`

## Model Policy

Default to ShotFun `gpt-image2`:

```bash
node scripts/cli/image-generate.js \
  --project-code <project-code> \
  --model gpt-image2 \
  --prompt "<display image prompt>" \
  --aspect-ratio <aspect-ratio> \
  --resolution 2K \
  --wait \
  --agent-output
```

Use `gpt-image2` because this task often requires following dense instructions, composition, reference images, and limited readable text. It is a high price-tier model, so follow the root confirmation policy before real generation unless the user explicitly asks to generate directly or use the default.

## Execution Pattern

1. Read `references/model-catalog.md#图片生成` before generation.
2. Convert `content` into a concise visual brief:
   - goal/purpose;
   - target audience;
   - main headline;
   - 1-3 supporting points;
   - desired CTA or takeaway;
   - visual metaphor or product scene;
   - aspect ratio and layout.
3. If purpose, audience, or aspect ratio is unclear and affects the output, ask a short confirmation question. If the user says to use your judgment, pick sensible defaults.
4. Decide whether generated text should appear in the image:
   - Use exact on-image text only for short headline/CTA.
   - Avoid long paragraphs or dense small text inside generated images.
   - For text-heavy training material, design a low-text visual and return the final copy separately for manual overlay if needed.
5. Write a `gpt-image2` prompt from the visual brief.
6. Run `--dry-run` when the request is ambiguous or expensive.
7. Run `--wait --agent-output` when the user wants the image now.
8. Return local image path first, then remote URL, task number, model, aspect ratio, and brief summary.

## Output

Default output contract:

- group all images from the same request into one batch folder;
- if the request only yields one image, still place it in the batch folder as `card-01.png`;
- write a batch `index.json` with `taskNo`, `model`, `aspectRatio`, `resolution`, `prompt summary`, `localPath`, and original run path;
- preserve the original run folder path in the index for traceability;
- prefer the batch folder path first in the user-facing response.

Example:

```text
shotfun-output/<batch-name>/images/card-01.png
shotfun-output/<batch-name>/index.json
```

## Batch Execution

When generating multiple images from related content, such as a deck image set, do not wait for one image to finish before submitting the next image.

Recommended pattern:

1. Build one visual brief and one prompt per image.
2. Upload local reference images first when references are used, then pass remote URLs to generation tasks.
3. Submit image tasks concurrently with a bounded concurrency limit:
   - default to `SHOTFUN_CONCURRENCY`;
   - if unset, use `3`;
   - use `2` for high-cost models or unstable network conditions.
4. Persist a sidecar per image with prompt, reference URLs, `taskNo`, model, aspect ratio, and resolution.
5. Poll all task numbers until terminal status.
6. If a task times out locally but remote status is still `RUNNING`, continue polling by `taskNo`; do not resubmit automatically.
7. Download or list all successful image URLs only after task collection is complete.

Use serial execution only when the next prompt depends on reviewing the previous generated image.

## Visual Brief Template

```json
{
  "purpose": "product promotion | training explainer | announcement | infographic | ...",
  "audience": "",
  "headline": "",
  "supportingPoints": [],
  "cta": "",
  "layout": "",
  "style": "",
  "palette": "",
  "visualMetaphor": "",
  "referenceInputs": [],
  "aspectRatio": "4:3",
  "resolution": "2K"
}
```

## Prompt Pattern

```text
Create one polished display image for <purpose>, aspect ratio <aspectRatio>.
Audience: <audience>.
Main message: <headline>.
Supporting ideas: <1-3 concise points>.
Call to action or takeaway: <cta>.
Visual direction: <layout>, <style>, <palette>, <visual metaphor or scene>.
Composition: strong hierarchy, clear focal point, generous whitespace, readable mobile/slide-friendly design, professional visual balance.
If text is included, use only this short copy: <headline/CTA>. Keep text large, clean, and readable.
Reference handling: preserve product/brand/character appearance from provided reference images if any.
Avoid: clutter, tiny dense text, fake QR codes, fake logos, watermark, unreadable UI, distorted hands/faces, random extra text, misleading claims.
```

## Purpose Guidance

- Product promotion: emphasize product benefit, offer, hero visual, CTA, and trust cue.
- Training explainer: emphasize clarity, process, steps, icons/diagram, low text density, and learner-friendly layout.
- Event announcement: emphasize date/time/place, headline, atmosphere, and CTA.
- Feature poster: emphasize before/after, key capability, use case, and product context.
- Internal notice: emphasize clarity, hierarchy, deadline/action, and professional tone.
- Infographic card: emphasize one key insight, simplified chart/diagram metaphor, and readable labels.

## Command Templates

Basic:

```bash
node scripts/cli/image-generate.js \
  --project-code <project-code> \
  --model gpt-image2 \
  --prompt "<prompt>" \
  --aspect-ratio 4:3 \
  --resolution 2K \
  --wait \
  --agent-output
```

With reference image:

```bash
node scripts/cli/image-generate.js \
  --project-code <project-code> \
  --model gpt-image2 \
  --prompt "<prompt>" \
  --image-file "<reference-image>" \
  --aspect-ratio 4:3 \
  --resolution 2K \
  --wait \
  --agent-output
```

## Quality Checks

- The image should communicate the main message within 3 seconds.
- The visual hierarchy should make headline, core benefit, and CTA obvious.
- If text is included, it must be short and large enough to read.
- The image should match the requested purpose and audience, not just be decorative.
- Avoid unsupported factual claims, fake UI, fake logos, QR codes, and watermarks.
- If exact typography is mission-critical, report that generated text may need manual design polish.

## Fallbacks

- If `SHOTFUN_API_KEY` is missing, stop and ask the user to configure it.
- If `projectCode` is missing, use root skill fallback order: explicit project code, `SHOTFUN_PROJECT_CODE`, then `default`.
- If `gpt-image2` fails, stop and report the failure unless the user approves fallback to `seedream5` or `z-image`.
- If generated text is malformed, regenerate with less on-image text or produce a clean no-text version plus suggested overlay copy.
