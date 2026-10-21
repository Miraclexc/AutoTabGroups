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
  // Text-only adaptations of LaterOn's metadata precedence and SPA identity checks.
  // No images, paragraph scanning, page scripts, or additional network requests.
  const text = (v: unknown) => typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '';
  const meta = (key: string) => text(doc.querySelector<HTMLMetaElement>(`meta[name="${key}" i], meta[property="${key}" i]`)?.content);
  const dom = (selector: string) => text(doc.querySelector(selector)?.textContent);
  const url = new URL(doc.URL);
  const host = url.hostname.replace(/^www\./, '');
  let title = '';
  let description = '';
  let titleSource = 'document';
  let descriptionSource = 'none';
  let structured: Record<string, unknown> = {};
  for (const script of [...doc.querySelectorAll('script[type="application/ld+json"]')].slice(0, 8)) {
    if ((script.textContent?.length || 0) > 100000) continue;
    try {
      const data = JSON.parse(script.textContent || '') as Record<string, unknown>;
      const entries = Array.isArray(data) ? data : Array.isArray(data['@graph']) ? data['@graph'] : [data];
      for (const entry of entries) {
        if (!entry || typeof entry !== 'object') continue;
        const value = entry as Record<string, unknown>;
        const identity = typeof value.url === 'string' ? value.url : typeof value['@id'] === 'string' ? value['@id'] : '';
        if (identity) {
          const resolved = new URL(identity, url);
          if (resolved.origin !== url.origin || resolved.pathname !== url.pathname) continue;
        }
        if (value.headline || value.description || value.abstract) { structured = value; break; }
      }
    } catch { /* Malformed structured data is not executable code. */ }
    if (Object.keys(structured).length) break;
  }
  const youtube = /(^|\.)youtube(-nocookie)?\.com$/.test(host) || host === 'youtu.be';
  const videoId = youtube ? (host === 'youtu.be' ? url.pathname.split('/')[1] : url.searchParams.get('v') || /^\/(?:shorts|embed|live)\/([^/]+)/.exec(url.pathname)?.[1]) : '';
  const douyin = /(^|\.)((ies)?douyin)\.com$/.test(host);
  if (videoId) {
    const container = doc.querySelector('ytd-watch-flexy');
    const domId = container?.getAttribute('video-id');
    if (!domId || domId === videoId) {
      title = dom('ytd-watch-metadata h1') || dom('ytd-reel-video-renderer[is-active] h2');
      description = dom('#description-inline-expander') || dom('ytd-watch-metadata #description');
      if (title) titleSource = 'youtube-dom';
      if (description) descriptionSource = 'youtube-dom';
    }
    // ytInitialPlayerResponse is often stale following in-site navigation.
    for (const script of [...doc.scripts].slice(0, 60)) {
      const source = script.textContent || '';
      const at = source.indexOf('"videoDetails"');
      if (at < 0) continue;
      const start = source.indexOf('{', at);
      if (start < 0) continue;
      const object = balancedObject(source, start, 20000);
      try {
        const details = JSON.parse(object);
        if (details.videoId !== videoId) continue;
        if (!title) { title = text(details.title); titleSource = 'youtube-data'; }
        if (!description) { description = text(details.shortDescription); descriptionSource = 'youtube-data'; }
      } catch { /* Ignore invalid or stale data. */ }
    }
    if (!title) title = text(doc.title).replace(/\s*[-–—]\s*YouTube\s*$/i, '');
    // Do not use generic or stale social metadata for a video.
  } else if (douyin && (url.pathname.includes('/video/') || url.searchParams.has('modal_id'))) {
    const expected = /\/video\/(\d+)/.exec(url.pathname)?.[1] || url.searchParams.get('modal_id');
    const info = doc.querySelector('[data-e2e="detail-video-info"]');
    const readId = info?.getAttribute('data-e2e-aweme-id');
    if (readId && readId === expected) {
      title = text(info?.querySelector('h1')?.textContent);
      titleSource = 'douyin-dom';
      description = meta('lark:url:video_title');
      descriptionSource = 'douyin-lark';
    }
    if (!title) title = text(doc.title);
  } else {
    const heading = [...doc.querySelectorAll('article h1, main h1, h1, [itemprop="headline"], #activity-name, #detail-title')]
      .slice(0, 20).find(el => {
        if (el.closest('nav, aside, footer, form, [role="banner"], [hidden], [aria-hidden="true"]')) return false;
        const headingHeader = el.closest('header');
        if (headingHeader && !headingHeader.closest('article, main')) return false;
        const value = text(el.textContent);
        return value.length >= 2 && value.length <= 180 && !['首页', '登录', 'Loading', meta('og:site_name')].includes(value);
      });
    const titleCandidates = [
      [text(heading?.textContent), 'dom'], [meta('og:title'), 'og'], [meta('twitter:title'), 'twitter'],
      [text(structured.headline || structured.name), 'jsonld'], [text(doc.title), 'document'],
    ];
    [title, titleSource] = titleCandidates.find(([value]) => !!value) || ['', 'none'];
    [description, descriptionSource] = [
      [meta('description'), 'meta'], [meta('og:description'), 'og'], [meta('twitter:description'), 'twitter'],
      [text(structured.description || structured.abstract), 'jsonld'],
    ].find(([value]) => !!value) || ['', 'none'];
  }
  return {
    title: title.slice(0, 1000), url: cleanUrl(doc.URL), description: description.slice(0, 2000),
    extraction: 'metadata', truncated: false, titleSource, descriptionSource,
  };
}

function balancedObject(source: string, start: number, limit: number) {
  let depth = 0, quoted = false, escaped = false;
  for (let i = start; i < Math.min(source.length, start + limit); i++) {
    const c = source[i];
    if (quoted) { if (escaped) escaped = false; else if (c === '\\') escaped = true; else if (c === '"') quoted = false; }
    else if (c === '"') quoted = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  return '';
}
