"""Kupon anomali tespiti — services/coupon_anomaly.py.

security_alarm() testte SMS atmaz (conftest'te SECURITY_ADMIN_PHONE=""),
ama log_security kaydı her durumda yazılır — testler ona bakar.
"""
import uuid
from datetime import datetime, timedelta, timezone


def _coupon_payload(**over):
    p = {
        "code": f"AN{uuid.uuid4().hex[:6].upper()}",
        "title": "Anomali Testi",
        "discount_percent": 0,
        "discount_amount": 100.0,
        "min_amount": 0,
        "members_only": False,
        "single_use": False,
        "active": True,
    }
    p.update(over)
    return p


def test_high_value_coupon_triggers_alarm(client, make_user, db):
    _, admin_h = make_user(role="yonetici")
    r = client.post("/api/admin/coupons", json=_coupon_payload(discount_amount=600), headers=admin_h)
    assert r.status_code == 200, r.text
    alarm = db.log_security.find_one({"event_type": "coupon_high_discount"}, sort=[("created_at", -1)])
    assert alarm is not None
    assert alarm["details"]["discount_amount"] == 600.0


def test_low_value_coupon_no_alarm(client, make_user, db):
    _, admin_h = make_user(role="yonetici")
    before = db.log_security.count_documents({"event_type": "coupon_high_discount"})
    r = client.post("/api/admin/coupons", json=_coupon_payload(discount_amount=100), headers=admin_h)
    assert r.status_code == 200, r.text
    after = db.log_security.count_documents({"event_type": "coupon_high_discount"})
    assert after == before


def test_update_to_high_value_triggers_alarm(client, make_user, db):
    _, admin_h = make_user(role="yonetici")
    r = client.post("/api/admin/coupons", json=_coupon_payload(discount_amount=50), headers=admin_h)
    coupon_id = r.json()["id"]
    before = db.log_security.count_documents({"event_type": "coupon_high_discount"})
    r2 = client.put(f"/api/admin/coupons/{coupon_id}", json=_coupon_payload(discount_amount=750), headers=admin_h)
    assert r2.status_code == 200, r2.text
    after = db.log_security.count_documents({"event_type": "coupon_high_discount"})
    assert after == before + 1


def test_admin_coupon_burst_triggers_alarm(client, make_user, db):
    _, admin_h = make_user(role="yonetici")
    for _ in range(6):  # limit 5/saat -> 6.sında tetiklenir
        r = client.post("/api/admin/coupons", json=_coupon_payload(discount_amount=10), headers=admin_h)
        assert r.status_code == 200, r.text
    alarm = db.log_security.find_one({"event_type": "coupon_admin_burst"})
    assert alarm is not None
    assert alarm["details"]["count"] == 6


def test_user_coupon_use_burst_triggers_alarm(client, make_user, db):
    uid, _h = make_user(role="musteri")
    _, admin_h = make_user(role="yonetici")
    c = _coupon_payload(discount_amount=20, assigned_user_ids=[uid])
    r = client.post("/api/admin/coupons", json=c, headers=admin_h)
    coupon_id = r.json()["id"]
    # kupona bu üye için 5 hak tanımla (assign-member ile limit güncellenir)
    client.post("/api/admin/coupons/assign-member", json={"coupon_id": coupon_id, "user_id": uid, "limit": 5}, headers=admin_h)

    for _ in range(4):  # limit 3/24saat -> 4.de tetiklenir
        r2 = client.post("/api/admin/coupons/redeem", json={"code": c["code"], "user_id": uid}, headers=admin_h)
        assert r2.status_code == 200, r2.text

    alarm = db.log_security.find_one({"event_type": "coupon_user_use_burst"})
    assert alarm is not None
    assert alarm["details"]["user_id"] == uid


def test_daily_coupon_total_anomaly_triggers_alarm(client, make_user, db):
    # 29 günlük geçmişe düşük ortalama (günde 10TL) serpiştir
    base = datetime.now(timezone.utc) - timedelta(days=15)
    for i in range(10):
        db.log_coupons.insert_one({
            "coupon_id": "hist", "coupon_code": "HIST", "user_id": "histuser",
            "action": "coupon_used", "discount_amount": 10.0,
            "created_at": base - timedelta(days=i),
        })
    _, admin_h = make_user(role="yonetici")
    c = _coupon_payload(discount_amount=200)  # ortalamanın (10) 3 katından fazla -> tetiklenmeli
    r = client.post("/api/admin/coupons", json=c, headers=admin_h)
    coupon_id = r.json()["id"]
    client.post("/api/admin/coupons/assign-all", json={"coupon_id": coupon_id, "limit": 1}, headers=admin_h)
    r2 = client.post("/api/admin/coupons/redeem", json={"code": c["code"]}, headers=admin_h)
    assert r2.status_code == 200, r2.text
    alarm = db.log_security.find_one({"event_type": "coupon_daily_total_anomaly"})
    assert alarm is not None


def test_detection_disabled_suppresses_alarms(client, make_user, db):
    _, admin_h = make_user(role="yonetici")
    r = client.put("/api/admin/settings", json={"coupon_anomaly_detection_enabled": False}, headers=admin_h)
    assert r.status_code == 200, r.text
    before = db.log_security.count_documents({"event_type": "coupon_high_discount"})
    r2 = client.post("/api/admin/coupons", json=_coupon_payload(discount_amount=999), headers=admin_h)
    assert r2.status_code == 200, r2.text
    after = db.log_security.count_documents({"event_type": "coupon_high_discount"})
    assert after == before  # kapalıyken hiç alarm üretilmedi
    # tekrar açınca normale döner
    client.put("/api/admin/settings", json={"coupon_anomaly_detection_enabled": True}, headers=admin_h)
    r3 = client.post("/api/admin/coupons", json=_coupon_payload(discount_amount=999), headers=admin_h)
    assert r3.status_code == 200, r3.text
    assert db.log_security.count_documents({"event_type": "coupon_high_discount"}) == before + 1


def test_toggle_sends_alarm_every_time_not_throttled(client, make_user, db):
    """coupon_anomaly_detection_toggled bypass_throttle=True kullanmalı —
    art arda hızlı aç/kapa yapılsa bile HER SEFERİNDE alarm üretilmeli
    (normal 10dk throttle burada uygulanmamalı)."""
    _, admin_h = make_user(role="yonetici")
    before = db.log_security.count_documents({"event_type": "coupon_anomaly_detection_toggled"})
    client.put("/api/admin/settings", json={"coupon_anomaly_detection_enabled": False}, headers=admin_h)
    client.put("/api/admin/settings", json={"coupon_anomaly_detection_enabled": True}, headers=admin_h)
    client.put("/api/admin/settings", json={"coupon_anomaly_detection_enabled": False}, headers=admin_h)
    after = db.log_security.count_documents({"event_type": "coupon_anomaly_detection_toggled"})
    assert after == before + 3  # üçü de kaydedildi, hiçbiri throttle'a takılmadı
    # aynı değere tekrar set etmek (gerçek bir değişiklik değil) yeni alarm ÜRETMEMELİ
    client.put("/api/admin/settings", json={"coupon_anomaly_detection_enabled": False}, headers=admin_h)
    assert db.log_security.count_documents({"event_type": "coupon_anomaly_detection_toggled"}) == before + 3
    # kapalı kalan durumu tekrar aç (sonraki testleri etkilemesin)
    client.put("/api/admin/settings", json={"coupon_anomaly_detection_enabled": True}, headers=admin_h)
