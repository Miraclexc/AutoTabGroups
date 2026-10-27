import { AppError } from '../shared/errors';
import type { PageInput } from '../shared/schemas';

// A conservative UTF-8 byte allowance, not an exact tokenizer. Reserve room for prompts/output.
export function inputBytes(value: unknown): number { return new TextEncoder().encode(JSON.stringify(value)).length; }
export function fitPages(pages: PageInput[], budget: number): PageInput[] {
  if (inputBytes(pages) <= budget) return pages;
  const result: PageInput[] = pages.map(page => ({ ...page, content: undefined, truncated: page.truncated || !!page.content }));
  if (inputBytes(result) > budget) throw new AppError('budget.titles');
  let remaining = budget - inputBytes(result);
  for (let i = 0; i < pages.length; i++) {
    const content = pages[i].content;
    if (!content) continue;
    const allowance = Math.floor(remaining / (pages.length - i));
    let end = Math.min(content.length, allowance);
    while (end > 0 && inputBytes(content.slice(0, end)) + 16 > allowance) end = Math.floor(end * 0.8);
    if (!end) continue;
    const before = inputBytes(result[i]);
    result[i] = { ...pages[i], content: content.slice(0, end), truncated: pages[i].truncated || end < content.length };
    remaining -= inputBytes(result[i]) - before;
  }
  return result;
}
