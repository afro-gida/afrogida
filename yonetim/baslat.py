"""Afro Gıda Yönetim — Windows yerel başlatıcı.

Derlenmiş uygulamayı (dist/) SADECE bu bilgisayardan erişilebilen
http://127.0.0.1:8765 adresinde açar; /api ve /uploads isteklerini
https://afrogida.com.tr'ye iletir (tarayıcı aynı kökene konuştuğu için CORS
gerekmez, uygulama internette hiçbir yerde yayınlanmaz).

    python baslat.py            (dist/ hazır olmalı: npm run build:web)
"""
import http.server
import os
import ssl
import sys
import threading
import urllib.error
import urllib.request
import webbrowser

HERE = os.path.dirname(os.path.abspath(__file__))
DIST = os.path.join(HERE, "dist")
UPSTREAM = os.environ.get("AFRO_UPSTREAM", "https://afrogida.com.tr")
HOST, PORT = "127.0.0.1", int(os.environ.get("AFRO_ADMIN_PORT", "8765"))
FORWARD_HEADERS = ("Authorization", "Content-Type", "User-Agent", "Accept", "Accept-Language")
SECURITY_HEADERS = {
    "X-Frame-Options": "DENY",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Cache-Control": "no-store",
}
_ctx = ssl.create_default_context()


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=DIST, **k)

    def log_message(self, format, *args):  # noqa: A002 — sessiz (konsol kalabalık olmasın)
        pass

    def end_headers(self):
        for k, v in SECURITY_HEADERS.items():
            self.send_header(k, v)
        super().end_headers()

    def _proxy(self):
        body = None
        n = int(self.headers.get("Content-Length") or 0)
        if n:
            body = self.rfile.read(n)
        req = urllib.request.Request(UPSTREAM + self.path, data=body, method=self.command)
        for h in FORWARD_HEADERS:
            if self.headers.get(h):
                req.add_header(h, self.headers[h])
        try:
            r = urllib.request.urlopen(req, context=_ctx, timeout=40)
            code, data, ctype = r.status, r.read(), r.headers.get("Content-Type", "application/json")
        except urllib.error.HTTPError as e:
            code, data, ctype = e.code, e.read(), e.headers.get("Content-Type", "application/json")
        except Exception:
            code, data, ctype = 502, b'{"detail":"Sunucuya ulasilamadi"}', "application/json"
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _is_proxied(self):
        return self.path.startswith("/api/") or self.path.startswith("/uploads/")

    def do_GET(self):
        if self._is_proxied():
            return self._proxy()
        path = self.path.split("?")[0]
        full = os.path.join(DIST, path.lstrip("/"))
        if path == "/" or not os.path.isfile(full):
            self.path = "/index.html"  # tek sayfa uygulama: tüm yollar index.html
        return super().do_GET()

    def do_POST(self):
        return self._proxy() if self._is_proxied() else self.send_error(405)

    def do_PUT(self):
        return self._proxy() if self._is_proxied() else self.send_error(405)

    def do_DELETE(self):
        return self._proxy() if self._is_proxied() else self.send_error(405)

    def do_PATCH(self):
        return self._proxy() if self._is_proxied() else self.send_error(405)


def main():
    if not os.path.isfile(os.path.join(DIST, "index.html")):
        sys.exit("dist/ bulunamadi. Once derleyin: npm run build:web")
    srv = http.server.ThreadingHTTPServer((HOST, PORT), Handler)
    url = f"http://{HOST}:{PORT}/"
    print(f"Afro Gida Yonetim acik: {url}  (kapatmak icin bu pencereyi kapatin)")
    if "--no-browser" not in sys.argv:
        threading.Timer(0.8, lambda: webbrowser.open(url)).start()
    srv.serve_forever()


if __name__ == "__main__":
    main()
