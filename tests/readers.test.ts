import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readPage } from '../src/browser/injection';
import { remoteContent } from '../src/extraction/remote';
import { readerDefaults, settingsSchema, type Settings } from '../src/shared/schemas';
import { localizeMessage } from '../src/shared/localization';
import { page, settings, tab } from './fixtures';

const get = vi.fn(), send = vi.fn(), fetcher = vi.fn(), storage = vi.fn();
let config: Settings;
beforeEach(() => {
  config = structuredClone({ ...settings, readContent: true, reader: { ...readerDefaults, provider: 'tavily' as const } });
  get.mockReset().mockResolvedValue({ ...tab, status: 'complete' });
  send.mockReset().mockImplementation(async (_id, arg) => ({ documentUrl: tab.url, page: arg.readContent ? { ...page, content: 'local article', extraction: 'readability' } : page }));
  storage.mockReset().mockResolvedValue({ 'credentials.v1': { generator: 'model-secret', tavily: 'reader-secret', deepseek: 'fetch-secret' } });
  vi.stubGlobal('chrome', { tabs: { get, sendMessage: send }, scripting: { executeScript: vi.fn().mockResolvedValue([]) }, storage: { local: { get: storage } } });
  fetcher.mockReset().mockImplementation(async () => Response.json({ results: [{ url: tab.url, raw_content: 'remote article' }] }));
  vi.stubGlobal('fetch', fetcher);
});

describe('reader selection and content contracts', () => {
  it('defaults older settings to local without changing the body preference', () => {
    const old: Partial<Settings> = { ...config }; delete old.reader;
    expect(settingsSchema.parse(old).reader).toEqual(readerDefaults);
    expect(settingsSchema.parse(old).readContent).toBe(true);
  });
  it('basic mode never scans content or calls an external reader', async () => {
    const result = await readPage(tab, { ...config, readContent: false });
    expect(result).toEqual(page); expect(fetcher).not.toHaveBeenCalled(); expect(storage).not.toHaveBeenCalled();
    expect(send.mock.calls[0][1].readContent).toBe(false);
  });
  it('local mode needs no reader key and uses the loaded DOM', async () => {
    const result = await readPage(tab, { ...config, reader: readerDefaults });
    expect(result.content).toBe('local article'); expect(fetcher).not.toHaveBeenCalled();
  });
  it('Tavily sends only a cleaned URL with its own key and requested depth', async () => {
    config.reader.tavily.depth = 'advanced';
    const result = await readPage(tab, config);
    expect(result.extraction).toBe('tavily'); expect(result.content).toBe('remote article');
    const [endpoint, request] = fetcher.mock.calls[0];
    expect(endpoint).toBe('https://api.tavily.com/extract');
    expect(request.headers.Authorization).toBe('Bearer reader-secret');
    expect(request.credentials).toBe('omit'); expect(request.redirect).toBe('error');
    expect(JSON.parse(request.body)).toEqual({ urls: [tab.url], extract_depth: 'advanced', format: 'text', include_images: false, include_favicon: false });
    expect(send.mock.calls.every(call => !call[1].readContent)).toBe(true);
  });
  it('DeepSeek Fetch uses its documented body and independent key, trimming long results', async () => {
    config.reader.provider = 'deepseek'; config.maxContentChars = 500;
    fetcher.mockResolvedValue(Response.json({ title: 'Remote title', content: 'x'.repeat(900) }));
    const result = await readPage(tab, config);
    expect(result).toMatchObject({ title: page.title, extraction: 'deepseek', truncated: true });
    expect(result.content?.length).toBe(500);
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ url: tab.url });
    expect(fetcher.mock.calls[0][1].headers.Authorization).toBe('Bearer fetch-secret');
  });
  it('removes URL credentials, tracking and sensitive query fields before remote transmission', async () => {
    config.reader.provider = 'deepseek'; fetcher.mockResolvedValue(Response.json({ title: '', content: 'text' }));
    await remoteContent('https://user:pass@example.com/docs?token=secret&utm_source=x&id=4#part', config, 'key');
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ url: 'https://example.com/docs?id=4' });
  });
  it('falls back locally on a partial-success response with no matching result', async () => {
    fetcher.mockResolvedValue(Response.json({ results: [{ url: 'https://unrelated.example/', raw_content: 'wrong page' }], failed_results: [{ url: tab.url, error: 'unreadable' }] }));
    expect(await readPage(tab, config)).toMatchObject({ content: 'local article', extraction: 'readability', warning: expect.stringContaining('本地正文') });
  });
  it('disabled fallback fails the page and does not scan body or leak raw service errors', async () => {
    config.reader.fallback = false;
    fetcher.mockResolvedValue(Response.json({ error: 'sensitive server payload' }, { status: 401 }));
    await expect(readPage(tab, config)).rejects.toThrow('HTTP 401');
    expect(send.mock.calls.every(call => !call[1].readContent)).toBe(true);
  });
  it('missing reader credentials do not silently reuse the model key or fall back', async () => {
    storage.mockResolvedValue({ 'credentials.v1': { generator: 'model-secret' } });
    await expect(readPage(tab, config)).rejects.toThrow('读取密钥'); expect(fetcher).not.toHaveBeenCalled();
  });
  it('discards remote results after navigation or manual grouping', async () => {
    for (const patch of [{ url: 'https://changed.example/' }, { groupId: 99 }]) {
      get.mockResolvedValue({ ...tab });
      fetcher.mockImplementation(async () => { get.mockResolvedValue({ ...tab, ...patch }); return Response.json({ results: [{ url: tab.url, raw_content: 'stale' }] }); });
      await expect(readPage(tab, config)).rejects.toThrow('网页已变化');
    }
  });
  it('cancellation interrupts the reader and never starts fallback', async () => {
    const controller = new AbortController();
    fetcher.mockImplementation(async (_url, init) => { controller.abort(); throw init.signal.reason; });
    await expect(readPage(tab, config, controller.signal)).rejects.toThrow();
    expect(send.mock.calls.every(call => !call[1].readContent)).toBe(true);
  });
  it('cancels a pending local injection without turning cancellation into metadata fallback', async () => {
    const controller = new AbortController();
    vi.mocked(chrome.scripting.executeScript).mockImplementation(() => { controller.abort(); return new Promise(() => {}); });
    await expect(readPage(tab, { ...config, reader: readerDefaults }, controller.signal)).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled(); expect(send).not.toHaveBeenCalled();
  });
  it('timeouts are bounded and fall back to local content', async () => {
    vi.useFakeTimers();
    try {
      fetcher.mockImplementation((_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason))));
      const promise = readPage(tab, config);
      await vi.advanceTimersByTimeAsync(20000);
      expect(await promise).toMatchObject({ content: 'local article', warning: expect.stringContaining('超时') });
    } finally { vi.useRealTimers(); }
  });
  it('translates combined reader failures without exposing an untranslated status', () => {
    expect(localizeMessage('Tavily 正文读取失败（HTTP 401）；已改用浏览器本地正文', 'en')).toBe('Tavily reader failed (HTTP 401); Used local page content instead');
  });
});
