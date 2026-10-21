import type { IgnoredTab, Settings, TabSnapshot } from '../shared/schemas';

export function snapshot(tab: chrome.tabs.Tab): TabSnapshot {
  if (tab.id === undefined) throw new Error('标签信息不可用');
  return { id: tab.id, windowId: tab.windowId, url: tab.url || '', title: tab.title || '', groupId: tab.groupId, index: tab.index };
}
export function eligible(tab: chrome.tabs.Tab, ignored: IgnoredTab[]): boolean {
  return tab.id !== undefined && !tab.incognito && !tab.pinned && tab.groupId === -1
    && /^https?:\/\//i.test(tab.url || '') && !ignored.some(item => item.id === tab.id && item.url === tab.url);
}
export async function collectTabs(settings: Settings, windowId: number, ignored: IgnoredTab[]) {
  const tabs = await chrome.tabs.query({ windowType: 'normal', ...(settings.scope === 'current' ? { windowId } : {}) });
  return tabs.filter(tab => eligible(tab, ignored)).map(snapshot);
}
export function unchanged(current: chrome.tabs.Tab, original: TabSnapshot): boolean {
  return current.id === original.id && current.url === original.url && !current.pendingUrl
    && current.title === original.title && current.windowId === original.windowId && current.groupId === original.groupId && !current.pinned;
}
