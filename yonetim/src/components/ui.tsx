/** Hafif ortak arayüz parçaları — panel hızlı olsun diye gölge/animasyon yok. */
import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState, type ComponentProps, type ReactNode } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View, type TextInputProps, type ViewStyle } from 'react-native';

import { useTheme } from '@/lib/theme';

export type IconName = ComponentProps<typeof Ionicons>['name'];

export function T({ children, muted, bold, size = 14, color, style, numberOfLines }: {
  children: ReactNode; muted?: boolean; bold?: boolean; size?: number; color?: string; style?: any; numberOfLines?: number;
}) {
  const t = useTheme();
  return (
    <Text
      numberOfLines={numberOfLines}
      style={[{ color: color ?? (muted ? t.muted : t.text), fontSize: size, lineHeight: Math.round(size * 1.35), fontWeight: bold ? '700' : '400' }, style]}
    >
      {children}
    </Text>
  );
}

export function Page({ title, subtitle, right, children, scroll = true }: {
  title: string; subtitle?: string; right?: ReactNode; children: ReactNode; scroll?: boolean;
}) {
  const t = useTheme();
  const body = <View style={styles.pageBody}>{children}</View>;
  return (
    <View style={[styles.flex, { backgroundColor: t.bg }]}>
      <View style={[styles.pageHeader, { borderBottomColor: t.border }]}>
        <View style={styles.flex}>
          <T size={22} bold>{title}</T>
          {!!subtitle && <T muted size={13}>{subtitle}</T>}
        </View>
        {right}
      </View>
      {scroll ? <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">{body}</ScrollView> : body}
    </View>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  const t = useTheme();
  return <View style={[styles.card, { backgroundColor: t.card, borderColor: t.border }, style]}>{children}</View>;
}

export function Section({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  return (
    <Card>
      <View style={styles.row}>
        <T bold size={16} style={styles.flex}>{title}</T>
        {right}
      </View>
      <View style={{ gap: 10, marginTop: 10 }}>{children}</View>
    </Card>
  );
}

export function Button({ label, onPress, kind = 'primary', icon, loading, disabled, small }: {
  label: string; onPress: () => void; kind?: 'primary' | 'secondary' | 'danger' | 'ghost'; icon?: IconName; loading?: boolean; disabled?: boolean; small?: boolean;
}) {
  const t = useTheme();
  const bg = kind === 'primary' ? t.tint : kind === 'danger' ? t.danger : kind === 'secondary' ? t.cardAlt : 'transparent';
  const fg = kind === 'primary' ? t.tintText : kind === 'danger' ? '#fff' : kind === 'ghost' ? t.tint : t.text;
  const off = disabled || loading;
  return (
    <Pressable
      onPress={off ? undefined : onPress}
      style={({ pressed }) => [
        styles.btn,
        small && styles.btnSmall,
        { backgroundColor: bg, borderColor: kind === 'secondary' ? t.border : 'transparent', opacity: off ? 0.5 : pressed ? 0.8 : 1 },
      ]}
    >
      {loading ? <ActivityIndicator color={fg} size="small" /> : icon ? <Ionicons name={icon} size={small ? 15 : 17} color={fg} /> : null}
      <Text style={{ color: fg, fontWeight: '700', fontSize: small ? 13 : 14 }}>{label}</Text>
    </Pressable>
  );
}

export function Field({ label, hint, style, ...rest }: TextInputProps & { label: string; hint?: string }) {
  const t = useTheme();
  return (
    <View style={[styles.field, style as ViewStyle]}>
      <T size={12.5} bold muted>{label}</T>
      <TextInput
        placeholderTextColor={t.muted}
        {...rest}
        style={[styles.input, { backgroundColor: t.input, borderColor: t.border, color: t.text }, rest.multiline && { minHeight: 80, textAlignVertical: 'top' }]}
      />
      {!!hint && <T size={12} muted>{hint}</T>}
    </View>
  );
}

const fmtNum = (v: number | null | undefined) => (v == null ? '' : String(v).replace('.', ','));
const parseNum = (s: string) => {
  const n = Number(s.replace(',', '.').replace(/[^\d.]/g, ''));
  return Number.isFinite(n) ? n : 0;
};

/** Sayı kutusu: yazılan metni kendisi tutar ("12," yazarken virgül kaybolmasın),
 *  dışarıdan değer değişirse (ör. kayıttan sonra) metni günceller. */
export function NumField({ label, value, onChange, hint, suffix, style }: {
  label: string; value: number | null | undefined; onChange: (v: number) => void; hint?: string; suffix?: string; style?: ViewStyle;
}) {
  const [text, setText] = useState(fmtNum(value));
  useEffect(() => {
    if (parseNum(text) !== (value ?? 0)) setText(fmtNum(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <Field
      label={suffix ? `${label} (${suffix})` : label}
      hint={hint}
      style={style}
      keyboardType="decimal-pad"
      value={text}
      onChangeText={(s) => {
        const clean = s.replace(/[^\d.,]/g, '');
        setText(clean);
        onChange(parseNum(clean));
      }}
    />
  );
}

/** Bugün (Türkiye) "YYYY-AA-GG". */
export function todayIso(offsetDays = 0) {
  const d = new Date(Date.now() + offsetDays * 86400000);
  return d.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
}

/** "2026-10-31" -> "31.10.2026" (boşsa "Süresiz"). */
export function trDate(s?: string | null) {
  if (!s) return 'Süresiz';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : s;
}

/** Bugünden "YYYY-AA-GG"ye kaç gün kaldı (bugün = 0; geçmiş negatif). */
export function daysLeft(s?: string | null) {
  if (!s) return null;
  const a = Date.parse(`${todayIso()}T00:00:00Z`);
  const b = Date.parse(`${s.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(b) ? null : Math.round((b - a) / 86400000);
}

/** SKT gösterimi: "31.10.2026 (30 gün)" · "(bugün son gün)" · "(süresi doldu)" · "Süresiz". */
export function sktText(s?: string | null) {
  if (!s) return 'Süresiz';
  const n = daysLeft(s);
  const extra = n == null ? '' : n < 0 ? ' (süresi doldu)' : n === 0 ? ' (bugün son gün)' : ` (${n} gün)`;
  return `${trDate(s)}${extra}`;
}

/** Kaç gün geçerli? — gün yazılır, SKT kendiliğinden hesaplanır ve yanında
 *  gösterilir. 0 / boş = süresiz. Değer dışarıya "YYYY-AA-GG" ya da null
 *  olarak verilir (o günün sonuna kadar geçerli). */
export function DaysField({ label, value, onChange, hint }: {
  label: string; value: string | null | undefined; onChange: (v: string | null) => void; hint?: string;
}) {
  const t = useTheme();
  const fromValue = () => {
    const n = daysLeft(value);
    return n != null && n > 0 ? String(n) : '';
  };
  const [text, setText] = useState(fromValue);
  // Dışarıdan değer değişirse (ör. kupon yüklendi) kutuyu güncelle
  useEffect(() => {
    const n = Number(text) || 0;
    if ((n > 0 ? todayIso(n) : null) !== (value ?? null)) setText(fromValue());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  const set = (s: string) => {
    const clean = s.replace(/[^\d]/g, '').slice(0, 4);
    setText(clean);
    const n = Number(clean) || 0;
    onChange(n > 0 ? todayIso(n) : null);
  };
  return (
    <View style={styles.field}>
      <T size={12.5} bold muted>{label}</T>
      <View style={[styles.chips, { alignItems: 'center' }]}>
        <TextInput
          value={text}
          onChangeText={set}
          keyboardType="number-pad"
          placeholder="Süresiz"
          placeholderTextColor={t.muted}
          style={[styles.input, { backgroundColor: t.input, borderColor: t.border, color: t.text, width: 90, textAlign: 'center' }]}
        />
        <T bold>gün</T>
        {[7, 30, 90].map((d) => (
          <Pressable key={d} onPress={() => set(String(d))} style={[styles.chip, { borderColor: text === String(d) ? t.tint : t.border }]}>
            <Text style={{ color: t.text, fontSize: 13, fontWeight: '600' }}>{d}</Text>
          </Pressable>
        ))}
        <Pressable onPress={() => set('')} style={[styles.chip, { borderColor: value ? t.border : t.tint, backgroundColor: value ? 'transparent' : t.tint }]}>
          <Text style={{ color: value ? t.text : t.tintText, fontSize: 13, fontWeight: '600' }}>Süresiz</Text>
        </Pressable>
      </View>
      <T size={12.5} color={value ? t.tint : t.muted} bold={!!value}>
        {value ? `SKT: ${sktText(value)}` : 'Süre sınırı yok'}
      </T>
      {!!hint && <T size={12} muted>{hint}</T>}
    </View>
  );
}

export function Toggle({ label, value, onChange, hint }: { label: string; value: boolean; onChange: (v: boolean) => void; hint?: string }) {
  const t = useTheme();
  return (
    <Pressable onPress={() => onChange(!value)} style={styles.toggleRow}>
      <View style={styles.flex}>
        <T>{label}</T>
        {!!hint && <T size={12} muted>{hint}</T>}
      </View>
      <Switch value={value} onValueChange={onChange} trackColor={{ true: t.tint, false: t.border }} thumbColor="#fff" />
    </Pressable>
  );
}

export function Chips<V extends string>({ options, value, onChange }: { options: { value: V; label: string }[]; value: V; onChange: (v: V) => void }) {
  const t = useTheme();
  return (
    <View style={styles.chips}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable key={o.value} onPress={() => onChange(o.value)} style={[styles.chip, { borderColor: on ? t.tint : t.border, backgroundColor: on ? t.tint : 'transparent' }]}>
            <Text style={{ color: on ? t.tintText : t.text, fontWeight: '600', fontSize: 13 }}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Açılır seçim kutusu: seçili değer + ok; basınca seçenekler altında açılır. */
export function Select<V extends string>({ label, options, value, onChange, placeholder = 'Seçiniz' }: {
  label?: string; options: { value: V; label: string }[]; value: V | null; onChange: (v: V) => void; placeholder?: string;
}) {
  const t = useTheme();
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.value === value);
  return (
    <View style={styles.field}>
      {!!label && <T size={12.5} bold muted>{label}</T>}
      <Pressable
        onPress={() => setOpen((o) => !o)}
        style={[styles.select, { backgroundColor: t.input, borderColor: open ? t.tint : t.border }]}
      >
        <Text style={{ flex: 1, color: current ? t.text : t.muted, fontSize: 14 }}>{current?.label ?? placeholder}</Text>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={16} color={t.muted} />
      </Pressable>
      {open && (
        <View style={[styles.selectList, { backgroundColor: t.card, borderColor: t.tint }]}>
          {options.map((o, i) => {
            const on = o.value === value;
            return (
              <Pressable
                key={o.value}
                onPress={() => { onChange(o.value); setOpen(false); }}
                style={({ pressed }) => [
                  styles.selectItem,
                  i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.border },
                  (on || pressed) && { backgroundColor: t.cardAlt },
                ]}
              >
                <Text style={{ color: on ? t.tint : t.text, fontWeight: on ? '700' : '400', fontSize: 14 }}>{o.label}</Text>
              </Pressable>
            );
          })}
        </View>
      )}
    </View>
  );
}

export function MultiChips({ options, values, onChange }: { options: { value: string; label: string }[]; values: string[]; onChange: (v: string[]) => void }) {
  const t = useTheme();
  return (
    <View style={styles.chips}>
      {options.map((o) => {
        const on = values.includes(o.value);
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(on ? values.filter((v) => v !== o.value) : [...values, o.value])}
            style={[styles.chip, { borderColor: on ? t.tint : t.border, backgroundColor: on ? t.tint : 'transparent' }]}
          >
            <Text style={{ color: on ? t.tintText : t.text, fontWeight: '600', fontSize: 13 }}>{on ? '✓ ' : ''}{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Badge({ label, tone = 'muted' }: { label: string; tone?: 'ok' | 'danger' | 'warn' | 'muted' | 'tint' }) {
  const t = useTheme();
  const c = tone === 'ok' ? t.ok : tone === 'danger' ? t.danger : tone === 'warn' ? t.warn : tone === 'tint' ? t.tint : t.muted;
  return (
    <View style={[styles.badge, { borderColor: c }]}>
      <Text style={{ color: c, fontSize: 11.5, fontWeight: '700' }}>{label}</Text>
    </View>
  );
}

export function Loading() {
  const t = useTheme();
  return <ActivityIndicator style={{ marginTop: 40 }} color={t.tint} />;
}

export function ErrorBox({ text, onRetry }: { text: string; onRetry?: () => void }) {
  const t = useTheme();
  return (
    <View style={[styles.errorBox, { borderColor: t.danger }]}>
      <T color={t.danger} style={styles.flex}>{text}</T>
      {onRetry && <Button small kind="secondary" label="Tekrar dene" onPress={onRetry} />}
    </View>
  );
}

export function Notice({ text, tone = 'ok' }: { text: string; tone?: 'ok' | 'warn' }) {
  const t = useTheme();
  const c = tone === 'ok' ? t.ok : t.warn;
  return (
    <View style={[styles.errorBox, { borderColor: c }]}>
      <T color={c}>{text}</T>
    </View>
  );
}

export function ListRow({ title, subtitle, right, onPress }: { title: string; subtitle?: string; right?: ReactNode; onPress?: () => void }) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.listRow, { borderBottomColor: t.border, backgroundColor: pressed && onPress ? t.cardAlt : 'transparent' }]}
    >
      <View style={styles.flex}>
        <T bold numberOfLines={1}>{title}</T>
        {!!subtitle && <T size={12.5} muted numberOfLines={2}>{subtitle}</T>}
      </View>
      {right}
      {onPress && <Ionicons name="chevron-forward" size={16} color={t.muted} />}
    </Pressable>
  );
}

/** Onay: web'de tarayıcı penceresi, uygulamada Alert. */
export function confirmAsync(message: string): Promise<boolean> {
  if (Platform.OS === 'web') return Promise.resolve(window.confirm(message));
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Alert } = require('react-native');
  return new Promise((resolve) =>
    Alert.alert('Onay', message, [
      { text: 'Vazgeç', style: 'cancel', onPress: () => resolve(false) },
      { text: 'Evet', style: 'destructive', onPress: () => resolve(true) },
    ]),
  );
}

export function money(n: number | null | undefined) {
  return `${(n ?? 0).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₺`;
}

export function dateTime(s?: string | null) {
  if (!s) return '-';
  const d = new Date(s.endsWith('Z') || s.includes('+') ? s : `${s}Z`);
  return isNaN(d.getTime()) ? s : d.toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' });
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  pageHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth },
  scroll: { paddingBottom: 60 },
  pageBody: { padding: 16, gap: 14, width: '100%', maxWidth: 1100, alignSelf: 'center' },
  card: { borderWidth: 1, borderRadius: 12, padding: 14 },
  btn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, height: 42, paddingHorizontal: 16, borderRadius: 10, borderWidth: 1 },
  btnSmall: { height: 32, paddingHorizontal: 10, borderRadius: 8 },
  field: { gap: 4, minWidth: 0 },
  input: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 9, fontSize: 14 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 4 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  select: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 10 },
  selectList: { borderWidth: 1, borderRadius: 8, overflow: 'hidden' },
  selectItem: { paddingHorizontal: 12, paddingVertical: 11 },
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 11, paddingVertical: 6 },
  badge: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 7, paddingVertical: 1 },
  errorBox: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderRadius: 10, padding: 12 },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 11, paddingHorizontal: 4, borderBottomWidth: StyleSheet.hairlineWidth },
});
