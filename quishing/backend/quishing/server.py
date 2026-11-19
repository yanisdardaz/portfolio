"""Serveur HTTP de QR Sentinel (bibliothèque standard uniquement).

Routes :
  GET  /api/health    état du service et sources de réputation actives
  POST /api/analyze   {"payload": "<contenu du QR code>"} → rapport d'analyse
  GET  /…             fichiers de l'interface web (dossier quishing/)

Variables d'environnement :
  PORT                    port d'écoute (défaut 8000)
  ALLOWED_ORIGINS         origines CORS autorisées, séparées par des virgules (défaut *)
  RATE_LIMIT_PER_MIN      analyses par minute et par IP (défaut 20)
  TRUST_PROXY             1 pour lire l'IP cliente dans X-Forwarded-For (Render, Fly…)
  URLHAUS_AUTH_KEY        clé URLhaus (optionnelle)
  GSB_API_KEY             clé Google Safe Browsing (optionnelle)
  OPENPHISH               0 pour désactiver le flux OpenPhish
"""

from __future__ import annotations

import json
import mimetypes
import os
import sys
import threading
import time
from collections import defaultdict, deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

from .service import MAX_PAYLOAD, Analyzer

STATIC_ROOT = Path(__file__).resolve().parents[2]
STATIC_ALLOWED = ("index.html", "css/", "js/", "data/", "vendor/", "img/")
MAX_BODY = 16 * 1024


class RateLimiter:
    def __init__(self, per_minute: int):
        self.per_minute = per_minute
        self._hits: dict[str, deque] = defaultdict(deque)
        self._lock = threading.Lock()

    def allow(self, key: str) -> bool:
        if self.per_minute <= 0:
            return True
        now = time.monotonic()
        with self._lock:
            q = self._hits[key]
            while q and now - q[0] > 60:
                q.popleft()
            if len(q) >= self.per_minute:
                return False
            q.append(now)
            if len(self._hits) > 10000:  # évite une croissance infinie
                for k in [k for k, v in self._hits.items() if not v]:
                    del self._hits[k]
            return True


def make_handler(analyzer: Analyzer, origins: list[str], limiter: RateLimiter, trust_proxy: bool):
    class Handler(BaseHTTPRequestHandler):
        server_version = "QRSentinel/1.0"
        sys_version = ""

        def log_message(self, fmt, *args):  # journal court, sans le contenu analysé
            sys.stderr.write("%s %s\n" % (self.command, urlsplit(self.path).path))

        # -- utilitaires
        def _client_ip(self) -> str:
            if trust_proxy:
                fwd = self.headers.get("X-Forwarded-For")
                if fwd:
                    return fwd.split(",")[0].strip()
            return self.client_address[0]

        def _cors(self) -> None:
            origin = self.headers.get("Origin")
            if "*" in origins:
                self.send_header("Access-Control-Allow-Origin", "*")
            elif origin and origin in origins:
                self.send_header("Access-Control-Allow-Origin", origin)
                self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.send_header("Access-Control-Max-Age", "86400")

        def _security_headers(self) -> None:
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Referrer-Policy", "no-referrer")
            self.send_header("X-Frame-Options", "DENY")

        def _json(self, status: int, body: dict) -> None:
            data = json.dumps(body, ensure_ascii=False).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-store")
            self._cors()
            self._security_headers()
            self.end_headers()
            self.wfile.write(data)

        # -- routes
        def do_OPTIONS(self):
            self.send_response(204)
            self._cors()
            self.end_headers()

        def do_GET(self):
            path = urlsplit(self.path).path
            if path == "/api/health":
                return self._json(200, {
                    "ok": True,
                    "service": "qr-sentinel",
                    "version": analyzer.rules.get("version", 1),
                    "reputation": [{"source": s.name, "active": bool(s.enabled)}
                                   for s in analyzer.reputation.sources],
                })
            if path.startswith("/api/"):
                return self._json(404, {"error": "route inconnue"})
            return self._static(path)

        def do_POST(self):
            if urlsplit(self.path).path != "/api/analyze":
                return self._json(404, {"error": "route inconnue"})
            if not limiter.allow(self._client_ip()):
                return self._json(429, {"error": "trop de demandes, réessaie dans une minute"})
            try:
                length = int(self.headers.get("Content-Length") or 0)
            except ValueError:
                length = -1
            if length <= 0 or length > MAX_BODY:
                return self._json(400, {"error": "requête invalide"})
            try:
                body = json.loads(self.rfile.read(length).decode("utf-8"))
            except (UnicodeDecodeError, json.JSONDecodeError):
                return self._json(400, {"error": "JSON invalide"})
            payload = body.get("payload") if isinstance(body, dict) else None
            if not isinstance(payload, str) or not payload.strip():
                return self._json(400, {"error": "le champ « payload » est requis"})
            if len(payload) > MAX_PAYLOAD:
                return self._json(413, {"error": "contenu trop long"})
            try:
                report = analyzer.analyze(payload)
            except Exception as exc:  # ne jamais planter le serveur
                sys.stderr.write(f"erreur d'analyse : {type(exc).__name__}: {exc}\n")
                return self._json(500, {"error": "erreur interne pendant l'analyse"})
            return self._json(200, report)

        def _static(self, path: str):
            rel = path.lstrip("/") or "index.html"
            target = (STATIC_ROOT / rel).resolve()
            # Le contrôle se fait sur le chemin résolu (après « .. » et liens symboliques)
            if not target.is_relative_to(STATIC_ROOT) or not target.is_file():
                return self._json(404, {"error": "introuvable"})
            if not target.relative_to(STATIC_ROOT).as_posix().startswith(STATIC_ALLOWED):
                return self._json(404, {"error": "introuvable"})
            data = target.read_bytes()
            ctype = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
            if ctype.startswith("text/") or ctype in ("application/javascript", "application/json"):
                ctype += "; charset=utf-8"
            self.send_response(200)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "public, max-age=300")
            self._security_headers()
            self.end_headers()
            self.wfile.write(data)

    return Handler


def build_server(host: str = "0.0.0.0", port: int = 8000, analyzer: Analyzer | None = None) -> ThreadingHTTPServer:
    analyzer = analyzer or Analyzer.from_env()
    origins = [o.strip() for o in os.environ.get("ALLOWED_ORIGINS", "*").split(",") if o.strip()]
    limiter = RateLimiter(int(os.environ.get("RATE_LIMIT_PER_MIN", "20")))
    trust_proxy = os.environ.get("TRUST_PROXY") == "1"
    server = ThreadingHTTPServer((host, port), make_handler(analyzer, origins, limiter, trust_proxy))
    server.daemon_threads = True
    return server


def main() -> None:
    port = int(os.environ.get("PORT", "8000"))
    server = build_server(port=port)
    print(f"QR Sentinel écoute sur http://0.0.0.0:{port}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
