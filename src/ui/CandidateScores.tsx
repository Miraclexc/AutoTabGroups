import type { Category, TaskItem } from '../shared/schemas';
import { translator } from '../i18n';

export function CandidateScores({ item, categories = [], locale = 'zh-CN' }: { item: TaskItem; categories?: Category[]; locale?: 'zh-CN' | 'en' }) {
  const t = translator(locale);
  if (!item.candidates?.length) return <p className="muted candidate-empty">{item.status === 'pending' ? t('ui.waiting_for_candidate_scores') : t('ui.no_candidate_scores_update_groups_to_re_evaluate')}</p>;
  const source = item.scoreSource === 'llm_estimate' ? t('ui.model_self_assessment') : t('ui.provider_probability');
  const candidates = [...item.candidates].sort((a, b) => b.score - a.score).slice(0, 3);
  return <section className="candidate-scores" aria-label={t('ui.candidate_group_scores')}>
    <p className="candidate-source">{t('ui.top_candidates')} · {source}</p>
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
