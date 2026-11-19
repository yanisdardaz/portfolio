"""Moteur d'analyse de QR Sentinel (version Python).

Même logique que ``js/analyzer.js`` : fonctions pures, sans réseau. Les deux
implémentations sont vérifiées avec les mêmes cas (``tests/cases.json``).
"""

from __future__ import annotations

import json
import math
import re
from functools import lru_cache
from pathlib import Path
from typing import Any

RULES_PATH = Path(__file__).resolve().parents[2] / "data" / "rules.json"

DANGEROUS_SCHEMES = ("javascript", "data", "vbscript", "file", "blob")


@lru_cache(maxsize=1)
def load_rules(path: str | None = None) -> dict[str, Any]:
    with open(path or RULES_PATH, encoding="utf-8") as fh:
        return json.load(fh)


# --------------------------------------------------------------------- utils


def fmt(template: str, values: dict[str, Any]) -> str:
    return re.sub(r"\{(\w+)\}", lambda m: str(values.get(m.group(1), "")), template)


def _trim_dot(host: str) -> str:
    return host.rstrip(".")


def _is_ipv4(host: str) -> bool:
    m = re.fullmatch(r"(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})", host)
    return bool(m) and all(int(g) <= 255 for g in m.groups())


def is_ip_host(host: str) -> bool:
    if not host:
        return False
    if host.startswith("[") or ":" in host:
        return True
    if _is_ipv4(host):
        return True
    return bool(re.fullmatch(r"0x[0-9a-f]+|\d+", host, re.I))


def ends_with_domain(host: str, domain: str) -> bool:
    return host == domain or host.endswith("." + domain)


def match_suffix_list(host: str, items: list[str]) -> str | None:
    for item in items:
        if ends_with_domain(host, item):
            return item
    return None


def registrable_domain(host: str, rules: dict[str, Any]) -> str:
    host = _trim_dot((host or "").lower())
    if not host or is_ip_host(host):
        return host
    labels = host.split(".")
    if len(labels) <= 2:
        return host
    best = None
    for suffix in rules["multi_part_suffixes"] + rules["free_hosting"]:
        if ends_with_domain(host, suffix) and host != suffix:
            if best is None or len(suffix) > len(best):
                best = suffix
    take = len(best.split(".")) + 1 if best else 2
    return ".".join(labels[-take:])


def host_tokens(host: str) -> list[str]:
    return [t for t in re.split(r"[.\-]+", host) if t]


def keyword_in_host(keyword: str, host: str) -> bool:
    k = keyword.replace("-", "")
    tokens = host_tokens(host)
    if len(k) < 5:
        return k in tokens
    if len(k) == 5:
        return any(t.startswith(k) for t in tokens)
    return k in re.sub(r"[.\-]", "", host)


def _is_official_for(host: str, domains: list[str]) -> bool:
    return any(ends_with_domain(host, d) for d in domains)


# ------------------------------------------------------------------ payloads


def _parse_wifi(raw: str) -> dict[str, Any]:
    body = raw[5:]
    fields = {}
    for m in re.finditer(r"([A-Z]+):((?:\\.|[^;])*);", body):
        fields[m.group(1)] = re.sub(r"\\(.)", r"\1", m.group(2))
    auth = fields.get("T", "").upper()
    return {
        "ssid": fields.get("S", ""),
        "security": auth or "nopass",
        "open": not auth or auth == "NOPASS",
        "hidden": bool(re.fullmatch(r"true", fields.get("H", ""), re.I)),
    }


def _clean_number(number: str) -> str:
    return re.sub(r"[\s.\-()]", "", number or "")


_DOMAIN_LIKE = re.compile(
    r"^(?:www\.)?[a-z0-9\-]+(?:\.[a-z0-9\-]+)*\.[a-z]{2,}(?::\d+)?(?:[/?#]\S*)?$", re.I
)


def parse_payload(raw: Any) -> dict[str, Any]:
    text = ("" if raw is None else str(raw)).lstrip("﻿").strip()

    if re.match(r"wifi:", text, re.I):
        return {"type": "wifi", "raw": text, "data": _parse_wifi(text)}

    sms = re.match(r"^(?:smsto|sms|mmsto):([^:?]*)(?:[:?](?:body=)?([\s\S]*))?$", text, re.I)
    if sms:
        return {"type": "sms", "raw": text,
                "data": {"number": _clean_number(sms.group(1)), "body": sms.group(2) or ""}}

    if re.match(r"tel:", text, re.I):
        return {"type": "tel", "raw": text, "data": {"number": _clean_number(text[4:])}}

    if re.match(r"mailto:", text, re.I):
        return {"type": "email", "raw": text, "data": {"address": text[7:].split("?")[0]}}
    matmsg = re.match(r"MATMSG:TO:([^;]*);", text, re.I)
    if matmsg:
        return {"type": "email", "raw": text, "data": {"address": matmsg.group(1)}}

    if re.match(r"begin:vcard", text, re.I) or re.match(r"mecard:", text, re.I):
        return {"type": "vcard", "raw": text, "data": {}}
    if re.match(r"geo:", text, re.I):
        return {"type": "geo", "raw": text, "data": {"coords": text[4:]}}

    crypto = re.match(r"(bitcoin|ethereum|litecoin|bitcoincash|dogecoin|monero|tron|solana|usdt):", text, re.I)
    if crypto:
        return {"type": "crypto", "raw": text, "data": {"currency": crypto.group(1).lower()}}

    scheme = re.match(r"([a-z][a-z0-9+.\-]*):", text, re.I)
    if scheme and scheme.group(1).lower() in DANGEROUS_SCHEMES:
        return {"type": "url", "raw": text, "url": text, "data": {"scheme": scheme.group(1).lower()}}

    if re.match(r"https?://", text, re.I):
        return {"type": "url", "raw": text, "url": re.split(r"\s", text)[0], "data": {}}

    if _DOMAIN_LIKE.match(text) and not re.search(r"\s", text):
        return {"type": "url", "raw": text, "url": "http://" + text, "data": {"implicitScheme": True}}

    embedded = re.search(r"https?://[^\s\"'<>]+", text, re.I)
    if embedded:
        return {"type": "url", "raw": text, "url": embedded.group(0), "data": {"embedded": True}}

    if not text:
        return {"type": "text", "raw": text, "data": {"empty": True}}
    return {"type": "text", "raw": text, "data": {}}


# ---------------------------------------------------------------------- URLs

_URL_RE = re.compile(r"^([a-z][a-z0-9+.\-]*)://([^/?#]*)([^?#]*)(\?[^#]*)?(#.*)?$", re.I | re.S)


def split_url(url: str) -> dict[str, str] | None:
    m = _URL_RE.match(url)
    if not m:
        return None
    authority = m.group(2)
    at = authority.rfind("@")
    userinfo = authority[:at] if at != -1 else ""
    hostport = authority[at + 1:] if at != -1 else authority
    host, port = hostport, ""
    if hostport.startswith("["):
        end = hostport.find("]")
        host, port = hostport[: end + 1], hostport[end + 2:]
    elif ":" in hostport:
        idx = hostport.rfind(":")
        host, port = hostport[:idx], hostport[idx + 1:]
    return {
        "scheme": m.group(1).lower(),
        "userinfo": userinfo,
        "host": host,
        "port": port,
        "path": m.group(3) or "",
        "query": m.group(4) or "",
    }


def to_ascii_host(host: str) -> str:
    host = _trim_dot(host.lower())
    if host.startswith("[") or host.isascii():
        return host
    try:
        return host.encode("idna").decode("ascii")
    except UnicodeError:
        return host


def _reason(rules: dict, rid: str, values: dict | None = None, points: int | None = None) -> dict:
    pts = rules["weights"][rid] if points is None else points
    level = "danger" if pts >= 30 else "warn" if pts > 0 else "good" if pts < 0 else "info"
    return {"id": rid, "points": pts, "level": level, "message": fmt(rules["messages"][rid], values or {})}


def analyze_url(url: str, rules: dict, resolved_shortener: bool = False) -> dict[str, Any]:
    reasons: list[dict] = []
    info: dict[str, Any] = {"url": url, "host": "", "domain": "", "scheme": ""}
    sm = re.match(r"([a-z][a-z0-9+.\-]*):", url, re.I)
    scheme = sm.group(1).lower() if sm else ""
    info["scheme"] = scheme

    if scheme in DANGEROUS_SCHEMES:
        reasons.append(_reason(rules, "dangerous_scheme", {"scheme": scheme}))
        return {"reasons": reasons, "info": info, "forceDangerous": True}

    parts = split_url(url)
    if not parts:
        return {"reasons": reasons, "info": info}

    host = to_ascii_host(parts["host"])
    domain = registrable_domain(host, rules)
    info.update(host=host, domain=domain)

    if parts["scheme"] == "http":
        reasons.append(_reason(rules, "no_https"))
    if parts["userinfo"]:
        reasons.append(_reason(rules, "userinfo", {"host": host}))

    ip = is_ip_host(host)
    info["isIP"] = ip
    if ip:
        reasons.append(_reason(rules, "ip_host", {"host": host}))
    if not ip and any(label.startswith("xn--") for label in host.split(".")):
        reasons.append(_reason(rules, "punycode", {"host": host}))
    if parts["port"] and parts["port"] not in ("80", "443"):
        reasons.append(_reason(rules, "nonstandard_port", {"port": parts["port"]}))

    official = False
    if not ip:
        shortener = match_suffix_list(host, rules["shorteners"])
        info["shortener"] = shortener
        if shortener:
            reasons.append(_reason(rules, "shortener_resolved" if resolved_shortener else "shortener", {"host": host}))

        platform = match_suffix_list(host, rules["free_hosting"])
        info["freeHosting"] = platform
        if platform:
            reasons.append(_reason(rules, "free_hosting", {"platform": platform}))

        labels = host.split(".")
        tld, tld2 = labels[-1], ".".join(labels[-2:])
        if tld2 in rules["suspicious_tlds"]:
            reasons.append(_reason(rules, "suspicious_tld", {"tld": tld2}))
        elif tld in rules["suspicious_tlds"]:
            reasons.append(_reason(rules, "suspicious_tld", {"tld": tld}))

        official_suffix = match_suffix_list(host, rules["official_suffixes"])
        impersonated = None
        for brand in rules["brands"]:
            if _is_official_for(host, brand["domains"]):
                official = True
                continue
            if platform and host == platform:
                continue
            if impersonated is None and any(keyword_in_host(k, host) for k in brand["keywords"]):
                impersonated = brand
        if official_suffix:
            official = True

        if impersonated and not official:
            reasons.append(_reason(rules, "brand_impersonation",
                                   {"brand": impersonated["name"], "official": impersonated["domains"][0]}))
        elif not official_suffix and any(t in ("gouv", "gouvfr", "gov") for t in host_tokens(host)):
            reasons.append(_reason(rules, "gov_impersonation"))

        if official and not platform:
            reasons.append(_reason(rules, "official_domain", {"domain": domain}))
        info["official"] = bool(official and not platform)

        sub = len(host.split(".")) - len(domain.split("."))
        if sub >= rules["limits"]["subdomain_labels"]:
            reasons.append(_reason(rules, "many_subdomains", {"host": host}))

        hyphens = re.sub(r"(^|\.)xn--", r"\1", domain).count("-")
        if hyphens >= rules["limits"]["hyphens"]:
            reasons.append(_reason(rules, "many_hyphens", {"host": domain}))

    if not info.get("official"):
        haystack = (host + " " + parts["path"] + " " + parts["query"]).lower()
        tokens = [t for t in re.split(r"[^a-z0-9]+", haystack) if t]
        found: list[str] = []
        for kw in rules["phishing_keywords"]:
            if len(found) >= rules["limits"]["phishing_keyword_max"]:
                break
            if (kw in haystack) if "-" in kw else (kw in tokens):
                found.append(kw)
        for word in found:
            reasons.append(_reason(rules, "phishing_keyword", {"word": word}))

    if len(url) > rules["limits"]["long_url_chars"]:
        reasons.append(_reason(rules, "long_url", {"length": len(url)}))

    ext = re.search(r"\.([a-z0-9]{1,5})$", parts["path"], re.I)
    if ext and ext.group(1).lower() in rules["download_extensions"]:
        info["downloadByExtension"] = ext.group(1).lower()

    return {"reasons": reasons, "info": info, "official": info.get("official", False)}


# ------------------------------------------------------------------ contexte


def _context_reasons(ctx: dict, static: dict, rules: dict) -> list[dict]:
    reasons: list[dict] = []
    info = static["info"]
    lim = rules["limits"]

    if ctx.get("blocklisted"):
        reasons.append(_reason(rules, "blocklisted", {"sources": ", ".join(ctx["blocklisted"])}))

    age = ctx.get("domainAgeDays")
    if isinstance(age, (int, float)) and not isinstance(age, bool) and not info.get("isIP") and not info.get("freeHosting"):
        d = max(0, math.floor(age))
        if d < lim["age_very_new_days"]:
            reasons.append(_reason(rules, "age_very_new", {"days": d}))
        elif d < lim["age_new_days"]:
            reasons.append(_reason(rules, "age_new", {"days": d}))
        elif d >= lim["age_old_days"]:
            reasons.append(_reason(rules, "age_old", {"years": d // 365}))
    elif "domainAgeDays" in ctx and age is None and ctx.get("ageChecked") and not info.get("isIP") and not info.get("freeHosting"):
        reasons.append(_reason(rules, "age_unknown"))

    hops = ctx.get("hops")
    if isinstance(hops, int) and hops > lim["redirect_hops"]:
        reasons.append(_reason(rules, "many_redirects", {"hops": hops}))
    if ctx.get("crossDomain") and not ctx.get("fromShortener"):
        reasons.append(_reason(rules, "cross_domain_redirect",
                               {"from": ctx["crossDomain"]["from"], "to": ctx["crossDomain"]["to"]}))
    if ctx.get("htmlRedirect"):
        reasons.append(_reason(rules, "html_redirect", {"kind": ctx["htmlRedirect"]}))
    if ctx.get("tlsError"):
        reasons.append(_reason(rules, "tls_error", {"detail": ctx["tlsError"]}))
    if ctx.get("unreachable"):
        reasons.append(_reason(rules, "unreachable", {"detail": ctx["unreachable"]}))

    download = ctx.get("download") or info.get("downloadByExtension")
    if download:
        reasons.append(_reason(rules, "file_download", {"file": download}))

    if ctx.get("passwordForm") and not info.get("official"):
        young = not isinstance(age, (int, float)) or isinstance(age, bool) or age < lim["age_new_days"]
        if young or info.get("freeHosting") or info.get("isIP"):
            reasons.append(_reason(rules, "password_form"))
    return reasons


def _is_premium(number: str, rules: dict) -> bool:
    n = _clean_number(number)
    return any(n.startswith(p) for p in rules["premium_phone_prefixes"])


def _payload_reasons(payload: dict, rules: dict) -> list[dict]:
    d = payload["data"]
    t = payload["type"]
    if t == "wifi":
        return [_reason(rules, "wifi_open" if d["open"] else "wifi_payload", {"ssid": d["ssid"]})]
    if t == "sms":
        out = [_reason(rules, "sms_payload", {"number": d["number"] or "(inconnu)"})]
        digits = d["number"].lstrip("+")
        if re.fullmatch(r"\d{4,6}", digits):
            out.append(_reason(rules, "sms_shortcode", {"number": d["number"]}))
        elif _is_premium(d["number"], rules):
            out.append(_reason(rules, "tel_premium", {"number": d["number"]}))
        return out
    if t == "tel":
        out = [_reason(rules, "tel_payload", {"number": d["number"]})]
        if _is_premium(d["number"], rules):
            out.append(_reason(rules, "tel_premium", {"number": d["number"]}))
        return out
    if t == "email":
        return [_reason(rules, "email_payload", {"address": d["address"]})]
    if t == "crypto":
        return [_reason(rules, "crypto_payment", {"currency": d["currency"]})]
    if t == "vcard":
        return [_reason(rules, "vcard_payload")]
    if t == "geo":
        return [_reason(rules, "geo_payload")]
    return [_reason(rules, "text_payload")]


def verdict_for(score: int, force: bool, rules: dict) -> str:
    if force or score >= rules["thresholds"]["dangerous"]:
        return "dangereux"
    if score >= rules["thresholds"]["suspect"]:
        return "suspect"
    return "sur"


def analyze(raw: Any, rules: dict | None = None, ctx: dict | None = None) -> dict[str, Any]:
    rules = rules or load_rules()
    ctx = ctx or {}
    payload = parse_payload(raw)
    force = False
    target = None
    info: dict[str, Any] = {}

    if payload["type"] == "url":
        target = ctx.get("finalUrl") or payload["url"]
        st = analyze_url(target, rules, resolved_shortener=bool(ctx.get("resolved")))
        if ctx.get("finalUrl") and ctx["finalUrl"] != payload["url"]:
            first = analyze_url(payload["url"], rules, resolved_shortener=True)
            for r in first["reasons"]:
                if r["id"] in ("shortener_resolved", "dangerous_scheme"):
                    st["reasons"].insert(0, r)
            if first.get("forceDangerous"):
                st["forceDangerous"] = True
        reasons = st["reasons"] + _context_reasons(ctx, st, rules)
        force = bool(st.get("forceDangerous"))
        info = st["info"]
    else:
        reasons = _payload_reasons(payload, rules)

    if ctx.get("blocklisted"):
        force = True

    score = max(0, min(100, sum(r["points"] for r in reasons)))
    if force:
        score = 100

    return {
        "verdict": verdict_for(score, force, rules),
        "score": score,
        "reasons": reasons,
        "payload": payload,
        "target": target,
        "info": info,
    }
