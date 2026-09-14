import { ImageBackground, Platform, StyleSheet, useColorScheme, View, type ViewStyle } from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';

import { useTheme } from '@/hooks/use-theme';
import { MaxContentWidth } from '@/constants/theme';

const WALLPAPER_LIGHT = require('@/assets/brand/wallpaper-light.jpg');
const WALLPAPER_DARK = require('@/assets/brand/wallpaper-dark.jpg');

/**
 * Gerçek siteden alınan sebze desenli duvar kağıdını sabit arka plan olarak
 * kullanır (bkz. frontend/index.html "KOYU/AÇIK MOD DUVAR KAĞIDI"). İçerik
 * kartları üstte opak durur; duvar kağıdı yalnızca kartlar arasındaki
 * boşluklarda görünür.
 *
 * Web'de duvar kağıdı, gerçek siteyle AYNI CSS tekniğiyle (background-size:
 * cover + position: fixed → pencere boyutu ne olursa olsun tam kaplar, hiç
 * yarım kalmaz) ama <body> yerine HER EKRANIN KENDİ İÇİNDE basılır: her ekran
 * kendi `position: fixed` duvar kağıdı katmanını çizer. Gezinme kütüphanesi
 * (React Navigation) önceki ekranı gizlemek için ekran kapsayıcısını opak
 * tutar — biz o kapsayıcıyı şeffaf yapmaya ÇALIŞMIYORUZ (bir denemede bunu
 * yapınca gezinirken önceki ekranlar üst üste görünmeye başlamıştı); bunun
 * yerine duvar kağıdını o opak kapsayıcının ÜSTÜNE, kendi ekranımızın ilk
 * çocuğu olarak basıyoruz — `position: fixed` olduğu için ekran boyutunu
 * dolduruyor ve içerik onun üstünde kalıyor. Native (telefon uygulaması)
 * tarafında ise resim bileşeniyle basılır — orada bu sorun yok.
 */
export function Screen({
  children,
  edges = ['top'],
  style,
}: {
  children: React.ReactNode;
  edges?: Edge[];
  style?: ViewStyle;
}) {
  const theme = useTheme();
  const scheme = useColorScheme();

  if (Platform.OS === 'web') {
    const wallpaperUrl = scheme === 'dark' ? '/wallpaper-dark.jpg' : '/wallpaper-light.jpg';
    // react-native-web'e özel CSS (position: fixed, background-image) RN'in
    // ViewStyle tipinde yok; bu tek View için tip kontrolünü bilerek atlıyoruz.
    const webWallpaperStyle: any = {
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: theme.wallpaperBg,
      backgroundImage: `url(${wallpaperUrl})`,
      backgroundSize: 'cover',
      backgroundPosition: 'center top',
      backgroundRepeat: 'no-repeat',
    };
    return (
      <View style={[styles.flex, styles.webOuter]}>
        <View style={webWallpaperStyle} />
        <SafeAreaView style={[styles.flex, styles.webInner, style]} edges={edges}>
          {children}
        </SafeAreaView>
      </View>
    );
  }

  const wallpaper = scheme === 'dark' ? WALLPAPER_DARK : WALLPAPER_LIGHT;
  return (
    <ImageBackground
      source={wallpaper}
      resizeMode="stretch"
      style={[styles.flex, { backgroundColor: theme.wallpaperBg }]}
    >
      <SafeAreaView style={[styles.flex, style]} edges={edges}>
        {children}
      </SafeAreaView>
    </ImageBackground>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  webOuter: { alignItems: 'center' },
  webInner: { width: '100%', maxWidth: MaxContentWidth },
});
