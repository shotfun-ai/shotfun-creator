# WeChat Write Publish All-In-One Task Skill

## Goal

Turn a user's idea, note, outline, draft, or source material into a WeChat Official Account article package: topic hook, title options, article Markdown, cover image, and optionally a draft-box publish action.

Use this task skill when the user asks to:

- write, expand, or polish a WeChat/公众号 article;
- turn rough ideas into a publish-ready article;
- generate article titles, cover image, and Markdown;
- publish or push the article to a WeChat draft box.

This task skill is a bounded deliverable. It can be called by larger workflows such as personal IP content production.

## Inputs

Required:

- `sourceContent`: user idea, raw notes, draft, outline, transcript, link summary, or source files.

Optional:

- `targetReader`: intended reader group.
- `tone`: writing tone, such as analytical, practical, sharp, tutorial, or founder-style.
- `articleType`: tutorial, news interpretation, deep opinion, product explanation, or custom.
- `publish`: whether to publish to WeChat draft box. Default: publish only when credentials, proxy, and cover are ready.
- `cover`: user-provided cover path or URL. If absent, generate a cover.
- `projectCode`: ShotFun project name/code for cover generation when available.
- `forbiddenPoints`: claims, examples, or wording to avoid.

## Related Capabilities

- `task-skills/wechat-cover-image.md`: generate a WeChat article cover from title and summary.
- External local tools, when installed/configured:
  - `wechat-cover-gen` for ShotFun-based cover generation.
  - `wenyan-cli` for WeChat draft publishing.

Do not store WeChat credentials, ShotFun keys, proxy secrets, private article drafts, or generated covers inside this task skill file.

## Execution Pattern

1. Understand the source material and user constraints.
2. If multiple independent topics are present, confirm whether to split into multiple articles or merge into one.
3. Find local writing-style guidance if available, such as nearby `CLAUDE.md`; otherwise use the default style below.
4. Extract the strongest topic hook, core contradiction, and reader relevance before drafting.
5. Generate 8-12 candidate titles, then select the best title for the article.
6. Draft a WeChat-ready Markdown article, usually 1000-1500 Chinese characters unless the user asks otherwise.
7. Generate or attach a cover image. If no valid cover is available, do not publish.
8. If publishing is requested and all checks pass, publish to the WeChat draft box.
9. Return selected title, backup titles, cover result, Markdown path/content, and publish result.

## Writing Rules

Default style:

- Open with the hardest fact, biggest number, strongest contrast, or most concrete conflict.
- Do not start with broad filler such as "AI 行业很热闹" or "过去几年大家都在谈 AI".
- News/opinion structure: strong hook -> facts -> surface explanation -> deeper shift -> reader/industry impact -> memorable close.
- Tutorial structure: outcome preview -> problem -> steps -> caveats -> summary.
- Keep paragraphs readable for WeChat, usually 3-5 short lines.
- Write like a human columnist with judgment and specificity; avoid generic AI tone.

Hard hook rules from session `019e2001-0c61-7970-b544-1203c7547c0a`:

- If the source has strong numbers, outcomes, decisions, lawsuits, prices, dates, or clear contrast, put them in the first screen.
- The first 100 Chinese characters should contain at least one concrete fact: amount, revenue, headcount, price, verdict, time, product name, result, or strong judgment.
- Do not list company names and generic actions before the key number or result.
- Background should come after the hook and only serve the main argument.
- Weak opening: `AI 行业最热闹的地方，经常在模型发布会。`
- Strong opening: `NVIDIA 最新财报：季度收入 816 亿美元，数据中心收入 752 亿美元。模型公司还在争用户、订阅和 IPO，NVIDIA 已经把 AI factories 变成现金流机器。`

AI-tone blacklist:

- Avoid: `先说人话版`, `翻译成人话`, `一句话总结`, `换句话说`, `简单来说`, `本质上来说`, `值得注意的是`, `不可否认的是`, `从某种意义上说`.
- Avoid mechanical `第一、第二、第三` unless the article is clearly a tutorial or checklist.
- Avoid lazy transitions such as `这件事很重要，因为...`; directly explain the mechanism.
- Avoid vague endings such as `未来值得持续关注` unless followed by a concrete change path.

Title rules:

- Titles must answer why the reader should click, not just what happened.
- Cover at least four title patterns when brainstorming:
  - contrast: `看起来是 A，其实是 B`
  - power shift: `谁正在拿走谁的入口/规则/生意`
  - risk: `真正危险的不是 A，而是 B`
  - trend: `AI 的下一场战争，开始转向 X`
  - question: `为什么 X 这件小事，可能改变 Y`
  - judgment: `X 赢了，但 Y 的问题才刚开始`
  - reader benefit: `如果你是开发者/创业者/内容创作者，这件事必须看懂`

## Cover Rules

- Prefer generating a new cover from the selected title and article summary.
- Cover generation must call ShotFun image generation through `task-skills/wechat-cover-image.md`.
- Default cover model is `gpt-image2`; do not silently switch to `nano2`, `seedream5`, `z-image`, a default cover, or an existing local placeholder.
- Default visual direction: tech/editorial, simple composition, strong contrast, suitable for WeChat cover cropping.
- Use this command pattern unless the cover task-skill has a newer project-local command:

```bash
node scripts/cli/image-generate.js \
  --project-code <project-code> \
  --model gpt-image2 \
  --prompt "<cover prompt from selected title and article summary>" \
  --aspect-ratio 4:3 \
  --resolution 2K \
  --wait \
  --agent-output
```

- Do not silently fall back to a generic default cover unless the user explicitly asks for that cover.
- If ShotFun or cover generation fails, keep the article draft and report the failure; do not publish.

## Publish Preconditions

Publish only when all are true:

- A valid Markdown file exists.
- Frontmatter has both `title` and `cover`.
- Cover path/URL is readable or usable by the publisher.
- WeChat credentials are available from environment or the user's configured local credential source.
- The local publishing tool, usually `wenyan-cli`, is available.
- If the local environment requires a proxy, the proxy is reachable.

Recommended frontmatter:

```markdown
---
title: 文章标题
cover: /absolute/path/to/cover.jpg
---
```

Publishing target is the WeChat draft box, not direct mass sending.

## Failure Handling

- Missing source content: ask for the content or source file.
- Multiple topics without instruction: ask whether to split or merge.
- Missing cover or cover generation failure: output draft only, do not publish.
- Missing WeChat credentials or publisher: output draft and exact missing requirement.
- WeChat `40164 invalid ip not in whitelist`: report the returned IP and tell the user to update the WeChat Official Account IP whitelist.

## Output

Return:

- selected title;
- backup title options;
- article Markdown path or content;
- cover path/URL;
- publish status: draft-box success, skipped, or failed with reason.
