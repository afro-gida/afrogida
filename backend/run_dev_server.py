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

import uvicorn  # noqa: E402

if __name__ == "__main__":
    uvicorn.run("server:app", host="0.0.0.0", port=8000, reload=True)
