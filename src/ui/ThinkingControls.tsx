import { thinkingCapabilities } from '../ai/thinking';
import { thinkingAdapters, type Settings } from '../shared/schemas';
import { useUi } from './preferences';

export function ThinkingControls({ config, onChange, prefix = '' }: { config: Settings['generator']; onChange: (config: Settings['generator']) => void; prefix?: string }) {
  const { t } = useUi();
  const thinking = thinkingCapabilities(config);
  return <>
    <label className="config-field"><span>{t('ui.thinking_adapter')}</span><select aria-label={`${prefix}${t('ui.thinking_adapter')}`} value={config.thinkingAdapter} onChange={event => onChange({ ...config, thinkingAdapter: event.target.value as Settings['generator']['thinkingAdapter'], thinkingEffort: 'off' })}>{thinkingAdapters.map(adapter => <option key={adapter} value={adapter}>{t(`thinking.adapter.${adapter}`)}</option>)}</select></label>
    <p className="config-field-note">{t('ui.chooses_the_reasoning_control_fields_sent_to_this_service')}</p>
    <label className="config-field"><span>{t('ui.thinking_effort')}</span><select aria-label={`${prefix}${t('ui.thinking_effort')}`} value={config.thinkingEffort} onChange={event => onChange({ ...config, thinkingEffort: event.target.value as Settings['generator']['thinkingEffort'] })}>
      {!thinking.levels.includes(config.thinkingEffort) && <option value={config.thinkingEffort} disabled>{t(`thinking.effort.${config.thinkingEffort}`)}{t('ui.unsupported_choose_another_level')}</option>}
      {thinking.levels.map(effort => <option key={effort} value={effort}>{t(`thinking.effort.${effort}`)}</option>)}
    </select></label>
    <p className="config-field-note">{t('ui.controls_supported_reasoning_effort_or_budget_which_may_affect')}</p>
    <p className="config-section-help" style={{ marginTop: 16, marginBottom: 0 }}>{t(thinking.note)} {t('ui.for_custom_model_aliases_choose_an_adapter_manually_the')}</p>
  </>;
}
