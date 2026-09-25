import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { withAlpha } from '@/constants/theme';
import { Spacing } from '@/constants/theme';

export function CheckboxRow({
  checked,
  onToggle,
  children,
  required,
  disabled,
}: {
  checked: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  required?: boolean;
  disabled?: boolean;
}) {
  const theme = useTheme();
  return (
    <Pressable
      style={[styles.row, disabled && styles.rowDisabled]}
      onPress={onToggle}
      disabled={disabled}
      accessibilityRole="checkbox"
      accessibilityState={{ checked, disabled }}
    >
      <View
        style={[
          styles.box,
          checked
            ? { borderColor: theme.tint, backgroundColor: theme.tint }
            : { borderColor: withAlpha(theme.text, 0.3), backgroundColor: 'transparent' },
        ]}
      >
        {checked && <Ionicons name="checkmark" size={15} color="#fff" />}
      </View>
      <ThemedText type="small" style={styles.text}>
        {children}
        {required && <ThemedText themeColor="danger"> *</ThemedText>}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two + 2, paddingVertical: 6 },
  rowDisabled: { opacity: 0.4 },
  text: { flex: 1, fontSize: 13.5, lineHeight: 19 },
  box: {
    width: 22, height: 22, borderRadius: 7, borderWidth: 1.5,
    alignItems: 'center', justifyContent: 'center', marginTop: -1,
  },
});
