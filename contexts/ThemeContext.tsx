import AsyncStorage from '@react-native-async-storage/async-storage';
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type PropsWithChildren,
} from 'react';

export type ThemeMode = 'system' | 'light' | 'dark';

const STORAGE_KEY = 'ask-nearby:theme-mode';

type ThemeContextValue = {
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

function isThemeMode(value: unknown): value is ThemeMode {
  return value === 'system' || value === 'light' || value === 'dark';
}

/**
 * Holds the user's explicit theme choice, persisted across launches.
 *
 * `system` defers to the device. Note that Signal resolves an *unset* system
 * preference to dark rather than light — the near-black board is the design,
 * so that is what you get unless something explicitly asks for light. See
 * useColors().
 */
export function ThemeProvider({ children }: PropsWithChildren) {
  const [mode, setModeState] = useState<ThemeMode>('system');

  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(STORAGE_KEY)
      .then((stored) => {
        if (!cancelled && isThemeMode(stored)) setModeState(stored);
      })
      .catch(() => {
        // A missing or unreadable preference is not worth surfacing —
        // falling back to `system` is the right behaviour anyway.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
    AsyncStorage.setItem(STORAGE_KEY, next).catch(() => {});
  }, []);

  return (
    <ThemeContext.Provider value={{ mode, setMode }}>{children}</ThemeContext.Provider>
  );
}

export function useThemeMode() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useThemeMode must be used within ThemeProvider');
  return ctx;
}

/**
 * Context-optional read, for code that can render outside the provider —
 * notably the error fallback, which sits above it in the tree.
 */
export function useThemeModeOptional() {
  return useContext(ThemeContext);
}
