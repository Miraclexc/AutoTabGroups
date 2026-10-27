import { msg, type UserMessage } from '../i18n';
import { useEffect, useState } from 'react';
import { dispatch, type OrganizerState, type OrganizeAction } from '../shared/organizer';
import { TaskProgress } from './TaskProgress';
import type { TabSnapshot } from '../shared/schemas';
import { errorForDisplay, isConfigurationError } from '../shared/errors';
import { CandidateScores } from './CandidateScores';
import { DisclosureSummary, Icon, Modal, useConfirm } from './components';
import { useUi } from './preferences';
import { localizeMessage } from './messages';

export function RecentActivity({ state, windowId, refresh, onOpenSettings }: { state: OrganizerState; windowId: number; refresh: () => Promise<void>; onOpenSettings: () => void }) {
  const { t, locale } = useUi();
  const { confirm, confirmation } = useConfirm();
  const message = (value?: UserMessage) => value ? localizeMessage(value, locale) : '';
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<UserMessage>('');
  const [notice, setNotice] = useState<UserMessage>('');
  const [moving, setMoving] = useState<TabSnapshot>();
  const [moveTarget, setMoveTarget] = useState('');
  const [modalError, setModalError] = useState<UserMessage>('');
  useEffect(() => { setNotice(''); }, [state.task?.id]);
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(''), 3000); return () => clearTimeout(timer); }, [notice]);
  const task = state.task;
  const liveTask = task?.sessionId === state.sessionId;
  const locked = busy || state.busy || task?.status === 'running';
  const label = (name: OrganizeAction) => t(`actions.${name}`);
  const openSettings = onOpenSettings;
  const action = async (operation: () => Promise<unknown>, success?: UserMessage, modal = false) => {
    setBusy(true); (modal ? setModalError : setError)(''); setNotice('');
    try { await operation(); await refresh(); if (success) setNotice(success); return true; }
    catch (e) { (modal ? setModalError : setError)(errorForDisplay(e)); await refresh().catch(() => {}); return false; }
    finally { setBusy(false); }
  };
  const locate = (tab: TabSnapshot) => action(() => dispatch({ type: 'locate-tab', tab }));
  const beginMove = (tab: TabSnapshot) => { setModalError(''); setMoving(tab); setMoveTarget(''); };
  const configurationFailure = !!task && [task.message, ...task.items.filter(item => item.status === 'failed').map(item => item.message)].some(isConfigurationError);
  const counts = { applied: 0, unmatched: 0, skipped: 0, failed: 0 };
  task?.items.forEach(item => { if (item.status === 'uncertain') counts.unmatched++; else if (item.status in counts) counts[item.status as keyof typeof counts]++; });
  const summary = (Object.keys(counts) as (keyof typeof counts)[]).filter(status => counts[status]).map(status => t('result.summary', { count: counts[status], status: t(`status.${status}`) })).join(t('ui.separator'));
  const commonReason = task?.status === 'completed' && !counts.applied && task.items.length && task.items.every(item => JSON.stringify(item.message) === JSON.stringify(task.items[0].message)) ? task.items[0].message : undefined;
  const currentTaskTime = task ? new Date(task.createdAt).toLocaleString(locale, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';

  return <div className="recent-activity config-pane">
    <p className="activity-explanation">{t('ui.review_the_latest_run_inspect_decisions_or_retry_pages')}</p>
    {error && <div className="alert error" role="alert">{message(error)}</div>}
    <div className="sidebar-toast" role="status" aria-live="polite" aria-atomic="true">{notice && <div className="sidebar-toast-message"><Icon name="check" size={17} /><span>{message(notice)}</span></div>}</div>
    <section className="recent-section" aria-labelledby="recent-heading">
      <div className="sidebar-section-title"><h2 id="recent-heading">{t('ui.task_result')}</h2></div>
      {!task ? <p className="sidebar-hint">{t('ui.your_organizing_results_will_appear_here')}</p> : <>
        <div className="task-state"><span className={`task-indicator ${task.status === 'completed' && !counts.applied ? 'unchanged' : task.status}`} aria-hidden="true" /><strong>{task.status === 'completed' && !counts.applied ? t('ui.no_tabs_moved') : t(`task.${task.status}`)}</strong><span className="muted">{task.windowId === windowId ? t('ui.this_window_2') : t('ui.other_window')}</span></div>
        <p className="task-caption">{label(task.action)} · <time dateTime={new Date(task.createdAt).toISOString()}>{currentTaskTime}</time>{!liveTask && t('ui.previous_browser_session')}</p>
        {task.status === 'running' && <TaskProgress task={task} disabled={busy} onCancel={() => void action(() => dispatch({ type: 'cancel' }))} />}
        {task.status !== 'running' && summary && <p className="task-overview">{summary}</p>}
        {task.message && (typeof task.message === 'string' || task.message.code !== 'task.finished') && <p className="task-message" role="status">{message(task.message)}</p>}
        {commonReason && <p className="task-message">{message(commonReason)}</p>}
        {state.busy && task.status !== 'running' && <p className="task-settling" role="status">{t('ui.waiting_for_the_background_operation_to_finish')}</p>}
        {configurationFailure && <div className="task-config-recovery"><p>{t('ui.check_your_model_service_settings_before_retrying')}</p><button onClick={() => void openSettings()}><Icon name="settings" size={14} />{t('ui.open_settings')}</button></div>}
        {!!task.items.length && <details className="task-details" key={task.id}><DisclosureSummary>{t('ui.view_page_results')}<span>{task.items.length}</span></DisclosureSummary>
          <div className="result-summary">{(['applied', 'unmatched', 'skipped', 'failed'] as const).map(status => <span key={status}><b>{counts[status]}</b>{t(`status.${status}`)}</span>)}</div>
          <p className="sidebar-hint">{t('ui.results_from_this_run_later_manual_moves_do_not')}</p>
          {task.windowId !== windowId && <p className="task-window-detail">{t('result.sourceWindow', { windowId: task.windowId })}</p>}
          <ul className="sidebar-results">{task.items.map(item => <li key={item.tab.id}><div className="result-heading"><button className="text-button result-title" title={item.tab.title || item.tab.url} onClick={() => void locate(item.tab)}>{item.tab.title || item.tab.url}</button>{!(item.status === 'applied' && item.message && typeof item.message !== 'string' && item.message.code === 'task.joined') && <span className={`result-status ${item.status}`}>{t(`status.${item.status}`)}</span>}</div>{item.message && <p>{message(item.message)}</p>}
            <details className="result-details"><DisclosureSummary compact>{t('ui.decision_details')}</DisclosureSummary>{(item.tab.title || item.tab.url).length > 80 && <p className="result-full-title">{item.tab.title || item.tab.url}</p>}<p className="result-preview">{item.preview || t('ui.no_page_excerpt_available')}</p><CandidateScores item={item} locale={locale} /><small>{item.cached ? t('ui.cached_decision') : ''}{item.extraction === 'tavily' ? 'Tavily Extract' : item.extraction === 'deepseek' ? 'DeepSeek Fetch' : item.extraction === 'readability' ? t('ui.local_page_content') : t('ui.title_and_description')}{item.truncated ? t('ui.content_trimmed') : ''}</small></details>
            {liveTask && <div className="buttons result-actions">{['failed', 'unmatched', 'uncertain', 'skipped'].includes(item.status) && <button disabled={locked} onClick={() => void action(() => dispatch({ type: 'retry-items', taskId: task.id, tabIds: [item.tab.id], bypassCache: true }))}>{item.status === 'failed' ? t('ui.retry') : t('ui.re_evaluate')}</button>}{item.tab.windowId === windowId && state.groups.length > 0 && <button disabled={locked} onClick={() => { const current = state.tabs.find(tab => tab.id === item.tab.id); if (current && current.url === item.tab.url) beginMove(current); else setError(msg('messages.the_tab_was_closed_or_navigated_to_another_page')); }}>{t('ui.move_manually')}</button>}</div>}
          </li>)}</ul>
        </details>}
        {liveTask && !configurationFailure && task.items.some(item => item.status === 'failed') && <button className="retry-failed" disabled={locked} onClick={() => void action(() => dispatch({ type: 'retry-items', taskId: task.id, tabIds: task.items.filter(item => item.status === 'failed').map(item => item.tab.id), bypassCache: true }))}><Icon name="refresh" size={14} />{t('ui.retry_failed_pages')}</button>}
      </>}
    </section>

    {task && <div className="activity-maintenance"><p className="muted">{t('ui.clearing_details_does_not_change_tab_groups_or_remove')}</p><button disabled={locked} onClick={async () => {
      if (await confirm({ title: msg('messages.clear_recent_task_details'), message: msg('messages.the_last_result_will_no_longer_be_shown_groups'), confirmLabel: msg('messages.clear_details') })) void action(() => dispatch({ type: 'clear-task' }), msg('ui.task_details_cleared_undo_record_preserved'));
    }}>{t('ui.clear_task_details')}</button></div>}
    {moving && <Modal title={t('ui.choose_a_group')} busy={busy} onClose={() => { if (!busy) setMoving(undefined); }} footer={<><button disabled={busy} onClick={() => setMoving(undefined)}>{t('ui.cancel')}</button><button className="primary" disabled={locked || !moveTarget} onClick={() => void action(() => dispatch({ type: 'move-manual', tab: moving, groupId: Number(moveTarget) }), undefined, true).then(ok => { if (ok) { setMoving(undefined); setNotice(msg('ui.page_moved')); } })}>{busy ? t('ui.moving') : t('ui.move_page')}</button></>}>
      <p className="modal-page-title">{moving.title || moving.url}</p><p className="muted">{t('ui.move_directly_to_the_selected_group_without_a_model')}</p>{modalError && <div className="alert error" role="alert">{message(modalError)}</div>}<label className="field">{t('ui.target_group')}<select aria-label={t('ui.target_group')} disabled={busy} value={moveTarget} onChange={event => setMoveTarget(event.target.value)}><option value="">{t('ui.choose_a_group_2')}</option>{state.groups.filter(group => group.nativeId !== moving.groupId).map(group => <option key={group.nativeId} value={group.nativeId}>{group.name || t('ui.untitled_group')} · {t('counts.pages', { count: group.members.length })}{state.groups.filter(other => other.name === group.name).length > 1 ? ` · #${group.nativeId}` : ''}</option>)}</select></label>
      {!state.groups.some(group => group.nativeId !== moving.groupId) && <p className="sidebar-hint">{t('ui.there_are_no_other_groups_in_this_window')}</p>}
    </Modal>}

    {confirmation}
  </div>;
}
