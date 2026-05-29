// 覆盖自动任务选择器的能力过滤、预算偏好和选择原因。
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { selectTaskPreset } from '../../scripts/core/task-selector.js';

describe('task selector', () => {
  it('selects the low-cost image model for balanced default image generation', () => {
    const selection = selectTaskPreset({
      category: 'image',
      userPrefs: { budget: 'balanced', scenario: '低成本出图' },
    });

    assert.equal(selection.task.id, 'image.gpt_image2');
    assert.equal(selection.reason, '符合预算: balanced；推荐值 10/10');
    assert.ok(selection.candidates.length > 1);
  });

  it('filters out text-only image models when a reference image is required', () => {
    const selection = selectTaskPreset({
      category: 'image',
      context: { hasReferenceImage: true, requiresImageEdit: true },
      userPrefs: { budget: 'low', scenario: '参考图编辑' },
    });

    assert.equal(selection.task.id, 'image.gpt_image2');
    assert.equal(selection.task.supports.referenceImage, true);
    assert.equal(selection.task.supports.imageEdit, true);
    assert.equal(selection.candidates.some((candidate) => candidate.id === 'image.z_image'), false);
  });

  it('selects the best current reference video model when duration is flexible', () => {
    const selection = selectTaskPreset({
      category: 'video',
      context: { hasReferenceImage: true, durationSeconds: 10 },
      userPrefs: { budget: 'low', scenario: '支持真人' },
    });

    assert.equal(selection.task.id, 'video.sd2_fast_720p');
    assert.match(selection.reason, /支持真人/);
  });
});
