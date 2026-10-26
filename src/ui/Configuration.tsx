import { useEffect, useId, useRef, useState } from 'react';
import { dispatch, actionLabels, actionNames, type OrganizerState } from '../shared/organizer';
import { settingsSchema, type Settings } from '../shared/schemas';
import { chatPlatform, chatPreset, chatPresets, sameChatOrigin, selectChatPlatform, type ChatPlatformId } from '../shared/chat-platforms';
import { errorMessage } from '../shared/errors';
import { ThinkingControls } from './ThinkingControls';
import { RecentActivity } from './RecentActivity';
import { UndoGrouping } from './UndoGrouping';
import { useUi } from './preferences';
import { Brand, DisclosureSummary, Icon, Modal, useConfirm } from './components';
import { localizeMessage } from './messages';
import './configuration.css';

const sections = [
  { id: 'general', zh: '常规', en: 'General', icon: 'settings' },
  { id: 'services', zh: '服务', en: 'Services', icon: 'model' },
  { id: 'advanced', zh: '高级', en: 'Advanced', icon: 'database' },
] as const;
type SectionId = typeof sections[number]['id'];
type TestResult = { status: 'idle' | 'running' | 'success' | 'error'; message?: string };
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
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [feedbackArea, setFeedbackArea] = useState<'page' | 'data'>('page');
  const [savedRefreshFailed, setSavedRefreshFailed] = useState(false);
  const [tests, setTests] = useState(emptyTests);
  const [commands, setCommands] = useState<chrome.commands.Command[]>([]);
  const [commandError, setCommandError] = useState(false);
  const [importPreview, setImportPreview] = useState<{ data: unknown; profileCount: number; message: string; revision: number; changes: string[] }>();
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
  const act = async (operation: () => Promise<unknown>, message?: string, refreshAfter = true, area: 'page' | 'data' = 'page') => {
    if (operationRunning.current) return false;
    operationRunning.current = true;
    setBusy(true); setError(''); setNotice(''); setFeedbackArea(area);
    try { await operation(); if (refreshAfter) await refresh(); if (message && activeSection.current === section) setNotice(message); return true; }
    catch (error) { setError(errorMessage(error)); return false; }
    finally { operationRunning.current = false; setBusy(false); }
  };
  const dataAction = (operation: () => Promise<unknown>, message?: string) => act(operation, message, true, 'data');
  const refreshSavedConfiguration = async () => {
    try { await refresh(); }
    catch {
      setSavedRefreshFailed(true);
      throw new Error(t('配置已保存，但界面刷新失败，输入已保留。请重试刷新。', 'Settings were saved, but the view could not refresh. Your input is preserved. Retry the refresh.'));
    }
    setSavedRefreshFailed(false);
    if (savedDraftVersion.current === draftVersion.current) {
      dirtyRef.current = false; setDirty(false); setGeneratorKey(undefined); setClassifierKey(undefined); setReaderKeys({}); setKeyVisible({ generator: false, classifier: false, tavily: false, deepseek: false });
    } else {
      setNotice(t('刷新成功。刷新前的新修改仍保留，请核对已保存配置后继续。', 'Refresh complete. Your newer edits are preserved; review the saved settings before continuing.'));
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
      await dispatch<string>(provider === 'reader' ? { type: 'test-reader', settings: settingsSchema.parse(settings), readerKeys } : { type: 'test-config', provider, settings: settingsSchema.parse(settings), generatorKey, classifierKey });
      if (version === draftVersion.current) setTests(current => ({ ...current, [provider]: { status: 'success' } }));
    } catch (error) {
      if (version !== draftVersion.current) return;
      setTests(current => ({ ...current, [provider]: { status: 'error', message: errorMessage(error) } })); throw error;
    }
  });
  const locked = busy || state.busy || savedRefreshFailed;
  const conflict = dirty && revision !== state.revision;
  const formSection = section === 'services' || section === 'advanced';
  const reload = async () => {
    if (dirty && !await confirm({ title: t('重新载入配置？', 'Reload saved settings?'), message: t('未保存的模型与读取设置将被放弃。', 'Unsaved model and reading settings will be discarded.'), confirmLabel: t('放弃并重载', 'Discard & reload') })) return;
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
    const role = provider === 'generator' ? t('Chat 服务', 'Chat service') : provider === 'classifier' ? t('归组服务', 'Classification service') : provider === 'tavily' ? 'Tavily' : 'DeepSeek Fetch';
    return <div className="config-key-field">
      <label className="config-field"><span>API Key</span><span className="config-key-input">
        <input aria-label={`${role} API Key`} type={keyVisible[provider] ? 'text' : 'password'} autoComplete="off" spellCheck={false} value={value ?? ''}
          placeholder={savedRefreshFailed ? t('保存状态待刷新确认', 'Refresh to confirm the saved state') : hasKey ? t('已保存，留空保持不变', 'Saved; leave blank to keep') : provider === 'generator' && chatPreset(settings.generator) ? t('填写所选平台的 API Key', 'Enter the selected platform’s API key') : provider === 'tavily' || provider === 'deepseek' ? t('填写读取服务 API Key', 'Enter the reader API key') : t('无鉴权服务可留空', 'Optional for services without authentication')}
          onChange={e => { draftVersion.current++; set(e.target.value || (provider === 'generator' && !!chatPreset(settings.generator) && !sameChatOrigin(settings.generator, state.settings.generator) ? '' : undefined)); dirtyRef.current = true; setDirty(true); setNotice(''); setTests(emptyTests); }} />
        <button type="button" className="icon-button" aria-label={keyVisible[provider] ? t('隐藏新输入的密钥', 'Hide entered key') : t('显示新输入的密钥', 'Show entered key')} aria-pressed={keyVisible[provider]} onClick={() => setKeyVisible(current => ({ ...current, [provider]: !current[provider] }))}><Icon name={keyVisible[provider] ? 'eye-off' : 'eye'} /></button>
      </span></label>
      <div className="config-field-note config-key-actions"><span>{savedRefreshFailed ? t('密钥保存状态待刷新确认', 'Refresh to confirm the saved key state') : value === '' && provider === 'generator' && !hasKey ? t('尚未保存密钥', 'No saved key') : value === '' ? t('保存后将清除此密钥。', 'This key will be cleared when you save.') : value ? t('新输入的密钥尚未保存', 'The entered key has not been saved') : hasKey ? t('本机已有密钥', 'A key is saved on this device') : t('尚未保存密钥', 'No saved key')}</span>
        {(hasKey || value) && <button type="button" className="text-button" disabled={locked} onClick={async () => {
          if (!await confirm({ title: t('清除服务密钥？', 'Clear this service key?'), message: t('点击保存配置后生效。清除前仍可重载已保存配置。', 'The key is removed only after saving. You can reload saved settings before then.'), confirmLabel: t('标记清除', 'Mark for removal'), danger: true })) return;
          draftVersion.current++; set(''); dirtyRef.current = true; setDirty(true); setTests(emptyTests);
        }}>{t('清除密钥', 'Clear key')}</button>}
      </div>
    </div>;
  };
  const testRow = (provider: 'generator' | 'classifier' | 'reader') => {
    const result = tests[provider];
    const status = result.status === 'running' ? t('正在测试…', 'Testing…') : result.status === 'success' ? t('连接成功 · 当前草稿', 'Connected · current draft') : result.status === 'error' ? t('测试失败', 'Test failed') : (provider === 'reader' ? true : provider === 'generator' ? settings.generator.model : settings.classifierUseChat ? settings.generator.model : settings.classifier.model) ? t('当前配置尚未测试', 'Current settings have not been tested') : t('请填写模型名称', 'Enter a model name');
    return <div className={`config-special-card config-test-row ${result.status}`}><div><h3>{provider === 'reader' ? t('读取连接', 'Reader connection') : t('服务连接', 'Service connection')}</h3><span className={`config-test-status ${result.status}`} role="status">{result.status === 'success' && <Icon name="check" size={15} />}{status}</span></div>
      <button type="button" className="secondary" disabled={locked} onClick={() => void test(provider)}>{provider === 'reader' ? t('测试读取接口（不保存）', 'Test reader (no save)') : provider === 'generator' ? t('测试 Chat 连接（不保存）', 'Test Chat connection (no save)') : t('测试归组连接（不保存）', 'Test classification (no save)')}</button>
    </div>;
  };
  const currentSection = sections.find(item => item.id === section)!;
  const descriptions: Record<SectionId, string> = {
    general: t('调整日常偏好，查看快捷键和最近整理。整理操作在侧栏中进行。', 'Set everyday preferences, check shortcuts and review recent activity. Organize tabs in the sidebar.'),
    services: t('配置模型连接，选择发送基本描述或读取网页正文。', 'Connect your models and choose basic page details or page content.'),
    advanced: t('调整归组判断与读取预算，管理本机数据。默认参数适合日常使用。', 'Tune classification and reading limits, and manage local data. Defaults suit everyday use.'),
  };
  const englishActions = ['Organize current tab', 'Update groups', 'Update & allow new groups'];
  return <div className="config-shell">
    <header className="config-header"><div className="config-brand"><Brand /><span className="config-product-section">{t('配置中心', 'Settings')}</span></div><span className="config-header-meta">{locale === 'zh-CN' ? '中文' : 'English'} · {theme === 'system' ? t('跟随系统', 'System') : theme === 'light' ? t('浅色', 'Light') : t('深色', 'Dark')}</span></header>
    <div className="config-body">
      <nav aria-label={t('配置分区', 'Settings sections')} className="config-navigation"><div role="tablist" aria-label={t('配置分区', 'Settings sections')} className="config-nav">{sections.map((item, index) => <button type="button" role="tab" id={`tab-${item.id}`} aria-label={t(item.zh, item.en)} aria-controls={`panel-${item.id}`} aria-selected={section === item.id} tabIndex={section === item.id ? 0 : -1} key={item.id} onClick={() => chooseSection(item.id, false)} onKeyDown={event => {
        const next = event.key === 'ArrowRight' ? (index + 1) % sections.length : event.key === 'ArrowLeft' ? (index + sections.length - 1) % sections.length : event.key === 'Home' ? 0 : event.key === 'End' ? sections.length - 1 : undefined;
        if (next === undefined) return;
        event.preventDefault(); chooseSection(sections[next].id, false); document.getElementById(`tab-${sections[next].id}`)?.focus();
      }}><Icon name={item.icon} /><span>{t(item.zh, item.en)}</span>{hasUnsavedChanges && item.id !== 'general' && <span className="config-dirty-dot" aria-label={t('存在未保存设置', 'Unsaved settings')} />}</button>)}</div></nav>
      <main className="config-content" role="tabpanel" id={`panel-${section}`} aria-labelledby={`tab-${section}`} tabIndex={-1}>
        <div className="config-page-intro"><h1 ref={heading} tabIndex={-1}>{t(currentSection.zh, currentSection.en)}</h1><p>{descriptions[section]}</p></div>
        {((error && (feedbackArea === 'page' || section !== 'advanced')) || savedRefreshFailed) && <div className="alert error" role="alert"><p>{savedRefreshFailed ? t('配置已保存，但界面刷新失败，输入已保留。请重试刷新。', 'Settings were saved, but the view could not refresh. Your input is preserved. Retry the refresh.') : localizeMessage(error, locale)}</p>{savedRefreshFailed && <button type="button" className="config-refresh-retry" disabled={busy} onClick={() => void act(refreshSavedConfiguration, undefined, false)}>{t('重试刷新', 'Retry refresh')}</button>}</div>}
        {notice && (feedbackArea === 'page' || section !== 'advanced') && <p className="alert" role="status">{localizeMessage(notice, locale)}</p>}
        {state.busy && formSection && <p className="alert" role="status">{t('整理任务正在执行。可编辑草稿，完成后再保存或测试。', 'An organizing task is running. You can edit your draft; save or test after it finishes.')}</p>}
        {conflict && !savedRefreshFailed && <p className="alert error" role="alert">{t('配置或分组说明已在其他位置更新。输入已保留，请重载已保存配置后再编辑。', 'Settings or group descriptions changed elsewhere. Your draft is preserved; reload saved settings before editing again.')}</p>}
        {section === 'general' && <section className="config-pane" id="preferences">
          {!settings.generator.model.trim() && <div className="config-special-card config-setup"><div><h2>{t('先连接模型服务', 'Connect a model to get started')}</h2><p>{t('设置 Chat 服务后，即可回到侧栏整理标签。', 'Set up your Chat service, then return to the sidebar to organize tabs.')}</p></div><button onClick={() => chooseSection('services')}>{t('配置模型服务', 'Set up services')}<Icon name="chevron" size={15} /></button></div>}
          <fieldset className="config-service" disabled={preferenceBusy}><legend>{t('外观与语言', 'Appearance & language')}</legend>
            <label className="config-field"><span>{t('界面主题', 'Interface theme')}</span><select aria-label={t('界面主题', 'Interface theme')} value={theme} onChange={e => void savePreferences({ theme: e.target.value as 'light' | 'dark' | 'system' })}><option value="system">{t('跟随系统', 'System')}</option><option value="light">{t('浅色', 'Light')}</option><option value="dark">{t('深色', 'Dark')}</option></select></label>
            <p className="config-field-note">{t('侧栏与配置中心同步。跟随系统会自动切换浅色或深色。', 'Shared by the sidebar and settings. System follows your device’s light or dark appearance.')}</p>
            <label className="config-field"><span>{t('界面语言', 'Interface language')}</span><select aria-label={t('界面语言', 'Interface language')} value={locale} onChange={e => void savePreferences({ locale: e.target.value as 'zh-CN' | 'en' })}><option value="zh-CN">中文</option><option value="en">English</option></select></label>
            <p className="config-field-note">{t('不改变你填写的分组名称、说明或模型内容。', 'Your group names, descriptions, and model content remain unchanged.')}</p>
            <p className="config-preference-status" role="status">{preferenceBusy ? t('正在保存偏好…', 'Saving preferences…') : t('偏好自动保存', 'Preferences save automatically')}</p>{preferenceError && <p className="alert error" role="alert">{preferenceError}</p>}
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
            <fieldset className="config-service" disabled={busy}><legend><span className="config-step">1</span>{t('标准 Chat 服务 · 必须配置', 'Standard Chat service · required')}</legend>
              <p className="config-section-help">{t('补充分组说明、分析新组，也可用于判断网页归属。', 'Generates group descriptions, proposes new groups, and can classify pages.')}</p>
              <ChatFields config={settings.generator} change={generator => patch({ generator })} platforms onPlatformChange={generator => {
                if (!sameChatOrigin(settings.generator, generator)) {
                  setGeneratorKey(sameChatOrigin(generator, state.settings.generator) ? undefined : '');
                  setKeyVisible(current => ({ ...current, generator: false }));
                }
                patch({ generator });
              }} />
              {keyField('generator')}{testRow('generator')}
            </fieldset>
            <fieldset className="config-service" disabled={busy}><legend><span className="config-step">2</span>{t('归组判断服务', 'Classification service')}</legend>
              <label className="config-field config-switch-row"><span>{t('复用标准 Chat 服务', 'Use the standard Chat service')}</span><input type="checkbox" aria-label={t('复用标准 Chat 服务', 'Use the standard Chat service')} checked={settings.classifierUseChat} onChange={e => patch({ classifierUseChat: e.target.checked })} /></label><p className="config-field-note">{t('使用上方配置，无需再填写一组密钥。关闭后可配置独立归组服务。', 'Use the settings above, without a second key. Turn off to configure a separate classifier.')}</p>
              {!settings.classifierUseChat && <div className="config-independent">
                <label className="config-field"><span>{t('分类后端', 'Classification backend')}</span><select aria-label={t('分类后端', 'Classification backend')} value={settings.classifier.backend} onChange={e => patch({ classifier: { ...settings.classifier, backend: e.target.value as Settings['classifier']['backend'] } })}><option value="llm">{t('普通 Chat 模型', 'Chat model')}</option><option value="jev">{t('Jev 决策模型', 'Jev decision model')}</option><option value="openai-decisions">OpenAI Decisions</option></select></label>
                {settings.classifier.backend === 'llm' ? <ChatFields config={settings.classifier} change={config => patch({ classifier: { ...settings.classifier, ...config } })} /> : <>
                  <label className="config-field"><span>{t('完整接口 URL', 'Full endpoint URL')}</span><input type="url" required value={settings.classifier.baseUrl} spellCheck={false} onChange={e => patch({ classifier: { ...settings.classifier, baseUrl: e.target.value } })} /></label>
                  <p className="config-field-note">{t('按原样请求，不追加路径。切换后端后请检查地址及模型。', 'Used as entered, without an added path. Check the URL and model after switching backends.')}</p>
                  <label className="config-field"><span>{t('分类模型名称', 'Classification model')}</span><input value={settings.classifier.model} spellCheck={false} onChange={e => patch({ classifier: { ...settings.classifier, model: e.target.value } })} /></label>
                </>}{keyField('classifier')}
              </div>}{testRow('classifier')}
            </fieldset>
            <p className="config-privacy"><Icon name="info" size={16} /><span>{t('Chat 与归组测试发送虚构内容，会产生模型请求，但不会保存配置。密钥仅保存在本机，不随配置导出。', 'Chat and classification tests send fictional content and make model requests without saving settings. Keys stay on this device and are excluded from exports.')}</span></p>
          <fieldset className="config-service config-reader" disabled={busy}><legend><span className="config-step">3</span>{t('网页读取', 'Page reading')}</legend>
            <label className="config-field config-switch-row"><span>{t('读取网页正文', 'Read page content')}</span><input type="checkbox" checked={settings.readContent} aria-controls={readerOptionsId} aria-describedby={`${readerOptionsId}-hint`} onChange={e => patch({ readContent: e.target.checked })} /></label>
            <p className="config-field-note" id={`${readerOptionsId}-hint`}>{t('用于归组判断和分组说明。关闭时仅发送标题、网址和摘要。', 'Used for classification and group descriptions. When off, only the title, URL and description are sent.')}</p>
            <div id={readerOptionsId} hidden={!settings.readContent}>{settings.readContent && <>
              <label className="config-field"><span>{t('正文读取方式', 'Content reader')}</span><select aria-label={t('正文读取方式', 'Content reader')} value={settings.reader.provider} onChange={e => patch({ reader: { ...settings.reader, provider: e.target.value as Settings['reader']['provider'] } })}><option value="local">{t('内置读取器（本地提取）', 'Built-in reader (local extraction)')}</option><option value="tavily">Tavily Extract</option><option value="deepseek">DeepSeek Fetch</option></select></label>
              <p className="config-field-note">{settings.reader.provider === 'local' ? t('从当前已加载页面提取正文，无需额外 API。排除表单和可编辑区域；取不到正文时使用基本描述。', 'Extracts the loaded page without an extra API. Forms and editable fields are excluded; basic details are used if no content is available.') : t('只将清理后的网址发送给所选读取服务，不发送浏览器 Cookie。远程内容可能与登录后的页面不同；正文随后发给归组模型。', 'Only the cleaned URL is sent to the reader, without browser cookies. Remote content may differ from signed-in pages; extracted content is then sent to the model.')}</p>
              {settings.reader.provider !== 'local' && <>
                <label className="config-field"><span>{t('读取接口 URL', 'Reader endpoint URL')}</span><input aria-label={t('读取接口 URL', 'Reader endpoint URL')} type="url" required value={settings.reader[settings.reader.provider].endpoint} onChange={e => { const provider = settings.reader.provider; if (provider !== 'local') patch({ reader: { ...settings.reader, [provider]: { ...settings.reader[provider], endpoint: e.target.value } } }); }} /></label>
                <p className="config-field-note">{t('完整接口地址，按原样请求；切换服务时分别保留地址和密钥。', 'The full endpoint is used as entered. Each service keeps its own endpoint and key.')}</p>
                {keyField(settings.reader.provider)}{testRow('reader')}
                <p className="config-section-help">{t('测试使用公开的 example.com，不读取当前标签；会调用所选读取服务，可能产生费用。测试不保存配置，也不启用本地兜底。', 'The test fetches public example.com, not your tabs. It calls the chosen reader and may incur charges. It neither saves settings nor uses the local fallback.')}</p>
              </>}
            </>}</div>
          </fieldset>
          <div className="config-section-link"><span>{t('需要调整分数门槛、读取预算或思考参数？', 'Need to tune scores, reading limits or reasoning?')}</span><button type="button" className="text-button" onClick={() => chooseSection('advanced')}>{t('前往高级', 'Open Advanced')}<Icon name="chevron" size={15} /></button></div>
          </>}
          {section === 'advanced' && <div className="config-global-advanced">
            <p className="config-section-help">{t('默认值适合日常整理。以下修改保存后用于下一次任务，不会重新整理已有分组。', 'Defaults suit everyday use. Saved changes apply to the next task and do not reorganize existing groups.')}</p>
            <fieldset className="config-service" disabled={busy}><legend>{t('归组判断', 'Classification')}</legend>
              <NumberInput label={t('最低归组分数', 'Minimum score')} help={t('最佳候选低于此分数时保持未分组。调高更保守；Chat 分数是模型自评，不是正确率。', 'Leave a tab ungrouped if its best score is lower. Higher is more conservative; Chat scores are self-ratings, not accuracy.')} value={settings.minProbability} min={0} max={1} step={0.05} change={minProbability => patch({ minProbability })} />
              <NumberInput label={t('最小候选分差', 'Minimum score margin')} help={t('最佳候选必须领先其他候选（含无合适组）至少此分差；差距不足时保持未分组。', 'The best candidate must lead the alternatives, including no match, by this margin. Otherwise the tab stays ungrouped.')} value={settings.minMargin} min={0} max={1} step={0.05} change={minMargin => patch({ minMargin })} />
              <NumberInput label={t('单次最多建议新组数', 'Maximum proposed groups')} help={t('只限制允许新建时的建议数量，不要求建满，也不放宽每组至少 3 页的门槛。', 'Caps proposals when creation is allowed. It is not a target and does not relax the 3-page minimum.')} value={settings.maxGroups} min={2} max={30} change={maxGroups => patch({ maxGroups })} />
            </fieldset>
            <fieldset className="config-service" disabled={busy}><legend>{t('正文与输入预算', 'Content and input limits')}</legend>
              <NumberInput label={t('每页正文字符上限', 'Content characters per page')} help={t('正文模式下对本地和远程结果统一截断。数值越大，保留上下文越多，也可能增加模型输入成本。', 'Truncates both local and remote page content. Larger values preserve more context and may increase model input costs.')} value={settings.maxContentChars} min={500} max={20000} change={maxContentChars => patch({ maxContentChars })} />
              <NumberInput label={t('请求输入预算', 'Request input budget')} help={t('限制单次请求可使用的网页与候选信息，以 UTF-8 字节计，不是 token 数；过小可能截短正文或无法容纳候选。', 'Limits page and candidate input per request in UTF-8 bytes, not tokens. Too small a budget can trim content or fail to fit candidates.')} value={settings.requestBudget} min={4000} max={100000} change={requestBudget => patch({ requestBudget })} />
              {settings.readContent && settings.reader.provider !== 'local' && <>
                <NumberInput label={t('远程读取超时（秒）', 'Reader timeout (seconds)')} help={t('等待一次远程读取的最长时间；超时后按下方兜底设置处理。不会因等待更久而增加重试次数。', 'Maximum wait for a reader request. Timeouts follow the fallback setting below; longer waits do not add retries.')} value={settings.reader.timeoutSeconds} min={5} max={60} change={timeoutSeconds => patch({ reader: { ...settings.reader, timeoutSeconds } })} />
                {settings.reader.provider === 'tavily' && <><label className="config-field"><span>{t('Tavily 提取深度', 'Tavily extraction depth')}</span><select aria-label={t('Tavily 提取深度', 'Tavily extraction depth')} value={settings.reader.tavily.depth} onChange={e => patch({ reader: { ...settings.reader, tavily: { ...settings.reader.tavily, depth: e.target.value as 'basic' | 'advanced' } } })}><option value="basic">{t('标准', 'Basic')}</option><option value="advanced">{t('深度', 'Advanced')}</option></select></label><p className="config-field-note">{t('深度模式适合复杂页面结构，通常更慢且可能消耗更多服务额度；不改变归组模型。', 'Advanced extraction handles more complex page structures and may take longer or use more credits. It does not change the classifier.')}</p></>}
                <label className="config-field config-switch-row"><span>{t('远程失败时使用本地读取兜底', 'Use the local reader if remote extraction fails')}</span><input type="checkbox" checked={settings.reader.fallback} onChange={e => patch({ reader: { ...settings.reader, fallback: e.target.checked } })} /></label><p className="config-field-note">{t('开启：先尝试本地正文，再退回基本描述。关闭：该页读取失败，不用基本描述继续分类。取消任务时不会触发兜底。', 'On: try local content, then basic details. Off: fail the page instead of classifying from basic details. Cancelling never triggers fallback.')}</p>
              </>}
            </fieldset>
            <fieldset className="config-service" disabled={busy}><legend>{t('Chat 思考参数', 'Chat reasoning')}</legend><h3>{t('标准 Chat 服务', 'Standard Chat service')}</h3><ThinkingControls config={settings.generator} onChange={generator => patch({ generator })} prefix={t('Chat 服务 ', 'Chat service ')} />
              {!settings.classifierUseChat && settings.classifier.backend === 'llm' && <><h3>{t('独立归组 Chat 服务', 'Independent classification Chat')}</h3><ThinkingControls config={settings.classifier} onChange={classifier => patch({ classifier: { ...settings.classifier, ...classifier } })} prefix={t('归组服务 ', 'Classification service ')} /></>}
            </fieldset>
            <div className="config-rule-note"><Icon name="info" size={18} /><p>{t('AI 新建分组始终至少需要 3 个明确匹配成员。手动建组允许 1～2 页；已分组页面不会自动重新分类。', 'AI-created groups always need at least 3 clear matches. Manual groups may have 1–2 tabs. Grouped tabs are never automatically reclassified.')}</p></div>
          </div>}
          <div className="config-savebar"><span className="config-save-status" role="status">{savedRefreshFailed ? hasUnsavedChanges ? t('待刷新确认 · 另有新修改未保存', 'Refresh needed · newer edits are unsaved') : t('待刷新确认', 'Refresh needed') : dirty ? t('有未保存修改', 'Unsaved changes') : <><Icon name="check" size={15} />{t('已保存', 'Saved')}</>}</span><div className="buttons"><button type="button" className="secondary" disabled={busy || savedRefreshFailed} onClick={() => void reload()}>{t('重载已保存配置', 'Reload saved settings')}</button><button className="primary" disabled={locked || conflict || !dirty}>{busy ? t('处理中…', 'Working…') : t('保存配置', 'Save settings')}</button></div></div>
        </form>}
        {section === 'general' && <section className="config-pane" id="shortcuts"><h2 className="config-section-title">{t('快捷键', 'Keyboard shortcuts')}</h2>
          {commandError && <p className="alert error" role="alert">{t('暂时无法读取快捷键，请切回本页重试。', 'Could not read shortcuts. Return to this page to retry.')}</p>}
          <div className="config-shortcuts">{actionNames.map((name, i) => <div className="config-shortcut" key={name}><div><h2>{t(actionLabels[name], englishActions[i])}</h2><p>{i === 0 ? t('当前未分组页面 → 已有组', 'Current ungrouped tab → existing groups') : i === 1 ? t('本窗口未分组页面；零组时初始化', 'Ungrouped tabs in this window; initializes if no groups exist') : t('先匹配已有组，再分析剩余页面', 'Match existing groups, then consider new groups')}</p><small>{t('默认建议：', 'Suggested: ')}{i === 0 ? 'Alt+1' : i === 1 ? 'Alt+Shift+1' : 'Alt+Shift+2'}</small></div><kbd>{commandError ? t('无法读取', 'Unavailable') : commands.find(c => c.name === name)?.shortcut || t('未绑定', 'Unassigned')}</kbd></div>)}</div>
          <div className="config-action-row"><button className="primary" disabled={busy} onClick={() => void act(() => chrome.tabs.create({ url: 'chrome://extensions/shortcuts' }))}>{t('在 Chrome 中管理快捷键', 'Manage shortcuts in Chrome')}<Icon name="external" size={16} /></button></div>

        </section>}
        {section === 'general' && <div className="config-undo"><UndoGrouping state={state} windowId={windowId} disabled={locked} onUndo={() => void act(async () => { setNotice(await dispatch<string>({ type: 'undo' })); })} /></div>}
        {section === 'general' && <details className="config-special-card config-activity" id="activity"><DisclosureSummary><span><strong>{t('最近整理', 'Recent activity')}</strong><small>{t('查看最近一次结果、重新判断或手动改分。', 'Review the latest results, reassess tabs or move them manually.')}</small></span></DisclosureSummary><RecentActivity state={state} windowId={windowId} refresh={refresh} onOpenSettings={() => chooseSection('services')} /></details>}
        {section === 'advanced' && <section className="config-pane config-tools" id="data"><h2 className="config-section-title">{t('数据与诊断', 'Data & diagnostics')}</h2>
          <div ref={dataFeedback}>{feedbackArea === 'data' && error && <p className="alert error" role="alert">{localizeMessage(error, locale)}</p>}
          {feedbackArea === 'data' && notice && <p className="alert success" role="status">{localizeMessage(notice, locale)}</p>}</div>
          <div className="config-data-grid">
          <section className="config-data-section config-special-card"><div className="config-data-heading"><Icon name="database" size={20} /><h3>{t('配置备份', 'Settings backup')}</h3></div><p>{t('保存模型设置与分组说明。导出不包含密钥、网页正文或原生标签 ID。', 'Back up model settings and group descriptions. Keys, page content, and native tab IDs are excluded.')}</p>{dirty && <p className="config-import-hint"><Icon name="info" size={14} /><span>{savedRefreshFailed ? t('请先刷新确认已保存配置，再导入。', 'Refresh to confirm saved settings before importing.') : t('请先保存或重载未保存的模型与读取设置，再导入。', 'Save or reload your model and reading draft before importing.')}</span></p>}<div className="buttons config-data-actions"><button disabled={locked} onClick={() => void dataAction(async () => {
            const data = await dispatch({ type: 'export-config' });
            const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
            const a = document.createElement('a'); a.href = url; a.download = 'autotabgroups-config.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
          }, t('配置文件已生成', 'Backup file generated'))}>{t('导出配置与说明', 'Export settings & descriptions')}</button><button disabled={locked || dirty} onClick={() => file.current?.click()}>{t('导入配置与说明', 'Import settings & descriptions')}</button></div>

          <input ref={file} hidden type="file" accept=".json,application/json" onChange={e => {
            const selected = e.target.files?.[0]; e.target.value = '';
            if (selected) void dataAction(async () => {
              if (selected.size > 5_000_000) throw new Error(t('配置文件过大，请选择小于 5 MB 的文件。', 'Choose a settings file smaller than 5 MB.'));
              setImportPreview(await dispatch({ type: 'preview-import', data: JSON.parse(await selected.text()) }));
            });
          }} /></section>
          <section className="config-data-section config-special-card"><div className="config-data-heading"><Icon name="refresh" size={20} /><h3>{t('分类缓存', 'Classification cache')}</h3></div><p>{t('复用已完成的归组判断，减少重复请求。清除后，下次整理会重新判断，现有分组不变。', 'Reuse earlier decisions to reduce repeat requests. Clearing the cache reassesses tabs on the next run; existing groups stay unchanged.')}</p><div className="buttons config-data-actions"><button disabled={locked} onClick={() => void dataAction(() => dispatch({ type: 'clear-cache' }), t('分类缓存已清除', 'Classification cache cleared'))}>{t('清除分类缓存', 'Clear cache')}</button></div></section>
          </div>
          <details className="config-advanced config-data-disclosure"><DisclosureSummary>{t('数据发送与本机存储', 'Data sharing & local storage')}</DisclosureSummary><p>{t('整理标签或更新分组说明时，选定的网页信息会发送给你配置的模型服务。使用远程正文读取器时，还会向所选读取服务发送清理后的网址。连接测试仅使用测试内容。', 'Organizing tabs or updating a group description sends the selected page information to your configured model service. A remote content reader also receives the cleaned URL. Connection tests use test content only.')}</p><p>{t('密钥仅保存在本机，不随配置导出。分类缓存最多保留 300 条，无固定过期时间，在浏览器会话结束后清除。', 'Keys stay on this device and are excluded from exports. The classification cache holds up to 300 entries with no fixed expiry, and clears when the browser session ends.')}</p></details>
          <details className="config-advanced"><DisclosureSummary>{t('快捷键与任务诊断', 'Shortcut & task diagnostics')}</DisclosureSummary>{state.diagnostic ? <dl className="config-diagnostic"><div><dt>{t('最近触发', 'Last trigger')}</dt><dd>{new Date(state.diagnostic.at).toLocaleString(locale)}</dd></div><div><dt>{t('来源', 'Source')}</dt><dd>{state.diagnostic.source}</dd></div><div><dt>{t('操作', 'Action')}</dt><dd>{state.diagnostic.action}</dd></div><div><dt>{t('目标窗口', 'Target window')}</dt><dd>{state.diagnostic.windowId ?? t('未知', 'Unknown')}</dd></div><div><dt>{t('执行情况', 'Execution')}</dt><dd>{state.diagnostic.executed ? t('已执行', 'Executed') : t('未执行', 'Not executed')}</dd></div><div><dt>{t('说明', 'Details')}</dt><dd>{localizeMessage(state.diagnostic.message, locale)}</dd></div></dl> : <p className="muted">{t('尚无触发记录。', 'No trigger recorded yet.')}</p>}<p className="muted">{t('未收到命令不能确定是哪个软件占用，请检查绑定或使用右键入口。', 'A missing command cannot identify a conflicting app. Check the binding or use the context menu.')}</p></details>
        </section>}
        {section === 'general' && <section className="config-data-section config-help config-special-card"><h2>{t('使用帮助', 'Using AutoTabGroups')}</h2><details><DisclosureSummary>{t('三个整理动作有什么区别？', 'How do the three organizing actions differ?')}</DisclosureSummary><ul className="config-action-help"><li><strong>{t('整理当前页', 'Organize current tab')}</strong><span>{t('当前未分组页面，只加入已有组。', 'Move the current ungrouped tab into an existing group.')}</span></li><li><strong>{t('更新分组', 'Update groups')}</strong><span>{t('处理本窗口全部未分组页面；完全没有组时初始化。', 'Organize ungrouped tabs in this window. Initialize groups when none exist.')}</span></li><li><strong>{t('更新并允许新建分组', 'Update & allow new groups')}</strong><span>{t('先匹配已有组，再为剩余页面分析新组。', 'Match existing groups first, then consider new groups for the remaining tabs.')}</span></li></ul></details><details><DisclosureSummary>{t('手动分组会被覆盖吗？', 'Will my manual groups be overridden?')}</DisclosureSummary><p>{t('不会。已分组页面保持原样；拖出分组后，下次更新时才重新参与判断。所有整理操作只处理触发窗口。', 'No. Grouped tabs stay where they are. A tab dragged out of a group is considered on the next update. Every action is limited to the window it was triggered in.')}</p></details><details><DisclosureSummary>{t('导入与升级会改变标签吗？', 'Do imports or upgrades change my tabs?')}</DisclosureSummary><p>{t('导入不会移动标签或恢复关闭的网页。升级后不再使用全窗口范围或临时忽略列表。历史说明保留，但没有对应原生组时不作为归组目标。', 'Imports do not move tabs or restore closed pages. All-window processing and temporary ignore lists are no longer used. Historical descriptions are retained, but are not targets without a corresponding native group.')}</p></details></section>}
        {dirty && !formSection && <div className="config-draft-reminder"><span>{savedRefreshFailed ? hasUnsavedChanges ? t('配置待刷新确认；另有新修改未保存', 'Refresh saved settings; newer edits are unsaved') : t('配置已保存，待刷新确认', 'Settings saved; refresh to confirm') : t('服务或高级设置有未保存修改', 'Services or advanced settings have unsaved changes')}</span><button className="text-button" onClick={() => chooseSection('services')}>{savedRefreshFailed ? t('返回刷新', 'Return to refresh') : t('返回保存', 'Return to save')}<Icon name="chevron" size={16} /></button></div>}
      </main>
      <footer className="config-footer">AutoTabGroups {chrome.runtime.getManifest().version}<span>{t('整理操作在侧栏中进行', 'Organize your tabs in the sidebar')}</span></footer>
    </div>
    {importPreview && <Modal title={t('确认导入', 'Review import')} busy={busy} onClose={() => { if (!busy) setImportPreview(undefined); }} footer={<><button disabled={busy} onClick={() => setImportPreview(undefined)}>{t('取消', 'Cancel')}</button><button className="primary" disabled={locked} onClick={() => void dataAction(async () => { await dispatch({ type: 'import-config', data: importPreview.data, revision: importPreview.revision }); setImportPreview(undefined); }, t('导入完成', 'Import complete'))}>{busy ? t('正在导入…', 'Importing…') : t('确认应用导入', 'Apply import')}</button></>}>
      <p>{t(`文件包含 ${importPreview.profileCount} 份分组说明。`, `This file contains ${importPreview.profileCount} group description${importPreview.profileCount === 1 ? '' : 's'}.`)}</p><p className="muted">{localizeMessage(importPreview.message, locale)}</p><ul className="config-import-changes">{importPreview.changes.map((change, i) => <li key={i}>{localizeMessage(change, locale)}</li>)}</ul>{error && <p className="alert error" role="alert">{localizeMessage(error, locale)}</p>}
    </Modal>}
    {confirmation}
  </div>;
}

function ChatFields({ config, change, platforms = false, onPlatformChange = change }: { config: Settings['generator']; change: (value: Settings['generator']) => void; platforms?: boolean; onPlatformChange?: (value: Settings['generator']) => void }) {
  const { t } = useUi();
  const preset = platforms ? chatPreset(config) : undefined;
  return <>
    {platforms ? <label className="config-field"><span>{t('服务平台', 'Service platform')}</span><select aria-label={t('服务平台', 'Service platform')} value={chatPlatform(config)} onChange={e => onPlatformChange(selectChatPlatform(config, e.target.value as ChatPlatformId))}>
      <optgroup label={t('常用平台', 'Platforms')}>{chatPresets.map(item => <option key={item.id} value={item.id}>{t(item.name, item.english)}</option>)}</optgroup>
      <optgroup label={t('自定义兼容服务', 'Custom compatible services')}><option value="custom-openai">{t('自定义 · OpenAI 兼容', 'Custom · OpenAI compatible')}</option><option value="custom-anthropic">{t('自定义 · Anthropic 兼容', 'Custom · Anthropic compatible')}</option></optgroup>
    </select></label> : <label className="config-field"><span>{t('接口协议', 'API protocol')}</span><select aria-label={t('接口协议', 'API protocol')} value={config.protocol} onChange={e => change({ ...config, protocol: e.target.value as 'openai' | 'anthropic' })}><option value="openai">OpenAI · Chat Completions</option><option value="anthropic">Anthropic · Messages</option></select></label>}
    {preset ? <p className="config-field-note">{t('地址与协议已预设。', 'Endpoint and protocol are preset.')} <a href={preset.docs} target="_blank" rel="noreferrer">{t('平台文档', 'Platform docs')}</a></p> : <>
      <label className="config-field"><span>Base URL</span><input type="url" required value={config.baseUrl} spellCheck={false} onChange={e => change({ ...config, baseUrl: e.target.value })} /></label>
      <p className="config-field-note">{t('包含版本路径；按协议追加 chat/completions 或 messages。', 'Include the version path. The protocol adds chat/completions or messages.')}</p>
    </>}
    <label className="config-field"><span>{t('模型名称', 'Model name')}</span><input required={!!preset} value={config.model} spellCheck={false} placeholder={t('填写服务商提供的模型 ID', 'Model ID from your provider')} onChange={e => change({ ...config, model: e.target.value })} /></label>
    {preset && <p className="config-field-note">{config.thinkingEffort === 'low' ? t('默认模型可修改；当前使用低档思考，可在高级设置中调整。', 'You can change the default model. Reasoning is set to Low; adjust it in Advanced.') : t('已填写默认模型，可修改为账号支持的型号。思考参数在高级设置中调整。', 'A default model is filled in; you can use another model supported by your account. Adjust reasoning in Advanced.')}</p>}

  </>;
}

function NumberInput({ label, help, value, min, max, step = 1, change }: { label: string; help: string; value: number; min: number; max: number; step?: number; change: (n: number) => void }) {
  const helpId = useId();
  return <><label className="config-field config-number-field"><span>{label}</span><input type="number" aria-describedby={helpId} required value={value} min={min} max={max} step={step} onChange={e => change(Number(e.target.value))} /></label><p id={helpId} className="config-field-note">{help}</p></>;
}






