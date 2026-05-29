# Reference Video Analysis Task Skill

## Goal

Analyze a reference video so downstream image/video workflows can imitate its format, pacing, shot language, and visual structure without copying protected content, creator likeness, logos, watermarks, or exact wording.

Use this task skill when the user gives:

- a local video file;
- a remote video URL;
- a Douyin/TikTok/Bilibili/Xiaohongshu style reference link;
- screenshots plus a description;
- a video to "watch and understand" before generating a storyboard.

The output is an analysis package: metadata, extracted frames/contact sheets, scene observations, and a reusable style summary.
When audio is present, the package should also include an ASR transcript or an explicit ASR-skipped/failed note.

## Inputs

Required, one of:

- `videoFile`: local video path.
- `videoUrl`: direct downloadable URL.
- `referenceLink`: platform page URL such as Douyin/TikTok/Bilibili. Use only if it can be downloaded or visually inspected.
- `screenshots`: user-provided screenshots when video access is unavailable.

Optional:

- `analysisGoal`: storyboard reference, layout reference, pacing reference, shot-type extraction, subtitle style, brand wrapper, or content/B-roll pattern.
- `outputDir`: where to write extracted frames and analysis files. Default: `shotfun-output/reference-video-analysis/<run-id>/`.
- `sampleIntervalSeconds`: default 5-10 seconds for long videos.
- `sceneFrameCount`: default 12-24 representative frames.
- `contactSheetColumns`: default 4-6.
- `targetWorkflow`: e.g. `script-to-sd2-talking-video`.
- `asrMode`: `auto`, `local`, `cloud`, or `off`. Default `auto`.
- `asrProvider`: provider key for cloud ASR. Placeholder until a cloud ASR service is registered.
- `language`: optional language hint such as `zh`, `en`, or `auto`.
- `transcriptOnly`: if true, extract audio and transcribe without doing detailed visual analysis.

## Tools

Use local tools when available:

- `ffprobe`: duration, resolution, frame rate, audio/video stream metadata.
- `ffmpeg`: frame extraction, scene sampling, contact sheet generation, optional clipping.
- `yt-dlp` or equivalent downloader: only when permitted and needed for platform URLs.
- Local ASR, when available: `faster-whisper`, `whisper.cpp`, `whisper` CLI, or another configured local transcriber.
- Cloud ASR placeholder: a future project service/CLI should accept an audio file or URL and return transcript segments.

Do not use private cookies, credentials, or platform scraping workarounds unless the user explicitly provides permission and the workflow allows it.

## Dependency Setup

For platform URLs, ensure `yt-dlp` is available before attempting download:

```bash
bash scripts/ensure-yt-dlp.sh
```

The helper installs `yt-dlp` with `python3 -m pip install --user --upgrade yt-dlp` when it is missing. If the user-level Python bin directory is not on `PATH`, follow the script's printed PATH hint before retrying.

## Execution Pattern

1. Validate the input and decide access mode:
   - Local file: inspect directly.
   - Direct URL: download to a temp/run folder if allowed.
   - Platform URL: run `bash scripts/ensure-yt-dlp.sh`, then try `yt-dlp` or browser inspection; if blocked, ask for a downloaded video, screenshots, or transcript.
   - Screenshots only: analyze visible layout and state limitations.
2. Create an output directory.
3. Run `ffprobe` and save metadata:

```bash
ffprobe -v error \
  -show_entries format=duration,size,format_name \
  -show_streams \
  -of json <video> > metadata.json
```

4. Extract representative frames:
   - For format/layout analysis, sample every 5-10 seconds.
   - For scene rhythm, extract 12-24 frames across the full duration.
   - Keep filenames ordered, e.g. `frames/frame_0001.jpg`.
5. Generate contact sheets:

```bash
ffmpeg -y -i <video> \
  -vf "fps=1/<interval>,scale=240:-1,tile=<columns>x<rows>" \
  contact.jpg
```

6. If the video has audio and `asrMode` is not `off`, extract an ASR-ready audio file:

```bash
ffmpeg -y -i <video> \
  -vn -ac 1 -ar 16000 \
  audio.wav
```

7. Run ASR:
   - `auto`: use local ASR if available; otherwise record `asrStatus: skipped` with `reason: no local ASR and cloud ASR not configured`.
   - `local`: require a local ASR command; if unavailable, mark ASR failed/skipped and continue visual analysis.
   - `cloud`: call the future cloud ASR service placeholder; until implemented, mark ASR skipped with `reason: cloud ASR service not configured`.
   - `off`: skip ASR.
8. Inspect contact sheets, frames, and transcript when available.
9. Write `analysis.md` and optional `analysis.json`.
10. Return paths and the style summary.

## ASR Stage

The ASR stage should be optional but enabled by default in `auto` mode when audio exists.

Recommended local ASR command patterns:

```bash
# faster-whisper style placeholder; exact command depends on local installation.
faster-whisper audio.wav \
  --language <language-or-auto> \
  --output_format json \
  --output_dir .

# whisper.cpp style placeholder.
whisper-cli -f audio.wav \
  -l <language-or-auto> \
  -oj -osrt -otxt \
  -of transcript
```

Cloud ASR placeholder contract, to be implemented later:

```bash
node scripts/cli/asr-transcribe.js \
  --audio-file audio.wav \
  --provider <asr-provider> \
  --language <language-or-auto> \
  --output-json transcript.json \
  --output-srt transcript.srt \
  --output-text transcript.txt
```

Expected cloud/local ASR output:

- `audio.wav`: extracted mono 16 kHz audio.
- `transcript.json`: segment-level transcript with timestamps.
- `transcript.srt`: subtitle timeline.
- `transcript.txt`: plain text transcript.
- `speech_analysis.md`: optional summary of speech structure.

Stable `transcript.json` shape:

```json
{
  "language": "zh",
  "durationSeconds": 0,
  "asrProvider": "local-or-cloud-provider",
  "segments": [
    {
      "start": 0,
      "end": 4.2,
      "text": "识别出的语音内容",
      "confidence": 0.92
    }
  ],
  "fullText": "",
  "summary": "",
  "keyClaims": [],
  "cta": "",
  "contentStructure": []
}
```

ASR failure should not block visual analysis. Record the failure in `analysis.md` and `analysis.json`.

## Analysis Dimensions

Extract only what is useful for generation:

- basic metadata: duration, width, height, aspect ratio, FPS, audio presence;
- platform format: vertical/horizontal, full screen, card layout, split screen, wrapper;
- opening hook: first-frame promise, headline, question, visual contrast;
- pacing: approximate average shot length, scene change frequency, B-roll density;
- shot taxonomy: presenter, interview, B-roll, screen recording, data chart, product demo, diagram, CTA;
- framing: close-up, medium shot, over-the-shoulder, screen-card, avatar overlay;
- subtitles: placement, density, color emphasis, line length;
- graphic system: headline area, lower third, logo/CTA area, background motif;
- camera/motion: static, push-in, pan, handheld, zoom, animated overlays;
- ending: CTA, summary frame, account/search prompt;
- speech content, if ASR is available: opening hook, claims, examples, transitions, CTA, speaking rhythm;
- reusable constraints: what to mimic structurally and what not to copy.

## Output Files

Recommended structure:

```text
shotfun-output/reference-video-analysis/<run-id>/
├── source.mp4                 # optional downloaded/local copied source
├── metadata.json
├── audio.wav                  # optional, when audio exists
├── transcript.json            # optional, when ASR succeeds
├── transcript.srt             # optional, when ASR succeeds
├── transcript.txt             # optional, when ASR succeeds
├── speech_analysis.md         # optional, when ASR succeeds
├── contact.jpg
├── scene_contact.jpg
├── frames/
│   ├── frame_0001.jpg
│   └── ...
├── analysis.md
└── analysis.json
```

`analysis.md` should include:

- source and access method;
- metadata;
- ASR status and transcript paths, if available;
- contact sheet paths;
- observed format;
- speech/content structure, if available;
- shot/pacing notes;
- reusable style summary;
- downstream prompt/storyboard implications;
- limitations.

`analysis.json` should include stable fields:

```json
{
  "source": "<path-or-url>",
  "durationSeconds": 0,
  "resolution": "720x1280",
  "aspectRatio": "9:16",
  "frameArtifacts": {
    "contactSheet": "<path>",
    "sceneContactSheet": "<path>"
  },
  "asr": {
    "status": "success|skipped|failed",
    "mode": "auto|local|cloud|off",
    "provider": "",
    "audioPath": "<path>",
    "transcriptJson": "<path>",
    "transcriptSrt": "<path>",
    "transcriptText": "<path>",
    "reason": ""
  },
  "speechSummary": "",
  "speechStructure": [],
  "formatSummary": "",
  "shotTypes": [],
  "pacingNotes": "",
  "subtitleNotes": "",
  "storyboardImplications": []
}
```

## Example: Douyin AI Commentary Format

For a vertical AI commentary reference like `https://www.douyin.com/video/7641569586374069558`, the analysis output may include:

- Format: vertical `9:16`.
- Layout: fixed dark tech-style wrapper with top headline area, central rounded horizontal video-card area, and lower brand/CTA area.
- Top headline: persistent topic title, often white first line plus yellow emphasis line.
- Main content area: central 16:9-ish card that switches between presenter, interview, B-roll, AI diagrams, chip/server footage, and charts.
- Presenter usage: direct commentary inside the central card, sometimes small avatar overlay during B-roll.
- Subtitle style: short Chinese subtitles inside the card, white/yellow emphasis, not overcrowded.
- Speech/content structure: extract opening hook, topic transitions, repeated verbal patterns, and CTA if ASR succeeds.
- Rhythm: wrapper remains visually stable while the central card changes every few seconds.
- Storyboard implication: separate persistent wrapper design from generated `cardContent`; video generation should focus on central card clips, while wrapper/branding/subtitles can be added in editing.

## Safety And Copyright

- Use the reference for form, pacing, layout, and shot taxonomy only.
- Do not copy the exact creator likeness, account name, watermark, logo, title text, private content, or full transcript.
- Use ASR transcript for structural understanding and summary. Do not republish or reproduce a full copyrighted transcript unless the user owns it or has permission.
- Do not claim detailed observations if the video could not be inspected.
- If platform access is blocked, clearly state the limitation and ask for a downloaded file or screenshots.

## Quality Checks

- Metadata must include duration and resolution when a video file is available.
- At least one contact sheet or frame set should be produced for inspected videos.
- If audio exists, ASR should either produce transcript artifacts or record a clear skipped/failed reason.
- Analysis must distinguish observed facts from inferences.
- The final summary should combine visual style and speech structure when ASR succeeds, and remain directly usable by storyboard/video-generation workflows.
