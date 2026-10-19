import { describe, expect, it, vi } from 'vitest';
import { generateDescription } from '../src/ai/providers/description';
import { parseGroups } from '../src/ai/providers/generator';
import { categoriesSchema } from '../src/shared/schemas';
import { commandSchema } from '../src/shared/messages';
import { category, settings } from './fixtures';

describe('optional descriptions and explicit AI generation (mock HTTP)', () => {
  it('accepts name-only categories and an empty AI group plan', () => {
    expect(categoriesSchema.parse([{ id: 'reading', name: '论文' }])[0]).toMatchObject({ description: '', include: [], exclude: [], color: 'blue' });
    expect(parseGroups('{"groups":[]}', 8)).toEqual([]);
    expect(() => parseGroups('{"groups":[{"name":"论文"}]}', 8)).toThrow();
    expect(() => commandSchema.parse({ type: 'describe-category', name: ' ' })).toThrow();
  });
  it.each(['openai', 'anthropic'] as const)('generates a description with %s using only the name and generator settings', async protocol => {
    const content = JSON.stringify({ description: '学术论文、研究方法及文献阅读笔记。' });
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(protocol === 'openai' ? { choices: [{ message: { content } }] } : { content: [{ type: 'text', text: content }] })));
    const config = { ...settings, generator: { ...settings.generator, protocol, model: protocol === 'openai' ? 'gpt-5.2' : 'claude-sonnet-4-6', thinkingEffort: 'off' as const } };
    expect(await generateDescription('论文', config, 'mock-key', undefined, fetcher)).toContain('学术论文');
    const body = JSON.parse(fetcher.mock.calls[0][1]!.body as string);
    expect(JSON.parse(body.messages.find((message: { role: string }) => message.role === 'user').content)).toEqual({ name: '论文' });
    expect(body.model).toBe(config.generator.model);
    if (protocol === 'openai') expect(body.reasoning_effort).toBe('none');
    else expect(body.thinking).toEqual({ type: 'disabled' });
    expect(category.description).toBe('浏览器插件 API、开发文档和问题讨论');
  });
  it.each(['not JSON', '{}', '{"description":" "}'])('rejects malformed or empty descriptions: %s', async content => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content } }] })));
    await expect(generateDescription('论文', settings, '', undefined, fetcher)).rejects.toThrow();
  });
  it('requires a configured model before sending', async () => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(generateDescription('论文', { ...settings, generator: { ...settings.generator, model: '' } }, '', undefined, fetcher)).rejects.toThrow('生成模型');
    expect(fetcher).not.toHaveBeenCalled();
  });
});
