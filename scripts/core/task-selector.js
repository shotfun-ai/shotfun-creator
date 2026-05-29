import { listTaskDefinitions, resolveTaskPreset } from './task-registry.js';

/**
 * 根据用户偏好、输入上下文和注册表元数据选择最合适的任务 preset。
 */
export function selectTaskPreset({ category, userModel, userPrefs = {}, context = {} } = {}) {
  if (!category) throw new Error('selectTaskPreset requires category.');
  if (userModel && userModel !== 'auto') {
    const task = resolveTaskPreset(category, userModel);
    return {
      task,
      reason: `用户指定模型: ${userModel}`,
      candidates: [task],
    };
  }

  const candidates = listTaskDefinitions({ category }).filter((task) => supportsContext(task, context));
  if (!candidates.length) throw new Error(`No ShotFun ${category} preset matches the requested context.`);

  const ranked = candidates
    .map((task) => ({ task, score: scoreTask(task, userPrefs, context) }))
    .sort((a, b) => b.score - a.score || a.task.price.credits - b.task.price.credits || b.task.selection.recommendationScore - a.task.selection.recommendationScore);

  const selected = ranked[0].task;
  return {
    task: selected,
    reason: buildReason(selected, userPrefs),
    candidates: ranked.map(({ task, score }) => ({
      id: task.id,
      key: task.key,
      score,
      credits: task.price.credits,
      recommendationScore: task.selection.recommendationScore,
    })),
  };
}

function supportsContext(task, context) {
  if (context.hasReferenceImage && task.supports.referenceImage === false) return false;
  if (context.requiresImageEdit && task.supports.imageEdit === false) return false;
  if (context.assetMode === 'asset' && task.supports.assetMode === false) return false;
  if (context.assetMode === 'direct-url' && task.supports.directUrlMode === false) return false;
  if (
    context.durationSeconds !== undefined &&
    task.defaults.durationSeconds !== undefined &&
    Number(context.durationSeconds) !== Number(task.defaults.durationSeconds)
  ) {
    return false;
  }
  if (context.resolution && task.defaults.resolution && String(context.resolution).toLowerCase() !== String(task.defaults.resolution).toLowerCase()) {
    return false;
  }
  return true;
}

function scoreTask(task, userPrefs, context) {
  const tags = new Set(task.selection.tags || []);
  const scenarios = task.selection.scenarios || [];
  let score = task.selection.recommendationScore * 10;

  if (matchesScenario(scenarios, userPrefs.scenario)) score += 20;
  if (context.hasReferenceImage && task.supports.referenceImage) score += 10;
  if (context.requiresImageEdit && task.supports.imageEdit) score += 10;
  if (context.durationSeconds && Number(context.durationSeconds) === Number(task.defaults.durationSeconds)) score += 15;

  if (userPrefs.budget === 'low' && (task.price.priceTier === 'low' || tags.has('low_cost'))) score += 18;
  if (userPrefs.budget === 'balanced' && (tags.has('balanced') || tags.has('default') || task.price.priceTier === 'low')) score += 12;
  if (userPrefs.budget === 'quality' && (tags.has('quality') || tags.has('premium') || task.price.priceTier === 'high')) score += 18;
  if (userPrefs.quality === 'high' && tags.has('quality')) score += 12;
  if (userPrefs.stability === 'high' && tags.has('stable')) score += 12;

  // 业务积分可能是 50/200/1000 量级；成本只能作为同档辅助排序，不能压过推荐值和硬场景匹配。
  score -= Number(task.price.credits || 0) / 10;
  return score;
}

function buildReason(task, userPrefs) {
  const parts = [];
  if (matchesScenario(task.selection.scenarios, userPrefs.scenario)) parts.push(`匹配场景: ${userPrefs.scenario}`);
  if (userPrefs.budget) parts.push(`符合预算: ${userPrefs.budget}`);
  parts.push(`推荐值 ${task.selection.recommendationScore}/10`);
  return parts.join('；');
}

function matchesScenario(scenarios = [], scenario) {
  if (!scenario) return false;
  return scenarios.some((item) => item === scenario || item.includes(scenario) || String(scenario).includes(item));
}
