// @vitest-environment jsdom
// M8 Settings — device preference helpers: theme validation + persistence, and the generic localStorage pref.
// jsdom here gives us `document` but not Web Storage, so install a minimal in-memory localStorage shim. prefs.ts
// only touches localStorage inside its functions (not at import), so a static import + beforeAll shim is enough.
import {describe, expect, it, beforeEach, beforeAll} from 'vitest';
import {getTheme, applyTheme, initTheme, getPref} from '@/app/core/prefs/prefs';

beforeAll(() => {
  const store = new Map<string, string>();
  const shim: Storage = {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (k) => (store.has(k) ? store.get(k)! : null),
    key: (i) => Array.from(store.keys())[i] ?? null,
    removeItem: (k) => void store.delete(k),
    setItem: (k, v) => void store.set(k, String(v)),
  };
  Object.defineProperty(globalThis, 'localStorage', {value: shim, configurable: true});
});

describe('device prefs', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
  });

  it('defaults theme to light and rejects garbage', () => {
    expect(getTheme()).toBe('light');
    localStorage.setItem('puv_theme', 'neon-disco');
    expect(getTheme()).toBe('light');
  });

  it('reads a valid saved theme', () => {
    localStorage.setItem('puv_theme', 'cream');
    expect(getTheme()).toBe('cream');
  });

  it('applyTheme sets the html data-theme attribute', () => {
    applyTheme('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('initTheme paints the persisted theme', () => {
    localStorage.setItem('puv_theme', 'green');
    initTheme();
    expect(document.documentElement.getAttribute('data-theme')).toBe('green');
  });

  it('getPref returns the fallback when unset and the stored value otherwise', () => {
    expect(getPref('terminal_id', 'Terminal A')).toBe('Terminal A');
    localStorage.setItem('puv_terminal_id', 'Gate 2');
    expect(getPref('terminal_id', 'Terminal A')).toBe('Gate 2');
  });
});
