import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readUiPreferences, saveUiPreferences, UI_PREFERENCES_KEY } from '../src/shared/ui-preferences';

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
