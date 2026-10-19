import type { Category, Classification, Settings } from '../shared/schemas';

export function topCandidates(answer: Classification, categories: Category[]) {
  // Rank only actual groups, not abstention outcomes; keep the model's original
  // scores (no renormalization) and snapshot names for historical task results.
  return categories.filter(category => Object.hasOwn(answer.probabilities, category.id))
    .map(category => ({ categoryId: category.id, name: category.name, color: category.color, score: answer.probabilities[category.id] }))
    .sort((a, b) => b.score - a.score).slice(0, 3);
}

export function decide(answer: Classification, categories: Category[], settings: Settings): { categoryId?: string; status: 'applied' | 'unmatched' | 'uncertain'; message: string } {
  if (answer.choice === 'none') return { status: 'unmatched', message: '没有合适分类或页面信息不足，保持未分组' };
  if (!categories.some(category => category.id === answer.choice)) throw new Error('未知分类');
  const probability = answer.probabilities[answer.choice] || 0;
  const runnerUp = Math.max(0, ...Object.entries(answer.probabilities).filter(([key]) => key !== answer.choice).map(([, p]) => p));
  if (probability < settings.minProbability || probability - runnerUp < settings.minMargin)
    return { status: 'uncertain', message: '分类不够明确，保持未分组' };
  return { categoryId: answer.choice, status: 'applied', message: `${answer.scoreSource === 'llm_estimate' ? '模型自评分' : '匹配概率'} ${Math.round(probability * 100)}%` };
}
