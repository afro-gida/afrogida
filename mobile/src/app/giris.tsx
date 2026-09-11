import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';

import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth-context';
import { ApiError } from '@/lib/api';
import { Spacing } from '@/constants/theme';

export default function LoginScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { login } = useAuth();
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
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
      <View style={[styles.body, { backgroundColor: theme.backgroundElement }]}>
        <ThemedText type="subtitle">Giriş Yap</ThemedText>
        <ThemedText themeColor="textSecondary" style={styles.hint}>
          Telefon numaran ve şifrenle giriş yap.
        </ThemedText>

        <TextInput
          value={phone}
          onChangeText={setPhone}
          placeholder="05XX XXX XX XX"
          placeholderTextColor={theme.textSecondary}
          keyboardType="phone-pad"
          style={[styles.input, { borderColor: theme.border, color: theme.text, backgroundColor: theme.background }]}
        />
        <TextInput
          value={password}
          onChangeText={setPassword}
          placeholder="Şifre"
          placeholderTextColor={theme.textSecondary}
          secureTextEntry
          style={[styles.input, { borderColor: theme.border, color: theme.text, backgroundColor: theme.background }]}
        />

        {error && (
          <ThemedText themeColor="danger" type="small">
            {error}
          </ThemedText>
        )}

        <Pressable style={[styles.button, { backgroundColor: theme.tint }]} onPress={handleLogin} disabled={submitting}>
          {submitting ? <ActivityIndicator color="#fff" /> : (
            <ThemedText style={{ color: '#fff' }} type="smallBold">
              Giriş Yap
            </ThemedText>
          )}
        </Pressable>

        <Pressable onPress={() => router.push('/sifremi-unuttum')} style={styles.linkBtn}>
          <ThemedText themeColor="tint" type="small">
            Şifremi unuttum
          </ThemedText>
        </Pressable>

        <View style={[styles.divider, { borderColor: theme.border }]} />

        <Pressable onPress={() => router.push('/kayit')} style={styles.linkBtn}>
          <ThemedText themeColor="textSecondary" type="small">
            Hesabın yok mu? <ThemedText themeColor="tint" type="smallBold">Kayıt Ol</ThemedText>
          </ThemedText>
        </Pressable>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { margin: Spacing.three, borderRadius: 16, padding: Spacing.three, gap: Spacing.two },
  hint: { marginBottom: Spacing.two },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two, fontSize: 16 },
  button: { borderRadius: 999, paddingVertical: Spacing.three, alignItems: 'center', marginTop: Spacing.one },
  linkBtn: { alignItems: 'center', paddingVertical: Spacing.two },
  divider: { borderTopWidth: 1, marginVertical: Spacing.one },
});
