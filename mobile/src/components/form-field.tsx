import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { forwardRef, useState, type ReactNode } from 'react';
import { Platform, Pressable, StyleSheet, TextInput, View, type TextInputProps } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { withAlpha } from '@/constants/theme';
import { surface } from '@/constants/surfaces';

type Mci = keyof typeof MaterialCommunityIcons.glyphMap;

// Web'de tarayıcının kendi odak çerçevesi, kutunun renkli kenarıyla çift çizgi
// yapıyordu; odak zaten kutunun kenar rengiyle gösteriliyor.
const WEB_NO_OUTLINE = (Platform.OS === 'web' ? { outlineStyle: 'none' } : null) as any;

/**
 * Müşteri uygulamasının ortak giriş kutusu: başta ikon, dolu zemin (çerçeve
 * yok), odaklanınca ince renkli kenar. Giriş / kayıt / şifre / adres /
 * şikayet formlarında aynı görünüm için.
 */
export const FormField = forwardRef<TextInput, TextInputProps & {
  label?: string;
  icon?: Mci;
  right?: ReactNode;
  invalid?: boolean;
  multilineHeight?: number;
}>(function FormField({ label, icon, right, invalid, multilineHeight, style, onFocus, onBlur, multiline, ...rest }, ref) {
  const theme = useTheme();
  const [focused, setFocused] = useState(false);
  const borderColor = invalid ? theme.danger : focused ? theme.tint : 'transparent';
  return (
    <View>
      {!!label && <ThemedText themeColor="textSecondary" style={surface.label}>{label}</ThemedText>}
      <View
        style={[
          styles.box,
          multiline && { height: multilineHeight ?? 110, alignItems: 'flex-start', paddingTop: 12 },
          { backgroundColor: theme.inputBg, borderColor },
        ]}
      >
        {!!icon && (
          <MaterialCommunityIcons name={icon} size={19} color={focused ? theme.tint : theme.textSecondary} style={multiline ? styles.iconTop : undefined} />
        )}
        <TextInput
          ref={ref}
          placeholderTextColor={withAlpha(theme.textSecondary, 0.8)}
          multiline={multiline}
          onFocus={(e) => {
            setFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            onBlur?.(e);
          }}
          style={[styles.input, multiline && styles.inputMulti, WEB_NO_OUTLINE, { color: theme.text }, style]}
          {...rest}
        />
        {right}
      </View>
    </View>
  );
});

/** Şifre alanı: göster/gizle düğmeli FormField. */
export function PasswordField(props: TextInputProps & { label?: string; icon?: Mci }) {
  const theme = useTheme();
  const [show, setShow] = useState(false);
  return (
    <FormField
      icon="lock-outline"
      secureTextEntry={!show}
      autoCapitalize="none"
      {...props}
      right={
        <Pressable onPress={() => setShow((v) => !v)} hitSlop={10} accessibilityLabel={show ? 'Şifreyi gizle' : 'Şifreyi göster'}>
          <Ionicons name={show ? 'eye-off-outline' : 'eye-outline'} size={21} color={theme.textSecondary} />
        </Pressable>
      }
    />
  );
}

/** Form içi uyarı / bilgi şeridi. */
export function Notice({ text, tone = 'error' }: { text: string; tone?: 'error' | 'info' | 'success' }) {
  const theme = useTheme();
  const color = tone === 'error' ? theme.danger : theme.tint;
  const icon = tone === 'error' ? 'alert-circle' : tone === 'success' ? 'checkmark-circle' : 'information-circle';
  return (
    <View style={[styles.notice, { backgroundColor: withAlpha(color, 0.12) }]}>
      <Ionicons name={icon} size={17} color={color} />
      <ThemedText style={[styles.noticeText, { color: tone === 'error' ? theme.danger : theme.text }]}>{text}</ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderRadius: 16, borderWidth: 1.5, height: 52, paddingHorizontal: 14,
  },
  iconTop: { marginTop: 2 },
  input: { flex: 1, fontSize: 15.5, height: '100%', minWidth: 0 },
  inputMulti: { textAlignVertical: 'top', paddingTop: 0 },
  notice: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, borderRadius: 14, padding: 12 },
  noticeText: { flex: 1, fontSize: 13, lineHeight: 18, fontWeight: '600' },
});
