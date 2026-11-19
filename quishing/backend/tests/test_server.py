import json
import threading
import urllib.error
import urllib.request

import pytest

from quishing.fetcher import SafeFetcher
from quishing.rdap import RdapClient
from quishing.reputation import OpenPhishFeed, ReputationChecker
from quishing.server import build_server
from quishing.service import Analyzer

from . import fake_site


@pytest.fixture(scope="module")
def site():
    srv, base = fake_site.start()
    yield base
    srv.shutdown()


@pytest.fixture(scope="module")
def api(site):
    feed = f"{site}/login\n".encode()
    analyzer = Analyzer(
        fetcher=SafeFetcher(allow_private=True, timeout=3),
        rdap=RdapClient(fetch_json=lambda u: None),
        reputation=ReputationChecker([OpenPhishFeed(fetch=lambda u: feed)]),
    )
    mp = pytest.MonkeyPatch()
    mp.setenv("RATE_LIMIT_PER_MIN", "1000")
    srv = build_server("127.0.0.1", 0, analyzer)
    mp.undo()
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{srv.server_address[1]}"
    srv.shutdown()


def call(base, path, body=None, raw=None, headers=None):
    data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
    req = urllib.request.Request(base + path, data=data, headers={"Content-Type": "application/json", **(headers or {})})
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return r.status, dict(r.headers), r.read()
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), e.read()


def analyze(api, payload):
    status, headers, body = call(api, "/api/analyze", {"payload": payload})
    assert status == 200, body
    return json.loads(body)


def test_health(api):
    status, headers, body = call(api, "/api/health")
    data = json.loads(body)
    assert status == 200 and data["ok"] is True
    assert headers["Access-Control-Allow-Origin"] == "*"
    assert data["reputation"] == [{"source": "OpenPhish", "active": True}]


def test_redirect_chain_report(api, site):
    r = analyze(api, site + "/r1")
    assert r["mode"] == "serveur"
    net = r["network"]
    assert net["followed"] and net["final_url"] == site + "/ok"
    assert [h["status"] for h in net["redirects"]] == [301, 302, 307, 200]
    ids = [x["id"] for x in r["reasons"]]
    assert "ip_host" in ids and "no_https" in ids
    assert r["target"] == site + "/ok"
    assert net["domain"] is None  # pas de RDAP pour une IP


def test_hidden_redirect_to_blocklisted_login(api, site):
    r = analyze(api, site + "/meta")
    ids = [x["id"] for x in r["reasons"]]
    assert {"html_redirect", "password_form", "blocklisted"} <= set(ids)
    assert r["verdict"] == "dangereux" and r["score"] == 100
    assert r["network"]["title"] == "Payer votre amende"


def test_download(api, site):
    r = analyze(api, site + "/apk")
    assert "file_download" in [x["id"] for x in r["reasons"]]
    assert r["verdict"] == "dangereux"


def test_non_url_payload(api):
    r = analyze(api, "WIFI:T:nopass;S:Gare;;")
    assert r["payload"]["type"] == "wifi" and r["network"]["followed"] is False


def test_javascript_payload_is_not_fetched(api):
    r = analyze(api, "javascript:alert(1)")
    assert r["verdict"] == "dangereux" and r["network"]["followed"] is False


@pytest.mark.parametrize("raw,code", [
    (b"pas du json", 400),
    (json.dumps({"payload": ""}).encode(), 400),
    (json.dumps({"autre": 1}).encode(), 400),
    (json.dumps([1, 2]).encode(), 400),
    (json.dumps({"payload": "x" * 5000}).encode(), 413),
])
def test_bad_requests(api, raw, code):
    status, _, _ = call(api, "/api/analyze", raw=raw)
    assert status == code


def test_unknown_routes(api):
    assert call(api, "/api/nope")[0] == 404
    assert call(api, "/api/other", body={"payload": "x"})[0] == 404


def test_cors_preflight(api):
    req = urllib.request.Request(api + "/api/analyze", method="OPTIONS")
    with urllib.request.urlopen(req) as r:
        assert r.status == 204
        assert "POST" in r.headers["Access-Control-Allow-Methods"]


def test_static_files_and_traversal(api):
    status, headers, body = call(api, "/")
    assert status == 200 and b"QR Sentinel" in body
    assert headers["X-Content-Type-Options"] == "nosniff"
    assert call(api, "/js/analyzer.js")[0] == 200
    assert call(api, "/backend/quishing/server.py")[0] == 404
    assert call(api, "/js/../backend/quishing/server.py")[0] == 404
    assert call(api, "/css/../../index.html")[0] == 404


def test_rate_limit(site, monkeypatch):
    monkeypatch.setenv("RATE_LIMIT_PER_MIN", "2")
    srv = build_server("127.0.0.1", 0, Analyzer(fetcher=SafeFetcher(allow_private=True, timeout=3),
                                               rdap=RdapClient(fetch_json=lambda u: None),
                                               reputation=ReputationChecker([])))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{srv.server_address[1]}"
    codes = [call(base, "/api/analyze", {"payload": "bonjour"})[0] for _ in range(3)]
    srv.shutdown()
    assert codes == [200, 200, 429]
