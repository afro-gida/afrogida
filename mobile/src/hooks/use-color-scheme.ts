import { useColorScheme as useRNColorScheme } from 'react-native';

import { useThemePreference } from '@/lib/theme-preference';

/** Sistem temasını döndürür, ama kullanıcı Profil > Görünüm Ayarları'ndan
 *  Açık/Koyu tema seçtiyse onu önceliklendirir. */
export function useColorScheme() {
  const systemScheme = useRNColorScheme();
  const { preference } = useThemePreference();
  if (preference === 'light' || preference === 'dark') return preference;
  return systemScheme;
}
