// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { metadata } from '../src/extraction/metadata';
function doc(html: string, url: string) {
  const document = new DOMParser().parseFromString(html, 'text/html');
  Object.defineProperty(document, 'URL', { value: url });
  return document;
}
describe('LaterOn-derived text metadata', () => {
  it('prefers the current article heading to stale social title without scanning paragraphs', () => {
    const result = metadata(doc('<title>Old</title><meta property="og:title" content="Stale"><nav><h1>Menu</h1></nav><main><h1>Current article</h1><p>PRIVATE PARAGRAPH</p></main>', 'https://example.com/new'));
    expect(result.title).toBe('Current article'); expect(result.description).toBe('');
    expect(JSON.stringify(result)).not.toContain('PRIVATE PARAGRAPH');
  });
  it('uses bounded structured metadata and ignores data belonging to another URL', () => {
    const result = metadata(doc('<title>Fallback</title><script type="application/ld+json">{"url":"/old","headline":"Wrong","description":"Wrong description"}</script><script type="application/ld+json">{"url":"/new","headline":"New","abstract":"New abstract"}</script>', 'https://example.com/new'));
    expect(result.title).toBe('New'); expect(result.description).toBe('New abstract');
  });
  it('does not use stale YouTube social or player metadata after SPA navigation', () => {
    const result = metadata(doc('<title>New video - YouTube</title><meta property="og:title" content="Old video"><meta name="description" content="Old description"><ytd-watch-flexy video-id="old"><ytd-watch-metadata><h1>Old title</h1><div id="description">Old description</div></ytd-watch-metadata></ytd-watch-flexy><script>var data={"videoDetails":{"videoId":"old","title":"Old embedded","shortDescription":"Old embedded description"}};</script>', 'https://www.youtube.com/watch?v=new'));
    expect(result.title).toBe('New video'); expect(result.description).toBe('');
  });
  it('uses matching current YouTube details, including braces inside strings', () => {
    const result = metadata(doc('<title>YouTube</title><script>var data={"videoDetails":{"videoId":"new","title":"New {video}","shortDescription":"Current description"}};</script>', 'https://www.youtube.com/watch?v=new'));
    expect(result.title).toBe('New {video}'); expect(result.description).toBe('Current description');
    expect(result.descriptionSource).toBe('youtube-data');
  });
  it('does not consume another Douyin video panel after navigation', () => {
    const result = metadata(doc('<title>Current - 抖音</title><meta name="lark:url:video_title" content="Old video"><div data-e2e="detail-video-info" data-e2e-aweme-id="123"><h1>Old headline</h1></div>', 'https://www.douyin.com/video/456'));
    expect(result.title).toBe('Current - 抖音'); expect(result.description).toBe('');
  });
  it('uses matching Douyin detail metadata without a body scan', () => {
    const result = metadata(doc('<title>抖音</title><meta name="lark:url:video_title" content="Current summary"><div data-e2e="detail-video-info" data-e2e-aweme-id="456"><h1>Current video</h1></div>', 'https://www.douyin.com/video/456'));
    expect(result.title).toBe('Current video'); expect(result.description).toBe('Current summary');
  });
});
