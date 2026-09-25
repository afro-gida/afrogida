import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';

import { PrimaryButton } from '@/components/form-card';
import { FormField, Notice } from '@/components/form-field';
import { PageHeader } from '@/components/page-header';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/lib/auth-context';
import { submitComplaint } from '@/lib/complaints';
import { CARD_BG, SCRIM, surface } from '@/constants/surfaces';
import { Spacing, withAlpha } from '@/constants/theme';

const MAX_LEN = 1000;

export default function ComplaintScreen() {
  const isDark = useColorScheme() === 'dark';
  const cardBg = isDark ? CARD_BG.dark : CARD_BG.light;
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
    <Screen edges={['top', 'bottom']}>
      <View style={[styles.flex, { backgroundColor: isDark ? SCRIM.dark : SCRIM.light }]}>
        <PageHeader title="Şikayet ve Öneri" />
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={[surface.card, surface.shadow, styles.card, { backgroundColor: cardBg }]}>
            {!user ? (
              <>
                <Icon name="lock-outline" />
                <ThemedText style={styles.title}>Giriş yapmalısın</ThemedText>
                <ThemedText themeColor="textSecondary" style={styles.text}>
                  Şikayet veya önerini gönderebilmek için giriş yapmalısın.
                </ThemedText>
                <PrimaryButton label="Giriş Yap" onPress={() => router.push('/giris')} />
              </>
            ) : sent ? (
              <>
                <Icon name="check-decagram" />
                <ThemedText style={styles.title}>Mesajın iletildi</ThemedText>
                <ThemedText themeColor="textSecondary" style={styles.text}>
                  Şikayet ve önerin ekibimize ulaştı, en kısa sürede değerlendireceğiz.
                </ThemedText>
                <PrimaryButton label="Yeni Mesaj Gönder" arrow={false} onPress={() => setSent(false)} />
              </>
            ) : (
              <>
                <Icon name="message-text-outline" />
                <ThemedText style={styles.title}>Seni dinliyoruz</ThemedText>
                <ThemedText themeColor="textSecondary" style={styles.text}>
                  Bir sorun mu yaşadın, yoksa bize bir önerin mi var? Aşağıya yazabilirsin.
                </ThemedText>
                <View style={styles.formGap}>
                  <FormField
                    value={message}
                    onChangeText={(v) => setMessage(v.slice(0, MAX_LEN))}
                    placeholder="Mesajını buraya yaz..."
                    multiline
                    multilineHeight={170}
                  />
                  <ThemedText themeColor="textSecondary" style={styles.counter}>{message.length}/{MAX_LEN}</ThemedText>
                </View>
                {error && <Notice text={error} />}
                <PrimaryButton label="Gönder" onPress={handleSubmit} loading={submitting} disabled={!message.trim()} />
              </>
            )}
          </View>
        </ScrollView>
      </View>
    </Screen>
  );
}

function Icon({ name }: { name: keyof typeof MaterialCommunityIcons.glyphMap }) {
  const theme = useTheme();
  return (
    <View style={[surface.iconCircleLg, { backgroundColor: withAlpha(theme.tint, 0.14) }]}>
      <MaterialCommunityIcons name={name} size={30} color={theme.tint} />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scroll: { paddingHorizontal: Spacing.three, paddingTop: Spacing.two, paddingBottom: Spacing.five },
  card: { paddingHorizontal: Spacing.four, paddingVertical: Spacing.four, gap: Spacing.two },
  title: { fontSize: 22, lineHeight: 27, fontWeight: '900', letterSpacing: -0.4, marginTop: Spacing.one },
  text: { fontSize: 14, lineHeight: 19, marginBottom: Spacing.one },
  formGap: { gap: 4 },
  counter: { alignSelf: 'flex-end', fontSize: 11.5, lineHeight: 14, marginRight: 4 },
});
