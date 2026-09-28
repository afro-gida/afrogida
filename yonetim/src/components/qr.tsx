import qrcode from 'qrcode-generator';
import { useMemo } from 'react';
import { View } from 'react-native';

/** Authenticator kurulumu için QR — dış servis yok, kod cihazda çizilir
 *  (gizli anahtar hiçbir yere gönderilmez). */
export function QrCode({ value, size = 220 }: { value: string; size?: number }) {
  const cells = useMemo(() => {
    const qr = qrcode(0, 'M');
    qr.addData(value);
    qr.make();
    const n = qr.getModuleCount();
    const rows: boolean[][] = [];
    for (let r = 0; r < n; r++) {
      const row: boolean[] = [];
      for (let c = 0; c < n; c++) row.push(qr.isDark(r, c));
      rows.push(row);
    }
    return rows;
  }, [value]);
  const n = cells.length;
  const quiet = 4;
  const px = size / (n + quiet * 2);
  return (
    <View style={{ width: size, height: size, backgroundColor: '#fff', padding: px * quiet }}>
      {cells.map((row, r) => (
        <View key={r} style={{ flexDirection: 'row', height: px }}>
          {row.map((dark, c) => (
            <View key={c} style={{ width: px, height: px, backgroundColor: dark ? '#000' : '#fff' }} />
          ))}
        </View>
      ))}
    </View>
  );
}
