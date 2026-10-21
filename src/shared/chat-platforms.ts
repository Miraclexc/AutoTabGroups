import type { Settings } from './schemas';

export const chatPlatformIds = ['openai', 'gemini', 'anthropic', 'deepseek', 'qwen', 'kimi', 'zhipu', 'custom-openai', 'custom-anthropic'] as const;
export type ChatPlatformId = typeof chatPlatformIds[number];
type ChatConfig = Settings['generator'];
type Preset = { id: ChatPlatformId; name: string; english: string; protocol: ChatConfig['protocol']; baseUrl: string; model: string; thinkingEffort: ChatConfig['thinkingEffort']; thinkingAdapter?: ChatConfig['thinkingAdapter']; docs: string };
// Official API defaults, checked 2026-10-21. These are API services, not chat subscriptions.
export const chatPresets: readonly Preset[] = [
  { id: 'openai', name: 'OpenAI', english: 'OpenAI', protocol: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-5.4-mini', thinkingEffort: 'off', docs: 'https://developers.openai.com/api/docs/models/gpt-5.4-mini' },
  { id: 'gemini', name: 'Google Gemini', english: 'Google Gemini', protocol: 'openai', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-3.8-flash', thinkingEffort: 'low', docs: 'https://ai.google.dev/gemini-api/docs/openai' },
  { id: 'anthropic', name: 'Anthropic · Claude', english: 'Anthropic · Claude', protocol: 'anthropic', baseUrl: 'https://api.anthropic.com/v1', model: 'claude-sonnet-5-5', thinkingEffort: 'low', docs: 'https://platform.claude.com/docs/en/models/overview' },
  { id: 'deepseek', name: 'DeepSeek', english: 'DeepSeek', protocol: 'openai', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-flash', thinkingEffort: 'off', docs: 'https://api-docs.deepseek.com/' },
  { id: 'qwen', name: '通义千问 · 百炼（中国内地）', english: 'Qwen · Model Studio (Mainland China)', protocol: 'openai', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus', thinkingEffort: 'off', thinkingAdapter: 'qwen', docs: 'https://help.aliyun.com/zh/model-studio/compatibility-of-openai-with-dashscope' },
  { id: 'kimi', name: 'Kimi · 月之暗面（中国内地）', english: 'Kimi · Moonshot (Mainland China)', protocol: 'openai', baseUrl: 'https://api.moonshot.cn/v1', model: 'kimi-k3', thinkingEffort: 'low', docs: 'https://platform.kimi.com/docs/api/chat' },
  { id: 'zhipu', name: '智谱 · GLM（中国内地）', english: 'Zhipu · GLM (Mainland China)', protocol: 'openai', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-5.3', thinkingEffort: 'low', docs: 'https://docs.bigmodel.cn/cn/guide/start/quick-start' },
];
const normalized = (url: string) => url.replace(/\/+$/, '');
export function chatPreset(config: ChatConfig) {
  return chatPresets.find(preset => preset.id === config.platform && preset.protocol === config.protocol && normalized(preset.baseUrl) === normalized(config.baseUrl));
}
export function chatPlatform(config: ChatConfig): ChatPlatformId {
  return chatPreset(config)?.id ?? (config.protocol === 'anthropic' ? 'custom-anthropic' : 'custom-openai');
}
export function selectChatPlatform(config: ChatConfig, platform: ChatPlatformId): ChatConfig {
  const preset = chatPresets.find(item => item.id === platform);
  if (preset) return { ...config, platform, protocol: preset.protocol, baseUrl: preset.baseUrl, model: preset.model, thinkingAdapter: preset.thinkingAdapter ?? 'auto', thinkingEffort: preset.thinkingEffort };
  return { ...config, platform, protocol: platform === 'custom-anthropic' ? 'anthropic' : 'openai' };
}
export function sameChatOrigin(left: ChatConfig, right: ChatConfig) {
  try { return new URL(left.baseUrl).origin === new URL(right.baseUrl).origin; } catch { return false; }
}
