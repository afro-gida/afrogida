"""Kullanıcıya/uygulamaya dönen dokümanları güvenli hale getiren dönüştürücüler."""
from services.noshow import _evaluate_no_show_restriction


def _public_user_doc(user: dict) -> dict:
    """Kullanıcı dokümanından hassas alanları çıkarır, no-show durumunu türetir,
    marketing_consent'i uygulamanın beklediği {accepted: bool} biçimine getirir."""
    doc = {k: v for k, v in user.items() if k not in ("_id", "password_hash", "username")}
    try:
        ns = _evaluate_no_show_restriction(user)
        doc["online_only"] = ns["online_only"]
        doc["online_only_indefinite"] = ns["indefinite"]
        doc["no_show_count"] = ns["count"]
        doc["online_only_message"] = ns["message"]
        doc["online_only_until"] = ns["until"].isoformat() if ns.get("until") else None
    except Exception:
        pass
    mc = doc.get("marketing_consent")
    if mc is None:
        doc["marketing_consent"] = {"accepted": False}
    elif isinstance(mc, bool):
        doc["marketing_consent"] = {"accepted": mc}
    elif isinstance(mc, dict) and "accepted" not in mc:
        doc["marketing_consent"] = {"accepted": False}
    return doc
