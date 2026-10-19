import { describe, expect, it, vi } from 'vitest';
import { decide } from '../src/grouping/decision-policy';
import { applyGroup, chromeGroups, undoRecord, type GroupPort } from '../src/grouping/apply';
import { eligible } from '../src/browser/tabs';
import { category, secondCategory, settings, tab } from './fixtures';
import type { ApplyRecord } from '../src/shared/schemas';

const chromeTab = (patch: Partial<chrome.tabs.Tab> = {}) => ({ ...tab, pinned: false, incognito: false, ...patch }) as chrome.tabs.Tab;
function port(): GroupPort {
  return { getTab: vi.fn().mockResolvedValue(chromeTab()), getGroup: vi.fn().mockResolvedValue({ windowId: 10 }),
    group: vi.fn().mockResolvedValue(100), nameGroup: vi.fn().mockResolvedValue(undefined), ungroup: vi.fn().mockResolvedValue(undefined), move: vi.fn().mockResolvedValue(undefined) };
}
describe('classification policy', () => {
  it('allows clear matches, rejects ambiguous choices, and preserves explicit abstention', () => {
    const answer = { choice: 'dev', probabilities: { dev: 0.94, travel: 0.04, none: 0.02 }, confidence: 0.9, model: 'mock' };
    expect(decide(answer, [category, secondCategory], settings).categoryId).toBe('dev');
    expect(decide({ ...answer, probabilities: { dev: 0.51, travel: 0.48, none: 0.01 } }, [category, secondCategory], settings).status).toBe('uncertain');
    expect(decide({ ...answer, choice: 'none' }, [category], settings).status).toBe('unmatched');
    expect(decide({ ...answer, choice: 'none' }, [category], settings).message).toContain('没有合适分类或页面信息不足');
  });
  it('excludes grouped, pinned, incognito, internal, and explicitly ignored tabs', () => {
    for (const patch of [{ groupId: 3 }, { pinned: true }, { incognito: true }, { url: 'chrome://settings' }]) expect(eligible(chromeTab(patch), [])).toBe(false);
    expect(eligible(chromeTab(), [{ id: 1, url: tab.url }])).toBe(false);
    expect(eligible(chromeTab(), [{ id: 1, url: 'https://old.example' }])).toBe(true);
  });
});
describe('Chrome group operations (mock API)', () => {
  it('creates a group only when no valid per-window binding exists, journals both stages', async () => {
    const api = port(); const journal = vi.fn().mockResolvedValue(undefined);
    const binding = await applyGroup(tab, category, [{ categoryId: 'dev', windowId: 99, groupId: 50 }], journal, api);
    expect(api.group).toHaveBeenCalledWith(1, undefined, 10);
    expect(api.nameGroup).toHaveBeenCalledWith(100, category);
    expect(binding).toEqual({ categoryId: 'dev', windowId: 10, groupId: 100 });
    expect(journal.mock.calls.map(call => call[0].applied)).toEqual([false, true]);
  });
  it('joins a valid existing group without renaming it', async () => {
    const api = port();
    await applyGroup(tab, category, [{ categoryId: 'dev', windowId: 10, groupId: 50 }], async () => {}, api);
    expect(api.group).toHaveBeenCalledWith(1, 50, 10);
    expect(api.nameGroup).not.toHaveBeenCalled();
  });
  it('skips tabs changed while the request was running or during journaling', async () => {
    const api = port();
    vi.mocked(api.getTab).mockResolvedValueOnce(chromeTab()).mockResolvedValueOnce(chromeTab({ groupId: 99 }));
    await expect(applyGroup(tab, category, [], async () => {}, api)).rejects.toThrow('已被修改');
    expect(api.group).not.toHaveBeenCalled();
  });
  it('undo does not overwrite later user changes', async () => {
    const api = port();
    const record: ApplyRecord = { tab, targetGroupId: 100, applied: true };
    vi.mocked(api.getTab).mockResolvedValue(chromeTab({ groupId: 200 }));
    expect(await undoRecord(record, api)).toBe(false);
    expect(api.ungroup).not.toHaveBeenCalled();
    vi.mocked(api.getTab).mockResolvedValue(chromeTab({ groupId: 100 }));
    expect(await undoRecord(record, api)).toBe(true);
    expect(api.move).toHaveBeenCalledWith(1, 3);
    expect(await undoRecord(record, api)).toBe(false);
  });
  it('explicitly creates new groups in the source window, never Chrome current-window default', async () => {
    const group = vi.fn().mockResolvedValue(100);
    vi.stubGlobal('chrome', { tabs: { group } });
    await chromeGroups.group(7, undefined, 99);
    expect(group).toHaveBeenCalledWith({ tabIds: [7], createProperties: { windowId: 99 } });
    await chromeGroups.group(8, 100, 99);
    expect(group).toHaveBeenLastCalledWith({ tabIds: [8], groupId: 100 });
  });
});
