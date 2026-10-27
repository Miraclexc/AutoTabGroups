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
    ? t('undo.context', { count, window: journal.windowId === windowId ? t('ui.this_window') : t('ui.other_window') })
    : t('ui.no_grouping_changes_to_undo');
  const title = locked ? t('ui.available_after_the_current_operation_finishes')
    : count && journal ? `${context} · ${new Date(journal.createdAt).toLocaleString(locale)}`
    : t('ui.no_grouping_changes_to_undo_in_this_browser_session');

  return <div className="undo-grouping">
    <button disabled={locked || !count} title={title} aria-describedby={contextId} onClick={onUndo}><Icon name="undo" size={16} /><span>{t('ui.undo_last_grouping')}</span></button>
    <span className="undo-grouping-context" id={contextId}>{context}</span>
  </div>;
}
