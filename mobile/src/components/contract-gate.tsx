import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { PrimaryButton } from '@/components/form-card';
import { ThemedText } from '@/components/themed-text';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth-context';
import { SHEET_BG, surface } from '@/constants/surfaces';
import { Spacing, withAlpha } from '@/constants/theme';
import { openPdf } from '@/lib/legal';

/**
 * Giriş sonrası, kullanıcının henüz onaylamadığı (veya sürümü güncellenmiş)
 * sözleşmeler varsa uygulamayı kullanmadan önce onaylatır (backend
 * /api/contracts/pending + /api/contracts/accept — "login gate").
 */
export function ContractGate() {
  const theme = useTheme();
  const isDark = useColorScheme() === 'dark';
  const { pendingContracts, acceptContract } = useAuth();
  const [submitting, setSubmitting] = useState(false);

  if (pendingContracts.length === 0) return null;

  async function handleAcceptAll() {
    setSubmitting(true);
    try {
      for (const c of pendingContracts) {
        await acceptContract(c.document_code, c.version);
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal transparent animationType="fade">
      <View style={styles.backdrop}>
        <View style={[styles.card, surface.shadow, { backgroundColor: isDark ? SHEET_BG.dark : SHEET_BG.light }]}>
          <View style={[surface.iconCircleLg, { backgroundColor: withAlpha(theme.tint, 0.14) }]}>
            <MaterialCommunityIcons name="file-document-check-outline" size={30} color={theme.tint} />
          </View>
          <ThemedText style={styles.title}>Güncel sözleşmeler</ThemedText>
          <ThemedText themeColor="textSecondary" style={styles.hint}>
            Devam etmeden önce aşağıdaki güncel sözleşmeleri onaylaman gerekiyor.
          </ThemedText>
          <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
            {pendingContracts.map((c) => (
              // Dokununca sözleşmenin PDF'i açılır (okumadan onaylatmayalım)
              <Pressable
                key={c.document_code}
                onPress={() => c.pdf_url && openPdf(c.pdf_url)}
                disabled={!c.pdf_url}
                accessibilityRole="link"
                style={({ pressed }) => [styles.item, { backgroundColor: withAlpha(theme.text, pressed ? 0.1 : 0.05) }]}
              >
                <MaterialCommunityIcons name="file-document-outline" size={20} color={theme.tint} />
                <View style={{ flex: 1 }}>
                  <ThemedText style={styles.itemName}>{c.name}</ThemedText>
                  {!!c.pdf_url && <ThemedText style={[styles.versionText, { color: theme.tint }]}>Okumak için dokun</ThemedText>}
                </View>
                <View style={[styles.versionPill, { backgroundColor: withAlpha(theme.tint, 0.14) }]}>
                  <ThemedText style={[styles.versionText, { color: theme.tint }]}>v{c.version}</ThemedText>
                </View>
              </Pressable>
            ))}
          </ScrollView>
          <PrimaryButton label="Hepsini Onayla ve Devam Et" arrow={false} onPress={handleAcceptAll} loading={submitting} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center', padding: Spacing.three },
  card: { width: '100%', maxWidth: 420, borderRadius: 26, padding: Spacing.four, gap: Spacing.two },
  title: { fontSize: 22, lineHeight: 27, fontWeight: '900', letterSpacing: -0.4, marginTop: Spacing.one },
  hint: { fontSize: 14, lineHeight: 19 },
  list: { maxHeight: 240, marginVertical: Spacing.one },
  listContent: { gap: Spacing.two },
  item: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two + 2, borderRadius: 16, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two + 4 },
  itemName: { flex: 1, fontSize: 14.5, lineHeight: 19, fontWeight: '800' },
  versionPill: { borderRadius: 999, paddingHorizontal: Spacing.two, paddingVertical: 3 },
  versionText: { fontSize: 11.5, lineHeight: 14, fontWeight: '900' },
});
