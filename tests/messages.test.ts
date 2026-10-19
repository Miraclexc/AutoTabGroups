import { describe, expect, it } from 'vitest';
import { isTrustedUi } from '../src/shared/messages';
import { categoriesSchema } from '../src/shared/schemas';
import { category } from './fixtures';

describe('background command boundary', () => {
  const root = 'chrome-extension://own-id/';
  it('accepts the extension UI, including when opened as a browser tab', () => {
    expect(isTrustedUi({ id: 'own-id', url: `${root}sidepanel.html` }, 'own-id', root)).toBe(true);
    expect(isTrustedUi({ id: 'own-id', url: `${root}options.html?source=menu` }, 'own-id', root)).toBe(true);
  });
  it('rejects web pages, other extensions, absent URL and unrelated extension resources', () => {
    for (const sender of [
      { id: 'own-id', url: 'https://example.com/sidepanel.html' },
      { id: 'other-id', url: `${root}sidepanel.html` },
      { id: 'own-id' },
      { id: 'own-id', url: `${root}content-scripts/extractor.js` },
      { id: 'own-id', url: `${root}sidepanel.html.attacker` },
    ]) expect(isTrustedUi(sender, 'own-id', root)).toBe(false);
  });
  it('does not allow imported category IDs to collide with abstention choices', () => {
    expect(() => categoriesSchema.parse([{ ...category, id: 'none' }])).toThrow();
  });
});
