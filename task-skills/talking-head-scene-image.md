# Talking Head Scene Image Task Skill

## Goal

Generate a talking-head scene image for a presenter based on scene requirements, an anchor portrait, and an optional scene/background reference image.

Use this task skill when the user wants a still image such as "a man sitting at a desk in a study" or "a man standing on the lawn in front of a company building". The output image can be used directly as a cover, reference image, or the first step before talking-head/video generation.

## Inputs

Required:

- `requirements`: natural-language description of the target talking-head scene, including subject placement, setting, mood, clothing, camera framing, and any constraints.
- `projectCode`: ShotFun project name/code passed to `--project-code`.

Optional but recommended:

- `anchorPhoto`: local image path, remote image URL, or existing `Asset://...` reference for the presenter/host.
- `scenePhoto`: local image path, remote image URL, or existing `Asset://...` reference for the background/location.
- `aspectRatio`: output aspect ratio. Common values: `9:16` for short video, `16:9` for landscape video, `4:3` or `5:4` for article covers.
- `resolution`: output resolution. Default `2K`.
- `model`: preferred image model. Default `nano2`.
- `negativePrompt`: things to avoid, such as extra people, distorted face, text artifacts, logos, or cartoon style.
- `mode`: generation/editing mode if the backend model supports it.

## Atomic Services

- `scripts/cli/image-generate.js`
- `scripts/services/text-to-image-service.js`

## Recommended Model Selection

- Use `nano2` by default for presenter + scene composition.
- Use `nano-pro` when the user asks for higher quality or stronger composition and accepts higher cost/latency.
- Use `seedream5` when realism is the highest priority.
- Avoid `basic` when `anchorPhoto` or `scenePhoto` is provided, because it is text-to-image only.

## Execution Pattern

1. Confirm `SHOTFUN_API_KEY` and `projectCode`.
2. Validate `anchorPhoto` and `scenePhoto` if provided.
3. Convert `requirements` into a precise image prompt:
   - preserve the anchor's facial identity when `anchorPhoto` exists;
   - use the scene/background reference when `scenePhoto` exists;
   - specify camera framing, lighting, posture, expression, and background;
   - include output constraints such as no text, no logo, one person, realistic face and hands.
4. Choose aspect ratio and resolution from user requirements. If missing, use `9:16` for video-first workflows and `16:9` for general testing.
5. Run `--dry-run` first for ambiguous compositions or multiple references.
6. Run with `--wait --agent-output` when the user expects the final scene image in this turn.
7. Return only the final image URL/path, task number, and any useful output directory or manifest.

## Example Prompt Shape

```text
Create a realistic talking-head scene image. Preserve the presenter's facial identity from the anchor reference. The presenter is sitting at a walnut desk in a modern study, half-body framing, looking at camera, calm professional expression, warm daylight, shallow depth of field, premium business podcast style. One person only. No text, no logo, no extra hands, no distorted face.
```

## Output

Return:

- final image URL or local path;
- ShotFun `taskNo` when available;
- model, aspect ratio, and resolution used.

The output should be described as a "talking-head scene image" or "口播场景图".

## Quality Checks

- The presenter identity should remain close to `anchorPhoto` when provided.
- The scene should match the user's environment description or `scenePhoto`.
- The image should contain one clear presenter unless the user explicitly asks otherwise.
- Avoid text rendered inside the image unless explicitly required.
- Avoid claiming the image is suitable for strict identity-critical use if the face has visibly drifted.

## Fallbacks

- If no `anchorPhoto` is provided, generate a generic presenter matching the requirements.
- If no `scenePhoto` is provided, synthesize the scene from text requirements.
- If the model rejects reference images, switch to a reference-capable model such as `nano2`, `nano-pro`, or `seedream5`.
- If the result will feed into video generation, prefer a stable, front-facing, half-body composition over cinematic motion or complex poses.
