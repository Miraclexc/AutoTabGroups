import { beforeEach, describe, expect, it, vi } from 'vitest';
import { adoptGroup, applyCategoryBatch, applyToCategory, reconcileBindings, saveCategories, synchronizeBindings, synchronizeBindingsOnStartup, watchGroupChanges, type NativeGroup } from '../src/grouping/bindings';
import { category, secondCategory, settings, tab } from './fixtures';
import type { ApplyRecord, Binding } from '../src/shared/schemas';

const native = (id = 50, windowId = 10, title = category.name): NativeGroup => ({ id, windowId, title });
const binding = (groupId = 50, windowId = 10): Binding => ({ categoryId: category.id, windowId, groupId });

describe('group reconciliation', () => {
  it('recovers from new native IDs in multiple windows using names, not old IDs', () => {
    const result = reconcileBindings([category], [native(101, 20), native(202, 30)], [], []);
    expect(result.bindings).toEqual([binding(101, 20), binding(202, 30)]);
  });
  it('keeps live manually renamed/moved groups and drops deleted bindings', () => {
    const result = reconcileBindings([category, secondCategory], [native(50, 20, '我的开发项目')], [binding(), { categoryId: secondCategory.id, windowId: 10, groupId: 60 }], []);
    expect(result.bindings).toEqual([binding(50, 20)]);
    expect(result.hints[0].titles).toContain('我的开发项目');
  });
  it('matches remembered adopted titles after restart and retains hints during delayed restoration', () => {
    const hints = [{ categoryId: category.id, titles: ['手动命名'] }];
    const empty = reconcileBindings([category], [], [], hints);
    expect(empty.hints).toEqual(hints);
    expect(reconcileBindings([category], [native(99, 40, '手动命名')], [], empty.hints).bindings).toEqual([binding(99, 40)]);
  });
  it('reuses a deterministic duplicate, prefers a live binding, and never merges groups', () => {
    const groups = [native(80), native(50)];
    expect(reconcileBindings([category], groups, [], []).bindings).toEqual([binding(50)]);
    expect(reconcileBindings([category], groups, [binding(80)], []).bindings).toEqual([binding(80)]);
    expect(groups).toHaveLength(2);
  });
  it('does not guess ambiguous names or allow another duplicate to be created', () => {
    const hints = [{ categoryId: secondCategory.id, titles: [category.name] }];
    const result = reconcileBindings([category, secondCategory], [native()], [], hints);
    expect(result.bindings).toEqual([]);
    expect([...result.blocked].sort()).toEqual(['dev:10', 'travel:10']);
    const adopted = reconcileBindings([category, secondCategory], [native()], [binding()], hints);
    expect(adopted.bindings).toEqual([binding()]);
    expect([...adopted.blocked]).toEqual(['travel:10']);
  });
  it('ignores unnamed and unrelated user groups and removes hints of deleted categories', () => {
    const result = reconcileBindings([category], [native(1, 10, ''), native(2, 10, '未分类项目')], [], [{ categoryId: 'deleted', titles: ['未分类项目'] }]);
    expect(result.bindings).toEqual([]);
    expect(result.hints).toEqual([{ categoryId: category.id, titles: [] }]);
  });
  it('normalizes whitespace, case and Unicode without guessing similar names', () => {
    const named = { ...category, name: 'Café' };
    expect(reconcileBindings([named], [native(1, 10, ' CAFE\u0301 ')], [], []).bindings).toEqual([binding(1)]);
    expect(reconcileBindings([category], [native(1, 10, '插件开发计划')], [], []).bindings).toEqual([]);
  });
});

let local: Record<string, unknown>;
let session: Record<string, unknown>;
let groups: NativeGroup[];
let tabs: chrome.tabs.Tab[];
let api: ReturnType<typeof mockChrome>;
function area(data: () => Record<string, unknown>) {
  return {
    get: vi.fn(async (key: string) => structuredClone({ [key]: data()[key] })),
    set: vi.fn(async (patch: Record<string, unknown>) => { Object.assign(data(), structuredClone(patch)); }),
  };
}
function event() {
  const listeners: (() => void)[] = [];
  return { addListener: vi.fn((listener: () => void) => { listeners.push(listener); }), emit: () => listeners.forEach(listener => listener()) };
}
function mockChrome() {
  return {
    storage: { local: area(() => local), session: area(() => session) },
    windows: { getAll: vi.fn(async () => [{ id: 10, incognito: false }, { id: 20, incognito: false }]), get: vi.fn(async () => ({ type: 'normal', incognito: false })) },
    tabGroups: {
      query: vi.fn(async () => structuredClone(groups)),
      get: vi.fn(async (id: number) => { const group = groups.find(group => group.id === id); if (!group) throw new Error('missing'); return { ...group }; }),
      update: vi.fn(async (id: number, patch: object) => { Object.assign(groups.find(group => group.id === id)!, patch); }),
      onCreated: event(), onUpdated: event(), onRemoved: event(), onMoved: event(),
    },
    tabs: {
      get: vi.fn(async (id: number) => ({ ...tabs.find(tab => tab.id === id)! })),
      group: vi.fn(async ({ tabIds, groupId, createProperties }: { tabIds: number[]; groupId?: number; createProperties?: { windowId: number } }) => {
        if (groupId === undefined) { groupId = 500 + groups.length; groups.push(native(groupId, createProperties!.windowId, '')); }
        if (!groups.some(group => group.id === groupId)) throw new Error('group removed');
        tabs.filter(tab => tabIds.includes(tab.id!)).forEach(tab => { tab.groupId = groupId!; });
        return groupId;
      }),
    },
  };
}
beforeEach(() => {
  local = { 'config.v1': { categories: [category], settings } }; session = {};
  groups = [native()]; tabs = [{ ...tab, incognito: false, pinned: false } as chrome.tabs.Tab];
  api = mockChrome(); vi.stubGlobal('chrome', api);
});

describe('binding storage, events and mutations with mock Chrome', () => {
  it('defers startup reconciliation without losing hints if Chrome has no current window yet', async () => {
    local['groupHints.v1'] = [{ categoryId: category.id, titles: ['自定义开发'] }];
    api.tabGroups.query.mockRejectedValueOnce(new Error('No current window'));
    await synchronizeBindingsOnStartup();
    expect(local['groupHints.v1']).toEqual([{ categoryId: category.id, titles: ['自定义开发'] }]);
    groups = [native(99, 10, '自定义开发')];
    await synchronizeBindings();
    expect(session.bindings).toEqual([binding(99)]);
    api.tabGroups.query.mockRejectedValueOnce(new Error('permission failure'));
    await expect(synchronizeBindingsOnStartup()).rejects.toThrow('permission failure');
  });
  it('persists only name hints, survives session clearing and ignores reused IDs', async () => {
    await synchronizeBindings();
    groups[0].title = '自定义开发'; await synchronizeBindings();
    session = {}; groups = [native(50, 10, '无关组'), native(90, 20, '自定义开发')];
    await synchronizeBindings();
    expect(session.bindings).toEqual([binding(90, 20)]);
    expect(local['groupHints.v1']).toEqual([{ categoryId: category.id, titles: ['自定义开发', category.name] }]);
    expect(JSON.stringify(local['groupHints.v1'])).not.toMatch(/groupId|windowId/);
  });
  it('handles late restoration, manual creation/deletion/rename/move events without any model calls', async () => {
    groups = []; watchGroupChanges(Promise.resolve(), error => { throw error; });
    groups.push(native()); api.tabGroups.onCreated.emit();
    await vi.waitFor(() => expect(session.bindings).toEqual([binding()]));
    groups[0].title = '我的项目'; api.tabGroups.onUpdated.emit();
    await vi.waitFor(() => expect(JSON.stringify(local['groupHints.v1'])).toContain('我的项目'));
    groups[0].windowId = 20; api.tabGroups.onMoved.emit();
    await vi.waitFor(() => expect(session.bindings).toEqual([binding(50, 20)]));
    groups = []; api.tabGroups.onRemoved.emit();
    await vi.waitFor(() => expect(session.bindings).toEqual([]));
    expect(api.tabs.group).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });
  it('does not write unchanged state, preventing storage/UI feedback loops', async () => {
    await synchronizeBindings(); api.storage.local.set.mockClear(); api.storage.session.set.mockClear();
    await Promise.all([synchronizeBindings(), synchronizeBindings(), synchronizeBindings()]);
    expect(api.storage.local.set).not.toHaveBeenCalled(); expect(api.storage.session.set).not.toHaveBeenCalled();
  });
  it('excludes private and non-normal windows', async () => {
    groups = [native(1, 99), native(2, 30)];
    api.windows.getAll.mockResolvedValue([{ id: 10, incognito: false }, { id: 99, incognito: true }]);
    await synchronizeBindings(); expect(session.bindings || []).toEqual([]);
  });
  it('explicit adoption remembers custom names; deleting the category drops only metadata', async () => {
    groups = [native(50, 10, '自定义')]; await adoptGroup(category.id, 50);
    expect(session.bindings).toEqual([binding()]);
    session = {}; await synchronizeBindings(); expect(session.bindings).toEqual([binding()]);
    await saveCategories([]);
    expect(session.bindings).toEqual([]); expect(local['groupHints.v1']).toEqual([]);
    expect(groups).toEqual([native(50, 10, '自定义')]);
  });
  it('reuses a group created by the user while the classifier was running', async () => {
    const journal = vi.fn();
    await applyToCategory(tab, category, journal);
    expect(api.tabs.group).toHaveBeenCalledWith({ tabIds: [1], groupId: 50 });
    expect(api.tabGroups.update).not.toHaveBeenCalled(); expect(groups).toHaveLength(1);
    expect(journal.mock.calls.at(-1)?.[0].targetGroupId).toBe(50);
  });
  it('detects a new matching group created during journaling and does not rename it', async () => {
    groups = [];
    const records: ApplyRecord[] = [];
    await applyToCategory(tab, category, async record => {
      records.push(record);
      if (records.length === 1) groups.push(native(70));
    });
    expect(api.tabs.group).toHaveBeenCalledWith({ tabIds: [1], groupId: 70 });
    expect(api.tabGroups.update).not.toHaveBeenCalled(); expect(groups).toHaveLength(1);
    expect(records.map(record => [record.targetGroupId, record.applied])).toEqual([[-1, false], [70, false], [70, true]]);
  });
  it('defers a deleted target during journaling instead of recreating it from stale state', async () => {
    await expect(applyToCategory(tab, category, async () => { groups = []; })).rejects.toThrow('目标分组已改变');
    expect(api.tabs.group).not.toHaveBeenCalled();
  });
  it('removes stale bindings and reuses a user replacement; creates only on explicit update if none remains', async () => {
    await synchronizeBindings(); groups = [native(60)];
    await applyToCategory(tab, category, async () => {});
    expect(api.tabs.group).toHaveBeenLastCalledWith({ tabIds: [1], groupId: 60 });
    groups = []; tabs[0].groupId = -1;
    await synchronizeBindings(); expect(groups).toEqual([]);
    await applyToCategory(tab, category, async () => {});
    expect(api.tabs.group).toHaveBeenLastCalledWith({ tabIds: [1], createProperties: { windowId: 10 } });
    expect(groups[0].title).toBe(category.name);
  });
  it('serializes concurrent reconciliation and application without losing the new binding', async () => {
    groups = [];
    await Promise.all([applyToCategory(tab, category, async () => {}), synchronizeBindings(), synchronizeBindings()]);
    expect(groups).toHaveLength(1); expect(session.bindings).toEqual([binding(500)]);
  });
  it('blocks ambiguous restoration rather than creating a duplicate and releases the queue after failure', async () => {
    local['config.v1'] = { categories: [category, secondCategory], settings };
    local['groupHints.v1'] = [{ categoryId: secondCategory.id, titles: [category.name] }];
    await expect(applyToCategory(tab, category, async () => {})).rejects.toThrow('指定归属');
    expect(api.tabs.group).not.toHaveBeenCalled();
    await adoptGroup(category.id, 50);
    await applyToCategory(tab, category, async () => {});
    expect(groups).toHaveLength(1);
  });
});

describe('minimum size for new groups (mock Chrome)', () => {
  const candidates = (count: number) => {
    const snapshots = Array.from({ length: count }, (_, i) => ({ ...tab, id: i + 1 }));
    tabs = snapshots.map(snapshot => ({ ...snapshot, pinned: false, incognito: false } as chrome.tabs.Tab));
    return snapshots;
  };
  it.each([1, 2])('leaves %s matches ungrouped when no group exists', async count => {
    groups = [];
    const result = await applyCategoryBatch(candidates(count), category, async () => {});
    expect([...result.values()].every(item => item.status === 'skipped')).toBe(true);
    expect(api.tabs.group).not.toHaveBeenCalled(); expect(groups).toHaveLength(0);
  });
  it('creates all three members in one Chrome call with recoverable batch journals', async () => {
    groups = [];
    const journal = vi.fn();
    const result = await applyCategoryBatch(candidates(3), category, journal);
    expect(api.tabs.group).toHaveBeenCalledExactlyOnceWith({ tabIds: [1, 2, 3], createProperties: { windowId: 10 } });
    expect([...result.values()].map(item => item.status)).toEqual(['applied', 'applied', 'applied']);
    expect(journal.mock.calls.map(call => call[0].map((record: ApplyRecord) => record.applied))).toEqual([[false, false, false], [true, true, true]]);
    expect(groups[0].title).toBe(category.name);
  });
  it('adds a single match to an existing group without renaming it', async () => {
    const result = await applyCategoryBatch(candidates(1), category, async () => {});
    expect(result.get(1)?.status).toBe('applied');
    expect(api.tabs.group).toHaveBeenCalledWith({ tabIds: [1], groupId: 50 });
    expect(api.tabGroups.update).not.toHaveBeenCalled();
  });
  it('does not count tabs closed or manually grouped during the journal write', async () => {
    groups = [];
    const result = await applyCategoryBatch(candidates(3), category, async () => { tabs[2].groupId = 99; });
    expect([...result.values()].every(item => item.status === 'skipped')).toBe(true);
    expect(result.get(1)?.message).toContain('仅 2 个');
    expect(api.tabs.group).not.toHaveBeenCalled();
  });
  it('still creates a group if three valid tabs remain after a closure', async () => {
    groups = [];
    await applyCategoryBatch(candidates(4), category, async records => { if (!records[0].applied) tabs.pop(); });
    expect(api.tabs.group).toHaveBeenCalledWith({ tabIds: [1, 2, 3], createProperties: { windowId: 10 } });
  });
  it('reuses a group created during the journal write', async () => {
    groups = [];
    await applyCategoryBatch(candidates(3), category, async () => { if (!groups.length) groups.push(native(70)); });
    expect(api.tabs.group).toHaveBeenCalledWith({ tabIds: [1, 2, 3], groupId: 70 });
    expect(api.tabGroups.update).not.toHaveBeenCalled();
  });
  it('does not recreate a deleted target or mutate after cancellation', async () => {
    await expect(applyCategoryBatch(candidates(3), category, async () => { groups = []; })).rejects.toThrow('目标分组已改变');
    expect(api.tabs.group).not.toHaveBeenCalled();
    const controller = new AbortController();
    await expect(applyCategoryBatch(candidates(3), category, async () => { controller.abort(); }, controller.signal)).rejects.toThrow();
    expect(api.tabs.group).not.toHaveBeenCalled();
  });
  it('rejects cross-window or duplicate members rather than counting them toward three', async () => {
    const snapshots = candidates(3);
    await expect(applyCategoryBatch([snapshots[0], snapshots[1], { ...snapshots[2], windowId: 20 }], category, async () => {})).rejects.toThrow('同一窗口');
    await expect(applyCategoryBatch([snapshots[0], snapshots[0], snapshots[1]], category, async () => {})).rejects.toThrow('不能重复');
    expect(api.tabs.group).not.toHaveBeenCalled();
  });
});
