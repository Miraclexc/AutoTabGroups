import { useId, useRef, useState } from 'react';
import type { OrganizerState } from '../shared/organizer';
import { Icon } from './components';
import { useUi } from './preferences';

type Filter = 'eligible' | 'excluded';
type WindowTab = OrganizerState['tabs'][number];

export function WindowTabScope({ tabs, groups }: Pick<OrganizerState, 'tabs' | 'groups'>) {
  const { t } = useUi();
  const [filter, setFilter] = useState<Filter | null>(null);
  const id = useId();
  const eligibleButton = useRef<HTMLButtonElement>(null);
  const excludedButton = useRef<HTMLButtonElement>(null);
  // Use the runner's eligibility flag; this view does not decide what to process.
  const eligible = tabs.filter(tab => tab.eligible);
  const excluded = tabs.filter(tab => !tab.eligible);
  const shown = filter ? [...(filter === 'eligible' ? eligible : excluded)].sort((a, b) => a.index - b.index) : [];
  const reason = (tab: WindowTab) => {
    if (tab.groupId !== -1) {
      const name = groups.find(group => group.nativeId === tab.groupId)?.name;
      return t('已分组', 'Grouped') + (name ? ` · ${name}` : '');
    }
    if (tab.pinned) return t('已固定', 'Pinned');
    if (!tab.url) return t('暂无网址', 'No page address');
    if (/^chrome-extension:/i.test(tab.url)) return t('扩展页面', 'Extension page');
    if (/^(chrome|about|devtools|chrome-search|chrome-untrusted):/i.test(tab.url)) return t('浏览器页面', 'Browser page');
    if (/^file:/i.test(tab.url)) return t('本地文件', 'Local file');
    if (!/^https?:\/\//i.test(tab.url)) return t('不支持此类网址', 'Unsupported address');
    return t('当前不可整理', 'Currently unavailable');
  };
  const host = (url: string) => { try { return new URL(url).hostname; } catch { return ''; } };
  return <div className="window-tab-scope" onKeyDown={event => {
    if (event.key !== 'Escape' || !filter) return;
    event.stopPropagation(); setFilter(null);
    (filter === 'eligible' ? eligibleButton : excludedButton).current?.focus();
  }}>
    <div className="scope-counts">
      {(['eligible', 'excluded'] as const).map(value => {
        const count = value === 'eligible' ? eligible.length : excluded.length;
        const label = value === 'eligible' ? t('可整理', 'Eligible') : t('不参与', 'Excluded');
        return <button type="button" className="scope-count" key={value} ref={value === 'eligible' ? eligibleButton : excludedButton}
          id={`${id}-${value}`} aria-label={value === 'eligible' ? t(`查看可整理页面（${count}）`, `View eligible pages (${count})`) : t(`查看不参与页面（${count}）`, `View excluded pages (${count})`)}
          aria-expanded={filter === value} aria-controls={`${id}-pages`} onClick={() => setFilter(current => current === value ? null : value)}>
          <span className="scope-count-label"><strong>{count}</strong><span>{label}</span></span><Icon name="chevron" size={16} />
        </button>;
      })}
    </div>
    <div className="scope-pages" id={`${id}-pages`} role="region" aria-labelledby={filter ? `${id}-${filter}` : undefined} tabIndex={0} hidden={!filter}>
      {shown.length ? <ul>{shown.map(tab => <li key={tab.id} data-tab-id={tab.id}>
        <span className="scope-page-title" title={tab.title || tab.url}>{tab.title || tab.url || t('未命名页面', 'Untitled page')}</span>
        <span className="scope-page-meta">{filter === 'eligible' ? host(tab.url) : reason(tab)}</span>
      </li>)}</ul> : <p className="scope-empty">{filter === 'eligible' ? t('暂无可整理页面', 'No eligible pages') : t('没有不参与的页面', 'No excluded pages')}</p>}
    </div>
  </div>;
}
