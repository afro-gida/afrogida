import { useColorScheme } from 'react-native';
import { Colors } from '@/constants/theme';

/** Basit sistem temasına göre renk paleti - saha app'te ayrı bir tema
 * tercihi ekranı yok (mobile/'deki gibi), sadece cihazın kendi ayarı. */
export function useTheme() {
  const scheme = useColorScheme();
  return Colors[scheme === 'dark' ? 'dark' : 'light'];
}
