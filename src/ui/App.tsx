import { msg, type UserMessage } from '../i18n';
import { AppError } from '../shared/errors';
import { useCallback, useEffect, useRef, useState } from 'react';
import { dispatch, ORGANIZER_STATE_CHANGED, type GroupView, type OrganizerState, type OrganizeAction } from '../shared/organizer';
import { colors, type Category, type TabSnapshot } from '../shared/schemas';
import { errorForDisplay } from '../shared/errors';
import { Configuration } from './Configuration';
import { WindowTabScope } from './WindowTabScope';
import { UndoGrouping } from './UndoGrouping';
import { TaskProgress } from './TaskProgress';
import { chatPreset } from '../shared/chat-platforms';
import { Brand, DisclosureSummary, Icon, Modal, useConfirm } from './components';
import { UiProvider, useUi } from './preferences';
import { localizeMessage } from './messages';
import './sidebar.css';

type EditValue = Pick<Category, 'name' | 'description' | 'color'>;
type Editor = { original?: GroupView; value: EditValue; ids: number[] };
function isEditorDirty(editor: Editor | undefined, initial: Editor | undefined) {
  return !!editor && (!initial || JSON.stringify(editor.value) !== JSON.stringify(initial.value) || JSON.stringify([...editor.ids].sort((a, b) => a - b)) !== JSON.stringify([...initial.ids].sort((a, b) => a - b)));
}


export const groupColors: Record<Category['color'], string> = { grey: '#7d8593', blue: '#4b77d1', red: '#c96565', yellow: '#b99233', green: '#488b70', pink: '#c96f9b', purple: '#9a74b8', cyan: '#398b9c', orange: '#c8823f' };
function domain(url?: string) { try { return url ? new URL(url).hostname : ''; } catch { return ''; } }


export function App({ initialView }: { initialView?: 'settings' }) {
  return <UiProvider><AppContent initialView={initialView} /></UiProvider>;
}

function AppContent({ initialView }: { initialView?: 'settings' }) {
  const { t, locale } = useUi();
  const { confirm, confirmation } = useConfirm();
  const message = (value?: UserMessage) => value ? localizeMessage(value, locale) : '';
  const configuration = initialView === 'settings';
  const [windowId, setWindowId] = useState<number>();
  const windowRef = useRef<number | undefined>(undefined);
  const [state, setState] = useState<OrganizerState>();
  const [error, setError] = useState<UserMessage>('');
  const [notice, setNotice] = useState<UserMessage>('');
  const [busy, setBusy] = useState(false);
  const [editor, setEditor] = useState<Editor>();
  const editorInitial = useRef<Editor | undefined>(undefined);
  const [moving, setMoving] = useState<TabSnapshot>();
  const [moveTarget, setMoveTarget] = useState('');
  const [modalError, setModalError] = useState<UserMessage>('');
  const [modalNotice, setModalNotice] = useState<UserMessage>('');
  const [bindings, setBindings] = useState<Record<string, string>>({});
  useEffect(() => { setNotice(''); }, [state?.task?.id]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), 3000);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (isEditorDirty(editor, editorInitial.current)) event.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [editor]);
  useEffect(() => {
    let alive = true;
    const updateBindings = () => { void chrome.commands.getAll().then(commands => { if (alive) setBindings(Object.fromEntries(commands.map(command => [command.name || '', command.shortcut || '']))); }).catch(() => {}); };
    updateBindings();
    window.addEventListener('focus', updateBindings);
    return () => { alive = false; window.removeEventListener('focus', updateBindings); };
  }, []);
  const sequence = useRef(0);
  const latestRefresh = useRef<Promise<void> | undefined>(undefined);
  const refresh = useCallback(async () => {
    let id = windowRef.current;
    if (id === undefined) {
      const current = await chrome.windows.getCurrent();
      if (current.id === undefined) throw new AppError('messages.could_not_identify_the_current_window_please_retry');
      id = current.id;
      windowRef.current = id;
      setWindowId(id);
    }
    const stamp = ++sequence.current;
    const request = dispatch<OrganizerState>({ type: 'workspace-state', windowId: id }).then(async next => {
      if (stamp === sequence.current) setState(next);
      // A caller saving a form must wait for the response actually shown by the UI,
      // not treat a superseded response as a successful refresh.
      else await latestRefresh.current;
    }, async error => {
      if (stamp !== sequence.current) await latestRefresh.current;
      else throw error;
    });
    latestRefresh.current = request;
    await request;
  }, []);
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const changed = () => { clearTimeout(timer); timer = setTimeout(() => { void refresh().catch(e => setError(errorForDisplay(e))); }, 100); };
    const runtimeChanged = (event: unknown, sender: chrome.runtime.MessageSender) => {
      if (sender.id === chrome.runtime.id && event && typeof event === 'object' && 'type' in event && event.type === ORGANIZER_STATE_CHANGED) changed();
    };
    chrome.runtime.onMessage.addListener(runtimeChanged);
    void chrome.windows.getCurrent().then(async win => {
      if (!alive) return;
      if (win.id === undefined) throw new AppError('messages.could_not_identify_the_current_window_please_retry');
      windowRef.current = win.id; setWindowId(win.id); await refresh();
      if (!configuration) await dispatch({ type: 'acknowledge-result' });
    }).catch(e => setError(errorForDisplay(e)));
    chrome.storage.onChanged.addListener(changed);
    const events = [chrome.tabs.onActivated, chrome.tabs.onUpdated, chrome.tabs.onRemoved, chrome.tabs.onCreated, chrome.tabs.onMoved, chrome.tabs.onAttached, chrome.tabs.onDetached,
      chrome.tabGroups.onCreated, chrome.tabGroups.onUpdated, chrome.tabGroups.onRemoved, chrome.tabGroups.onMoved];
    events.forEach(event => event.addListener(changed));
    return () => { alive = false; clearTimeout(timer); chrome.runtime.onMessage.removeListener(runtimeChanged); chrome.storage.onChanged.removeListener(changed); events.forEach(event => event.removeListener(changed)); };
  }, [refresh, configuration]);
  const action = async (operation: () => Promise<unknown>, success?: UserMessage, modal = false) => {
    setBusy(true); (modal ? setModalError : setError)(''); (modal ? setModalNotice : setNotice)('');
    try { await operation(); await refresh(); if (success) (modal ? setModalNotice : setNotice)(success); return true; }
    catch (e) { (modal ? setModalError : setError)(errorForDisplay(e)); await refresh().catch(() => {}); return false; }
    finally { setBusy(false); }
  };
  if (!state || windowId === undefined) return <main className="sidebar sidebar-loading"><Brand /><p role="status">{message(error) || t('ui.connecting_to_the_extension')}</p><button onClick={() => void action(refresh)}>{t('ui.retry')}</button></main>;
  if (configuration) return <Configuration state={state} windowId={windowId} refresh={refresh} />;
  const active = state.tabs.find(tab => tab.active);
  const locked = busy || state.busy || state.task?.status === 'running';
  const configured = !!state.settings.generator.model.trim() && (!chatPreset(state.settings.generator) || state.hasGeneratorKey) && (state.settings.classifierUseChat || !!state.settings.classifier.model.trim());
  const task = state.task;
  const currentGroup = state.groups.find(group => group.nativeId === active?.groupId);
  const eligibleTabs = state.tabs.filter(tab => tab.eligible);
  const startManual = () => beginEdit({ value: { name: '', color: 'blue', description: '' }, ids: active?.eligible ? [active.id] : [] });
  const label = (name: OrganizeAction) => t(`actions.${name}`);
  const openSettings = () => action(() => chrome.runtime.openOptionsPage());
  const editorChanged = (patch: Partial<EditValue>) => setEditor(current => current ? { ...current, value: { ...current.value, ...patch } } : current);
  const closeEditor = async () => {
    if (busy) return;
    if (!isEditorDirty(editor, editorInitial.current)) { setEditor(undefined); return; }
    if (await confirm({ title: msg('messages.discard_unsaved_changes'), message: msg('messages.your_name_color_description_and_member_selections_will_not'), confirmLabel: msg('messages.discard_changes') })) setEditor(undefined);
  };
  const beginEdit = (value: Editor) => { setModalError(''); setModalNotice(''); editorInitial.current = structuredClone(value); setEditor(value); };
  const beginMove = (tab: TabSnapshot) => { setModalError(''); setModalNotice(''); setMoving(tab); setMoveTarget(''); };
  const locate = (tab: TabSnapshot) => action(() => dispatch({ type: 'locate-tab', tab }));
  const saveEditor = async () => {
    if (!editor || locked) return;
    const ok = await action(async () => {
      if (editor.original) await dispatch({ type: 'edit-group', windowId, groupId: editor.original.nativeId, profileId: editor.original.profileId, expected: { name: editor.original.name, description: editor.original.description, color: editor.original.color }, value: editor.value });
      else {
        const result = await dispatch<{ ids: number[]; warning?: UserMessage }>({ type: 'create-manual', windowId, tabs: state.tabs.filter(tab => editor.ids.includes(tab.id) && tab.eligible), value: editor.value });
        if (!result.ids.length || result.warning) {
          if (result.warning && typeof result.warning !== 'string') throw new AppError(result.warning.code, result.warning.params);
          if (result.warning) throw new Error(result.warning);
          throw new AppError('group.noMembers');
        }
      }
    }, undefined, true);
    if (ok) { setEditor(undefined); setNotice(msg('ui.group_saved')); }
  };
  const activeGrouped = active && active.groupId !== -1;
  const activeStatus = activeGrouped ? t('ui.grouped') : active?.pinned ? t('ui.pinned') : active?.eligible ? t('ui.ungrouped') : t('ui.unavailable');
  const activeExtension = /^chrome-extension:/.test(active?.url || '');
  const activeSupported = /^https?:/.test(active?.url || '');
  const activeDomain = activeExtension ? t('ui.extension_page') : activeSupported ? domain(active?.url) : t('ui.browser_page');
  return <main className="sidebar">
    <header className="sidebar-header"><Brand /><button className="icon-button" aria-label={t('ui.open_settings')} title={t('ui.open_settings')} onClick={() => void openSettings()}><Icon name="settings" /></button></header>
    <div className="sidebar-feedback">{error && <div className="alert error" role="alert">{message(error)}</div>}</div>
    <div className="sidebar-toast" role="status" aria-live="polite" aria-atomic="true">{notice && <div className="sidebar-toast-message"><Icon name="check" size={17} /><span>{message(notice)}</span></div>}</div>
    <div className="sidebar-cards">
    {!configured && <div className="sidebar-setup"><Icon name="info" /><div><p>{t('ui.set_up_your_model_service_to_start_organizing')}</p><button className="text-button" onClick={() => void openSettings()}>{t('ui.open_settings')}<Icon name="arrow" size={14} /></button></div></div>}
    <section className={`sidebar-section current-page${!activeSupported ? ' current-page-unavailable' : ''}`} aria-labelledby="current-heading">
      <div className="sidebar-section-title"><h2 id="current-heading">{t('ui.current_page')}</h2><span className="page-state">{activeStatus}</span></div>
      <div className="current-page-info"><span className="page-icon"><Icon name="file" /></span><div><p className="current-title">{active?.title || (activeSupported ? active?.url : '') || t('ui.current_page_unavailable')}</p>{active && <p className="page-domain">{activeDomain}</p>}</div></div>
      {activeGrouped && <p className="sidebar-hint">{t('group.current', { name: currentGroup?.name || t('group.unnamed') })}</p>}
      {active?.pinned && !activeGrouped && <p className="sidebar-hint">{t('ui.pinned_tabs_are_excluded_from_automatic_grouping')}</p>}
      {active?.eligible && !state.groups.length && <p className="sidebar-hint">{t('ui.this_action_joins_an_existing_group_with_no_groups')}</p>}
      <button className="sidebar-action" aria-label={label('organize-current')} disabled={locked || !configured || !active?.eligible || !state.groups.length} onClick={() => void action(() => dispatch({ type: 'organize', action: 'organize-current', windowId, tabId: active?.id }))}><span>{label('organize-current')}</span>{bindings['organize-current'] && <kbd>{bindings['organize-current']}</kbd>}</button>
      {active && /^https?:/.test(active.url) && !active.pinned && state.groups.length > 0 && <button className="text-button manual-current" disabled={locked} onClick={() => beginMove(active)}>{t('ui.choose_a_group_manually')}<Icon name="chevron" size={14} /></button>}
    </section>
    <section className="sidebar-section batch-section" aria-labelledby="window-heading">
      <div className="sidebar-section-title"><h2 id="window-heading">{t('ui.this_window')}</h2><span className="muted">{t('counts.groups', { count: state.groups.length })}</span></div>
      <WindowTabScope tabs={state.tabs} groups={state.groups} />
      <div className="batch-actions"><button className="sidebar-action" aria-label={label('organize-window')} disabled={locked || !configured || !eligibleTabs.length} onClick={() => void action(() => dispatch({ type: 'organize', action: 'organize-window', windowId }))}><span>{label('organize-window')}</span>{bindings['organize-window'] && <kbd>{bindings['organize-window']}</kbd>}</button>
        <button className="sidebar-action" aria-label={label('organize-window-with-new')} disabled={locked || !configured || !eligibleTabs.length} onClick={() => void action(() => dispatch({ type: 'organize', action: 'organize-window-with-new', windowId }))}><span>{label('organize-window-with-new')}</span>{bindings['organize-window-with-new'] ? <kbd>{bindings['organize-window-with-new']}</kbd> : <Icon name="arrow" size={16} />}</button></div>
      {task?.status === 'running' && <TaskProgress task={task} disabled={busy} onCancel={() => void action(() => dispatch({ type: 'cancel' }))} />}
    </section>
    <section className="sidebar-section groups-section" aria-labelledby="groups-heading"><div className="sidebar-section-title"><h2 id="groups-heading">{t('ui.window_groups')}</h2><button className="text-button" disabled={locked} onClick={startManual}><Icon name="plus" size={15} />{t('ui.new_group')}</button></div>
      {!state.groups.length && <div className="groups-empty"><Icon name="file" /><p>{t('ui.your_groups_will_appear_here')}</p><span>{t('ui.update_groups_to_organize_automatically_or_choose_pages_for')}</span></div>}
      <div className="native-groups">{state.groups.map(group => <details className="native-group" key={group.nativeId}><DisclosureSummary><span className="group-swatch" style={{ background: groupColors[group.color] }} /><span className="group-summary-text"><strong>{group.name || t('ui.untitled_group')}</strong><span>{group.description || t('ui.description_needed')}</span></span><span className="group-member-count" aria-label={t('counts.members', { count: group.members.length })}>{group.members.length}</span></DisclosureSummary>
        <div className="group-content"><p className="group-description">{group.description || t('ui.a_description_will_be_generated_from_the_group_s')}</p><p className="description-source">{!group.description ? t('ui.pending') : group.source === 'user' ? t('ui.user_edited') : group.source === 'legacy' ? t('ui.imported_description') : t('ui.model_generated')}{group.sampleCount !== undefined ? t('counts.samples', { count: group.sampleCount }) : ''}</p><button disabled={locked} onClick={() => beginEdit({ original: structuredClone(group), value: { name: group.name, description: group.description, color: group.color }, ids: [] })}>{t('ui.edit_group')}</button>
          <ul className="group-members">{group.members.map(member => <li key={member.id}><button className="text-button" title={member.title || member.url} onClick={() => void locate(member)}><Icon name="file" size={14} /><span>{member.title || member.url}</span><Icon name="external" size={12} /></button></li>)}</ul>
        </div></details>)}</div>
    </section>
    <UndoGrouping state={state} windowId={windowId} disabled={locked} onUndo={() => void action(async () => { setNotice(await dispatch<UserMessage>({ type: 'undo' })); })} />
    </div>
    {moving && <Modal title={t('ui.choose_a_group')} busy={busy} onClose={() => { if (!busy) setMoving(undefined); }} footer={<><button disabled={busy} onClick={() => setMoving(undefined)}>{t('ui.cancel')}</button><button className="primary" disabled={locked || !moveTarget} onClick={() => void action(() => dispatch({ type: 'move-manual', tab: moving, groupId: Number(moveTarget) }), undefined, true).then(ok => { if (ok) { setMoving(undefined); setNotice(msg('ui.page_moved')); } })}>{busy ? t('ui.moving') : t('ui.move_page')}</button></>}>
      <p className="modal-page-title">{moving.title || moving.url}</p><p className="muted">{t('ui.move_directly_to_the_selected_group_without_a_model')}</p>{modalError && <div className="alert error" role="alert">{message(modalError)}</div>}<label className="field">{t('ui.target_group')}<select aria-label={t('ui.target_group')} disabled={busy} value={moveTarget} onChange={event => setMoveTarget(event.target.value)}><option value="">{t('ui.choose_a_group_2')}</option>{state.groups.filter(group => group.nativeId !== moving.groupId).map(group => <option key={group.nativeId} value={group.nativeId}>{group.name || t('ui.untitled_group')} · {t('counts.pages', { count: group.members.length })}{state.groups.filter(other => other.name === group.name).length > 1 ? ` · #${group.nativeId}` : ''}</option>)}</select></label>
      {!state.groups.some(group => group.nativeId !== moving.groupId) && <p className="sidebar-hint">{t('ui.there_are_no_other_groups_in_this_window')}</p>}
    </Modal>}
    {editor && <Modal title={editor.original ? t('ui.edit_group') : t('ui.create_a_group')} busy={busy} onClose={() => void closeEditor()} footer={<><button disabled={busy} onClick={() => void closeEditor()}>{t('ui.cancel')}</button><button type="submit" form="group-editor" className="primary" disabled={locked || (!editor.original && !editor.ids.length)}>{busy ? t('ui.working') : t('ui.save_group')}</button></>}>
      <form id="group-editor" className="group-editor" onSubmit={event => { event.preventDefault(); void saveEditor(); }}>
        {modalError && <div className="alert error" role="alert">{message(modalError)}</div>}{modalNotice && <div className="alert" role="status">{message(modalNotice)}</div>}
        <label className="field">{t('ui.name')}<input required maxLength={200} disabled={busy} value={editor.value.name} onChange={event => editorChanged({ name: event.target.value })} /></label>
        <label className="field">{t('ui.color')}<select aria-label={t('ui.color')} disabled={busy} value={editor.value.color} onChange={event => editorChanged({ color: event.target.value as Category['color'] })}>{colors.map(color => <option key={color} value={color}>{t(`color.${color}`)}</option>)}</select></label>
        <label className="field">{t('ui.group_description')}<textarea disabled={busy} maxLength={5000} value={editor.value.description} onChange={event => editorChanged({ description: event.target.value })} /></label>
        {editor.original ? <button type="button" disabled={locked || !configured} onClick={() => {
          const original = editor;
          void action(async () => {
            const result = await dispatch<{ description: string }>({ type: 'describe-group', windowId, groupId: original.original!.nativeId });
            setEditor(current => current?.original?.nativeId === original.original!.nativeId && current.value.description === original.value.description && current.value.name === original.value.name ? { ...current, value: { ...current.value, description: result.description } } : current);
          }, msg('messages.description_draft_generated_save_to_apply_it_2'), true);
        }}><Icon name="refresh" size={14} />{t('ui.update_description_from_pages')}</button> : <p className="sidebar-hint">{t('ui.you_can_leave_this_blank_it_will_be_generated')}</p>}
        {!editor.original && <fieldset className="member-picker"><legend>{t('ui.choose_pages')} · {editor.ids.length}</legend><p className="sidebar-hint">{t('ui.select_at_least_1_page_manual_grouping_does_not')}</p><div className="member-picker-list">{eligibleTabs.map(tab => <label className="member-choice" key={tab.id}><input type="checkbox" disabled={busy} checked={editor.ids.includes(tab.id)} onChange={event => setEditor({ ...editor, ids: event.target.checked ? [...editor.ids, tab.id] : editor.ids.filter(id => id !== tab.id) })} /><span>{tab.title || tab.url}<small>{domain(tab.url)}</small></span></label>)}</div>{!eligibleTabs.length && <p className="sidebar-hint">{t('ui.no_eligible_ungrouped_pages_available')}</p>}</fieldset>}
        {editor.original && modalError && <button type="button" disabled={locked} onClick={() => {
          const latest = state.groups.find(group => group.nativeId === editor.original!.nativeId);
          if (latest) void confirm({ title: msg('messages.replace_current_group_details'), message: msg('messages.keep_your_edits_and_replace_the_current_group_s'), confirmLabel: msg('messages.allow_next_save') }).then(ok => { if (ok) { setEditor({ ...editor, original: structuredClone(latest) }); setModalError(''); } });
        }}>{t('ui.keep_edits_and_confirm_replacement')}</button>}
      </form>
    </Modal>}
    {confirmation}
  </main>;
}
