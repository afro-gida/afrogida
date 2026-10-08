import { Ionicons } from '@expo/vector-icons';
import { useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';

import { AuthLayout } from '@/components/auth-layout';
import { CheckboxRow } from '@/components/checkbox-row';
import { FormField, Notice, PasswordField } from '@/components/form-field';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth-context';
import { ApiError } from '@/lib/api';
import { surface } from '@/constants/surfaces';
import { Spacing, withAlpha } from '@/constants/theme';
import { openLegal } from '@/lib/legal';
import { Turnstile, TURNSTILE_ON } from '@/components/turnstile';

// Sunucudaki core/text.py::normalize_email ile aynı kural.
const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;

export default function RegisterScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { sendOtp, register } = useAuth();

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [password, setPassword] = useState('');

  const [sendingOtp, setSendingOtp] = useState(false);
  const [otpRequested, setOtpRequested] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  // Robot doğrulaması: kutu "Kod İste"ye basınca açılır, geçilince kod kendiliğinden
  // gönderilir ve kutu kapanır. Her SMS için yeni doğrulama (token tek kullanımlık).
  const [showCaptcha, setShowCaptcha] = useState(false);
  const sendAfterCaptcha = useRef(false);

  const [termsOk, setTermsOk] = useState(false);
  const [notifyOk, setNotifyOk] = useState(false);

  // Telefon (SMS doğrulamalı) ve e-posta ikisi de zorunlu — e-Arşiv fatura e-postaya gider.
  const emailOk = EMAIL_RE.test(email.trim());
  const canSubmit = name.trim() && phone.trim().length >= 10 && emailOk && otpCode.trim().length === 6 && password.length >= 6 && termsOk;

  async function handleRequestCode(captcha?: string) {
    setError(null);
    setInfo(null);
    if (phone.trim().length < 10) return setError('Geçerli bir telefon numarası gir.');
    if (TURNSTILE_ON && !captcha) {
      sendAfterCaptcha.current = true;
      setShowCaptcha(true);
      return setInfo('Robot doğrulaması yapılıyor. Kutu onaylanınca kod kendiliğinden gönderilecek.');
    }
    setSendingOtp(true);
    try {
      const res = await sendOtp(phone.trim(), 'registration', captcha);
      setOtpRequested(true);
      setInfo(
        res.sms_sent
          ? 'Doğrulama kodu SMS ile gönderildi.'
          : 'Not: SMS gönderilemedi (geliştirme ortamı). Kod için bana sor, sunucu kaydından bakayım.',
      );
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Bağlantı hatası. Backend çalışıyor mu?');
    } finally {
      setSendingOtp(false);
      // Token tek kullanımlık: tekrar gönderimde kutu yeniden açılır
      setShowCaptcha(false);
    }
  }

  function onCaptcha(token: string | null) {
    if (token && sendAfterCaptcha.current) {
      sendAfterCaptcha.current = false;
      handleRequestCode(token);
    }
  }

  async function handleRegister() {
    setError(null);
    if (!emailOk) {
      setError('Geçerli bir e-posta adresi gir (faturan bu adrese gönderilir).');
      return;
    }
    if (!canSubmit) {
      setError('Lütfen tüm alanları doldur ve zorunlu sözleşmeyi onayla.');
      return;
    }
    setSubmitting(true);
    try {
      await register({
        phone: phone.trim(),
        email: email.trim().toLowerCase(),
        name: name.trim(),
        password,
        otp_code: otpCode.trim(),
        marketing_consent: notifyOk,
      });
      if (router.canGoBack()) router.back();
      else router.replace('/');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Bağlantı hatası. Backend çalışıyor mu?');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout
      title="Yeni üyelik"
      subtitle="Avantajlardan yararlanmak için hemen üye ol."
      backIcon="arrow-back"
      onBack={() => (router.canGoBack() ? router.back() : router.replace('/'))}
    >
      <FormField label="Ad soyad" icon="account-outline" value={name} onChangeText={setName} placeholder="Ad Soyad" autoComplete="off" />

      {/* Telefon + doğrulama kodu yan yana; "Kod İste" telefon kutusunun içinde */}
      <View style={styles.phoneRow}>
        <View style={styles.phoneCol}>
          <FormField
            label="Telefon numarası"
            value={phone}
            onChangeText={setPhone}
            placeholder="05XX XXX XX XX"
            keyboardType="phone-pad"
            autoComplete="off"
            maxLength={14}
            right={
              <Pressable
                onPress={() => handleRequestCode()}
                disabled={sendingOtp || showCaptcha}
                style={({ pressed }) => [styles.codeBtn, { backgroundColor: theme.tint, opacity: pressed || sendingOtp || showCaptcha ? 0.85 : 1 }]}
              >
                {sendingOtp ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <ThemedText style={styles.codeBtnText}>{otpRequested ? 'Tekrar' : 'Kod İste'}</ThemedText>
                )}
              </Pressable>
            }
          />
        </View>
        <View style={styles.codeCol}>
          <FormField
            label="SMS kodu"
            value={otpCode}
            onChangeText={setOtpCode}
            placeholder="6 haneli"
            keyboardType="number-pad"
            maxLength={6}
            // Tarayıcı kayıtlı telefon/şifreyi buraya doldurmasın; telefonda SMS kodu önerilsin.
            autoComplete="one-time-code"
            textContentType="oneTimeCode"
          />
        </View>
      </View>

      {showCaptcha && <Turnstile onToken={onCaptcha} />}

      <View>
        <FormField
          label="E-posta"
          icon="email-outline"
          value={email}
          onChangeText={setEmail}
          placeholder="ornek@eposta.com"
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="email"
          maxLength={254}
        />
        <ThemedText themeColor="textSecondary" style={styles.emailNote}>
          E-posta adresin sadece e-Arşiv faturanı göndermek için kullanılır, başka hiçbir amaçla kullanılmaz.
        </ThemedText>
      </View>

      <PasswordField label="Şifre" value={password} onChangeText={setPassword} placeholder="En az 6 karakter" autoComplete="new-password" />

      <View style={[styles.consents, { backgroundColor: withAlpha(theme.text, 0.04) }]}>
        <ThemedText themeColor="textSecondary" style={styles.kvkk}>
          Kişisel verilerin hakkında{' '}
          <ThemedText style={[styles.kvkk, styles.link, { color: theme.tint }]} onPress={() => openLegal('kvkk')} accessibilityRole="link">KVKK Aydınlatma Metni</ThemedText>
          'ni inceleyebilirsin.
        </ThemedText>
        <CheckboxRow checked={termsOk} onToggle={() => setTermsOk((v) => !v)} required>
          <ThemedText type="small" style={[styles.link, { color: theme.tint }]} onPress={() => openLegal('privacy')} accessibilityRole="link">Gizlilik Politikası</ThemedText>
          'nı ve{' '}
          <ThemedText type="small" style={[styles.link, { color: theme.tint }]} onPress={() => openLegal('membership')} accessibilityRole="link">Üyelik Sözleşmesi</ThemedText>
          'ni okudum, onaylıyorum.
        </CheckboxRow>
        <CheckboxRow checked={notifyOk} onToggle={() => setNotifyOk((v) => !v)}>
          Kampanya, duyuru ve fırsatlardan haberdar olmak için bildirim almak istiyorum. (İsteğe bağlı)
        </CheckboxRow>
      </View>

      {info && !error && <Notice text={info} tone="info" />}
      {error && <Notice text={error} />}

      <Pressable
        style={({ pressed }) => [
          surface.primaryBtn,
          { backgroundColor: canSubmit ? theme.tint : withAlpha(theme.tint, 0.35), opacity: pressed ? 0.88 : 1 },
        ]}
        onPress={handleRegister}
        disabled={submitting || !canSubmit}
      >
        {submitting ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <>
            <ThemedText style={surface.primaryBtnText}>Üye Ol</ThemedText>
            <Ionicons name="arrow-forward" size={18} color="#fff" />
          </>
        )}
      </Pressable>

      <Pressable onPress={() => router.replace('/giris')} style={styles.loginLink} hitSlop={6}>
        <ThemedText themeColor="textSecondary" style={styles.loginText}>
          Zaten üye misin? <ThemedText style={[styles.loginText, { color: theme.tint, fontWeight: '900' }]}>Giriş yap</ThemedText>
        </ThemedText>
      </Pressable>
    </AuthLayout>
  );
}

const styles = StyleSheet.create({
  phoneRow: { flexDirection: 'row', gap: Spacing.two },
  phoneCol: { flex: 1.85, minWidth: 0 },
  codeCol: { flex: 1, minWidth: 0 },
  emailNote: { fontSize: 12, lineHeight: 16, marginTop: 6, paddingHorizontal: 4 },
  codeBtn: { borderRadius: 999, height: 32, paddingHorizontal: 9, alignItems: 'center', justifyContent: 'center', marginRight: -8 },
  codeBtnText: { color: '#fff', fontSize: 12.5, lineHeight: 16, fontWeight: '900' },
  consents: { borderRadius: 16, padding: Spacing.three - 2, gap: 2 },
  kvkk: { fontSize: 13, lineHeight: 18, marginBottom: 4 },
  link: { fontWeight: '800', textDecorationLine: 'underline' },
  loginLink: { alignItems: 'center', paddingVertical: Spacing.one },
  loginText: { fontSize: 14, lineHeight: 18 },
});
