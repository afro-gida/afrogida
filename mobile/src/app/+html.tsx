import type { PropsWithChildren } from 'react';

/**
 * Web derlemesinin kök HTML'i (yalnızca web'de kullanılır, native'i etkilemez).
 * Bu dosya varken Expo'nun varsayılan static/template/index.html'i devreye
 * girmiyor, o yüzden react-native-web'in gerektirdiği temel reset burada
 * elle tekrarlanıyor (bkz. node_modules/expo/node_modules/@expo/cli/static/
 * template/index.html — "expo-reset" bloğu).
 *
 * Duvar kağıdı gerçek siteyle (afrogida.com.tr) BİREBİR AYNI teknikle
 * uygulanıyor: <body>'ye sabit (fixed) CSS arka plan resmi olarak basılır —
 * `background-attachment: fixed` + `background-size: cover` sayesinde
 * pencere/ekran boyutu ne olursa olsun (masaüstü genişliğinde veya telefon
 * çözünürlüğünde) ekranın tamamını kaplar, hiçbir zaman yarım kalmaz.
 * Sayfa içeriği (bkz. components/screen.tsx) şeffaf kalır ki bu duvar kağıdı
 * kartların arasındaki boşluklardan görünsün.
 */
export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="tr">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no" />
        <title>Afro Gıda</title>
        <style
          id="expo-reset"
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{
            __html: `
html, body { height: 100%; }
body { overflow: hidden; }
#root { display: flex; height: 100%; flex: 1; }

body {
  background-color: #e2b676;
  background-image: url(/wallpaper-light.jpg);
  background-position: center top;
  background-size: cover;
  background-repeat: no-repeat;
  background-attachment: fixed;
}
@media (prefers-color-scheme: dark) {
  body {
    background-color: #0d0d0d;
    background-image: url(/wallpaper-dark.jpg);
  }
}
`,
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
