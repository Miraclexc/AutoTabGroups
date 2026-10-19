import type { Category, TaskItem } from '../shared/schemas';

export function CandidateScores({ item, categories = [] }: { item: TaskItem; categories?: Category[] }) {
  if (!item.candidates?.length) return <p className="muted candidate-empty">{item.status === 'pending' ? '等待分类，暂无候选分数' : '暂无候选分数，可重新更新分组'}</p>;
  const source = item.scoreSource === 'llm_estimate' ? '模型自评分' : '接口概率';
  const candidates = [...item.candidates].sort((a, b) => b.score - a.score).slice(0, 3);
  return <section className="candidate-scores" aria-label="候选分组分数" title={`前三候选 · ${source}`}>
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
