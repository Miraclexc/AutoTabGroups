import type { TaskRecord } from '../shared/schemas';

export const statusLabels = { pending: '等待', read: '已读取', applied: '已归组', unmatched: '未匹配', uncertain: '未匹配', skipped: '已跳过', failed: '失败' };

export function ResultMetrics({ task }: { task: TaskRecord }) {
  const statuses = task.kind === 'generate' ? ['read', 'failed', 'pending'] as const : ['applied', 'unmatched', 'failed'] as const;
  return <div className="metrics">{statuses.map(status => <div key={status}>
    <strong>{task.items.filter(item => item.status === status || (status === 'unmatched' && item.status === 'uncertain')).length}</strong>
    <span>{statusLabels[status]}</span>
  </div>)}</div>;
}
