import { beforeEach, describe, expect, it, vi } from 'vitest';
import { category, draft, page, settings, tab } from './fixtures';
import type { ApplyRecord, Classification, TaskRecord } from '../src/shared/schemas';

const mocks = vi.hoisted(() => ({
  readConfig: vi.fn(), readTask: vi.fn(), writeTask: vi.fn(), readKeys: vi.fn(), sessionId: vi.fn(),
  readBindings: vi.fn(), writeBindings: vi.fn(), readIgnored: vi.fn(), cachedDecision: vi.fn(), cacheDecision: vi.fn(), fingerprint: vi.fn(),
  collectTabs: vi.fn(), readPage: vi.fn(), classify: vi.fn(), generate: vi.fn(), applyGroup: vi.fn(), undoRecord: vi.fn(),
}));
vi.mock('../src/storage/repository', () => mocks);
vi.mock('../src/browser/tabs', () => ({ collectTabs: mocks.collectTabs }));
vi.mock('../src/browser/injection', () => ({ readPage: mocks.readPage }));
vi.mock('../src/ai/providers/classifier', () => ({ createClassifier: () => ({ classify: mocks.classify }) }));
vi.mock('../src/ai/providers/generator', () => ({ createGenerator: () => ({ generate: mocks.generate }) }));
vi.mock('../src/grouping/apply', () => ({ applyGroup: mocks.applyGroup, undoRecord: mocks.undoRecord }));
vi.mock('../src/grouping/bindings', () => ({ applyCategoryBatch: mocks.applyGroup }));
import { TaskRunner } from '../src/workflows/task-runner';

let saved: TaskRecord | null;
const classified: Classification = { choice: 'dev', confidence: 0.95, model: 'mock', probabilities: { dev: 0.96, none: 0.04 } };
beforeEach(() => {
  vi.clearAllMocks(); saved = null;
  vi.stubGlobal('chrome', { alarms: { create: vi.fn().mockResolvedValue(undefined), clear: vi.fn().mockResolvedValue(true) } });
  mocks.readConfig.mockResolvedValue({ settings, categories: [category] });
  mocks.readTask.mockImplementation(async () => saved && structuredClone(saved));
  mocks.writeTask.mockImplementation(async task => { saved = structuredClone(task); });
  mocks.readKeys.mockResolvedValue({ generator: 'mock-key', classifier: 'mock-key' });
  mocks.sessionId.mockResolvedValue('session-1'); mocks.readBindings.mockResolvedValue([]); mocks.readIgnored.mockResolvedValue([]);
  mocks.cachedDecision.mockResolvedValue(null); mocks.fingerprint.mockResolvedValue('hash'); mocks.cacheDecision.mockResolvedValue(undefined);
  mocks.writeBindings.mockResolvedValue(undefined); mocks.collectTabs.mockResolvedValue([tab]); mocks.readPage.mockResolvedValue(page);
  mocks.classify.mockResolvedValue(classified); mocks.generate.mockResolvedValue([draft]);
  mocks.applyGroup.mockImplementation(async (snapshots, _category, journal: (records: ApplyRecord[]) => Promise<void>) => {
    await journal(snapshots.map((snapshot: typeof tab) => ({ tab: snapshot, targetGroupId: 22, applied: true })));
    return new Map(snapshots.map((snapshot: typeof tab) => [snapshot.id, { status: 'applied' }]));
  });
});
async function complete(runner: TaskRunner) { await vi.waitFor(() => expect(runner.busy).toBe(false)); }

describe('background workflows with mock models', () => {
  it('updates matching tabs and persists undo with only a bounded page excerpt and no keys', async () => {
    mocks.readPage.mockResolvedValue({ ...page, content: '正文内容'.repeat(100) + 'FULL_BODY_TAIL', extraction: 'readability' });
    const runner = new TaskRunner();
    await runner.start('update', 10); await complete(runner);
    expect(saved?.status).toBe('completed'); expect(saved?.items[0].status).toBe('applied');
    expect(saved?.undo).toHaveLength(1); expect(mocks.applyGroup).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(saved)).not.toContain('mock-key');
    expect(saved?.items[0].preview).toBe('正文内容'.repeat(40).slice(0, 159) + '…');
    expect(JSON.stringify(saved)).not.toContain('FULL_BODY_TAIL');
    expect(saved?.items[0].candidates).toEqual([{ categoryId: category.id, name: category.name, color: category.color, score: 0.96 }]);
    expect(saved?.items[0].scoreSource).toBe('decision_probability');
  });
  it('retains failed records in the denominator and continues processing', async () => {
    mocks.collectTabs.mockResolvedValue([tab, { ...tab, id: 2 }, { ...tab, id: 3 }]);
    mocks.classify.mockRejectedValueOnce(new Error('Mock timeout')).mockResolvedValueOnce({ ...classified, choice: 'none' }).mockResolvedValueOnce(classified);
    const runner = new TaskRunner(); await runner.start('update', 10); await complete(runner);
    expect(saved?.items.map(item => item.status)).toEqual(['failed', 'unmatched', 'applied']);
    expect(saved?.items).toHaveLength(3); expect(mocks.applyGroup).toHaveBeenCalledTimes(1);
  });
  it('generates only a draft, without changing Chrome groups', async () => {
    mocks.collectTabs.mockResolvedValue([tab, { ...tab, id: 2 }, { ...tab, id: 3 }]);
    const runner = new TaskRunner(); await runner.start('generate', 10); await complete(runner);
    expect(saved?.draft).toEqual([draft]); expect(mocks.applyGroup).not.toHaveBeenCalled(); expect(mocks.classify).not.toHaveBeenCalled();
  });
  it.each([1, 2])('does not request an AI plan for only %s tabs', async count => {
    mocks.collectTabs.mockResolvedValue(Array.from({ length: count }, (_, i) => ({ ...tab, id: i + 1 })));
    const runner = new TaskRunner(); await runner.start('generate', 10); await complete(runner);
    expect(saved?.draft).toEqual([]); expect(saved?.status).toBe('completed');
    expect(mocks.generate).not.toHaveBeenCalled(); expect(mocks.applyGroup).not.toHaveBeenCalled();
  });
  it('counts successfully read pages and accepts a no-group plan', async () => {
    mocks.collectTabs.mockResolvedValue([tab, { ...tab, id: 2 }, { ...tab, id: 3 }]);
    mocks.readPage.mockRejectedValueOnce(new Error('closed'));
    let runner = new TaskRunner(); await runner.start('generate', 10); await complete(runner);
    expect(saved?.draft).toEqual([]); expect(mocks.generate).not.toHaveBeenCalled();
    mocks.generate.mockResolvedValueOnce([]);
    runner = new TaskRunner(); await runner.start('generate', 10); await complete(runner);
    expect(saved?.draft).toEqual([]); expect(saved?.message).toContain('没有必要');
  });
  it('batches clear matches by window after classification, keeping failed and ambiguous tabs out', async () => {
    mocks.collectTabs.mockResolvedValue(Array.from({ length: 6 }, (_, i) => ({ ...tab, id: i + 1, windowId: i < 3 ? 10 : 20 })));
    mocks.classify.mockResolvedValueOnce(classified).mockRejectedValueOnce(new Error('timeout')).mockResolvedValueOnce({ ...classified, choice: 'none' });
    const runner = new TaskRunner(); await runner.start('update', 10); await complete(runner);
    expect(mocks.applyGroup.mock.calls.map(call => call[0].map((item: typeof tab) => item.id))).toEqual([[1], [4, 5, 6]]);
    expect(mocks.applyGroup.mock.invocationCallOrder[0]).toBeGreaterThan(mocks.classify.mock.invocationCallOrder.at(-1)!);
  });
  it('resumes classified but unapplied items without another model request', async () => {
    saved = { id: 'old', sessionId: 'session-1', status: 'running', kind: 'update', createdAt: 0, settings, categories: [category], items: [{ tab, status: 'read', categoryId: category.id }], undo: [] };
    const runner = new TaskRunner(); await runner.recover(); await complete(runner);
    expect(saved?.items[0].status).toBe('applied'); expect(mocks.classify).not.toHaveBeenCalled();
  });
  it('uses cached decisions without another model call', async () => {
    mocks.cachedDecision.mockResolvedValue({ ...classified, scoreSource: 'llm_estimate' });
    const runner = new TaskRunner(); await runner.start('update', 10); await complete(runner);
    expect(mocks.classify).not.toHaveBeenCalled(); expect(saved?.items[0].cached).toBe(true);
    expect(saved?.items[0].candidates?.[0].score).toBe(0.96);
    expect(saved?.items[0].scoreSource).toBe('llm_estimate');
    expect(saved?.items[0].preview).toBe(page.description);
  });
  it('keeps the page excerpt when classification fails, without replacing it with the error', async () => {
    mocks.classify.mockRejectedValueOnce(new Error('Mock timeout'));
    const runner = new TaskRunner(); await runner.start('update', 10); await complete(runner);
    expect(saved?.items[0]).toMatchObject({ status: 'failed', preview: page.description, message: 'Mock timeout' });
    expect(mocks.applyGroup).not.toHaveBeenCalled();
  });
  it('does not reuse distributions cached before the prompt and abstention change', async () => {
    const oldKey = JSON.stringify({ page, categories: [category], provider: settings.classifier, policy: [settings.minProbability, settings.minMargin], version: 3 });
    mocks.fingerprint.mockImplementation(async input => JSON.stringify(input));
    mocks.cachedDecision.mockImplementation(async key => key === oldKey ? { ...classified, choice: 'insufficient_information', probabilities: { dev: 0, none: 0, insufficient_information: 1 } } : null);
    const runner = new TaskRunner(); await runner.start('update', 10); await complete(runner);
    expect(mocks.classify).toHaveBeenCalledTimes(1);
    expect(saved?.items[0].cached).toBe(false);
    expect(saved?.items[0].status).toBe('applied');
  });
  it('keeps candidate scores for unmatched, uncertain and skipped tabs without inventing scores on request failure', async () => {
    mocks.collectTabs.mockResolvedValue([tab, { ...tab, id: 2 }, { ...tab, id: 3 }, { ...tab, id: 4 }]);
    mocks.classify.mockResolvedValueOnce({ ...classified, choice: 'none' })
      .mockResolvedValueOnce({ ...classified, probabilities: { dev: 0.6, none: 0.4 } })
      .mockRejectedValueOnce(new Error('timeout'));
    mocks.applyGroup.mockResolvedValue(new Map([[4, { status: 'skipped', message: '不足 3 个' }]]));
    const runner = new TaskRunner(); await runner.start('update', 10); await complete(runner);
    expect(saved?.items.map(item => item.status)).toEqual(['unmatched', 'uncertain', 'failed', 'skipped']);
    expect(saved?.items.map(item => item.candidates?.[0].score)).toEqual([0.96, 0.6, undefined, 0.96]);
  });
  it('isolates cached classifications by backend, protocol, model and thinking', async () => {
    const providers = [settings.classifier,
      { ...settings.classifier, backend: 'openai-decisions', model: 'gpt-6-luna' },
      { ...settings.classifier, backend: 'llm', model: 'gpt-6-luna' },
      { ...settings.classifier, backend: 'llm', model: 'gpt-6-luna', thinkingEffort: 'high' },
      { ...settings.classifier, backend: 'llm', protocol: 'anthropic', model: 'claude-sonnet-4-6' }];
    const cache = new Map();
    mocks.fingerprint.mockImplementation(async input => JSON.stringify(input));
    mocks.cachedDecision.mockImplementation(async key => cache.get(key));
    mocks.cacheDecision.mockImplementation(async (key, value) => { cache.set(key, value); });
    for (const classifier of [...providers, providers[0]]) {
      mocks.readConfig.mockResolvedValue({ settings: { ...settings, classifier }, categories: [category] });
      const runner = new TaskRunner(); await runner.start('update', 10); await complete(runner);
    }
    expect(mocks.classify).toHaveBeenCalledTimes(providers.length);
    expect(saved?.items[0].cached).toBe(true);
  });
  it('cancels an in-flight classification before group mutation', async () => {
    mocks.classify.mockImplementation((_page, _categories, signal: AbortSignal) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason));
    }));
    const runner = new TaskRunner(); await runner.start('update', 10);
    await vi.waitFor(() => expect(mocks.classify).toHaveBeenCalled());
    await runner.cancel(); await complete(runner);
    expect(saved?.status).toBe('cancelled'); expect(mocks.applyGroup).not.toHaveBeenCalled();
  });
  it('does not replay tab IDs from a previous browser session', async () => {
    saved = { id: 'old', sessionId: 'old-session', status: 'running', kind: 'update', createdAt: 0, settings, categories: [category], items: [{ tab, status: 'pending' }], undo: [] };
    const runner = new TaskRunner(); await runner.recover();
    expect(saved?.status).toBe('interrupted'); expect(mocks.applyGroup).not.toHaveBeenCalled();
  });
  it('resumes after an applied journal entry without repeating the mutation', async () => {
    saved = { id: 'old', sessionId: 'session-1', status: 'running', kind: 'update', createdAt: 0, settings, categories: [category], items: [{ tab, status: 'pending' }], undo: [{ tab, targetGroupId: 22, applied: true }] };
    const runner = new TaskRunner(); await runner.recover(); await complete(runner);
    expect(saved?.items[0].status).toBe('applied'); expect(mocks.applyGroup).not.toHaveBeenCalled();
  });
});
