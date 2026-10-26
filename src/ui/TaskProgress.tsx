import { stageLabels, type OrganizeTask } from '../shared/organizer';
import { Icon } from './components';
import { useUi } from './preferences';
import { localizeMessage } from './messages';
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
  const { t, locale } = useUi();
  const data = taskProgress(task);
  const remaining = task.items.filter(item => ['unmatched', 'uncertain'].includes(item.status)).length;
  const phase = localizeMessage(stageLabels[task.stage], locale);
  const hint = task.stage === 'prepare'
    ? t('正在检查已有分组，并补充需要的分组说明。', 'Checking existing groups and preparing missing descriptions.')
    : task.stage === 'plan'
      ? t(`正在分析 ${remaining} 个剩余网页，等待模型返回分组方案。`, `Analyzing ${remaining} remaining pages; waiting for the model’s plan.`)
      : data.applying
        ? t('正在应用分组，并核对页面的最新状态。', 'Applying groups and checking the latest tab state.')
        : t('逐页读取并判断；较慢的模型请求可能需要等待。', 'Reading and evaluating pages; model requests may take a moment.');
  return <section className="organizer-progress" aria-label={t('整理进度', 'Organizing progress')}>
    <div className="organizer-progress-heading">
      <div className="organizer-progress-title" role="status" aria-live="polite"><strong>{phase}</strong></div>
      <button type="button" className="organizer-progress-cancel" disabled={disabled} onClick={onCancel}>{t('取消任务', 'Cancel task')}</button>
    </div>
    <div className="organizer-progress-count" aria-live="polite"><span>{t('本阶段进度', 'Stage progress')}</span><strong>{data.total === undefined ? t('处理中', 'Working') : `${data.completed} / ${data.total}`}</strong></div>
    <progress aria-label={`${phase} · ${t('本阶段进度', 'Stage progress')}`} value={data.total === undefined ? undefined : data.completed} max={data.total || 1} />
    <p className="organizer-progress-hint">{hint}</p>
    {data.current && <div className="organizer-progress-current"><Icon name="file" size={16} /><div><small>{data.applying ? t('正在归组', 'Grouping') : t('正在判断', 'Evaluating')}</small><p title={data.current.tab.title || data.current.tab.url}>{data.current.tab.title || data.current.tab.url}</p></div></div>}
    <div className="organizer-progress-stats">
      <span><strong>{task.items.length}</strong>{t('本次网页', 'Total pages')}</span>
      <span className="grouped"><strong>{data.grouped}</strong>{t('已归组', 'Grouped')}</span>
      <span className={data.failed ? 'failed' : ''}><strong>{data.failed}</strong>{t('失败', 'Failed')}</span>
    </div>
    <div className="organizer-progress-pages" aria-hidden="true">{task.items.slice(0, 60).map(item => <span key={item.tab.id} className={`page-${item.status}${item.tab.id === data.current?.tab.id ? ' current' : ''}`} title={item.tab.title || item.tab.url} />)}{task.items.length > 60 && <small>+{task.items.length - 60}</small>}</div>
    <div className="organizer-progress-legend"><span><i className="waiting" />{t('等待', 'Waiting')}</span><span><i className="active" />{t('处理中', 'Working')}</span><span><i className="evaluated" />{t('已处理', 'Processed')}</span><span><i className="grouped" />{t('已归组', 'Grouped')}</span><span><i className="failed" />{t('失败', 'Failed')}</span></div>
  </section>;
}

