import type { ApplyRecord, Binding, Category, TabSnapshot } from '../shared/schemas';
import { unchanged } from '../browser/tabs';

export interface GroupPort {
  getTab(id: number): Promise<chrome.tabs.Tab>;
  getGroup(id: number): Promise<{ windowId: number }>;
  group(tabId: number, groupId: number | undefined, windowId: number): Promise<number>;
  nameGroup(id: number, category: Category): Promise<void>;
  ungroup(id: number): Promise<void>;
  move(id: number, index: number): Promise<void>;
}
export const chromeGroups: GroupPort = {
  getTab: id => chrome.tabs.get(id), getGroup: id => chrome.tabGroups.get(id),
  group: (tabId, groupId, windowId) => chrome.tabs.group({ tabIds: [tabId], ...(groupId === undefined ? { createProperties: { windowId } } : { groupId }) }),
  nameGroup: async (id, category) => { await chrome.tabGroups.update(id, { title: category.name, color: category.color }); },
  ungroup: id => chrome.tabs.ungroup(id), move: async (id, index) => { await chrome.tabs.move(id, { index }); },
};

export async function applyGroup(tab: TabSnapshot, category: Category, bindings: Binding[], journal: (record: ApplyRecord) => Promise<void>, port = chromeGroups, refreshTarget?: () => Promise<number | undefined>): Promise<Binding & { warning?: string }> {
  if (!unchanged(await port.getTab(tab.id), tab)) throw new Error('标签已被修改，跳过本次分组');
  let groupId = bindings.find(binding => binding.categoryId === category.id && binding.windowId === tab.windowId)?.groupId;
  if (groupId !== undefined) {
    // Never fall back to creation after a concurrent deletion/move. A fresh
    // update will reconcile any replacement group before trying again.
    try { if ((await port.getGroup(groupId)).windowId !== tab.windowId) throw new Error('moved'); }
    catch { throw new Error('目标分组已删除或移动，请重新更新分组'); }
  }
  // A write-ahead record lets recovery identify a partially applied item.
  await journal({ tab, targetGroupId: groupId ?? -1, applied: false });
  if (refreshTarget) {
    const latest = await refreshTarget();
    if (groupId !== undefined && latest !== groupId) throw new Error('目标分组已改变，请重新更新分组');
    if (latest !== groupId) {
      groupId = latest;
      await journal({ tab, targetGroupId: groupId ?? -1, applied: false });
    }
  }
  // Recheck after asynchronous storage/group lookups, immediately before mutation.
  if (!unchanged(await port.getTab(tab.id), tab)) throw new Error('标签已被修改，跳过本次分组');
  const created = groupId === undefined;
  groupId = await port.group(tab.id, groupId, tab.windowId);
  await journal({ tab, targetGroupId: groupId, applied: true });
  let warning: string | undefined;
  if (created) {
    try { await port.nameGroup(groupId, category); }
    catch { warning = '标签已归组，但组名称设置失败，可在 Chrome 中手动重命名'; }
  }
  return { categoryId: category.id, windowId: tab.windowId, groupId, ...(warning ? { warning } : {}) };
}

export async function undoRecord(record: ApplyRecord, port = chromeGroups): Promise<boolean> {
  if (!record.applied || record.undone) return false;
  let current: chrome.tabs.Tab;
  try { current = await port.getTab(record.tab.id); } catch { return false; }
  if (current.url !== record.tab.url || current.pendingUrl || current.windowId !== record.tab.windowId || current.groupId !== record.targetGroupId || current.pinned) return false;
  await port.ungroup(record.tab.id);
  // Index restoration is best effort; a closed window or simultaneous user edit can prevent it.
  try { await port.move(record.tab.id, record.tab.index); } catch { /* Membership has already been restored. */ }
  record.undone = true;
  return true;
}
