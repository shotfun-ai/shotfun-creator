# Task Skills

Task skills are reusable ShotFun capabilities with clear inputs, outputs, and quality checks.

Use a task skill when the user asks for a relatively complete deliverable, but the request does not require a multi-step workflow. A task skill may call one or more atomic services, but it should still feel like one bounded capability to the user.

## Contract

Each task skill should define:

- Goal: what deliverable this skill produces.
- Inputs: required and optional inputs.
- Atomic services: which `scripts/services/*.js` or `scripts/cli/*.js` commands it may call.
- Output: final artifact paths, URLs, or manifest fields to report.
- Quality checks: validation before and after execution.
- Fallbacks: what to do when a model, credential, input, or task result is unavailable.

## Selection Rules

- Prefer task skills over raw atomic services when the task has a known deliverable shape.
- Keep task skills narrow. If it needs planning, branching, retries across multiple deliverables, or resume logic, promote it to `workflow-skills/`.
- Do not store credentials, private URLs, generated assets, or user-specific secrets in task skill files.
- When required inputs or output specs are unclear, ask the user to confirm the smallest set of missing details before running a real task.
- Prefer safe defaults plus `--dry-run` for ambiguous requests; do not submit high-cost or externally visible tasks on guesses.

## Initial Task Skills

- `wechat-cover-image.md`: generate a WeChat article cover from a title and article summary.
- `wechat-write-publish-allinone.md`: turn source content into a WeChat article package with title, cover, Markdown, and optional draft-box publishing.
- `xhs-images-gen.md`: generate Xiaohongshu/RedNote vertical image cards or short card series from content.
- `universal-content-to-image.md`: turn arbitrary content into a generated image such as product promo, training explainer, announcement, infographic card, or other content-driven visual.
- `reference-video-analysis.md`: analyze a reference video by extracting metadata, frames/contact sheets, pacing, layout, and reusable style guidance.
- `talking-head-scene-image.md`: generate a talking-head scene image from requirements, an anchor photo, and an optional scene photo.
- `scripted-talking-video.md`: generate talking-head videos from a presenter image and script; supports simple single-shot mode and multi-shot presenter/B-roll packages.
- `hyperframes-project.md`: create, inspect, and optionally render editable HyperFrames video projects.
- `workbench-web-skill.md`: build a simple Vite/Tailwind web workbench for a specified skill run and its artifacts.
