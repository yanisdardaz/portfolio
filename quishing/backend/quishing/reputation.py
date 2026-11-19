"""Réputation des liens : listes de sites malveillants connus.

Sources :
- OpenPhish (flux public gratuit, sans clé) — activé par défaut ;
- URLhaus d'abuse.ch (clé gratuite, variable URLHAUS_AUTH_KEY) ;
- Google Safe Browsing (clé gratuite, variable GSB_API_KEY).

Chaque source est optionnelle : si elle est indisponible, l'analyse continue.
"""

from __future__ import annotations

import json
import threading
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from typing import Callable
from urllib.parse import urlsplit

UA = "QR-Sentinel/1.0 (analyse de QR codes)"


def _post(url: str, data: bytes, headers: dict, timeout: float = 6.0) -> bytes:
    req = urllib.request.Request(url, data=data, headers={"User-Agent": UA, **headers}, method="POST")
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read(1024 * 1024)


def _get(url: str, timeout: float = 10.0) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read(20 * 1024 * 1024)


def normalize(url: str) -> str:
    parts = urlsplit(url.strip())
    path = parts.path or "/"
    q = ("?" + parts.query) if parts.query else ""
    return f"{parts.scheme.lower()}://{(parts.hostname or '').lower()}{path}{q}"


class OpenPhishFeed:
    name = "OpenPhish"
    enabled = True
    FEED_URL = "https://openphish.com/feed.txt"

    def __init__(self, fetch: Callable[[str], bytes] = _get, refresh: float = 1800, shared_hosts: set | None = None):
        self.fetch = fetch
        self.refresh = refresh
        self.shared_hosts = shared_hosts or set()
        self._urls: set[str] = set()
        self._hosts: set[str] = set()
        self._loaded_at = 0.0
        self._ok = False
        self._lock = threading.Lock()

    def _load(self) -> None:
        with self._lock:
            if time.monotonic() - self._loaded_at < self.refresh and self._loaded_at:
                return
            self._loaded_at = time.monotonic()
            try:
                lines = self.fetch(self.FEED_URL).decode("utf-8", errors="ignore").splitlines()
            except Exception:
                self._ok = bool(self._urls)
                return
            urls, hosts = set(), set()
            for line in lines:
                line = line.strip()
                if not line.startswith(("http://", "https://")):
                    continue
                urls.add(normalize(line))
                host = (urlsplit(line).hostname or "").lower()
                if host and not any(host == h or host.endswith("." + h) for h in self.shared_hosts):
                    hosts.add(host)
            self._urls, self._hosts, self._ok = urls, hosts, True

    def check(self, url: str) -> dict:
        self._load()
        if not self._ok:
            return {"source": self.name, "status": "indisponible"}
        host = (urlsplit(url).hostname or "").lower()
        if normalize(url) in self._urls or host in self._hosts:
            return {"source": self.name, "status": "listé"}
        return {"source": self.name, "status": "non listé"}


class URLhaus:
    name = "URLhaus"
    API = "https://urlhaus-api.abuse.ch/v1/url/"

    def __init__(self, auth_key: str | None, post: Callable = _post):
        self.auth_key = auth_key
        self.post = post
        self.enabled = bool(auth_key)

    def check(self, url: str) -> dict:
        if not self.auth_key:
            return {"source": self.name, "status": "non configuré"}
        try:
            raw = self.post(self.API, urllib.parse.urlencode({"url": url}).encode(),
                            {"Auth-Key": self.auth_key, "Content-Type": "application/x-www-form-urlencoded"})
            data = json.loads(raw)
        except Exception:
            return {"source": self.name, "status": "indisponible"}
        status = data.get("query_status")
        if status == "ok":
            return {"source": self.name, "status": "listé", "detail": data.get("threat")}
        if status == "no_results":
            return {"source": self.name, "status": "non listé"}
        return {"source": self.name, "status": "indisponible"}


class SafeBrowsing:
    name = "Google Safe Browsing"
    API = "https://safebrowsing.googleapis.com/v4/threatMatches:find?key="

    def __init__(self, api_key: str | None, post: Callable = _post):
        self.api_key = api_key
        self.post = post
        self.enabled = bool(api_key)

    def check(self, url: str) -> dict:
        if not self.api_key:
            return {"source": self.name, "status": "non configuré"}
        body = {
            "client": {"clientId": "qr-sentinel", "clientVersion": "1.0"},
            "threatInfo": {
                "threatTypes": ["MALWARE", "SOCIAL_ENGINEERING", "UNWANTED_SOFTWARE", "POTENTIALLY_HARMFUL_APPLICATION"],
                "platformTypes": ["ANY_PLATFORM"],
                "threatEntryTypes": ["URL"],
                "threatEntries": [{"url": url}],
            },
        }
        try:
            raw = self.post(self.API + urllib.parse.quote(self.api_key), json.dumps(body).encode(),
                            {"Content-Type": "application/json"})
            data = json.loads(raw or b"{}")
        except Exception:
            return {"source": self.name, "status": "indisponible"}
        if data.get("matches"):
            return {"source": self.name, "status": "listé", "detail": data["matches"][0].get("threatType")}
        return {"source": self.name, "status": "non listé"}


class ReputationChecker:
    def __init__(self, sources: list):
        self.sources = sources
        self._pool = ThreadPoolExecutor(max_workers=8)

    def check(self, urls: list[str]) -> dict:
        """Vérifie chaque URL auprès de chaque source. Renvoie le détail et les sources qui alertent."""
        urls = list(dict.fromkeys(u for u in urls if u.startswith(("http://", "https://"))))[:10]
        jobs = [(u, s, self._pool.submit(s.check, u)) for u in urls for s in self.sources]
        per_source: dict[str, dict] = {s.name: {"source": s.name, "status": "non vérifié"} for s in self.sources}
        listed: list[str] = []
        rank = {"listé": 3, "non listé": 2, "indisponible": 1, "non configuré": 0, "non vérifié": -1}
        for url, source, fut in jobs:
            try:
                res = fut.result(timeout=12)
            except Exception:
                res = {"source": source.name, "status": "indisponible"}
            if res["status"] == "listé":
                res = {**res, "url": url}
                if source.name not in listed:
                    listed.append(source.name)
            if rank.get(res["status"], 0) > rank.get(per_source[source.name]["status"], 0):
                per_source[source.name] = res
        return {"sources": list(per_source.values()), "listed": listed}
