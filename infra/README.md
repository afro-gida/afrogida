# infra/

VPS (54.38.26.227, OVH, Ubuntu 22.04) altyapı ve deploy.

## Bileşenler

| Yol | Nedir |
|---|---|
| `/opt/afrogida` | Deploy checkout'u (bu repo, `main`). `ubuntu` sahipli. Sadece-okuma deploy key ile çeker. |
| `/root/afro-proje-yedek/afro-proje/backend` | Canlı backend. systemd `afro-backend.service`, `uvicorn` @ 127.0.0.1:8000. `.env` ve `venv` burada (repoda değil). |
| `/var/www/afro-proje` | nginx web kökü (statik frontend). |

## Kurulum (bir kez)

1. `setup-deploy-key.sh` — sunucuda `ubuntu` olarak çalıştır; sadece-okuma deploy key + `github-afrogida` ssh alias üretir. Public key'i GitHub > repo > Settings > Deploy keys'e ekle (write access KAPALI).
2. `git clone github-afrogida:afro-gida/afrogida.git /opt/afrogida`
3. `sudo ln -s /opt/afrogida/infra/deploy.sh /usr/local/bin/afrogida-deploy`

## Deploy

Sunucuda:
```bash
afrogida-deploy              # backend (server.py) + restart + health check + otomatik rollback
afrogida-deploy --frontend   # ayrıca frontend/ -> /var/www/afro-proje senkronu
afrogida-deploy --force      # origin/main == HEAD olsa bile deploy et
```

Windows makinesinden (repoyu push ettikten sonra):
```
powershell -ExecutionPolicy Bypass -File infra\deploy-remote.ps1 [-Frontend] [-Force]
```
`afrogida-vps` ssh alias'ını (`~/.ssh/config`) ve `~/.ssh/afrogida_vps` anahtarını kullanır.

Deploy şunu yapar: `backend/` ağacını canlı dizine `rsync --delete` ile senkronlar
(`.env`, `venv`, `uploads`, loglar, backup'lar korunur) → `pip install -r
requirements.txt` (dosya varsa) → `afro-backend` restart → health check → **API
sözleşme kontrolü** (`check-openapi.sh`, `backend/openapi-baseline.json`'a karşı).

Health check 200 değilse **veya** API yüzeyi (path/method/parametre/şema) değiştiyse:
canlı backend dizini tam yedekten (`/root/afro-proje-yedek/deploy-backups/backend-<zaman>.tgz`)
geri yüklenir, servis restart edilir, checkout önceki commit'e sarılır, exit 1.

Kasıtlı bir API değişikliği yapıyorsan: `afrogida-deploy --allow-api-change`, sonra
baseline'ı güncelle:
```bash
curl -s http://127.0.0.1:8000/openapi.json | python3 -m json.tool --sort-keys > backend/openapi-baseline.json
```

Backend yedekleri: `deploy-backups/backend-<zaman>.tgz` (son 10 tutulur).

## Notlar

- `.env` ve `venv` repoda yok, deploy onlara dokunmaz.
- Backend'e yeni Python bağımlılığı eklenince `backend/requirements.txt` oluştur;
  deploy onu görürse `pip install -r` çalıştırır.
- Frontend senkronu `--delete` KULLANMAZ — sunucudaki `.bak` yığını ve tekil
  dosyalar (ör. Google doğrulama html'i) silinmez.
