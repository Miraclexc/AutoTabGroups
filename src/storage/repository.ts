import { candidateScoreSchema, categoriesSchema, defaultSettings, settingsSchema, type AppState, type Binding, type Category, type Classification, type IgnoredTab, type Settings, type TaskRecord } from '../shared/schemas';
import { z } from 'zod';

const configSchema = z.object({ settings: settingsSchema, categories: categoriesSchema });
const keysSchema = z.object({ generator: z.string().default(''), classifier: z.string().default('') });
const bindingsSchema = z.array(z.object({ categoryId: z.string(), windowId: z.number(), groupId: z.number() }));
const ignoredSchema = z.array(z.object({ id: z.number(), url: z.string() }));
const tabSchema = z.object({ id: z.number(), windowId: z.number(), url: z.string(), title: z.string(), groupId: z.number(), index: z.number() });
const taskSchema: z.ZodType<TaskRecord> = z.object({
  id: z.string(), sessionId: z.string(), kind: z.enum(['generate', 'update']),
  status: z.enum(['running', 'completed', 'cancelled', 'interrupted', 'failed']),
  createdAt: z.number(), message: z.string().optional(), settings: settingsSchema, categories: categoriesSchema,
  items: z.array(z.object({
    tab: tabSchema, status: z.enum(['pending', 'read', 'applied', 'unmatched', 'uncertain', 'skipped', 'failed']),
    message: z.string().optional(), preview: z.string().max(320).optional(), categoryId: z.string().optional(), extraction: z.enum(['metadata', 'readability', 'fallback']).optional(),
    truncated: z.boolean().optional(), cached: z.boolean().optional(),
    candidates: z.array(candidateScoreSchema).max(3).optional(), scoreSource: z.enum(['decision_probability', 'llm_estimate']).optional(),
  })),
  draft: z.array(z.object({ name: z.string(), description: z.string(), include: z.array(z.string()), exclude: z.array(z.string()), color: z.enum(['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange']) })).optional(),
  undo: z.array(z.object({ tab: tabSchema, targetGroupId: z.number(), applied: z.boolean(), undone: z.boolean().optional() })),
});
const cacheSchema = z.record(z.string(), z.object({ at: z.number(), answer: z.object({
  choice: z.string(), probabilities: z.record(z.string(), z.number()), confidence: z.number(), model: z.string(),
  scoreSource: z.enum(['decision_probability', 'llm_estimate']).optional(),
}) }));

const configKey = 'config.v1';
const taskKey = 'task.v1';
export async function readConfig(): Promise<{ settings: Settings; categories: Category[] }> {
  const data = (await chrome.storage.local.get(configKey))[configKey];
  return configSchema.parse(data || { settings: defaultSettings, categories: [] });
}
export async function writeConfig(config: { settings: Settings; categories: Category[] }) {
  await chrome.storage.local.set({ [configKey]: { settings: settingsSchema.parse(config.settings), categories: categoriesSchema.parse(config.categories) } });
}
export async function readKeys(): Promise<{ generator: string; classifier: string }> {
  const data = (await chrome.storage.local.get('credentials.v1'))['credentials.v1'];
  return keysSchema.parse(data || {});
}
export async function writeKeys(keys: { generator: string; classifier: string }) {
  await chrome.storage.local.set({ 'credentials.v1': keys });
}
export async function readTask(): Promise<TaskRecord | null> {
  const data = (await chrome.storage.local.get(taskKey))[taskKey];
  return data ? taskSchema.parse(data) : null;
}
export async function writeTask(task: TaskRecord) { await chrome.storage.local.set({ [taskKey]: task }); }
export async function sessionId(): Promise<string> {
  const data = (await chrome.storage.session.get('sessionId')).sessionId;
  if (typeof data === 'string') return data;
  const id = crypto.randomUUID();
  await chrome.storage.session.set({ sessionId: id });
  return id;
}
export async function readBindings(): Promise<Binding[]> { return bindingsSchema.parse((await chrome.storage.session.get('bindings')).bindings || []); }
export async function writeBindings(bindings: Binding[]) { await chrome.storage.session.set({ bindings }); }
export async function readIgnored(): Promise<IgnoredTab[]> { return ignoredSchema.parse((await chrome.storage.session.get('ignored')).ignored || []); }
export async function writeIgnored(ignored: IgnoredTab[]) { await chrome.storage.session.set({ ignored }); }

export async function fingerprint(value: unknown): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value)));
  return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
export async function cachedDecision(key: string): Promise<Classification | null> {
  const entry = cacheSchema.parse((await chrome.storage.session.get('decisions')).decisions || {})[key];
  return entry && Date.now() - entry.at < 60 * 60 * 1000 ? entry.answer : null;
}
export async function cacheDecision(key: string, answer: Classification) {
  const entries = cacheSchema.parse((await chrome.storage.session.get('decisions')).decisions || {});
  entries[key] = { at: Date.now(), answer };
  const trimmed = Object.fromEntries(Object.entries(entries).sort((a, b) => b[1].at - a[1].at).slice(0, 300));
  await chrome.storage.session.set({ decisions: trimmed });
}
export async function getState(): Promise<AppState> {
  const [config, task, keys, tabs, ignored, bindings, groups] = await Promise.all([
    readConfig(), readTask(), readKeys(), chrome.tabs.query({ windowType: 'normal' }), readIgnored(), readBindings(), chrome.tabGroups.query({}),
  ]);
  return { ...config, task, ignored, bindings,
    tabs: tabs.filter(tab => tab.id !== undefined && !tab.incognito).map(tab => ({ id: tab.id!, windowId: tab.windowId, url: tab.url || '', title: tab.title || '', groupId: tab.groupId, index: tab.index })),
    nativeGroups: groups.map(group => ({ id: group.id, windowId: group.windowId, title: group.title || '未命名分组', color: group.color })),
    hasGeneratorKey: !!keys.generator, hasClassifierKey: !!keys.classifier,
  };
}
