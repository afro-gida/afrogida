import { ImageBackground, StyleSheet, useColorScheme, type ViewStyle } from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';

import { useTheme } from '@/hooks/use-theme';

const WALLPAPER_LIGHT = require('@/assets/brand/wallpaper-light.jpg');
const WALLPAPER_DARK = require('@/assets/brand/wallpaper-dark.jpg');

/**
 * Gerçek siteden alınan sebze desenli duvar kağıdını sabit arka plan olarak
 * kullanır (bkz. frontend/index.html "KOYU/AÇIK MOD DUVAR KAĞIDI"). İçerik
 * kartları üstte opak durur; duvar kağıdı yalnızca kartlar arasındaki
 * boşluklarda görünür.
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
  const wallpaper = scheme === 'dark' ? WALLPAPER_DARK : WALLPAPER_LIGHT;

  return (
    <ImageBackground
      source={wallpaper}
      resizeMode="contain"
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
});
