import { AppError } from '../../shared/errors';
import { z } from 'zod';
import { endpointSchema, type Settings, type Classification } from '../../shared/schemas';
import type { TabClassifier } from '../contracts';
import { inputBytes } from '../budget';
import { postJson, type Fetch } from '../transport';

import { answerSchema, categoryChoices, routeInstructions, validateChoice } from './choices';

export function parseChoice(data: unknown, options: Record<string, string>, ids: Record<string, string>): Classification {
  const parsed = z.object({ model: z.string(), answers: z.object({ route: answerSchema }) }).parse(data);
  return validateChoice(parsed.answers.route, options, ids, parsed.model, 'decision_probability');
}
export function createClassifier(settings: Settings, apiKey: string, fetcher?: Fetch): TabClassifier {
  return {
    async classify(page, categories, signal) {
      if (!settings.classifier.model) throw new AppError('model.jevName');
      const { criteria, ids } = categoryChoices(categories);
      const body = {
        model: settings.classifier.model, state: page,
        questions: { route: { type: 'choice', instructions: routeInstructions, criteria } },
      };
      if (inputBytes(body) > settings.requestBudget) throw new AppError('budget.page');
      const data = await postJson(endpointSchema.parse(settings.classifier.baseUrl), apiKey ? { Authorization: `Bearer ${apiKey}` } : {}, body, signal, fetcher);
      return parseChoice(data, criteria, ids);
    },
  };
}
