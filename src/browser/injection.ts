import { AppError } from '../shared/errors';
import { msg, joinMessages } from '../i18n';
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
  if (!key) throw new ReaderError('reader.key', { provider: settings.reader.provider === 'tavily' ? 'Tavily' : 'DeepSeek Fetch' });
  const page = await localPage(tab, { ...settings, readContent: false }, signal);
  if (!unchanged(await chrome.tabs.get(tab.id), tab)) throw new AppError('messages.the_page_changed_while_being_read_start_a_new');
  let content: Awaited<ReturnType<typeof remoteContent>>;
  try { content = await remoteContent(tab.url, settings, key, signal); }
  catch (error) {
    signal?.throwIfAborted();
    if (!settings.reader.fallback) throw error;
    const local = await localPage(tab, settings, signal);
    return { ...local, warning: joinMessages(error instanceof ReaderError ? error.detail : msg('reader.remoteFailed'), msg(local.content ? 'messages.used_local_page_content_instead' : 'messages.no_local_page_content_available_used_title_and_description')) };
  }
  signal?.throwIfAborted();
  if (!unchanged(await chrome.tabs.get(tab.id), tab)) throw new AppError('messages.the_page_changed_while_being_read_start_a_new');
  return { ...page, ...content, warning: undefined };
}

async function localPage(tab: TabSnapshot, settings: Settings, signal?: AbortSignal): Promise<PageInput> {
  signal?.throwIfAborted();
  const current = await chrome.tabs.get(tab.id);
  if (!unchanged(current, tab)) throw new AppError('messages.the_page_or_group_has_changed_start_a_new');
  const fallback: PageInput = {
    title: tab.title.slice(0, 1000), url: cleanUrl(tab.url), description: '', extraction: 'fallback', truncated: false,
  };
  if (current.discarded || current.frozen || current.status === 'loading')
    return { ...fallback, warning: msg('messages.the_page_is_sleeping_frozen_or_loading_only_its') };
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: (() => void) | undefined;
  try {
    const result = await Promise.race([
      (async () => {
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content-scripts/extractor.js'] });
        return chrome.tabs.sendMessage(tab.id, { type: 'extract-page', readContent: settings.readContent, maxChars: settings.maxContentChars }, { frameId: 0 });
      })(),
      new Promise<never>((_, reject) => { if (signal) { abort = () => reject(signal.reason); signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort(); } }),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new AppError('reader.timeout')), 5000); }),
    ]);
    if (result.documentUrl !== tab.url) throw new AppError('messages.the_page_url_has_changed');
    signal?.throwIfAborted();
    if (!unchanged(await chrome.tabs.get(tab.id), tab)) throw new AppError('messages.the_page_url_has_changed');
    return pageInputSchema.parse(result.page);
  } catch {
    signal?.throwIfAborted();
    if (!unchanged(await chrome.tabs.get(tab.id), tab)) throw new AppError('messages.the_page_changed_while_being_read_start_a_new');
    return { ...fallback, warning: msg('messages.the_page_could_not_be_read_only_its_title') };
  } finally { if (timer) clearTimeout(timer); if (abort) signal?.removeEventListener('abort', abort); }
}
