import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';

import { AuthLayout } from '@/components/auth-layout';
import { FormField, Notice, PasswordField } from '@/components/form-field';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth-context';
import { ApiError } from '@/lib/api';
import { surface } from '@/constants/surfaces';
import { Spacing, withAlpha } from '@/constants/theme';
import { Turnstile, TURNSTILE_ON } from '@/components/turnstile';

export default function LoginScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { login } = useAuth();
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Robot doğrulaması: her giriş denemesinde yeni doğrulama (token tek kullanımlık)
  const [captcha, setCaptcha] = useState<string | null>(null);
  const [captchaKey, setCaptchaKey] = useState(0);

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
    if (TURNSTILE_ON && !captcha) {
      setError('Önce “Gerçek kişi olduğunuzu doğrulayın” kutusunu işaretle.');
      return;
    }
    setSubmitting(true);
    try {
      await login(phone.trim(), password, captcha);
      if (router.canGoBack()) router.back();
      else router.replace('/');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Bağlantı hatası. Backend çalışıyor mu?');
      if (TURNSTILE_ON) setCaptchaKey((k) => k + 1);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout title="Tekrar hoş geldin" subtitle="Kayıtlı telefon numaranla giriş yap." onBack={() => router.replace('/')}>
      <FormField
        label="Telefon numarası"
        icon="phone-outline"
        value={phone}
        onChangeText={setPhone}
        placeholder="05XX XXX XX XX"
        keyboardType="phone-pad"
        autoComplete="off"
        maxLength={14}
      />
      <View>
        <PasswordField
          label="Şifre"
          value={password}
          onChangeText={setPassword}
          placeholder="Şifreniz"
          autoComplete="off"
          onSubmitEditing={handleLogin}
        />
        <Pressable onPress={() => router.push('/sifremi-unuttum')} hitSlop={8} style={styles.forgot}>
          <ThemedText style={[styles.forgotText, { color: theme.tint }]}>Şifremi unuttum</ThemedText>
        </Pressable>
      </View>

      <Turnstile onToken={setCaptcha} resetKey={captchaKey} />

      {error && <Notice text={error} />}

      <Pressable
        style={({ pressed }) => [surface.primaryBtn, { backgroundColor: theme.tint, opacity: pressed || submitting ? 0.88 : 1 }]}
        onPress={handleLogin}
        disabled={submitting}
      >
        {submitting ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <>
            <ThemedText style={surface.primaryBtnText}>Giriş Yap</ThemedText>
            <Ionicons name="arrow-forward" size={18} color="#fff" />
          </>
        )}
      </Pressable>

      <View style={styles.dividerRow}>
        <View style={[styles.dividerLine, { backgroundColor: withAlpha(theme.text, 0.15) }]} />
        <ThemedText themeColor="textSecondary" style={styles.dividerText}>Hesabın yok mu?</ThemedText>
        <View style={[styles.dividerLine, { backgroundColor: withAlpha(theme.text, 0.15) }]} />
      </View>

      <Pressable
        style={({ pressed }) => [surface.primaryBtn, { backgroundColor: withAlpha(theme.tint, 0.14), opacity: pressed ? 0.8 : 1 }]}
        onPress={() => router.replace('/kayit')}
      >
        <ThemedText style={[surface.primaryBtnText, { color: theme.tint }]}>Ücretsiz Üye Ol</ThemedText>
      </Pressable>
    </AuthLayout>
  );
}

const styles = StyleSheet.create({
  forgot: { alignSelf: 'flex-end', paddingTop: Spacing.two, paddingHorizontal: 4 },
  forgotText: { fontSize: 13, lineHeight: 17, fontWeight: '800' },
  dividerRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  dividerLine: { flex: 1, height: 1 },
  dividerText: { fontSize: 12.5, lineHeight: 16, fontWeight: '700' },
});
