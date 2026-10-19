import { z } from 'zod';

export const colors = ['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange'] as const;
export const categoryDraftSchema = z.object({
  name: z.string().trim().min(1).max(60),
  description: z.string().trim().min(1).max(1200),
  include: z.array(z.string().max(200)).max(12).default([]),
  exclude: z.array(z.string().max(200)).max(12).default([]),
  color: z.enum(colors).default('blue'),
});
export const categorySchema = categoryDraftSchema.extend({
  description: z.string().trim().max(1200).default(''),
  id: z.string().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/).refine(id => id !== 'none', '分类 ID 不能使用保留的拒绝归类选项'),
});
export const categoriesSchema = z.array(categorySchema).max(50).superRefine((items, ctx) => {
  if (new Set(items.map(x => x.id)).size !== items.length)
    ctx.addIssue({ code: 'custom', message: '分类 ID 不能重复' });
  if (new Set(items.map(x => x.name.toLowerCase())).size !== items.length)
    ctx.addIssue({ code: 'custom', message: '分类名称不能重复' });
});
export const endpointSchema = z.string().url().refine(value => {
  const url = new URL(value);
  return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash;
}, '请输入不含凭据、查询参数和片段的 HTTP(S) 地址');
const providerSchema = z.object({ baseUrl: endpointSchema, model: z.string().trim().max(150) });
export const thinkingAdapters = ['auto', 'openai', 'claude-adaptive', 'claude-budget', 'deepseek', 'glm', 'kimi', 'non-reasoning'] as const;
export const thinkingEfforts = ['off', 'on', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const;
export const settingsSchema = z.object({
  readContent: z.boolean(),
  scope: z.enum(['current', 'all']),
  maxContentChars: z.number().int().min(500).max(20000),
  requestBudget: z.number().int().min(4000).max(100000),
  maxGroups: z.number().int().min(2).max(30),
  groupBy: z.enum(['topic', 'task']),
  minProbability: z.number().min(0).max(1),
  minMargin: z.number().min(0).max(1),
  generator: providerSchema.extend({
    protocol: z.enum(['openai', 'anthropic']),
    thinkingAdapter: z.enum(thinkingAdapters).default('auto'),
    thinkingEffort: z.enum(thinkingEfforts).default('off'),
  }),
  classifier: providerSchema.extend({
    backend: z.enum(['jev', 'openai-decisions', 'llm']).default('jev'),
    protocol: z.enum(['openai', 'anthropic']).default('openai'),
    thinkingAdapter: z.enum(thinkingAdapters).default('auto'),
    thinkingEffort: z.enum(thinkingEfforts).default('off'),
  }),
});
export type Category = z.infer<typeof categorySchema>;
export type CategoryDraft = z.infer<typeof categoryDraftSchema>;
export type Settings = z.infer<typeof settingsSchema>;
export const defaultSettings: Settings = {
  readContent: false, scope: 'current', maxContentChars: 6000, requestBudget: 30000,
  maxGroups: 8, groupBy: 'task', minProbability: 0.8, minMargin: 0.2,
  generator: { protocol: 'openai', baseUrl: 'https://api.openai.com/v1', model: '', thinkingAdapter: 'auto', thinkingEffort: 'off' },
  classifier: { baseUrl: 'https://api.typesafe.ai/v1/systemone', model: 'jev-latest', backend: 'jev', protocol: 'openai', thinkingAdapter: 'auto', thinkingEffort: 'off' },
};

export const pageInputSchema = z.object({
  title: z.string().max(1000), url: z.string().max(4000), description: z.string().max(2000),
  content: z.string().max(20000).optional(),
  extraction: z.enum(['metadata', 'readability', 'fallback']),
  truncated: z.boolean(), warning: z.string().max(300).optional(),
});
export type PageInput = z.infer<typeof pageInputSchema>;
export interface TabSnapshot { id: number; windowId: number; url: string; title: string; groupId: number; index: number }
export interface Classification { choice: string; probabilities: Record<string, number>; confidence: number; model: string; scoreSource?: 'decision_probability' | 'llm_estimate' }
export const candidateScoreSchema = z.object({ categoryId: z.string(), name: z.string(), score: z.number().min(0).max(1), color: z.enum(colors).optional() });
export type CandidateScore = z.infer<typeof candidateScoreSchema>;
export interface TaskItem {
  tab: TabSnapshot;
  status: 'pending' | 'read' | 'applied' | 'unmatched' | 'uncertain' | 'skipped' | 'failed';
  message?: string;
  preview?: string;
  categoryId?: string;
  extraction?: PageInput['extraction'];
  truncated?: boolean;
  cached?: boolean;
  candidates?: CandidateScore[];
  scoreSource?: Classification['scoreSource'];
}
export interface ApplyRecord { tab: TabSnapshot; targetGroupId: number; applied: boolean; undone?: boolean }
export interface TaskRecord {
  id: string; sessionId: string; kind: 'generate' | 'update';
  status: 'running' | 'completed' | 'cancelled' | 'interrupted' | 'failed';
  createdAt: number; message?: string;
  items: TaskItem[]; settings: Settings; categories: Category[];
  draft?: CategoryDraft[];
  undo: ApplyRecord[];
}
export interface Binding { categoryId: string; windowId: number; groupId: number }
export interface IgnoredTab { id: number; url: string }
export interface AppState {
  settings: Settings; categories: Category[]; task: TaskRecord | null;
  tabs: TabSnapshot[]; ignored: IgnoredTab[]; bindings: Binding[];
  nativeGroups: { id: number; windowId: number; title: string; color: string }[];
  hasGeneratorKey: boolean; hasClassifierKey: boolean;
}
