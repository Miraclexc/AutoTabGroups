import { useEffect, useState } from 'react';
import { actionLabels, dispatch, type OrganizerState, type OrganizeAction } from '../shared/organizer';
import { TaskProgress } from './TaskProgress';
import type { TabSnapshot } from '../shared/schemas';
import { errorMessage } from '../shared/errors';
import { CandidateScores } from './CandidateScores';
import { DisclosureSummary, Icon, Modal, useConfirm } from './components';
import { useUi } from './preferences';
import { localizeMessage } from './messages';
const statusNames = {
  pending: ['等待', 'Waiting'], read: ['已判断', 'Evaluated'], applied: ['已归组', 'Grouped'],
  unmatched: ['保持未分组', 'Ungrouped'], uncertain: ['保持未分组', 'Ungrouped'], skipped: ['已跳过', 'Skipped'], failed: ['失败', 'Failed'],
} as const;
const taskNames = { running: ['正在处理', 'In progress'], completed: ['已完成', 'Completed'], partial: ['部分完成', 'Partially completed'], cancelled: ['已取消', 'Cancelled'], interrupted: ['已中断', 'Interrupted'], failed: ['失败', 'Failed'] } as const;
const actionEnglish: Record<OrganizeAction, string> = { 'organize-current': 'Organize current tab', 'organize-window': 'Update groups', 'organize-window-with-new': 'Update & allow new groups' };

function countLabel(count: number, noun: string) { return count + ' ' + noun + (count === 1 ? '' : 's'); }
export function RecentActivity({ state, windowId, refresh, onOpenSettings }: { state: OrganizerState; windowId: number; refresh: () => Promise<void>; onOpenSettings: () => void }) {
  const { t, locale } = useUi();
  const { confirm, confirmation } = useConfirm();
  const message = (value?: string) => value ? localizeMessage(value, locale) : '';
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [moving, setMoving] = useState<TabSnapshot>();
  const [moveTarget, setMoveTarget] = useState('');
  const [modalError, setModalError] = useState('');
  useEffect(() => { setNotice(''); }, [state.task?.id]);
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(''), 3000); return () => clearTimeout(timer); }, [notice]);
  const task = state.task;
  const liveTask = task?.sessionId === state.sessionId;
  const locked = busy || state.busy || task?.status === 'running';
  const label = (name: OrganizeAction) => t(actionLabels[name], actionEnglish[name]);
  const openSettings = onOpenSettings;
  const action = async (operation: () => Promise<unknown>, success?: string, modal = false) => {
    setBusy(true); (modal ? setModalError : setError)(''); setNotice('');
    try { await operation(); await refresh(); if (success) setNotice(success); return true; }
    catch (e) { (modal ? setModalError : setError)(errorMessage(e)); await refresh().catch(() => {}); return false; }
    finally { setBusy(false); }
  };
  const locate = (tab: TabSnapshot) => action(() => dispatch({ type: 'locate-tab', tab }));
  const beginMove = (tab: TabSnapshot) => { setModalError(''); setMoving(tab); setMoveTarget(''); };
  const configurationFailure = !!task && [task.message, ...task.items.filter(item => item.status === 'failed').map(item => item.message)].some(value => /HTTP (400|401|403|404)|模型名称|思考.*不支持|请先配置|缺少.*配置|API.?key|authenticat|unauthorized/i.test(value || ''));
  const counts = { applied: 0, unmatched: 0, skipped: 0, failed: 0 };
  task?.items.forEach(item => { if (item.status === 'uncertain') counts.unmatched++; else if (item.status in counts) counts[item.status as keyof typeof counts]++; });
  const summary = (Object.keys(counts) as (keyof typeof counts)[]).filter(status => counts[status]).map(status => t(`${counts[status]} 页${statusNames[status][0]}`, `${counts[status]} ${statusNames[status][1].toLowerCase()}`)).join(t(' · ', ' · '));
  const commonReason = task?.status === 'completed' && !counts.applied && task.items.length && task.items.every(item => item.message === task.items[0].message) ? task.items[0].message : undefined;
  const currentTaskTime = task ? new Date(task.createdAt).toLocaleString(locale, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';

  return <div className="recent-activity config-pane">
    <p className="activity-explanation">{t('这里保留最近一次整理的结果，可查看每页判断或重试。不会累积历史记录，也不会自动重新整理。', 'Review the latest run, inspect decisions or retry pages. No history is accumulated and no automatic reorganization is performed.')}</p>
    {error && <div className="alert error" role="alert">{message(error)}</div>}
    <div className="sidebar-toast" role="status" aria-live="polite" aria-atomic="true">{notice && <div className="sidebar-toast-message"><Icon name="check" size={17} /><span>{message(notice)}</span></div>}</div>
    <section className="recent-section" aria-labelledby="recent-heading">
      <div className="sidebar-section-title"><h2 id="recent-heading">{t('任务结果', 'Task result')}</h2></div>
      {!task ? <p className="sidebar-hint">{t('整理后的结果会显示在这里。', 'Your organizing results will appear here.')}</p> : <>
        <div className="task-state"><span className={`task-indicator ${task.status === 'completed' && !counts.applied ? 'unchanged' : task.status}`} aria-hidden="true" /><strong>{task.status === 'completed' && !counts.applied ? t('本次未移动标签', 'No tabs moved') : t(taskNames[task.status][0], taskNames[task.status][1])}</strong><span className="muted">{task.windowId === windowId ? t('当前窗口', 'This window') : t('其他窗口', 'Other window')}</span></div>
        <p className="task-caption">{label(task.action)} · <time dateTime={new Date(task.createdAt).toISOString()}>{currentTaskTime}</time>{!liveTask && t(' · 上次浏览器会话', ' · Previous browser session')}</p>
        {task.status === 'running' && <TaskProgress task={task} disabled={busy} onCancel={() => void action(() => dispatch({ type: 'cancel' }))} />}
        {task.status !== 'running' && summary && <p className="task-overview">{summary}</p>}
        {task.message && !/^处理结束：/.test(task.message) && <p className="task-message" role="status">{message(task.message)}</p>}
        {commonReason && <p className="task-message">{message(commonReason)}</p>}
        {state.busy && task.status !== 'running' && <p className="task-settling" role="status">{t('等待后台完成当前操作…', 'Waiting for the background operation to finish…')}</p>}
        {configurationFailure && <div className="task-config-recovery"><p>{t('请检查模型服务配置后再试。', 'Check your model service settings before retrying.')}</p><button onClick={() => void openSettings()}><Icon name="settings" size={14} />{t('打开配置', 'Open settings')}</button></div>}
        {!!task.items.length && <details className="task-details" key={task.id}><DisclosureSummary>{t('查看页面结果', 'View page results')}<span>{task.items.length}</span></DisclosureSummary>
          <div className="result-summary">{(['applied', 'unmatched', 'skipped', 'failed'] as const).map(status => <span key={status}><b>{counts[status]}</b>{t(statusNames[status][0], statusNames[status][1])}</span>)}</div>
          <p className="sidebar-hint">{t('以下为该次整理结果，之后的手动移动不会改写此记录。', 'Results from this run. Later manual moves do not rewrite this record.')}</p>
          {task.windowId !== windowId && <p className="task-window-detail">{t(`来源窗口 ID：${task.windowId}`, `Source window ID: ${task.windowId}`)}</p>}
          <ul className="sidebar-results">{task.items.map(item => <li key={item.tab.id}><div className="result-heading"><button className="text-button result-title" title={item.tab.title || item.tab.url} onClick={() => void locate(item.tab)}>{item.tab.title || item.tab.url}</button>{!(item.status === 'applied' && item.message?.startsWith('已加入「')) && <span className={`result-status ${item.status}`}>{t(statusNames[item.status][0], statusNames[item.status][1])}</span>}</div>{item.message && <p>{message(item.message).replace(/，保持未分组$/, '').replace(/\. Left ungrouped\.$/, '.')}</p>}
            <details className="result-details"><DisclosureSummary compact>{t('判断详情', 'Decision details')}</DisclosureSummary>{(item.tab.title || item.tab.url).length > 80 && <p className="result-full-title">{item.tab.title || item.tab.url}</p>}<p className="result-preview">{item.preview || t('暂无网页摘录', 'No page excerpt available')}</p><CandidateScores item={item} locale={locale} /><small>{item.cached ? t('复用分类缓存 · ', 'Cached decision · ') : ''}{item.extraction === 'tavily' ? 'Tavily Extract' : item.extraction === 'deepseek' ? 'DeepSeek Fetch' : item.extraction === 'readability' ? t('本地正文', 'Local page content') : t('标题与描述', 'Title and description')}{item.truncated ? t(' · 内容已裁剪', ' · Content trimmed') : ''}</small></details>
            {liveTask && <div className="buttons result-actions">{['failed', 'unmatched', 'uncertain', 'skipped'].includes(item.status) && <button disabled={locked} onClick={() => void action(() => dispatch({ type: 'retry-items', taskId: task.id, tabIds: [item.tab.id], bypassCache: true }))}>{item.status === 'failed' ? t('重试', 'Retry') : t('重新判断', 'Re-evaluate')}</button>}{item.tab.windowId === windowId && state.groups.length > 0 && <button disabled={locked} onClick={() => { const current = state.tabs.find(tab => tab.id === item.tab.id); if (current && current.url === item.tab.url) beginMove(current); else setError('标签已关闭或导航到其他页面'); }}>{t('手动改分', 'Move manually')}</button>}</div>}
          </li>)}</ul>
        </details>}
        {liveTask && !configurationFailure && task.items.some(item => item.status === 'failed') && <button className="retry-failed" disabled={locked} onClick={() => void action(() => dispatch({ type: 'retry-items', taskId: task.id, tabIds: task.items.filter(item => item.status === 'failed').map(item => item.tab.id), bypassCache: true }))}><Icon name="refresh" size={14} />{t('重试失败项', 'Retry failed pages')}</button>}
      </>}
    </section>

    {task && <div className="activity-maintenance"><p className="muted">{t('清除详情不会改变标签分组，也不会删除可撤销变更。', 'Clearing details does not change tab groups or remove undoable changes.')}</p><button disabled={locked} onClick={async () => {
      if (await confirm({ title: t('清除最近任务详情？', 'Clear recent task details?'), message: t('最近结果将不再显示。分组和撤销记录会保留。', 'The last result will no longer be shown. Groups and undo records are preserved.'), confirmLabel: t('清除详情', 'Clear details') })) void action(() => dispatch({ type: 'clear-task' }), t('最近任务详情已清除；撤销记录保留', 'Task details cleared; undo record preserved'));
    }}>{t('清除最近任务详情', 'Clear task details')}</button></div>}
    {moving && <Modal title={t('手动指定分组', 'Choose a group')} busy={busy} onClose={() => { if (!busy) setMoving(undefined); }} footer={<><button disabled={busy} onClick={() => setMoving(undefined)}>{t('取消', 'Cancel')}</button><button className="primary" disabled={locked || !moveTarget} onClick={() => void action(() => dispatch({ type: 'move-manual', tab: moving, groupId: Number(moveTarget) }), undefined, true).then(ok => { if (ok) { setMoving(undefined); setNotice(t('已手动改分', 'Page moved')); } })}>{busy ? t('正在移动…', 'Moving…') : t('确认改分', 'Move page')}</button></>}>
      <p className="modal-page-title">{moving.title || moving.url}</p><p className="muted">{t('直接移动到选定分组，不调用模型。', 'Move directly to the selected group without a model request.')}</p>{modalError && <div className="alert error" role="alert">{message(modalError)}</div>}<label className="field">{t('目标分组', 'Target group')}<select aria-label={t('目标分组', 'Target group')} disabled={busy} value={moveTarget} onChange={event => setMoveTarget(event.target.value)}><option value="">{t('请选择', 'Choose a group')}</option>{state.groups.filter(group => group.nativeId !== moving.groupId).map(group => <option key={group.nativeId} value={group.nativeId}>{group.name || t('未命名分组', 'Untitled group')} · {t(`${group.members.length} 页`, countLabel(group.members.length, 'page'))}{state.groups.filter(other => other.name === group.name).length > 1 ? ` · #${group.nativeId}` : ''}</option>)}</select></label>
      {!state.groups.some(group => group.nativeId !== moving.groupId) && <p className="sidebar-hint">{t('当前窗口没有其他可选分组。', 'There are no other groups in this window.')}</p>}
    </Modal>}

    {confirmation}
  </div>;
}
