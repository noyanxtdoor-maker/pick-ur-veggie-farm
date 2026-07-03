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

/** Reactive theme hook: current theme + a setter that persists and applies. */
export function useTheme(): [ThemeId, (t: ThemeId) => void] {
  const [theme, setThemeState] = useState<ThemeId>(getTheme);
  const setTheme = useCallback((t: ThemeId) => {
    localStorage.setItem(THEME_KEY, t);
    applyTheme(t);
    setThemeState(t);
  }, []);
  return [theme, setTheme];
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
