import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { ShotFunOpenApiError } from '../../scripts/core/api-client.js';
import { buildInputParams } from '../../scripts/services/input-params.js';

describe('service input params builder', () => {
  it('requires a prompt for prompt-based tasks', () => {
    assert.throws(
      () => buildInputParams('image', { aspectRatio: '16:9' }),
      ShotFunOpenApiError,
    );
  });

  it('builds compatible image params and skips absent optional fields', () => {
    const params = buildInputParams('image', {
      prompt: 'A lake',
      aspectRatio: '16:9',
      resolution: '2K',
      negativePrompt: '',
      imageUrls: [],
      width: undefined,
      steps: 28,
      input: {
        cfg: 7.5,
      },
    });

    assert.deepEqual(params, {
      prompt: 'A lake',
      aspectRatio: '16:9',
      resolution: '2K',
      steps: 28,
      cfg: 7.5,
    });
  });

  it('builds compatible video params with optional media arrays only when present', () => {
    const params = buildInputParams('video', {
      prompt: 'Slow push in',
      imageUrls: ['https://example.com/a.png'],
      videoUrls: [],
      audioUrls: [],
      durationSeconds: 5,
      resolution: '720p',
      generateAudio: false,
    });

    assert.deepEqual(params, {
      prompt: 'Slow push in',
      imageUrls: ['https://example.com/a.png'],
      duration: 5,
      durationSeconds: 5,
      resolution: '720p',
      generateAudio: false,
    });
  });
});
