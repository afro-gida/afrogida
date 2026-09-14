import { useLayoutEffect, useState } from 'react';
import { useColorScheme as useRNColorScheme } from 'react-native';

/**
 * To support static rendering, this value needs to be re-calculated on the client side for web.
 *
 * `useLayoutEffect` (değil `useEffect`) kullanıyoruz: ikisi de statik
 * (sunucu tarafında üretilmiş) HTML ile ilk render'ın eşleşmesi için
 * hidrasyon anında hâlâ 'light' döndürüyor, AMA useLayoutEffect tarayıcı
 * ekrana BOYAMADAN ÖNCE, DOM commit'inden hemen sonra senkron çalışıyor —
 * bu yüzden gerçek tema (ör. koyu mod) kullanıcıya "önce açık tema görünüp
 * sonra koyuya dönme" yanıp sönmesi olmadan, doğrudan doğru halde gösteriliyor.
 */
export function useColorScheme() {
  const [hasHydrated, setHasHydrated] = useState(false);

  useLayoutEffect(() => {
    setHasHydrated(true);
  }, []);

  const colorScheme = useRNColorScheme();

  if (hasHydrated) {
    return colorScheme;
  }

  return 'light';
}
