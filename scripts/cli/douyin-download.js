#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { createWriteStream, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const DEFAULT_CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) ' +
  'AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1';

function parseArgs(argv) {
  const args = {
    outputDir: 'shotfun-output/douyin-downloads',
    filename: '',
    chromePath: DEFAULT_CHROME,
    headful: false,
    preferNoWatermark: true,
    dryRun: false,
    agentOutput: false,
    pageTimeout: 60_000,
    settleMs: 8_000,
    requestTimeout: 30_000,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith('--') && !args.url) {
      args.url = item;
    } else if (item === '--output-dir') {
      args.outputDir = argv[++index];
    } else if (item === '--filename') {
      args.filename = argv[++index];
    } else if (item === '--chrome-path') {
      args.chromePath = argv[++index];
    } else if (item === '--headful') {
      args.headful = true;
    } else if (item === '--no-prefer-no-watermark') {
      args.preferNoWatermark = false;
    } else if (item === '--dry-run') {
      args.dryRun = true;
    } else if (item === '--agent-output') {
      args.agentOutput = true;
    } else if (item === '--page-timeout') {
      args.pageTimeout = Number(argv[++index]) * 1000;
    } else if (item === '--settle-seconds') {
      args.settleMs = Number(argv[++index]) * 1000;
    } else if (item === '--request-timeout') {
      args.requestTimeout = Number(argv[++index]) * 1000;
    } else if (item === '--help' || item === '-h') {
      args.help = true;
    } else {
      throw new Error(`Unknown argument: ${item}`);
    }
  }
  return args;
}

function printHelp() {
  console.log(`Usage:
  node scripts/cli/douyin-download.js "<douyin-url>" [options]

Options:
  --output-dir <dir>          Output directory. Default: shotfun-output/douyin-downloads
  --filename <name>           Optional MP4 filename
  --chrome-path <path>        Chrome executable path
  --headful                   Show Chrome window for debugging
  --no-prefer-no-watermark    Do not try playwm -> play URL replacement
  --dry-run                   Extract URL but do not download
  --agent-output              Print JSON result
  --page-timeout <seconds>    Chrome/CDP timeout. Default: 60
  --settle-seconds <seconds>  Wait after page target opens. Default: 8
  --request-timeout <seconds> HTTP download timeout. Default: 30`);
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${url}`);
  }
  return response.json();
}

function sanitizeFilename(value, fallback = 'douyin-video') {
  const clean = (value || fallback)
    .replace(/[\\/:*?"<>|\n\r\t]+/g, '_')
    .replace(/\s+/g, ' ')
    .replace(/^[ ._]+|[ ._]+$/g, '')
    .slice(0, 120);
  return clean || fallback;
}

function noWatermarkCandidate(url) {
  return url.includes('playwm') ? url.replace('playwm', 'play') : null;
}

function waitForWsOpen(socket) {
  return new Promise((resolveOpen, rejectOpen) => {
    socket.onopen = resolveOpen;
    socket.onerror = rejectOpen;
  });
}

class CdpClient {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.nextId = 1;
    this.pending = new Map();
  }

  async connect() {
    this.ws = new WebSocket(this.wsUrl);
    this.ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (!message.id || !this.pending.has(message.id)) return;
      const { resolveMessage, rejectMessage } = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) {
        rejectMessage(new Error(JSON.stringify(message.error)));
      } else {
        resolveMessage(message.result);
      }
    };
    await waitForWsOpen(this.ws);
  }

  send(method, params = {}) {
    const id = this.nextId;
    this.nextId += 1;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolveMessage, rejectMessage) => {
      this.pending.set(id, { resolveMessage, rejectMessage });
    });
  }

  close() {
    this.ws?.close();
  }
}

async function waitForPageTarget(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const targets = await fetchJson(`http://127.0.0.1:${port}/json`);
      const page = targets.find((target) => target.type === 'page' && target.webSocketDebuggerUrl);
      if (page) return page;
    } catch {
      // Chrome is still starting.
    }
    await sleep(500);
  }
  throw new Error('Chrome DevTools page target was not available before timeout.');
}

async function extractWithChrome(args) {
  const port = 9223 + Math.floor(Math.random() * 1000);
  const profile = join(tmpdir(), `shotfun-douyin-cdp-${Date.now()}`);
  mkdirSync(profile, { recursive: true });

  const chromeArgs = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--window-size=390,844',
    `--user-agent=${IPHONE_UA}`,
  ];
  if (!args.headful) chromeArgs.push('--headless=new');
  chromeArgs.push(args.url);

  const chrome = spawn(args.chromePath, chromeArgs, { stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  chrome.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });

  let cdp;
  try {
    const target = await waitForPageTarget(port, args.pageTimeout);
    cdp = new CdpClient(target.webSocketDebuggerUrl);
    await cdp.connect();
    await cdp.send('Runtime.enable');
    await sleep(args.settleMs);
    const expression = `(() => {
      const video = document.querySelector('video');
      return {
        title: document.title,
        href: location.href,
        videoUrl: video ? (video.currentSrc || video.src || '') : '',
        bodyText: document.body ? document.body.innerText.slice(0, 1000) : ''
      };
    })()`;
    const evaluated = await cdp.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    return evaluated.result.value;
  } finally {
    cdp?.close();
    chrome.kill('SIGTERM');
    await sleep(500);
    rmSync(profile, { recursive: true, force: true });
    if (!chrome.killed && stderr) {
      process.stderr.write(stderr);
    }
  }
}

async function probeUrl(url, headers, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let response = await fetch(url, { method: 'HEAD', headers, redirect: 'follow', signal: controller.signal });
    if (response.status === 405) {
      response = await fetch(url, { method: 'GET', headers, redirect: 'follow', signal: controller.signal });
      await response.body?.cancel();
    }
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function downloadFile(url, filePath, headers, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { headers, redirect: 'follow', signal: controller.signal });
    if (!response.ok) throw new Error(`Download failed: ${response.status} ${response.statusText}`);
    await pipeline(Readable.fromWeb(response.body), createWriteStream(filePath));
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.url) {
    printHelp();
    return args.help ? 0 : 1;
  }

  const outputDir = resolve(args.outputDir);
  mkdirSync(outputDir, { recursive: true });
  const manifestPath = join(outputDir, 'manifest.json');
  const result = {
    status: 'started',
    source_url: args.url,
    output_dir: outputDir,
    started_at: new Date().toISOString(),
  };

  try {
    const extracted = await extractWithChrome(args);
    if (!extracted.videoUrl) {
      throw new Error(`No video URL found in rendered page. Page text: ${extracted.bodyText || ''}`);
    }

    const headers = {
      'User-Agent': IPHONE_UA,
      Referer: 'https://www.douyin.com/',
    };
    let downloadUrl = extracted.videoUrl;
    let watermarkMode = 'original';
    const candidate = noWatermarkCandidate(downloadUrl);
    if (args.preferNoWatermark && candidate) {
      if (await probeUrl(candidate, headers, args.requestTimeout)) {
        downloadUrl = candidate;
        watermarkMode = 'play-no-watermark-candidate';
      } else {
        watermarkMode = 'original-playwm-fallback';
      }
    }

    let filename = sanitizeFilename(args.filename || extracted.title || basename(new URL(args.url).pathname));
    if (!filename.toLowerCase().endsWith('.mp4')) filename += '.mp4';
    const downloadedFile = join(outputDir, filename);

    if (!args.dryRun) {
      await downloadFile(downloadUrl, downloadedFile, headers, args.requestTimeout);
    }

    Object.assign(result, {
      status: args.dryRun ? 'dry-run' : 'success',
      title: extracted.title,
      resolved_page_url: extracted.href,
      original_video_url: extracted.videoUrl,
      download_url: downloadUrl,
      watermark_mode: watermarkMode,
      downloaded_file: args.dryRun ? null : downloadedFile,
      finished_at: new Date().toISOString(),
    });
  } catch (error) {
    Object.assign(result, {
      status: 'failed',
      error: error instanceof Error ? error.message : String(error),
      finished_at: new Date().toISOString(),
    });
  }

  writeFileSync(manifestPath, `${JSON.stringify(result, null, 2)}\n`);
  result.manifest = manifestPath;

  if (args.agentOutput) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`status: ${result.status}`);
    console.log(`manifest: ${manifestPath}`);
    if (result.downloaded_file) console.log(`downloaded_file: ${result.downloaded_file}`);
    if (result.error) console.error(`error: ${result.error}`);
  }

  return ['success', 'dry-run'].includes(result.status) ? 0 : 1;
}

main().then((code) => process.exit(code)).catch((error) => {
  console.error(error);
  process.exit(1);
});
