import { Ionicons } from '@expo/vector-icons';
import { useRouter, type Href } from 'expo-router';
import { Pressable } from 'react-native';

import { useTheme } from '@/hooks/use-theme';

/** Üst çubukta her zaman görünen geri düğmesi. Varsayılan ok sadece
 *  geçmiş varken çıkıyordu (sayfa yenilenince / adresten açılınca yoktu);
 *  geçmiş yoksa panelin ana sayfasına döner. */
export function BackButton({ fallback }: { fallback: Href }) {
  const router = useRouter();
  const theme = useTheme();
  return (
    <Pressable
      onPress={() => (router.canGoBack() ? router.back() : router.replace(fallback))}
      hitSlop={10}
      accessibilityLabel="Geri"
      style={{ paddingHorizontal: 8, paddingVertical: 4 }}
    >
      <Ionicons name="arrow-back" size={22} color={theme.text} />
    </Pressable>
  );
}
