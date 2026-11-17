import { useCallback, useEffect, useState } from 'react';

export type ThemeMode = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'bignet_theme';

export function getStoredTheme(): ThemeMode {
  try {
    const val = localStorage.getItem(STORAGE_KEY);
    if (val === 'dark' || val === 'light' || val === 'system') return val;
  } catch {
    // ignore
  }
  return 'light';
}

export function resolveIsDark(mode: ThemeMode): boolean {
  if (mode === 'dark') return true;
  if (mode === 'light') return false;
  if (typeof window !== 'undefined' && window.matchMedia) {
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  }
  return false;
}

export function applyTheme(mode: ThemeMode): boolean {
  const isDark = resolveIsDark(mode);
  if (typeof document !== 'undefined') {
    document.documentElement.classList.toggle('dark', isDark);
  }
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // ignore
  }
  return isDark;
}

export function useTheme() {
  const [mode, setModeState] = useState<ThemeMode>(() => getStoredTheme());
  const [isDark, setIsDark] = useState<boolean>(() => resolveIsDark(getStoredTheme()));

  const setTheme = useCallback((next: ThemeMode) => {
    setModeState(next);
    setIsDark(applyTheme(next));
    window.dispatchEvent(new CustomEvent('bignet-theme-change', { detail: next }));
  }, []);

  const toggleTheme = useCallback(() => {
    const currentlyDark = resolveIsDark(getStoredTheme());
    setTheme(currentlyDark ? 'light' : 'dark');
  }, [setTheme]);

  useEffect(() => {
    setIsDark(applyTheme(mode));

    const handleStorageOrCustom = () => {
      const stored = getStoredTheme();
      setModeState(stored);
      setIsDark(resolveIsDark(stored));
    };

    const mql = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
    const handleMedia = () => {
      if (getStoredTheme() === 'system') {
        setIsDark(applyTheme('system'));
      }
    };

    window.addEventListener('storage', handleStorageOrCustom);
    window.addEventListener('bignet-theme-change', handleStorageOrCustom);
    mql?.addEventListener('change', handleMedia);
    return () => {
      window.removeEventListener('storage', handleStorageOrCustom);
      window.removeEventListener('bignet-theme-change', handleStorageOrCustom);
      mql?.removeEventListener('change', handleMedia);
    };
  }, [mode]);

  return { mode, isDark, setTheme, toggleTheme };
}
