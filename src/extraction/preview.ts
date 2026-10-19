import type { PageInput } from '../shared/schemas';

// Keep only a short literal excerpt for the result list, never a generated summary.
export function pagePreview(page: PageInput): string {
  const normalize = (text: string) => text.replace(/\s+/g, ' ').trim();
  const text = normalize(page.content || '') || normalize(page.description);
  const characters = Array.from(text);
  return characters.length > 160 ? `${characters.slice(0, 159).join('').trimEnd()}…` : text;
}
