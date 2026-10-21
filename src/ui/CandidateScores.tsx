import type { Category, TaskItem } from '../shared/schemas';

export function CandidateScores({ item, categories = [], locale = 'zh-CN' }: { item: TaskItem; categories?: Category[]; locale?: 'zh-CN' | 'en' }) {
  const t = (zh: string, en: string) => locale === 'en' ? en : zh;
  if (!item.candidates?.length) return <p className="muted candidate-empty">{item.status === 'pending' ? t('等待分类，暂无候选分数', 'Waiting for candidate scores') : t('暂无候选分数，可重新更新分组', 'No candidate scores. Update groups to re-evaluate.')}</p>;
  const source = item.scoreSource === 'llm_estimate' ? t('模型自评分', 'Model self-assessment') : t('接口概率', 'Provider probability');
  const candidates = [...item.candidates].sort((a, b) => b.score - a.score).slice(0, 3);
  return <section className="candidate-scores" aria-label={t('候选分组分数', 'Candidate group scores')}>
    <p className="candidate-source">{t('前三候选', 'Top candidates')} · {source}</p>
    <ol>{candidates.map(candidate => {
      const color = categories.find(category => category.id === candidate.categoryId)?.color ?? candidate.color ?? 'grey';
      const score = `${Number((candidate.score * 100).toFixed(2))}%`;
      return <li key={candidate.categoryId} title={`${candidate.name} · ${source} ${score}`}>
        <span className="candidate-color" style={{ backgroundColor: color }} aria-hidden="true" />
        <span className="candidate-name">{candidate.name}</span>
        <span className="candidate-value">{score}</span>
      </li>;
    })}</ol>
  </section>;
}
