import { msg, type UserMessage } from '../i18n';
import { AppError } from '../shared/errors';
import { useEffect, useId, useRef, useState } from 'react';
import { dispatch, actionNames, type OrganizerState } from '../shared/organizer';
import { settingsSchema, type Settings } from '../shared/schemas';
import { chatPlatform, chatPreset, chatPresets, sameChatOrigin, selectChatPlatform, type ChatPlatformId } from '../shared/chat-platforms';
import { errorForDisplay } from '../shared/errors';
import { ThinkingControls } from './ThinkingControls';
import { RecentActivity } from './RecentActivity';
import { UndoGrouping } from './UndoGrouping';
import { useUi } from './preferences';
import { Brand, DisclosureSummary, Icon, Modal, useConfirm } from './components';
import { localizeMessage } from './messages';
import './configuration.css';

const sections = [
  { id: 'general', icon: 'settings' },
  { id: 'services', icon: 'model' },
  { id: 'advanced', icon: 'database' },
] as const;
type SectionId = typeof sections[number]['id'];
type TestResult = { status: 'idle' | 'running' | 'success' | 'error'; message?: UserMessage };
const emptyTests: Record<'generator' | 'classifier' | 'reader', TestResult> = { generator: { status: 'idle' }, classifier: { status: 'idle' }, reader: { status: 'idle' } };
// Keep previously shared settings links useful after the navigation change.
const sectionFromHash = (): SectionId => {
  const id = window.location.hash.slice(1);
  return sections.find(section => section.id === id)?.id ?? (id === 'models' || id === 'reading' ? 'services' : id === 'data' ? 'advanced' : 'general');
};

export function Configuration({ state, windowId, refresh }: { state: OrganizerState; windowId: number; refresh: () => Promise<void> }) {
  const { t, locale, theme, savePreferences, preferenceBusy, preferenceError } = useUi();
  const { confirm, confirmation } = useConfirm();
  const [section, setSection] = useState<SectionId>(sectionFromHash);
  const [settings, setSettings] = useState(state.settings);
  const [revision, setRevision] = useState(state.revision);
  const [dirty, setDirty] = useState(false);
  const [generatorKey, setGeneratorKey] = useState<string>();
  const [classifierKey, setClassifierKey] = useState<string>();
  const [readerKeys, setReaderKeys] = useState<{ tavily?: string; deepseek?: string }>({});
  const [keyVisible, setKeyVisible] = useState({ generator: false, classifier: false, tavily: false, deepseek: false });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<UserMessage>('');
  const [error, setError] = useState<UserMessage>('');
  const [feedbackArea, setFeedbackArea] = useState<'page' | 'data'>('page');
  const [savedRefreshFailed, setSavedRefreshFailed] = useState(false);
  const [tests, setTests] = useState(emptyTests);
  const [commands, setCommands] = useState<chrome.commands.Command[]>([]);
  const [commandError, setCommandError] = useState(false);
  const [importPreview, setImportPreview] = useState<{ data: unknown; profileCount: number; message: UserMessage; revision: number; changes: UserMessage[] }>();
  const draftVersion = useRef(0);
  // Storage/tab refreshes may commit while an input event is starting. Protect
  // the draft synchronously, before React commits the dirty-state render.
  const dirtyRef = useRef(false);
  const savedDraftVersion = useRef<number | undefined>(undefined);
  const savedRevisionFloor = useRef(state.revision);
  const file = useRef<HTMLInputElement>(null);
  const readerOptionsId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const dataFeedback = useRef<HTMLDivElement>(null);
  const operationRunning = useRef(false);
  const activeSection = useRef(section);
  // A committed draft can still be retained while its read-back is unavailable.
  // Only edits made after that commit should be described as unsaved.
  const hasUnsavedChanges = dirty && (savedDraftVersion.current === undefined || savedDraftVersion.current !== draftVersion.current);
  useEffect(() => { activeSection.current = section; setNotice(''); }, [section]);
  useEffect(() => {
    if (section === 'advanced' && feedbackArea === 'data' && (notice || error)) dataFeedback.current?.scrollIntoView({ block: 'nearest', behavior: 'instant' });
  }, [section, feedbackArea, notice, error]);
  useEffect(() => {
    if (!dirtyRef.current && state.revision >= savedRevisionFloor.current) { setSettings(state.settings); setRevision(state.revision); }
  }, [state.settings, state.revision, dirty]);
  useEffect(() => {
    const update = () => {
      void chrome.commands.getAll().then(value => { setCommands(value); setCommandError(false); }).catch(() => { setCommands([]); setCommandError(true); });
    };
    update(); window.addEventListener('focus', update);
    return () => window.removeEventListener('focus', update);
  }, []);
  useEffect(() => {
    const update = () => setSection(sectionFromHash());
    window.addEventListener('hashchange', update);
    return () => window.removeEventListener('hashchange', update);
  }, []);
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => { if (hasUnsavedChanges) event.preventDefault(); };
    window.addEventListener('beforeunload', beforeUnload); return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [hasUnsavedChanges]);
  const patch = (value: Partial<Settings>) => {
    draftVersion.current++; dirtyRef.current = true;
    setSettings(current => ({ ...current, ...value })); dirtyRef.current = true; setDirty(true); setNotice(''); setTests(emptyTests);
  };
  const act = async (operation: () => Promise<unknown>, message?: UserMessage, refreshAfter = true, area: 'page' | 'data' = 'page') => {
    if (operationRunning.current) return false;
    operationRunning.current = true;
    setBusy(true); setError(''); setNotice(''); setFeedbackArea(area);
    try { await operation(); if (refreshAfter) await refresh(); if (message && activeSection.current === section) setNotice(message); return true; }
    catch (error) { setError(errorForDisplay(error)); return false; }
    finally { operationRunning.current = false; setBusy(false); }
  };
  const dataAction = (operation: () => Promise<unknown>, message?: UserMessage) => act(operation, message, true, 'data');
  const refreshSavedConfiguration = async () => {
    try { await refresh(); }
    catch {
      setSavedRefreshFailed(true);
      throw new AppError('messages.settings_were_saved_but_the_view_could_not_refresh');
    }
    setSavedRefreshFailed(false);
    if (savedDraftVersion.current === draftVersion.current) {
      dirtyRef.current = false; setDirty(false); setGeneratorKey(undefined); setClassifierKey(undefined); setReaderKeys({}); setKeyVisible({ generator: false, classifier: false, tavily: false, deepseek: false });
    } else {
      setNotice(msg('messages.refresh_complete_your_newer_edits_are_preserved_review_the'));
    }
    savedDraftVersion.current = undefined;
  };
  const save = async () => {
    await dispatch({ type: 'save-config', settings: settingsSchema.parse(settings), revision, generatorKey, classifierKey, readerKeys });
    savedDraftVersion.current = draftVersion.current;
    savedRevisionFloor.current = revision + 1;
    await refreshSavedConfiguration();
  };
  const test = (provider: 'generator' | 'classifier' | 'reader') => act(async () => {
    const version = draftVersion.current;
    setTests(current => ({ ...current, [provider]: { status: 'running' } }));
    try {
      await dispatch<UserMessage>(provider === 'reader' ? { type: 'test-reader', settings: settingsSchema.parse(settings), readerKeys } : { type: 'test-config', provider, settings: settingsSchema.parse(settings), generatorKey, classifierKey });
      if (version === draftVersion.current) setTests(current => ({ ...current, [provider]: { status: 'success' } }));
    } catch (error) {
      if (version !== draftVersion.current) return;
      setTests(current => ({ ...current, [provider]: { status: 'error', message: errorForDisplay(error) } })); throw error;
    }
  });
  const locked = busy || state.busy || savedRefreshFailed;
  const conflict = dirty && revision !== state.revision;
  const formSection = section === 'services' || section === 'advanced';
  const reload = async () => {
    if (dirty && !await confirm({ title: msg('messages.reload_saved_settings'), message: msg('messages.unsaved_model_and_reading_settings_will_be_discarded'), confirmLabel: msg('messages.discard_reload') })) return;
    draftVersion.current++;
    dirtyRef.current = false; setDirty(false); setSettings(state.settings); setRevision(state.revision); setGeneratorKey(undefined); setClassifierKey(undefined); setReaderKeys({}); setTests(emptyTests); setNotice(''); setError('');
  };
  const chooseSection = (id: SectionId, focusHeading = true) => {
    setSection(id); window.history.replaceState(null, '', `#${id}`);
    requestAnimationFrame(() => { window.scrollTo({ top: 0, behavior: 'instant' }); if (focusHeading) heading.current?.focus({ preventScroll: true }); });
  };
  const keyField = (provider: 'generator' | 'classifier' | 'tavily' | 'deepseek') => {
    const value = provider === 'generator' ? generatorKey : provider === 'classifier' ? classifierKey : readerKeys[provider];
    const set = (value: string | undefined) => { if (provider === 'generator') setGeneratorKey(value); else if (provider === 'classifier') setClassifierKey(value); else setReaderKeys(keys => ({ ...keys, [provider]: value })); };
    const hasKey = provider === 'generator' ? state.hasGeneratorKey && (!chatPreset(settings.generator) || sameChatOrigin(settings.generator, state.settings.generator)) : provider === 'classifier' ? state.hasClassifierKey : state.hasReaderKeys[provider];
    const role = provider === 'generator' ? t('ui.chat_service') : provider === 'classifier' ? t('ui.classification_service') : provider === 'tavily' ? 'Tavily' : 'DeepSeek Fetch';
    return <div className="config-key-field">
      <label className="config-field"><span>API Key</span><span className="config-key-input">
        <input aria-label={`${role} API Key`} type={keyVisible[provider] ? 'text' : 'password'} autoComplete="off" spellCheck={false} value={value ?? ''}
          placeholder={savedRefreshFailed ? t('ui.refresh_to_confirm_the_saved_state') : hasKey ? t('ui.saved_leave_blank_to_keep') : provider === 'generator' && chatPreset(settings.generator) ? t('ui.enter_the_selected_platform_s_api_key') : provider === 'tavily' || provider === 'deepseek' ? t('ui.enter_the_reader_api_key') : t('ui.optional_for_services_without_authentication')}
          onChange={e => { draftVersion.current++; set(e.target.value || (provider === 'generator' && !!chatPreset(settings.generator) && !sameChatOrigin(settings.generator, state.settings.generator) ? '' : undefined)); dirtyRef.current = true; setDirty(true); setNotice(''); setTests(emptyTests); }} />
        <button type="button" className="icon-button" aria-label={keyVisible[provider] ? t('ui.hide_entered_key') : t('ui.show_entered_key')} aria-pressed={keyVisible[provider]} onClick={() => setKeyVisible(current => ({ ...current, [provider]: !current[provider] }))}><Icon name={keyVisible[provider] ? 'eye-off' : 'eye'} /></button>
      </span></label>
      <div className="config-field-note config-key-actions"><span>{savedRefreshFailed ? t('ui.refresh_to_confirm_the_saved_key_state') : value === '' && provider === 'generator' && !hasKey ? t('ui.no_saved_key') : value === '' ? t('ui.this_key_will_be_cleared_when_you_save') : value ? t('ui.the_entered_key_has_not_been_saved') : hasKey ? t('ui.a_key_is_saved_on_this_device') : t('ui.no_saved_key')}</span>
        {(hasKey || value) && <button type="button" className="text-button" disabled={locked} onClick={async () => {
          if (!await confirm({ title: msg('messages.clear_this_service_key'), message: msg('messages.the_key_is_removed_only_after_saving_you_can'), confirmLabel: msg('messages.mark_for_removal'), danger: true })) return;
          draftVersion.current++; set(''); dirtyRef.current = true; setDirty(true); setTests(emptyTests);
        }}>{t('ui.clear_key')}</button>}
      </div>
    </div>;
  };
  const testRow = (provider: 'generator' | 'classifier' | 'reader') => {
    const result = tests[provider];
    const status = result.status === 'running' ? t('ui.testing') : result.status === 'success' ? t('ui.connected_current_draft') : result.status === 'error' ? t('ui.test_failed') : (provider === 'reader' ? true : provider === 'generator' ? settings.generator.model : settings.classifierUseChat ? settings.generator.model : settings.classifier.model) ? t('ui.current_settings_have_not_been_tested') : t('ui.enter_a_model_name');
    return <div className={`config-special-card config-test-row ${result.status}`}><div><h3>{provider === 'reader' ? t('ui.reader_connection') : t('ui.service_connection')}</h3><span className={`config-test-status ${result.status}`} role="status">{result.status === 'success' && <Icon name="check" size={15} />}{status}</span></div>
      <button type="button" className="secondary" disabled={locked} onClick={() => void test(provider)}>{provider === 'reader' ? t('ui.test_reader_no_save') : provider === 'generator' ? t('ui.test_chat_connection_no_save') : t('ui.test_classification_no_save')}</button>
    </div>;
  };
  const currentSection = sections.find(item => item.id === section)!;
  const descriptions: Record<SectionId, string> = {
    general: t('ui.set_everyday_preferences_check_shortcuts_and_review_recent_activity'),
    services: t('ui.connect_your_models_and_choose_basic_page_details_or'),
    advanced: t('ui.tune_classification_and_reading_limits_and_manage_local_data'),
  };
  return <div className="config-shell">
    <header className="config-header"><div className="config-brand"><Brand /><span className="config-product-section">{t('ui.settings')}</span></div><span className="config-header-meta">{t(`language.${locale}`)} · {theme === 'system' ? t('ui.system') : theme === 'light' ? t('ui.light') : t('ui.dark')}</span></header>
    <div className="config-body">
      <nav aria-label={t('ui.settings_sections')} className="config-navigation"><div role="tablist" aria-label={t('ui.settings_sections')} className="config-nav">{sections.map((item, index) => <button type="button" role="tab" id={`tab-${item.id}`} aria-label={t(`section.${item.id}`)} aria-controls={`panel-${item.id}`} aria-selected={section === item.id} tabIndex={section === item.id ? 0 : -1} key={item.id} onClick={() => chooseSection(item.id, false)} onKeyDown={event => {
        const next = event.key === 'ArrowRight' ? (index + 1) % sections.length : event.key === 'ArrowLeft' ? (index + sections.length - 1) % sections.length : event.key === 'Home' ? 0 : event.key === 'End' ? sections.length - 1 : undefined;
        if (next === undefined) return;
        event.preventDefault(); chooseSection(sections[next].id, false); document.getElementById(`tab-${sections[next].id}`)?.focus();
      }}><Icon name={item.icon} /><span>{t(`section.${item.id}`)}</span>{hasUnsavedChanges && item.id !== 'general' && <span className="config-dirty-dot" aria-label={t('ui.unsaved_settings')} />}</button>)}</div></nav>
      <main className="config-content" role="tabpanel" id={`panel-${section}`} aria-labelledby={`tab-${section}`} tabIndex={-1}>
        <div className="config-page-intro"><h1 ref={heading} tabIndex={-1}>{t(`section.${currentSection.id}`)}</h1><p>{descriptions[section]}</p></div>
        {((error && (feedbackArea === 'page' || section !== 'advanced')) || savedRefreshFailed) && <div className="alert error" role="alert"><p>{savedRefreshFailed ? t('messages.settings_were_saved_but_the_view_could_not_refresh') : localizeMessage(error, locale)}</p>{savedRefreshFailed && <button type="button" className="config-refresh-retry" disabled={busy} onClick={() => void act(refreshSavedConfiguration, undefined, false)}>{t('ui.retry_refresh')}</button>}</div>}
        {notice && (feedbackArea === 'page' || section !== 'advanced') && <p className="alert" role="status">{localizeMessage(notice, locale)}</p>}
        {state.busy && formSection && <p className="alert" role="status">{t('ui.an_organizing_task_is_running_you_can_edit_your')}</p>}
        {conflict && !savedRefreshFailed && <p className="alert error" role="alert">{t('ui.settings_or_group_descriptions_changed_elsewhere_your_draft_is')}</p>}
        {section === 'general' && <section className="config-pane" id="preferences">
          {!settings.generator.model.trim() && <div className="config-special-card config-setup"><div><h2>{t('ui.connect_a_model_to_get_started')}</h2><p>{t('ui.set_up_your_chat_service_then_return_to_the')}</p></div><button onClick={() => chooseSection('services')}>{t('ui.set_up_services')}<Icon name="chevron" size={15} /></button></div>}
          <fieldset className="config-service" disabled={preferenceBusy}><legend>{t('ui.appearance_language')}</legend>
            <label className="config-field"><span>{t('ui.interface_theme')}</span><select aria-label={t('ui.interface_theme')} value={theme} onChange={e => void savePreferences({ theme: e.target.value as 'light' | 'dark' | 'system' })}><option value="system">{t('ui.system')}</option><option value="light">{t('ui.light')}</option><option value="dark">{t('ui.dark')}</option></select></label>
            <p className="config-field-note">{t('ui.shared_by_the_sidebar_and_settings_system_follows_your')}</p>
            <label className="config-field"><span>{t('ui.interface_language')}</span><select aria-label={t('ui.interface_language')} value={locale} onChange={e => void savePreferences({ locale: e.target.value as 'zh-CN' | 'en' })}><option value="zh-CN">{t('language.zh-CN')}</option><option value="en">{t('language.en')}</option></select></label>
            <p className="config-field-note">{t('ui.new_ai_generated_group_names_and_descriptions_use_this')}</p>
            <p className="config-preference-status" role="status">{preferenceBusy ? t('ui.saving_preferences') : t('ui.preferences_save_automatically')}</p>{preferenceError && <p className="alert error" role="alert">{preferenceError}</p>}
          </fieldset>
        </section>}
        {formSection && <form id="model-settings" onFocusCapture={event => {
          const target = event.target as HTMLElement;
          const savebar = event.currentTarget.querySelector<HTMLElement>('.config-savebar');
          if (!savebar || target.closest('.config-savebar')) return;
          requestAnimationFrame(() => {
            if (!target.isConnected) return;
            const focused = target.getBoundingClientRect();
            const bar = savebar.getBoundingClientRect();
            if (bar.top < window.innerHeight && focused.bottom > bar.top - 16 && focused.top < bar.bottom) {
              window.scrollBy({ top: focused.bottom - bar.top + 16, behavior: 'instant' });
            }
          });
        }} onSubmit={e => { e.preventDefault(); if (!locked && !conflict) void act(save, undefined, false); }}>
          {section === 'services' && <>
            <fieldset className="config-service" disabled={busy}><legend><span className="config-step">1</span>{t('ui.standard_chat_service_required')}</legend>
              <p className="config-section-help">{t('ui.generates_group_descriptions_proposes_new_groups_and_can_classify')}</p>
              <ChatFields config={settings.generator} change={generator => patch({ generator })} platforms onPlatformChange={generator => {
                if (!sameChatOrigin(settings.generator, generator)) {
                  setGeneratorKey(sameChatOrigin(generator, state.settings.generator) ? undefined : '');
                  setKeyVisible(current => ({ ...current, generator: false }));
                }
                patch({ generator });
              }} />
              {keyField('generator')}{testRow('generator')}
            </fieldset>
            <fieldset className="config-service" disabled={busy}><legend><span className="config-step">2</span>{t('ui.classification_service_2')}</legend>
              <label className="config-field config-switch-row"><span>{t('ui.use_the_standard_chat_service')}</span><input type="checkbox" aria-label={t('ui.use_the_standard_chat_service')} checked={settings.classifierUseChat} onChange={e => patch({ classifierUseChat: e.target.checked })} /></label><p className="config-field-note">{t('ui.use_the_settings_above_without_a_second_key_turn')}</p>
              {!settings.classifierUseChat && <div className="config-independent">
                <label className="config-field"><span>{t('ui.classification_backend')}</span><select aria-label={t('ui.classification_backend')} value={settings.classifier.backend} onChange={e => patch({ classifier: { ...settings.classifier, backend: e.target.value as Settings['classifier']['backend'] } })}><option value="llm">{t('ui.chat_model')}</option><option value="jev">{t('ui.jev_decision_model')}</option><option value="openai-decisions">OpenAI Decisions</option></select></label>
                {settings.classifier.backend === 'llm' ? <ChatFields config={settings.classifier} change={config => patch({ classifier: { ...settings.classifier, ...config } })} /> : <>
                  <label className="config-field"><span>{t('ui.full_endpoint_url')}</span><input type="url" required value={settings.classifier.baseUrl} spellCheck={false} onChange={e => patch({ classifier: { ...settings.classifier, baseUrl: e.target.value } })} /></label>
                  <p className="config-field-note">{t('ui.used_as_entered_without_an_added_path_check_the')}</p>
                  <label className="config-field"><span>{t('ui.classification_model')}</span><input value={settings.classifier.model} spellCheck={false} onChange={e => patch({ classifier: { ...settings.classifier, model: e.target.value } })} /></label>
                </>}{keyField('classifier')}
              </div>}{testRow('classifier')}
            </fieldset>
            <p className="config-privacy"><Icon name="info" size={16} /><span>{t('ui.chat_and_classification_tests_send_fictional_content_and_make')}</span></p>
          <fieldset className="config-service config-reader" disabled={busy}><legend><span className="config-step">3</span>{t('ui.page_reading')}</legend>
            <label className="config-field config-switch-row"><span>{t('ui.read_page_content')}</span><input type="checkbox" checked={settings.readContent} aria-controls={readerOptionsId} aria-describedby={`${readerOptionsId}-hint`} onChange={e => patch({ readContent: e.target.checked })} /></label>
            <p className="config-field-note" id={`${readerOptionsId}-hint`}>{t('ui.used_for_classification_and_group_descriptions_when_off_only')}</p>
            <div id={readerOptionsId} hidden={!settings.readContent}>{settings.readContent && <>
              <label className="config-field"><span>{t('ui.content_reader')}</span><select aria-label={t('ui.content_reader')} value={settings.reader.provider} onChange={e => patch({ reader: { ...settings.reader, provider: e.target.value as Settings['reader']['provider'] } })}><option value="local">{t('ui.built_in_reader_local_extraction')}</option><option value="tavily">Tavily Extract</option><option value="deepseek">DeepSeek Fetch</option></select></label>
              <p className="config-field-note">{settings.reader.provider === 'local' ? t('ui.extracts_the_loaded_page_without_an_extra_api_forms') : t('ui.only_the_cleaned_url_is_sent_to_the_reader')}</p>
              {settings.reader.provider !== 'local' && <>
                <label className="config-field"><span>{t('ui.reader_endpoint_url')}</span><input aria-label={t('ui.reader_endpoint_url')} type="url" required value={settings.reader[settings.reader.provider].endpoint} onChange={e => { const provider = settings.reader.provider; if (provider !== 'local') patch({ reader: { ...settings.reader, [provider]: { ...settings.reader[provider], endpoint: e.target.value } } }); }} /></label>
                <p className="config-field-note">{t('ui.the_full_endpoint_is_used_as_entered_each_service')}</p>
                {keyField(settings.reader.provider)}{testRow('reader')}
                <p className="config-section-help">{t('ui.the_test_fetches_public_example_com_not_your_tabs')}</p>
              </>}
            </>}</div>
          </fieldset>
          <div className="config-section-link"><span>{t('ui.need_to_tune_scores_reading_limits_or_reasoning')}</span><button type="button" className="text-button" onClick={() => chooseSection('advanced')}>{t('ui.open_advanced')}<Icon name="chevron" size={15} /></button></div>
          </>}
          {section === 'advanced' && <div className="config-global-advanced">
            <p className="config-section-help">{t('ui.defaults_suit_everyday_use_saved_changes_apply_to_the')}</p>
            <fieldset className="config-service" disabled={busy}><legend>{t('ui.classification')}</legend>
              <NumberInput label={t('ui.minimum_score')} help={t('ui.leave_a_tab_ungrouped_if_its_best_score_is')} value={settings.minProbability} min={0} max={1} step={0.05} change={minProbability => patch({ minProbability })} />
              <NumberInput label={t('ui.minimum_score_margin')} help={t('ui.the_best_candidate_must_lead_the_alternatives_including_no')} value={settings.minMargin} min={0} max={1} step={0.05} change={minMargin => patch({ minMargin })} />
              <NumberInput label={t('ui.maximum_proposed_groups')} help={t('ui.caps_proposals_when_creation_is_allowed_it_is_not')} value={settings.maxGroups} min={2} max={30} change={maxGroups => patch({ maxGroups })} />
            </fieldset>
            <fieldset className="config-service" disabled={busy}><legend>{t('ui.content_and_input_limits')}</legend>
              <NumberInput label={t('ui.content_characters_per_page')} help={t('ui.truncates_both_local_and_remote_page_content_larger_values')} value={settings.maxContentChars} min={500} max={20000} change={maxContentChars => patch({ maxContentChars })} />
              <NumberInput label={t('ui.request_input_budget')} help={t('ui.limits_page_and_candidate_input_per_request_in_utf')} value={settings.requestBudget} min={4000} max={100000} change={requestBudget => patch({ requestBudget })} />
              {settings.readContent && settings.reader.provider !== 'local' && <>
                <NumberInput label={t('ui.reader_timeout_seconds')} help={t('ui.maximum_wait_for_a_reader_request_timeouts_follow_the')} value={settings.reader.timeoutSeconds} min={5} max={60} change={timeoutSeconds => patch({ reader: { ...settings.reader, timeoutSeconds } })} />
                {settings.reader.provider === 'tavily' && <><label className="config-field"><span>{t('ui.tavily_extraction_depth')}</span><select aria-label={t('ui.tavily_extraction_depth')} value={settings.reader.tavily.depth} onChange={e => patch({ reader: { ...settings.reader, tavily: { ...settings.reader.tavily, depth: e.target.value as 'basic' | 'advanced' } } })}><option value="basic">{t('ui.basic')}</option><option value="advanced">{t('ui.advanced')}</option></select></label><p className="config-field-note">{t('ui.advanced_extraction_handles_more_complex_page_structures_and_may')}</p></>}
                <label className="config-field config-switch-row"><span>{t('ui.use_the_local_reader_if_remote_extraction_fails')}</span><input type="checkbox" checked={settings.reader.fallback} onChange={e => patch({ reader: { ...settings.reader, fallback: e.target.checked } })} /></label><p className="config-field-note">{t('ui.on_try_local_content_then_basic_details_off_fail')}</p>
              </>}
            </fieldset>
            <fieldset className="config-service" disabled={busy}><legend>{t('ui.chat_reasoning')}</legend><h3>{t('ui.standard_chat_service')}</h3><ThinkingControls config={settings.generator} onChange={generator => patch({ generator })} prefix={t('ui.chat_service_2')} />
              {!settings.classifierUseChat && settings.classifier.backend === 'llm' && <><h3>{t('ui.independent_classification_chat')}</h3><ThinkingControls config={settings.classifier} onChange={classifier => patch({ classifier: { ...settings.classifier, ...classifier } })} prefix={t('ui.classification_service_3')} /></>}
            </fieldset>
            <div className="config-rule-note"><Icon name="info" size={18} /><p>{t('ui.ai_created_groups_always_need_at_least_3_clear')}</p></div>
          </div>}
          <div className="config-savebar"><span className="config-save-status" role="status">{savedRefreshFailed ? hasUnsavedChanges ? t('ui.refresh_needed_newer_edits_are_unsaved') : t('ui.refresh_needed') : dirty ? t('ui.unsaved_changes') : <><Icon name="check" size={15} />{t('ui.saved')}</>}</span><div className="buttons"><button type="button" className="secondary" disabled={busy || savedRefreshFailed} onClick={() => void reload()}>{t('ui.reload_saved_settings')}</button><button className="primary" disabled={locked || conflict || !dirty}>{busy ? t('ui.working_2') : t('ui.save_settings')}</button></div></div>
        </form>}
        {section === 'general' && <section className="config-pane" id="shortcuts"><h2 className="config-section-title">{t('ui.keyboard_shortcuts')}</h2>
          {commandError && <p className="alert error" role="alert">{t('ui.could_not_read_shortcuts_return_to_this_page_to')}</p>}
          <div className="config-shortcuts">{actionNames.map((name, i) => <div className="config-shortcut" key={name}><div><h2>{t(`actions.${name}`)}</h2><p>{i === 0 ? t('ui.current_ungrouped_tab_existing_groups') : i === 1 ? t('ui.ungrouped_tabs_in_this_window_initializes_if_no_groups') : t('ui.match_existing_groups_then_consider_new_groups')}</p><small>{t('ui.suggested')}{i === 0 ? 'Alt+1' : i === 1 ? 'Alt+Shift+1' : 'Alt+Shift+2'}</small></div><kbd>{commandError ? t('ui.unavailable_2') : commands.find(c => c.name === name)?.shortcut || t('ui.unassigned')}</kbd></div>)}</div>
          <div className="config-action-row"><button className="primary" disabled={busy} onClick={() => void act(() => chrome.tabs.create({ url: 'chrome://extensions/shortcuts' }))}>{t('ui.manage_shortcuts_in_chrome')}<Icon name="external" size={16} /></button></div>

        </section>}
        {section === 'general' && <div className="config-undo"><UndoGrouping state={state} windowId={windowId} disabled={locked} onUndo={() => void act(async () => { setNotice(await dispatch<UserMessage>({ type: 'undo' })); })} /></div>}
        {section === 'general' && <details className="config-special-card config-activity" id="activity"><DisclosureSummary><span><strong>{t('ui.recent_activity')}</strong><small>{t('ui.review_the_latest_results_reassess_tabs_or_move_them')}</small></span></DisclosureSummary><RecentActivity state={state} windowId={windowId} refresh={refresh} onOpenSettings={() => chooseSection('services')} /></details>}
        {section === 'advanced' && <section className="config-pane config-tools" id="data"><h2 className="config-section-title">{t('ui.data_diagnostics')}</h2>
          <div ref={dataFeedback}>{feedbackArea === 'data' && error && <p className="alert error" role="alert">{localizeMessage(error, locale)}</p>}
          {feedbackArea === 'data' && notice && <p className="alert success" role="status">{localizeMessage(notice, locale)}</p>}</div>
          <div className="config-data-grid">
          <section className="config-data-section config-special-card"><div className="config-data-heading"><Icon name="database" size={20} /><h3>{t('ui.settings_backup')}</h3></div><p>{t('ui.back_up_model_settings_and_group_descriptions_keys_page')}</p>{dirty && <p className="config-import-hint"><Icon name="info" size={14} /><span>{savedRefreshFailed ? t('ui.refresh_to_confirm_saved_settings_before_importing') : t('ui.save_or_reload_your_model_and_reading_draft_before')}</span></p>}<div className="buttons config-data-actions"><button disabled={locked} onClick={() => void dataAction(async () => {
            const data = await dispatch({ type: 'export-config' });
            const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
            const a = document.createElement('a'); a.href = url; a.download = 'autotabgroups-config.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
          }, msg('ui.backup_file_generated'))}>{t('ui.export_settings_descriptions')}</button><button disabled={locked || dirty} onClick={() => file.current?.click()}>{t('ui.import_settings_descriptions')}</button></div>

          <input ref={file} hidden type="file" accept=".json,application/json" onChange={e => {
            const selected = e.target.files?.[0]; e.target.value = '';
            if (selected) void dataAction(async () => {
              if (selected.size > 5_000_000) throw new AppError('ui.choose_a_settings_file_smaller_than_5_mb');
              setImportPreview(await dispatch({ type: 'preview-import', data: JSON.parse(await selected.text()) }));
            });
          }} /></section>
          <section className="config-data-section config-special-card"><div className="config-data-heading"><Icon name="refresh" size={20} /><h3>{t('ui.classification_cache')}</h3></div><p>{t('ui.reuse_earlier_decisions_to_reduce_repeat_requests_clearing_the')}</p><div className="buttons config-data-actions"><button disabled={locked} onClick={() => void dataAction(() => dispatch({ type: 'clear-cache' }), msg('ui.classification_cache_cleared'))}>{t('ui.clear_cache')}</button></div></section>
          </div>
          <details className="config-advanced config-data-disclosure"><DisclosureSummary>{t('ui.data_sharing_local_storage')}</DisclosureSummary><p>{t('ui.organizing_tabs_or_updating_a_group_description_sends_the')}</p><p>{t('ui.keys_stay_on_this_device_and_are_excluded_from')}</p></details>
          <details className="config-advanced"><DisclosureSummary>{t('ui.shortcut_task_diagnostics')}</DisclosureSummary>{state.diagnostic ? <dl className="config-diagnostic"><div><dt>{t('ui.last_trigger')}</dt><dd>{new Date(state.diagnostic.at).toLocaleString(locale)}</dd></div><div><dt>{t('ui.source')}</dt><dd>{state.diagnostic.source}</dd></div><div><dt>{t('ui.action')}</dt><dd>{state.diagnostic.action}</dd></div><div><dt>{t('ui.target_window')}</dt><dd>{state.diagnostic.windowId ?? t('ui.unknown')}</dd></div><div><dt>{t('ui.execution')}</dt><dd>{state.diagnostic.executed ? t('ui.executed') : t('ui.not_executed')}</dd></div><div><dt>{t('ui.details')}</dt><dd>{localizeMessage(state.diagnostic.message, locale)}</dd></div></dl> : <p className="muted">{t('ui.no_trigger_recorded_yet')}</p>}<p className="muted">{t('ui.a_missing_command_cannot_identify_a_conflicting_app_check')}</p></details>
        </section>}
        {section === 'general' && <section className="config-data-section config-help config-special-card"><h2>{t('ui.using_autotabgroups')}</h2><details><DisclosureSummary>{t('ui.how_do_the_three_organizing_actions_differ')}</DisclosureSummary><ul className="config-action-help"><li><strong>{t('ui.organize_current_tab')}</strong><span>{t('ui.move_the_current_ungrouped_tab_into_an_existing_group')}</span></li><li><strong>{t('ui.update_groups')}</strong><span>{t('ui.organize_ungrouped_tabs_in_this_window_initialize_groups_when')}</span></li><li><strong>{t('ui.update_allow_new_groups')}</strong><span>{t('ui.match_existing_groups_first_then_consider_new_groups_for')}</span></li></ul></details><details><DisclosureSummary>{t('ui.will_my_manual_groups_be_overridden')}</DisclosureSummary><p>{t('ui.no_grouped_tabs_stay_where_they_are_a_tab')}</p></details><details><DisclosureSummary>{t('ui.do_imports_or_upgrades_change_my_tabs')}</DisclosureSummary><p>{t('ui.imports_do_not_move_tabs_or_restore_closed_pages')}</p></details></section>}
        {dirty && !formSection && <div className="config-draft-reminder"><span>{savedRefreshFailed ? hasUnsavedChanges ? t('ui.refresh_saved_settings_newer_edits_are_unsaved') : t('ui.settings_saved_refresh_to_confirm') : t('ui.services_or_advanced_settings_have_unsaved_changes')}</span><button className="text-button" onClick={() => chooseSection('services')}>{savedRefreshFailed ? t('ui.return_to_refresh') : t('ui.return_to_save')}<Icon name="chevron" size={16} /></button></div>}
      </main>
      <footer className="config-footer">AutoTabGroups {chrome.runtime.getManifest().version}<span>{t('ui.organize_your_tabs_in_the_sidebar')}</span></footer>
    </div>
    {importPreview && <Modal title={t('ui.review_import')} busy={busy} onClose={() => { if (!busy) setImportPreview(undefined); }} footer={<><button disabled={busy} onClick={() => setImportPreview(undefined)}>{t('ui.cancel')}</button><button className="primary" disabled={locked} onClick={() => void dataAction(async () => { await dispatch({ type: 'import-config', data: importPreview.data, revision: importPreview.revision }); setImportPreview(undefined); }, msg('ui.import_complete'))}>{busy ? t('ui.importing') : t('ui.apply_import')}</button></>}>
      <p>{t('import.descriptions', { count: importPreview.profileCount })}</p><p className="muted">{localizeMessage(importPreview.message, locale)}</p><ul className="config-import-changes">{importPreview.changes.map((change, i) => <li key={i}>{localizeMessage(change, locale)}</li>)}</ul>{error && <p className="alert error" role="alert">{localizeMessage(error, locale)}</p>}
    </Modal>}
    {confirmation}
  </div>;
}

function ChatFields({ config, change, platforms = false, onPlatformChange = change }: { config: Settings['generator']; change: (value: Settings['generator']) => void; platforms?: boolean; onPlatformChange?: (value: Settings['generator']) => void }) {
  const { t } = useUi();
  const preset = platforms ? chatPreset(config) : undefined;
  return <>
    {platforms ? <label className="config-field"><span>{t('ui.service_platform')}</span><select aria-label={t('ui.service_platform')} value={chatPlatform(config)} onChange={e => onPlatformChange(selectChatPlatform(config, e.target.value as ChatPlatformId))}>
      <optgroup label={t('ui.platforms')}>{chatPresets.map(item => <option key={item.id} value={item.id}>{t(`platform.${item.id}`)}</option>)}</optgroup>
      <optgroup label={t('ui.custom_compatible_services')}><option value="custom-openai">{t('ui.custom_openai_compatible')}</option><option value="custom-anthropic">{t('ui.custom_anthropic_compatible')}</option></optgroup>
    </select></label> : <label className="config-field"><span>{t('ui.api_protocol')}</span><select aria-label={t('ui.api_protocol')} value={config.protocol} onChange={e => change({ ...config, protocol: e.target.value as 'openai' | 'anthropic' })}><option value="openai">OpenAI · Chat Completions</option><option value="anthropic">Anthropic · Messages</option></select></label>}
    {preset ? <p className="config-field-note">{t('ui.endpoint_and_protocol_are_preset')} <a href={preset.docs} target="_blank" rel="noreferrer">{t('ui.platform_docs')}</a></p> : <>
      <label className="config-field"><span>Base URL</span><input type="url" required value={config.baseUrl} spellCheck={false} onChange={e => change({ ...config, baseUrl: e.target.value })} /></label>
      <p className="config-field-note">{t('ui.include_the_version_path_the_protocol_adds_chat_completions')}</p>
    </>}
    <label className="config-field"><span>{t('ui.model_name')}</span><input required={!!preset} value={config.model} spellCheck={false} placeholder={t('ui.model_id_from_your_provider')} onChange={e => change({ ...config, model: e.target.value })} /></label>
    {preset && <p className="config-field-note">{config.thinkingEffort === 'low' ? t('ui.you_can_change_the_default_model_reasoning_is_set') : t('ui.a_default_model_is_filled_in_you_can_use')}</p>}

  </>;
}

function NumberInput({ label, help, value, min, max, step = 1, change }: { label: string; help: string; value: number; min: number; max: number; step?: number; change: (n: number) => void }) {
  const helpId = useId();
  return <><label className="config-field config-number-field"><span>{label}</span><input type="number" aria-describedby={helpId} required value={value} min={min} max={max} step={step} onChange={e => change(Number(e.target.value))} /></label><p id={helpId} className="config-field-note">{help}</p></>;
}

