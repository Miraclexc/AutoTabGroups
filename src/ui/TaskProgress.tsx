import type { OrganizeTask } from '../shared/organizer';
import { Icon } from './components';
import { useUi } from './preferences';
import './task-progress.css';

// Counts describe the current pass, not elapsed time or an estimated total percentage.
export function taskProgress(task: OrganizeTask) {
  const grouped = task.items.filter(item => item.status === 'applied').length;
  const failed = task.items.filter(item => item.status === 'failed').length;
  let total: number | undefined;
  let completed = 0;
  let current: typeof task.items[number] | undefined;
  if (task.stage === 'existing') {
    total = task.items.length;
    completed = task.items.filter(item => item.status !== 'pending').length;
    current = task.items.find(item => item.status === 'pending');
  } else if (task.stage === 'final') {
    const items = task.items.filter(item => item.pass === 'final' || ['unmatched', 'uncertain'].includes(item.status));
    total = items.length;
    completed = items.filter(item => item.pass === 'final').length;
    current = items.find(item => item.pass !== 'final');
  }
  const applying = task.stage === 'apply-existing' || task.stage === 'apply-final';
  if (applying) current = task.items.find(item => item.status === 'read');
  return { grouped, failed, total, completed, current, applying };
}

export function TaskProgress({ task, disabled, onCancel }: { task: OrganizeTask; disabled?: boolean; onCancel: () => void }) {
  const { t } = useUi();
  const data = taskProgress(task);
  const remaining = task.items.filter(item => ['unmatched', 'uncertain'].includes(item.status)).length;
  const phase = t(`stage.${task.stage}`);
  const hint = task.stage === 'prepare'
    ? t('ui.checking_existing_groups_and_preparing_missing_descriptions')
    : task.stage === 'plan'
      ? t('progress.remaining', { count: remaining })
      : data.applying
        ? t('ui.applying_groups_and_checking_the_latest_tab_state')
        : t('ui.reading_and_evaluating_pages_model_requests_may_take_a');
  return <section className="organizer-progress" aria-label={t('ui.organizing_progress')}>
    <div className="organizer-progress-heading">
      <div className="organizer-progress-title" role="status" aria-live="polite"><strong>{phase}</strong></div>
      <button type="button" className="organizer-progress-cancel" disabled={disabled} onClick={onCancel}>{t('ui.cancel_task')}</button>
    </div>
    <div className="organizer-progress-count" aria-live="polite"><span>{t('ui.stage_progress')}</span><strong>{data.total === undefined ? t('ui.working_3') : `${data.completed} / ${data.total}`}</strong></div>
    <progress aria-label={`${phase} · ${t('ui.stage_progress')}`} value={data.total === undefined ? undefined : data.completed} max={data.total || 1} />
    <p className="organizer-progress-hint">{hint}</p>
    {data.current && <div className="organizer-progress-current"><Icon name="file" size={16} /><div><small>{data.applying ? t('ui.grouping') : t('ui.evaluating')}</small><p title={data.current.tab.title || data.current.tab.url}>{data.current.tab.title || data.current.tab.url}</p></div></div>}
    <div className="organizer-progress-stats">
      <span><strong>{task.items.length}</strong>{t('ui.total_pages')}</span>
      <span className="grouped"><strong>{data.grouped}</strong>{t('ui.grouped_2')}</span>
      <span className={data.failed ? 'failed' : ''}><strong>{data.failed}</strong>{t('ui.failed')}</span>
    </div>
    <div className="organizer-progress-pages" aria-hidden="true">{task.items.slice(0, 60).map(item => <span key={item.tab.id} className={`page-${item.status}${item.tab.id === data.current?.tab.id ? ' current' : ''}`} title={item.tab.title || item.tab.url} />)}{task.items.length > 60 && <small>+{task.items.length - 60}</small>}</div>
    <div className="organizer-progress-legend"><span><i className="waiting" />{t('ui.waiting')}</span><span><i className="active" />{t('ui.working_3')}</span><span><i className="evaluated" />{t('ui.processed')}</span><span><i className="grouped" />{t('ui.grouped_2')}</span><span><i className="failed" />{t('ui.failed')}</span></div>
  </section>;
}

