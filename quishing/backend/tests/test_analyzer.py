import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest

from quishing import analyzer as A

ROOT = Path(__file__).resolve().parents[2]
CASES = json.loads((ROOT / "tests" / "cases.json").read_text(encoding="utf-8"))
RULES = A.load_rules()


@pytest.mark.parametrize("case", CASES, ids=[c["name"] for c in CASES])
def test_shared_case(case):
    r = A.analyze(case["payload"], RULES, case.get("ctx"))
    ids = [x["id"] for x in r["reasons"]]
    e = case["expect"]
    assert r["verdict"] == e["verdict"], (r["score"], ids)
    if "score" in e:
        assert r["score"] == e["score"]
    if "type" in e:
        assert r["payload"]["type"] == e["type"]
    for rid in e.get("has", []):
        assert rid in ids
    for rid in e.get("not", []):
        assert rid not in ids
    for reason in r["reasons"]:
        assert reason["message"] and not re.search(r"\{\w+\}", reason["message"])


@pytest.mark.skipif(shutil.which("node") is None, reason="Node.js absent")
def test_parity_with_javascript():
    """Le moteur Python et le moteur JS doivent donner exactement le même résultat."""
    out = subprocess.run(["node", str(ROOT / "tests" / "js" / "dump.js")],
                         capture_output=True, text=True, check=True, cwd=ROOT)
    js = json.loads(out.stdout)
    for case, jr in zip(CASES, js):
        pr = A.analyze(case["payload"], RULES, case.get("ctx"))
        py = {"verdict": pr["verdict"], "score": pr["score"], "type": pr["payload"]["type"],
              "target": pr["target"],
              "reasons": [[x["id"], x["points"], x["message"]] for x in pr["reasons"]]}
        jr = {k: jr[k] for k in py}
        assert py == jr, case["name"]


def test_registrable_domain():
    d = lambda h: A.registrable_domain(h, RULES)
    assert d("www.example.com") == "example.com"
    assert d("a.b.example.co.uk") == "example.co.uk"
    assert d("www.impots.gouv.fr") == "impots.gouv.fr"
    assert d("evil.github.io") == "evil.github.io"
    assert d("10.0.0.1") == "10.0.0.1"


def test_ip_hosts():
    for h in ["1.2.3.4", "[::1]", "3232235777", "0xC0A80001"]:
        assert A.is_ip_host(h), h
    for h in ["example.com", "999.1.1.1", "1.2.3"]:
        assert not A.is_ip_host(h), h


def test_keyword_matching():
    assert A.keyword_in_host("paypal", "paypalsecure.com")
    assert A.keyword_in_host("ups", "ups-livraison.fr")
    assert not A.keyword_in_host("ups", "groups.com")
    assert not A.keyword_in_host("apple", "pineapple.com")


def test_wifi_escapes():
    p = A.parse_payload(r"WIFI:S:Mon\;Reseau;T:WPA;P:a\:b;;")
    assert p["data"]["ssid"] == "Mon;Reseau"
    assert p["data"]["open"] is False


def test_score_bounds():
    r = A.analyze("http://paypal-amazon-ameli-login-verify.xyz:8080/a?" + "x" * 200)
    assert 0 <= r["score"] <= 100
