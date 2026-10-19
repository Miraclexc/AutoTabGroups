// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { extractPage } from '../src/extraction/readability';
import { cleanUrl } from '../src/extraction/metadata';

function makeDoc(html: string) { return new DOMParser().parseFromString(html, 'text/html'); }
describe('local extraction', () => {
  it('does not read article text in metadata mode and prefers meta description', () => {
    const doc = makeDoc('<title>Example</title><meta name="description" content="Meta description"><meta property="og:description" content="OG description"><article>PRIVATE BODY</article>');
    const result = extractPage(doc, false, 6000);
    expect(result.description).toBe('Meta description');
    expect(result.content).toBeUndefined();
    expect(result.extraction).toBe('metadata');
    expect(JSON.stringify(result)).not.toContain('PRIVATE BODY');
  });
  it('uses OG description if meta is missing', () => {
    expect(extractPage(makeDoc('<meta property="og:description" content="Open Graph">'), false, 6000).description).toBe('Open Graph');
  });
  it('extracts article from a clone, excludes inputs, and marks truncation', () => {
    const article = '<p>Chrome extensions help organize tabs. This technical article explains APIs, permissions, and development workflows with detailed examples.</p>'.repeat(30);
    const doc = makeDoc(`<title>Extension guide</title><nav>MENU</nav><main><article><h1>Guide</h1>${article}<textarea>SECRET FORM VALUE</textarea></article></main>`);
    const original = doc.documentElement.outerHTML;
    const result = extractPage(doc, true, 300);
    expect(result.extraction).toBe('readability');
    expect(result.content).toHaveLength(300);
    expect(result.truncated).toBe(true);
    expect(result.content).not.toContain('SECRET FORM VALUE');
    expect(doc.documentElement.outerHTML).toBe(original);
  });
  it('falls back on empty pages', () => {
    expect(extractPage(makeDoc('<title>Empty</title>'), true, 1000).extraction).toBe('fallback');
  });
  it('strips credential-like and tracking URL fields while retaining semantic parameters', () => {
    expect(cleanUrl('https://user:pass@example.com/path?q=react&utm_source=x&token=secret#hash')).toBe('https://example.com/path?q=react');
  });
});
