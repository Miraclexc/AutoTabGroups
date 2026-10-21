import { z } from 'zod';
import type { PageInput, Settings } from '../shared/schemas';
import { cleanUrl } from './metadata';

export class ReaderError extends Error {}
const tavilyResponse = z.object({ results: z.array(z.object({ url: z.string(), raw_content: z.string() })).default([]) });
const deepseekResponse = z.object({ title: z.string(), content: z.string() });

// These are reader APIs, not Chat prompts. No page body, cookies or model key
// is included in the request. Only the chosen reader receives the cleaned URL.
export async function remoteContent(url: string, settings: Settings, apiKey: string, signal?: AbortSignal): Promise<Pick<PageInput, 'content' | 'extraction' | 'truncated'>> {
  const reader = settings.reader;
  if (reader.provider === 'local') throw new ReaderError('请选择远程正文读取服务');
  const name = reader.provider === 'tavily' ? 'Tavily' : 'DeepSeek Fetch';
  if (!apiKey.trim()) throw new ReaderError(`请配置 ${name} 读取密钥`);
  const target = cleanUrl(url);
  if (!/^https?:\/\//i.test(target)) throw new ReaderError('正文读取仅支持 HTTP(S) 网页');
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.throwIfAborted(); signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, reader.timeoutSeconds * 1000);
  try {
    const response = await fetch(reader[reader.provider].endpoint, {
      method: 'POST', headers: { Authorization: `Bearer ${apiKey.trim()}`, 'Content-Type': 'application/json' },
      credentials: 'omit', redirect: 'error', signal: controller.signal,
      body: JSON.stringify(reader.provider === 'tavily'
        ? { urls: [target], extract_depth: reader.tavily.depth, format: 'text', include_images: false, include_favicon: false }
        : { url: target }),
    });
    if (!response.ok) throw new ReaderError(`${name} 正文读取失败（HTTP ${response.status}）`);
    const data: unknown = await response.json();
    const content = (reader.provider === 'tavily'
      ? tavilyResponse.parse(data).results.find(item => cleanUrl(item.url) === target)?.raw_content
      : deepseekResponse.parse(data).content)?.trim();
    if (!content) throw new ReaderError(`${name} 未返回可用正文`);
    return { content: content.slice(0, settings.maxContentChars), extraction: reader.provider, truncated: content.length > settings.maxContentChars };
  } catch (error) {
    signal?.throwIfAborted();
    if (error instanceof ReaderError) throw error;
    // Do not expose response payloads or authentication material in diagnostics.
    throw new ReaderError(controller.signal.aborted ? `${name} 正文读取超时` : `${name} 正文读取失败：无法连接或响应格式不正确`);
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
}
