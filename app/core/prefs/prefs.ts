// M8 Settings — per-device client preferences (theme + station config). These are LOCAL, per-browser, and
// touch NO server data / RLS surface: a device's look and its printed-slip labels, not tenant records. Persisted
// in localStorage under the `puv_` prefix (same keys the prototype uses, so a device keeps its config). Server
// preferences (tax engine, currency policy, backup/export) are backlog — see Phase_2_Mockup_Reference_and_Backlog.
import {useCallback, useEffect, useState} from 'react';

export const THEMES = ['light', 'dark', 'cream', 'green'] as const;
export type ThemeId = (typeof THEMES)[number];

const THEME_KEY = 'puv_theme';

export function getTheme(): ThemeId {
  const t = localStorage.getItem(THEME_KEY);
  return (THEMES as readonly string[]).includes(t ?? '') ? (t as ThemeId) : 'light';
}

/** Apply a theme by setting <html data-theme>; the CSS var overrides in index.css do the recolor. */
export function applyTheme(theme: ThemeId): void {
  document.documentElement.setAttribute('data-theme', theme);
}

/** Call once at boot (before render) so a saved theme paints immediately with no flash. */
export function initTheme(): void {
  applyTheme(getTheme());
}

/** Reactive theme hook: current theme + a setter that persists, applies, and notifies every other
 *  mounted instance (top-bar toggle and the Settings radio stay in sync via a window event). */
export function useTheme(): [ThemeId, (t: ThemeId) => void] {
  const [theme, setThemeState] = useState<ThemeId>(getTheme);
  useEffect(() => {
    const onChange = () => setThemeState(getTheme());
    window.addEventListener('puv-themechange', onChange);
    return () => window.removeEventListener('puv-themechange', onChange);
  }, []);
  const setTheme = useCallback((t: ThemeId) => {
    localStorage.setItem(THEME_KEY, t);
    applyTheme(t);
    setThemeState(t);
    window.dispatchEvent(new Event('puv-themechange'));
  }, []);
  return [theme, setTheme];
}

const LIGHT_KEY = 'puv_theme_light'; // last non-dark choice, so the toggle round-trips to YOUR light theme

/** One-tap dark toggle: dark ⇄ the user's last light-family theme. */
export function useDarkToggle(): [boolean, () => void] {
  const [theme, setTheme] = useTheme();
  const toggle = useCallback(() => {
    if (theme === 'dark') {
      const back = localStorage.getItem(LIGHT_KEY);
      setTheme((THEMES as readonly string[]).includes(back ?? '') && back !== 'dark' ? (back as ThemeId) : 'light');
    } else {
      localStorage.setItem(LIGHT_KEY, theme);
      setTheme('dark');
    }
  }, [theme, setTheme]);
  return [theme === 'dark', toggle];
}

/** Reactive string preference backed by localStorage (station config the shell/receipts read back). */
export function usePref(key: string, fallback = ''): [string, (v: string) => void] {
  const storageKey = `puv_${key}`;
  const [value, setValue] = useState<string>(() => localStorage.getItem(storageKey) ?? fallback);
  const set = useCallback(
    (v: string) => {
      localStorage.setItem(storageKey, v);
      setValue(v);
    },
    [storageKey],
  );
  // pick up cross-tab / external writes
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === storageKey) setValue(e.newValue ?? fallback);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [storageKey, fallback]);
  return [value, set];
}

/** Non-reactive read for consumers outside React (e.g. the TopBar label helper, receipt print). */
export function getPref(key: string, fallback = ''): string {
  return localStorage.getItem(`puv_${key}`) ?? fallback;
}
