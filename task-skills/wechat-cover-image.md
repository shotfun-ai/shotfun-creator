# WeChat Cover Image Task Skill

## Goal

Generate a WeChat article cover image from an article title, summary, and visual direction.

This task skill produces one cover image and should be used by writing/publishing workflows that already have a selected topic or final article.

## Inputs

Required:

- `title`: selected article title.
- `summary`: article summary or key thesis.
- `projectCode`: ShotFun project name/code passed to `--project-code`.

Optional:

- `style`: visual direction such as tech, editorial, minimalist, educational, or cinematic.
- `aspectRatio`: default `4:3`; use downstream crop/post-processing to produce WeChat's final cover ratio when needed.
- `resolution`: default `2K`.
- `referenceImage`: optional image URL or local file when the cover must follow an existing visual identity.
- `model`: fixed to `gpt-image2` unless the user explicitly asks to use another ShotFun image model.

## Atomic Services

- `scripts/cli/image-generate.js`
- `scripts/services/text-to-image-service.js`

## Model Policy

Use ShotFun image generation with `gpt-image2` by default:

```bash
node scripts/cli/image-generate.js \
  --project-code <project-code> \
  --model gpt-image2 \
  --prompt "<cover prompt>" \
  --aspect-ratio 4:3 \
  --resolution 2K \
  --wait \
  --agent-output
```

`gpt-image2` is selected for WeChat covers because it has the strongest instruction following and supports reference-image/editing workflows. It is a high price-tier model in the catalog, so follow the root confirmation policy before real generation unless the user already asked to generate directly or use the default.

## Execution Pattern

1. Convert the title and summary into a compact visual prompt.
2. Use ShotFun `gpt-image2` for generation.
3. Ask for clear rendered Chinese title text only when the publishing flow requires title text on the cover; otherwise prefer strong visual metaphor plus clean composition.
4. Run `--dry-run` for ambiguous style requests.
5. Run with `--wait --agent-output` when the user wants the cover generated now.
6. Return the image URL/path and task number.

## Output

Default output contract:

- write the final image into a single batch folder for the run;
- use a stable file name such as `card-01.png` even when the task only produces one image;
- write an `index.json` next to the image with `taskNo`, `model`, `aspectRatio`, `resolution`, `title`, `summary`, `localPath`, and original run path;
- keep the original run folder path in the index for traceability;
- when the publisher needs the image, return the batch path first, then the original run path as provenance.

Example:

```text
shotfun-output/<batch-name>/images/card-01.png
shotfun-output/<batch-name>/index.json
```

## Quality Checks

- The cover should communicate the article theme without relying on tiny text.
- Avoid logos, QR codes, signatures, author portraits, and fake UI unless requested.
- If the downstream publisher requires a specific crop, record the expected crop in the workflow output.
- If `gpt-image2` fails, stop and report the failure unless the user explicitly approves a fallback model.
