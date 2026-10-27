import { AppError } from '../shared/errors';
import { msg, type UserMessage } from '../i18n';
import { unchanged } from '../browser/tabs';
import { sessionId } from '../storage/repository';
import { clearPending, commitJournal, pendingJournal, readJournal, workspace, writePending } from '../storage/workspace';
import { attachProfile, normalWindow, syncNativeGroups } from './native';
import type { Journal, Mutation, OriginalGroup } from '../shared/organizer';
import type { Category, TabSnapshot } from '../shared/schemas';

export type WriteRecords = (records: Mutation[]) => Promise<void>;
export async function validTabs(tabs: TabSnapshot[]): Promise<TabSnapshot[]> {
  const valid: TabSnapshot[] = [];
  for (const tab of tabs) {
    try { if (unchanged(await chrome.tabs.get(tab.id), tab)) valid.push(tab); } catch { /* Closed. */ }
  }
  return valid;
}
export async function joinExisting(tabs: TabSnapshot[], groupId: number, write: WriteRecords, signal?: AbortSignal) {
  if (!tabs.length) return [];
  const windowId = tabs[0].windowId;
  if (tabs.some(t => t.windowId !== windowId || t.groupId !== -1)) throw new AppError('messages.automatic_grouping_only_handles_ungrouped_tabs_in_the_same');
  const target = await chrome.tabGroups.get(groupId);
  if (target.windowId !== windowId) throw new AppError('messages.the_target_group_has_moved_to_another_window');
  let valid = await validTabs(tabs);
  if (!valid.length) return [];
  await write(valid.map(tab => ({ tab, targetGroupId: groupId, applied: false })));
  valid = await validTabs(valid);
  const latest = await chrome.tabGroups.get(groupId);
  if (latest.windowId !== windowId || latest.title !== target.title) throw new AppError('messages.the_target_group_has_changed_start_a_new_task');
  signal?.throwIfAborted();
  if (!valid.length) return [];
  await chrome.tabs.group({ groupId, tabIds: valid.map(t => t.id) as [number, ...number[]] });
  await write(valid.map(tab => ({ tab, targetGroupId: groupId, applied: true })));
  return valid.map(t => t.id);
}
export async function createNative(tabs: TabSnapshot[], category: Pick<Category, 'name' | 'description' | 'color'>, minimum: number, write: WriteRecords, signal?: AbortSignal, validate?: () => Promise<void>) {
  if (!tabs.length || new Set(tabs.map(t => t.windowId)).size !== 1 || tabs.some(t => t.groupId !== -1) || new Set(tabs.map(t => t.id)).size !== tabs.length)
    throw new AppError('messages.choose_ungrouped_tabs_in_this_window');
  const windowId = tabs[0].windowId;
  await normalWindow(windowId);
  let valid = await validTabs(tabs);
  if (valid.length < minimum) return { ids: [] as number[], groupId: undefined, warning: msg('task.fewerMembers', { minimum }) };
  await write(valid.map(tab => ({ tab, targetGroupId: -1, applied: false })));
  await validate?.();
  valid = await validTabs(valid);
  signal?.throwIfAborted();
  if (valid.length < minimum) return { ids: [] as number[], groupId: undefined, warning: msg('task.fewerMembers', { minimum }) };
  const groupId = await chrome.tabs.group({ createProperties: { windowId }, tabIds: valid.map(t => t.id) as [number, ...number[]] });
  await write(valid.map(tab => ({ tab, targetGroupId: groupId, applied: true })));
  let warning: UserMessage | undefined;
  try {
    await chrome.tabGroups.update(groupId, { title: category.name, color: category.color });
    await attachProfile(groupId, windowId, { ...category, source: minimum === 1 ? 'user' : 'generated' });
  } catch { warning = msg('task.groupSaveFailed'); }
  return { ids: valid.map(t => t.id), groupId, warning };
}
export function journalWriter(journal: Journal, after?: (records: Mutation[]) => Promise<void>): WriteRecords {
  return async records => {
    const ids = new Set(records.map(r => r.tab.id));
    journal.records = [...journal.records.filter(r => !ids.has(r.tab.id)), ...records];
    await writePending(journal);
    if (journal.records.some(r => r.applied)) await commitJournal(journal);
    await after?.(journal.records);
  };
}
export async function moveManually(tab: TabSnapshot, groupId: number, write: WriteRecords) {
  await normalWindow(tab.windowId);
  if (!unchanged(await chrome.tabs.get(tab.id), tab)) throw new AppError('messages.the_tab_has_changed_select_it_again');
  if (tab.groupId === groupId) return;
  const target = await chrome.tabGroups.get(groupId);
  if (target.windowId !== tab.windowId) throw new AppError('messages.choose_a_group_in_the_current_window');
  let originalGroup: OriginalGroup | undefined;
  if (tab.groupId !== -1) {
    const original = await chrome.tabGroups.get(tab.groupId);
    const members = await chrome.tabs.query({ groupId: tab.groupId });
    const profileId = (await syncNativeGroups(tab.windowId)).find(g => g.nativeId === original.id)?.profileId;
    originalGroup = { id: original.id, title: original.title || '', color: original.color, collapsed: original.collapsed, profileId, removedByOperation: members.length === 1 };
  }
  const record: Mutation = { tab, targetGroupId: groupId, applied: false, originalGroup };
  await write([record]);
  if (!unchanged(await chrome.tabs.get(tab.id), tab)) throw new AppError('messages.the_tab_has_changed_select_it_again');
  const latest = await chrome.tabGroups.get(groupId);
  if (latest.windowId !== tab.windowId || latest.title !== target.title) throw new AppError('messages.the_target_group_has_changed');
  await chrome.tabs.group({ groupId, tabIds: [tab.id] });
  if (originalGroup) originalGroup.removedByOperation = !!originalGroup.removedByOperation
    && !(await chrome.tabGroups.get(originalGroup.id).catch(() => null));
  await write([{ ...record, applied: true }]);
}
export async function undoLatest() {
  const journal = await readJournal();
  if (!journal) throw new AppError('messages.there_are_no_grouping_changes_to_undo');
  if (journal.sessionId !== await sessionId()) throw new AppError('messages.changes_from_a_previous_browser_session_cannot_be_undone');
  await normalWindow(journal.windowId);
  let count = 0;
  for (const record of [...journal.records].reverse()) {
    if (!record.applied || record.undone) continue;
    let tab: chrome.tabs.Tab;
    try { tab = await chrome.tabs.get(record.tab.id); } catch { continue; }
    if (tab.url !== record.tab.url || tab.pendingUrl || tab.pinned || tab.windowId !== record.tab.windowId || tab.groupId !== record.targetGroupId) continue;
    if (record.originalGroup) {
      const original = record.originalGroup;
      let groupId = original.restoredId ?? original.id;
      const source = await chrome.tabGroups.get(groupId).catch(() => null);
      if (source && (source.windowId !== journal.windowId || source.title !== original.title || source.color !== original.color)) continue;
      if (!source) {
        if (!original.removedByOperation) continue;
        groupId = await chrome.tabs.group({ createProperties: { windowId: journal.windowId }, tabIds: [tab.id!] });
        original.restoredId = groupId;
        await commitJournal(journal);
        await chrome.tabGroups.update(groupId, { title: original.title, color: original.color, collapsed: original.collapsed });
        const profile = (await workspace()).profiles.find(p => p.id === original.profileId);
        if (profile) await attachProfile(groupId, journal.windowId, profile);
      } else await chrome.tabs.group({ groupId, tabIds: [tab.id!] });
    } else await chrome.tabs.ungroup(tab.id!);
    record.undone = true;
    await commitJournal(journal);
    try { await chrome.tabs.move(tab.id!, { index: record.tab.index }); } catch { /* Membership restored; index is best effort. */ }
    count++;
  }
  journal.message = msg('undo.finished', { count });
  await commitJournal(journal);
  return journal.message;
}
export async function recoverPending() {
  const pending = await pendingJournal();
  if (!pending) return;
  if (pending.sessionId === await sessionId() && pending.records.some(r => r.applied)) {
    const current = await readJournal();
    if (!current || current.createdAt <= pending.createdAt) await commitJournal(pending);
  }
  // Unconfirmed native writes are deliberately not replayed. The task recovery
  // rechecks membership and reports affected items instead of taking ownership.
  await clearPending();
}
