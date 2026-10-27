import { AppError } from '../shared/errors';
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
      throw new AppError('model.connection');
    }
    if ((response.status === 429 || response.status >= 500) && attempt === 0) {
      await response.body?.cancel();
      await new Promise(resolve => setTimeout(resolve, 500));
      continue;
    }
    if (!response.ok) throw new AppError(response.status === 401 ? 'error.authentication' : 'error.http', { status: response.status });
    // Do not expose response bodies in errors: some gateways echo credentials or input.
    const text = await response.text();
    if (text.length > 2_000_000) throw new AppError('model.largeResponse');
    try { return JSON.parse(text); } catch { throw new AppError('model.responseJson'); }
  }
  throw new AppError('model.failed');
}
