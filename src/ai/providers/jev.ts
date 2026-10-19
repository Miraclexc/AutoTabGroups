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
      if (!settings.classifier.model) throw new Error('请先填写 Jev 模型名称');
      const { criteria, ids } = categoryChoices(categories);
      const body = {
        model: settings.classifier.model, state: page,
        questions: { route: { type: 'choice', instructions: routeInstructions, criteria } },
      };
      if (inputBytes(body) > settings.requestBudget) throw new Error('本页与分类规则超过请求预算，请减少正文长度或提高预算');
      const data = await postJson(endpointSchema.parse(settings.classifier.baseUrl), apiKey ? { Authorization: `Bearer ${apiKey}` } : {}, body, signal, fetcher);
      return parseChoice(data, criteria, ids);
    },
  };
}
