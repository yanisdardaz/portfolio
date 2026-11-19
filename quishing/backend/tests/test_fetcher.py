import socket

import pytest

from quishing.fetcher import BlockedAddress, SafeFetcher, is_public_ip

from . import fake_site


@pytest.fixture(scope="module")
def site():
    srv, base = fake_site.start()
    yield base
    srv.shutdown()


@pytest.fixture
def fetcher():
    return SafeFetcher(allow_private=True, timeout=3)


def test_simple_page(site, fetcher):
    r = fetcher.follow(site + "/ok")
    assert r.final_url == site + "/ok"
    assert len(r.hops) == 1 and r.hops[0].status == 200
    assert r.title == "Menu du jour"
    assert not r.password_form and r.error is None


def test_http_redirect_chain(site, fetcher):
    r = fetcher.follow(site + "/r1")
    assert [h.status for h in r.hops] == [301, 302, 307, 200]
    assert r.final_url == site + "/ok"
    assert r.html_redirect is None


@pytest.mark.parametrize("path,kind,final", [
    ("/meta", "meta refresh", "/login"),
    ("/meta2", "meta refresh", "/ok"),
    ("/js", "javascript", "/login"),
    ("/js2", "javascript", "/ok"),
])
def test_html_redirects(site, fetcher, path, kind, final):
    r = fetcher.follow(site + path)
    assert r.html_redirect == kind
    assert r.final_url == site + final
    assert r.hops[-1].kind == kind


def test_password_form_detected(site, fetcher):
    r = fetcher.follow(site + "/meta")
    assert r.password_form is True
    assert r.title == "Payer votre amende"


def test_loop(site, fetcher):
    r = fetcher.follow(site + "/loop")
    assert r.error == "boucle de redirections"


def test_too_many_redirects(site):
    f = SafeFetcher(allow_private=True, timeout=3, max_hops=3)
    r = f.follow(site + "/chain/10")
    assert r.error == "trop de redirections"
    assert len(r.hops) == 4


def test_downloads(site, fetcher):
    assert fetcher.follow(site + "/apk").download == "application/vnd.android.package-archive"
    assert fetcher.follow(site + "/attach").download == "facture.exe"


def test_http_error(site, fetcher):
    r = fetcher.follow(site + "/404")
    assert r.error == "erreur HTTP 404"


def test_redirect_to_javascript_scheme(site, fetcher):
    r = fetcher.follow(site + "/js-scheme")
    assert r.final_url == "javascript:alert(1)"


def test_private_addresses_blocked_by_default(site):
    r = SafeFetcher(timeout=3).follow(site + "/ok")
    assert r.blocked and "127.0.0.1" in r.blocked
    assert r.hops[0].status is None


def test_dns_rebinding_style_resolution_blocked():
    def resolver(host, port, *a):
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("93.184.216.34", port)),
                (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("10.0.0.5", port))]
    f = SafeFetcher(resolver=resolver)
    with pytest.raises(BlockedAddress):
        f.resolve("evil.example", 80)


def test_unknown_domain():
    def resolver(*a):
        raise socket.gaierror("nope")
    r = SafeFetcher(resolver=resolver).follow("https://does-not-exist.invalid/")
    assert r.unreachable == "domaine introuvable"


@pytest.mark.parametrize("ip,public", [
    ("8.8.8.8", True), ("127.0.0.1", False), ("10.1.2.3", False), ("192.168.0.1", False),
    ("169.254.169.254", False), ("100.64.0.1", False), ("::1", False), ("::ffff:127.0.0.1", False),
    ("2606:4700:4700::1111", True), ("0.0.0.0", False), ("224.0.0.1", False),
])
def test_is_public_ip(ip, public):
    assert is_public_ip(ip) is public


def test_html_redirect_parser():
    f = SafeFetcher.find_html_redirect
    assert f('<META HTTP-EQUIV="Refresh" CONTENT="5;URL=https://x.y/">') == ("https://x.y/", "meta refresh")
    assert f("<script>document.location = 'https://a.b/c'</script>") == ("https://a.b/c", "javascript")
    assert f("<p>rien</p>") is None
