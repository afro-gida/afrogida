"""Yerel gelistirme sunucusu - guvenli varsayilanlarla calisir.

`.env` DEGISTIRILMEZ (icinde gercek prod anahtarlari var, bkz. NOTES.md).
Bu script sadece process ortam degiskenlerini `.env` yuklenmeden ONCE
ayarlar; python-dotenv `override=False` oldugu icin burada zaten ayarlanmis
degerler `.env`'dekileri EZER:

  - ayri DB (afrogida_dev) - prod/test_database'a hic dokunmaz
  - PAYTR_TEST_MODE=1      - PayTR'a sahte odeme olarak gider, gercek kart cekilmez
  - VERIMOR_USERNAME/PASSWORD bos - SMS gonderilmez (GONDERILMEDI sayilir); OTP
    kodu dahil mesajin tam metni bu terminaldeki loglara yazilir, buradan okuyup
    uygulamaya elle girebilirsin.
  - ADMIN_2FA_ALLOW_UNSENT_SMS=1 - SADECE bu dev sunucusunda: yonetici girisi
    2FA kodu SMS ile "gonderilemedi" (yukarudaki sebepten) olsa bile 503 ile
    REDDETMEZ, normal sekilde devam eder (kod yine bu terminale yazilir).
    Uretimde bu bayrak set edilmedigi icin davranis degismez (hala 503).

CORS: varsayilan AFRO_ALLOWED_ORIGINS zaten localhost:8081/19006 (Expo web)
icerir, burada dokunulmadi.

Kullanim:
    .venv/Scripts/python.exe run_dev_server.py
"""
import os

os.environ["DB_NAME"] = "afrogida_dev"
os.environ["PAYTR_TEST_MODE"] = "1"
os.environ["VERIMOR_USERNAME"] = ""
os.environ["VERIMOR_PASSWORD"] = ""
os.environ["ADMIN_2FA_ALLOW_UNSENT_SMS"] = "1"

import uvicorn  # noqa: E402

if __name__ == "__main__":
    # reload=False: bu makinede reloader eski worker'i sessizce tutabiliyordu.
    # Kod degistirince bu scripti elle yeniden baslat.
    uvicorn.run("server:app", host="0.0.0.0", port=8000, reload=False)
