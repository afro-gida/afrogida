import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';

import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth-context';
import { ApiError } from '@/lib/api';
import { Spacing } from '@/constants/theme';

export default function ForgotPasswordScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { sendOtp, resetPassword } = useAuth();

  const [phone, setPhone] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [sendingOtp, setSendingOtp] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function handleSendOtp() {
    setError(null);
    if (phone.trim().length < 10) return setError('Geçerli bir telefon numarası gir.');
    setSendingOtp(true);
    try {
      const res = await sendOtp(phone.trim(), 'password_reset');
      setOtpSent(true);
      if (!res.sms_sent) {
        setError('Not: SMS gönderilemedi (geliştirme ortamı) — kodu backend/run_dev_server.py terminalindeki logdan oku.');
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Bağlantı hatası. Backend çalışıyor mu?');
    } finally {
      setSendingOtp(false);
    }
  }

  async function handleReset() {
    setError(null);
    if (otpCode.trim().length !== 6) return setError('SMS ile gelen 6 haneli kodu gir.');
    if (newPassword.length < 6) return setError('Yeni şifre en az 6 karakter olmalı.');
    setSubmitting(true);
    try {
      await resetPassword(phone.trim(), otpCode.trim(), newPassword);
      setDone(true);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Bağlantı hatası. Backend çalışıyor mu?');
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <Screen edges={['bottom']}>
        <View style={[styles.body, { backgroundColor: theme.authCard }]}>
          <ThemedText type="subtitle">Şifren güncellendi</ThemedText>
          <ThemedText themeColor="textSecondary" style={styles.hint}>
            Yeni şifrenle giriş yapabilirsin.
          </ThemedText>
          <Pressable style={[styles.button, { backgroundColor: theme.tint }]} onPress={() => router.replace('/giris')}>
            <ThemedText style={{ color: '#fff' }} type="smallBold">
              Giriş Yap
            </ThemedText>
          </Pressable>
        </View>
      </Screen>
    );
  }

  return (
    <Screen edges={['bottom']}>
      <View style={[styles.body, { backgroundColor: theme.authCard }]}>
        <ThemedText type="subtitle">Şifremi Unuttum</ThemedText>
        <ThemedText themeColor="textSecondary" style={styles.hint}>
          Telefon numarana SMS ile doğrulama kodu göndereceğiz.
        </ThemedText>

        <TextInput
          value={phone}
          onChangeText={setPhone}
          editable={!otpSent}
          placeholder="05XX XXX XX XX"
          placeholderTextColor={theme.textSecondary}
          keyboardType="phone-pad"
          autoComplete="off"
          style={[styles.input, { borderColor: theme.border, color: theme.text, backgroundColor: theme.inputBg }]}
        />

        {!otpSent ? (
          <Pressable style={[styles.button, { backgroundColor: theme.tint }]} onPress={handleSendOtp} disabled={sendingOtp}>
            {sendingOtp ? <ActivityIndicator color="#fff" /> : (
              <ThemedText style={{ color: '#fff' }} type="smallBold">
                Kod Gönder
              </ThemedText>
            )}
          </Pressable>
        ) : (
          <>
            <TextInput
              value={otpCode}
              onChangeText={setOtpCode}
              placeholder="SMS Kodu (6 hane)"
              placeholderTextColor={theme.textSecondary}
              keyboardType="number-pad"
              maxLength={6}
              autoComplete="off"
              style={[styles.input, { borderColor: theme.border, color: theme.text, backgroundColor: theme.inputBg }]}
            />
            <TextInput
              value={newPassword}
              onChangeText={setNewPassword}
              placeholder="Yeni şifre (en az 6 karakter)"
              placeholderTextColor={theme.textSecondary}
              secureTextEntry
              autoComplete="off"
              style={[styles.input, { borderColor: theme.border, color: theme.text, backgroundColor: theme.inputBg }]}
            />
            <Pressable style={[styles.button, { backgroundColor: theme.tint }]} onPress={handleReset} disabled={submitting}>
              {submitting ? <ActivityIndicator color="#fff" /> : (
                <ThemedText style={{ color: '#fff' }} type="smallBold">
                  Şifreyi Güncelle
                </ThemedText>
              )}
            </Pressable>
          </>
        )}

        {error && (
          <ThemedText themeColor="danger" type="small">
            {error}
          </ThemedText>
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { margin: Spacing.three, borderRadius: 16, padding: Spacing.three, gap: Spacing.two },
  hint: { marginBottom: Spacing.two },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two, fontSize: 16 },
  button: { borderRadius: 999, paddingVertical: Spacing.three, alignItems: 'center', marginTop: Spacing.one },
});
