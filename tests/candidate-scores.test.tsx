import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { topCandidates } from '../src/grouping/decision-policy';
import { CandidateScores } from '../src/ui/CandidateScores';
import { ResultMetrics, statusLabels } from '../src/ui/ResultMetrics';
import { readTask, writeTask } from '../src/storage/repository';
import type { Classification, TaskRecord } from '../src/shared/schemas';
import { category, settings, tab } from './fixtures';

const categories = ['A', 'B', 'C', 'D'].map(id => ({ ...category, id, name: `分类${id}` }));
const answer: Classification = { choice: 'none', model: 'mock', confidence: 0.9, scoreSource: 'llm_estimate', probabilities: { A: 0.08, B: 0.12, C: 0.05, D: 0.1, none: 0.65 } };

describe('top three group scores', () => {
  it('ranks actual groups by original scores, excluding abstentions without renormalizing', () => {
    expect(topCandidates(answer, categories)).toEqual([
      { categoryId: 'B', name: '分类B', color: 'blue', score: 0.12 },
      { categoryId: 'D', name: '分类D', color: 'blue', score: 0.1 },
      { categoryId: 'A', name: '分类A', color: 'blue', score: 0.08 },
    ]);
  });
  it('preserves category order on ties and does not pad missing candidates', () => {
    expect(topCandidates({ ...answer, probabilities: { A: 0.1, B: 0.1 } }, categories).map(item => item.categoryId)).toEqual(['A', 'B']);
    expect(topCandidates(answer, [])).toEqual([]);
  });
  it('persists score source and snapshot names across task reloads, allowing older tasks without scores', async () => {
    const data: Record<string, unknown> = {};
    vi.stubGlobal('chrome', { storage: { local: {
      get: vi.fn(async (key: string) => ({ [key]: structuredClone(data[key]) })),
      set: vi.fn(async (patch: Record<string, unknown>) => { Object.assign(data, structuredClone(patch)); }),
    } } });
    const task: TaskRecord = { id: 'task', sessionId: 'session', kind: 'update', status: 'completed', createdAt: 0, settings, categories, undo: [], items: [{ tab, status: 'unmatched', preview: '网页内容摘录', candidates: topCandidates(answer, categories), scoreSource: 'llm_estimate' }] };
    await writeTask(task);
    const restored = await readTask();
    expect(restored?.items).toEqual(task.items);
    expect(restored?.items[0].candidates?.map(item => item.name)).toEqual(['分类B', '分类D', '分类A']);
    await writeTask({ ...task, items: [{ tab, status: 'failed' }] });
    expect((await readTask())?.items[0].candidates).toBeUndefined();
    expect((await readTask())?.items[0].preview).toBeUndefined();
  });
  it('renders distinct score labels and percentages and shows unavailable rather than fake zeroes', () => {
    const item = { tab, status: 'unmatched' as const, candidates: topCandidates(answer, categories), scoreSource: 'llm_estimate' as const };
    const html = renderToStaticMarkup(<CandidateScores item={item} />);
    expect(html).toContain('模型自评分'); expect(html).toContain('12%');
    expect(html.indexOf('分类B')).toBeLessThan(html.indexOf('分类D'));
    expect(html).not.toContain('分类C');
    expect(renderToStaticMarkup(<CandidateScores item={{ ...item, scoreSource: 'decision_probability' }} />)).toContain('接口概率');
    const empty = renderToStaticMarkup(<CandidateScores item={{ tab, status: 'failed' }} />);
    expect(empty).toContain('暂无候选分数'); expect(empty).not.toContain('0.00%');
  });
  it('sorts legacy candidates for display without mutating them and follows group colors with safe fallbacks', () => {
    const candidates = [
      { categoryId: 'A', name: '低分组', score: 0.1 },
      { categoryId: 'B', name: '高分组', score: 0.7, color: 'red' as const },
      { categoryId: 'C', name: '中分组', score: 0.2, color: 'purple' as const },
    ];
    const item = { tab, status: 'unmatched' as const, candidates };
    const html = renderToStaticMarkup(<CandidateScores item={item} categories={[{ ...category, id: 'B', color: 'green' }]} />);
    expect(html.indexOf('高分组')).toBeLessThan(html.indexOf('中分组'));
    expect(html.indexOf('中分组')).toBeLessThan(html.indexOf('低分组'));
    expect(html).toContain('background-color:green');
    expect(html).toContain('background-color:purple');
    expect(html).toContain('background-color:grey');
    expect(candidates.map(candidate => candidate.categoryId)).toEqual(['A', 'B', 'C']);
  });
  it('combines unmatched and uncertain records into one displayed status and count', () => {
    const task: TaskRecord = { id: 'task', sessionId: 'session', kind: 'update', status: 'completed', createdAt: 0, settings, categories, undo: [], items: [
      { tab, status: 'applied' }, { tab, status: 'unmatched' }, { tab, status: 'uncertain' }, { tab, status: 'uncertain' }, { tab, status: 'failed' },
    ] };
    const html = renderToStaticMarkup(<ResultMetrics task={task} />);
    expect(html).toContain('<strong>3</strong><span>未匹配</span>');
    expect(html).toContain('<strong>1</strong><span>已归组</span>');
    expect(html).toContain('<strong>1</strong><span>失败</span>');
    expect(html).not.toContain('待判断');
    expect(statusLabels.uncertain).toBe(statusLabels.unmatched);
  });
});
