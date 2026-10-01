"""Yönetim > Sözleşmeler: belge kataloğu, yayınlama / eski sürüm / varsayılan,
müşteriye açık belge listesi ve siparişte onaylanan sürümün kaydı."""
import uuid

import pytest

from core.config import ROOT_DIR

_made = []


def PDF():  # noqa: N802
    """Diskte gerçekten duran (yüklenmiş gibi) test PDF'i."""
    name = f"contract_{uuid.uuid4().hex}.pdf"
    (ROOT_DIR / "uploads").mkdir(exist_ok=True)
    (ROOT_DIR / "uploads" / name).write_bytes(b"%PDF-1.4 test")
    _made.append(name)
    return f"/uploads/{name}"


@pytest.fixture(autouse=True, scope="module")
def _cleanup_pdfs():
    yield
    for name in _made:
        (ROOT_DIR / "uploads" / name).unlink(missing_ok=True)


def _public(client):
    return {d["document_code"]: d for d in client.get("/api/legal-docs").json()}


def test_public_docs_default_then_published(client, make_user, db):
    db.legal_documents.delete_many({"document_code": "membership"})
    pub = _public(client)
    assert len(pub) == 7
    assert pub["membership"]["pdf_url"] == "/legal/afrogida_02_uyelik_sozlesmesi.pdf" and pub["membership"]["version"] is None

    _, admin = make_user(role="yonetici")
    url = "/api/admin/legal-catalog/membership/publish"
    assert client.post(url, json={"pdf_url": "https://kotu.site/x.pdf", "version": "2.0"}, headers=admin).status_code == 400
    assert client.post(url, json={"pdf_url": PDF(), "version": ""}, headers=admin).status_code == 400
    first = PDF()
    assert client.post(url, json={"pdf_url": first, "version": "2.0", "change_reason": "Adres güncellendi"}, headers=admin).status_code == 200
    assert _public(client)["membership"]["pdf_url"] == first
    # aynı sürüm tekrar -> 400; yeni sürüm öncekini pasife alır
    assert client.post(url, json={"pdf_url": PDF(), "version": "2.0"}, headers=admin).status_code == 400
    second = PDF()
    assert client.post(url, json={"pdf_url": second, "version": "2.1"}, headers=admin).status_code == 200
    assert db.legal_documents.count_documents({"document_code": "membership", "is_active": True}) == 1
    assert _public(client)["membership"]["version"] == "2.1"

    # katalog: geçmiş + yürürlükteki
    cat = {c["code"]: c for c in client.get("/api/admin/legal-catalog", headers=admin).json()}
    m = cat["membership"]
    assert m["current"]["version"] == "2.1" and len(m["history"]) == 2 and m["login_gate"] is True
    old_id = next(h["id"] for h in m["history"] if h["version"] == "2.0")

    # eski sürüme dön, sonra varsayılana dön
    assert client.post("/api/admin/legal-catalog/membership/activate", json={"doc_id": old_id}, headers=admin).status_code == 200
    assert _public(client)["membership"]["pdf_url"] == first
    assert client.post("/api/admin/legal-catalog/membership/use-default", headers=admin).status_code == 200
    assert _public(client)["membership"]["pdf_url"].startswith("/legal/")


def test_missing_pdf_file_falls_back_to_default(client, make_user, db):
    """Eski siteden kalan kayıt: yürürlükte ama dosyası diskte yok -> müşteriye
    varsayılan PDF, yönetimde missing_file uyarısı."""
    db.legal_documents.update_many({"document_code": "pickupTerms"}, {"$set": {"is_active": False}})
    db.legal_documents.insert_one({"id": "doc_eski", "document_code": "pickupTerms", "version": "eski",
                                   "pdf_url": "/uploads/yok-boyle-bir-dosya.pdf", "is_active": True,
                                   "status": "published", "published_at": "2099-01-01"})
    assert _public(client)["pickupTerms"]["pdf_url"] == "/legal/afrogida_03_gel_al_sozlesmesi.pdf"
    _, admin = make_user(role="yonetici")
    cat = {c["code"]: c for c in client.get("/api/admin/legal-catalog", headers=admin).json()}
    assert cat["pickupTerms"]["missing_file"] is True
    # diskte olmayan dosya yayınlanamaz; yeni yüklenen (diskte olan) kullanılır
    bad = f"/uploads/contract_{uuid.uuid4().hex}.pdf"
    assert client.post("/api/admin/legal-catalog/pickupTerms/publish", json={"pdf_url": bad, "version": "x"}, headers=admin).status_code == 400
    good = PDF()
    assert client.post("/api/admin/legal-catalog/pickupTerms/publish", json={"pdf_url": good, "version": "yeni"}, headers=admin).status_code == 200
    assert _public(client)["pickupTerms"]["pdf_url"] == good


def test_legal_catalog_admin_only(client, make_user):
    _, sor = make_user(role="pazar_sorumlusu")
    _, member = make_user()
    for h in (sor, member):
        assert client.get("/api/admin/legal-catalog", headers=h).status_code in (401, 403)
        assert client.post("/api/admin/legal-catalog/kvkk/publish", json={"pdf_url": PDF(), "version": "9"}, headers=h).status_code in (401, 403)
    assert client.post("/api/admin/legal-catalog/yokboyle/publish", json={}, headers=make_user(role="yonetici")[1]).status_code == 404


def test_order_records_active_contract_version(client, make_user, db):
    _, admin = make_user(role="yonetici")
    ver = f"gelal-{uuid.uuid4().hex[:4]}"
    assert client.post("/api/admin/legal-catalog/pickupTerms/publish", json={"pdf_url": PDF(), "version": ver}, headers=admin).status_code == 200
    product = db.products.find_one({"name": "Salkım Domates"})
    _, h = make_user()
    r = client.post("/api/orders", json={"items": [{"id": product["id"], "qty": 1}], "delivery_type": "gel_al",
                                          "payment_method": "pay_at_counter", "agreements_accepted": True,
                                          "legal_document_type": "pickup"}, headers=h)
    assert r.status_code == 200, r.text
    log = db.legal_agreement_logs.find_one({"order_id": r.json()["order"]["tx_id"]})
    assert log["document_code"] == "pickupTerms" and log["document_version"] == ver and log["pdf_url"].endswith(".pdf")


def test_supplier_contract_status_and_url_check(client, make_user, db):
    _, admin = make_user(role="yonetici")
    make_user(role="esnaf", name="Onaylı Tedarikçi", supplier_contract_accepted_version="test-v1")
    r = client.get("/api/admin/supplier-contract-status", headers=admin)
    assert r.status_code == 200
    body = r.json()
    assert body["contract"]["version"]
    assert any(s["name"] == "Onaylı Tedarikçi" for s in body["suppliers"])
    assert client.post("/api/admin/supplier-contract", json={"url": "https://kotu.site/a.pdf", "version": "2"}, headers=admin).status_code == 400
