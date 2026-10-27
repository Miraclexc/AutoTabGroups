import { AppError } from '../../shared/errors';
import { z } from 'zod';
import type { Settings } from '../../shared/schemas';
import { inputBytes } from '../budget';
import { thinkingParameters } from '../thinking';
import { endpoint, postJson, type Fetch } from '../transport';
import { chatPreset } from '../../shared/chat-platforms';

export function parseJsonText(text: string): unknown {
  try { return JSON.parse(text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')); }
  catch { throw new AppError('model.invalidJson'); }
}

// Shared wire protocol for generation and classification; each caller supplies its own configuration.
export async function requestJsonText(config: Settings['generator'], apiKey: string, system: string, user: string, budget: number, signal?: AbortSignal, fetcher?: Fetch) {
  if (chatPreset(config) && !apiKey.trim()) throw new AppError('messages.enter_the_selected_service_platform_s_api_key');
  const thinking = thinkingParameters(config);
  if (config.protocol === 'openai') {
    const body = { model: config.model, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], response_format: { type: 'json_object' }, ...thinking };
    if (inputBytes(body) > budget) throw new AppError('budget.request');
    const data = await postJson(endpoint(config.baseUrl, 'chat/completions'), apiKey ? { Authorization: `Bearer ${apiKey}` } : {}, body, signal, fetcher);
    const parsed = z.object({ choices: z.array(z.object({ message: z.object({ content: z.string().nullable(), refusal: z.string().nullable().optional() }), finish_reason: z.string().nullable().optional() })).min(1) }).parse(data);
    const answer = parsed.choices[0];
    if (answer.finish_reason === 'length') throw new AppError('model.truncated');
    if (answer.message.refusal || answer.finish_reason === 'content_filter') throw new AppError('model.refused');
    if (!answer.message.content) throw new AppError('model.noText');
    return answer.message.content;
  }
  const body = { model: config.model, max_tokens: 4096, system, messages: [{ role: 'user', content: user }], ...thinking };
  if (inputBytes(body) > budget) throw new AppError('budget.request');
  const data = await postJson(endpoint(config.baseUrl, 'messages'), {
    ...(apiKey ? { 'x-api-key': apiKey } : {}), 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true',
  }, body, signal, fetcher);
  const parsed = z.object({ content: z.array(z.object({ type: z.string(), text: z.string().optional() })), stop_reason: z.string().optional() }).parse(data);
  if (parsed.stop_reason === 'max_tokens') throw new AppError('model.truncated');
  if (parsed.stop_reason === 'refusal') throw new AppError('model.refused');
  const text = parsed.content.filter(block => block.type === 'text').map(block => block.text || '').join('');
  if (!text) throw new AppError('model.noText');
  return text;
}
