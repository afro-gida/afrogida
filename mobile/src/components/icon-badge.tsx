import { Ionicons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';
import { StyleSheet, View } from 'react-native';

import { useTheme } from '@/hooks/use-theme';

export type IoniconName = ComponentProps<typeof Ionicons>['name'];

/** Emoji yerine kullanılan ikon rozeti: yuvarlak köşeli, renkli kare zemin + çizgi ikon (site stiline uygun). */
export function IconBadge({
  name,
  size = 18,
  color = '#fff',
  background,
  badgeSize = 32,
  radius = 10,
}: {
  name: IoniconName;
  size?: number;
  color?: string;
  background?: string;
  badgeSize?: number;
  radius?: number;
}) {
  const theme = useTheme();
  return (
    <View
      style={[
        styles.badge,
        { width: badgeSize, height: badgeSize, borderRadius: radius, backgroundColor: background ?? theme.tint },
      ]}
    >
      <Ionicons name={name} size={size} color={color} />
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { alignItems: 'center', justifyContent: 'center' },
});
