"""Teslim alınmayan sipariş (no-show) ceza sistemi.

Politika (Tezgahta / Kapıda ödemeli siparişlerde müşteri teslim almazsa):
  1. teslim alınmama  -> sadece UYARI (kısıt yok)
  2. teslim alınmama  -> 60 GÜN yalnızca ONLINE ödeme
  3. teslim alınmama  -> 180 GÜN yalnızca ONLINE ödeme
  4. ve sonrası       -> 365 GÜN yalnızca ONLINE ödeme
Kademeli ve SÜRELİ (yasal orantılılık). Süre dolunca otomatik kalkar.
"""
import logging
from datetime import timedelta, timezone
from typing import Optional

from core.db import db
from core.util import now_utc
from core.logs import _insert_log, _log_sms_send, _log_payment_restriction
from services.sms import _tr_ascii, send_sms_verimor, _send_no_show_sms

logger = logging.getLogger("afro.noshow")

NO_SHOW_RESTRICTION_DAYS = 60  # (geriye dönük uyumluluk)
NO_SHOW_DAYS_LEVEL2 = 60
NO_SHOW_DAYS_LEVEL3 = 180
NO_SHOW_DAYS_LEVEL4 = 365


def _evaluate_no_show_restriction(user: dict) -> dict:
    """Kullanıcının güncel no-show ceza durumunu hesaplar (süresi geçmişse pasif sayar)."""
    user = user or {}
    count = int(user.get("no_show_count") or 0)
    indefinite = bool(user.get("online_only_indefinite"))
    until = user.get("online_only_until")
    online_only = False
    active_until = None

    if indefinite:
        online_only = True
    elif until is not None:
        try:
            until_cmp = until if getattr(until, "tzinfo", None) else until.replace(tzinfo=timezone.utc)
            if now_utc() <= until_cmp:
                online_only = True
                active_until = until_cmp
        except Exception:
            online_only = False

    if not online_only:
        msg = ""
    elif indefinite:
        msg = ("Bu hesap, tekrarlanan teslim alınmayan siparişler nedeniyle SÜRESİZ olarak "
               "yalnızca online ödeme kullanabilir. Kapıda nakit ve tezgahta ödeme kapalıdır.")
    else:
        date_str = active_until.astimezone(timezone.utc).strftime("%d.%m.%Y") if active_until else ""
        msg = (f"Bu hesap, teslim alınmayan sipariş nedeniyle {date_str} tarihine kadar yalnızca "
               "online ödeme kullanabilir. Kapıda nakit ve tezgahta ödeme geçici olarak kapalıdır.")

    return {
        "count": count,
        "online_only": online_only,
        "indefinite": indefinite,
        "until": active_until,
        "message": msg,
    }


async def _apply_no_show_penalty(user_id: str, order: Optional[dict] = None,
                                 admin_id: Optional[str] = None) -> dict:
    """Bir siparişte 'Teslim Alınmadı' işaretlendiğinde no-show sayacını artırır,
    kademeli+süreli politikaya göre kısıt uygular, SMS gönderir, log kaydeder."""
    if not user_id:
        return {"count": 0, "level": 0, "message": "", "online_only": False,
                "indefinite": False, "until": None, "sms_sent": None}
    user = await db.users.find_one({"user_id": user_id}, {"_id": 0}) or {}
    if user.get("penalty_exempt"):
        order_id = (order or {}).get("tx_id") or (order or {}).get("order_id") if order else None
        await _insert_log("log_penalties", {
            "user_id": user_id, "order_id": order_id,
            "action": "penalty_skipped_exempt",
            "reason": "Kullanıcı penalty_exempt=True, ceza uygulanmadı",
            "performed_by": "system",
        })
        return {"count": int(user.get("no_show_count") or 0), "level": 0,
                "message": "Ceza muafiyeti aktif, ceza uygulanmadı.",
                "online_only": False, "indefinite": False, "until": None, "sms_sent": None}
    new_count = int(user.get("no_show_count") or 0) + 1

    set_fields = {"no_show_count": new_count, "no_show_last_at": now_utc(), "updated_at": now_utc()}
    order_id = (order or {}).get("tx_id") or (order or {}).get("order_id") if order else None

    if new_count <= 1:
        set_fields["online_only_indefinite"] = False
        message = ("1. teslim alınmayan sipariş: Bu bir UYARIDIR. Tekrarında ödeme kısıtlaması uygulanacaktır "
                   "(2. seferde 60 gün, 3. seferde 180 gün, 4. ve sonrasında 1 yıl yalnızca online ödeme).")
        online_only = False
        indefinite = False
        until = None
        level = 1
        log_action = "undelivered_warning"
        log_details = "1. teslim alınmama - Uyarı (kısıt uygulanmadı)"
    else:
        if new_count == 2:
            days = NO_SHOW_DAYS_LEVEL2
        elif new_count == 3:
            days = NO_SHOW_DAYS_LEVEL3
        else:
            days = NO_SHOW_DAYS_LEVEL4
        until = now_utc() + timedelta(days=days)
        set_fields["online_only_until"] = until
        set_fields["online_only_indefinite"] = False
        date_str = until.strftime("%d.%m.%Y")
        sure_label = "1 yıl (365 gün)" if days == 365 else f"{days} gün"
        message = (f"{new_count}. teslim alınmayan sipariş: {date_str} tarihine kadar ({sure_label}) "
                   "yalnızca online ödeme kullanılabilir. Kapıda ödeme ve tezgahta nakit/POS kapatıldı.")
        online_only = True
        indefinite = False
        level = new_count
        log_action = "cash_blocked"
        log_details = f"{new_count}. teslim alınmama - {sure_label} kapıda ödeme kısıtlaması uygulandı"
        set_fields["is_restricted"] = True
        set_fields["restriction_source"] = "no_show"
        set_fields["restriction_reason"] = (
            f"Teslim alınmayan siparişiniz nedeniyle {date_str} tarihine kadar yalnızca "
            "online kredi kartı ile sipariş verebilirsiniz."
        )
        set_fields["restriction_until"] = until.isoformat()

    await db.users.update_one({"user_id": user_id}, {"$set": set_fields})

    sms_sent = _send_no_show_sms(user, order, level, until)

    if sms_sent is not None:
        _ns_sms_type = "penalty_warning" if log_action == "undelivered_warning" else "penalty_applied"
        await _log_sms_send(user_id, (user or {}).get("phone") or "", _ns_sms_type, "ceza_bildirimi_v1", bool(sms_sent))

    await _log_payment_restriction(
        action=log_action, user_id=user_id, details=log_details,
        order_id=order_id, admin_id=admin_id, sms_sent=sms_sent,
    )

    return {
        "count": new_count,
        "level": min(new_count, 4),
        "message": message,
        "online_only": online_only,
        "indefinite": indefinite,
        "until": set_fields.get("online_only_until"),
        "sms_sent": sms_sent,
    }


async def _maybe_expire_no_show(user: dict) -> dict:
    """No-show kaynaklı kısıtlamanın süresi dolduysa otomatik kaldırır (elle konulan
    admin kısıtlamalarına dokunmaz). Güncellenmiş user dict döner."""
    try:
        if not user:
            return user
        if str(user.get("restriction_source") or "") != "no_show":
            return user
        if not user.get("is_restricted"):
            return user
        until = user.get("online_only_until")
        if until is None:
            return user
        until_cmp = until if getattr(until, "tzinfo", None) else until.replace(tzinfo=timezone.utc)
        if now_utc() <= until_cmp:
            return user

        await db.users.update_one({"user_id": user.get("user_id")}, {"$set": {
            "is_restricted": False,
            "restriction_reason": None,
            "restriction_until": None,
            "restriction_source": None,
            "online_only_until": None,
            "online_only_indefinite": False,
            "updated_at": now_utc(),
        }})
        await _log_payment_restriction(
            action="cash_unblocked", user_id=user.get("user_id"),
            details="Kapıda ödeme kısıtlaması süresi doldu, otomatik kaldırıldı",
            sms_sent=None,
        )
        try:
            phone = user.get("phone")
            if phone:
                name = _tr_ascii(user.get("name") or "Musterimiz")
                msg = (f"Sayin {name}, kapida odeme kisitlamaniz sona ermistir. "
                       "Artik tum odeme yontemlerini kullanabilirsiniz. Iyi alisverisler! - Afro Gida")
                _lift_sms_ok = send_sms_verimor(phone, msg)
                await _log_sms_send(user.get("user_id"), phone, "penalty_lifted", "ceza_kalkti_v1", bool(_lift_sms_ok))
        except Exception as exc:
            logger.error("[NO-SHOW SMS] Kalktı SMS hatası: %s", exc)
        await _insert_log("log_penalties", {
            "user_id": user.get("user_id"),
            "order_id": None,
            "action": "penalty_lifted_auto",
            "penalty_level": None,
            "reason": "Kapıda ödeme kısıtlaması süresi doldu, otomatik kaldırıldı",
            "penalty_start": None,
            "penalty_end": None,
            "previous_level": None,
            "performed_by": "system",
            "admin_id": None,
            "admin_note": None,
            "notification_sent": True,
        })
        fresh = await db.users.find_one({"user_id": user.get("user_id")}, {"_id": 0})
        return fresh or user
    except Exception as exc:
        logger.error("[NO-SHOW] Süre dolumu kontrol hatası: %s", exc)
        return user
