# Workbench Web Skill Task Skill

## Goal

Build a simple local web workbench for a user-specified ShotFun skill so the user can inspect the production process and generated results.

Use this task skill when the user asks to create a web version, workbench, dashboard, review console, preview page, or visual result browser for a specific `workflow-skills/*`, `task-skills/*`, or completed ShotFun run.

The deliverable is a lightweight static web app using HTML5, Tailwind CSS 4, Vite, and npm scripts. Do not introduce React, Vue, Svelte, Next.js, or another frontend application framework unless the user explicitly asks.

## Inputs

Required:

- `targetSkill`: skill file path or clear skill name, such as `workflow-skills/script-to-sd2-talking-video.md`.

Optional:

- `runManifest`: path to a workflow run `manifest.json`.
- `outputDir`: path to a ShotFun run directory or project directory.
- `projectLatest`: path to `latest.json` when the user wants the most recent run for a project.
- `workbenchDir`: output directory for the generated web app. Default: `workbenches/<target-skill-slug>/`.
- `title`: display title. Default: derive from target skill heading.
- `mode`: `run-viewer`, `project-viewer`, or `template`. Default `run-viewer` when a manifest/outputDir exists; otherwise `template`.
- `mediaTypes`: expected artifact types. Default: auto-detect image, text, video, audio, JSON, logs, and external URL artifacts.

## Data Source Policy

Prefer real run data in this order:

1. `runManifest` if provided.
2. `<outputDir>/manifest.json` if `outputDir` points at a run directory.
3. `<outputDir>/latest.json` if `outputDir` points at a project directory.
4. `shotfun-output/projects/<project-slug>/latest.json` when a project name is known.
5. A template data file with empty states when no run data exists.

Workflow skills must have a run-level `manifest.json`. If the requested target is a workflow skill and no manifest can be found, generate a template workbench that clearly shows an empty run state and points to the expected manifest location. Do not invent completed results.

Task skills may only expose `userArtifacts`, local output folders, or ad hoc files. For task-skill workbenches, use the best available output object and document missing manifest support as a limitation inside the generated workbench data file, not as visible instructional copy in the UI.

## Required Workbench Views

Create a usable first screen, not a marketing or landing page.

The workbench should include:

- Overview: run status, target skill, project/run id, created/finished times, cost when available, and quick artifact counts.
- Process timeline: ordered stages or steps from `manifest.steps`, `steps/*.json`, or inferred workflow stages from the target skill.
- Artifacts browser: image grid, video player list, audio player list, text/Markdown links, JSON/log links, and external URLs.
- Detail panel: selected step or artifact metadata including status, task number, model, prompt/summary, local path, and remote URL when safe.
- Logs/errors: compact list of failed, skipped, timed-out, or retryable steps.
- Empty states: clear placeholders when a view has no matching data.

Use artifact `localPath` before remote `url`. Treat signed/private remote URLs as backup links only. Never inline secrets, API keys, cookies, private tokens, or full raw API responses in the web app.

## Implementation Pattern

1. Read `targetSkill` and identify its goal, stages, expected inputs, and expected outputs.
2. Locate run data using the Data Source Policy.
3. Normalize data into a small static `src/data/workbench-data.js` or `public/workbench-data.json` file with:

```json
{
  "targetSkill": "",
  "title": "",
  "source": {
    "manifest": "",
    "outputDir": "",
    "projectLatest": ""
  },
  "run": {
    "ok": true,
    "status": "",
    "runId": "",
    "projectName": "",
    "projectSlug": "",
    "startedAt": "",
    "finishedAt": "",
    "cost": {}
  },
  "steps": [],
  "artifacts": [],
  "logs": [],
  "limitations": []
}
```

4. Scaffold a Vite app without a frontend framework:

```text
<workbenchDir>/
├── package.json
├── index.html
├── src/
│   ├── main.js
│   ├── styles.css
│   └── data/
│       └── workbench-data.js
└── public/
```

5. Use Tailwind CSS 4 through Vite. Keep scripts standard:

```json
{
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  },
  "devDependencies": {
    "@tailwindcss/vite": "latest",
    "tailwindcss": "latest",
    "vite": "latest"
  }
}
```

6. Render all UI from normalized data. Keep the app static and local-first.
7. Use responsive layouts for desktop and mobile. Favor dense operational UI over hero sections, decorative cards, or marketing copy.
8. Start the Vite dev server after implementation and report the local URL, unless the user only requested a template file.

## UI Rules

- First screen should show the actual workbench: overview, timeline, and artifact preview.
- Use tabs or segmented controls for artifact types.
- Use native media elements for previews: `<img>`, `<video controls>`, and `<audio controls>`.
- Keep cards for repeated artifacts or step rows only; do not nest cards.
- Avoid decorative gradients, bokeh/orbs, or oversized hero sections.
- Make local paths and safe URLs clickable.
- Do not show how-to text, keyboard shortcut descriptions, or implementation explanations inside the UI.
- Ensure long file paths, task numbers, and URLs wrap without overlapping neighboring content.

## Output

Return:

- generated workbench directory;
- Vite dev server URL when started;
- build command and preview command;
- data source used: manifest, latest, output directory, or template;
- any missing data limitations.

## Quality Checks

- The workbench can run with `npm run dev`.
- `npm run build` completes.
- The first screen is not blank and shows real run data or intentional empty states.
- Image, video, audio, text, JSON, and log artifact links render correctly when present.
- The target skill name and manifest/output directory are visible in the data model and final report.
- No secrets or private raw API payloads are copied into tracked files.

## Fallbacks

- Missing target skill: ask for the skill path or name.
- Missing manifest for workflow skill: create a template workbench with an empty run state and expected manifest path.
- Missing local media files but remote URLs exist: render remote links and record local download as a limitation.
- Missing Tailwind/Vite dependencies: create `package.json` and let npm install them when starting or building.
- Existing workbench directory: update it in place only if it is clearly for the same target skill; otherwise create a timestamped sibling directory.
