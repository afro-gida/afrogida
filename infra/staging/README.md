# Staging ortamı — staging.afrogida.com.tr

Production'ın izole kopyası. Ekip/test burada dener; gerçek para akmaz
(`PAYTR_TEST_MODE=1`), ayrı DB (`afrogida_staging`), basic-auth arkasında,
arama motorlarına kapalı.

| | Production | Staging |
|---|---|---|
| Domain | afrogida.com.tr | staging.afrogida.com.tr (basic-auth) |
| Backend | `:8000`, `afro-backend` | `:8001`, `afro-backend-staging` |
| Checkout | `/opt/afrogida` | `/opt/afrogida-staging` |
| Backend dizini | `/root/afro-proje-yedek/afro-proje/backend` | `/opt/afrogida-staging/backend` |
| DB | `test_database` | `afrogida_staging` |
| Frontend | `/var/www/afro-proje` | `/opt/afrogida-staging/frontend` |

## Kurulum (bir kez)

1. **DNS:** `staging.afrogida.com.tr` → A → `54.38.26.227`
2. Sunucuda:
   ```bash
   cd /opt/afrogida && git pull
   bash infra/staging/setup-staging.sh      # basic-auth parolasını yazdırır — KAYDET
   ```
3. DNS yayılınca TLS:
   ```bash
   sudo certbot --nginx -d staging.afrogida.com.tr --non-interactive --agree-tos -m blackmesa161@gmail.com
   ```

## Staging'e deploy

```bash
bash /opt/afrogida-staging/infra/staging/deploy-staging.sh [branch]   # varsayılan: main
```
Rollback/sözleşme kontrolü yok — staging tek kullanımlık, fix-forward.

## Staging DB'yi production'dan tazele

```bash
mongodump --quiet --db test_database --out /tmp/d && \
mongorestore --quiet --drop --nsFrom 'test_database.*' --nsTo 'afrogida_staging.*' /tmp/d/test_database && \
rm -rf /tmp/d
```

## Notlar

- `.env` prod'dan kopyalanır; `DB_NAME`, `PAYTR_TEST_MODE`, `AFRO_ALLOWED_ORIGINS`,
  `AFRO_ENV=staging`, `SECURITY_SMS_THROTTLE_MIN=1440` override edilir.
- Şifreleme anahtarları (`AFRO_SECRET_KEY`, `AFRO_ENC_KEY`) prod ile AYNI kalır —
  kopyalanan şifreli alanlar (adresler) çözülebilsin diye.
- SMS gerçek gönderilir (Verimor). Staging'de admin 2FA test edilirken gerçek
  SMS gelir; düşük hacimde sorun değil. Alarm SMS'i günde 1 ile sınırlı.
- `pytest` suite'i (yakında) bu DB'ye karşı çalışır; SMS ve PayTR HTTP'yi mock'lar.
