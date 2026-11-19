"""Âge d'un nom de domaine via RDAP (successeur moderne du WHOIS).

On interroge https://rdap.org/domain/<domaine>, qui redirige vers le registre
officiel de l'extension (Verisign pour .com, AFNIC pour .fr, etc.).
"""

from __future__ import annotations

import json
import re
import threading
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from typing import Callable

RDAP_BASE = "https://rdap.org/domain/"
_DOMAIN_RE = re.compile(r"^[a-z0-9](?:[a-z0-9\-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9\-]{0,61}[a-z0-9])?)+$")


def _http_get_json(url: str, timeout: float = 6.0) -> dict | None:
    req = urllib.request.Request(url, headers={
        "Accept": "application/rdap+json, application/json",
        "User-Agent": "QR-Sentinel/1.0 (analyse de QR codes)",
    })
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read(512 * 1024).decode("utf-8", errors="replace"))
    except urllib.error.HTTPError as exc:
        if exc.code == 404:
            return None
        raise


def parse_rdap(data: dict, now: datetime | None = None) -> dict:
    now = now or datetime.now(timezone.utc)
    created = None
    for event in data.get("events", []) or []:
        if str(event.get("eventAction", "")).lower() in ("registration", "registered"):
            created = event.get("eventDate")
            break
    registrar = None
    for entity in data.get("entities", []) or []:
        if "registrar" in (entity.get("roles") or []):
            vcard = entity.get("vcardArray") or []
            if len(vcard) > 1:
                for item in vcard[1]:
                    if item and item[0] == "fn":
                        registrar = item[3]
                        break
            registrar = registrar or entity.get("handle")
            break
    age_days = None
    if created:
        try:
            dt = datetime.fromisoformat(created.replace("Z", "+00:00"))
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            age_days = max(0, (now - dt).days)
        except ValueError:
            created = None
    return {
        "domain": (data.get("ldhName") or "").lower() or None,
        "created": created,
        "age_days": age_days,
        "registrar": registrar,
    }


class RdapClient:
    def __init__(self, fetch_json: Callable[[str], dict | None] = _http_get_json, ttl: float = 24 * 3600):
        self.fetch_json = fetch_json
        self.ttl = ttl
        self._cache: dict[str, tuple[float, dict]] = {}
        self._lock = threading.Lock()

    def lookup(self, domain: str) -> dict:
        """Renvoie {domain, created, age_days, registrar, status}."""
        domain = (domain or "").lower().strip(".")
        if not _DOMAIN_RE.match(domain):
            return {"domain": domain, "created": None, "age_days": None, "registrar": None, "status": "invalide"}
        with self._lock:
            hit = self._cache.get(domain)
            if hit and time.monotonic() - hit[0] < self.ttl:
                return hit[1]

        candidates = [domain]
        labels = domain.split(".")
        if len(labels) > 2:
            candidates.append(".".join(labels[1:]))

        result = {"domain": domain, "created": None, "age_days": None, "registrar": None, "status": "introuvable"}
        for candidate in candidates:
            try:
                data = self.fetch_json(RDAP_BASE + candidate)
            except Exception:  # réseau, JSON invalide…
                result["status"] = "indisponible"
                break
            if data:
                parsed = parse_rdap(data)
                result = {**parsed, "domain": parsed["domain"] or candidate,
                          "status": "ok" if parsed["age_days"] is not None else "date inconnue"}
                break

        with self._lock:
            self._cache[domain] = (time.monotonic(), result)
        return result
