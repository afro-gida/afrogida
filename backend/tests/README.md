# backend/tests/

`pytest` suite'i — `server.app`'a karşı `TestClient` ile gerçek HTTP istekleri,
izole `afrogida_test` MongoDB veritabanı (her oturum başında sıfırlanır,
`startup()` seed'i doldurur). **Staging/production DB'sine dokunmaz.**

## Çalıştırma

```bash
# Sunucuda (staging venv + yerel mongod)
bash /opt/afrogida-staging/infra/run-tests.sh
bash /opt/afrogida-staging/infra/run-tests.sh -k coupon      # filtre
bash /opt/afrogida-staging/infra/run-tests.sh tests/test_orders.py

# Yerelde (.venv + yerel mongod gerekir)
cd backend && ../.venv/Scripts/python -m pytest
```

## Fixture'lar (`conftest.py`)

| Fixture | Ne |
|---|---|
| `client` | `TestClient(server.app)` — startup/shutdown tetiklenir (seed dahil) |
| `db` | pymongo ile doğrudan `afrogida_test` erişimi (kurulum/temizlik) |
| `make_user` | `uid, headers = make_user(role="member")` — kullanıcı + geçerli oturum token'ı |

## Kapsam hedefi (öncelik sırası)

- [x] Duman: temel uçlar + auth kapıları (`test_smoke.py`)
- [ ] Sipariş hesaplama: fiyat/ara toplam/indirim sunucuda; manipülasyon iptali
- [ ] Kupon: geçerlilik, min tutar, kullanım limiti, kötüye kullanım alarmı
- [ ] PayTR callback: HMAC imza doğrulama + tutar çapraz kontrol
- [ ] Rol yetkileri: admin/tedarikçi/kurye uçları + IDOR (A kullanıcısı B'nin verisi)
- [ ] No-show ceza kademeleri
- [ ] OTP / parola sıfırlama hız sınırı
