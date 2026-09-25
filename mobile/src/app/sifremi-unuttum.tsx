import { useState } from 'react';
import { useRouter } from 'expo-router';

import { FormCardScreen, PrimaryButton, Steps } from '@/components/form-card';
import { FormField, Notice, PasswordField } from '@/components/form-field';
import { useAuth } from '@/lib/auth-context';
import { ApiError } from '@/lib/api';

export default function ForgotPasswordScreen() {
  const router = useRouter();
  const { sendOtp, resetPassword } = useAuth();

  const [phone, setPhone] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [sendingOtp, setSendingOtp] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function handleSendOtp() {
    setError(null);
    setInfo(null);
    if (phone.trim().length < 10) return setError('Geçerli bir telefon numarası gir.');
    setSendingOtp(true);
    try {
      const res = await sendOtp(phone.trim(), 'password_reset');
      setOtpSent(true);
      setInfo(
        res.sms_sent
          ? 'Doğrulama kodu SMS ile gönderildi.'
          : 'Not: SMS gönderilemedi (geliştirme ortamı) — kodu backend/run_dev_server.py terminalindeki logdan oku.',
      );
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
      <FormCardScreen icon="check-decagram" title="Şifren güncellendi" subtitle="Yeni şifrenle giriş yapabilirsin.">
        <PrimaryButton label="Giriş Yap" onPress={() => router.replace('/giris')} />
      </FormCardScreen>
    );
  }

  return (
    <FormCardScreen icon="lock-reset" title="Şifreni yenile" subtitle="Telefon numarana SMS ile doğrulama kodu göndereceğiz.">
      <Steps labels={['Telefon', 'Yeni şifre']} current={otpSent ? 1 : 0} />

      <FormField
        label="Telefon numarası"
        icon="phone-outline"
        value={phone}
        onChangeText={setPhone}
        editable={!otpSent}
        placeholder="05XX XXX XX XX"
        keyboardType="phone-pad"
        autoComplete="off"
        maxLength={14}
      />

      {!otpSent ? (
        <PrimaryButton label="Kod Gönder" onPress={handleSendOtp} loading={sendingOtp} />
      ) : (
        <>
          <FormField
            label="Doğrulama kodu"
            icon="message-lock-outline"
            value={otpCode}
            onChangeText={setOtpCode}
            placeholder="SMS ile gelen 6 haneli kod"
            keyboardType="number-pad"
            maxLength={6}
            autoComplete="off"
          />
          <PasswordField label="Yeni şifre" value={newPassword} onChangeText={setNewPassword} placeholder="En az 6 karakter" autoComplete="off" />
          <PrimaryButton label="Şifreyi Güncelle" onPress={handleReset} loading={submitting} />
        </>
      )}

      {info && !error && <Notice text={info} tone="info" />}
      {error && <Notice text={error} />}
    </FormCardScreen>
  );
}
