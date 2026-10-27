import { describe, expect, it, vi } from 'vitest';
import { createGenerator, proposeGroups } from '../src/ai/providers/generator';
import { describeNativeGroup, generateDescription } from '../src/ai/providers/description';
import { category, page, settings } from './fixtures';

describe.each(['openai', 'anthropic'] as const)('%s English system prompts with localized output', protocol => {
  it.each(['zh-CN', 'en'] as const)('uses %s for every generated user-facing field and preserves input data', async locale => {
    const generated = locale === 'en'
      ? { name: 'Extensions', description: 'Browser extension development.', include: ['API guides'], exclude: ['Browser news'], color: 'blue' }
      : { name: '插件开发', description: '浏览器插件开发。', include: ['接口指南'], exclude: ['浏览器新闻'], color: 'blue' };
    const requests: { system: string; input: Record<string, unknown> }[] = [];
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
      const body = JSON.parse(init!.body as string);
      const system = protocol === 'openai' ? body.messages[0].content : body.system;
      const input = JSON.parse(body.messages.find((m: { role: string }) => m.role === 'user').content);
      requests.push({ system, input });
      expect(system).not.toMatch(/[\u3400-\u9fff]/);
      expect(system).toContain(`in ${locale === 'en' ? 'English' : 'Simplified Chinese'}.`);
      expect(system).toContain('Keep JSON keys, enum values, candidate keys and tab IDs unchanged');
      const result = input.name ? { description: generated.description }
        : { groups: [{ ...generated, ...(input.existing ? { tabIds: [1, 2, 3] } : {}) }] };
      const content = JSON.stringify(result);
      return new Response(JSON.stringify(protocol === 'openai' ? { choices: [{ message: { content } }] } : { content: [{ type: 'text', text: content }] }));
    });
    vi.stubGlobal('fetch', fetcher);
    const config = { ...settings, generator: { ...settings.generator, protocol } };
    const pages = [{ ...page, title: '原始中文标题' }, { ...page, title: 'Original English title' }];
    expect(await createGenerator(config, 'mock', fetcher, locale).generate(pages)).toEqual([generated]);
    expect(requests[0].input.pages).toEqual(pages);
    expect(requests[0].system).toContain(locale === 'en' ? 'at most 24 characters' : 'at most 8 characters');
    const existing = { ...category, name: '用户自定义', description: '保留原描述' };
    const proposals = await proposeGroups([1, 2, 3].map(tabId => ({ tabId, page: pages[0] })), [existing], config, 'mock', undefined, locale);
    expect(proposals[0]).toMatchObject({ ...generated, tabIds: [1, 2, 3] });
    expect(requests[1].input.existing).toEqual([{ name: existing.name, description: existing.description }]);
    expect(requests[1].system).toContain('even in another language');
    expect(await generateDescription(existing.name, config, 'mock', undefined, fetcher, locale)).toBe(generated.description);
    expect(requests[2].input).toEqual({ name: existing.name });
    expect(await describeNativeGroup(existing.name, pages, config, 'mock', undefined, locale)).toBe(generated.description);
    expect(requests[3].input).toEqual({ name: existing.name, pages });
    expect(fetcher).toHaveBeenCalledTimes(4);
  });
});
