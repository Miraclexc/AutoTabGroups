import type { Settings } from '../shared/schemas';

type Generator = Settings['generator'];
type Effort = Generator['thinkingEffort'];
type Adapter = Exclude<Generator['thinkingAdapter'], 'auto'>;
export const effortLabels: Record<Effort, string> = {
  off: '关闭（默认）', on: '开启（模型默认强度）', minimal: '极低', low: '低', medium: '中', high: '高', xhigh: '极高', max: '最高',
};
export const adapterLabels: Record<Generator['thinkingAdapter'], string> = {
  auto: '自动识别', openai: 'GPT / OpenAI reasoning_effort',
  'claude-adaptive': 'Claude 自适应思考（4.6 及更新）', 'claude-budget': 'Claude 思考预算（3.7 / 4 / 4.5）',
  deepseek: 'DeepSeek', glm: 'GLM', kimi: 'Kimi', 'non-reasoning': '普通非推理模型（不发送思考参数）',
};
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
  let note = '仅影响此处配置的普通大模型。具体可用强度以模型服务支持为准。';
  if (adapter === 'non-reasoning') { levels = ['off']; note = '只用于本身不具备思考模式的模型，不发送控制参数。'; }
  if (adapter === 'openai') {
    levels = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
    canDisable = !originalGpt5(model) && !/^(?:o[134](?:-|$)|gpt-6-astra(?:-|$)|gpt-6\.1-sol(?:-|$))/.test(model);
    if (/^gpt-5\.1(?:-|$)/.test(model)) levels = ['off', 'low', 'medium', 'high'];
    else if (/^gpt-5\.[234](?:-|$)/.test(model)) levels = ['off', 'low', 'medium', 'high', 'xhigh'];
    else if (/^o[134](?:-|$)/.test(model)) levels = ['off', 'low', 'medium', 'high'];
    else if (originalGpt5(model)) levels = ['off', 'minimal', 'low', 'medium', 'high'];
  }
  if (adapter.startsWith('claude-')) {
    canDisable = !/^claude-(?:fable-|mythos-|opus-5[.-]5)/.test(model);
    note = adapter === 'claude-budget' ? '低 / 中 / 高分别设置 1,024 / 4,096 / 8,192 个思考 token 的预算上限。' : '使用 Claude 自适应思考与 effort 档位。';
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
  if (levels.includes('on')) note = '此型号只支持思考开关，不提供可调的低 / 中 / 高档位。';
  if (!canDisable) note = '此型号不能关闭思考；保持“关闭”将阻止请求，请主动选择可用强度或更换模型。';
  return { adapter, levels, canDisable, note };
}

export function thinkingParameters(config: Generator): Record<string, unknown> {
  const { adapter, levels, canDisable } = thinkingCapabilities(config);
  const effort = config.thinkingEffort;
  const model = modelName(config);
  if (!levels.includes(effort)) throw new Error('此模型不支持所选思考强度，请在设置中重新选择');
  if (effort === 'off' && !canDisable) throw new Error('此模型无法关闭思考，请选择可用思考强度或更换模型；未发送请求');
  if (adapter === 'non-reasoning') return {};
  if (adapter.startsWith('claude-')) {
    if (config.protocol !== 'anthropic') throw new Error('Claude 思考适配需要 Anthropic Messages 协议；转译网关请按其协议手动选择适配方式');
    if (effort === 'off') return { thinking: { type: /^claude-sonnet-5[.-]5(?:-|$)/.test(model) ? 'between_tools' : 'disabled' } };
    if (adapter === 'claude-budget') {
      const budget = { low: 1024, medium: 4096, high: 8192 }[effort as 'low' | 'medium' | 'high'];
      return { thinking: { type: 'enabled', budget_tokens: budget }, max_tokens: budget + 4096 };
    }
    return { thinking: { type: 'adaptive' }, output_config: { effort }, max_tokens: 16384 };
  }
  if (config.protocol !== 'openai') throw new Error('所选思考适配需要 OpenAI Chat Completions 协议；请调整接口协议或适配方式');
  if (adapter === 'openai') return { reasoning_effort: effort === 'off' ? 'none' : effort };
  if (adapter === 'kimi' && /^kimi-k3(?:-|$)/.test(model)) return { reasoning_effort: effort };
  if (adapter === 'kimi' && /^kimi-k2\.7-code(?:-|$)/.test(model)) return { thinking: { type: 'enabled', keep: 'all' } };
  if (adapter === 'kimi' && levels.length === 1) return {};
  return {
    thinking: { type: effort === 'off' ? 'disabled' : 'enabled' },
    ...(effort !== 'off' && effort !== 'on' ? { reasoning_effort: effort } : {}),
  };
}
