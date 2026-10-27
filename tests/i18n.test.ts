import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { msg, renderMessage, resources, translator } from '../src/i18n';
import { AppError, errorForDisplay, isConfigurationError } from '../src/shared/errors';
import { dispatch } from '../src/shared/organizer';
import { readOrganizerTask, clearOrganizerTask } from '../src/storage/workspace';
import { endpointSchema, settingsSchema, defaultSettings } from '../src/shared/schemas';

const variables = (value: string) => [...new Set([...value.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)].map(match => match[1]))].sort();
describe('offline translation resources and message contracts', () => {
  it('has identical keys and interpolation variables in both locales', () => {
    const zh = resources['zh-CN'].translation, en = resources.en.translation;
    expect(Object.keys(zh).sort()).toEqual(Object.keys(en).sort());
    for (const key of Object.keys(zh) as (keyof typeof zh)[]) {
      expect(zh[key].trim(), key).not.toBe(''); expect(en[key].trim(), key).not.toBe('');
      expect(variables(zh[key]), key).toEqual(variables(en[key]));
    }
  });
  it('uses Chinese counts and English singular/plural forms without shared-language races', () => {
    const zh = translator('zh-CN'), en = translator('en');
    expect(en('counts.pages', { count: 1 })).toBe('1 page');
    expect(zh('counts.pages', { count: 1 })).toBe('1 页');
    expect(en('counts.pages', { count: 2 })).toBe('2 pages');
    expect(en('counts.groups', { count: 0 })).toBe('0 groups');
    expect(zh('counts.groups', { count: 0 })).toBe('0 个分组');
  });
  it('renders serialized message codes in either language without translating supplied values', () => {
    const value = JSON.parse(JSON.stringify(msg('task.joined', { name: '摄影 {{count}} <script>' })));
    expect(renderMessage(value, 'en')).toBe('Added to “摄影 {{count}} <script>”');
    expect(renderMessage(value, 'zh-CN')).toBe('已加入「摄影 {{count}} <script>」');
    const nested = msg('action.result', { action: msg('actions.organize-window'), message: msg('task.finished', { count: 1 }) });
    expect(renderMessage(nested, 'en')).toBe('Update groups: Finished: 1 tab grouped; all others unchanged.');
    expect(renderMessage('分组已保存', 'en')).toBe('分组已保存'); // No legacy text matching.
  });
  it('carries structured errors through the extension RPC boundary', async () => {
    const error = new AppError('error.http', { status: 403 });
    vi.stubGlobal('chrome', { runtime: { sendMessage: vi.fn().mockResolvedValue({ ok: false, error: errorForDisplay(error) }) } });
    try { await dispatch({ type: 'cancel' }); throw new Error('Expected failure'); }
    catch (caught) { expect(caught).toBeInstanceOf(AppError); expect(renderMessage(errorForDisplay(caught), 'en')).toContain('HTTP 403'); }
    expect(renderMessage(errorForDisplay(new Error('Raw provider error')), 'en')).toBe('Raw provider error');
  });
  it('ignores old task records without importing or migrating them', async () => {
    const get = vi.fn(async () => ({})); const remove = vi.fn(async () => {});
    vi.stubGlobal('chrome', { storage: { local: { get, remove } } });
    expect(await readOrganizerTask()).toBeNull();
    expect(get.mock.calls).toEqual([['organizer.task.v3']]);
    await clearOrganizerTask(); expect(remove).toHaveBeenCalledWith('organizer.task.v3');
  });
  it('classifies configuration errors by code without depending on translated wording', () => {
    expect(isConfigurationError(msg('error.authentication'))).toBe(true);
    expect(isConfigurationError(msg('error.http', { status: 404 }))).toBe(true);
    expect(isConfigurationError(msg('error.http', { status: 500 }))).toBe(false);
    expect(isConfigurationError(msg('messages.this_model_does_not_support_the_selected_reasoning_effort'))).toBe(true);
    expect(isConfigurationError(msg('messages.operation_cancelled'))).toBe(false);
    expect(isConfigurationError('Unauthorized API key')).toBe(true);
    for (const locale of ['zh-CN', 'en'] as const) {
      const t = translator(locale);
      expect(t('status.uncertain')).toBe(t('status.unmatched'));
    }
  });
  it('localizes validation issues by structured fields, including invalid endpoints and limits', () => {
    const endpoint = endpointSchema.safeParse('https://user:password@example.com');
    if (endpoint.success) throw new Error('Expected invalid endpoint');
    const message = errorForDisplay(endpoint.error);
    expect(renderMessage(message, 'en')).toContain('without credentials');
    expect(renderMessage(message, 'zh-CN')).toContain('不含凭据');
    const invalid = settingsSchema.safeParse({ ...defaultSettings, maxGroups: 1 });
    if (invalid.success) throw new Error('Expected invalid limit');
    expect(renderMessage(errorForDisplay(invalid.error), 'en')).toContain('maxGroups: Below the minimum value or length: 2');
    expect(() => endpointSchema.safeParse('not a URL')).not.toThrow();
  });
  it('keeps Chrome native messages aligned with the bundled catalogs', () => {
    const keys = { extensionName: 'extension.name', extensionDescription: 'extension.description', openExtension: 'extension.open', commandCurrent: 'extension.commandCurrent', commandWindow: 'extension.commandWindow', commandNew: 'extension.commandNew' } as const;
    for (const [locale, directory] of [['en', 'en'], ['zh-CN', 'zh_CN']] as const) {
      const native = JSON.parse(readFileSync(`public/_locales/${directory}/messages.json`, 'utf8'));
      expect(Object.keys(native).sort()).toEqual(Object.keys(keys).sort());
      for (const [key, resource] of Object.entries(keys)) expect(native[key].message).toBe(translator(locale)(resource));
    }
  });
});
