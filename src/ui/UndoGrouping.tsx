import { useId } from 'react';
import type { OrganizerState } from '../shared/organizer';
import { Icon } from './components';
import { useUi } from './preferences';

export function UndoGrouping({ state, windowId, disabled, onUndo }: { state: OrganizerState; windowId: number; disabled: boolean; onUndo: () => void }) {
  const { t, locale } = useUi();
  const contextId = useId();
  const journal = state.journal?.sessionId === state.sessionId ? state.journal : null;
  const count = journal?.records.filter(record => record.applied && !record.undone).length ?? 0;
  const locked = disabled || state.busy || state.task?.status === 'running';
  const context = count && journal
    ? t(`${count} 页 · ${journal.windowId === windowId ? '当前窗口' : '其他窗口'}`, `${count} ${count === 1 ? 'tab' : 'tabs'} · ${journal.windowId === windowId ? 'This window' : 'Other window'}`)
    : t('暂无可撤销的分组变更', 'No grouping changes to undo');
  const title = locked ? t('当前操作结束后可撤销', 'Available after the current operation finishes')
    : count && journal ? `${context} · ${new Date(journal.createdAt).toLocaleString(locale)}`
    : t('当前浏览器会话中暂无可撤销的分组变更', 'No grouping changes to undo in this browser session');

  return <div className="undo-grouping">
    <button disabled={locked || !count} title={title} aria-describedby={contextId} onClick={onUndo}><Icon name="undo" size={16} /><span>{t('撤销最近一次分组', 'Undo last grouping')}</span></button>
    <span className="undo-grouping-context" id={contextId}>{context}</span>
  </div>;
}
