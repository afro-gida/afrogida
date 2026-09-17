import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';

import { CheckboxRow } from '@/components/checkbox-row';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth-context';
import { ApiError } from '@/lib/api';
import { IconGreen, Spacing } from '@/constants/theme';

const LOGIN_BANNER = require('@/assets/brand/login-banner.jpg');

export default function RegisterScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { sendOtp, register } = useAuth();

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const [sendingOtp, setSendingOtp] = useState(false);
  const [otpRequested, setOtpRequested] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [termsOk, setTermsOk] = useState(false);
  const [notifyOk, setNotifyOk] = useState(false);

  const canSubmit = name.trim() && phone.trim().length >= 10 && otpCode.trim().length === 6 && password.length >= 6 && termsOk;

  async function handleRequestCode() {
    setError(null);
    if (phone.trim().length < 10) return setError('Geçerli bir telefon numarası gir.');
    setSendingOtp(true);
    try {
      const res = await sendOtp(phone.trim(), 'registration');
      setOtpRequested(true);
      if (!res.sms_sent) {
        setError('Not: SMS gönderilemedi (geliştirme ortamı). Kod için bana sor, sunucu kaydından bakayım.');
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Bağlantı hatası. Backend çalışıyor mu?');
    } finally {
      setSendingOtp(false);
    }
  }

  async function handleRegister() {
    setError(null);
    if (!canSubmit) {
      setError('Lütfen tüm alanları doldur ve zorunlu sözleşmeyi onayla.');
      return;
    }
    setSubmitting(true);
    try {
      await register({
        phone: phone.trim(),
        name: name.trim(),
        password,
        otp_code: otpCode.trim(),
        marketing_consent: notifyOk,
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
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.headerSpace}>
          <Image source={LOGIN_BANNER} style={StyleSheet.absoluteFill} resizeMode="cover" />
          <Pressable style={styles.backBtn} onPress={() => router.back()} hitSlop={12}>
            <ThemedText style={styles.backArrow}>←</ThemedText>
          </Pressable>
        </View>

        <View style={[styles.card, { backgroundColor: theme.background }]}>
          <ThemedText type="title" style={styles.title}>
            Yeni Üyelik
          </ThemedText>
          <ThemedText themeColor="textSecondary" style={styles.subtitle}>
            Avantajlardan yararlanmak için hemen üye olun.
          </ThemedText>

          <ThemedText type="small" themeColor="textSecondary" style={styles.label}>
            Ad Soyad
          </ThemedText>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="Ad Soyad"
            placeholderTextColor={theme.textSecondary}
            style={[styles.input, { borderColor: theme.border, color: theme.text, backgroundColor: theme.background }]}
          />

          <ThemedText type="small" themeColor="textSecondary" style={styles.label}>
            Telefon Numarası
          </ThemedText>
          <View style={styles.phoneRow}>
            <TextInput
              value={phone}
              onChangeText={setPhone}
              placeholder="05XX XXX XX XX"
              placeholderTextColor={theme.textSecondary}
              keyboardType="phone-pad"
              style={[styles.input, styles.phoneInput, { borderColor: theme.border, color: theme.text, backgroundColor: theme.background }]}
            />
            <TextInput
              value={otpCode}
              onChangeText={setOtpCode}
              placeholder="6 hane"
              placeholderTextColor={theme.textSecondary}
              keyboardType="number-pad"
              maxLength={6}
              style={[styles.input, styles.otpInput, { borderColor: theme.border, color: theme.text, backgroundColor: theme.background }]}
            />
            <Pressable
              style={[styles.codeBtn, { backgroundColor: theme.tint }]}
              onPress={handleRequestCode}
              disabled={sendingOtp}
            >
              {sendingOtp ? <ActivityIndicator color="#fff" size="small" /> : (
                <ThemedText type="small" style={{ color: '#fff', fontWeight: '700' }}>
                  {otpRequested ? 'Tekrar Gönder' : 'Kod İste'}
                </ThemedText>
              )}
            </Pressable>
          </View>

          <ThemedText type="small" themeColor="textSecondary" style={styles.label}>
            Şifre
          </ThemedText>
          <View style={styles.passwordWrap}>
            <TextInput
              value={password}
              onChangeText={setPassword}
              placeholder="En az 6 karakter"
              placeholderTextColor={theme.textSecondary}
              secureTextEntry={!showPassword}
              style={[styles.input, { borderColor: theme.border, color: theme.text, backgroundColor: theme.background }]}
            />
            <Pressable style={styles.eyeBtn} onPress={() => setShowPassword((v) => !v)}>
              <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={27} color={IconGreen} />
            </Pressable>
          </View>

          <ThemedText type="small" themeColor="textSecondary" style={styles.kvkkLine}>
            Kişisel verileriniz hakkında{' '}
            <ThemedText type="small" themeColor="tint" style={styles.linkText}>
              KVKK Aydınlatma Metni
            </ThemedText>
            'ni inceleyebilirsiniz.
          </ThemedText>

          <CheckboxRow checked={termsOk} onToggle={() => setTermsOk((v) => !v)} required>
            <ThemedText type="small" themeColor="tint" style={styles.linkText}>
              Gizlilik Politikası
            </ThemedText>
            'nı ve{' '}
            <ThemedText type="small" themeColor="tint" style={styles.linkText}>
              Üyelik Sözleşmesi
            </ThemedText>
            'ni okudum, onaylıyorum.
          </CheckboxRow>

          <CheckboxRow checked={notifyOk} onToggle={() => setNotifyOk((v) => !v)}>
            Kampanya, duyuru ve fırsatlardan haberdar olmak için uygulama bildirimi almak istiyorum. (İsteğe bağlı)
          </CheckboxRow>

          {error && (
            <ThemedText themeColor="danger" type="small" style={styles.error}>
              {error}
            </ThemedText>
          )}

          <Pressable
            style={[styles.submitBtn, { backgroundColor: canSubmit ? theme.tint : theme.border }]}
            onPress={handleRegister}
            disabled={submitting || !canSubmit}
          >
            {submitting ? <ActivityIndicator color="#fff" /> : (
              <ThemedText style={{ color: '#fff' }} type="smallBold">
                Üye Ol
              </ThemedText>
            )}
          </Pressable>

          <Pressable onPress={() => router.replace('/giris')} style={styles.loginLink}>
            <ThemedText themeColor="textSecondary" type="small">
              Zaten üye misiniz? <ThemedText themeColor="tint" type="smallBold">Giriş Yapın</ThemedText>
            </ThemedText>
          </Pressable>
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 1 },
  headerSpace: { height: 190, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  backBtn: { position: 'absolute', top: Spacing.two, left: Spacing.three, zIndex: 1, padding: Spacing.one },
  backArrow: { fontSize: 22 },
  card: { flex: 1, borderTopLeftRadius: 24, borderTopRightRadius: 24, marginTop: -24, padding: Spacing.three, gap: 6 },
  title: { fontSize: 26, lineHeight: 30 },
  subtitle: { marginBottom: Spacing.two },
  label: { marginTop: Spacing.two, marginBottom: 2 },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two, fontSize: 16, minWidth: 0 },
  phoneRow: { flexDirection: 'row', gap: Spacing.one, alignItems: 'stretch' },
  phoneInput: { flex: 2, minWidth: 0 },
  otpInput: { flex: 1, minWidth: 0, textAlign: 'center', paddingHorizontal: Spacing.one },
  codeBtn: { borderRadius: 12, paddingHorizontal: Spacing.two, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  passwordWrap: { justifyContent: 'center' },
  eyeBtn: { position: 'absolute', right: Spacing.three },
  kvkkLine: { marginTop: Spacing.two },
  linkText: { textDecorationLine: 'underline', fontWeight: '700' },
  error: { marginTop: Spacing.one },
  submitBtn: { borderRadius: 999, paddingVertical: Spacing.three, alignItems: 'center', marginTop: Spacing.two },
  loginLink: { alignItems: 'center', paddingVertical: Spacing.two },
});
