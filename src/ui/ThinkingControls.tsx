import { adapterLabels, effortLabels, thinkingCapabilities } from '../ai/thinking';
import { thinkingAdapters, type Settings } from '../shared/schemas';
import { useUi } from './preferences';

const englishAdapters = {
  auto: 'Automatic', openai: 'GPT / OpenAI reasoning_effort',
  'claude-adaptive': 'Claude adaptive thinking (4.6 and later)', 'claude-budget': 'Claude thinking budget (3.7 / 4 / 4.5)',
  deepseek: 'DeepSeek', glm: 'GLM', kimi: 'Kimi', qwen: 'Qwen', 'non-reasoning': 'Non-reasoning model (no thinking parameters)',
};
const englishEfforts = { off: 'Off (default)', on: 'On (model default)', minimal: 'Minimal', low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra high', max: 'Maximum' };
const englishNotes: Record<string, string> = {
  '仅影响此处配置的普通大模型。具体可用强度以模型服务支持为准。': 'Applies to this Chat model only. Available levels depend on the service.',
  '只用于本身不具备思考模式的模型，不发送控制参数。': 'For models without a reasoning mode. No thinking parameters are sent.',
  '低 / 中 / 高分别设置 1,024 / 4,096 / 8,192 个思考 token 的预算上限。': 'Low / medium / high set thinking budgets of 1,024 / 4,096 / 8,192 tokens.',
  '使用 Claude 自适应思考与 effort 档位。': 'Uses Claude adaptive thinking and effort levels.',
  '此型号只支持思考开关，不提供可调的低 / 中 / 高档位。': 'This model supports an on/off switch, without adjustable effort levels.',
  '此型号不能关闭思考；保持“关闭”将阻止请求，请主动选择可用强度或更换模型。': 'Thinking cannot be turned off for this model. Select an available level or another model; Off will block requests.',
};

export function ThinkingControls({ config, onChange, prefix = '' }: { config: Settings['generator']; onChange: (config: Settings['generator']) => void; prefix?: string }) {
  const { t } = useUi();
  const thinking = thinkingCapabilities(config);
  return <>
    <label className="config-field"><span>{t('思考参数适配', 'Thinking adapter')}</span><select aria-label={`${prefix}${t('思考参数适配', 'Thinking adapter')}`} value={config.thinkingAdapter} onChange={event => onChange({ ...config, thinkingAdapter: event.target.value as Settings['generator']['thinkingAdapter'], thinkingEffort: 'off' })}>{thinkingAdapters.map(adapter => <option key={adapter} value={adapter}>{t(adapterLabels[adapter], englishAdapters[adapter])}</option>)}</select></label>
    <p className="config-field-note">{t('决定向该服务发送哪种思考控制字段。只有模型别名无法自动识别时才需手动选择。', 'Chooses the reasoning-control fields sent to this service. Select manually only when a model alias is not recognized.')}</p>
    <label className="config-field"><span>{t('思考强度', 'Thinking effort')}</span><select aria-label={`${prefix}${t('思考强度', 'Thinking effort')}`} value={config.thinkingEffort} onChange={event => onChange({ ...config, thinkingEffort: event.target.value as Settings['generator']['thinkingEffort'] })}>
      {!thinking.levels.includes(config.thinkingEffort) && <option value={config.thinkingEffort} disabled>{t(effortLabels[config.thinkingEffort], englishEfforts[config.thinkingEffort])}{t('（此型号不支持，请重新选择）', ' (unsupported; choose another level)')}</option>}
      {thinking.levels.map(effort => <option key={effort} value={effort}>{t(effortLabels[effort], englishEfforts[effort])}</option>)}
    </select></label>
    <p className="config-field-note">{t('控制服务支持的思考档位或预算，可能影响响应时间与费用；不会调整归组分数门槛。', 'Controls supported reasoning effort or budget, which may affect latency and cost. It does not change classification thresholds.')}</p>
    <p className="config-section-help" style={{ marginTop: 16, marginBottom: 0 }}>{t(thinking.note, englishNotes[thinking.note] ?? thinking.note)} {t('自定义模型别名可手动选择适配方式；不会自动更换模型或开启思考。', 'For custom model aliases, choose an adapter manually. The model and thinking mode are never changed automatically.')}</p>
  </>;
}
