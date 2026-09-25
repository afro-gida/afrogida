"""Yasal belge yönetimi (PDF yükleme, oluşturma/güncelleme) + login sözleşme
gate sistemi (bekleyen sözleşmeler, kabul etme, admin istatistik/log)."""
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile

from core.config import ROOT_DIR
from core.db import db
from core.logs import _insert_log
from core.security import get_current_admin, get_current_user, _yonetici_only
from core.util import now_utc

router = APIRouter(prefix="/api")


def _afro_clean_doc(data: dict) -> dict:
    """Gelen belge gövdesini temizle; izinli alanları koru."""
    allowed = {
        "name", "content", "content_html", "version", "active", "is_active",
        "document_code", "service_type", "document_type", "status",
        "change_reason", "pdf_url", "firm_metadata", "title", "sourceName",
    }
    out = {k: v for k, v in (data or {}).items() if k in allowed}
    return out


# ---- PDF yükleme (sözleşme için) ----
@router.post("/admin/upload-pdf")
async def afro_admin_upload_pdf(file: UploadFile = File(...), current_admin: dict = Depends(get_current_admin)):
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Boş dosya")
    if len(content) > 20 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Dosya çok büyük (en fazla 20 MB)")
    head = content[:5]
    if not head.startswith(b"%PDF"):
        raise HTTPException(status_code=400, detail="Sadece PDF dosyası yükleyebilirsiniz")
    uploads_dir = ROOT_DIR / "uploads"
    uploads_dir.mkdir(parents=True, exist_ok=True)
    fname = f"contract_{uuid.uuid4().hex}.pdf"
    (uploads_dir / fname).write_bytes(content)
    return {"url": f"/uploads/{fname}"}


@router.post("/admin/legal-docs")
async def afro_create_legal_doc(data: dict, current_admin: dict = Depends(get_current_admin), request: Request = None):
    _yonetici_only(current_admin)
    doc = _afro_clean_doc(data)
    now = now_utc()
    doc_id = "doc_" + uuid.uuid4().hex[:12]
    doc["id"] = doc_id
    doc["active"] = bool(doc.get("active", True))
    doc["is_active"] = doc["active"]
    doc["status"] = doc.get("status") or "published"
    doc["created_at"] = now
    doc["updated_at"] = now
    doc["published_at"] = now
    doc["revision_date"] = now
    doc.setdefault("created_by", current_admin.get("user_id"))
    doc.setdefault("published_by", current_admin.get("user_id"))
    await db.legal_documents.insert_one(dict(doc))
    try:
        await db.admin_logs.insert_one({
            "action": "legal_doc_created",
            "doc_id": doc_id,
            "document_code": doc.get("document_code"),
            "version": doc.get("version"),
            "pdf_url": doc.get("pdf_url"),
            "admin_id": current_admin.get("user_id"),
            "created_at": now,
        })
    except Exception:
        pass
    await _insert_log("log_admin", {"admin_id": current_admin["user_id"], "admin_name": current_admin.get("name",""), "action": "legal_document_uploaded", "target_type": "legal", "target_id": doc_id, "change_details": {"document_type": doc.get("document_code"), "version": doc.get("version")}, "admin_note": ""}, request)
    return await db.legal_documents.find_one({"id": doc_id}, {"_id": 0})


@router.put("/admin/legal-docs/{doc_id}")
async def afro_update_legal_doc(doc_id: str, data: dict, current_admin: dict = Depends(get_current_admin), request: Request = None):
    _yonetici_only(current_admin)
    doc = _afro_clean_doc(data)
    now = now_utc()
    doc["updated_at"] = now
    if "active" in doc:
        doc["active"] = bool(doc.get("active", True))
        doc["is_active"] = doc["active"]
    # PDF güncellendiyse yayın/rev tarihini tazele
    if doc.get("pdf_url"):
        doc["published_at"] = now
        doc["revision_date"] = now
        doc.setdefault("status", "published")
    result = await db.legal_documents.update_one({"id": doc_id}, {"$set": doc})
    if result.matched_count == 0:
        # Belge yoksa oluştur (upsert davranışı)
        doc["id"] = doc_id
        doc.setdefault("created_at", now)
        doc.setdefault("published_at", now)
        doc.setdefault("revision_date", now)
        doc.setdefault("status", "published")
        doc["active"] = bool(doc.get("active", True))
        doc["is_active"] = doc["active"]
        await db.legal_documents.insert_one(dict(doc))
    try:
        await db.admin_logs.insert_one({
            "action": "legal_doc_updated",
            "doc_id": doc_id,
            "document_code": doc.get("document_code"),
            "version": doc.get("version"),
            "pdf_url": doc.get("pdf_url"),
            "admin_id": current_admin.get("user_id"),
            "created_at": now,
        })
    except Exception:
        pass
    _ld_existing = await db.legal_documents.find_one({"id": doc_id}, {"_id": 0, "version": 1})
    await _insert_log("log_admin", {"admin_id": current_admin["user_id"], "admin_name": current_admin.get("name",""), "action": "legal_document_uploaded", "target_type": "legal", "target_id": doc_id, "change_details": {"field": "version", "old_value": (_ld_existing or {}).get("version"), "new_value": doc.get("version")}, "admin_note": ""}, request)
    return await db.legal_documents.find_one({"id": doc_id}, {"_id": 0})


# --- Login Gate: Hangi sözleşmelerin login gate'de gösterilecegi ---
# document_code -> hedef roller
LOGIN_GATE_CONTRACTS = {
    "kvkk":              {"roles": ["musteri", "esnaf"], "required": True},
    "privacy":           {"roles": ["musteri", "esnaf"], "required": True},
    "membership":        {"roles": ["musteri"],          "required": True},
    "refundComplaintPolicy": {"roles": ["musteri"],      "required": True},
    "couponTerms":       {"roles": ["musteri"],          "required": True},
    # pickupTerms ve homeDeliveryTerms -> checkout gate (sipariş anında), login gate'de gösterilmez
    # tedarikci_sozlesmesi -> mevcut consent_logs sistemi ile çalışıyor
}


# ---- Kullanıcının onay bekleyen sözleşmeleri ----
@router.get("/contracts/pending")
async def afro_contracts_pending(current_user: dict = Depends(get_current_user)):
    """
    Login sonrası çağrılır. Kullanıcının rolüne göre
    onay bekleyen sözleşmeleri döndürür.
    """
    user_id = current_user.get("user_id")
    user_role = current_user.get("role", "musteri")

    # Yöneticiye gate uygulanmaz
    if user_role in ("yonetici", "admin"):
        return {"pending_contracts": []}

    # Aktif ve yayınlanmış sözleşmeleri al
    active_docs = await db.legal_documents.find(
        {"is_active": True, "status": "published", "document_code": {"$exists": True}},
        {"_id": 0, "document_code": 1, "name": 1, "version": 1, "pdf_url": 1}
    ).to_list(50)

    # Bu kullanıcının rolüne uygun login-gate sözleşmelerini filtrele
    relevant = []
    for doc in active_docs:
        code = doc.get("document_code")
        gate_cfg = LOGIN_GATE_CONTRACTS.get(code)
        if not gate_cfg:
            continue
        if user_role not in gate_cfg["roles"]:
            continue
        relevant.append(doc)

    if not relevant:
        return {"pending_contracts": []}

    # Kullanıcının daha önce onayladığı sürümleri al
    accepted_logs = await db.legal_agreement_logs.find(
        {"user_id": user_id, "gate_type": "login", "accepted": True},
        {"_id": 0, "document_code": 1, "document_version": 1}
    ).to_list(200)

    # document_code -> en son onaylanan version map'i
    accepted_map = {}
    for log in accepted_logs:
        code = log.get("document_code")
        ver = log.get("document_version")
        if code and ver:
            accepted_map[code] = ver

    # Onaylanmamış veya sürümü eskimiş olanları bul
    pending = []
    for doc in relevant:
        code = doc.get("document_code")
        current_ver = doc.get("version")
        accepted_ver = accepted_map.get(code)

        if accepted_ver != current_ver:
            pending.append({
                "document_code": code,
                "name": doc.get("name"),
                "version": current_ver,
                "pdf_url": doc.get("pdf_url"),
            })

    return {"pending_contracts": pending}


# ---- Sözleşme kabul et (login gate) ----
@router.post("/contracts/accept")
async def afro_contracts_accept(request: Request, current_user: dict = Depends(get_current_user)):
    """
    Kullanıcı login gate'de sözleşmeyi kabul eder.
    Her onay ayrı kayıt olarak loglanır.
    """
    user_id = current_user.get("user_id")
    user_role = current_user.get("role", "musteri")

    body = await request.json()
    doc_code = body.get("document_code")
    doc_version = body.get("document_version")

    if not doc_code or not doc_version:
        raise HTTPException(status_code=400, detail="document_code ve document_version gerekli")

    # Sözleşmenin gerçekten aktif olduğunu doğrula
    doc = await db.legal_documents.find_one(
        {"document_code": doc_code, "version": doc_version, "is_active": True, "status": "published"}
    )
    if not doc:
        raise HTTPException(status_code=404, detail="Sözleşme bulunamadı veya aktif değil")

    ts = datetime.now(timezone.utc).isoformat()
    ip = request.headers.get("x-forwarded-for", request.headers.get("x-real-ip", "unknown"))
    ua = request.headers.get("user-agent", "unknown")

    # legal_agreement_logs'a kayıt (mevcut yapıyla uyumlu)
    log_entry = {
        "user_id": user_id,
        "accepted": True,
        "gate_type": "login",                       # login gate onayı
        "document_code": doc_code,
        "document_name": doc.get("name"),
        "document_version": doc_version,
        "document_type": doc.get("document_type", doc.get("name")),
        "document_hash": doc.get("sha256_hash", ""),
        "pdf_url": doc.get("pdf_url", ""),
        "checkbox_text_snapshot": f"{doc.get('name')} sözleşmesini okudum ve kabul ediyorum.",
        "versions": {doc_code: doc_version},
        "timestamp": ts,
        "accepted_at": ts,
        "ip": ip,
        "user_agent": ua,
        "user_role": user_role,
        "user_name": current_user.get("name", ""),
        "user_phone": current_user.get("phone", ""),
        "order_id": None,                           # login gate — sipariş yok
        "device_platform": None,
        "device_id": None,
        "app_version": None,
    }

    await db.legal_agreement_logs.insert_one(log_entry)

    await _insert_log("log_consents", {"user_id": user_id, "consent_type": doc_code, "action": "accepted", "document_version": doc_version, "document_name": doc.get("name",""), "document_url": doc.get("pdf_url","")}, request)
    return {"status": "accepted", "document_code": doc_code, "version": doc_version}


# ---- Admin: Sözleşme onay istatistikleri ----
@router.get("/admin/contract-gate-stats")
async def afro_admin_contract_gate_stats(current_admin: dict = Depends(get_current_admin)):
    """
    Her sözleşme için kaç kullanıcı onaylamış / bekliyor istatistiği.
    """
    # Aktif sözleşmeleri al
    active_docs = await db.legal_documents.find(
        {"is_active": True, "status": "published", "document_code": {"$exists": True}},
        {"_id": 0, "document_code": 1, "name": 1, "version": 1}
    ).to_list(50)

    # Toplam musteri ve esnaf sayıları
    musteri_count = await db.users.count_documents({"role": "musteri"})
    esnaf_count = await db.users.count_documents({"role": "esnaf"})

    stats = []
    for doc in active_docs:
        code = doc.get("document_code")
        gate_cfg = LOGIN_GATE_CONTRACTS.get(code)
        if not gate_cfg:
            continue

        ver = doc.get("version")

        # Bu sürümü onaylayanları say
        accepted_count = await db.legal_agreement_logs.count_documents({
            "document_code": code,
            "document_version": ver,
            "gate_type": "login",
            "accepted": True
        })

        # Hedef kitle sayısı
        target = 0
        if "musteri" in gate_cfg["roles"]:
            target += musteri_count
        if "esnaf" in gate_cfg["roles"]:
            target += esnaf_count

        stats.append({
            "document_code": code,
            "name": doc.get("name"),
            "version": ver,
            "target_roles": gate_cfg["roles"],
            "target_count": target,
            "accepted_count": accepted_count,
            "pending_count": max(0, target - accepted_count),
        })

    return {"stats": stats}


# ---- Admin: Login gate onay logları ----
@router.get("/admin/contract-gate-logs")
async def afro_admin_contract_gate_logs(
    document_code: Optional[str] = None,
    current_admin: dict = Depends(get_current_admin)
):
    """
    Login gate onay loglarını listeler. document_code ile filtrelenebilir.
    """
    query = {"gate_type": "login"}
    if document_code:
        query["document_code"] = document_code

    logs = await db.legal_agreement_logs.find(
        query, {"_id": 0}
    ).sort("accepted_at", -1).to_list(500)

    return {"logs": logs, "total": len(logs)}
