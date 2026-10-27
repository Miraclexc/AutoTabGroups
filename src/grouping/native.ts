import { AppError } from '../shared/errors';
import { snapshot } from '../browser/tabs';
import { readPage } from '../browser/injection';
import { ReaderError } from '../extraction/remote';
import { describeNativeGroup } from '../ai/providers/description';
import { mutateWorkspace, workspace } from '../storage/workspace';
import type { GroupProfile, GroupShape, GroupView, NativeTarget } from '../shared/organizer';
import type { Settings } from '../shared/schemas';
import type { OutputLocale } from '../ai/prompts/output-language';

interface Link { nativeId: number; profileId: string; windowId: number }
const LINK_KEY = 'organizer.links.v2';
let syncQueue: Promise<unknown> = Promise.resolve();
const normalize = (s: string) => s.normalize('NFC').trim().toLowerCase();
export async function normalWindow(windowId: number) {
  const win = await chrome.windows.get(windowId);
  if (win.type !== 'normal' || win.incognito) throw new AppError('messages.only_normal_non_incognito_windows_can_be_organized');
}
export function shape(groups: Pick<chrome.tabGroups.TabGroup, 'id' | 'windowId' | 'title'>[]): GroupShape[] {
  return groups.map(g => ({ id: g.id, windowId: g.windowId, title: g.title || '' })).sort((a, b) => a.id - b.id);
}
export const sameShape = (a: GroupShape[], b: GroupShape[]) => JSON.stringify(a) === JSON.stringify(b);
export async function currentShape(windowId: number) { return shape(await chrome.tabGroups.query({ windowId })); }

export function syncNativeGroups(windowId: number): Promise<GroupView[]> {
  const operation = syncQueue.then(async () => {
    await normalWindow(windowId);
    let config = await workspace();
    const [native, tabs, stored] = await Promise.all([
      chrome.tabGroups.query({ windowId }), chrome.tabs.query({ windowId }),
      chrome.storage.session.get(LINK_KEY),
    ]);
    const previous = (stored[LINK_KEY] || []) as Link[];
    const next: Link[] = previous.filter(l => l.windowId !== windowId);
    const additions: GroupProfile[] = [];
    const updates = new Map<string, GroupProfile>();
    const used = new Set<string>();
    for (const group of native) {
      const live = previous.find(l => l.nativeId === group.id);
      let profile = config.profiles.find(p => p.id === live?.profileId && !used.has(p.id));
      if (!profile) {
        const matches = config.profiles.filter(p => !used.has(p.id) && [p.name, ...p.titles].some(n => normalize(n) && normalize(n) === normalize(group.title || '')));
        const duplicateNames = native.filter(g => normalize(g.title || '') === normalize(group.title || '')).length > 1;
        if (matches.length === 1 && !duplicateNames) profile = matches[0];
      }
      if (!profile) {
        profile = { id: crypto.randomUUID(), name: group.title || '', color: group.color, description: '', titles: [], source: 'generated' };
        additions.push(profile);
      } else if (profile.name !== (group.title || '') || profile.color !== group.color) {
        profile = { ...profile, name: group.title || '', color: group.color, titles: [...new Set([profile.name, ...profile.titles])].filter(Boolean).slice(0, 50) };
        updates.set(profile.id, profile);
      }
      used.add(profile.id);
      next.push({ nativeId: group.id, profileId: profile.id, windowId });
    }
    if (additions.length || updates.size) {
      config = await mutateWorkspace(current => ({ ...current,
        profiles: [...current.profiles.map(p => updates.has(p.id) ? { ...p, name: updates.get(p.id)!.name, color: updates.get(p.id)!.color, titles: updates.get(p.id)!.titles } : p), ...additions] }));
    }
    if (JSON.stringify(previous) !== JSON.stringify(next)) await chrome.storage.session.set({ [LINK_KEY]: next });
    return native.map(group => {
      const profile = config.profiles.find(p => p.id === next.find(l => l.nativeId === group.id)!.profileId)!;
      return {
        id: `g_${group.id}`, nativeId: group.id, windowId, profileId: profile.id,
        name: group.title || '', color: group.color, description: profile.description,
        include: [], exclude: [], source: profile.source, sampleCount: profile.sampleCount,
        members: tabs.filter(t => t.groupId === group.id && t.id !== undefined && t.url).map(snapshot),
      };
    });
  });
  syncQueue = operation.catch(() => {});
  return operation;
}
export async function attachProfile(groupId: number, windowId: number, value: Pick<GroupProfile, 'name' | 'description' | 'color' | 'source'>) {
  // Synchronization may have observed a newly created native group first: update its profile instead of duplicating it.
  const view = (await syncNativeGroups(windowId)).find(g => g.nativeId === groupId);
  if (!view) throw new AppError('messages.the_group_has_been_closed');
  await mutateWorkspace(current => ({ ...current, profiles: current.profiles.map(p => p.id === view.profileId ? { ...p, ...value } : p) }));
  return view.profileId;
}
export function sampleMembers<T>(members: T[], limit = 5): T[] {
  if (members.length <= limit) return members;
  return Array.from({ length: limit }, (_, i) => members[Math.round(i * (members.length - 1) / (limit - 1))]);
}
export async function groupDescription(group: GroupView, settings: Settings, apiKey: string, signal?: AbortSignal, locale: OutputLocale = 'zh-CN') {
  const pages = [];
  for (const member of sampleMembers([...group.members].sort((a, b) => a.index - b.index))) {
    signal?.throwIfAborted();
    try { pages.push(await readPage(member, settings, signal)); } catch (error) {
      signal?.throwIfAborted();
      if (error instanceof ReaderError) throw error;
      // Removed members do not supply stale context.
    }
  }
  const description = await describeNativeGroup(group.name, pages, settings, apiKey, signal, locale);
  const latest = await chrome.tabGroups.get(group.nativeId);
  if (latest.windowId !== group.windowId || (latest.title || '') !== group.name) throw new AppError('messages.the_group_changed_while_generating_its_description_please_retry');
  const members = await chrome.tabs.query({ groupId: group.nativeId });
  const before = group.members.map(t => `${t.id}:${t.url}`).sort().join('\n');
  const after = members.map(t => `${t.id}:${t.url}`).sort().join('\n');
  if (before !== after) throw new AppError('messages.group_members_changed_while_generating_the_description_please_retry');
  return { description, sampleCount: pages.length };
}
export async function prepareTargets(windowId: number, settings: Settings, apiKey: string, signal?: AbortSignal, locale: OutputLocale = 'zh-CN'): Promise<NativeTarget[]> {
  const groups = await syncNativeGroups(windowId);
  for (const group of groups) {
    signal?.throwIfAborted();
    if (group.description.trim()) continue;
    const result = await groupDescription(group, settings, apiKey, signal, locale);
    signal?.throwIfAborted();
    await mutateWorkspace(current => ({ ...current, profiles: current.profiles.map(p => {
      if (p.id !== group.profileId) return p;
      if (p.description.trim()) throw new AppError('messages.the_description_was_edited_elsewhere_please_retry');
      return { ...p, ...result, source: 'generated' };
    }) }));
    group.description = result.description;
  }
  return groups.map(({ members: _members, source: _source, sampleCount: _count, ...target }) => target);
}
