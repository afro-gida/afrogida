import { Redirect } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';

import { Button, Card, ErrorBox, Field, Notice, T } from '@/components/ui';
import { api, errMsg } from '@/lib/api';
import { useSession, type AdminUser } from '@/lib/session';
import { useTheme } from '@/lib/theme';

type Challenge = { challenge_id: string; method?: 'totp' | string; message?: string };

/** Yönetici girişi: kullanıcı adı + şifre, ardından authenticator kodu
 *  (yedek: tek kullanımlık yedek kod veya SMS). */
export default function Login() {
  const t = useTheme();
  const { token, user, signIn, lastLogoutReason } = useSession();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [code, setCode] = useState('');
  const [useBackup, setUseBackup] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  if (token && user) return <Redirect href="/" />;

  async function submitPassword() {
    setError(null);
    setInfo(null);
    if (!username.trim() || !password) return setError('Kullanıcı adı ve şifre girin.');
    setBusy(true);
    try {
      const res = await api.post<Challenge & { requires_2fa?: boolean }>('/auth/admin', { username: username.trim(), password });
      setChallenge(res);
      setCode('');
      setUseBackup(false);
      setInfo(res.message ?? null);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
      setPassword('');
    }
  }

  async function submitCode() {
    if (!challenge) return;
    setError(null);
    setBusy(true);
    try {
      const res = await api.post<{ token: string; user: AdminUser }>('/auth/admin/verify-2fa', { challenge_id: challenge.challenge_id, code: code.trim() });
      signIn(res.token, res.user);
    } catch (e) {
      setError(errMsg(e));
      if (e instanceof Error && /tekrar giriş/i.test(e.message)) setChallenge(null);
    } finally {
      setBusy(false);
    }
  }

  async function sendSms() {
    if (!challenge) return;
    setError(null);
    setBusy(true);
    try {
      const res = await api.post<Challenge>('/auth/admin/2fa/sms', { challenge_id: challenge.challenge_id });
      setChallenge({ ...res, method: 'sms' });
      setCode('');
      setUseBackup(false);
      setInfo(res.message ?? 'SMS kodu gönderildi.');
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  const isTotp = challenge?.method === 'totp';

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={[styles.flex, { backgroundColor: t.bg }]}>
      <ScrollView contentContainerStyle={styles.center} keyboardShouldPersistTaps="handled">
        <Card style={styles.card}>
          <View style={{ gap: 4 }}>
            <T size={22} bold>Afro Gıda Yönetim</T>
            <T muted>Sadece sistem sahibi içindir. Tüm girişler kaydedilir.</T>
          </View>

          {!!lastLogoutReason && !challenge && <Notice tone="warn" text={lastLogoutReason} />}

          {!challenge ? (
            <>
              <Field label="Kullanıcı adı" value={username} onChangeText={setUsername} autoCapitalize="none" autoCorrect={false} autoComplete="username" />
              <Field
                label="Şifre"
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                autoComplete="current-password"
                onSubmitEditing={submitPassword}
              />
              {error && <ErrorBox text={error} />}
              <Button label="Devam" onPress={submitPassword} loading={busy} />
            </>
          ) : (
            <>
              {!!info && <Notice text={info} />}
              <Field
                label={isTotp ? (useBackup ? 'Yedek kod (ABCD-EFGH)' : 'Authenticator kodu (6 hane)') : 'SMS kodu (6 hane)'}
                value={code}
                onChangeText={setCode}
                autoFocus
                autoCapitalize="characters"
                keyboardType={useBackup ? 'default' : 'number-pad'}
                maxLength={useBackup ? 12 : 6}
                onSubmitEditing={submitCode}
              />
              {error && <ErrorBox text={error} />}
              <Button label="Giriş yap" onPress={submitCode} loading={busy} />
              {isTotp && (
                <View style={styles.links}>
                  <Button kind="ghost" small label={useBackup ? 'Authenticator kodu gir' : 'Yedek kod kullan'} onPress={() => { setUseBackup(!useBackup); setCode(''); }} />
                  <Button kind="ghost" small label="SMS ile kod gönder" onPress={sendSms} />
                </View>
              )}
              <Button kind="secondary" small label="Geri" onPress={() => { setChallenge(null); setError(null); setInfo(null); }} />
            </>
          )}
        </Card>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 20 },
  card: { width: '100%', maxWidth: 420, gap: 14, padding: 22 },
  links: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
});
