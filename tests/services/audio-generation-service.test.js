// 覆盖音频服务默认 TTS dry-run 请求构造、音色解析和错误校验。
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { generateAudio } from '../../scripts/services/audio-generation-service.js';

describe('audio generation service', () => {
  it('builds a default TTS dry-run request', async () => {
    const result = await generateAudio({
      projectCode: 'demo',
      voiceName: 'Narrator',
      text: 'Hello',
      dryRun: true,
    });

    assert.deepEqual(result.request, {
      projectCode: 'demo',
      taskCode: 'agent_tts_minimax',
      inputParams: {
        voiceName: 'Narrator',
        text: 'Hello',
        language: 'auto',
      },
    });
    assert.equal(result.category, 'audio');
  });

  it('submits caller voiceId through the backend voiceName field', async () => {
    const result = await generateAudio({
      projectCode: 'demo',
      voiceId: 'voice_123',
      text: 'Hello',
      dryRun: true,
    });

    assert.equal(result.request.inputParams.voiceName, 'voice_123');
    assert.equal(result.request.inputParams.voiceId, undefined);
  });

  it('rejects unregistered audio kinds', async () => {
    await assert.rejects(
      () => generateAudio({ projectCode: 'demo', kind: 'preview', voiceName: 'Narrator', dryRun: true }),
      /kind must be one of: single/,
    );
  });

  it('rejects unknown audio kinds', async () => {
    await assert.rejects(
      () => generateAudio({ projectCode: 'demo', kind: 'unknown', dryRun: true }),
      /kind must be one of/,
    );
  });

  it('requires a voice selector for single TTS unless listing voices', async () => {
    await assert.rejects(
      () => generateAudio({ projectCode: 'demo', text: 'Hello', dryRun: true }),
      /Missing voice selector/,
    );
  });

  it('resolves a user-specified voice from a platform reference file', async () => {
    const voiceReferenceDir = await makeVoiceReferenceDir();

    const result = await generateAudio({
      projectCode: 'demo',
      voicePlatform: 'demo',
      voiceName: 'Lina',
      text: 'Hello',
      dryRun: true,
      voiceReferenceDir,
    });

    assert.deepEqual(result.request.inputParams, {
      voiceName: 'demo_lina_001',
      voicePlatform: 'demo',
      text: 'Hello',
      language: 'en-US',
    });
    assert.deepEqual(result.voice, {
      platform: 'demo',
      provider: 'DemoVoice',
      id: 'demo_lina_001',
      name: 'Lina',
      language: 'en-US',
      description: 'Warm narration',
      recommended: false,
    });
  });

  it('recommends the default voice when the user does not specify one', async () => {
    const voiceReferenceDir = await makeVoiceReferenceDir();

    const result = await generateAudio({
      projectCode: 'demo',
      voicePlatform: 'demo',
      text: 'Hello',
      dryRun: true,
      voiceReferenceDir,
    });

    assert.equal(result.request.inputParams.voiceName, 'demo_ming_002');
    assert.equal(result.request.inputParams.voiceId, undefined);
    assert.equal(result.voice.recommended, true);
  });

  it('keeps legacy Markdown voice reference files readable', async () => {
    const voiceReferenceDir = await makeLegacyVoiceReferenceDir();

    const result = await generateAudio({
      projectCode: 'demo',
      voicePlatform: 'legacy',
      text: 'Hello',
      dryRun: true,
      voiceReferenceDir,
    });

    assert.equal(result.request.inputParams.voiceName, 'legacy_ming_002');
    assert.equal(result.request.inputParams.voiceId, undefined);
  });

  it('plans voice clone before cloned TTS in dry-run mode', async () => {
    const result = await generateAudio({
      projectCode: 'demo',
      kind: 'clone',
      voiceUrl: 'https://cdn.example.com/voice.mp3',
      text: 'Hello from cloned voice',
      dryRun: true,
    });

    assert.deepEqual(result.clonePlan.request, {
      projectCode: 'demo',
      taskCode: 'agent_tts_clone',
      inputParams: {
        audioUrl: 'https://cdn.example.com/voice.mp3',
      },
    });
    assert.deepEqual(result.ttsPlan.request, {
      projectCode: 'demo',
      taskCode: 'agent_tts_minimax',
      inputParams: {
        voiceName: '<voiceId from clone result>',
        text: 'Hello from cloned voice',
        language: 'auto',
      },
    });
  });

  it('clones voice first and submits TTS with the returned voiceId', async () => {
    const calls = [];
    const client = {
      async createTaskAndWait(request) {
        calls.push(['createTaskAndWait', request]);
        return {
          taskNo: 'clone-001',
          resultData: {
            voiceId: 'voice_clone_123',
          },
        };
      },
      async createTask(request) {
        calls.push(['createTask', request]);
        return {
          taskNo: 'tts-001',
          resultData: {
            url: 'https://cdn.example.com/cloned.mp3',
          },
        };
      },
    };

    const result = await generateAudio({
      projectCode: 'demo',
      kind: 'clone',
      voiceUrl: 'https://cdn.example.com/voice.mp3',
      text: 'Hello from cloned voice',
    }, { client });

    assert.deepEqual(calls, [
      ['createTaskAndWait', {
        projectCode: 'demo',
        taskCode: 'agent_tts_clone',
        inputParams: {
          audioUrl: 'https://cdn.example.com/voice.mp3',
        },
      }],
      ['createTask', {
        projectCode: 'demo',
        taskCode: 'agent_tts_minimax',
        inputParams: {
          voiceName: 'voice_clone_123',
          text: 'Hello from cloned voice',
          language: 'auto',
        },
      }],
    ]);
    assert.equal(result.cloneVoiceId, 'voice_clone_123');
    assert.deepEqual(result.resultUrls, ['https://cdn.example.com/cloned.mp3']);
  });

  it('rejects cloned TTS when clone result does not include resultData.voiceId', async () => {
    const client = {
      async createTaskAndWait() {
        return {
          taskNo: 'clone-001',
          resultData: {
            status: 'ok',
          },
        };
      },
      async createTask() {
        throw new Error('TTS should not be submitted without voiceId.');
      },
    };

    await assert.rejects(
      () => generateAudio({
        projectCode: 'demo',
        kind: 'clone',
        voiceUrl: 'https://cdn.example.com/voice.mp3',
        text: 'Hello',
      }, { client }),
      /Clone task result did not include resultData.voiceId/,
    );
  });
});

async function makeVoiceReferenceDir() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'shotfun-voices-'));
  await writeFile(path.join(dir, 'voice_demo.json'), JSON.stringify({
    platform: 'demo',
    provider: 'DemoVoice',
    defaultVoiceId: 'demo_ming_002',
    voices: [
      {
        voiceId: 'demo_lina_001',
        voiceName: 'Lina',
        language: 'en-US',
        description: 'Warm narration',
        tags: ['female', 'narration'],
      },
      {
        voiceId: 'demo_ming_002',
        voiceName: 'Ming',
        language: 'zh-CN',
        description: 'Clear Mandarin male',
        tags: ['male', 'default'],
      },
    ],
  }, null, 2));
  return dir;
}

async function makeLegacyVoiceReferenceDir() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'shotfun-voices-'));
  await writeFile(path.join(dir, 'voice_legacy.md'), `---
platform: demo
provider: DemoVoice
default_voice_id: legacy_ming_002
---

| voice_id | voice_name | language | description | tags |
| --- | --- | --- | --- | --- |
| legacy_lina_001 | Lina | en-US | Warm narration | female,narration |
| legacy_ming_002 | Ming | zh-CN | Clear Mandarin male | male,default |
`);
  return dir;
}
