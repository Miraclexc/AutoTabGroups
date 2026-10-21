import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readUiPreferences, saveUiPreferences, UI_PREFERENCES_KEY } from '../src/shared/ui-preferences';
import { localizeMessage } from '../src/shared/localization';
import { organizerCommandSchema } from '../src/shared/organizer';
let stored: Record<string, unknown>;
const write = vi.fn(async (values: Record<string, unknown>) => { Object.assign(stored, values); });
beforeEach(() => {
  stored = {}; write.mockClear();
  vi.stubGlobal('chrome', { storage: { local: { get: async (key: string) => ({ [key]: stored[key] }), set: write } } });
});
describe('appearance preferences', () => {
  it('defaults to system theme and Chinese, and tolerates invalid old data', async () => {
    expect(await readUiPreferences()).toEqual({ theme: 'system', locale: 'zh-CN' });
    stored[UI_PREFERENCES_KEY] = { theme: 'invalid' };
    expect(await readUiPreferences()).toEqual({ theme: 'system', locale: 'zh-CN' });
  });
  it('serializes concurrent partial writes without losing the other preference', async () => {
    await Promise.all([saveUiPreferences({ theme: 'dark' }), saveUiPreferences({ locale: 'en' })]);
    expect(await readUiPreferences()).toEqual({ theme: 'dark', locale: 'en' });
  });
  it('keeps omitted fields absent through the background command parser', async () => {
    await saveUiPreferences({ theme: 'dark', locale: 'en' });
    const parsed = organizerCommandSchema.parse({ type: 'save-ui-preferences', patch: { locale: 'zh-CN' } });
    if (parsed.type !== 'save-ui-preferences') throw new Error('Unexpected command');
    expect(parsed.patch).toEqual({ locale: 'zh-CN' });
    await saveUiPreferences(parsed.patch);
    expect(await readUiPreferences()).toEqual({ theme: 'dark', locale: 'zh-CN' });
    const theme = organizerCommandSchema.parse({ type: 'save-ui-preferences', patch: { theme: 'light' } });
    if (theme.type !== 'save-ui-preferences') throw new Error('Unexpected command');
    expect(theme.patch).toEqual({ theme: 'light' });
  });
  it('keeps previous values after a failed write and allows a retry', async () => {
    await saveUiPreferences({ theme: 'dark' });
    write.mockRejectedValueOnce(new Error('quota'));
    await expect(saveUiPreferences({ theme: 'light' })).rejects.toThrow('quota');
    expect((await readUiPreferences()).theme).toBe('dark');
    await saveUiPreferences({ theme: 'light' });
    expect((await readUiPreferences()).theme).toBe('light');
  });
});
describe('localized result presentation', () => {
  it('updates stored confirmation text in either language and translates running stages', () => {
    expect(localizeMessage('Discard unsaved changes?', 'zh-CN')).toBe('放弃未保存的编辑？');
    expect(localizeMessage('放弃未保存的编辑？', 'en')).toBe('Discard unsaved changes?');
    expect(localizeMessage('读取网页并匹配已有组', 'en')).toBe('Reading pages and matching existing groups');
    expect(localizeMessage('Group saved', 'zh-CN')).toBe('分组已保存');
    expect(localizeMessage('Backup file generated', 'zh-CN')).toBe('配置文件已生成');
  });
  it('translates application messages without changing user group names or content', () => {
    expect(localizeMessage('已加入「摄影」', 'en')).toBe('Added to “摄影”');
    expect(localizeMessage('我的研究笔记', 'en')).toBe('我的研究笔记');
    expect(localizeMessage('操作已取消', 'zh-CN')).toBe('操作已取消');
    expect(localizeMessage('模型自评分 92%', 'en')).toBe('Model self-rating 92%');
  });
  it('explains authentication, group conflicts and the minimum size without rewriting stored messages', () => {
    expect(localizeMessage('模型接口返回 HTTP 401，请检查配置或稍后重试', 'zh-CN')).toContain('鉴权失败');
    expect(localizeMessage('模型接口返回 HTTP 401，请检查配置或稍后重试', 'en')).toContain('API Key');
    expect(localizeMessage('分组已在其他位置修改，请重新载入；当前输入已保留', 'zh-CN')).toContain('确认覆盖');
    expect(localizeMessage('当前仅有 1 页可用于新建分组；自动建组至少需要 3 页，可手动建组。', 'en')).toContain('at least 3 pages');
  });
});
