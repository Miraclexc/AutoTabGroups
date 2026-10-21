import { pageInputSchema, type PageInput, type Settings, type TabSnapshot } from '../shared/schemas';
import { cleanUrl } from '../extraction/metadata';
import { unchanged } from './tabs';
import { readKeys } from '../storage/repository';
import { ReaderError, remoteContent } from '../extraction/remote';

export async function readPage(tab: TabSnapshot, settings: Settings, signal?: AbortSignal): Promise<PageInput> {
  signal?.throwIfAborted();
  if (!settings.readContent || settings.reader.provider === 'local') return localPage(tab, settings, signal);
  const keys = await readKeys();
  const key = keys[settings.reader.provider];
  if (!key) throw new ReaderError(`请配置 ${settings.reader.provider === 'tavily' ? 'Tavily' : 'DeepSeek Fetch'} 读取密钥`);
  const page = await localPage(tab, { ...settings, readContent: false }, signal);
  if (!unchanged(await chrome.tabs.get(tab.id), tab)) throw new Error('读取期间网页已变化，请重新扫描');
  let content: Awaited<ReturnType<typeof remoteContent>>;
  try { content = await remoteContent(tab.url, settings, key, signal); }
  catch (error) {
    signal?.throwIfAborted();
    if (!settings.reader.fallback) throw error;
    const local = await localPage(tab, settings, signal);
    return { ...local, warning: [error instanceof ReaderError ? error.message : '远程正文读取失败', local.content ? '已改用浏览器本地正文' : '本地无可用正文，仅使用标题与描述'].join('；') };
  }
  signal?.throwIfAborted();
  if (!unchanged(await chrome.tabs.get(tab.id), tab)) throw new Error('读取期间网页已变化，请重新扫描');
  return { ...page, ...content, warning: undefined };
}

async function localPage(tab: TabSnapshot, settings: Settings, signal?: AbortSignal): Promise<PageInput> {
  signal?.throwIfAborted();
  const current = await chrome.tabs.get(tab.id);
  if (!unchanged(current, tab)) throw new Error('页面或分组已变化，请重新扫描');
  const fallback: PageInput = {
    title: tab.title.slice(0, 1000), url: cleanUrl(tab.url), description: '', extraction: 'fallback', truncated: false,
  };
  if (current.discarded || current.frozen || current.status === 'loading')
    return { ...fallback, warning: '页面休眠、冻结或加载中，仅使用标题与 URL' };
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: (() => void) | undefined;
  try {
    const result = await Promise.race([
      (async () => {
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content-scripts/extractor.js'] });
        return chrome.tabs.sendMessage(tab.id, { type: 'extract-page', readContent: settings.readContent, maxChars: settings.maxContentChars }, { frameId: 0 });
      })(),
      new Promise<never>((_, reject) => { if (signal) { abort = () => reject(signal.reason); signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort(); } }),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('提取超时')), 5000); }),
    ]);
    if (result.documentUrl !== tab.url) throw new Error('网页地址已变化');
    signal?.throwIfAborted();
    if (!unchanged(await chrome.tabs.get(tab.id), tab)) throw new Error('网页地址已变化');
    return pageInputSchema.parse(result.page);
  } catch {
    signal?.throwIfAborted();
    if (!unchanged(await chrome.tabs.get(tab.id), tab)) throw new Error('读取期间网页已变化，请重新扫描');
    return { ...fallback, warning: '无网站权限或无法提取，仅使用标题与 URL' };
  } finally { if (timer) clearTimeout(timer); if (abort) signal?.removeEventListener('abort', abort); }
}
