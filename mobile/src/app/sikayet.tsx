import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';

import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/lib/auth-context';
import { submitComplaint } from '@/lib/complaints';
import { IconGreen, Spacing } from '@/constants/theme';

export default function ComplaintScreen() {
  const theme = useTheme();
  const scheme = useColorScheme();
  const router = useRouter();
  const { user } = useAuth();
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function handleSubmit() {
    if (!message.trim()) {
      setError('Lütfen bir mesaj yaz.');
      return;
    }
    setError(null);
    setSubmitting(true);
    const res = await submitComplaint(message);
    setSubmitting(false);
    if ('error' in res) {
      setError(res.error);
      return;
    }
    setSent(true);
    setMessage('');
  }

  return (
    <Screen edges={['bottom']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.backBtn}>
          <ThemedText style={styles.backArrow}>←</ThemedText>
        </Pressable>
        <ThemedText type="subtitle">Şikayet ve Öneri</ThemedText>
      </View>

      {!user ? (
        <View style={[styles.card, { backgroundColor: theme.tintSoft }]}>
          <ThemedText type="smallBold">Giriş yapmadın</ThemedText>
          <ThemedText themeColor="textSecondary" type="small" style={{ marginTop: 4, marginBottom: Spacing.one }}>
            Şikayet veya önerini gönderebilmek için giriş yapmalısın.
          </ThemedText>
          <Pressable style={[styles.sendBtn, { backgroundColor: theme.tint }]} onPress={() => router.push('/giris')}>
            <ThemedText style={{ color: '#fff' }} type="smallBold">Giriş Yap</ThemedText>
          </Pressable>
        </View>
      ) : sent ? (
        <View style={[styles.card, { backgroundColor: theme.tintSoft, alignItems: 'center', gap: Spacing.one }]}>
          <Ionicons name="checkmark-circle" size={40} color={IconGreen} />
          <ThemedText type="smallBold">Mesajın iletildi</ThemedText>
          <ThemedText themeColor="textSecondary" type="small" style={{ textAlign: 'center' }}>
            Şikayet ve önerin ekibimize ulaştı, en kısa sürede değerlendireceğiz.
          </ThemedText>
          <Pressable style={[styles.sendBtn, { backgroundColor: theme.tint, marginTop: Spacing.one }]} onPress={() => setSent(false)}>
            <ThemedText style={{ color: '#fff' }} type="smallBold">Yeni Mesaj Gönder</ThemedText>
          </Pressable>
        </View>
      ) : (
        <View style={styles.card}>
          <ThemedText themeColor="textSecondary" type="small" style={{ marginBottom: Spacing.two }}>
            Bir sorun mu yaşadın, yoksa bize bir önerin mi var? Aşağıya yazabilirsin.
          </ThemedText>
          <TextInput
            value={message}
            onChangeText={setMessage}
            placeholder="Mesajını buraya yaz..."
            placeholderTextColor={theme.textSecondary}
            multiline
            style={[
              styles.input,
              { borderColor: theme.border, color: theme.text, backgroundColor: scheme === 'dark' ? 'rgba(0,0,0,0.25)' : 'rgba(255,255,255,0.6)' },
            ]}
          />
          {error && (
            <ThemedText themeColor="danger" type="small" style={{ marginTop: Spacing.one }}>
              {error}
            </ThemedText>
          )}
          <Pressable style={[styles.sendBtn, { backgroundColor: theme.tint, marginTop: Spacing.two }]} onPress={handleSubmit} disabled={submitting}>
            {submitting ? <ActivityIndicator color="#fff" /> : (
              <ThemedText style={{ color: '#fff' }} type="smallBold">Gönder</ThemedText>
            )}
          </Pressable>
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, padding: Spacing.three },
  backBtn: { padding: Spacing.one },
  backArrow: { fontSize: 20 },
  card: { marginHorizontal: Spacing.three, borderRadius: 16, padding: Spacing.three },
  input: { borderWidth: 1, borderRadius: 12, padding: Spacing.two, minHeight: 140, textAlignVertical: 'top', fontSize: 14 },
  sendBtn: { borderRadius: 999, paddingVertical: Spacing.two + 2, alignItems: 'center' },
});
