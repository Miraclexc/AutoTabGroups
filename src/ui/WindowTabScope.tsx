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
      return t('ui.grouped') + (name ? ` · ${name}` : '');
    }
    if (tab.pinned) return t('ui.pinned');
    if (!tab.url) return t('ui.no_page_address');
    if (/^chrome-extension:/i.test(tab.url)) return t('ui.extension_page');
    if (/^(chrome|about|devtools|chrome-search|chrome-untrusted):/i.test(tab.url)) return t('ui.browser_page_2');
    if (/^file:/i.test(tab.url)) return t('ui.local_file');
    if (!/^https?:\/\//i.test(tab.url)) return t('ui.unsupported_address');
    return t('ui.currently_unavailable');
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
        const label = value === 'eligible' ? t('ui.eligible') : t('ui.excluded');
        return <button type="button" className="scope-count" key={value} ref={value === 'eligible' ? eligibleButton : excludedButton}
          id={`${id}-${value}`} aria-label={value === 'eligible' ? t('scope.eligible', { count }) : t('scope.excluded', { count })}
          aria-expanded={filter === value} aria-controls={`${id}-pages`} onClick={() => setFilter(current => current === value ? null : value)}>
          <span className="scope-count-label"><strong>{count}</strong><span>{label}</span></span><Icon name="chevron" size={16} />
        </button>;
      })}
    </div>
    <div className="scope-pages" id={`${id}-pages`} role="region" aria-labelledby={filter ? `${id}-${filter}` : undefined} tabIndex={0} hidden={!filter}>
      {shown.length ? <ul>{shown.map(tab => <li key={tab.id} data-tab-id={tab.id}>
        <span className="scope-page-title" title={tab.title || tab.url}>{tab.title || tab.url || t('ui.untitled_page')}</span>
        <span className="scope-page-meta">{filter === 'eligible' ? host(tab.url) : reason(tab)}</span>
      </li>)}</ul> : <p className="scope-empty">{filter === 'eligible' ? t('ui.no_eligible_pages') : t('ui.no_excluded_pages')}</p>}
    </div>
  </div>;
}
