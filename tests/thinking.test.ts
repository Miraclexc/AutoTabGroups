import { describe, expect, it, vi } from 'vitest';
import { createGenerator } from '../src/ai/providers/generator';
import { createClassifier } from '../src/ai/providers/jev';
import { thinkingCapabilities, thinkingParameters } from '../src/ai/thinking';
import { defaultSettings, settingsSchema, type Settings } from '../src/shared/schemas';
import { readConfig, readKeys, readTask } from '../src/storage/repository';
import { category, draft, jevReply, page, settings } from './fixtures';

type Config = Settings['generator'];
const config = (model: string, thinkingEffort: Config['thinkingEffort'] = 'off', extra: Partial<Config> = {}): Config => ({
  ...settings.generator, model, thinkingEffort, protocol: model.startsWith('claude-') ? 'anthropic' : 'openai', ...extra,
});
const chatReply = { choices: [{ message: { content: JSON.stringify({ groups: [draft] }), reasoning_content: 'MOCK_PRIVATE_REASONING' }, finish_reason: 'stop' }] };
const claudeReply = { content: [{ type: 'thinking', thinking: 'MOCK_PRIVATE_REASONING' }, { type: 'text', text: JSON.stringify({ groups: [draft] }) }], stop_reason: 'end_turn' };

describe('thinking defaults and settings migration', () => {
  it('defaults old config and task snapshots to off without modifying categories or keys', async () => {
    const legacy = { ...settings, generator: { model: 'gpt-5.2', baseUrl: settings.generator.baseUrl, protocol: 'openai' } };
    const data: Record<string, unknown> = {
      'config.v1': { settings: legacy, categories: [category] },
      'credentials.v1': { generator: 'mock-key', classifier: 'mock-jev-key' },
      'task.v1': { id: 'old', sessionId: 'old', kind: 'generate', status: 'interrupted', createdAt: 0, items: [], undo: [], settings: legacy, categories: [category] },
    };
    vi.stubGlobal('chrome', { storage: { local: { get: vi.fn(async (key: string) => ({ [key]: data[key] })) } } });
    expect(defaultSettings.generator.thinkingEffort).toBe('off');
    const migrated = await readConfig();
    expect(migrated.settings.generator).toMatchObject({ thinkingEffort: 'off', thinkingAdapter: 'auto' });
    expect(migrated.categories).toEqual([category]);
    expect((await readTask())?.settings.generator.thinkingEffort).toBe('off');
    expect(await readKeys()).toEqual(data['credentials.v1']);
  });
  it('round-trips explicit settings and rejects unknown effort/adapter values', () => {
    const custom = { ...settings, generator: config('custom', 'high', { thinkingAdapter: 'openai' }) };
    expect(settingsSchema.parse(JSON.parse(JSON.stringify(custom)))).toEqual(custom);
    expect(() => settingsSchema.parse({ ...settings, generator: { ...custom.generator, thinkingEffort: 'ultra-secret' } })).toThrow();
    expect(() => settingsSchema.parse({ ...settings, generator: { ...custom.generator, thinkingAdapter: 'invented' } })).toThrow();
  });
});

const cases: [string, Config['thinkingEffort'], Record<string, unknown>][] = [
  ['gpt-4o', 'off', {}],
  ['gpt-4.1', 'off', {}],
  ['gpt-5.2', 'off', { reasoning_effort: 'none' }],
  ['gpt-5.2', 'high', { reasoning_effort: 'high' }],
  ['gpt-5.1', 'medium', { reasoning_effort: 'medium' }],
  ['gpt-5', 'minimal', { reasoning_effort: 'minimal' }],
  ['o3', 'low', { reasoning_effort: 'low' }],
  ['claude-sonnet-4-5-20250929', 'off', { thinking: { type: 'disabled' } }],
  ['claude-sonnet-4-5-20250929', 'low', { thinking: { type: 'enabled', budget_tokens: 1024 }, max_tokens: 5120 }],
  ['claude-sonnet-4-5-20250929', 'medium', { thinking: { type: 'enabled', budget_tokens: 4096 }, max_tokens: 8192 }],
  ['claude-sonnet-4-5-20250929', 'high', { thinking: { type: 'enabled', budget_tokens: 8192 }, max_tokens: 12288 }],
  ['claude-3-7-sonnet-20250219', 'high', { thinking: { type: 'enabled', budget_tokens: 8192 }, max_tokens: 12288 }],
  ['claude-opus-4-20250514', 'low', { thinking: { type: 'enabled', budget_tokens: 1024 }, max_tokens: 5120 }],
  ['claude-sonnet-4-6', 'off', { thinking: { type: 'disabled' } }],
  ['claude-opus-4-6', 'high', { thinking: { type: 'adaptive' }, output_config: { effort: 'high' }, max_tokens: 16384 }],
  ['claude-opus-4-7', 'medium', { thinking: { type: 'adaptive' }, output_config: { effort: 'medium' }, max_tokens: 16384 }],
  ['claude-sonnet-5-5', 'off', { thinking: { type: 'between_tools' } }],
  ['deepseek-flash', 'off', { thinking: { type: 'disabled' } }],
  ['deepseek-v4-pro', 'max', { thinking: { type: 'enabled' }, reasoning_effort: 'max' }],
  ['deepseek-flash', 'low', { thinking: { type: 'enabled' }, reasoning_effort: 'low' }],
  ['deepseek-chat', 'off', { thinking: { type: 'disabled' } }],
  ['deepseek-chat', 'on', { thinking: { type: 'enabled' } }],
  ['glm-4.7', 'off', { thinking: { type: 'disabled' } }],
  ['glm-4.7', 'on', { thinking: { type: 'enabled' } }],
  ['glm-5.2', 'high', { thinking: { type: 'enabled' }, reasoning_effort: 'high' }],
  ['glm-5.3', 'low', { thinking: { type: 'enabled' }, reasoning_effort: 'low' }],
  ['kimi-k2.5', 'off', { thinking: { type: 'disabled' } }],
  ['kimi-k2.6', 'on', { thinking: { type: 'enabled' } }],
  ['kimi-k2.6', 'off', { thinking: { type: 'disabled' } }],
  ['kimi-k3', 'low', { reasoning_effort: 'low' }],
  ['kimi-k3', 'max', { reasoning_effort: 'max' }],
  ['kimi-k2.7-code', 'on', { thinking: { type: 'enabled', keep: 'all' } }],
];
describe('provider request contracts via mock fetch', () => {
  it.each(cases)('%s / %s emits its supported request fields', async (model, effort, expected) => {
    const generator = config(model, effort);
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(generator.protocol === 'anthropic' ? claudeReply : chatReply)));
    const result = await createGenerator({ ...settings, generator }, 'mock-key', fetcher).generate([page]);
    expect(result).toEqual([draft]); expect(JSON.stringify(result)).not.toContain('MOCK_PRIVATE_REASONING');
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, request] = fetcher.mock.calls[0];
    const body = JSON.parse(request!.body as string);
    expect(body.model).toBe(model);
    expect(url).toBe(`${generator.baseUrl}/${generator.protocol === 'anthropic' ? 'messages' : 'chat/completions'}`);
    expect(body).toMatchObject(expected);
    for (const key of ['thinking', 'reasoning_effort', 'output_config']) if (!(key in expected)) expect(body).not.toHaveProperty(key);
    expect(body).not.toHaveProperty('extra_body'); // HTTP JSON uses top-level fields, not SDK-only wrappers.
    if (generator.protocol === 'anthropic' && effort !== 'off') {
      expect(body.max_tokens).toBeGreaterThan(body.thinking.budget_tokens || 0);
      expect(body).not.toHaveProperty('response_format');
    }
  });
  it.each(['gpt-5', 'gpt-5-2025-08-07', 'gpt-5-mini', 'o3', 'gpt-6-astra', 'gpt-6.1-sol', 'claude-opus-5-5', 'claude-mythos-preview', 'glm-5.3', 'kimi-k3', 'kimi-k2.7-code', 'kimi-k2-thinking', 'deepseek-reasoner'])('%s cannot silently turn off into low effort', async model => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(createGenerator({ ...settings, generator: config(model) }, '', fetcher).generate([page])).rejects.toThrow('无法关闭');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('never retries a rejected thinking setting with omitted parameters or another model', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('{"error":"mock-secret"}', { status: 400 }));
    await expect(createGenerator({ ...settings, generator: config('gpt-5.2', 'high') }, '', fetcher).generate([page])).rejects.toThrow('HTTP 400');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('preserves custom URL and model alias when an explicit adapter is chosen', async () => {
    const generator = config('my-private-alias', 'high', { baseUrl: 'http://127.0.0.1:4317/proxy/v1', thinkingAdapter: 'claude-budget', protocol: 'anthropic' });
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(claudeReply)));
    await createGenerator({ ...settings, generator }, '', fetcher).generate([page]);
    expect(fetcher.mock.calls[0][0]).toBe('http://127.0.0.1:4317/proxy/v1/messages');
    expect(JSON.parse(fetcher.mock.calls[0][1]!.body as string)).toMatchObject({ model: 'my-private-alias', thinking: { type: 'enabled', budget_tokens: 8192 } });
  });
  it('recognizes vendor-prefixed model IDs without rewriting the request model', () => {
    expect(thinkingParameters(config('zai/glm-5.2'))).toEqual({ thinking: { type: 'disabled' } });
    expect(thinkingParameters(config('anthropic/claude-sonnet-4-6', 'low', { protocol: 'anthropic' }))).toMatchObject({ output_config: { effort: 'low' } });
  });
  it('rejects unsupported intensity and protocol mismatch instead of silently mapping them', () => {
    expect(() => thinkingParameters(config('kimi-k2.6', 'high'))).toThrow('不支持');
    expect(() => thinkingParameters(config('gpt-4o', 'low'))).toThrow('不支持');
    expect(() => thinkingParameters(config('claude-sonnet-4-6', 'low', { protocol: 'openai' }))).toThrow('Messages');
    expect(() => thinkingParameters(config('glm-4.7', 'off', { protocol: 'anthropic' }))).toThrow('Chat Completions');
    expect(thinkingCapabilities(config('glm-4.7')).levels).toEqual(['off', 'on']);
  });
  it('does not send generator thinking controls to Jev', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(jevReply())));
    await createClassifier({ ...settings, generator: config('gpt-5.2', 'high') }, '', fetcher).classify(page, [category]);
    const body = JSON.parse(fetcher.mock.calls[0][1]!.body as string);
    expect(body).not.toHaveProperty('thinking'); expect(body).not.toHaveProperty('reasoning_effort');
    expect(body.questions.route.type).toBe('choice');
  });
});
