import { AppError } from '../shared/errors';
import type { TranslationKey } from '../i18n';
import type { Settings } from '../shared/schemas';

type Generator = Settings['generator'];
type Effort = Generator['thinkingEffort'];
type Adapter = Exclude<Generator['thinkingAdapter'], 'auto'>;
const legacyClaude = (model: string) => /claude-(?:3[.-]7|(?:sonnet|opus|haiku)-4(?:[.-][15])?(?:-\d{8})?$|(?:sonnet|opus|haiku)-4-0(?:-|$))/.test(model);
const modelName = (config: Generator) => config.model.trim().toLowerCase().split('/').at(-1)!;
const originalGpt5 = (model: string) => /^gpt-5(?:-(?:mini|nano))?(?:-\d{4}-?\d{2}-?\d{2})?$/.test(model);

export function resolveThinkingAdapter(config: Generator): Adapter {
  if (config.thinkingAdapter !== 'auto') return config.thinkingAdapter;
  const model = modelName(config);
  if (model.startsWith('claude-')) {
    if (/^claude-(?:3-(?:opus|sonnet|haiku)|3[.-]5)/.test(model)) return 'non-reasoning';
    return legacyClaude(model) ? 'claude-budget' : 'claude-adaptive';
  }
  if (model.includes('deepseek')) return 'deepseek';
  if (model.startsWith('glm-')) return 'glm';
  if (model.startsWith('kimi-') || model.startsWith('moonshot-')) return 'kimi';
  if (/^gpt-(?:3\.5|4(?:[.-]|o|$))/.test(model)) return 'non-reasoning';
  // Custom aliases can choose an explicit adapter. Unknown Chat Completions
  // models get an explicit off request, never an omitted server-default effort.
  return config.protocol === 'anthropic' ? 'claude-adaptive' : 'openai';
}

export function thinkingCapabilities(config: Generator) {
  const adapter = resolveThinkingAdapter(config);
  const model = modelName(config);
  let levels: Effort[] = ['off', 'low', 'medium', 'high'];
  let canDisable = true;
  let note: TranslationKey = 'thinking.note.general';
  if (adapter === 'non-reasoning') { levels = ['off']; note = 'thinking.note.nonReasoning'; }
  if (adapter === 'openai') {
    levels = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
    canDisable = !originalGpt5(model) && !/^(?:o[134](?:-|$)|gpt-6-astra(?:-|$)|gpt-6\.1-sol(?:-|$))/.test(model);
    if (/^gpt-5\.1(?:-|$)/.test(model)) levels = ['off', 'low', 'medium', 'high'];
    else if (/^gpt-5\.[234](?:-|$)/.test(model)) levels = ['off', 'low', 'medium', 'high', 'xhigh'];
    else if (/^o[134](?:-|$)/.test(model)) levels = ['off', 'low', 'medium', 'high'];
    else if (originalGpt5(model)) levels = ['off', 'minimal', 'low', 'medium', 'high'];
    if (model.startsWith('gemini-')) {
      canDisable = /^gemini-2\.5-(?:flash|flash-lite)(?:-|$)/.test(model);
      levels = [...(canDisable ? ['off' as const] : []), 'minimal', 'low', 'medium', 'high'];
    }
  }
  if (adapter === 'qwen') levels = ['off', 'on'];
  if (adapter.startsWith('claude-')) {
    canDisable = !/^claude-(?:fable-|mythos-|opus-5[.-]5)/.test(model);
    note = adapter === 'claude-budget' ? 'thinking.note.budget' : 'thinking.note.adaptive';
  }
  if (adapter === 'deepseek') {
    levels = /^(?:deepseek-(?:v4|flash))/.test(model) ? ['off', 'low', 'high', 'max'] : ['off', 'on'];
    canDisable = !/deepseek-(?:reasoner|r1)(?:-|$)/.test(model);
  }
  if (adapter === 'glm') {
    levels = /^glm-5\.3(?:-|$)/.test(model) ? ['off', 'low', 'high', 'max']
      : /^glm-5\.2(?:-|$)/.test(model) ? ['off', 'high', 'max'] : ['off', 'on'];
    canDisable = !/^glm-5\.3(?:-|$)/.test(model);
  }
  if (adapter === 'kimi') {
    levels = /^kimi-k3(?:-|$)/.test(model) ? ['off', 'low', 'high', 'max'] : ['off', 'on'];
    canDisable = !/^kimi-(?:k3(?:-|$)|k2\.7-code(?:-|$)|k2-thinking(?:-|$))/.test(model);
    if (/^(?:moonshot-|kimi-k2-(?:0905|0711|turbo-preview))/.test(model)) levels = ['off'];
  }
  if (levels.includes('on')) note = 'thinking.note.toggle';
  if (!canDisable) note = 'thinking.note.required';
  return { adapter, levels, canDisable, note };
}

export function thinkingParameters(config: Generator): Record<string, unknown> {
  const { adapter, levels, canDisable } = thinkingCapabilities(config);
  const effort = config.thinkingEffort;
  const model = modelName(config);
  if (!levels.includes(effort)) throw new AppError('messages.this_model_does_not_support_the_selected_reasoning_effort');
  if (effort === 'off' && !canDisable) throw new AppError('messages.reasoning_cannot_be_disabled_for_this_model_choose_a');
  if (adapter === 'non-reasoning') return {};
  if (adapter.startsWith('claude-')) {
    if (config.protocol !== 'anthropic') throw new AppError('model.anthropicProtocol');
    if (effort === 'off') return { thinking: { type: /^claude-sonnet-5[.-]5(?:-|$)/.test(model) ? 'between_tools' : 'disabled' } };
    if (adapter === 'claude-budget') {
      const budget = { low: 1024, medium: 4096, high: 8192 }[effort as 'low' | 'medium' | 'high'];
      return { thinking: { type: 'enabled', budget_tokens: budget }, max_tokens: budget + 4096 };
    }
    return { thinking: { type: 'adaptive' }, output_config: { effort }, max_tokens: 16384 };
  }
  if (config.protocol !== 'openai') throw new AppError('model.openaiProtocol');
  if (adapter === 'openai') return { reasoning_effort: effort === 'off' ? 'none' : effort };
  if (adapter === 'qwen') return { enable_thinking: effort !== 'off' };
  if (adapter === 'kimi' && /^kimi-k3(?:-|$)/.test(model)) return { reasoning_effort: effort };
  if (adapter === 'kimi' && /^kimi-k2\.7-code(?:-|$)/.test(model)) return { thinking: { type: 'enabled', keep: 'all' } };
  if (adapter === 'kimi' && levels.length === 1) return {};
  return {
    thinking: { type: effort === 'off' ? 'disabled' : 'enabled' },
    ...(effort !== 'off' && effort !== 'on' ? { reasoning_effort: effort } : {}),
  };
}
