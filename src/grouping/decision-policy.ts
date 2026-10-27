import { AppError } from '../shared/errors';
import type { Category, Classification, Settings } from '../shared/schemas';
import { msg, type MessageRef } from '../i18n';

export function topCandidates(answer: Classification, categories: Category[]) {
  // Rank only actual groups, not abstention outcomes; keep the model's original
  // scores (no renormalization) and snapshot names for historical task results.
  return categories.filter(category => Object.hasOwn(answer.probabilities, category.id))
    .map(category => ({ categoryId: category.id, name: category.name, color: category.color, score: answer.probabilities[category.id] }))
    .sort((a, b) => b.score - a.score).slice(0, 3);
}

export function decide(answer: Classification, categories: Category[], settings: Settings): { categoryId?: string; status: 'applied' | 'unmatched' | 'uncertain'; message: MessageRef } {
  if (answer.choice === 'none') return { status: 'unmatched', message: msg('messages.no_suitable_group_or_insufficient_page_information_left_ungrouped') };
  if (!categories.some(category => category.id === answer.choice)) throw new AppError('messages.unknown_group_reference');
  const probability = answer.probabilities[answer.choice] || 0;
  const runnerUp = Math.max(0, ...Object.entries(answer.probabilities).filter(([key]) => key !== answer.choice).map(([, p]) => p));
  if (probability < settings.minProbability || probability - runnerUp < settings.minMargin)
    return { status: 'uncertain', message: msg('messages.the_match_was_not_clear_enough_left_ungrouped') };
  return { categoryId: answer.choice, status: 'applied', message: msg(answer.scoreSource === 'llm_estimate' ? 'score.self' : 'score.probability', { score: Math.round(probability * 100) }) };
}
