import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readPage } from '../src/browser/injection';
import { page, settings, tab } from './fixtures';

const get = vi.fn(); const executeScript = vi.fn(); const sendMessage = vi.fn();
beforeEach(() => {
  get.mockReset().mockResolvedValue({ ...tab, pinned: false, status: 'complete' });
  executeScript.mockReset().mockResolvedValue([]);
  sendMessage.mockReset().mockResolvedValue({ page, documentUrl: tab.url });
  vi.stubGlobal('chrome', { tabs: { get, sendMessage }, scripting: { executeScript } });
});
describe('page injection and fallback', () => {
  it('injects only into a chosen tab and passes the content preference explicitly', async () => {
    expect(await readPage(tab, settings)).toEqual(page);
    expect(executeScript).toHaveBeenCalledWith({ target: { tabId: 1 }, files: ['content-scripts/extractor.js'] });
    expect(sendMessage).toHaveBeenCalledWith(1, { type: 'extract-page', readContent: false, maxChars: 6000 }, { frameId: 0 });
  });
  it('never activates discarded or frozen pages', async () => {
    for (const patch of [{ discarded: true }, { frozen: true }, { status: 'loading' }]) {
      get.mockResolvedValue({ ...tab, pinned: false, ...patch });
      expect((await readPage(tab, settings)).extraction).toBe('fallback');
    }
    expect(executeScript).not.toHaveBeenCalled();
  });
  it('falls back when host permissions are absent', async () => {
    executeScript.mockRejectedValue(new Error('Cannot access contents'));
    const result = await readPage(tab, settings);
    expect(result.extraction).toBe('fallback'); expect(result.content).toBeUndefined();
    expect(result.title).toBe(tab.title);
  });
  it('rejects a page that navigated during extraction instead of classifying stale input', async () => {
    executeScript.mockRejectedValue(new Error('Frame removed'));
    get.mockResolvedValueOnce({ ...tab, pinned: false }).mockResolvedValueOnce({ ...tab, url: 'https://other.example' });
    await expect(readPage(tab, settings)).rejects.toThrow('网页已变化');
  });
});
