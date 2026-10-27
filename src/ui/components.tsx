import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useUi } from './preferences';
import { localizeMessage } from './messages';
import type { UserMessage } from '../i18n';

const paths: Record<string, ReactNode> = {
  settings: <><path d="M4 6h12M4 14h12"/><circle cx="7" cy="6" r="2"/><circle cx="13" cy="14" r="2"/></>,
  model: <><rect x="5" y="5" width="10" height="10" rx="2"/><path d="M8 2v3m4-3v3M8 15v3m4-3v3M2 8h3m-3 4h3m10-4h3m-3 4h3M8 8h4v4H8z"/></>,
  reading: <><path d="M10 5c-2-2-5-2-8-1v12c3-1 6-1 8 1 2-2 5-2 8-1V4c-3-1-6-1-8 1Z"/><path d="M10 5v12"/></>,
  keyboard: <><rect x="2" y="4" width="16" height="12" rx="2"/><path d="M5 7h1m3 0h1m3 0h2M5 10h1m3 0h1m3 0h2M6 13h8"/></>,
  appearance: <><circle cx="10" cy="10" r="4"/><path d="M10 1v2m0 14v2M1 10h2m14 0h2M4 4l1 1m10 10 1 1M4 16l1-1M15 5l1-1"/></>,
  database: <><ellipse cx="10" cy="4" rx="7" ry="2.5"/><path d="M3 4v11c0 4 14 4 14 0V4M3 9c0 4 14 4 14 0"/></>,
  chevron: <path d="m7 4 6 6-6 6"/>, close: <path d="m5 5 10 10M5 15 15 5"/>,
  check: <path d="m4 10 4 4 8-8"/>, external: <><path d="M11 3h6v6m0-6-9 9M8 3H4a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-4"/></>,
  refresh: <><path d="M16 7a6 6 0 1 0 0 6M16 3v4h-4"/></>,
  eye: <><path d="M1 10s3-6 9-6 9 6 9 6-3 6-9 6-9-6-9-6Z"/><circle cx="10" cy="10" r="2.5"/></>,
  'eye-off': <><path d="m3 3 14 14M8 4a11 11 0 0 1 11 6s-1 2-3 4M4 6l-3 4s3 6 9 6l3-1"/></>,
  sun: <><circle cx="10" cy="10" r="4"/><path d="M10 1v2m0 14v2M1 10h2m14 0h2M4 4l1 1m10 10 1 1M4 16l1-1M15 5l1-1"/></>,
  moon: <path d="M17 12A7.5 7.5 0 0 1 8 3 7.5 7.5 0 1 0 17 12Z"/>,
  system: <><rect x="2" y="3" width="16" height="11" rx="1.5"/><path d="M10 14v3m-4 0h8"/></>,
  globe: <><circle cx="10" cy="10" r="8"/><ellipse cx="10" cy="10" rx="3.5" ry="8"/><path d="M2 10h16"/></>,
  info: <><circle cx="10" cy="10" r="8"/><path d="M10 9v5m0-8v.5"/></>,
  plus: <path d="M10 4v12M4 10h12"/>, file: <><path d="M11 2H4v16h12V7l-5-5Z"/><path d="M11 2v5h5M7 11h6m-6 3h6"/></>,
  undo: <><path d="m7 4-4 4 4 4M3 8h9a5 5 0 0 1 0 10"/></>, arrow: <path d="M3 10h14m-5-5 5 5-5 5"/>,
};
export function Icon({ name, size = 18 }: { name: string; size?: number }) {
  return <svg className="icon" width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.45" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name] || paths.info}</svg>;
}
export function DisclosureSummary({ children, compact = false }: { children: ReactNode; compact?: boolean }) {
  return <summary className={`disclosure-summary${compact ? ' disclosure-compact' : ''}`}><span className="disclosure-label">{children}</span><Icon name="chevron" size={16} /></summary>;
}
export function Brand() {
  return <span className="brand"><svg className="brand-symbol" width="23" height="23" viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5" fill="currentColor"/></svg><span>AutoTabGroups</span></span>;
}
let openDialogs = 0;
let originalBodyOverflow = '';
export function Modal({ title, onClose, children, footer, busy = false }: {
  title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; busy?: boolean;
}) {
  const { t } = useUi();
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const dialog = ref.current!;
    if (openDialogs === 0) originalBodyOverflow = document.body.style.overflow;
    openDialogs++;
    document.body.style.overflow = 'hidden';
    dialog.showModal();
    const input = dialog.querySelector<HTMLElement>('input:not([type="checkbox"]), textarea, select');
    input?.focus();
    return () => {
      dialog.close(); openDialogs--;
      if (openDialogs === 0) document.body.style.overflow = originalBodyOverflow;
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  return <dialog className="modal" ref={ref} aria-labelledby={titleId} aria-busy={busy} onCancel={event => { event.preventDefault(); if (!busy) onClose(); }} onKeyDown={event => {
    if (event.key !== 'Tab') return;
    const controls = [...ref.current!.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], summary, [tabindex]:not([tabindex="-1"])')]
      .filter(element => element.getClientRects().length > 0 && !element.closest('[inert]'));
    const first = controls[0], last = controls.at(-1);
    if (!first) { event.preventDefault(); ref.current?.focus(); return; }
    if (event.shiftKey && (document.activeElement === first || document.activeElement === ref.current)) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }}>
    <div className="modal-heading"><h2 id={titleId}>{title}</h2><button className="icon-button" type="button" aria-label={t('ui.close')} disabled={busy} onClick={onClose}><Icon name="close" /></button></div>
    <div className="modal-content">{children}</div>
    {footer && <div className="modal-footer">{footer}</div>}
  </dialog>;
}
type ConfirmOptions = { title: UserMessage; message: UserMessage; confirmLabel?: UserMessage; danger?: boolean };
export function useConfirm() {
  const { t, locale } = useUi();
  const [question, setQuestion] = useState<ConfirmOptions>();
  const resolver = useRef<((result: boolean) => void) | undefined>(undefined);
  useEffect(() => () => { resolver.current?.(false); }, []);
  const settle = (result: boolean) => { resolver.current?.(result); resolver.current = undefined; setQuestion(undefined); };
  const confirm = useCallback((options: ConfirmOptions) => new Promise<boolean>(resolve => {
    resolver.current?.(false); resolver.current = resolve; setQuestion(options);
  }), []);
  const confirmation = question ? <Modal title={localizeMessage(question.title, locale)} onClose={() => settle(false)} footer={<><button type="button" onClick={() => settle(false)}>{t('ui.cancel')}</button><button type="button" className={question.danger ? 'danger-button' : 'primary'} onClick={() => settle(true)}>{question.confirmLabel ? localizeMessage(question.confirmLabel, locale) : t('ui.confirm')}</button></>}><p className="confirm-message">{localizeMessage(question.message, locale)}</p></Modal> : null;
  return { confirm, confirmation };
}
