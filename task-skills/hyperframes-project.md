# HyperFrames Project Task Skill

## Goal

Create, inspect, and optionally render a HyperFrames video project from structured video content.

Use this task skill when the user asks to create a HyperFrames project, convert structured content into an editable video project, inspect an existing HyperFrames project, or render a prepared HyperFrames project. This is a bounded task-level capability; if the user also needs editorial planning, TTS, BGM, story visuals, or confirmation checkpoints, use `workflow-skills/news-broadcast-video.md`.

## Inputs

Required for project creation:

- `content`: structured story/narration input, a broadcast JSON file, or a clear brief that can be converted into JSON.

Required for inspect/render:

- `projectDir`: existing HyperFrames project directory containing `hyperframes.json` and project files.

Optional:

- `projectName`: local output grouping name.
- `width`: default `1080`.
- `height`: default `1920`.
- `fps`: default `30`.
- `render`: whether to render MP4 after project creation or inspection.
- `draft`: default `true` for faster render checks.
- `outputPath`: optional MP4 output path.

## Atomic Services And Commands

For a broadcast-style HyperFrames project, reuse the existing workflow runner in project-generation mode:

```bash
node scripts/cli/run-workflow.js \
  --workflow news-broadcast-video \
  --input-file <broadcast-json> \
  --project-name <project-name> \
  --approve-confirmation-plan \
  --approve-audience-and-style \
  --approve-story-plan \
  --approve-bgm-style \
  --approve-hyperframes-project
```

Render an approved HyperFrames project:

```bash
npx --yes hyperframes@0.6.30 render \
  --output <output.mp4> \
  <projectDir>
```

If the project was generated through `news-broadcast-video`, prefer the workflow render path because it records manifest steps and duration checks:

```bash
node scripts/cli/run-workflow.js \
  --workflow news-broadcast-video \
  --input-file <broadcast-json> \
  --project-name <project-name> \
  --approve-confirmation-plan \
  --approve-audience-and-style \
  --approve-story-plan \
  --approve-bgm-style \
  --approve-hyperframes-project \
  --render
```

## Execution Pattern

1. Decide task mode:
   - `create`: user provides content or broadcast JSON and wants a HyperFrames project.
   - `inspect`: user provides `projectDir` and wants structure checks.
   - `render`: user provides `projectDir` or explicitly asks for MP4 render.
2. If the input is only a natural-language brief, convert it into the broadcast JSON contract used by `workflow-skills/news-broadcast-video.md`.
3. For project creation, write the JSON input into a run folder and call `scripts/cli/run-workflow.js --workflow news-broadcast-video`.
4. Before paid ShotFun generation or final rendering, ask for confirmation unless the user explicitly approved the current project.
5. For render, use `npx --yes hyperframes@0.6.30 render` only after the project has `hyperframes.json` and the user approved rendering.
6. Return clickable paths for:
   - project directory;
   - `hyperframes.json`;
   - `index.html`;
   - `DESIGN.md`;
   - `storyboard.json`;
   - rendered MP4 when available;
   - manifest path when the workflow runner was used.

## Quality Checks

- Confirm `projectDir` exists before inspect/render.
- Confirm `hyperframes.json` exists before rendering.
- If narration audio exists, compare narration duration and final MP4 duration when possible; never deliver a rendered MP4 that cuts narration short.
- Keep HyperFrames as the editable project surface. Do not replace the project with only a static video file.
- Use `--dry-run` or stop at project generation when the user has not approved expensive generation or rendering.

## Output

Default output contract:

- `status`: `project-created`, `inspected`, `rendered`, or `needs-confirmation`.
- `projectDir`: HyperFrames project directory.
- `projectFiles`: key editable project files.
- `renderedVideo`: MP4 path when rendered.
- `manifest`: workflow manifest path when available.
- `warnings`: layout, duration, missing asset, or render warnings.

## Relationship To News Broadcast Workflow

This task skill is the reusable HyperFrames layer. `workflow-skills/news-broadcast-video.md` remains the full editorial workflow for news-style videos with confirmation checkpoints, visual grammar, TTS, BGM, story plates, and final delivery trace.
