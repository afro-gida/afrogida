"""Kupon sistemi anomali tespiti.

Kullanıcının verdiği 4 somut kural — hepsi mevcut security_alarm() mekanizmasını
(core/security.py; log_security'ye yazar + severity high/critical'de
SECURITY_ADMIN_PHONE'a SMS atar, 10 dk'da 1 kez/olay tipi throttle'lı) kullanır,
admin_lockout vb. için zaten kullanılan aynı yol. Hiçbiri işlemi ENGELLEMEZ —
sadece bildirim amaçlıdır (yanlış pozitif olabilir, gerçek müşteri/admin
işlemini asla durdurmamalı).

  1) Aynı müşteri 24 saatte COUPON_USER_USE_LIMIT_24H'ten fazla kupon kullanırsa
  2) Günlük toplam kupon indirimi, son 30 günün ortalamasının
     COUPON_DAILY_TOTAL_MULTIPLIER katını geçerse
  3) Bir admin 1 saatte COUPON_ADMIN_ACTION_LIMIT_1H'ten fazla kupon
     oluşturma/atama işlemi yaparsa
  4) Bir kupon eşik tutarı (varsayılan COUPON_HIGH_DISCOUNT_THRESHOLD=500TL,
     admin panelden global_settings.coupon_anomaly_discount_threshold ile
     değiştirilebilir) ve üzeri indirimle oluşturulur/güncellenirse
     (en somut/acil olanı)
"""
import logging
from datetime import timedelta

from core.db import db
from core.security import security_alarm
from core.util import now_utc

logger = logging.getLogger("afro.coupon_anomaly")

COUPON_HIGH_DISCOUNT_THRESHOLD = 500.0   # TL — VARSAYILAN eşik (admin panelden değiştirilebilir, bkz. check_high_value_coupon)
COUPON_USER_USE_LIMIT_24H = 3            # aynı kişi 24 saatte bu sayının ÜZERİNDE kupon kullanırsa uyar
COUPON_ADMIN_ACTION_LIMIT_1H = 5         # bir admin 1 saatte bu sayının ÜZERİNDE kupon oluşturur/atarsa uyar
COUPON_DAILY_TOTAL_MULTIPLIER = 3        # günlük toplam indirim, 30 günlük ortalamanın kaç katını geçerse uyarılsın

# Admin panelinden açılıp/kapatılabilir (global_settings.coupon_anomaly_detection_enabled,
# GET /api/settings + PUT /api/admin/settings ile — bkz. routers/settings.py). Alan
# hiç ayarlanmamışsa (eski kayıtlar) VARSAYILAN AÇIK sayılır.
async def _detection_enabled() -> bool:
    settings = await db.settings.find_one({"id": "global_settings"}, {"_id": 0, "coupon_anomaly_detection_enabled": 1})
    return bool((settings or {}).get("coupon_anomaly_detection_enabled", True))


async def check_high_value_coupon(coupon: dict, admin: dict = None, request=None, action: str = "coupon_created"):
    """Kural 4: kupon eşik tutarı ve üzeri indirimle oluşturulduysa/güncellendiyse
    hemen bildir. Eşik admin panelden ayarlanabilir (global_settings.
    coupon_anomaly_discount_threshold — GET /api/settings + PUT /api/admin/
    settings, yeni endpoint yok); hiç ayarlanmamışsa COUPON_HIGH_DISCOUNT_THRESHOLD
    (500TL) varsayılan olarak kullanılır."""
    try:
        settings = await db.settings.find_one(
            {"id": "global_settings"},
            {"_id": 0, "coupon_anomaly_detection_enabled": 1, "coupon_anomaly_discount_threshold": 1},
        ) or {}
        if not bool(settings.get("coupon_anomaly_detection_enabled", True)):
            return
        try:
            threshold = float(settings.get("coupon_anomaly_discount_threshold") or COUPON_HIGH_DISCOUNT_THRESHOLD)
        except (TypeError, ValueError):
            threshold = COUPON_HIGH_DISCOUNT_THRESHOLD
        amt = float(coupon.get("discount_amount") or 0)
        if amt < threshold:
            return
        fiil = "güncellendi" if action == "coupon_updated" else "oluşturuldu"
        await security_alarm(
            "coupon_high_discount",
            {"summary": f"{coupon.get('code','')} kuponu {amt:.0f}TL indirimle {fiil} (eşik: {threshold:.0f}TL)",
             "coupon_id": coupon.get("id"), "coupon_code": coupon.get("code"),
             "discount_amount": amt, "threshold": threshold, "action": action},
            request, admin, severity="high", notify=True,
        )
    except Exception as exc:
        logger.warning("Yüksek tutarlı kupon kontrolü başarısız: %s", exc)


async def check_admin_coupon_burst(admin: dict, request=None):
    """Kural 3: bir admin 1 saatte 5'ten fazla kupon oluşturma/atama işlemi yaptıysa uyar."""
    try:
        if not await _detection_enabled():
            return
        admin_id = (admin or {}).get("user_id")
        if not admin_id:
            return
        since = now_utc() - timedelta(hours=1)
        count = await db.log_admin.count_documents({
            "admin_id": admin_id,
            "action": {"$in": ["coupon_created", "coupon_assigned_member", "coupon_assigned_all"]},
            "created_at": {"$gte": since},
        })
        if count > COUPON_ADMIN_ACTION_LIMIT_1H:
            await security_alarm(
                "coupon_admin_burst",
                {"summary": f"{admin.get('name','') or admin_id} son 1 saatte {count} kupon işlemi yaptı",
                 "admin_id": admin_id, "count": count},
                request, admin, severity="high", notify=True,
            )
    except Exception as exc:
        logger.warning("Admin kupon hızı kontrolü başarısız: %s", exc)


async def check_user_coupon_use_burst(user: dict, request=None):
    """Kural 1: aynı müşteri 24 saatte 3'ten fazla kupon kullandıysa uyar."""
    try:
        if not await _detection_enabled():
            return
        uid = (user or {}).get("user_id")
        if not uid:
            return
        since = now_utc() - timedelta(hours=24)
        count = await db.log_coupons.count_documents({
            "user_id": uid, "action": "coupon_used", "created_at": {"$gte": since},
        })
        if count > COUPON_USER_USE_LIMIT_24H:
            await security_alarm(
                "coupon_user_use_burst",
                {"summary": f"{user.get('name','') or uid} son 24 saatte {count} kupon kullandı",
                 "user_id": uid, "count": count},
                request, user, severity="medium", notify=True,
            )
    except Exception as exc:
        logger.warning("Müşteri kupon kullanım hızı kontrolü başarısız: %s", exc)


async def check_daily_coupon_total_anomaly(request=None):
    """Kural 2: bugünkü toplam kupon indirimi, son 30 günün günlük
    ortalamasının COUPON_DAILY_TOTAL_MULTIPLIER katını geçtiyse uyar."""
    try:
        if not await _detection_enabled():
            return
        now = now_utc()
        today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
        window_start = today_start - timedelta(days=30)
        pipeline = [
            {"$match": {"action": "coupon_used", "created_at": {"$gte": window_start}}},
            {"$group": {
                "_id": {"$dateToString": {"format": "%Y-%m-%d", "date": "$created_at"}},
                "total": {"$sum": {"$ifNull": ["$discount_amount", 0]}},
            }},
        ]
        rows = await db.log_coupons.aggregate(pipeline).to_list(40)
        today_key = today_start.strftime("%Y-%m-%d")
        today_total = 0.0
        past_totals = []
        for r in rows:
            if r["_id"] == today_key:
                today_total = float(r["total"] or 0)
            else:
                past_totals.append(float(r["total"] or 0))
        if not past_totals or today_total <= 0:
            return
        avg = sum(past_totals) / len(past_totals)
        if avg > 0 and today_total > avg * COUPON_DAILY_TOTAL_MULTIPLIER:
            await security_alarm(
                "coupon_daily_total_anomaly",
                {"summary": f"Bugün {today_total:.0f}TL kupon indirimi verildi (30 gün ort: {avg:.0f}TL)",
                 "today_total": today_total, "avg_30d": avg, "multiplier": COUPON_DAILY_TOTAL_MULTIPLIER},
                request, None, severity="high", notify=True,
            )
    except Exception as exc:
        logger.warning("Günlük kupon toplamı kontrolü başarısız: %s", exc)
