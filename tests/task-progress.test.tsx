import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { TaskProgress, taskProgress } from '../src/ui/TaskProgress';
import type { OrganizeTask } from '../src/shared/organizer';
import { settings, tab } from './fixtures';

vi.mock('../src/ui/preferences', async () => { const { translator } = await import('../src/i18n'); return { useUi: () => ({ locale: 'zh-CN', t: translator('zh-CN') }) }; });

function task(items: OrganizeTask['items'], stage: OrganizeTask['stage'] = 'existing'): OrganizeTask {
  return { version: 3, outputLocale: 'zh-CN', id: 'test', sessionId: 'test', windowId: 10, action: 'organize-window', source: 'sidebar',
    status: 'running', stage, createdAt: 0, allowNew: true, settings, initialGroups: [], targets: [], journal: [], items };
}

describe('organizer progress', () => {
  it('counts processed pages independently of successful grouping', () => {
    const value = task([
      { tab, status: 'applied', pass: 'existing' },
      { tab: { ...tab, id: 2 }, status: 'failed', pass: 'existing' },
      { tab: { ...tab, id: 3 }, status: 'unmatched', pass: 'existing' },
      { tab: { ...tab, id: 4 }, status: 'pending' },
    ]);
    expect(taskProgress(value)).toMatchObject({ total: 4, completed: 3, grouped: 1, failed: 1, current: { tab: { id: 4 } } });
    const html = renderToStaticMarkup(<TaskProgress task={value} onCancel={() => {}} />);
    expect(html).toContain('value="3" max="4"');
    expect(html).toContain('3 / 4');
    expect(html).not.toContain('<ol');
  });

  it('keeps the final-pass denominator stable as remaining pages succeed or fail', () => {
    const value = task([
      { tab, status: 'applied', pass: 'existing' },
      { tab: { ...tab, id: 2 }, status: 'failed', pass: 'existing' },
      { tab: { ...tab, id: 3 }, status: 'unmatched', pass: 'existing' },
      { tab: { ...tab, id: 4 }, status: 'read', pass: 'final' },
      { tab: { ...tab, id: 5 }, status: 'failed', pass: 'final' },
    ], 'final');
    expect(taskProgress(value)).toMatchObject({ total: 3, completed: 2, current: { tab: { id: 3 } } });
    value.items[2] = { ...value.items[2], status: 'unmatched', pass: 'final' };
    expect(taskProgress(value)).toMatchObject({ total: 3, completed: 3, current: undefined });
  });

  it('shows indeterminate progress while waiting for a plan instead of a fake percentage', () => {
    const value = task([{ tab, status: 'unmatched' }], 'plan');
    const html = renderToStaticMarkup(<TaskProgress task={value} onCancel={() => {}} />);
    expect(html.match(/<progress[^>]*>/)?.[0]).not.toContain('value=');
    expect(html).toContain('等待模型返回分组方案');
    expect(taskProgress(value).total).toBeUndefined();
  });
});
