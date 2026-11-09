"""Every host seam this app reads, and what it does on a gateway without it.

The App Kit seams (``ctx.require_owner``, ``ctx.sdk_level``, ``ctx.audit``,
``ctx.http_app``) are read off the bound context with ``getattr``; the gateway
helpers with no seam are looked up by name (``sage_lib/_host.py``). For each one
this pins the fallback, and that the fallback is never MORE permissive than the
host: no owner gate refuses every write, no redaction withholds the text, no
link-safe reader refuses the read, no security event log refuses every tool
approval, no fair-admission gate refuses the review, no file lock refuses the
consolidation.
"""

from __future__ import annotations

import asyncio
import json
import logging
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

from code_review_sage.backend import _host, routes
from code_review_sage.sage_lib import _host as lib_host
from code_review_sage.sage_lib import learning, report, review_pool, store
from tests.fixtures import OwnerRequest
from tests.harness import make_ctx
from tests.test_review_pool import FakeHandle, _ev, _install_fake_runtime, _work_dir


def _body(resp) -> dict:
    return json.loads(resp.body)


class TestTheOwnerGate(unittest.IsolatedAsyncioTestCase):
    async def test_the_host_gate_gets_the_bare_operation_name(self) -> None:
        seen: list[str] = []

        async def gate(request, operation):
            seen.append(operation)
            return None

        _host.bind(SimpleNamespace(require_owner=gate))
        self.assertIsNone(await routes.require_owner_dashboard_request(object(), "code_review_sage.review"))
        self.assertEqual(seen, ["review"])

    async def test_the_host_refusal_is_returned_unchanged(self) -> None:
        refusal = object()

        async def gate(request, operation):
            return refusal

        _host.bind(SimpleNamespace(require_owner=gate))
        self.assertIs(await routes.require_owner_dashboard_request(object(), "x"), refusal)

    async def test_no_seam_refuses_everyone_the_owner_included(self) -> None:
        for ctx in (SimpleNamespace(), None):
            with self.subTest(ctx=ctx):
                _host.unbind()
                if ctx is not None:
                    _host.bind(ctx)
                resp = await routes.require_owner_dashboard_request(OwnerRequest(), "review")
                self.assertEqual(resp.status, 403)
                self.assertEqual(_body(resp)["code"], "owner_only")

    async def test_the_real_host_gate_admits_the_owner_and_audits_as_the_app(self) -> None:
        # The autouse context is the host's own AppContext.
        self.assertIsNone(await routes.require_owner_dashboard_request(OwnerRequest(), "review"))
        stranger = OwnerRequest()
        stranger["user"] = "someone-else"
        resp = await routes.require_owner_dashboard_request(stranger, "code_review_sage.review")
        self.assertEqual(resp.status, 403)


class TestTheAuditSeam(unittest.TestCase):
    def test_sel_writes_through_ctx_audit(self) -> None:
        sink = mock.Mock()
        _host.bind(SimpleNamespace(audit=sink))
        routes.sel().log_api_access(
            caller="code-review-sage", operation="update_review_settings",
            outcome="success", resources="config.json#review(effort)",
        )
        sink.record.assert_called_once_with(
            "update_review_settings", "success",
            resources="config.json#review(effort)", error="",
        )

    def test_no_seam_raises_so_the_caller_logs_it(self) -> None:
        _host.bind(SimpleNamespace())
        with self.assertRaises(_host.HostCapabilityMissing):
            routes.sel()


class TestTheCapabilityReport(unittest.TestCase):
    def test_a_level_0_gateway_without_seams_is_reported_degraded(self) -> None:
        health = mock.Mock()
        ctx = SimpleNamespace(data_dir=None, health=health)
        with self.assertLogs("kirocrew.app.code-review-sage", logging.WARNING):
            routes.register_routes(ctx)
        issues = [c.args[0] for c in health.mark_degraded.call_args_list]
        self.assertTrue(any("App Kit level 0" in i for i in issues), issues)
        self.assertTrue(any("ctx.require_owner" in i for i in issues), issues)
        self.assertTrue(any("ctx.audit" in i for i in issues), issues)
        self.assertTrue(any("ctx.http_app" in i for i in issues), issues)

    def test_a_level_1_gateway_reports_only_what_it_lacks(self) -> None:
        ctx = make_ctx(Path(tempfile.mkdtemp()), http_app={"state": SimpleNamespace()})
        self.assertEqual(_host.capability_issues(ctx), [])

    def test_a_context_naming_another_data_dir_is_logged(self) -> None:
        ctx = make_ctx(Path(tempfile.mkdtemp()))
        ctx.data_dir = Path(tempfile.mkdtemp()) / "elsewhere"
        with self.assertLogs("kirocrew.app.code-review-sage", logging.WARNING) as logs:
            routes.register_routes(ctx)
        self.assertTrue(any("is not the library's data directory" in m for m in logs.output))


class TestRedactionFailsClosed(unittest.TestCase):
    def test_the_host_passes_are_used(self) -> None:
        from kiro_crew.security import redact_credentials

        self.assertIs(store.redact_credentials, redact_credentials)
        self.assertNotIn("ghp_", store.redact_text("token ghp_" + "a" * 36))

    def test_no_host_passes_withhold_the_text(self) -> None:
        with mock.patch.object(store, "redact_credentials", None):
            self.assertEqual(store.redact_text("anything at all"), store.REDACTION_UNAVAILABLE)
            self.assertEqual(store.redact_text(""), "")
            # Every other module's redactor is this one.
            self.assertEqual(learning._redact("x"), store.REDACTION_UNAVAILABLE)
            from code_review_sage.sage_lib import pipeline, review_driver

            self.assertEqual(pipeline._redact("x"), store.REDACTION_UNAVAILABLE)
            self.assertEqual(review_driver._redact("x"), store.REDACTION_UNAVAILABLE)


class TestLinkSafeReadsFailClosed(unittest.TestCase):
    def test_no_host_reader_refuses_even_a_real_file(self) -> None:
        tmp = Path(tempfile.mkdtemp())
        target = tmp / "rec.json"
        target.write_text('{"ok": true}', encoding="utf-8")
        self.assertEqual(store.read_json_nolink(target, tmp), {"ok": True})
        with mock.patch.object(store, "hooks", None):
            self.assertIsNone(store.read_json_nolink(target, tmp))
            self.assertIsNone(store.read_text_nolink(target, tmp))


class TestTheHostLookup(unittest.TestCase):
    def test_a_missing_module_or_name_is_none(self) -> None:
        self.assertIsNone(lib_host.module("kiro_crew.no_such_module_here"))
        self.assertIsNone(lib_host.attr("kiro_crew.security", "no_such_name"))
        self.assertIsNotNone(lib_host.attr("kiro_crew.security", "redact_credentials"))

    def test_the_slug_grammar_restatement_is_the_hosts(self) -> None:
        from kiro_crew.artifacts import _SLUG_RE

        self.assertIs(report._SLUG_RE, _SLUG_RE)
        # The fallback a host without the name gets is the same pattern.
        import ast

        tree = ast.parse(Path(report.__file__).read_text(encoding="utf-8"))
        fallbacks = [
            node.args[0].value
            for node in ast.walk(tree)
            if isinstance(node, ast.Call)
            and ast.unparse(node.func) == "re.compile"
            and node.args
            and isinstance(node.args[0], ast.Constant)
            and "{0,78}" in str(node.args[0].value)
        ]
        self.assertEqual(fallbacks, [_SLUG_RE.pattern])


class TestTheConsolidationLockFailsClosed(unittest.TestCase):
    def test_no_host_lock_helpers_refuse_the_lock(self) -> None:
        with mock.patch.object(learning, "platform_compat", None):
            with self.assertRaises(OSError):
                learning._platform_compat()


class TestToolApprovalFailsClosed(unittest.IsolatedAsyncioTestCase):
    async def test_no_security_event_log_refuses_every_tool(self) -> None:
        script = [_ev(review_pool.EVENT_PERMISSION_REQUEST, request_id="r1",
                      title="shell", tool_kind="execute")]
        _install_fake_runtime(self, script=script)
        floor = mock.Mock(return_value=None)
        handles: list[FakeHandle] = []
        real_create = None

        with mock.patch.object(review_pool, "_sel", None), \
                mock.patch.object(review_pool, "refusal_for", floor), \
                mock.patch.object(review_pool, "_steer_host_deny", None):
            pool = review_pool.ReviewPool(work_dir=_work_dir(self))
            await pool.begin_batch()
            runtime, _backend = await pool._holder.acquire()
            real_create = runtime.create_session

            async def _create(*a, **k):
                h = await real_create(*a, **k)
                handles.append(h)
                return h

            runtime.create_session = _create
            await pool.send("t")
            await pool.end_batch()
        self.assertEqual(handles[0].rejections, ["r1"])
        self.assertEqual(handles[0].approvals, [])
        floor.assert_not_called()

    async def test_no_fair_admission_gate_refuses_the_review(self) -> None:
        real = lib_host.attr

        def _attr(module, name):
            if module.startswith("kiro_crew.shared_crew"):
                return None
            return real(module, name)

        _install_fake_runtime(self)
        pool = review_pool.ReviewPool(work_dir=_work_dir(self))
        with mock.patch.object(review_pool._host, "attr", _attr):
            with self.assertRaisesRegex(RuntimeError, "no Shared Crew admission gate"):
                await pool.send("t")
        await pool.shutdown()


class TestTheLoopBoundLock(unittest.TestCase):
    def test_one_lock_serves_successive_loops(self) -> None:
        lock = _host.LoopBoundLock()

        async def _use() -> bool:
            async with lock:
                return lock.locked()

        self.assertTrue(asyncio.run(_use()))
        self.assertTrue(asyncio.run(_use()))
        self.assertFalse(lock.locked())


class TestTheFolderHelpersFallBackSafely(unittest.TestCase):
    def test_without_the_mate_home_helper_no_folder_is_adopted(self) -> None:
        self.assertTrue(_host._fallback_home_owner_of([], "any"))

    def test_the_order_fallback_appends(self) -> None:
        self.assertEqual(_host._fallback_next_folder_order([]), 0)
        self.assertEqual(_host._fallback_next_folder_order([{"order": 3}, {"order": 1}]), 4)

    def test_the_host_helpers_are_used_when_present(self) -> None:
        from kiro_crew.dashboard.mate_folders import home_owner_of

        self.assertIs(_host.home_owner_of, home_owner_of)


class TestTheFallbackWrite(unittest.TestCase):
    def test_it_publishes_whole_and_owner_only(self) -> None:
        import os
        import stat

        tmp = Path(tempfile.mkdtemp())
        target = tmp / "runs.json"
        _host._fallback_atomic_write(target, "[]", restrict_to_owner=True)
        self.assertEqual(target.read_text(encoding="utf-8"), "[]")
        self.assertEqual(sorted(p.name for p in tmp.iterdir()), ["runs.json"])
        if os.name == "posix":
            self.assertEqual(stat.S_IMODE(target.stat().st_mode), 0o600)
        self.assertEqual(_host._fallback_read_bytes_with_retry(target), b"[]")
        self.assertEqual(_host._fallback_loads_user_json("\ufeff[1]"), [1])


if __name__ == "__main__":
    unittest.main()
