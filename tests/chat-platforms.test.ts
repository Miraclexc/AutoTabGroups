import { describe, expect, it, vi } from 'vitest';
import { chatPlatform, chatPreset, chatPresets, sameChatOrigin, selectChatPlatform } from '../src/shared/chat-platforms';
import { defaultSettings, settingsSchema } from '../src/shared/schemas';
import { requestJsonText } from '../src/ai/providers/chat';
import { thinkingCapabilities, thinkingParameters } from '../src/ai/thinking';

describe('Chat platform presets', () => {
  it('leaves old custom connections unchanged when reading and saving them', () => {
    const legacy = { ...defaultSettings, generator: { ...defaultSettings.generator, baseUrl: 'https://custom.example/api/v2', model: 'my-model' } };
    expect(settingsSchema.parse(JSON.parse(JSON.stringify(legacy)))).toEqual(legacy);
    expect(chatPlatform(legacy.generator)).toBe('custom-openai');
    expect(chatPreset(legacy.generator)).toBeUndefined();
    expect(legacy.generator).not.toHaveProperty('platform');
  });
  it('does not represent an overridden URL or protocol as an official connection', () => {
    const preset = selectChatPlatform(defaultSettings.generator, 'openai');
    expect(chatPlatform({ ...preset, baseUrl: 'https://gateway.example/v1' })).toBe('custom-openai');
    expect(chatPlatform({ ...preset, protocol: 'anthropic' })).toBe('custom-anthropic');
    expect(chatPreset({ ...preset, baseUrl: preset.baseUrl + '/' })?.id).toBe('openai');
  });
  it('switches to custom without silently replacing the existing URL or model', () => {
    const preset = selectChatPlatform(defaultSettings.generator, 'anthropic');
    const custom = selectChatPlatform(preset, 'custom-anthropic');
    expect(custom.baseUrl).toBe(preset.baseUrl);expect(custom.model).toBe(preset.model);
    expect(chatPreset(custom)).toBeUndefined();expect(custom.protocol).toBe('anthropic');
    expect(sameChatOrigin(preset, selectChatPlatform(preset, 'deepseek'))).toBe(false);
  });
  for (const preset of chatPresets) {
    it(`${preset.id}: sends the correct endpoint, authentication, model and thinking fields`, async () => {
      const config = selectChatPlatform(defaultSettings.generator, preset.id);
      expect(settingsSchema.parse({ ...defaultSettings, generator: config }).generator).toEqual(config);
      expect(chatPlatform(config)).toBe(preset.id);
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(config.protocol === 'anthropic'
        ? { content: [{ type: 'text', text: '{"ok":true}' }], stop_reason: 'end_turn' }
        : { choices: [{ message: { content: '{"ok":true}' }, finish_reason: 'stop' }] })));
      expect(await requestJsonText(config, 'mock-key', 'Return JSON.', '{}', 30000, undefined, fetcher)).toBe('{"ok":true}');
      const [url, init] = fetcher.mock.calls[0];
      expect(url).toBe(`${preset.baseUrl}/${config.protocol === 'anthropic' ? 'messages' : 'chat/completions'}`);
      expect(init?.headers).toMatchObject(config.protocol === 'anthropic' ? { 'x-api-key': 'mock-key', 'anthropic-version': '2023-06-01' } : { Authorization: 'Bearer mock-key' });
      const body = JSON.parse(init!.body as string);
      expect(body.model).toBe(preset.model);expect(body.messages.at(-1).content).toBe('{}');
      expect(body).toMatchObject(thinkingParameters(config));
      if (config.protocol === 'openai') expect(body.response_format).toEqual({ type: 'json_object' });
      if (preset.id === 'qwen') { expect(body.enable_thinking).toBe(false);expect(body).not.toHaveProperty('reasoning_effort'); }
      if (preset.id === 'gemini') expect(body.reasoning_effort).toBe('low');
    });
    it(`${preset.id}: missing credentials never make a network request`, async () => {
      const fetcher = vi.fn<typeof fetch>();
      await expect(requestJsonText(selectChatPlatform(defaultSettings.generator, preset.id), '  ', 'JSON', '{}', 30000, undefined, fetcher)).rejects.toThrow('API Key');
      expect(fetcher).not.toHaveBeenCalled();
    });
  }
  it('prevents disabling Gemini 3 reasoning but allows compatible Gemini 2.5 Flash', () => {
    const gemini = selectChatPlatform(defaultSettings.generator, 'gemini');
    expect(thinkingCapabilities(gemini).canDisable).toBe(false);
    expect(() => thinkingParameters({ ...gemini, thinkingEffort: 'off' })).toThrow();
    expect(thinkingParameters({ ...gemini, model: 'gemini-2.5-flash', thinkingEffort: 'off' })).toEqual({ reasoning_effort: 'none' });
  });
  it('retains unauthenticated custom-compatible connections', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: '{}' } }] })));
    await requestJsonText({ ...defaultSettings.generator, model: 'local-model' }, '', 'JSON', '{}', 30000, undefined, fetcher);
    expect(fetcher.mock.calls[0][1]?.headers).not.toHaveProperty('Authorization');
  });
});
