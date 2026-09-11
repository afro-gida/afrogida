import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { Spacing } from '@/constants/theme';

export default function LoginScreen() {
  const theme = useTheme();
  const [phone, setPhone] = useState('');

  return (
    <Screen edges={['bottom']}>
      <View style={[styles.body, { backgroundColor: theme.backgroundElement }]}>
        <ThemedText type="subtitle">Telefonla Giriş</ThemedText>
        <ThemedText themeColor="textSecondary" style={styles.hint}>
          Telefon numarana SMS ile 6 haneli bir kod göndereceğiz.
        </ThemedText>

        <TextInput
          value={phone}
          onChangeText={setPhone}
          placeholder="05XX XXX XX XX"
          placeholderTextColor={theme.textSecondary}
          keyboardType="phone-pad"
          style={[styles.input, { borderColor: theme.border, color: theme.text, backgroundColor: theme.background }]}
        />

        <Pressable style={[styles.button, { backgroundColor: theme.tint }]}>
          <ThemedText style={{ color: '#fff' }} type="smallBold">
            Kod Gönder
          </ThemedText>
        </Pressable>

        <View style={[styles.noticeBox, { backgroundColor: theme.tintSoft }]}>
          <ThemedText type="small" themeColor="textSecondary">
            Not: Bu ekran henüz gerçek SMS gönderimine bağlı değil — geliştirme
            ortamı gerçek Verimor SMS anahtarlarını kullandığı için, bu bağlantı
            kasıtlı olarak sona ertelendi.
          </ThemedText>
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { margin: Spacing.three, borderRadius: 16, padding: Spacing.three, gap: Spacing.two },
  hint: { marginBottom: Spacing.two },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two, fontSize: 16 },
  button: { borderRadius: 999, paddingVertical: Spacing.three, alignItems: 'center', marginTop: Spacing.one },
  noticeBox: { borderRadius: 10, padding: Spacing.two, marginTop: Spacing.four },
});
