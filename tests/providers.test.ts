import { describe, expect, it, vi } from 'vitest';
import { createGenerator } from '../src/ai/providers/generator';
import { createClassifier } from '../src/ai/providers/jev';
import { endpoint, postJson } from '../src/ai/transport';
import { fitPages, inputBytes } from '../src/ai/budget';
import { category, draft, jevReply, page, settings } from './fixtures';

const mockResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe('generator adapters (mock HTTP only)', () => {
  it('sends OpenAI chat protocol with page fields and validates category output', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(mockResponse({ choices: [{ message: { content: JSON.stringify({ groups: [draft] }) }, finish_reason: 'stop' }] }));
    const result = await createGenerator(settings, 'fake-key', fetcher).generate([page]);
    expect(result).toEqual([draft]);
    expect(fetcher.mock.calls[0][0]).toBe('https://api.openai.com/v1/chat/completions');
    const request = fetcher.mock.calls[0][1]!;
    const body = JSON.parse(request.body as string);
    expect(body.messages[1].content).toContain(page.title);
    expect(body.messages[1].content).not.toContain('content');
    expect(body.messages[0].content).toContain('不要总结单个网页');
    expect(request.headers).toMatchObject({ Authorization: 'Bearer fake-key' });
  });
  it('sends Anthropic protocol to a custom URL', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(mockResponse({ content: [{ type: 'text', text: '```json\n' + JSON.stringify({ groups: [draft] }) + '\n```' }], stop_reason: 'end_turn' }));
    const custom = { ...settings, generator: { ...settings.generator, protocol: 'anthropic' as const, baseUrl: 'https://mock.example/proxy/v1/', model: 'mock-claude' } };
    expect(await createGenerator(custom, 'fake-key', fetcher).generate([page])).toEqual([draft]);
    expect(fetcher.mock.calls[0][0]).toBe('https://mock.example/proxy/v1/messages');
    expect(fetcher.mock.calls[0][1]?.headers).toMatchObject({ 'x-api-key': 'fake-key', 'anthropic-version': '2023-06-01' });
  });
  it('rejects malformed, duplicated and truncated generated groups', async () => {
    for (const content of ['not json', JSON.stringify({ groups: [{ name: 'No description' }] }), JSON.stringify({ groups: [draft, draft] })]) {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(mockResponse({ choices: [{ message: { content } }] }));
      await expect(createGenerator(settings, '', fetcher).generate([page])).rejects.toThrow();
    }
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(mockResponse({ choices: [{ message: { content: '{}' }, finish_reason: 'length' }] }));
    await expect(createGenerator(settings, '', fetcher).generate([page])).rejects.toThrow('截断');
  });
});

describe('Jev adapter (mock HTTP only)', () => {
  it('includes group boundaries and a single abstention option, mapping choice to stable ID', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(mockResponse(jevReply()));
    const result = await createClassifier(settings, 'fake-key', fetcher).classify(page, [category]);
    expect(result.choice).toBe(category.id);
    expect(result.probabilities[category.id]).toBe(0.94);
    const body = JSON.parse(fetcher.mock.calls[0][1]?.body as string);
    expect(body.state).toEqual(page);
    expect(body.questions.route.criteria.group_0).toContain(category.description);
    expect(body.questions.route.criteria).toHaveProperty('none');
    expect(Object.keys(body.questions.route.criteria)).toEqual(['group_0', 'none']);
    expect(fetcher.mock.calls[0][0]).toBe('https://api.typesafe.ai/v1/systemone');
  });
  it('rejects unknown choices, incomplete distributions and inconsistent winners', async () => {
    const unknown = jevReply('invented');
    const missing = { model: 'mock', answers: { route: { choice: 'group_0', confidence: 1, probabilities: { group_0: 1 } } } };
    const inconsistent = jevReply('none');
    for (const data of [unknown, missing, inconsistent]) {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(mockResponse(data));
      await expect(createClassifier(settings, '', fetcher).classify(page, [category])).rejects.toThrow();
    }
  });
  it('enforces input budget before making a request', async () => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(createClassifier({ ...settings, requestBudget: 100 }, '', fetcher).classify(page, [category])).rejects.toThrow('预算');
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe('HTTP behavior and budgets', () => {
  it('does not retry auth failures or leak response contents', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(mockResponse({ error: 'fake-secret' }, 401));
    await expect(postJson('https://example.com', {}, {}, undefined, fetcher)).rejects.toThrow('HTTP 401');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('retries rate limit once, then stops', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => mockResponse({}, 429));
    await expect(postJson('https://example.com', {}, {}, undefined, fetcher)).rejects.toThrow('HTTP 429');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('honors cancellation before sending', async () => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(postJson('https://example.com', {}, {}, AbortSignal.abort(), fetcher)).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('normalizes base paths and rejects credentials/query strings', () => {
    expect(endpoint('https://example.com/custom/v1/', 'messages')).toBe('https://example.com/custom/v1/messages');
    expect(() => endpoint('https://key:secret@example.com', 'messages')).toThrow();
    expect(() => endpoint('https://example.com?key=secret', 'messages')).toThrow();
  });
  it('preserves all pages when trimming and never silently drops records', () => {
    const pages = Array.from({ length: 10 }, (_, i) => ({ ...page, title: `Page ${i}`, content: '中文内容'.repeat(1000) }));
    const result = fitPages(pages, 5000);
    expect(result).toHaveLength(10);
    expect(inputBytes(result)).toBeLessThanOrEqual(5000);
    expect(result.some(item => item.truncated)).toBe(true);
    expect(() => fitPages(pages, 20)).toThrow('未丢弃任何标签');
  });
});
