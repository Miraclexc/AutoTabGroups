import { describe, expect, it } from 'vitest';
import { pagePreview } from '../src/extraction/preview';
import { page } from './fixtures';

describe('literal page excerpts', () => {
  it('prefers the extracted body and normalizes whitespace', () => {
    expect(pagePreview({ ...page, content: '  主要内容\n\t下一段  ' })).toBe('主要内容 下一段');
  });
  it('falls back to metadata without inventing content or using extraction warnings', () => {
    expect(pagePreview(page)).toBe(page.description);
    expect(pagePreview({ ...page, content: '  ', description: ' 描述\n内容 ' })).toBe('描述 内容');
    expect(pagePreview({ ...page, description: '', warning: '提取失败' })).toBe('');
  });
  it('bounds saved excerpts including ellipsis without splitting Unicode characters', () => {
    const result = pagePreview({ ...page, content: '📚'.repeat(200) + 'PRIVATE_TAIL' });
    expect(Array.from(result)).toHaveLength(160);
    expect(result).toBe('📚'.repeat(159) + '…');
    expect(pagePreview({ ...page, content: '字'.repeat(160) })).toBe('字'.repeat(160));
  });
});
