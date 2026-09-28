import { StyleSheet, type ViewStyle } from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';

import { useTheme } from '@/hooks/use-theme';

/** Basit düz renkli ekran sarmalayıcı - mobile/'deki duvar kağıdı sistemi
 * burada yok (saha app daha sade, iş odaklı bir arayüz). */
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
  return (
    <SafeAreaView style={[styles.flex, { backgroundColor: theme.background }, style]} edges={edges}>
      {children}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
});
