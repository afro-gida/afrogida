import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';

import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth-context';
import { ApiError } from '@/lib/api';
import { Spacing } from '@/constants/theme';

/**
 * Giriş yapmış kullanıcının şifre değiştirmesi: mevcut şifre + yeni şifre.
 * Telefon/SMS gerekmez — kullanıcı zaten oturum açmış, kimliğini mevcut
 * şifresiyle doğruluyor (backend: POST /auth/password). Şifresini
 * hatırlamayan kullanıcı için "Şifremi Unuttum" (SMS'li) akışı ayrı.
 */
export default function ChangePasswordScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { changePassword } = useAuth();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [nextAgain, setNextAgain] = useState('');
  const [show, setShow] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function handleSubmit() {
    setError(null);
    if (!current) return setError('Mevcut şifreni gir.');
    if (next.length < 6) return setError('Yeni şifre en az 6 karakter olmalı.');
    if (next !== nextAgain) return setError('Yeni şifreler birbiriyle aynı değil.');
    if (next === current) return setError('Yeni şifre mevcut şifreyle aynı olamaz.');
    setSubmitting(true);
    try {
      await changePassword(current, next);
      setDone(true);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Bağlantı hatası. Backend çalışıyor mu?');
    } finally {
      setSubmitting(false);
    }
  }

  const inputStyle = [styles.input, { borderColor: theme.border, color: theme.text, backgroundColor: theme.inputBg }];

  if (done) {
    return (
      <Screen edges={['bottom']}>
        <View style={[styles.body, { backgroundColor: theme.authCard }]}>
          <Ionicons name="checkmark-circle" size={44} color={theme.tint} />
          <ThemedText type="subtitle">Şifren değiştirildi</ThemedText>
          <ThemedText themeColor="textSecondary">Bir sonraki girişinde yeni şifreni kullan.</ThemedText>
          <Pressable style={[styles.button, { backgroundColor: theme.tint }]} onPress={() => router.back()}>
            <ThemedText style={{ color: '#fff' }} type="smallBold">
              Tamam
            </ThemedText>
          </Pressable>
        </View>
      </Screen>
    );
  }

  return (
    <Screen edges={['bottom']}>
      <View style={[styles.body, { backgroundColor: theme.authCard }]}>
        <ThemedText type="small" themeColor="textSecondary" style={styles.label}>
          Mevcut Şifre
        </ThemedText>
        <View style={styles.passwordWrap}>
          <TextInput
            value={current}
            onChangeText={setCurrent}
            placeholder="Şu anki şifren"
            placeholderTextColor={theme.textSecondary}
            secureTextEntry={!show}
            autoComplete="current-password"
            style={inputStyle}
          />
          <Pressable style={styles.eyeBtn} onPress={() => setShow((v) => !v)} hitSlop={8}>
            <Ionicons name={show ? 'eye-off-outline' : 'eye-outline'} size={24} color={theme.tint} />
          </Pressable>
        </View>

        <ThemedText type="small" themeColor="textSecondary" style={styles.label}>
          Yeni Şifre
        </ThemedText>
        <TextInput
          value={next}
          onChangeText={setNext}
          placeholder="En az 6 karakter"
          placeholderTextColor={theme.textSecondary}
          secureTextEntry={!show}
          autoComplete="new-password"
          style={inputStyle}
        />

        <ThemedText type="small" themeColor="textSecondary" style={styles.label}>
          Yeni Şifre (Tekrar)
        </ThemedText>
        <TextInput
          value={nextAgain}
          onChangeText={setNextAgain}
          placeholder="Yeni şifreyi tekrar yaz"
          placeholderTextColor={theme.textSecondary}
          secureTextEntry={!show}
          autoComplete="new-password"
          onSubmitEditing={handleSubmit}
          style={inputStyle}
        />

        {!!error && (
          <ThemedText themeColor="danger" type="small">
            {error}
          </ThemedText>
        )}

        <Pressable style={[styles.button, { backgroundColor: theme.tint }]} onPress={handleSubmit} disabled={submitting}>
          {submitting ? <ActivityIndicator color="#fff" /> : (
            <ThemedText style={{ color: '#fff' }} type="smallBold">
              Şifreyi Değiştir
            </ThemedText>
          )}
        </Pressable>

        <Pressable onPress={() => router.push('/sifremi-unuttum')} style={styles.forgotLink} hitSlop={6}>
          <ThemedText themeColor="tint" type="small" style={styles.underline}>
            Mevcut şifremi hatırlamıyorum
          </ThemedText>
        </Pressable>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { margin: Spacing.three, borderRadius: 16, padding: Spacing.three, gap: Spacing.two },
  label: { marginTop: Spacing.one, marginBottom: -2 },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two, fontSize: 16 },
  passwordWrap: { justifyContent: 'center' },
  eyeBtn: { position: 'absolute', right: Spacing.three },
  button: { borderRadius: 999, paddingVertical: Spacing.three, alignItems: 'center', marginTop: Spacing.two },
  forgotLink: { alignItems: 'center', paddingVertical: Spacing.two },
  underline: { textDecorationLine: 'underline', fontWeight: '600' },
});
