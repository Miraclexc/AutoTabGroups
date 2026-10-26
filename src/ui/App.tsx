import { useCallback, useEffect, useRef, useState } from 'react';
import { actionLabels, dispatch, ORGANIZER_STATE_CHANGED, type GroupView, type OrganizerState, type OrganizeAction } from '../shared/organizer';
import { colors, type Category, type TabSnapshot } from '../shared/schemas';
import { errorMessage } from '../shared/errors';
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
const actionEnglish: Record<OrganizeAction, string> = { 'organize-current': 'Organize current tab', 'organize-window': 'Update groups', 'organize-window-with-new': 'Update & allow new groups' };
const colorNames: Record<Category['color'], string> = { grey: '灰色', blue: '蓝色', red: '红色', yellow: '黄色', green: '绿色', pink: '粉色', purple: '紫色', cyan: '青色', orange: '橙色' };
export const groupColors: Record<Category['color'], string> = { grey: '#7d8593', blue: '#4b77d1', red: '#c96565', yellow: '#b99233', green: '#488b70', pink: '#c96f9b', purple: '#9a74b8', cyan: '#398b9c', orange: '#c8823f' };
function domain(url?: string) { try { return url ? new URL(url).hostname : ''; } catch { return ''; } }
function countLabel(count: number, noun: string) { return `${count} ${noun}${count === 1 ? '' : 's'}`; }

export function App({ initialView }: { initialView?: 'settings' }) {
  return <UiProvider><AppContent initialView={initialView} /></UiProvider>;
}

function AppContent({ initialView }: { initialView?: 'settings' }) {
  const { t, locale } = useUi();
  const { confirm, confirmation } = useConfirm();
  const message = (value?: string) => value ? localizeMessage(value, locale) : '';
  const configuration = initialView === 'settings';
  const [windowId, setWindowId] = useState<number>();
  const windowRef = useRef<number | undefined>(undefined);
  const [state, setState] = useState<OrganizerState>();
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [editor, setEditor] = useState<Editor>();
  const editorInitial = useRef<Editor | undefined>(undefined);
  const [moving, setMoving] = useState<TabSnapshot>();
  const [moveTarget, setMoveTarget] = useState('');
  const [modalError, setModalError] = useState('');
  const [modalNotice, setModalNotice] = useState('');
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
      if (current.id === undefined) throw new Error('无法确定当前窗口，请重试');
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
    const changed = () => { clearTimeout(timer); timer = setTimeout(() => { void refresh().catch(e => setError(errorMessage(e))); }, 100); };
    const runtimeChanged = (event: unknown, sender: chrome.runtime.MessageSender) => {
      if (sender.id === chrome.runtime.id && event && typeof event === 'object' && 'type' in event && event.type === ORGANIZER_STATE_CHANGED) changed();
    };
    chrome.runtime.onMessage.addListener(runtimeChanged);
    void chrome.windows.getCurrent().then(async win => {
      if (!alive) return;
      if (win.id === undefined) throw new Error('无法确定当前窗口，请重试');
      windowRef.current = win.id; setWindowId(win.id); await refresh();
      if (!configuration) await dispatch({ type: 'acknowledge-result' });
    }).catch(e => setError(errorMessage(e)));
    chrome.storage.onChanged.addListener(changed);
    const events = [chrome.tabs.onActivated, chrome.tabs.onUpdated, chrome.tabs.onRemoved, chrome.tabs.onCreated, chrome.tabs.onMoved, chrome.tabs.onAttached, chrome.tabs.onDetached,
      chrome.tabGroups.onCreated, chrome.tabGroups.onUpdated, chrome.tabGroups.onRemoved, chrome.tabGroups.onMoved];
    events.forEach(event => event.addListener(changed));
    return () => { alive = false; clearTimeout(timer); chrome.runtime.onMessage.removeListener(runtimeChanged); chrome.storage.onChanged.removeListener(changed); events.forEach(event => event.removeListener(changed)); };
  }, [refresh, configuration]);
  const action = async (operation: () => Promise<unknown>, success?: string, modal = false) => {
    setBusy(true); (modal ? setModalError : setError)(''); (modal ? setModalNotice : setNotice)('');
    try { await operation(); await refresh(); if (success) (modal ? setModalNotice : setNotice)(success); return true; }
    catch (e) { (modal ? setModalError : setError)(errorMessage(e)); await refresh().catch(() => {}); return false; }
    finally { setBusy(false); }
  };
  if (!state || windowId === undefined) return <main className="sidebar sidebar-loading"><Brand /><p role="status">{message(error) || t('正在连接扩展后台…', 'Connecting to the extension…')}</p><button onClick={() => void action(refresh)}>{t('重试', 'Retry')}</button></main>;
  if (configuration) return <Configuration state={state} windowId={windowId} refresh={refresh} />;
  const active = state.tabs.find(tab => tab.active);
  const locked = busy || state.busy || state.task?.status === 'running';
  const configured = !!state.settings.generator.model.trim() && (!chatPreset(state.settings.generator) || state.hasGeneratorKey) && (state.settings.classifierUseChat || !!state.settings.classifier.model.trim());
  const task = state.task;
  const currentGroup = state.groups.find(group => group.nativeId === active?.groupId);
  const eligibleTabs = state.tabs.filter(tab => tab.eligible);
  const startManual = () => beginEdit({ value: { name: '', color: 'blue', description: '' }, ids: active?.eligible ? [active.id] : [] });
  const label = (name: OrganizeAction) => t(actionLabels[name], actionEnglish[name]);
  const openSettings = () => action(() => chrome.runtime.openOptionsPage());
  const editorChanged = (patch: Partial<EditValue>) => setEditor(current => current ? { ...current, value: { ...current.value, ...patch } } : current);
  const closeEditor = async () => {
    if (busy) return;
    if (!isEditorDirty(editor, editorInitial.current)) { setEditor(undefined); return; }
    if (await confirm({ title: t('放弃未保存的编辑？', 'Discard unsaved changes?'), message: t('关闭后，本次输入的名称、颜色、说明和成员选择将不会保存。', 'Your name, color, description and member selections will not be saved.'), confirmLabel: t('放弃编辑', 'Discard changes') })) setEditor(undefined);
  };
  const beginEdit = (value: Editor) => { setModalError(''); setModalNotice(''); editorInitial.current = structuredClone(value); setEditor(value); };
  const beginMove = (tab: TabSnapshot) => { setModalError(''); setModalNotice(''); setMoving(tab); setMoveTarget(''); };
  const locate = (tab: TabSnapshot) => action(() => dispatch({ type: 'locate-tab', tab }));
  const saveEditor = async () => {
    if (!editor || locked) return;
    const ok = await action(async () => {
      if (editor.original) await dispatch({ type: 'edit-group', windowId, groupId: editor.original.nativeId, profileId: editor.original.profileId, expected: { name: editor.original.name, description: editor.original.description, color: editor.original.color }, value: editor.value });
      else {
        const result = await dispatch<{ ids: number[]; warning?: string }>({ type: 'create-manual', windowId, tabs: state.tabs.filter(tab => editor.ids.includes(tab.id) && tab.eligible), value: editor.value });
        if (!result.ids.length || result.warning) throw new Error(result.warning || '没有有效成员');
      }
    }, undefined, true);
    if (ok) { setEditor(undefined); setNotice(t('分组已保存', 'Group saved')); }
  };
  const activeGrouped = active && active.groupId !== -1;
  const activeStatus = activeGrouped ? t('已分组', 'Grouped') : active?.pinned ? t('已固定', 'Pinned') : active?.eligible ? t('未分组', 'Ungrouped') : t('不可整理', 'Unavailable');
  const activeExtension = /^chrome-extension:/.test(active?.url || '');
  const activeSupported = /^https?:/.test(active?.url || '');
  const activeDomain = activeExtension ? t('扩展页面', 'Extension page') : activeSupported ? domain(active?.url) : t('浏览器内部页面', 'Browser page');
  return <main className="sidebar">
    <header className="sidebar-header"><Brand /><button className="icon-button" aria-label={t('打开配置', 'Open settings')} title={t('打开配置', 'Open settings')} onClick={() => void openSettings()}><Icon name="settings" /></button></header>
    <div className="sidebar-feedback">{error && <div className="alert error" role="alert">{message(error)}</div>}</div>
    <div className="sidebar-toast" role="status" aria-live="polite" aria-atomic="true">{notice && <div className="sidebar-toast-message"><Icon name="check" size={17} /><span>{message(notice)}</span></div>}</div>
    <div className="sidebar-cards">
    {!configured && <div className="sidebar-setup"><Icon name="info" /><div><p>{t('配置模型服务后，即可开始整理。', 'Set up your model service to start organizing.')}</p><button className="text-button" onClick={() => void openSettings()}>{t('打开配置', 'Open settings')}<Icon name="arrow" size={14} /></button></div></div>}
    <section className={`sidebar-section current-page${!activeSupported ? ' current-page-unavailable' : ''}`} aria-labelledby="current-heading">
      <div className="sidebar-section-title"><h2 id="current-heading">{t('当前页面', 'Current page')}</h2><span className="page-state">{activeStatus}</span></div>
      <div className="current-page-info"><span className="page-icon"><Icon name="file" /></span><div><p className="current-title">{active?.title || (activeSupported ? active?.url : '') || t('无法确定当前页面', 'Current page unavailable')}</p>{active && <p className="page-domain">{activeDomain}</p>}</div></div>
      {activeGrouped && <p className="sidebar-hint">{t(`已在「${currentGroup?.name || '分组'}」中，保持原组。`, `In “${currentGroup?.name || 'group'}”; its group will be preserved.`)}</p>}
      {active?.pinned && !activeGrouped && <p className="sidebar-hint">{t('固定标签不参与自动整理。', 'Pinned tabs are excluded from automatic grouping.')}</p>}
      {active?.eligible && !state.groups.length && <p className="sidebar-hint">{t('当前页只能加入已有组。尚无分组时，请使用下方批量整理或手动建组。', 'This action joins an existing group. With no groups yet, use the window action or create a group manually below.')}</p>}
      <button className="sidebar-action" aria-label={label('organize-current')} disabled={locked || !configured || !active?.eligible || !state.groups.length} onClick={() => void action(() => dispatch({ type: 'organize', action: 'organize-current', windowId, tabId: active?.id }))}><span>{label('organize-current')}</span>{bindings['organize-current'] && <kbd>{bindings['organize-current']}</kbd>}</button>
      {active && /^https?:/.test(active.url) && !active.pinned && state.groups.length > 0 && <button className="text-button manual-current" disabled={locked} onClick={() => beginMove(active)}>{t('手动指定分组', 'Choose a group manually')}<Icon name="chevron" size={14} /></button>}
    </section>
    <section className="sidebar-section batch-section" aria-labelledby="window-heading">
      <div className="sidebar-section-title"><h2 id="window-heading">{t('本窗口整理', 'This window')}</h2><span className="muted">{t(`${state.groups.length} 个分组`, countLabel(state.groups.length, 'group'))}</span></div>
      <WindowTabScope tabs={state.tabs} groups={state.groups} />
      <div className="batch-actions"><button className="sidebar-action" aria-label={label('organize-window')} disabled={locked || !configured || !eligibleTabs.length} onClick={() => void action(() => dispatch({ type: 'organize', action: 'organize-window', windowId }))}><span>{label('organize-window')}</span>{bindings['organize-window'] && <kbd>{bindings['organize-window']}</kbd>}</button>
        <button className="sidebar-action" aria-label={label('organize-window-with-new')} disabled={locked || !configured || !eligibleTabs.length} onClick={() => void action(() => dispatch({ type: 'organize', action: 'organize-window-with-new', windowId }))}><span>{label('organize-window-with-new')}</span>{bindings['organize-window-with-new'] ? <kbd>{bindings['organize-window-with-new']}</kbd> : <Icon name="arrow" size={16} />}</button></div>
      {task?.status === 'running' && <TaskProgress task={task} disabled={busy} onCancel={() => void action(() => dispatch({ type: 'cancel' }))} />}
    </section>
    <section className="sidebar-section groups-section" aria-labelledby="groups-heading"><div className="sidebar-section-title"><h2 id="groups-heading">{t('本窗口分组', 'Window groups')}</h2><button className="text-button" disabled={locked} onClick={startManual}><Icon name="plus" size={15} />{t('手动建组', 'New group')}</button></div>
      {!state.groups.length && <div className="groups-empty"><Icon name="file" /><p>{t('分组会显示在这里', 'Your groups will appear here')}</p><span>{t('更新分组自动整理，或手动选择页面建组。', 'Update groups to organize automatically, or choose pages for a manual group.')}</span></div>}
      <div className="native-groups">{state.groups.map(group => <details className="native-group" key={group.nativeId}><DisclosureSummary><span className="group-swatch" style={{ background: groupColors[group.color] }} /><span className="group-summary-text"><strong>{group.name || t('未命名分组', 'Untitled group')}</strong><span>{group.description || t('待补充分组说明', 'Description needed')}</span></span><span className="group-member-count" aria-label={t(`${group.members.length} 个成员`, countLabel(group.members.length, 'member'))}>{group.members.length}</span></DisclosureSummary>
        <div className="group-content"><p className="group-description">{group.description || t('下次整理时，自动根据组内网页补充说明。', 'A description will be generated from the group’s pages the next time you organize.')}</p><p className="description-source">{!group.description ? t('待补充', 'Pending') : group.source === 'user' ? t('用户编辑', 'User edited') : group.source === 'legacy' ? t('保留的历史说明', 'Imported description') : t('模型生成', 'Model generated')}{group.sampleCount !== undefined ? t(` · 参考 ${group.sampleCount} 页`, ' · Based on ' + countLabel(group.sampleCount, 'page')) : ''}</p><button disabled={locked} onClick={() => beginEdit({ original: structuredClone(group), value: { name: group.name, description: group.description, color: group.color }, ids: [] })}>{t('编辑分组', 'Edit group')}</button>
          <ul className="group-members">{group.members.map(member => <li key={member.id}><button className="text-button" title={member.title || member.url} onClick={() => void locate(member)}><Icon name="file" size={14} /><span>{member.title || member.url}</span><Icon name="external" size={12} /></button></li>)}</ul>
        </div></details>)}</div>
    </section>
    <UndoGrouping state={state} windowId={windowId} disabled={locked} onUndo={() => void action(async () => { setNotice(await dispatch<string>({ type: 'undo' })); })} />
    </div>
    {moving && <Modal title={t('手动指定分组', 'Choose a group')} busy={busy} onClose={() => { if (!busy) setMoving(undefined); }} footer={<><button disabled={busy} onClick={() => setMoving(undefined)}>{t('取消', 'Cancel')}</button><button className="primary" disabled={locked || !moveTarget} onClick={() => void action(() => dispatch({ type: 'move-manual', tab: moving, groupId: Number(moveTarget) }), undefined, true).then(ok => { if (ok) { setMoving(undefined); setNotice(t('已手动改分', 'Page moved')); } })}>{busy ? t('正在移动…', 'Moving…') : t('确认改分', 'Move page')}</button></>}>
      <p className="modal-page-title">{moving.title || moving.url}</p><p className="muted">{t('直接移动到选定分组，不调用模型。', 'Move directly to the selected group without a model request.')}</p>{modalError && <div className="alert error" role="alert">{message(modalError)}</div>}<label className="field">{t('目标分组', 'Target group')}<select aria-label={t('目标分组', 'Target group')} disabled={busy} value={moveTarget} onChange={event => setMoveTarget(event.target.value)}><option value="">{t('请选择', 'Choose a group')}</option>{state.groups.filter(group => group.nativeId !== moving.groupId).map(group => <option key={group.nativeId} value={group.nativeId}>{group.name || t('未命名分组', 'Untitled group')} · {t(`${group.members.length} 页`, countLabel(group.members.length, 'page'))}{state.groups.filter(other => other.name === group.name).length > 1 ? ` · #${group.nativeId}` : ''}</option>)}</select></label>
      {!state.groups.some(group => group.nativeId !== moving.groupId) && <p className="sidebar-hint">{t('当前窗口没有其他可选分组。', 'There are no other groups in this window.')}</p>}
    </Modal>}
    {editor && <Modal title={editor.original ? t('编辑分组', 'Edit group') : t('手动建立分组', 'Create a group')} busy={busy} onClose={() => void closeEditor()} footer={<><button disabled={busy} onClick={() => void closeEditor()}>{t('取消', 'Cancel')}</button><button type="submit" form="group-editor" className="primary" disabled={locked || (!editor.original && !editor.ids.length)}>{busy ? t('正在处理…', 'Working…') : t('保存分组', 'Save group')}</button></>}>
      <form id="group-editor" className="group-editor" onSubmit={event => { event.preventDefault(); void saveEditor(); }}>
        {modalError && <div className="alert error" role="alert">{message(modalError)}</div>}{modalNotice && <div className="alert" role="status">{message(modalNotice)}</div>}
        <label className="field">{t('名称', 'Name')}<input required maxLength={200} disabled={busy} value={editor.value.name} onChange={event => editorChanged({ name: event.target.value })} /></label>
        <label className="field">{t('颜色', 'Color')}<select aria-label={t('颜色', 'Color')} disabled={busy} value={editor.value.color} onChange={event => editorChanged({ color: event.target.value as Category['color'] })}>{colors.map(color => <option key={color} value={color}>{t(colorNames[color], color[0].toUpperCase() + color.slice(1))}</option>)}</select></label>
        <label className="field">{t('分组说明', 'Group description')}<textarea disabled={busy} maxLength={5000} value={editor.value.description} onChange={event => editorChanged({ description: event.target.value })} /></label>
        {editor.original ? <button type="button" disabled={locked || !configured} onClick={() => {
          const original = editor;
          void action(async () => {
            const result = await dispatch<{ description: string }>({ type: 'describe-group', windowId, groupId: original.original!.nativeId });
            setEditor(current => current?.original?.nativeId === original.original!.nativeId && current.value.description === original.value.description && current.value.name === original.value.name ? { ...current, value: { ...current.value, description: result.description } } : current);
          }, t('说明草稿已生成，保存后生效。', 'Description draft generated. Save to apply it.'), true);
        }}><Icon name="refresh" size={14} />{t('根据组内网页更新说明', 'Update description from pages')}</button> : <p className="sidebar-hint">{t('说明可留空，下次整理时自动补充。', 'You can leave this blank; it will be generated the next time you organize.')}</p>}
        {!editor.original && <fieldset className="member-picker"><legend>{t('选择成员', 'Choose pages')} · {editor.ids.length}</legend><p className="sidebar-hint">{t('至少选择 1 页。手动建组不调用模型。', 'Select at least 1 page. Manual grouping does not call a model.')}</p><div className="member-picker-list">{eligibleTabs.map(tab => <label className="member-choice" key={tab.id}><input type="checkbox" disabled={busy} checked={editor.ids.includes(tab.id)} onChange={event => setEditor({ ...editor, ids: event.target.checked ? [...editor.ids, tab.id] : editor.ids.filter(id => id !== tab.id) })} /><span>{tab.title || tab.url}<small>{domain(tab.url)}</small></span></label>)}</div>{!eligibleTabs.length && <p className="sidebar-hint">{t('没有可选的未分组网页。', 'No eligible ungrouped pages available.')}</p>}</fieldset>}
        {editor.original && modalError && <button type="button" disabled={locked} onClick={() => {
          const latest = state.groups.find(group => group.nativeId === editor.original!.nativeId);
          if (latest) void confirm({ title: t('确认覆盖当前分组？', 'Replace current group details?'), message: t('保留你的输入，并在下次保存时覆盖当前分组的名称、颜色和说明。', 'Keep your edits and replace the current group’s name, color and description when you save.'), confirmLabel: t('允许下次保存', 'Allow next save') }).then(ok => { if (ok) { setEditor({ ...editor, original: structuredClone(latest) }); setModalError(''); } });
        }}>{t('保留编辑，确认覆盖…', 'Keep edits and confirm replacement…')}</button>}
      </form>
    </Modal>}
    {confirmation}
  </main>;
}
