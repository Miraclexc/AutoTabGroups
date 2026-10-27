import { Readability } from '@mozilla/readability';
import { metadata } from './metadata';
import type { PageInput } from '../shared/schemas';
import { msg } from '../i18n';

export function extractPage(doc: Document, readContent: boolean, maxChars: number): PageInput {
  const page = metadata(doc);
  if (!readContent) return page;
  try {
    const copy = doc.cloneNode(true) as Document;
    copy.querySelectorAll('input, textarea, select, [contenteditable], script, style, noscript').forEach(node => node.remove());
    const article = new Readability(copy, { maxElemsToParse: 50000 }).parse();
    const text = article?.textContent?.replace(/\s+/g, ' ').trim();
    if (!text) return { ...page, extraction: 'fallback', warning: msg('messages.no_article_text_was_found_title_and_description_were') };
    return { ...page, content: text.slice(0, maxChars), extraction: 'readability', truncated: text.length > maxChars };
  } catch {
    return { ...page, extraction: 'fallback', warning: msg('messages.article_extraction_failed_title_and_description_were_used') };
  }
}
