import shutil
import ssl
import subprocess
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest

from quishing.fetcher import SafeFetcher

pytestmark = pytest.mark.skipif(shutil.which("openssl") is None, reason="openssl absent")


class _H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_GET(self):
        self.send_response(200)
        self.send_header("Content-Type", "text/html")
        self.end_headers()
        self.wfile.write(b"<p>ok</p>")


@pytest.fixture(scope="module")
def https_site(tmp_path_factory):
    d = tmp_path_factory.mktemp("tls")
    subprocess.run(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
                    "-subj", "/CN=localhost", "-keyout", str(d / "k.pem"), "-out", str(d / "c.pem")],
                   check=True, capture_output=True)
    srv = ThreadingHTTPServer(("127.0.0.1", 0), _H)
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    ctx.load_cert_chain(d / "c.pem", d / "k.pem")
    srv.socket = ctx.wrap_socket(srv.socket, server_side=True)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    yield srv.server_address[1], d / "c.pem"
    srv.shutdown()


def test_self_signed_certificate_is_flagged(https_site):
    port, _ = https_site
    r = SafeFetcher(allow_private=True, timeout=3).follow(f"https://localhost:{port}/")
    assert r.tls_error == "certificat auto-signé"


def test_trusted_certificate_passes(https_site):
    port, cert = https_site
    ctx = ssl.create_default_context(cafile=str(cert))
    r = SafeFetcher(allow_private=True, timeout=3, ssl_context=ctx).follow(f"https://localhost:{port}/")
    assert r.tls_error is None and r.hops[0].status == 200
