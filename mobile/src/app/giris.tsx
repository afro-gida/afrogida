import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';

import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth-context';
import { ApiError } from '@/lib/api';
import { IconGreen, Spacing } from '@/constants/theme';

const LOGO = require('@/assets/brand/logo.png');

export default function LoginScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { login } = useAuth();
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleLogin() {
    setError(null);
    if (phone.trim().length < 10) {
      setError('Geçerli bir telefon numarası girin.');
      return;
    }
    if (!password) {
      setError('Şifreni girmelisin.');
      return;
    }
    setSubmitting(true);
    try {
      await login(phone.trim(), password);
      router.back();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Bağlantı hatası. Backend çalışıyor mu?');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Screen edges={['bottom']}>
      <View style={styles.headerSpace}>
        <Pressable style={styles.closeBtn} onPress={() => router.back()} hitSlop={12}>
          <ThemedText style={styles.closeIcon}>✕</ThemedText>
        </Pressable>
        <Image source={LOGO} style={styles.logo} resizeMode="contain" />
      </View>

      <View style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
        <ThemedText type="title" style={styles.title}>
          Giriş Yap
        </ThemedText>
        <ThemedText themeColor="textSecondary" style={styles.subtitle}>
          Kayıtlı telefon numaranızla giriş yapın.
        </ThemedText>

        <ThemedText type="small" themeColor="textSecondary" style={styles.label}>
          Telefon Numarası
        </ThemedText>
        <TextInput
          value={phone}
          onChangeText={setPhone}
          placeholder="05XX XXX XX XX"
          placeholderTextColor={theme.textSecondary}
          keyboardType="phone-pad"
          style={[styles.input, { borderColor: theme.border, color: theme.text, backgroundColor: theme.background }]}
        />

        <ThemedText type="small" themeColor="textSecondary" style={styles.label}>
          Şifre
        </ThemedText>
        <View style={styles.passwordWrap}>
          <TextInput
            value={password}
            onChangeText={setPassword}
            placeholder="Şifreniz"
            placeholderTextColor={theme.textSecondary}
            secureTextEntry={!showPassword}
            style={[styles.input, { borderColor: theme.border, color: theme.text, backgroundColor: theme.background }]}
          />
          <Pressable style={styles.eyeBtn} onPress={() => setShowPassword((v) => !v)}>
            <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={27} color={IconGreen} />
          </Pressable>
        </View>

        {error && (
          <ThemedText themeColor="danger" type="small" style={styles.error}>
            {error}
          </ThemedText>
        )}

        <Pressable style={[styles.submitBtn, { backgroundColor: theme.tint }]} onPress={handleLogin} disabled={submitting}>
          {submitting ? <ActivityIndicator color="#fff" /> : (
            <ThemedText style={{ color: '#fff' }} type="smallBold">
              Giriş Yap
            </ThemedText>
          )}
        </Pressable>

        <Pressable onPress={() => router.push('/sifremi-unuttum')} style={styles.forgotLink}>
          <ThemedText themeColor="tint" type="small" style={styles.underline}>
            Şifremi Unuttum
          </ThemedText>
        </Pressable>

        <Pressable
          style={[styles.registerBtn, { borderColor: theme.tint }]}
          onPress={() => router.replace('/kayit')}
        >
          <ThemedText themeColor="tint" type="smallBold">
            Ücretsiz Üye Ol
          </ThemedText>
        </Pressable>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  headerSpace: { height: 150, alignItems: 'center', justifyContent: 'center' },
  closeBtn: { position: 'absolute', top: Spacing.two, left: Spacing.three, zIndex: 1, padding: Spacing.one },
  closeIcon: { fontSize: 20 },
  logo: { width: 96, height: 96, borderRadius: 48 },
  card: { flex: 1, borderTopLeftRadius: 24, borderTopRightRadius: 24, marginTop: -24, padding: Spacing.three, gap: 6 },
  title: { fontSize: 26, lineHeight: 30 },
  subtitle: { marginBottom: Spacing.two },
  label: { marginTop: Spacing.two, marginBottom: 2 },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two, fontSize: 16 },
  passwordWrap: { justifyContent: 'center' },
  eyeBtn: { position: 'absolute', right: Spacing.three },
  error: { marginTop: Spacing.one },
  submitBtn: { borderRadius: 999, paddingVertical: Spacing.three, alignItems: 'center', marginTop: Spacing.two },
  forgotLink: { alignItems: 'flex-end', paddingVertical: Spacing.two },
  underline: { textDecorationLine: 'underline', fontWeight: '600' },
  registerBtn: { borderRadius: 999, borderWidth: 1.5, paddingVertical: Spacing.three - 2, alignItems: 'center', marginTop: Spacing.one },
});
