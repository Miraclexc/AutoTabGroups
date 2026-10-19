import { pageInputSchema, type PageInput, type Settings, type TabSnapshot } from '../shared/schemas';
import { cleanUrl } from '../extraction/metadata';
import { unchanged } from './tabs';

export async function readPage(tab: TabSnapshot, settings: Settings): Promise<PageInput> {
  const current = await chrome.tabs.get(tab.id);
  if (!unchanged(current, tab)) throw new Error('页面或分组已变化，请重新扫描');
  const fallback: PageInput = {
    title: tab.title.slice(0, 1000), url: cleanUrl(tab.url), description: '', extraction: 'fallback', truncated: false,
  };
  if (current.discarded || current.frozen || current.status === 'loading')
    return { ...fallback, warning: '页面休眠、冻结或加载中，仅使用标题与 URL' };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content-scripts/extractor.js'] });
    const result = await Promise.race([
      chrome.tabs.sendMessage(tab.id, { type: 'extract-page', readContent: settings.readContent, maxChars: settings.maxContentChars }, { frameId: 0 }),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('提取超时')), 5000); }),
    ]);
    if (result.documentUrl !== tab.url) throw new Error('网页地址已变化');
    return pageInputSchema.parse(result.page);
  } catch {
    if (!unchanged(await chrome.tabs.get(tab.id), tab)) throw new Error('读取期间网页已变化，请重新扫描');
    return { ...fallback, warning: '无网站权限或无法提取，仅使用标题与 URL' };
  } finally { if (timer) clearTimeout(timer); }
}
