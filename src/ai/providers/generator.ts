import { z } from 'zod';
import { categoryDraftSchema, type PageInput, type Settings } from '../../shared/schemas';
import { fitPages, inputBytes } from '../budget';
import type { GroupGenerator } from '../contracts';
import { generationPrompt } from '../prompts/generate-groups';
import type { Fetch } from '../transport';
import { requestJsonText } from './chat';

export function parseGroups(text: string, maxGroups: number) {
  const json = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  let value: unknown;
  try { value = JSON.parse(json); } catch { throw new Error('分组方案不是有效 JSON，请重试'); }
  const { groups } = z.object({ groups: z.array(categoryDraftSchema).max(maxGroups) }).parse(value);
  if (new Set(groups.map(group => group.name.toLowerCase())).size !== groups.length) throw new Error('模型返回了重复的分类名称');
  return groups;
}

export function createGenerator(settings: Settings, apiKey: string, fetcher?: Fetch): GroupGenerator {
  const config = settings.generator;
  return {
    async generate(pages: PageInput[], signal?: AbortSignal) {
      if (!config.model) throw new Error('请先填写生成模型名称');
      const system = generationPrompt(settings);
      const user = JSON.stringify({ pages: fitPages(pages, Math.max(0, settings.requestBudget - inputBytes(system) - 1500)) });
      const text = await requestJsonText(config, apiKey, system, user, settings.requestBudget, signal, fetcher);
      return parseGroups(text, settings.maxGroups);
    },
  };
}
