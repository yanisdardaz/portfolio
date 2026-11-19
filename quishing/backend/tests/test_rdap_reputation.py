import json
from datetime import datetime, timezone

from quishing.rdap import RDAP_BASE, RdapClient, parse_rdap
from quishing.reputation import OpenPhishFeed, ReputationChecker, SafeBrowsing, URLhaus

RDAP_SAMPLE = {
    "ldhName": "EXAMPLE.COM",
    "events": [{"eventAction": "last changed", "eventDate": "2024-08-14T07:01:34Z"},
               {"eventAction": "registration", "eventDate": "1995-08-14T04:00:00Z"}],
    "entities": [{"roles": ["registrar"], "handle": "376",
                  "vcardArray": ["vcard", [["version", {}, "text", "4.0"], ["fn", {}, "text", "RESERVED-IANA"]]]}],
}


def test_parse_rdap():
    now = datetime(2026, 1, 1, tzinfo=timezone.utc)
    r = parse_rdap(RDAP_SAMPLE, now)
    assert r["domain"] == "example.com"
    assert r["registrar"] == "RESERVED-IANA"
    assert r["created"] == "1995-08-14T04:00:00Z"
    assert r["age_days"] == (now - datetime(1995, 8, 14, 4, tzinfo=timezone.utc)).days


def test_rdap_falls_back_to_parent_and_caches():
    calls = []

    def fetch(url):
        calls.append(url)
        return RDAP_SAMPLE if url.endswith("/gouv.fr") else None

    c = RdapClient(fetch_json=fetch)
    r = c.lookup("impots.gouv.fr")
    assert r["status"] == "ok"
    assert calls == [RDAP_BASE + "impots.gouv.fr", RDAP_BASE + "gouv.fr"]
    c.lookup("impots.gouv.fr")
    assert len(calls) == 2  # cache


def test_rdap_rejects_bad_domain_and_handles_errors():
    c = RdapClient(fetch_json=lambda u: (_ for _ in ()).throw(OSError("réseau")))
    assert c.lookup("../etc/passwd")["status"] == "invalide"
    assert c.lookup("example.com")["status"] == "indisponible"
    assert RdapClient(fetch_json=lambda u: None).lookup("nope.com")["status"] == "introuvable"


FEED = b"https://evil-amende.top/pay\nhttps://user.github.io/phish\nhttp://bad.example/x?y=1\n"


def test_openphish_matches_url_and_host():
    f = OpenPhishFeed(fetch=lambda u: FEED, shared_hosts={"github.io"})
    assert f.check("https://evil-amende.top/autre")["status"] == "listé"  # même domaine
    assert f.check("HTTP://BAD.example/x?y=1")["status"] == "listé"
    assert f.check("https://user.github.io/phish")["status"] == "listé"
    assert f.check("https://other.github.io/")["status"] == "non listé"  # hébergeur partagé : URL exacte seulement
    assert f.check("https://example.org/")["status"] == "non listé"


def test_openphish_unavailable():
    def boom(u):
        raise OSError
    assert OpenPhishFeed(fetch=boom).check("https://a.b/")["status"] == "indisponible"


def test_urlhaus():
    assert URLhaus(None).check("https://a.b/")["status"] == "non configuré"
    hit = URLhaus("k", post=lambda *a: json.dumps({"query_status": "ok", "threat": "malware_download"}).encode())
    assert hit.check("https://a.b/")["status"] == "listé"
    miss = URLhaus("k", post=lambda *a: b'{"query_status": "no_results"}')
    assert miss.check("https://a.b/")["status"] == "non listé"


def test_safe_browsing():
    assert SafeBrowsing(None).check("https://a.b/")["status"] == "non configuré"
    hit = SafeBrowsing("k", post=lambda *a: b'{"matches": [{"threatType": "SOCIAL_ENGINEERING"}]}')
    assert hit.check("https://a.b/") == {"source": "Google Safe Browsing", "status": "listé", "detail": "SOCIAL_ENGINEERING"}
    assert SafeBrowsing("k", post=lambda *a: b"{}").check("https://a.b/")["status"] == "non listé"


def test_checker_aggregates():
    f = OpenPhishFeed(fetch=lambda u: FEED)
    rc = ReputationChecker([f, URLhaus(None)])
    r = rc.check(["https://short.ly/x", "https://evil-amende.top/pay", "javascript:alert(1)"])
    assert r["listed"] == ["OpenPhish"]
    by = {s["source"]: s for s in r["sources"]}
    assert by["OpenPhish"]["status"] == "listé" and by["OpenPhish"]["url"] == "https://evil-amende.top/pay"
    assert by["URLhaus"]["status"] == "non configuré"
