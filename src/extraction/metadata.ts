import type { PageInput } from '../shared/schemas';

export function cleanUrl(value: string): string {
  try {
    const url = new URL(value);
    url.username = ''; url.password = ''; url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|fbclid$|gclid$)|token|password|secret|auth|session|api.?key/i.test(key)) url.searchParams.delete(key);
    }
    return url.href.slice(0, 4000);
  } catch { return ''; }
}
export function metadata(doc: Document): PageInput {
  const meta = doc.querySelector<HTMLMetaElement>('meta[name="description" i]')?.content
    || doc.querySelector<HTMLMetaElement>('meta[property="og:description" i]')?.content || '';
  return {
    title: doc.title.trim().slice(0, 1000), url: cleanUrl(doc.URL), description: meta.trim().slice(0, 2000),
    extraction: 'metadata', truncated: false,
  };
}
