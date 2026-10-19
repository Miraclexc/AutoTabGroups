import type { PageInput } from '../shared/schemas';

// A conservative UTF-8 byte allowance, not an exact tokenizer. Reserve room for prompts/output.
export function inputBytes(value: unknown): number { return new TextEncoder().encode(JSON.stringify(value)).length; }
export function fitPages(pages: PageInput[], budget: number): PageInput[] {
  if (inputBytes(pages) <= budget) return pages;
  const result: PageInput[] = pages.map(page => ({ ...page, content: undefined, truncated: page.truncated || !!page.content }));
  if (inputBytes(result) > budget) throw new Error('标题和描述已超过输入预算，请缩小窗口范围或提高预算；未丢弃任何标签');
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
