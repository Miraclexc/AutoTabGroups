import { AppError } from '../../shared/errors';
import type { Settings } from '../../shared/schemas';
import type { TabClassifier } from '../contracts';
import type { Fetch } from '../transport';
import { categoryChoices, routeInstructions, validateChoice } from './choices';
import { requestJsonText } from './chat';

export function createLlmClassifier(settings: Settings, apiKey: string, fetcher?: Fetch): TabClassifier {
  return {
    async classify(page, categories, signal) {
      const config = settings.classifier;
      if (!config.model) throw new AppError('model.classifierName');
      const { criteria, ids } = categoryChoices(categories);
      const system = `${routeInstructions} Return only a JSON object in the form {"choice":"candidate_key","probabilities":{"candidate_key":0.0},"confidence":0.0}. Include every supplied candidate key in probabilities, with values between 0 and 1 summing to 1. choice must be the highest-scoring candidate. confidence is a self-assessed value between 0 and 1. These scores are estimates only. Preserve candidate keys exactly; do not translate them.`;
      const text = await requestJsonText(config, apiKey, system, JSON.stringify({ page, choices: criteria }), settings.requestBudget, signal, fetcher);
      let value: unknown;
      try { value = JSON.parse(text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')); }
      catch { throw new AppError('model.classificationJson'); }
      return validateChoice(value, criteria, ids, config.model, 'llm_estimate');
    },
  };
}
