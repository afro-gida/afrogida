import { useState } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';

import { FormCardScreen, PrimaryButton } from '@/components/form-card';
import { Notice, PasswordField } from '@/components/form-field';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth-context';
import { ApiError } from '@/lib/api';

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

  if (done) {
    return (
      <FormCardScreen icon="check-decagram" title="Şifren değiştirildi" subtitle="Bir sonraki girişinde yeni şifreni kullan.">
        <PrimaryButton label="Tamam" arrow={false} onPress={() => router.back()} />
      </FormCardScreen>
    );
  }

  return (
    <FormCardScreen icon="key-outline" title="Şifreni değiştir" subtitle="Güvenliğin için önce mevcut şifreni doğrula.">
      <PasswordField label="Mevcut şifre" value={current} onChangeText={setCurrent} placeholder="Şu anki şifren" autoComplete="current-password" />
      <PasswordField label="Yeni şifre" icon="lock-plus-outline" value={next} onChangeText={setNext} placeholder="En az 6 karakter" autoComplete="new-password" />
      <PasswordField
        label="Yeni şifre (tekrar)"
        icon="lock-check-outline"
        value={nextAgain}
        onChangeText={setNextAgain}
        placeholder="Yeni şifreyi tekrar yaz"
        autoComplete="new-password"
        onSubmitEditing={handleSubmit}
      />

      {!!error && <Notice text={error} />}

      <PrimaryButton label="Şifreyi Değiştir" onPress={handleSubmit} loading={submitting} />

      <Pressable onPress={() => router.push('/sifremi-unuttum')} style={styles.forgot} hitSlop={6}>
        <ThemedText style={[styles.forgotText, { color: theme.tint }]}>Mevcut şifremi hatırlamıyorum</ThemedText>
      </Pressable>
    </FormCardScreen>
  );
}

const styles = StyleSheet.create({
  forgot: { alignItems: 'center', paddingVertical: 4 },
  forgotText: { fontSize: 13.5, lineHeight: 18, fontWeight: '800' },
});
