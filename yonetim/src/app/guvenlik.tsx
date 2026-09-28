import { Redirect, useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { QrCode } from '@/components/qr';
import { Button, Card, ErrorBox, Field, Notice, T } from '@/components/ui';
import { api, errMsg } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useTheme } from '@/lib/theme';

/**
 * Authenticator kurulumu (zorunlu). İlk girişi SMS koduyla yapan yönetici,
 * panelin geri kalanını kullanmadan önce buradan authenticator'ı etkinleştirir.
 * Etkinleştikten sonra buradan değiştirilemez — sadece sunucuda sıfırlanır.
 */
export default function SecuritySetup() {
  const t = useTheme();
  const router = useRouter();
  const { token, user, refreshStatus, signOut } = useSession();
  const [setup, setSetup] = useState<{ secret: string; otpauth_uri: string } | null>(null);
  const [code, setCode] = useState('');
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!token) return <Redirect href="/giris" />;

  async function start() {
    setError(null);
    setBusy(true);
    try {
      setSetup(await api.post('/admin/2fa/totp/setup'));
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    setError(null);
    setBusy(true);
    try {
      const res = await api.post<{ backup_codes: string[] }>('/admin/2fa/totp/confirm', { code: code.trim() });
      setBackupCodes(res.backup_codes);
      setSetup(null);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  async function finish() {
    await refreshStatus();
    router.replace('/');
  }

  const alreadyOn = user?.totp_enabled && !backupCodes;

  return (
    <ScrollView style={{ backgroundColor: t.bg }} contentContainerStyle={styles.center}>
      <Card style={styles.card}>
        <T size={20} bold>Authenticator doğrulaması</T>

        {alreadyOn ? (
          <>
            <Notice text={`Authenticator etkin. Kalan yedek kod: ${user?.backup_codes_left ?? 0}.`} />
            <T muted>Telefonunuzu değiştirirseniz veya kaybederseniz sıfırlama yalnızca sunucuda yapılabilir (güvenlik gereği).</T>
            <Button label="Panele dön" onPress={() => router.replace('/')} />
          </>
        ) : backupCodes ? (
          <>
            <Notice text="Authenticator etkinleştirildi." />
            <T bold>Yedek kodlarınız (her biri bir kez kullanılır):</T>
            <View style={[styles.codes, { borderColor: t.border, backgroundColor: t.input }]}>
              {backupCodes.map((c) => (
                <T key={c} size={16} bold style={styles.mono}>{c}</T>
              ))}
            </View>
            <T muted>
              Bu kodlar bir daha gösterilmez. Kâğıda yazıp güvenli bir yerde saklayın (telefonda / bilgisayarda saklamayın).
              Telefonunuz kaybolursa girişte "Yedek kod kullan" ile bunlardan birini girersiniz.
            </T>
            <Button kind={saved ? 'primary' : 'secondary'} label={saved ? 'Kaydettim ✓' : 'Kodları güvenli yere yazdım'} onPress={() => setSaved(true)} />
            <Button label="Panele geç" onPress={finish} disabled={!saved} />
          </>
        ) : !setup ? (
          <>
            <T>
              Panele girmeden önce telefonunuza bir authenticator uygulaması kurun (Google Authenticator, Microsoft
              Authenticator veya iPhone'da Ayarlar › Parolalar). Bundan sonra her girişte SMS yerine bu uygulamadaki
              6 haneli kod istenecek — SMS'ten çok daha güvenlidir.
            </T>
            {error && <ErrorBox text={error} />}
            <Button label="Kurulumu başlat" onPress={start} loading={busy} />
            <Button kind="secondary" small label="Çıkış yap" onPress={() => signOut()} />
          </>
        ) : (
          <>
            <T>1. Authenticator uygulamasında "+" › "QR kodu tara" ile aşağıdaki kodu okutun.</T>
            <View style={styles.qrWrap}>
              <QrCode value={setup.otpauth_uri} />
            </View>
            <T muted size={12.5}>QR okutamıyorsanız anahtarı elle girin:</T>
            <T bold style={styles.mono} size={13}>{setup.secret.replace(/(.{4})/g, '$1 ').trim()}</T>
            <T>2. Uygulamada görünen 6 haneli kodu girin:</T>
            <Field label="Kod" value={code} onChangeText={setCode} keyboardType="number-pad" maxLength={6} onSubmitEditing={confirm} />
            {error && <ErrorBox text={error} />}
            <Button label="Doğrula ve etkinleştir" onPress={confirm} loading={busy} />
          </>
        )}
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 20 },
  card: { width: '100%', maxWidth: 480, gap: 14, padding: 22 },
  qrWrap: { alignItems: 'center', paddingVertical: 6 },
  codes: { flexDirection: 'row', flexWrap: 'wrap', gap: 14, borderWidth: 1, borderRadius: 10, padding: 14, justifyContent: 'center' },
  mono: { fontFamily: 'monospace', letterSpacing: 1 },
});
