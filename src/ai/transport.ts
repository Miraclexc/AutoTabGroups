import { endpointSchema } from '../shared/schemas';

export type Fetch = typeof fetch;
export function endpoint(baseUrl: string, path: string): string {
  return `${endpointSchema.parse(baseUrl).replace(/\/+$/, '')}/${path}`;
}
export async function postJson(url: string, headers: Record<string, string>, body: unknown, signal?: AbortSignal, fetcher: Fetch = fetch): Promise<unknown> {
  for (let attempt = 0; attempt < 2; attempt++) {
    signal?.throwIfAborted();
    let response: Response;
    try {
      response = await fetcher(url, {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(body), redirect: 'error',
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000),
      });
    } catch (error) {
      if (signal?.aborted) throw signal.reason;
      if (error instanceof Error && error.name === 'TimeoutError') throw error;
      throw new Error('无法连接模型接口，请检查地址、网络及网站访问权限');
    }
    if ((response.status === 429 || response.status >= 500) && attempt === 0) {
      await response.body?.cancel();
      await new Promise(resolve => setTimeout(resolve, 500));
      continue;
    }
    if (!response.ok) throw new Error(`模型接口返回 HTTP ${response.status}，请检查配置或稍后重试`);
    // Do not expose response bodies in errors: some gateways echo credentials or input.
    const text = await response.text();
    if (text.length > 2_000_000) throw new Error('模型响应过大');
    try { return JSON.parse(text); } catch { throw new Error('模型接口未返回有效 JSON'); }
  }
  throw new Error('模型请求失败');
}
