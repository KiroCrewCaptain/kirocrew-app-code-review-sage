"""``review_driver``'s two loopback call sites must not proxy the gateway secret.

Both carry ``X-Internal-Secret`` to ``http://localhost:<port>``, and urllib has
no implicit loopback exemption, so with ``HTTP_PROXY`` set the secret goes to
the proxy in cleartext. The port probe is the worse of the two: ``_gateway_base``
calls ``_probe`` once per candidate port (``KIROCREW_PORT``, the configured port,
then six literals), so one cold resolve that misses can send the secret up to
seven times.

Real sockets on port 0, following ``test_cron_trigger.py`` -- the kernel hands
out a free port, so no ``xdist_group`` marker is needed. Assertions read what
each listener actually received rather than inspecting the opener, because the
opener shape is already covered by ``test_loopback_proxy.py``; what is new here
is that these two product functions route through it.

Ported from Kiro Crew's ``test/test_review_driver_loopback.py``.
"""

import http.server
import threading
import urllib.request

import pytest

from code_review_sage.sage_lib import review_driver

CANARY = "canary-not-a-real-secret"
SECRET_HEADER = "X-Internal-Secret"

_PROXY_ENV_KEYS = (
    "http_proxy",
    "HTTP_PROXY",
    "https_proxy",
    "HTTPS_PROXY",
    "all_proxy",
    "ALL_PROXY",
    "no_proxy",
    "NO_PROXY",
    # getproxies_environment ignores uppercase HTTP_PROXY when REQUEST_METHOD is
    # set (the httpoxy CGI guard), which would silently disarm these tests.
    "REQUEST_METHOD",
)


def _make_handler(sink):
    """Handler that records the secret it saw and answers with an empty artifact list."""

    class Handler(http.server.BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def _record_and_reply(self):
            length = int(self.headers.get("Content-Length") or 0)
            if length:
                self.rfile.read(length)
            sink.append(
                {"requestline": self.requestline, "secret": self.headers.get(SECRET_HEADER)}
            )
            body = b'{"artifacts": []}'
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        do_GET = _record_and_reply    # noqa: N815 - stdlib naming
        do_POST = _record_and_reply   # noqa: N815 - stdlib naming

        def log_message(self, fmt, *args):
            pass  # keep pytest output clean

    return Handler


def _serve(sink):
    server = http.server.HTTPServer(("127.0.0.1", 0), _make_handler(sink))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server, server.server_address[1]


@pytest.fixture()
def listeners(monkeypatch):
    """A stand-in gateway and a stand-in proxy, with the proxy named by the env."""
    gateway_hits: list[dict] = []
    proxy_hits: list[dict] = []
    gateway, gateway_port = _serve(gateway_hits)
    proxy, proxy_port = _serve(proxy_hits)
    for key in _PROXY_ENV_KEYS:
        monkeypatch.delenv(key, raising=False)
    monkeypatch.setenv("http_proxy", f"http://127.0.0.1:{proxy_port}")
    try:
        yield {
            "gateway_hits": gateway_hits,
            "proxy_hits": proxy_hits,
            "gateway_base": f"http://127.0.0.1:{gateway_port}",
        }
    finally:
        gateway.shutdown()
        proxy.shutdown()


def _assert_reached_gateway_only(listeners):
    assert listeners["proxy_hits"] == [], f"secret reached the proxy: {listeners['proxy_hits']}"
    assert [h["secret"] for h in listeners["gateway_hits"]] == [CANARY]


class TestReviewDriverLoopbackCallsIgnoreTheProxy:
    """Regression guard for the two secret-bearing loopback sites in review_driver."""

    def test_api_request_does_not_proxy_the_secret(self, monkeypatch, listeners):
        monkeypatch.setattr(review_driver, "_gateway_base", lambda: listeners["gateway_base"])
        monkeypatch.setattr(review_driver, "_local_secret", lambda *_a: CANARY)

        # A real parse of the gateway's body proves the request landed there and
        # was not merely swallowed by _api_request's blanket except.
        assert review_driver._api_request("GET", "/api/artifacts?tag=sage-report") == {
            "artifacts": []
        }
        _assert_reached_gateway_only(listeners)

    def test_probe_does_not_proxy_the_secret(self, listeners):
        """The multiplied site: one miss per candidate port, each a full send."""
        assert review_driver._probe(listeners["gateway_base"], CANARY) is True
        _assert_reached_gateway_only(listeners)

    def test_the_fallback_does_not_proxy_the_secret(self, listeners):
        """A host without the gateway's helper must not degrade to a bare, proxy-honouring urlopen.

        The built-in defined its fallback in an ``except ImportError`` branch, which
        this test once reached by re-executing the module head. The fallback is now
        a named function the module binds when the host's ``loopback_urlopen`` is
        missing, so it is exercised directly.
        """
        fallback = review_driver._fallback_loopback_urlopen
        req = urllib.request.Request(
            listeners["gateway_base"] + "/api/spawn", headers={SECRET_HEADER: CANARY}
        )
        with fallback(req, timeout=5) as resp:
            assert resp.status == 200
        _assert_reached_gateway_only(listeners)

    def test_the_host_helper_is_used_when_the_gateway_has_one(self):
        from kiro_crew.loopback_http import loopback_urlopen

        assert review_driver.loopback_urlopen is loopback_urlopen
