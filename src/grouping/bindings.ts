import { z } from 'zod';
import type { ApplyRecord, Binding, Category, TabSnapshot } from '../shared/schemas';
import { readBindings, readConfig, writeBindings, writeConfig } from '../storage/repository';
import { applyGroup, chromeGroups } from './apply';
import { unchanged } from '../browser/tabs';
import { MIN_NEW_GROUP_TABS } from '../shared/group-policy';

export type NativeGroup = Pick<chrome.tabGroups.TabGroup, 'id' | 'windowId' | 'title'>;
export type GroupHints = { categoryId: string; titles: string[] }[];
const hintsSchema = z.array(z.object({ categoryId: z.string(), titles: z.array(z.string()) }));
const hintsKey = 'groupHints.v1';
export const normalizeTitle = (title: string) => title.normalize('NFC').trim().toLowerCase();
const slot = (binding: Pick<Binding, 'categoryId' | 'windowId'>) => `${binding.categoryId}:${binding.windowId}`;

// Persist names, never native IDs: Chrome may reuse IDs after a browser restart.
export function reconcileBindings(categories: Category[], groups: NativeGroup[], previous: Binding[], hints: GroupHints) {
  const bindings: Binding[] = [];
  const used = new Set<number>();
  const slots = new Set<string>();
  const add = (categoryId: string, group: NativeGroup) => {
    const binding = { categoryId, windowId: group.windowId, groupId: group.id };
    if (used.has(group.id) || slots.has(slot(binding))) return;
    bindings.push(binding); used.add(group.id); slots.add(slot(binding));
  };
  // A live binding is authoritative, including manual renames and window moves.
  for (const binding of previous) {
    const group = groups.find(group => group.id === binding.groupId);
    if (group && categories.some(category => category.id === binding.categoryId)) add(binding.categoryId, group);
  }
  const titlesFor = (category: Category) => new Set([category.name, ...(hints.find(hint => hint.categoryId === category.id)?.titles || [])].map(normalizeTitle).filter(Boolean));
  const ordered = [...groups].sort((a, b) => a.id - b.id);
  // If the user has duplicate groups, select one deterministically without
  // merging their tabs. A name shared by multiple categories is ambiguous.
  for (const group of ordered) {
    if (used.has(group.id) || !group.title?.trim()) continue;
    const candidates = categories.filter(category => titlesFor(category).has(normalizeTitle(group.title!)));
    if (candidates.length === 1) add(candidates[0].id, group);
  }
  // Ambiguous names or groups already owned by another category must not cause
  // us to create another same-named group. The user can explicitly adopt one.
  const blocked = new Set<string>();
  for (const category of categories) {
    for (const group of groups) {
      const key = slot({ categoryId: category.id, windowId: group.windowId });
      if (!slots.has(key) && titlesFor(category).has(normalizeTitle(group.title || ''))) blocked.add(key);
    }
  }
  const nextHints = categories.map(category => {
    const liveTitles = bindings.filter(binding => binding.categoryId === category.id)
      .map(binding => groups.find(group => group.id === binding.groupId)?.title || '').filter(title => title.trim());
    const oldTitles = hints.find(hint => hint.categoryId === category.id)?.titles || [];
    // Keep absent titles too: Chrome can restore different windows at different
    // times. Cap the history to avoid unbounded storage from repeated renames.
    return { categoryId: category.id, titles: [...new Set([...liveTitles, ...oldTitles])].slice(0, 50) };
  });
  return { bindings, hints: nextHints, blocked };
}

// Group events, UI adoption and task mutations share one queue. A slow model
// call never holds this queue; reconciliation runs after its response arrives.
let queue: Promise<unknown> = Promise.resolve();
function exclusive<T>(operation: () => Promise<T>): Promise<T> {
  const result = queue.then(operation);
  queue = result.catch(() => {});
  return result;
}
async function synchronizeUnlocked() {
  const [config, previous, stored, groups, windows] = await Promise.all([
    readConfig(), readBindings(), chrome.storage.local.get(hintsKey),
    chrome.tabGroups.query({}), chrome.windows.getAll({ windowTypes: ['normal'] }),
  ]);
  const allowed = new Set(windows.filter(window => !window.incognito).map(window => window.id));
  const hints = hintsSchema.parse(stored[hintsKey] || []);
  const result = reconcileBindings(config.categories, groups.filter(group => allowed.has(group.windowId)), previous, hints);
  if (JSON.stringify(result.bindings) !== JSON.stringify(previous)) await writeBindings(result.bindings);
  if (JSON.stringify(result.hints) !== JSON.stringify(hints)) await chrome.storage.local.set({ [hintsKey]: result.hints });
  return result;
}
export function synchronizeBindings() { return exclusive(synchronizeUnlocked); }

export async function synchronizeBindingsOnStartup() {
  try { await synchronizeBindings(); }
  catch (error) {
    // Chrome may start the worker before any current window exists. Keep the
    // stored hints intact; group events and the next UI request reconcile again.
    if (!(error instanceof Error && /^No current window\.?$/.test(error.message))) throw error;
  }
}

export function saveCategories(categories: Category[]) {
  return exclusive(async () => {
    await writeConfig({ ...(await readConfig()), categories });
    await synchronizeUnlocked();
  });
}

export function adoptGroup(categoryId: string, groupId: number) {
  return exclusive(async () => {
    const group = await chrome.tabGroups.get(groupId);
    const window = await chrome.windows.get(group.windowId);
    if (window.incognito || window.type !== 'normal') throw new Error('只能接管普通窗口中的分组');
    if (!(await readConfig()).categories.some(category => category.id === categoryId)) throw new Error('分类不存在');
    const bindings = (await readBindings()).filter(binding => binding.groupId !== group.id && !(binding.categoryId === categoryId && binding.windowId === group.windowId));
    bindings.push({ categoryId, windowId: group.windowId, groupId: group.id });
    await writeBindings(bindings);
    await synchronizeUnlocked();
  });
}

export function applyToCategory(tab: TabSnapshot, category: Category, journal: (record: ApplyRecord) => Promise<void>) {
  return exclusive(async () => {
    const current = await synchronizeUnlocked();
    if (current.blocked.has(slot({ categoryId: category.id, windowId: tab.windowId })))
      throw new Error('现有分组名称与多个分类关联，请在“接管现有 Chrome 分组”中指定归属后重试');
    const binding = await applyGroup(tab, category, current.bindings, journal, chromeGroups, async () => {
      const latest = await synchronizeUnlocked();
      if (latest.blocked.has(slot({ categoryId: category.id, windowId: tab.windowId }))) throw new Error('分组关联有歧义，请手动接管后重试');
      return latest.bindings.find(binding => binding.categoryId === category.id && binding.windowId === tab.windowId)?.groupId;
    });
    const bindings = (await readBindings()).filter(existing => existing.groupId !== binding.groupId && slot(existing) !== slot(binding));
    bindings.push({ categoryId: binding.categoryId, windowId: binding.windowId, groupId: binding.groupId });
    await writeBindings(bindings);
    await synchronizeUnlocked();
    return binding;
  });
}

export function watchGroupChanges(ready: Promise<unknown>, reportError: (error: unknown) => void) {
  const changed = () => { void ready.then(() => synchronizeBindings()).catch(reportError); };
  chrome.tabGroups.onCreated.addListener(changed);
  chrome.tabGroups.onUpdated.addListener(changed);
  chrome.tabGroups.onRemoved.addListener(changed);
  chrome.tabGroups.onMoved.addListener(changed);
}

// Classify first, then apply one category/window together so small clusters never
// create a temporary one-tab group. Existing groups can receive a single tab.
export function applyCategoryBatch(tabs: TabSnapshot[], category: Category, journal: (records: ApplyRecord[]) => Promise<void>, signal?: AbortSignal) {
  return exclusive(async () => {
    const results = new Map<number, { status: 'applied' | 'skipped'; message?: string }>();
    if (!tabs.length) return results;
    const windowId = tabs[0].windowId;
    if (tabs.some(tab => tab.windowId !== windowId) || new Set(tabs.map(tab => tab.id)).size !== tabs.length)
      throw new Error('同一批归组必须来自同一窗口且标签不能重复');
    const target = async () => {
      const current = await synchronizeUnlocked();
      if (current.blocked.has(slot({ categoryId: category.id, windowId }))) throw new Error('分组关联有歧义，请手动接管后重试');
      return current.bindings.find(binding => binding.categoryId === category.id && binding.windowId === windowId)?.groupId;
    };
    const stillEligible = async (candidates: TabSnapshot[]) => {
      const valid: TabSnapshot[] = [];
      for (const tab of candidates) {
        try {
          if (unchanged(await chrome.tabs.get(tab.id), tab)) { valid.push(tab); continue; }
        } catch { /* A closed tab cannot participate in the group. */ }
        results.set(tab.id, { status: 'skipped', message: '标签已关闭或修改，保持用户操作' });
      }
      return valid;
    };
    const tooSmall = (candidates: TabSnapshot[], groupId?: number) => {
      if (groupId !== undefined && candidates.length) return false;
      if (candidates.length >= MIN_NEW_GROUP_TABS) return false;
      for (const tab of candidates) results.set(tab.id, { status: 'skipped', message: `同窗口仅 ${candidates.length} 个匹配标签，少于 ${MIN_NEW_GROUP_TABS} 个，暂不新建分组` });
      return true;
    };
    signal?.throwIfAborted();
    let groupId = await target();
    let candidates = await stillEligible(tabs);
    if (tooSmall(candidates, groupId)) return results;
    await journal(candidates.map(tab => ({ tab, targetGroupId: groupId ?? -1, applied: false })));
    const latest = await target();
    if (groupId !== undefined && groupId !== latest) throw new Error('目标分组已改变，请重新更新分组');
    if (latest !== groupId) {
      groupId = latest;
      await journal(candidates.map(tab => ({ tab, targetGroupId: groupId ?? -1, applied: false })));
    }
    // Recheck after journal writes: navigation/closure must not count toward three.
    candidates = await stillEligible(candidates);
    if (tooSmall(candidates, groupId)) return results;
    signal?.throwIfAborted();
    const created = groupId === undefined;
    const tabIds = candidates.map(tab => tab.id) as [number, ...number[]];
    groupId = await chrome.tabs.group({ tabIds, ...(created ? { createProperties: { windowId } } : { groupId }) });
    await journal(candidates.map(tab => ({ tab, targetGroupId: groupId!, applied: true })));
    let warning: string | undefined;
    if (created) {
      try { await chromeGroups.nameGroup(groupId, category); }
      catch { warning = '标签已归组，但名称设置失败，可在 Chrome 中手动重命名'; }
    }
    const bindings = (await readBindings()).filter(binding => binding.groupId !== groupId && slot(binding) !== slot({ categoryId: category.id, windowId }));
    bindings.push({ categoryId: category.id, windowId, groupId });
    await writeBindings(bindings); await synchronizeUnlocked();
    for (const tab of candidates) results.set(tab.id, { status: 'applied', message: warning });
    return results;
  });
}
