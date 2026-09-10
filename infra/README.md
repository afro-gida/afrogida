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

```bash
afrogida-deploy              # backend (server.py) + restart + health check + otomatik rollback
afrogida-deploy --frontend   # ayrıca frontend/ -> /var/www/afro-proje senkronu
afrogida-deploy --force      # origin/main == HEAD olsa bile deploy et
```

Health check `http://127.0.0.1:8000/api/` 200 dönmezse: server.py eski haline döner,
servis restart edilir, checkout bir önceki commit'e sarılır, exit 1.

Backend yedekleri: `server.py.deploy-bak-<zaman>` (son 10 tutulur).

## Notlar

- `.env` ve `venv` repoda yok, deploy onlara dokunmaz.
- Backend'e yeni Python bağımlılığı eklenince `backend/requirements.txt` oluştur;
  deploy onu görürse `pip install -r` çalıştırır.
- Frontend senkronu `--delete` KULLANMAZ — sunucudaki `.bak` yığını ve tekil
  dosyalar (ör. Google doğrulama html'i) silinmez.
