"""Suivi sécurisé des redirections.

- Ne télécharge que le début des pages HTML (aucun JavaScript n'est exécuté).
- Suit les redirections HTTP (3xx), les balises <meta http-equiv="refresh">
  et les redirections JavaScript simples (``location.href = "..."``).
- Protection SSRF : chaque nom de domaine est résolu puis la connexion se fait
  directement vers l'adresse IP vérifiée (adresses privées, locales, réservées
  refusées). Le certificat TLS est vérifié pour le vrai nom de domaine.
"""

from __future__ import annotations

import http.client
import ipaddress
import re
import socket
import ssl
import time
from dataclasses import asdict, dataclass, field
from typing import Callable
from urllib.parse import quote, urljoin, urlsplit

from .analyzer import load_rules

USER_AGENT = (
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 "
    "(KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1"
)

HTML_TYPES = ("text/html", "application/xhtml+xml", "text/plain", "")

_META_TAG = re.compile(r"<meta\b[^>]*>", re.I)
_META_REFRESH = re.compile(r"http-equiv\s*=\s*[\"']?\s*refresh", re.I)
_META_CONTENT = re.compile(r"content\s*=\s*(\"[^\"]*\"|'[^']*'|[^\s>]+)", re.I)
_REFRESH_URL = re.compile(r"^\s*\d*(?:\.\d+)?\s*[;,]?\s*url\s*=\s*['\"]?([^'\"]+)", re.I)
_JS_REDIRECTS = [
    re.compile(r"(?:window\.|document\.|top\.|self\.)?location(?:\.href)?\s*=\s*[\"']([^\"']+)[\"']", re.I),
    re.compile(r"location\.(?:replace|assign)\(\s*[\"']([^\"']+)[\"']\s*\)", re.I),
]
_PASSWORD = re.compile(r"<input\b[^>]*type\s*=\s*[\"']?password", re.I)
_TITLE = re.compile(r"<title[^>]*>(.*?)</title>", re.I | re.S)


class BlockedAddress(Exception):
    """Le domaine pointe vers une adresse interdite (réseau privé, localhost…)."""


@dataclass
class Hop:
    url: str
    status: int | None = None
    kind: str = "http"  # comment on est arrivé ici : http | meta refresh | javascript
    ip: str | None = None
    content_type: str | None = None
    location: str | None = None


@dataclass
class FetchResult:
    start_url: str
    final_url: str
    hops: list[Hop] = field(default_factory=list)
    error: str | None = None
    tls_error: str | None = None
    unreachable: str | None = None
    blocked: str | None = None
    html_redirect: str | None = None
    download: str | None = None
    password_form: bool = False
    title: str | None = None

    def to_dict(self) -> dict:
        d = asdict(self)
        d["hops"] = [asdict(h) for h in self.hops]
        return d


# ---------------------------------------------------------------- connexions


def _connect_any(ips: list[str], port: int, timeout: float) -> socket.socket:
    """Se connecte à la première adresse vérifiée qui répond (IPv6 puis IPv4…)."""
    last: OSError | None = None
    for ip in ips:
        try:
            return socket.create_connection((ip, port), timeout)
        except OSError as exc:
            last = exc
    raise last or OSError("aucune adresse")


class _HTTPConn(http.client.HTTPConnection):
    def __init__(self, host: str, ips: list[str], port: int, timeout: float):
        super().__init__(host, port=port, timeout=timeout)
        self._ips = ips

    def connect(self) -> None:
        self.sock = _connect_any(self._ips, self.port, self.timeout)


class _HTTPSConn(http.client.HTTPSConnection):
    def __init__(self, host: str, ips: list[str], port: int, timeout: float, context: ssl.SSLContext):
        super().__init__(host, port=port, timeout=timeout, context=context)
        self._ips = ips

    def connect(self) -> None:
        sock = _connect_any(self._ips, self.port, self.timeout)
        self.sock = self._context.wrap_socket(sock, server_hostname=self.host)


def _tls_message(err: Exception) -> str:
    text = str(getattr(err, "verify_message", "") or err).lower()
    if "expired" in text:
        return "certificat expiré"
    if "self-signed" in text or "self signed" in text:
        return "certificat auto-signé"
    if "hostname" in text or "mismatch" in text or "not valid for" in text:
        return "certificat émis pour un autre site"
    if "unable to get local issuer" in text or "unknown ca" in text:
        return "autorité de certification inconnue"
    return "connexion sécurisée impossible"


def is_public_ip(ip: str) -> bool:
    addr = ipaddress.ip_address(ip)
    if isinstance(addr, ipaddress.IPv6Address) and addr.ipv4_mapped:
        addr = addr.ipv4_mapped
    return addr.is_global and not addr.is_multicast


class SafeFetcher:
    def __init__(
        self,
        allow_private: bool = False,
        timeout: float = 6.0,
        max_hops: int = 10,
        max_body: int = 256 * 1024,
        total_budget: float = 25.0,
        resolver: Callable = socket.getaddrinfo,
        ssl_context: ssl.SSLContext | None = None,
    ):
        self.allow_private = allow_private
        self.timeout = timeout
        self.max_hops = max_hops
        self.max_body = max_body
        self.total_budget = total_budget
        self.resolver = resolver
        self.ssl_context = ssl_context or ssl.create_default_context()

    # -- résolution DNS vérifiée
    def resolve(self, host: str, port: int) -> list[str]:
        infos = self.resolver(host, port, 0, socket.SOCK_STREAM)
        ips = []
        for info in infos:
            ip = info[4][0]
            if ip not in ips:
                ips.append(ip)
        if not ips:
            raise socket.gaierror("aucune adresse")
        if not self.allow_private:
            for ip in ips:
                if not is_public_ip(ip):
                    raise BlockedAddress(ip)
        return ips

    def _request(self, url: str):
        parts = urlsplit(url)
        host = parts.hostname or ""
        try:
            host_ascii = host.encode("idna").decode("ascii") if not host.isascii() else host
        except UnicodeError:
            host_ascii = host
        port = parts.port or (443 if parts.scheme == "https" else 80)
        ips = self.resolve(host_ascii, port)
        if parts.scheme == "https":
            conn = _HTTPSConn(host_ascii, ips, port, self.timeout, self.ssl_context)
        else:
            conn = _HTTPConn(host_ascii, ips, port, self.timeout)
        target = parts.path or "/"
        if parts.query:
            target += "?" + parts.query
        target = quote(target, safe="/%?=&:+,;@!$'()*[]~-._")
        conn.request("GET", target, headers={
            "User-Agent": USER_AGENT,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.5",
            "Accept-Encoding": "identity",
            "Connection": "close",
        })
        resp = conn.getresponse()
        ip = conn.sock.getpeername()[0] if conn.sock else ips[0]
        return conn, resp, ip

    @staticmethod
    def find_html_redirect(html: str) -> tuple[str, str] | None:
        for tag in _META_TAG.findall(html):
            if _META_REFRESH.search(tag):
                content = _META_CONTENT.search(tag)
                if content:
                    value = content.group(1).strip("\"'")
                    m = _REFRESH_URL.match(value)
                    if m:
                        return m.group(1).strip(), "meta refresh"
        for pattern in _JS_REDIRECTS:
            m = pattern.search(html)
            if m:
                return m.group(1).strip(), "javascript"
        return None

    def follow(self, url: str) -> FetchResult:
        result = FetchResult(start_url=url, final_url=url)
        seen: set[str] = set()
        current = url
        kind = "http"
        deadline = time.monotonic() + self.total_budget

        for _ in range(self.max_hops + 1):
            hop = Hop(url=current, kind=kind)
            result.hops.append(hop)
            result.final_url = current

            scheme = urlsplit(current).scheme.lower()
            if scheme not in ("http", "https"):
                break  # javascript:, data:… : on s'arrête, l'analyse le signalera
            if current in seen:
                result.error = "boucle de redirections"
                break
            seen.add(current)
            if time.monotonic() > deadline:
                result.error = "analyse trop longue"
                break

            try:
                conn, resp, ip = self._request(current)
            except BlockedAddress as exc:
                result.blocked = f"adresse interne refusée ({exc})"
                result.unreachable = "le lien pointe vers un réseau privé"
                break
            except ssl.SSLError as exc:
                result.tls_error = _tls_message(exc)
                break
            except socket.gaierror:
                result.unreachable = "domaine introuvable"
                break
            except (TimeoutError, socket.timeout):
                result.unreachable = "délai dépassé"
                break
            except (ConnectionError, OSError, http.client.HTTPException) as exc:
                result.unreachable = "connexion impossible"
                result.error = type(exc).__name__
                break

            try:
                hop.ip = ip
                hop.status = resp.status
                ctype = (resp.getheader("Content-Type") or "").split(";")[0].strip().lower()
                hop.content_type = ctype or None
                location = resp.getheader("Location")

                if 300 <= resp.status < 400 and location:
                    hop.location = location
                    current = urljoin(current, location.strip())
                    kind = "http"
                    continue

                disposition = (resp.getheader("Content-Disposition") or "").lower()
                if "attachment" in disposition:
                    m = re.search(r"filename\*?=(?:utf-8'')?[\"']?([^\"';]+)", disposition)
                    result.download = m.group(1) if m else "pièce jointe"
                    break
                if ctype and ctype not in HTML_TYPES:
                    if ctype in load_rules()["download_content_types"]:
                        result.download = ctype
                    break
                if resp.status >= 400:
                    result.error = f"erreur HTTP {resp.status}"
                    break

                body = resp.read(self.max_body)
                charset = resp.headers.get_content_charset() or "utf-8"
                html = body.decode(charset, errors="replace")
            except (TimeoutError, socket.timeout, OSError, http.client.HTTPException):
                result.error = "réponse incomplète"
                break
            finally:
                conn.close()

            if _PASSWORD.search(html):
                result.password_form = True
            title = _TITLE.search(html)
            if title:
                result.title = re.sub(r"\s+", " ", title.group(1)).strip()[:200]

            redirect = self.find_html_redirect(html)
            if redirect:
                target, rkind = redirect
                result.html_redirect = result.html_redirect or rkind
                current = urljoin(current, target)
                kind = rkind
                continue
            break
        else:
            result.error = "trop de redirections"

        return result
