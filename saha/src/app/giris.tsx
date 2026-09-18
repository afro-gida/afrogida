import { useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';

import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth-context';
import { ApiError } from '@/lib/api';
import { Spacing } from '@/constants/theme';

const LOGIN_BANNER = require('@/assets/brand/login-banner.jpg');

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
      router.replace('/');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Bağlantı hatası. Backend çalışıyor mu?');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Screen edges={['top', 'bottom']}>
      <View style={styles.headerSpace}>
        <Image source={LOGIN_BANNER} style={StyleSheet.absoluteFill} resizeMode="cover" />
      </View>

      <View style={[styles.card, { backgroundColor: theme.authCard }]}>
        <ThemedText type="title" style={styles.title}>
          Saha Girişi
        </ThemedText>
        <ThemedText themeColor="textSecondary" style={styles.subtitle}>
          Tedarikçi, kurye veya pazar sorumlusu hesabınızla giriş yapın.
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
          autoComplete="off"
          style={[styles.input, { borderColor: theme.border, color: theme.text, backgroundColor: theme.inputBg }]}
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
            autoComplete="off"
            style={[styles.input, { borderColor: theme.border, color: theme.text, backgroundColor: theme.inputBg }]}
          />
          <Pressable style={styles.eyeBtn} onPress={() => setShowPassword((v) => !v)}>
            <ThemedText themeColor="tint" type="small">{showPassword ? 'Gizle' : 'Göster'}</ThemedText>
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

        <ThemedText themeColor="textSecondary" type="small" style={styles.hint}>
          Şifreni unuttuysan Afro Gıda müşteri uygulamasından "Şifremi Unuttum" ile sıfırlayabilirsin
          (aynı telefon numarasıyla).
        </ThemedText>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  headerSpace: { height: 170, overflow: 'hidden' },
  card: { flex: 1, borderTopLeftRadius: 24, borderTopRightRadius: 24, marginTop: -24, padding: Spacing.three, gap: 6 },
  title: { fontSize: 26, lineHeight: 30 },
  subtitle: { marginBottom: Spacing.two },
  label: { marginTop: Spacing.two, marginBottom: 2 },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two, fontSize: 16 },
  passwordWrap: { justifyContent: 'center' },
  eyeBtn: { position: 'absolute', right: Spacing.three },
  error: { marginTop: Spacing.one },
  submitBtn: { borderRadius: 999, paddingVertical: Spacing.three, alignItems: 'center', marginTop: Spacing.two },
  hint: { marginTop: Spacing.three, textAlign: 'center' },
});
