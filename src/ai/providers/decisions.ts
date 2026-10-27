import { AppError } from '../../shared/errors';
import { z } from 'zod';
import { endpointSchema, type Settings } from '../../shared/schemas';
import type { TabClassifier } from '../contracts';
import { inputBytes } from '../budget';
import { postJson, type Fetch } from '../transport';
import { categoryChoices, routeInstructions, validateChoice } from './choices';

const responseSchema = z.object({
  model: z.string(),
  answers: z.array(z.discriminatedUnion('type', [
    z.object({ type: z.literal('refusal'), name: z.string().nullable() }),
    z.object({
      type: z.literal('choice'), name: z.literal('route'), choice: z.string(),
      probabilities: z.array(z.object({ value: z.string(), probability: z.number().min(0).max(1) })),
      confidence: z.number().min(0).max(1),
    }),
  ])).length(1),
});
export function createDecisionsClassifier(settings: Settings, apiKey: string, fetcher?: Fetch): TabClassifier {
  return {
    async classify(page, categories, signal) {
      const config = settings.classifier;
      if (!config.model) throw new AppError('model.decisionsName');
      const { criteria, ids } = categoryChoices(categories);
      const body = {
        model: config.model, input: JSON.stringify(page),
        questions: [{ type: 'choice', name: 'route', instructions: routeInstructions,
          choices: Object.entries(criteria).map(([value, description]) => ({ value, description })) }],
      };
      if (inputBytes(body) > settings.requestBudget) throw new AppError('budget.page');
      const data = await postJson(endpointSchema.parse(config.baseUrl), apiKey ? { Authorization: `Bearer ${apiKey}` } : {}, body, signal, fetcher);
      const parsed = responseSchema.parse(data);
      const answer = parsed.answers[0];
      if (answer.type === 'refusal') throw new AppError('model.decisionsRefused');
      if (new Set(answer.probabilities.map(item => item.value)).size !== answer.probabilities.length)
        throw new AppError('model.duplicateScores');
      return validateChoice({ ...answer, probabilities: Object.fromEntries(answer.probabilities.map(item => [item.value, item.probability])) }, criteria, ids, parsed.model, 'decision_probability');
    },
  };
}
