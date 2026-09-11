import { useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth-context';
import { Spacing } from '@/constants/theme';

/**
 * Giriş sonrası, kullanıcının henüz onaylamadığı (veya sürümü güncellenmiş)
 * sözleşmeler varsa uygulamayı kullanmadan önce onaylatır (backend
 * /api/contracts/pending + /api/contracts/accept — "login gate").
 */
export function ContractGate() {
  const theme = useTheme();
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
        <View style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
          <ThemedText type="subtitle">Güncel Sözleşmeler</ThemedText>
          <ThemedText themeColor="textSecondary" type="small" style={styles.hint}>
            Devam etmeden önce aşağıdaki güncel sözleşmeleri onaylaman gerekiyor.
          </ThemedText>
          <ScrollView style={styles.list}>
            {pendingContracts.map((c) => (
              <View key={c.document_code} style={[styles.item, { borderColor: theme.border }]}>
                <ThemedText type="smallBold">{c.name}</ThemedText>
                <ThemedText themeColor="textSecondary" type="small">
                  Sürüm: {c.version}
                </ThemedText>
              </View>
            ))}
          </ScrollView>
          <Pressable style={[styles.button, { backgroundColor: theme.tint }]} onPress={handleAcceptAll} disabled={submitting}>
            {submitting ? <ActivityIndicator color="#fff" /> : (
              <ThemedText style={{ color: '#fff' }} type="smallBold">
                Hepsini Onayla ve Devam Et
              </ThemedText>
            )}
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center', padding: Spacing.three },
  card: { width: '100%', maxWidth: 420, borderRadius: 16, padding: Spacing.three, gap: Spacing.two },
  hint: { marginBottom: Spacing.one },
  list: { maxHeight: 220 },
  item: { borderWidth: 1, borderRadius: 10, padding: Spacing.two, marginBottom: Spacing.one },
  button: { borderRadius: 999, paddingVertical: Spacing.three, alignItems: 'center' },
});
