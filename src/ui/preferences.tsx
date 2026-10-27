import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { dispatch } from '../shared/organizer';
import { readUiPreferences, UI_PREFERENCES_KEY, uiPreferencesSchema, type UiPreferences } from '../shared/ui-preferences';
import { I18nextProvider, useTranslation } from 'react-i18next';
import { i18n, translator, type Translate } from '../i18n';

type UiContextValue = UiPreferences & {
  resolvedTheme: 'light' | 'dark';
  t: Translate;
  savePreferences: (patch: Partial<UiPreferences>) => Promise<boolean>;
  preferenceBusy: boolean; preferenceError: string; preferencesReady: boolean;
};
const Context = createContext<UiContextValue | null>(null);
export function UiProvider({ children }: { children: ReactNode }) {
  return <I18nextProvider i18n={i18n}><PreferencesProvider>{children}</PreferencesProvider></I18nextProvider>;
}
function PreferencesProvider({ children }: { children: ReactNode }) {
  const { t: translate } = useTranslation(undefined, { useSuspense: false });
  const [preferences, setPreferences] = useState<UiPreferences>({ theme: 'system', locale: 'zh-CN' });
  const [systemDark, setSystemDark] = useState(() => matchMedia('(prefers-color-scheme: dark)').matches);
  const [preferencesReady, setReady] = useState(false);
  const [preferenceBusy, setBusy] = useState(false);
  const [preferenceError, setError] = useState('');
  const saving = useRef(false);
  useEffect(() => {
    let alive = true;
    let version = 0;
    const initial = version;
    const changed = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area !== 'local' || !(UI_PREFERENCES_KEY in changes)) return;
      version++;
      const parsed = uiPreferencesSchema.safeParse(changes[UI_PREFERENCES_KEY].newValue ?? {});
      if (parsed.success) setPreferences(parsed.data);
    };
    chrome.storage.onChanged.addListener(changed);
    void readUiPreferences().then(value => { if (alive && initial === version) setPreferences(value); })
      .catch(() => { if (alive) setError('load'); })
      .finally(() => { if (alive) setReady(true); });
    const media = matchMedia('(prefers-color-scheme: dark)');
    const changedTheme = () => setSystemDark(media.matches);
    media.addEventListener('change', changedTheme);
    return () => { alive = false; chrome.storage.onChanged.removeListener(changed); media.removeEventListener('change', changedTheme); };
  }, []);
  const resolvedTheme = preferences.theme === 'system' ? (systemDark ? 'dark' : 'light') : preferences.theme;
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme;
    document.documentElement.lang = preferences.locale;
    document.documentElement.style.colorScheme = resolvedTheme;
    document.title = translator(preferences.locale)('app.title');
  }, [resolvedTheme, preferences.locale]);
  const savePreferences = useCallback(async (patch: Partial<UiPreferences>) => {
    if (saving.current) return false;
    saving.current = true; setBusy(true); setError('');
    try {
      const next = await dispatch<UiPreferences>({ type: 'save-ui-preferences', patch });
      setPreferences(next); return true;
    } catch { setError('save'); return false; }
    finally { saving.current = false; setBusy(false); }
  }, []);
  const t: Translate = useCallback((key, params) => translate(key, { ...params, lng: preferences.locale }), [preferences.locale, translate]);
  return <Context.Provider value={{ ...preferences, resolvedTheme, t, savePreferences, preferenceBusy, preferencesReady,
    preferenceError: preferenceError === 'load' ? t('ui.could_not_load_appearance_preferences_refresh_to_retry') : preferenceError ? t('ui.could_not_save_preferences_previous_settings_were_kept_please') : '' }}>{children}</Context.Provider>;
}
export function useUi() {
  const context = useContext(Context);
  if (!context) throw new Error('useUi requires UiProvider');
  return context;
}
