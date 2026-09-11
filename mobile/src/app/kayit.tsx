import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';

import { CheckboxRow } from '@/components/checkbox-row';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth-context';
import { ApiError } from '@/lib/api';
import { Spacing } from '@/constants/theme';

export default function RegisterScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { sendOtp, register } = useAuth();

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [sendingOtp, setSendingOtp] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [kvkkOk, setKvkkOk] = useState(false);
  const [privacyOk, setPrivacyOk] = useState(false);
  const [membershipOk, setMembershipOk] = useState(false);
  const [marketingOk, setMarketingOk] = useState(false);

  const allRequiredChecked = kvkkOk && privacyOk && membershipOk;

  async function handleSendOtp() {
    setError(null);
    if (!name.trim()) return setError('Lütfen adını gir.');
    if (phone.trim().length < 10) return setError('Geçerli bir telefon numarası gir.');
    if (password.length < 6) return setError('Şifre en az 6 karakter olmalı.');
    setSendingOtp(true);
    try {
      const res = await sendOtp(phone.trim(), 'registration');
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

  async function handleRegister() {
    setError(null);
    if (otpCode.trim().length !== 6) return setError('SMS ile gelen 6 haneli kodu gir.');
    if (!allRequiredChecked) return setError('Devam etmek için zorunlu sözleşmeleri onaylamalısın.');
    setSubmitting(true);
    try {
      await register({
        phone: phone.trim(),
        name: name.trim(),
        password,
        otp_code: otpCode.trim(),
        marketing_consent: marketingOk,
      });
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
        <ThemedText type="subtitle">Kayıt Ol</ThemedText>

        <TextInput
          value={name}
          onChangeText={setName}
          editable={!otpSent}
          placeholder="Ad Soyad"
          placeholderTextColor={theme.textSecondary}
          style={[styles.input, { borderColor: theme.border, color: theme.text, backgroundColor: theme.background }]}
        />
        <TextInput
          value={phone}
          onChangeText={setPhone}
          editable={!otpSent}
          placeholder="05XX XXX XX XX"
          placeholderTextColor={theme.textSecondary}
          keyboardType="phone-pad"
          style={[styles.input, { borderColor: theme.border, color: theme.text, backgroundColor: theme.background }]}
        />
        <TextInput
          value={password}
          onChangeText={setPassword}
          editable={!otpSent}
          placeholder="Şifre (en az 6 karakter)"
          placeholderTextColor={theme.textSecondary}
          secureTextEntry
          style={[styles.input, { borderColor: theme.border, color: theme.text, backgroundColor: theme.background }]}
        />

        {!otpSent ? (
          <Pressable style={[styles.button, { backgroundColor: theme.tint }]} onPress={handleSendOtp} disabled={sendingOtp}>
            {sendingOtp ? <ActivityIndicator color="#fff" /> : (
              <ThemedText style={{ color: '#fff' }} type="smallBold">
                SMS Kodu Gönder
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
              style={[styles.input, { borderColor: theme.border, color: theme.text, backgroundColor: theme.background }]}
            />

            <View style={styles.consents}>
              <CheckboxRow checked={kvkkOk} onToggle={() => setKvkkOk((v) => !v)} required>
                KVKK Aydınlatma Metni'ni okudum, kabul ediyorum.
              </CheckboxRow>
              <CheckboxRow checked={privacyOk} onToggle={() => setPrivacyOk((v) => !v)} required>
                Gizlilik Politikası'nı okudum, kabul ediyorum.
              </CheckboxRow>
              <CheckboxRow checked={membershipOk} onToggle={() => setMembershipOk((v) => !v)} required>
                Üyelik Sözleşmesi'ni okudum, kabul ediyorum.
              </CheckboxRow>
              <CheckboxRow checked={marketingOk} onToggle={() => setMarketingOk((v) => !v)}>
                Kampanya ve fırsatlardan haberdar olmak istiyorum (opsiyonel).
              </CheckboxRow>
            </View>

            <Pressable
              style={[styles.button, { backgroundColor: allRequiredChecked ? theme.tint : theme.border }]}
              onPress={handleRegister}
              disabled={submitting || !allRequiredChecked}
            >
              {submitting ? <ActivityIndicator color="#fff" /> : (
                <ThemedText style={{ color: '#fff' }} type="smallBold">
                  Kayıt Ol
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
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two, fontSize: 16 },
  button: { borderRadius: 999, paddingVertical: Spacing.three, alignItems: 'center', marginTop: Spacing.one },
  consents: { gap: 2, marginTop: Spacing.one },
});
