import { z } from 'zod';
import { defaultSettings, settingsSchema, type Classification, type Settings } from '../shared/schemas';
import { profileSchema, workspaceSchema, type Diagnostic, type Journal, type OrganizeTask, type Workspace } from '../shared/organizer';
import { readConfig, readKeys, readTask, sessionId } from './repository';

const WORKSPACE = 'workspace.v2';
const TASK = 'organizer.task.v2';
const UNDO = 'organizer.undo.v2';
const PENDING = 'organizer.pending.v2';
export const CACHE = 'organizer.decisions.v2';
let queue: Promise<unknown> = Promise.resolve();
export function exclusive<T>(operation: () => Promise<T>): Promise<T> {
  const promise = queue.then(operation); queue = promise.catch(() => {}); return promise;
}
export async function workspace(): Promise<Workspace> {
  const existing = (await chrome.storage.local.get(WORKSPACE))[WORKSPACE];
  if (existing) return workspaceSchema.parse(existing);
  return exclusive(async () => {
    const found = (await chrome.storage.local.get(WORKSPACE))[WORKSPACE];
    if (found) return workspaceSchema.parse(found);
    const legacyRaw = (await chrome.storage.local.get('config.v1'))['config.v1'];
    const legacy = legacyRaw ? await readConfig() : { settings: defaultSettings, categories: [] };
    const hints = (await chrome.storage.local.get('groupHints.v1'))['groupHints.v1'] as { categoryId: string; titles: string[] }[] | undefined;
    const next = workspaceSchema.parse({
      version: 2, revision: 1, settings: { ...legacy.settings, scope: 'current' },
      profiles: legacy.categories.map(c => ({
        id: c.id, name: c.name, color: c.color, source: 'legacy',
        description: [c.description, c.include.length ? `包含示例：${c.include.join('；')}` : '', c.exclude.length ? `排除范围：${c.exclude.join('；')}` : ''].filter(Boolean).join('\n'),
        titles: hints?.find(h => h.categoryId === c.id)?.titles || [],
      })),
    });
    await chrome.storage.local.set({ [WORKSPACE]: next });
    return next;
  });
}
export async function mutateWorkspace(update: (current: Workspace) => Workspace) {
  await workspace();
  return exclusive(async () => {
    const current = workspaceSchema.parse((await chrome.storage.local.get(WORKSPACE))[WORKSPACE]);
    const next = workspaceSchema.parse({ ...update(current), revision: current.revision + 1 });
    await chrome.storage.local.set({ [WORKSPACE]: next });
    return next;
  });
}
export async function saveConfiguration(settings: Workspace['settings'], revision: number, generatorKey?: string, classifierKey?: string, readerKeys?: { tavily?: string; deepseek?: string }) {
  await workspace();
  return exclusive(async () => {
    const current = workspaceSchema.parse((await chrome.storage.local.get(WORKSPACE))[WORKSPACE]);
    if (revision !== current.revision) throw new Error('配置已在其他页面更新，请重新载入后再保存；当前输入已保留');
    const keys = await readKeys();
    if (generatorKey !== undefined) keys.generator = generatorKey.trim();
    if (classifierKey !== undefined) keys.classifier = classifierKey.trim();
    for (const provider of ['tavily', 'deepseek'] as const) if (readerKeys?.[provider] !== undefined) keys[provider] = readerKeys[provider]!.trim();
    const next = workspaceSchema.parse({ ...current, settings: { ...settings, scope: 'current' }, revision: current.revision + 1 });
    // Store config and credentials in one storage operation; failed writes keep both previous values.
    await chrome.storage.local.set({ [WORKSPACE]: next, 'credentials.v1': keys });
  });
}
export async function readOrganizerTask(): Promise<OrganizeTask | null> {
  const value = (await chrome.storage.local.get(TASK))[TASK] as OrganizeTask | undefined;
  if (!value) {
    if ((await chrome.storage.local.get('organizer.legacy-hidden.v2'))['organizer.legacy-hidden.v2']) return null;
    const legacy = await readTask();
    if (!legacy) return null;
    return {
      version: 2, id: `legacy:${legacy.id}`, sessionId: 'legacy-read-only', windowId: legacy.items[0]?.tab.windowId ?? -1,
      action: 'organize-window', source: 'sidebar', createdAt: legacy.createdAt,
      status: legacy.status === 'running' ? 'interrupted' : legacy.status,
      stage: 'done', allowNew: false, settings: legacy.settings, initialGroups: [], targets: [],
      items: legacy.items, journal: [], message: `旧版本${legacy.kind === 'generate' ? '分类草案' : '整理'}记录（只读）：${legacy.message || legacy.status}`,
    };
  }
  if (value.version !== 2 || !Array.isArray(value.items) || !Array.isArray(value.journal)) throw new Error('任务记录损坏，请在配置页清除最近任务详情');
  return { ...value, ...(value.settings ? { settings: settingsSchema.parse(value.settings) } : {}) };
}
export async function writeOrganizerTask(task: OrganizeTask) { await chrome.storage.local.set({ [TASK]: task }); }
export async function clearOrganizerTask() {
  await chrome.storage.local.remove(TASK);
  await chrome.storage.local.set({ 'organizer.legacy-hidden.v2': true });
}
export async function readJournal(): Promise<Journal | null> {
  return (await chrome.storage.local.get(UNDO))[UNDO] as Journal || null;
}
export async function writePending(journal: Journal) { await chrome.storage.local.set({ [PENDING]: journal }); }
export async function commitJournal(journal: Journal) {
  await chrome.storage.local.set({ [UNDO]: { ...journal, pending: false } });
  await chrome.storage.local.remove(PENDING);
}
export async function pendingJournal(): Promise<Journal | null> { return (await chrome.storage.local.get(PENDING))[PENDING] as Journal || null; }
export async function clearPending() { await chrome.storage.local.remove(PENDING); }
export async function diagnostic(value?: Diagnostic): Promise<Diagnostic | null> {
  if (value) await chrome.storage.local.set({ 'organizer.diagnostic.v2': value });
  return (await chrome.storage.local.get('organizer.diagnostic.v2'))['organizer.diagnostic.v2'] as Diagnostic || null;
}
const cachedAnswer = z.object({
  at: z.number(), answer: z.object({ choice: z.string(), confidence: z.number(), model: z.string(),
    probabilities: z.record(z.string(), z.number()), scoreSource: z.enum(['decision_probability', 'llm_estimate']).optional() }),
});
export async function getDecision(key: string): Promise<Classification | null> {
  const stored = (await chrome.storage.session.get(CACHE))[CACHE] as Record<string, unknown> || {};
  const entry = cachedAnswer.safeParse(stored[key]);
  return entry.success ? entry.data.answer : null;
}
export async function putDecision(key: string, answer: Classification) {
  const stored = (await chrome.storage.session.get(CACHE))[CACHE] || {};
  const entries = Object.entries(stored).filter(([, v]) => cachedAnswer.safeParse(v).success) as [string, z.infer<typeof cachedAnswer>][];
  const next = Object.fromEntries([[key, { at: Date.now(), answer }], ...entries.filter(([k]) => k !== key).sort((a, b) => b[1].at - a[1].at)].slice(0, 300));
  await chrome.storage.session.set({ [CACHE]: next });
}
export const backupSchema = z.object({ type: z.literal('autotabgroups-config'), version: z.literal(2), settings: settingsSchema, profiles: z.array(profileSchema) });
export async function exportConfig() {
  const data = await workspace();
  return { type: 'autotabgroups-config', version: 2, settings: data.settings, profiles: data.profiles };
}
export async function previewImport(input: unknown) {
  const data = backupSchema.parse(input);
  if (new Set(data.profiles.map(p => p.id)).size !== data.profiles.length) throw new Error('说明 ID 重复');
  const current = await workspace();
  const changes: string[] = [];
  const labels: Record<string, string> = { generator: '标准 Chat 服务', classifier: '归组判断服务', classifierUseChat: '复用标准 Chat', readContent: '正文读取', reader: '正文读取服务', minProbability: '最低分数', minMargin: '候选分差', maxContentChars: '正文长度', requestBudget: '输入预算', maxGroups: '新组数量上限' };
  for (const key of Object.keys(labels) as (keyof Settings)[]) {
    if (JSON.stringify(current.settings[key]) !== JSON.stringify(data.settings[key]))
      changes.push(`${labels[key]}：${JSON.stringify(current.settings[key])} → ${JSON.stringify(data.settings[key])}`);
  }
  for (const profile of data.profiles) {
    const previous = current.profiles.find(p => p.id === profile.id);
    if (!previous || JSON.stringify(previous) !== JSON.stringify(profile))
      changes.push(`${previous ? '更新' : '新增'}说明「${profile.name}」：${profile.description || '（未填写）'}`);
  }
  if (!changes.length) changes.push('配置与说明没有变化。');
  return { data, revision: current.revision, changes, profileCount: data.profiles.length, message: '将应用以下差异；不导入密钥、不移动标签。' };
}
export async function importConfig(input: unknown, revision: number) {
  const { data } = await previewImport(input);
  await mutateWorkspace(current => {
    if (current.revision !== revision) throw new Error('配置已变化，请重新预览导入');
    const profiles = new Map(current.profiles.map(p => [p.id, p]));
    data.profiles.forEach(p => profiles.set(p.id, p));
    return { ...current, settings: { ...data.settings, scope: 'current' }, profiles: [...profiles.values()] };
  });
}
export async function newJournal(windowId: number): Promise<Journal> {
  return { id: crypto.randomUUID(), sessionId: await sessionId(), windowId, createdAt: Date.now(), records: [] };
}
