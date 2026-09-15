import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

/** Kullanıcının Profil > Görünüm Ayarları'ndan seçtiği tema tercihi.
 *  "system" = cihazın kendi ayarını takip et (varsayılan). */
export type ThemePreference = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'afro_theme_preference';

type ThemePreferenceContextValue = {
  preference: ThemePreference;
  setPreference: (p: ThemePreference) => void;
};

const ThemePreferenceContext = createContext<ThemePreferenceContextValue | null>(null);

export function ThemePreferenceProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>('system');

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((v) => {
      if (v === 'light' || v === 'dark' || v === 'system') setPreferenceState(v);
    });
  }, []);

  function setPreference(p: ThemePreference) {
    setPreferenceState(p);
    AsyncStorage.setItem(STORAGE_KEY, p).catch(() => {});
  }

  return (
    <ThemePreferenceContext.Provider value={{ preference, setPreference }}>
      {children}
    </ThemePreferenceContext.Provider>
  );
}

/** use-color-scheme(.web).ts içinde tüketilir — tercih 'light'/'dark' ise
 *  sistem temasının önüne geçer, 'system' ise etkisi yoktur. */
export function useThemePreference() {
  const ctx = useContext(ThemePreferenceContext);
  if (!ctx) throw new Error('useThemePreference, ThemePreferenceProvider içinde kullanılmalı');
  return ctx;
}
