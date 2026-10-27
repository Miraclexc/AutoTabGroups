import { categoriesSchema, defaultSettings, settingsSchema, type Binding, type Category, type Classification, type IgnoredTab, type Settings } from '../shared/schemas';
import { z } from 'zod';

const configSchema = z.object({ settings: settingsSchema, categories: categoriesSchema });
const keysSchema = z.object({ generator: z.string().default(''), classifier: z.string().default(''), tavily: z.string().default(''), deepseek: z.string().default('') });
const bindingsSchema = z.array(z.object({ categoryId: z.string(), windowId: z.number(), groupId: z.number() }));
const ignoredSchema = z.array(z.object({ id: z.number(), url: z.string() }));

const cacheSchema = z.record(z.string(), z.object({ at: z.number(), answer: z.object({
  choice: z.string(), probabilities: z.record(z.string(), z.number()), confidence: z.number(), model: z.string(),
  scoreSource: z.enum(['decision_probability', 'llm_estimate']).optional(),
}) }));

const configKey = 'config.v1';

export async function readConfig(): Promise<{ settings: Settings; categories: Category[] }> {
  const data = (await chrome.storage.local.get(configKey))[configKey];
  return configSchema.parse(data || { settings: defaultSettings, categories: [] });
}
export async function writeConfig(config: { settings: Settings; categories: Category[] }) {
  await chrome.storage.local.set({ [configKey]: { settings: settingsSchema.parse(config.settings), categories: categoriesSchema.parse(config.categories) } });
}
export async function readKeys(): Promise<{ generator: string; classifier: string; tavily: string; deepseek: string }> {
  const data = (await chrome.storage.local.get('credentials.v1'))['credentials.v1'];
  return keysSchema.parse(data || {});
}
export async function writeKeys(keys: { generator: string; classifier: string; tavily?: string; deepseek?: string }) {
  await chrome.storage.local.set({ 'credentials.v1': keys });
}

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
  return entry ? entry.answer : null;
}
export async function cacheDecision(key: string, answer: Classification) {
  const entries = cacheSchema.parse((await chrome.storage.session.get('decisions')).decisions || {});
  entries[key] = { at: Date.now(), answer };
  const trimmed = Object.fromEntries(Object.entries(entries).sort((a, b) => b[1].at - a[1].at).slice(0, 300));
  await chrome.storage.session.set({ decisions: trimmed });
}
