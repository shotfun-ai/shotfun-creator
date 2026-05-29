---
name: douyin-video-download
description: Download Douyin videos from video, share, or user-modal links by using the local Chrome DevTools Protocol to inspect the rendered video source, optionally trying a no-watermark play URL, and saving the MP4 plus a manifest for downstream video analysis workflows.
---

# Douyin Video Download Task Skill

## Goal

Download a Douyin video to a local MP4 file for downstream reference-video analysis, template extraction, or workflow reproduction.

Use this task skill when the user provides a Douyin video/share/user modal URL and asks to download, fetch, save, or prepare the source video locally.

## Inputs

Required:

- `url`: Douyin video URL, short share URL, or user page URL with `modal_id`.

Optional:

- `outputDir`: default `shotfun-output/douyin-downloads/<run-id>/`.
- `filename`: optional output filename.
- `preferNoWatermark`: default `true`; tries replacing `playwm` with `play` when the rendered source supports it.
- `headful`: default `false`; use only for debugging login/captcha/rendering issues.

## Script

Use the bundled Chrome DevTools downloader. It does not require Python Playwright or Puppeteer; it launches the local Chrome executable directly.

```bash
node scripts/cli/douyin-download.js "<douyin-url>" \
  --output-dir "shotfun-output/douyin-downloads/<run-id>" \
  --agent-output
```

Dry run:

```bash
node scripts/cli/douyin-download.js "<douyin-url>" \
  --output-dir "shotfun-output/douyin-downloads/<run-id>" \
  --dry-run \
  --agent-output
```

Debug visible browser:

```bash
node scripts/cli/douyin-download.js "<douyin-url>" \
  --output-dir "shotfun-output/douyin-downloads/<run-id>" \
  --headful
```

## Execution Pattern

1. Create a run directory under `shotfun-output/douyin-downloads/`.
2. Run `node scripts/cli/douyin-download.js` with the user URL.
3. If the script succeeds, return:
   - clickable local MP4 path;
   - `manifest.json` path;
   - resolved page URL;
   - whether the selected URL was original or no-watermark candidate.
4. If download fails, inspect `manifest.json` and report the exact blocker.
5. If blocked by captcha/login/anti-bot, ask the user for one of:
   - a locally downloaded video file;
   - permission to run with `--headful` so they can complete browser checks;
   - screenshots/transcript if only template analysis is needed.

## Quality Checks

- Confirm the downloaded file exists and is larger than zero bytes.
- Save `manifest.json` even on failure so later debugging has the URL, status, and error.
- Do not store cookies, credentials, or private browser session exports in the repo.
- Do not claim no-watermark success unless `manifest.json` shows `watermark_mode` as `play-no-watermark-candidate`.
- Prefer local clickable paths in the final response.

## Output

Standard output fields:

- `status`: `success`, `dry-run`, or `failed`.
- `downloaded_file`: local MP4 path when downloaded.
- `manifest`: local JSON manifest path.
- `download_url`: rendered video URL used for download.
- `watermark_mode`: `original`, `original-playwm-fallback`, or `play-no-watermark-candidate`.
- `resolved_page_url`: page URL after redirects.

## Notes

This skill intentionally uses rendered-page inspection rather than `yt-dlp` as the primary path, because Douyin web extraction can fail with fresh-cookie or anti-bot errors. Use `yt-dlp` only as a fallback when it is known to work for the given URL.

The default Chrome path is `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`. If Chrome is installed elsewhere, pass `--chrome-path`.
