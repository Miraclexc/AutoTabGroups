import type { Settings } from '../../shared/schemas';
import type { TabClassifier } from '../contracts';
import type { Fetch } from '../transport';
import { categoryChoices, routeInstructions, validateChoice } from './choices';
import { requestJsonText } from './chat';

export function createLlmClassifier(settings: Settings, apiKey: string, fetcher?: Fetch): TabClassifier {
  return {
    async classify(page, categories, signal) {
      const config = settings.classifier;
      if (!config.model) throw new Error('请先填写分类模型名称');
      const { criteria, ids } = categoryChoices(categories);
      const system = `${routeInstructions} 不要总结网页，也不要创建新分类。只返回 JSON 对象，格式为 {"choice":"候选键","probabilities":{"每一个候选键":0.0},"confidence":0.0}。probabilities 必须包含所有候选键，各值在 0 到 1 之间，总和为 1；choice 必须是分数最高的候选。confidence 为 0 到 1 的自评把握程度。这些分数仅为自评估计。`;
      const text = await requestJsonText(config, apiKey, system, JSON.stringify({ page, choices: criteria }), settings.requestBudget, signal, fetcher);
      let value: unknown;
      try { value = JSON.parse(text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')); }
      catch { throw new Error('分类结果不是有效 JSON，保持未分组'); }
      return validateChoice(value, criteria, ids, config.model, 'llm_estimate');
    },
  };
}
