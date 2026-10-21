import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { dispatch } from '../shared/organizer';
import { readUiPreferences, UI_PREFERENCES_KEY, uiPreferencesSchema, type UiPreferences } from '../shared/ui-preferences';

type UiContextValue = UiPreferences & {
  resolvedTheme: 'light' | 'dark';
  t: (zh: string, en: string) => string;
  savePreferences: (patch: Partial<UiPreferences>) => Promise<boolean>;
  preferenceBusy: boolean; preferenceError: string; preferencesReady: boolean;
};
const Context = createContext<UiContextValue | null>(null);
export function UiProvider({ children }: { children: ReactNode }) {
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
    document.title = `AutoTabGroups · ${preferences.locale === 'en' ? 'Tab organizer' : '标签整理'}`;
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
  const t = useCallback((zh: string, en: string) => preferences.locale === 'en' ? en : zh, [preferences.locale]);
  return <Context.Provider value={{ ...preferences, resolvedTheme, t, savePreferences, preferenceBusy, preferencesReady,
    preferenceError: preferenceError === 'load' ? t('外观偏好读取失败，请刷新重试。', 'Could not load appearance preferences. Refresh to retry.') : preferenceError ? t('偏好保存失败，原设置已保留，请重试。', 'Could not save preferences. Previous settings were kept. Please retry.') : '' }}>{children}</Context.Provider>;
}
export function useUi() {
  const context = useContext(Context);
  if (!context) throw new Error('useUi requires UiProvider');
  return context;
}
