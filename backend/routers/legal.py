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


# ---- Sözleşme kataloğu (Yönetim > Sözleşmeler) ----
# Eski panelin "Gizlilik ve Sözleşmeler" ekranındaki sabit belge listesi.
# default_pdf: yönetim hiç PDF yüklemediyse kullanılan, sunucudaki /legal/
# klasöründe duran varsayılan belge (nginx sunar).
LEGAL_CATALOG = [
    {"code": "kvkk", "name": "KVKK Aydınlatma Metni", "where": "Kayıt ekranı · üyeler girişte onaylar",
     "default_pdf": "/legal/afrogida_01_kvkk_gizlilik_v2.pdf"},
    {"code": "privacy", "name": "Gizlilik Politikası", "where": "Kayıt ekranı · üyeler girişte onaylar",
     "default_pdf": "/legal/afrogida_01_kvkk_gizlilik_v2.pdf"},
    {"code": "membership", "name": "Üyelik Sözleşmesi", "where": "Kayıt ekranı · üyeler girişte onaylar",
     "default_pdf": "/legal/afrogida_02_uyelik_sozlesmesi.pdf"},
    {"code": "pickupTerms", "name": "Gel-Al Mesafeli Satış Sözleşmesi", "where": "Sepet · Gel-Al siparişinde onaylanır",
     "default_pdf": "/legal/afrogida_03_gel_al_sozlesmesi.pdf"},
    {"code": "homeDeliveryTerms", "name": "Eve Servis Mesafeli Satış Sözleşmesi", "where": "Sepet · Eve Servis siparişinde onaylanır",
     "default_pdf": "/legal/afrogida_04_eve_servis_sozlesmesi_v2.pdf"},
    {"code": "refundComplaintPolicy", "name": "İade ve Şikayet Politikası", "where": "Üyeler girişte onaylar",
     "default_pdf": None},
    {"code": "couponTerms", "name": "Kupon Kullanım Koşulları", "where": "Üyeler girişte onaylar",
     "default_pdf": None},
]
_CATALOG_BY_CODE = {c["code"]: c for c in LEGAL_CATALOG}
# Sepetten gelen legal_document_type -> belge kodu
ORDER_DOC_CODE = {"pickup": "pickupTerms", "home_delivery": "homeDeliveryTerms"}

import re as _re  # noqa: E402
# Yayınlanabilecek PDF adresleri: bizim yüklediğimiz (/admin/upload-pdf) ya da varsayılanlar
_PDF_URL_RE = _re.compile(r"^/(uploads/contract_[0-9a-f]{32}|legal/[A-Za-z0-9_.-]+)\.pdf$")


async def active_legal_doc(code: str) -> Optional[dict]:
    """Belgenin yürürlükteki (aktif + yayınlanmış) en son sürümü."""
    return await db.legal_documents.find_one(
        {"document_code": code, "is_active": True, "status": "published"},
        {"_id": 0}, sort=[("published_at", -1)],
    )


def pdf_file_exists(url: Optional[str]) -> bool:
    """/uploads/… PDF'i diskte var mı? Eski siteden kalan kayıtlar artık
    olmayan dosyaları gösteriyordu (müşteri bağlantısı 404 açıyordu)."""
    if not url:
        return False
    if url.startswith("/uploads/"):
        name = url.rsplit("/", 1)[-1]
        return "/" not in name and ".." not in name and (ROOT_DIR / "uploads" / name).is_file()
    return True  # /legal/ varsayılanları nginx'ten, http(s) dış adresler olduğu gibi


def _public_doc(entry: dict, doc: Optional[dict]) -> dict:
    if doc and doc.get("pdf_url") and pdf_file_exists(doc.get("pdf_url")):
        return {"document_code": entry["code"], "name": entry["name"], "version": doc.get("version"),
                "pdf_url": doc.get("pdf_url"), "updated_at": doc.get("published_at") or doc.get("updated_at")}
    return {"document_code": entry["code"], "name": entry["name"], "version": None,
            "pdf_url": entry["default_pdf"], "updated_at": None}


@router.get("/legal-docs")
async def public_legal_docs():
    """Müşteri sitesi: her belgenin yürürlükteki PDF'i (kayıt, sepet ve onay
    ekranındaki sözleşme bağlantıları buradan açılır)."""
    return [_public_doc(e, await active_legal_doc(e["code"])) for e in LEGAL_CATALOG]


@router.get("/admin/legal-catalog")
async def admin_legal_catalog(current_admin: dict = Depends(get_current_admin)):
    """Yönetim > Sözleşmeler: belge başına yürürlükteki sürüm, sürüm geçmişi ve
    (giriş onayı istenen belgelerde) güncel sürümü onaylayan üye sayısı."""
    member_count = await db.users.count_documents({"role": {"$in": ["musteri", "member"]}})
    out = []
    for e in LEGAL_CATALOG:
        history = await db.legal_documents.find(
            {"document_code": e["code"]},
            {"_id": 0, "id": 1, "version": 1, "pdf_url": 1, "is_active": 1, "status": 1,
             "published_at": 1, "created_at": 1, "change_reason": 1, "published_by": 1},
        ).sort("published_at", -1).to_list(50)
        current = next((h for h in history if h.get("is_active") and h.get("status") == "published"), None)
        gate = LOGIN_GATE_CONTRACTS.get(e["code"])
        accepted = None
        if current and gate:
            accepted = len(await db.legal_agreement_logs.distinct(
                "user_id", {"document_code": e["code"], "document_version": current.get("version"),
                            "gate_type": "login", "accepted": True}))
        out.append({
            **e,
            "login_gate": bool(gate),
            "current": _public_doc(e, current),
            "using_default": current is None,
            # Yürürlükteki kaydın dosyası yoksa müşteriye varsayılan PDF gider; yenisi yüklenmeli
            "missing_file": bool(current) and not pdf_file_exists((current or {}).get("pdf_url")),
            "history": history,
            "accepted_count": accepted,
            "member_count": member_count if gate else None,
        })
    return out


def _catalog_entry(code: str) -> dict:
    entry = _CATALOG_BY_CODE.get(code)
    if not entry:
        raise HTTPException(status_code=404, detail="Böyle bir belge yok")
    return entry


@router.post("/admin/legal-catalog/{code}/publish")
async def admin_publish_legal_doc(code: str, data: dict, current_admin: dict = Depends(get_current_admin), request: Request = None):
    """Belgenin yeni sürümünü yayınla: yüklenen PDF + sürüm (+ değişiklik notu).
    Önceki sürümler pasife alınır; giriş onayı istenen belgelerde üyeler yeni
    sürümü bir sonraki girişte tekrar onaylar."""
    _yonetici_only(current_admin)
    entry = _catalog_entry(code)
    pdf_url = str((data or {}).get("pdf_url") or "").strip()
    version = str((data or {}).get("version") or "").strip()[:30]
    reason = str((data or {}).get("change_reason") or "").strip()[:300]
    if not _PDF_URL_RE.match(pdf_url):
        raise HTTPException(status_code=400, detail="Önce PDF yükleyin")
    if not pdf_file_exists(pdf_url):
        raise HTTPException(status_code=400, detail="PDF dosyası bulunamadı, tekrar yükleyin")
    if not version:
        raise HTTPException(status_code=400, detail="Sürüm gerekli (ör: 2.0 ya da 2026-10)")
    if await db.legal_documents.find_one({"document_code": code, "version": version}, {"_id": 1}):
        raise HTTPException(status_code=400, detail=f"{version} sürümü zaten var; yeni bir sürüm numarası girin")
    now = now_utc()
    await db.legal_documents.update_many({"document_code": code}, {"$set": {"is_active": False, "active": False, "updated_at": now}})
    doc = {
        "id": "doc_" + uuid.uuid4().hex[:12], "document_code": code, "name": entry["name"], "version": version,
        "pdf_url": pdf_url, "change_reason": reason, "status": "published", "is_active": True, "active": True,
        "created_at": now, "updated_at": now, "published_at": now, "revision_date": now,
        "created_by": current_admin.get("user_id"), "published_by": current_admin.get("user_id"),
    }
    await db.legal_documents.insert_one(dict(doc))
    await _insert_log("log_admin", {"admin_id": current_admin["user_id"], "admin_name": current_admin.get("name", ""), "action": "legal_document_published", "target_type": "legal", "target_id": doc["id"], "change_details": {"document_code": code, "version": version, "reason": reason}, "admin_note": ""}, request)
    return {"success": True, "document": {k: v for k, v in doc.items()}}


@router.post("/admin/legal-catalog/{code}/activate")
async def admin_activate_legal_version(code: str, data: dict, current_admin: dict = Depends(get_current_admin), request: Request = None):
    """Eski bir sürümü yeniden yürürlüğe al (yanlış belge yüklendiyse geri dönüş)."""
    _yonetici_only(current_admin)
    _catalog_entry(code)
    doc_id = str((data or {}).get("doc_id") or "")
    target = await db.legal_documents.find_one({"id": doc_id, "document_code": code}, {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail="Sürüm bulunamadı")
    now = now_utc()
    await db.legal_documents.update_many({"document_code": code}, {"$set": {"is_active": False, "active": False, "updated_at": now}})
    await db.legal_documents.update_one({"id": doc_id}, {"$set": {"is_active": True, "active": True, "status": "published", "published_at": now, "updated_at": now}})
    await _insert_log("log_admin", {"admin_id": current_admin["user_id"], "admin_name": current_admin.get("name", ""), "action": "legal_document_reactivated", "target_type": "legal", "target_id": doc_id, "change_details": {"document_code": code, "version": target.get("version")}, "admin_note": ""}, request)
    return {"success": True}


@router.post("/admin/legal-catalog/{code}/use-default")
async def admin_legal_use_default(code: str, current_admin: dict = Depends(get_current_admin), request: Request = None):
    """Yüklenen sürümleri pasife al; varsayılan (sunucudaki) PDF'e dön."""
    _yonetici_only(current_admin)
    _catalog_entry(code)
    await db.legal_documents.update_many({"document_code": code}, {"$set": {"is_active": False, "active": False, "updated_at": now_utc()}})
    await _insert_log("log_admin", {"admin_id": current_admin["user_id"], "admin_name": current_admin.get("name", ""), "action": "legal_document_default", "target_type": "legal", "target_id": code, "change_details": {"document_code": code}, "admin_note": ""}, request)
    return {"success": True}


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
            entry = _CATALOG_BY_CODE.get(code) or {}
            url = doc.get("pdf_url")
            pending.append({
                "document_code": code,
                "name": doc.get("name"),
                "version": current_ver,
                # dosyası kayıpsa varsayılan PDF (okunabilsin)
                "pdf_url": url if pdf_file_exists(url) else entry.get("default_pdf"),
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
