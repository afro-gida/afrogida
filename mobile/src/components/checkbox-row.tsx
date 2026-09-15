import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
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
    <Pressable style={[styles.row, disabled && styles.rowDisabled]} onPress={onToggle} disabled={disabled}>
      <View
        style={[
          styles.box,
          { borderColor: checked ? theme.tint : theme.border, backgroundColor: checked ? theme.tint : 'transparent' },
        ]}
      >
        {checked && <ThemedText style={styles.check}>✓</ThemedText>}
      </View>
      <ThemedText type="small" style={styles.flex}>
        {children}
        {required && <ThemedText themeColor="danger"> *</ThemedText>}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two, paddingVertical: 4 },
  rowDisabled: { opacity: 0.4 },
  flex: { flex: 1 },
  box: {
    width: 20, height: 20, borderRadius: 5, borderWidth: 1.5,
    alignItems: 'center', justifyContent: 'center', marginTop: 1,
  },
  check: { color: '#fff', fontSize: 12, fontWeight: '700', lineHeight: 14 },
});
