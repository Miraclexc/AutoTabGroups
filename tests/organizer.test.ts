import { beforeEach, describe, expect, it, vi } from 'vitest';
import { settings as fixtureSettings } from './fixtures';
import type { Category, PageInput, Settings, TabSnapshot } from '../src/shared/schemas';
import type { OrganizeTask } from '../src/shared/organizer';
const model = vi.hoisted(() => ({ classify: vi.fn(), propose: vi.fn(), describe: vi.fn(), read: vi.fn() }));
vi.mock('../src/ai/providers/classifier', () => ({ createClassifier: () => ({ classify: model.classify }) }));
vi.mock('../src/ai/providers/generator', () => ({ proposeGroups: model.propose }));
vi.mock('../src/ai/providers/description', () => ({ describeNativeGroup: model.describe }));
vi.mock('../src/browser/injection', () => ({ readPage: model.read }));
import { Organizer, classificationKey } from '../src/workflows/organizer';
import { createController } from '../src/workflows/controller';
import { CACHE, getDecision, putDecision, readJournal, readOrganizerTask, workspace } from '../src/storage/workspace';
import { currentShape, sampleMembers, syncNativeGroups } from '../src/grouping/native';
import { snapshot } from '../src/browser/tabs';

let local: Record<string, unknown>, session: Record<string, unknown>;
let tabs: chrome.tabs.Tab[], groups: chrome.tabGroups.TabGroup[], nextGroup: number;
let settings: Settings;
let groupCall: ReturnType<typeof vi.fn>;
let failStorage: string | undefined;
function tab(id: number, groupId = -1, windowId = 10) {
  return { id, groupId, windowId, title: `Page ${id}`, url: `https://example.com/${id}`, index: id, active: id === 1, pinned: false, incognito: false, status: 'complete' } as chrome.tabs.Tab;
}
function group(id: number, title = '开发', windowId = 10) {
  return { id, title, windowId, color: 'blue', collapsed: false } as chrome.tabGroups.TabGroup;
}
function storage(data: Record<string, unknown>) {
  return {
    get: vi.fn(async (keys: string | string[]) => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).filter(k => k in data).map(k => [k, structuredClone(data[k])]))),
    set: vi.fn(async (patch: Record<string, unknown>) => {
      if (failStorage && failStorage in patch) { failStorage = undefined; throw new Error('模拟存储失败'); }
      Object.assign(data, structuredClone(patch));
    }),
    remove: vi.fn(async (keys: string | string[]) => { for (const k of Array.isArray(keys) ? keys : [keys]) delete data[k]; }),
  };
}
function removeEmpty() { groups = groups.filter(g => tabs.some(t => t.groupId === g.id)); }
beforeEach(() => {
  vi.clearAllMocks();
  settings = { ...fixtureSettings, classifierUseChat: false };
  local = { 'config.v1': { settings, categories: [] }, 'credentials.v1': { generator: 'g-key', classifier: 'c-key' } };
  session = {}; tabs = [tab(1), tab(2), tab(3)]; groups = []; nextGroup = 100; failStorage = undefined;
  groupCall = vi.fn(async (arg: { groupId?: number; createProperties?: { windowId: number }; tabIds: number[] }) => {
    const id = arg.groupId ?? nextGroup++;
    if (arg.groupId !== undefined && !groups.some(g => g.id === id)) throw new Error('group missing');
    if (arg.groupId === undefined) groups.push(group(id, '', arg.createProperties!.windowId));
    for (const idTab of arg.tabIds) tabs.find(t => t.id === idTab)!.groupId = id;
    removeEmpty(); return id;
  });
  vi.stubGlobal('chrome', {
    storage: { local: storage(local), session: storage(session) },
    tabs: {
      query: vi.fn(async (query: { windowId?: number; groupId?: number } = {}) => structuredClone(tabs.filter(t => (query.windowId === undefined || t.windowId === query.windowId) && (query.groupId === undefined || t.groupId === query.groupId)))),
      get: vi.fn(async (id: number) => { const t = tabs.find(t => t.id === id); if (!t) throw new Error('closed'); return structuredClone(t); }),
      group: groupCall,
      ungroup: vi.fn(async (id: number) => { tabs.find(t => t.id === id)!.groupId = -1; removeEmpty(); }),
      move: vi.fn(async (id: number, move: { index: number }) => { tabs.find(t => t.id === id)!.index = move.index; }),
      update: vi.fn(async (id: number, patch: Partial<chrome.tabs.Tab>) => Object.assign(tabs.find(t => t.id === id)!, patch)),
    },
    tabGroups: {
      query: vi.fn(async (q: { windowId?: number } = {}) => structuredClone(groups.filter(g => q.windowId === undefined || g.windowId === q.windowId))),
      get: vi.fn(async (id: number) => { const g = groups.find(g => g.id === id); if (!g) throw new Error('group missing'); return structuredClone(g); }),
      update: vi.fn(async (id: number, patch: Partial<chrome.tabGroups.TabGroup>) => Object.assign(groups.find(g => g.id === id)!, patch)),
    },
    windows: { get: vi.fn(async (id: number) => ({ id, type: 'normal', incognito: false })), update: vi.fn().mockResolvedValue({}) },
    alarms: { create: vi.fn().mockResolvedValue(undefined), clear: vi.fn().mockResolvedValue(true) },
    action: { setBadgeText: vi.fn().mockResolvedValue(undefined), setTitle: vi.fn().mockResolvedValue(undefined) },
  });
  model.read.mockImplementation(async (snapshot: TabSnapshot): Promise<PageInput> => ({ title: snapshot.title, url: snapshot.url, description: 'page metadata', extraction: 'metadata', truncated: false }));
  model.describe.mockResolvedValue('开发文档与技术资料');
  model.classify.mockImplementation(async (_page: PageInput, categories: Category[]) => ({
    choice: categories[0].id, confidence: 1, model: 'mock', scoreSource: 'decision_probability',
    probabilities: Object.fromEntries([...categories.map((c, i) => [c.id, i === 0 ? 0.98 : 0]), ['none', 0.02]]),
  }));
  model.propose.mockImplementation(async (pages: { tabId: number }[]) => [
    { id: 'new_dev', name: '新开发', description: '技术资料', color: 'blue', include: [], exclude: [], tabIds: pages.map(p => p.tabId) },
  ]);
});
async function done(runner: Organizer) { await vi.waitFor(() => expect(runner.busy).toBe(false)); return (await readOrganizerTask())!; }
function existing(id = 22, name = '开发') { groups.push(group(id, name)); tabs.push(tab(50 + id, id)); }

describe('three native-group workflows', () => {
  it('single page never creates a group in an empty window', async () => {
    const runner = new Organizer();
    await expect(runner.start('organize-current', 10, 1)).rejects.toThrow('没有分组');
    expect(model.classify).not.toHaveBeenCalled(); expect(model.propose).not.toHaveBeenCalled(); expect(groupCall).not.toHaveBeenCalled();
  });
  it.each(['organize-window', 'organize-window-with-new'] as const)('%s initializes an empty window without a draft approval', async action => {
    const runner = new Organizer(); await runner.start(action, 10); const task = await done(runner);
    expect(task.status).toBe('completed'); expect(task.items.every(i => i.status === 'applied')).toBe(true);
    expect(groups).toHaveLength(1); expect(groups[0].title).toBe('新开发');
    expect(model.propose).toHaveBeenCalledTimes(1); expect((await readJournal())?.records).toHaveLength(3);
  });
  it.each([1, 2])('does not propose or create groups for %s pages', async count => {
    tabs = tabs.slice(0, count);
    const runner = new Organizer(); await runner.start('organize-window', 10); const result = await done(runner);
    expect(model.propose).not.toHaveBeenCalled(); expect(groupCall).not.toHaveBeenCalled();
    expect(result.items.every(item => item.message === `当前仅有 ${count} 页可用于新建分组；自动建组至少需要 3 页，可手动建组。`)).toBe(true);
  });
  it('ordinary batch describes external groups then only joins existing groups', async () => {
    existing();
    const runner = new Organizer(); await runner.start('organize-window', 10); const result = await done(runner);
    expect(result.allowNew).toBe(false); expect(model.describe).toHaveBeenCalledTimes(1);
    expect(model.propose).not.toHaveBeenCalled(); expect(groups).toHaveLength(1);
    expect(groupCall.mock.calls.every(c => c[0].groupId === 22)).toBe(true);
    expect(model.classify).toHaveBeenCalledTimes(3);
  });
  it('single-page existing target permits one addition', async () => {
    existing(); const runner = new Organizer();
    await runner.start('organize-current', 10, 1); await done(runner);
    expect(tabs.find(t => t.id === 1)?.groupId).toBe(22);
    expect(tabs.find(t => t.id === 2)?.groupId).toBe(-1); expect(model.classify).toHaveBeenCalledTimes(1);
  });
  it('already-grouped navigation, new group members and A-to-B changes never enter classification', async () => {
    existing(22); existing(23, '旅行');
    tabs[0].groupId = 22; tabs[0].url = 'https://example.com/navigated';
    tabs[1].groupId = 23; tabs.push(tab(90, 22));
    const runner = new Organizer(); await runner.start('organize-window', 10); await done(runner);
    expect(model.classify).toHaveBeenCalledTimes(1);
    expect(model.classify.mock.calls[0][0].url).toBe('https://example.com/3');
    expect(tabs[1].groupId).toBe(23);
  });
  it('Alt+1 equivalent on a grouped tab does not even generate descriptions', async () => {
    existing(); tabs[0].groupId = 22;
    await expect(new Organizer().start('organize-current', 10, 1)).rejects.toThrow('已在分组');
    expect(model.describe).not.toHaveBeenCalled(); expect(model.classify).not.toHaveBeenCalled();
  });
  it('other windows and historical definitions are not active targets', async () => {
    groups.push(group(22, 'Other', 20)); tabs.push(tab(90, 22, 20));
    (local['config.v1'] as { categories: Category[] }).categories = [{ id: 'old', name: 'Old', description: 'Old definition', color: 'blue', include: [], exclude: [] }];
    const runner = new Organizer(); await runner.start('organize-window', 10); const result = await done(runner);
    expect(result.creationReason).toBe('empty-window'); expect(tabs.find(t => t.id === 90)?.groupId).toBe(22);
    expect(groups.filter(g => g.windowId === 10)).toHaveLength(1);
  });
  it('description failure does not hide a live group or enable creation', async () => {
    existing(); model.describe.mockRejectedValue(new Error('description failed'));
    const runner = new Organizer(); await runner.start('organize-window', 10); const result = await done(runner);
    expect(result.status).toBe('failed'); expect(result.allowNew).toBe(false);
    expect(model.classify).not.toHaveBeenCalled(); expect(model.propose).not.toHaveBeenCalled(); expect(groupCall).not.toHaveBeenCalled();
  });
  it('explicit creation first joins existing and only then plans unmatched pages', async () => {
    existing(); tabs.push(tab(4));
    model.classify.mockImplementation(async (page: PageInput, categories: Category[]) => {
      const choice = page.url.endsWith('/1') ? categories[0].id : categories.find(c => c.id === 'new_dev')?.id || 'none';
      return { choice, confidence: 1, model: 'mock', probabilities: Object.fromEntries([...categories.map(c => [c.id, c.id === choice ? 1 : 0]), ['none', choice === 'none' ? 1 : 0]]) };
    });
    const runner = new Organizer(); await runner.start('organize-window-with-new', 10); await done(runner);
    expect(model.propose.mock.calls[0][0].map((p: { tabId: number }) => p.tabId)).toEqual([2, 3, 4]);
    expect(groupCall.mock.invocationCallOrder[0]).toBeLessThan(model.propose.mock.invocationCallOrder[0]);
    expect(groups).toHaveLength(2);
  });
  it('same-named native groups are separate candidates without guessed shared descriptions', async () => {
    existing(22); existing(23);
    const views = await syncNativeGroups(10);
    expect(new Set(views.map(g => g.profileId)).size).toBe(2);
    expect(new Set(views.map(g => g.id)).size).toBe(2);
  });
  it('deleted existing target is not recreated even during allowed-new runs', async () => {
    existing();
    model.classify.mockImplementation(async () => {
      groups = []; tabs = tabs.filter(t => t.groupId === -1);
      return { choice: 'g_22', confidence: 1, model: 'mock', probabilities: { g_22: 1, none: 0 } };
    });
    const runner = new Organizer(); await runner.start('organize-window', 10); const result = await done(runner);
    expect(result.allowNew).toBe(false); expect(groupCall).not.toHaveBeenCalled(); expect(groups).toHaveLength(0);
  });
  it('user grouping during a model call wins over the response', async () => {
    existing();
    model.classify.mockImplementation(async () => {
      tabs[0].groupId = 22;
      return { choice: 'g_22', confidence: 1, model: 'mock', probabilities: { g_22: 1, none: 0 } };
    });
    const runner = new Organizer(); await runner.start('organize-current', 10, 1); const task = await done(runner);
    expect(groupCall).not.toHaveBeenCalled(); expect(task.items[0].status).toBe('skipped');
  });
  it('recounts members after final classification and never creates a two-page group', async () => {
    model.classify.mockImplementation(async (_page: PageInput, categories: Category[]) => {
      if (_page.url.endsWith('/3')) tabs = tabs.filter(t => t.id !== 1);
      return { choice: categories[0].id, confidence: 1, model: 'mock', probabilities: { [categories[0].id]: 1, none: 0 } };
    });
    const runner = new Organizer(); await runner.start('organize-window', 10); await done(runner);
    expect(groupCall).not.toHaveBeenCalled();
  });
});

describe('execution state notifications', () => {
  it.each(['completed', 'cancelled', 'failed'] as const)('publishes idle after delayed feedback for a %s task', async status => {
    existing();
    const transitions: boolean[] = [];
    const runner = new Organizer(() => { transitions.push(runner.busy); });
    let finishFeedback!: () => void;
    vi.mocked(chrome.action.setTitle).mockImplementation(() => new Promise<void>(resolve => { finishFeedback = resolve; }));
    if (status === 'cancelled') model.classify.mockImplementation((_p: unknown, _c: unknown, signal: AbortSignal) =>
      new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason))));
    if (status === 'failed') model.classify.mockRejectedValue(new Error('HTTP 401'));
    await runner.start('organize-current', 10, 1);
    if (status === 'cancelled') {
      await vi.waitFor(() => expect(model.classify).toHaveBeenCalled());
      await runner.cancel();
    }
    await vi.waitFor(() => expect(chrome.action.setTitle).toHaveBeenCalled());
    expect((await readOrganizerTask())?.status).toBe(status);
    expect(runner.busy).toBe(true);
    expect(transitions).toEqual([true]);
    await expect(runner.exclusive(async () => 'too early')).rejects.toThrow('已有任务');
    finishFeedback(); await done(runner);
    expect(transitions).toEqual([true, false]);
    await expect(runner.exclusive(async () => 'ready')).resolves.toBe('ready');
    expect(transitions).toEqual([true, false, true, false]);
  });
  it('releases and notifies when a final browser feedback API fails', async () => {
    existing();
    const transitions: boolean[] = [];
    const runner = new Organizer(() => { transitions.push(runner.busy); });
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      vi.mocked(chrome.action.setTitle).mockRejectedValue(new Error('Browser feedback unavailable'));
      await runner.start('organize-current', 10, 1); const result = await done(runner);
      expect(result.status).toBe('completed'); expect(tabs[0].groupId).toBe(22);
      expect(transitions).toEqual([true, false]);
      await expect(runner.exclusive(async () => true)).resolves.toBe(true);
    } finally { logged.mockRestore(); }
  });
  it('notifies for exclusive failure, rejected start and empty recovery without clearing another operation lock', async () => {
    const transitions: boolean[] = [];
    const runner = new Organizer(() => { transitions.push(runner.busy); });
    await expect(runner.exclusive(async () => { throw new Error('save failed'); })).rejects.toThrow('save failed');
    await expect(runner.start('organize-current', 10, 1)).rejects.toThrow('没有分组');
    await runner.recover();
    expect(transitions).toEqual([true, false, true, false, true, false]);
    let release!: () => void;
    const pending = runner.exclusive(() => new Promise<void>(resolve => { release = resolve; }));
    await runner.recover();
    await expect(runner.start('organize-current', 10, 1)).rejects.toThrow('已有任务');
    expect(runner.busy).toBe(true); expect(transitions.at(-1)).toBe(true);
    release(); await pending; expect(transitions.at(-1)).toBe(false);
  });
  it.each(['throw', 'reject'] as const)('a notification that %s does not fail an operation or retain the lock', async mode => {
    const runner = new Organizer(() => {
      if (mode === 'throw') throw new Error('UI closed');
      return Promise.reject(new Error('No receiver'));
    });
    await expect(runner.exclusive(async () => 'saved')).resolves.toBe('saved');
    await expect(runner.exclusive(async () => { throw new Error('operation failed'); })).rejects.toThrow('operation failed');
    expect(runner.busy).toBe(false);
  });
});

describe('cache and model-free display', () => {
  it('state refresh and group changes do not call AI', async () => {
    existing();
    const handle = createController(new Organizer());
    await handle({ type: 'workspace-state', windowId: 10 });
    tabs.push(tab(99, 22)); groups[0].title = 'Changed';
    await handle({ type: 'workspace-state', windowId: 10 });
    expect(model.describe).not.toHaveBeenCalled(); expect(model.classify).not.toHaveBeenCalled();
  });
  it('dragging a classified page out reuses its cache beyond one hour', async () => {
    existing(); const runner = new Organizer();
    await runner.start('organize-current', 10, 1); await done(runner);
    tabs[0].groupId = -1;
    const cache = session[CACHE] as Record<string, { at: number }>;
    Object.values(cache).forEach(value => { value.at = 0; });
    await runner.start('organize-current', 10, 1); const result = await done(runner);
    expect(model.classify).toHaveBeenCalledTimes(1); expect(result.items[0].cached).toBe(true);
    expect(model.describe).toHaveBeenCalledTimes(1);
  });
  it('threshold changes reuse raw scores but change the execution decision', async () => {
    existing(); const runner = new Organizer();
    await runner.start('organize-current', 10, 1); await done(runner);
    tabs[0].groupId = -1;
    const config = local['workspace.v2'] as { settings: Settings }; config.settings.minProbability = 1;
    await runner.start('organize-current', 10, 1); const result = await done(runner);
    expect(result.items[0].status).toBe('uncertain'); expect(model.classify).toHaveBeenCalledTimes(1);
  });
  it('changed candidate descriptions invalidate cached classification', async () => {
    const page = { title: 'x', url: 'https://example.com', description: '', extraction: 'metadata' as const, truncated: false };
    const candidates = [{ id: 'g1', name: 'dev', description: 'old', color: 'blue' as const, include: [], exclude: [] }];
    const before = await classificationKey(page, candidates, settings);
    candidates[0].description = 'new';
    expect(await classificationKey(page, candidates, settings)).not.toBe(before);
  });
  it('malformed entries are cache misses and capacity remains bounded', async () => {
    session[CACHE] = { bad: { broken: true } };
    expect(await getDecision('bad')).toBeNull();
    for (let i = 0; i < 305; i++) await putDecision(String(i), { choice: 'none', probabilities: { none: 1 }, confidence: 1, model: 'm' });
    expect(Object.keys(session[CACHE] as object)).toHaveLength(300);
    expect(await getDecision('304')).not.toBeNull();
  });
  it('uses evenly spaced samples of at most five members', () => {
    expect(sampleMembers([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10])).toEqual([0, 3, 5, 8, 10]);
  });
});

describe('journals, cancellation, migration and configuration', () => {
  it('no-op and failed jobs keep the last effective undo', async () => {
    existing(); const runner = new Organizer();
    await runner.start('organize-current', 10, 1); await done(runner); const original = await readJournal();
    await expect(runner.start('organize-current', 10, 1)).rejects.toThrow();
    model.classify.mockRejectedValue(new Error('HTTP 401'));
    await runner.start('organize-current', 10, 2); await done(runner);
    expect(await readJournal()).toEqual(original);
  });
  it('manual small groups work without models and undo restores membership', async () => {
    const runner = new Organizer(), handle = createController(runner);
    await handle({ type: 'create-manual', windowId: 10, tabs: [snapshot(tabs[0])], value: { name: 'One', color: 'green', description: '' } });
    expect(groups).toHaveLength(1); expect(model.classify).not.toHaveBeenCalled();
    await handle({ type: 'undo' }); expect(tabs[0].groupId).toBe(-1); expect(groups).toHaveLength(0);
  });
  it('manual reassignment can restore the source group removed by moving its last member', async () => {
    groups = [group(22, 'A'), group(23, 'B')]; tabs = [tab(1, 22), tab(2, 23)];
    const handle = createController(new Organizer());
    await handle({ type: 'move-manual', tab: snapshot(tabs[0]), groupId: 23 });
    expect(groups.some(g => g.id === 22)).toBe(false);
    await handle({ type: 'undo' });
    expect(groups.find(g => g.id === tabs[0].groupId)?.title).toBe('A'); expect(tabs[1].groupId).toBe(23);
  });
  it('undo skips a page subsequently navigated or manually regrouped', async () => {
    existing(); const runner = new Organizer(); await runner.start('organize-window', 10); await done(runner);
    tabs[0].url = 'https://example.com/changed'; tabs[1].groupId = -1;
    await createController(runner)({ type: 'undo' });
    expect(tabs[0].groupId).toBe(22); expect(tabs[1].groupId).toBe(-1); expect(tabs[2].groupId).toBe(-1);
  });
  it('cancels a pending model call before any native mutation', async () => {
    existing();
    model.classify.mockImplementation((_p: unknown, _c: unknown, signal: AbortSignal) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason))));
    const runner = new Organizer(); await runner.start('organize-window', 10);
    await vi.waitFor(() => expect(model.classify).toHaveBeenCalled());
    await runner.cancel(); const result = await done(runner);
    expect(result.status).toBe('cancelled'); expect(groupCall).not.toHaveBeenCalled();
  });
  it('same-session recovery applies a persisted classification without another request', async () => {
    existing(); const config = await workspace(); const targets = await syncNativeGroups(10);
    session.sessionId = 'same';
    const task: OrganizeTask = { version: 2, id: 'resume', sessionId: 'same', windowId: 10, action: 'organize-window', source: 'sidebar', status: 'running', stage: 'apply-existing', createdAt: 1,
      allowNew: false, settings: config.settings, initialGroups: await currentShape(10), targets, items: [{ tab: snapshot(tabs[0]), status: 'read', categoryId: targets[0].id }], journal: [] };
    local['organizer.task.v2'] = task;
    const runner = new Organizer(); await runner.recover(); await done(runner);
    expect(tabs[0].groupId).toBe(22); expect(model.classify).not.toHaveBeenCalled();
  });
  it('cross-session recovery never replays old IDs', async () => {
    local['organizer.task.v2'] = { version: 2, id: 'old', sessionId: 'other', status: 'running', items: [], journal: [] };
    const runner = new Organizer(); await runner.recover();
    expect((await readOrganizerTask())?.status).toBe('interrupted'); expect(groupCall).not.toHaveBeenCalled();
  });
  it('recovers a committed mutation when writing the task checkpoint failed afterward', async () => {
    existing(); const config = await workspace(); const targets = await syncNativeGroups(10);
    const original = snapshot(tabs[0]); tabs[0].groupId = 22; session.sessionId = 'same';
    local['organizer.undo.v2'] = { id: 'resume', sessionId: 'same', windowId: 10, createdAt: 1, records: [{ tab: original, targetGroupId: 22, applied: true }] };
    local['organizer.task.v2'] = { version: 2, id: 'resume', sessionId: 'same', windowId: 10, action: 'organize-window', source: 'sidebar', status: 'running', stage: 'apply-existing', createdAt: 1,
      allowNew: false, settings: config.settings, initialGroups: await currentShape(10), targets, items: [{ tab: original, status: 'read', categoryId: targets[0].id }], journal: [] };
    const runner = new Organizer(); await runner.recover(); const result = await done(runner);
    expect(result.items[0].status).toBe('applied'); expect(groupCall).not.toHaveBeenCalled(); expect(model.classify).not.toHaveBeenCalled();
  });
  it('migrates definitions and semantic hints without overwriting legacy data or credentials', async () => {
    const raw = { settings: { ...settings, scope: 'all', classifierUseChat: false }, categories: [{ id: 'old', name: 'Old', description: 'Description', color: 'blue', include: ['positive'], exclude: ['negative'] }] };
    local['config.v1'] = raw;
    const result = await workspace();
    expect(result.settings.scope).toBe('current'); expect(result.settings.classifier.backend).toBe(settings.classifier.backend);
    expect(result.profiles[0].description).toContain('positive'); expect(result.profiles[0].id).toBe('old');
    expect(local['config.v1']).toEqual(raw); expect(local['credentials.v1']).toEqual({ generator: 'g-key', classifier: 'c-key' });
  });
  it('migration failure keeps old data instead of saving empty defaults', async () => {
    local['config.v1'] = { invalid: true };
    await expect(workspace()).rejects.toThrow();
    expect(local['workspace.v2']).toBeUndefined(); expect(local['config.v1']).toEqual({ invalid: true });
  });
  it('testing drafts does not save settings or keys', async () => {
    const before = structuredClone(local);
    const handle = createController(new Organizer());
    await handle({ type: 'test-config', provider: 'generator', settings: { ...settings, generator: { ...settings.generator, model: 'draft' } }, generatorKey: 'draft-secret' });
    expect(local).toEqual(before); expect(model.describe.mock.calls[0][3]).toBe('draft-secret');
  });
  it('failed config write preserves both config and keys, and revision conflicts are rejected', async () => {
    const config = await workspace(); const before = structuredClone(local);
    const handle = createController(new Organizer()); failStorage = 'workspace.v2';
    await expect(handle({ type: 'save-config', settings, revision: config.revision, generatorKey: 'new-key' })).rejects.toThrow();
    expect(local).toEqual(before);
    await expect(handle({ type: 'save-config', settings, revision: 999 })).rejects.toThrow('其他页面');
  });
  it('backup never exports credentials or native identifiers and import never groups tabs', async () => {
    existing(); await syncNativeGroups(10);
    const handle = createController(new Organizer());
    const data = await handle({ type: 'export-config' });
    expect(JSON.stringify(data)).not.toMatch(/g-key|c-key|nativeId|windowId|tabIds/);
    const config = await workspace();
    await handle({ type: 'import-config', data, revision: config.revision });
    expect(groupCall).not.toHaveBeenCalled(); expect(model.describe).not.toHaveBeenCalled();
  });
});


describe('reader configuration integration', () => {
  it('stores independent reader keys atomically, preserves blanks and excludes them from exports', async () => {
    const api = createController(new Organizer()); const config = await workspace();
    await api({ type: 'save-config', settings: config.settings, revision: config.revision, readerKeys: { tavily: 'tavily-secret', deepseek: 'deepseek-secret' } });
    const next = await workspace();
    await api({ type: 'save-config', settings: next.settings, revision: next.revision, readerKeys: { tavily: '' } });
    expect(local['credentials.v1']).toMatchObject({ tavily: '', deepseek: 'deepseek-secret' });
    expect(JSON.stringify(await api({ type: 'export-config' }))).not.toContain('deepseek-secret');
    const state = await api({ type: 'workspace-state', windowId: 10 });
    expect(state).toMatchObject({ hasReaderKeys: { tavily: false, deepseek: true } });
    expect(JSON.stringify(state)).not.toContain('deepseek-secret');
  });
  it('tests reader drafts without saving, reading real tabs, or hiding errors through fallback', async () => {
    const api = createController(new Organizer()); const config = await workspace(); const before = JSON.stringify(local);
    const draft = structuredClone(config.settings); draft.readContent = true; draft.reader.provider = 'deepseek';
    const fetcher = vi.fn().mockResolvedValue(Response.json({ title: 'Example', content: 'Example Domain' })); vi.stubGlobal('fetch', fetcher);
    await api({ type: 'test-reader', settings: draft, readerKeys: { deepseek: 'draft-reader-key' } });
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ url: 'https://example.com/' });
    expect(model.read).not.toHaveBeenCalled(); expect(JSON.stringify(local)).toBe(before);
    fetcher.mockResolvedValue(Response.json({ error: 'no access' }, { status: 403 }));
    await expect(api({ type: 'test-reader', settings: draft, readerKeys: { deepseek: 'draft-reader-key' } })).rejects.toThrow('HTTP 403');
  });
});
