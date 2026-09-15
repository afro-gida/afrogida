import { useLayoutEffect, useState } from 'react';
import { useColorScheme as useRNColorScheme } from 'react-native';

import { useThemePreference } from '@/lib/theme-preference';

/**
 * To support static rendering, this value needs to be re-calculated on the client side for web.
 *
 * `useLayoutEffect` (değil `useEffect`) kullanıyoruz: ikisi de statik
 * (sunucu tarafında üretilmiş) HTML ile ilk render'ın eşleşmesi için
 * hidrasyon anında hâlâ 'light' döndürüyor, AMA useLayoutEffect tarayıcı
 * ekrana BOYAMADAN ÖNCE, DOM commit'inden hemen sonra senkron çalışıyor —
 * bu yüzden gerçek tema (ör. koyu mod) kullanıcıya "önce açık tema görünüp
 * sonra koyuya dönme" yanıp sönmesi olmadan, doğrudan doğru halde gösteriliyor.
 *
 * Kullanıcı Profil > Görünüm Ayarları'ndan Açık/Koyu tema seçtiyse (bkz.
 * lib/theme-preference.tsx), sistem temasının önüne geçer.
 */
export function useColorScheme() {
  const [hasHydrated, setHasHydrated] = useState(false);

  useLayoutEffect(() => {
    setHasHydrated(true);
  }, []);

  const systemScheme = useRNColorScheme();
  const { preference } = useThemePreference();

  if (!hasHydrated) {
    return 'light';
  }

  if (preference === 'light' || preference === 'dark') return preference;
  return systemScheme;
}
