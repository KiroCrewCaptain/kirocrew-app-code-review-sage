"""The Code Review Sage cases of Kiro Crew's own repository-wide tests.

Each class is the code-review-sage half of a Kiro Crew test that also covers
other modules; the rest of each stays in Kiro Crew:

* ``test/test_chat_folder_created_at.py``: the follow-up folder row carries the
  dashboard's ``created_at`` stamp, so the sidebar's ``created`` sort orders it.
* ``test/test_windows_replace_retry_sweep.py``: the store's by-name publish (the
  branch Windows takes) survives a contended rename.
* ``test/test_security_source_scan_invariants.py``: no 502 body carries
  ``str(e)``, and the learning store uses no SHA-1.
* ``test/test_transport_permission_floor.py`` and
  ``test/test_surface_deny_notice_sites.py``: the review pool has exactly one
  tool-approval site, gated by the host's permission floor, and its one wire
  reject is preceded by the host-deny steer.
"""

from __future__ import annotations

import ast
import inspect
import os
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator
from unittest import mock

import pytest

from code_review_sage.backend import routes as sage_routes
from code_review_sage.sage_lib import review_pool, store

APP_ROOT = Path(__file__).resolve().parent.parent


class TestFollowupFolderCreatedAt:
    def test_the_follow_up_folder_row_writes_the_dashboard_stamp(self) -> None:
        assert '"created_at": time.time()' in inspect.getsource(
            sage_routes._ensure_followup_folder
        )


@contextmanager
def _replace_sharing_violation(*, match: str, times: int) -> Iterator[dict]:
    """Make ``os.replace()`` raise a Windows-style sharing violation *times* times."""
    real_replace = os.replace
    state = {"n": 0}

    def _patched(src, dst, *args, **kwargs):  # type: ignore[no-untyped-def]
        if os.path.basename(str(dst)) == match or match in str(dst) or match in str(src):
            state["n"] += 1
            if state["n"] <= times:
                raise PermissionError(f"[WinError 32] simulated sharing violation replacing {dst}")
        return real_replace(src, dst, *args, **kwargs)

    with mock.patch("os.replace", _patched):
        yield state


class TestStoreReplaceRetry:
    def test_by_name_publish_survives_a_contended_rename(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from kiro_crew import atomic_write, platform_compat

        # Windows, as Kiro Crew's sweep forces it: the host's retry only waits out a
        # sharing violation there, and without backoff so the test does not sleep.
        monkeypatch.setattr(platform_compat, "IS_WINDOWS", True)
        monkeypatch.setattr(atomic_write, "_REPLACE_BACKOFF_SECONDS", 0)
        # The by-name branch is the one Windows takes: it has no directory pinning.
        monkeypatch.setattr(store, "_CAN_PIN_DIR", False)
        directory = tmp_path / "records"
        directory.mkdir()
        target = directory / "record.json"
        with _replace_sharing_violation(match="record.json", times=2) as sim:
            store.atomic_write_locked(target, b'{"ok": true}')

        assert sim["n"] == 3
        assert target.read_bytes() == b'{"ok": true}'
        assert sorted(p.name for p in directory.iterdir()) == ["record.json"]


class TestSourceScanInvariants:
    def test_no_raw_exception_in_502_response(self) -> None:
        src = APP_ROOT / "backend" / "routes.py"
        text = "\n".join(
            p.read_text(encoding="utf-8")
            for p in [src, *sorted(src.with_name("routes_parts").glob("*.py"))]
        )
        lines_502 = [line for line in text.splitlines() if "status=502" in line]
        for line in lines_502:
            assert "str(e)" not in line, f"str(e) leaked in 502 response: {line.strip()}"

    def test_learning_uses_no_sha1(self) -> None:
        text = (APP_ROOT / "sage_lib" / "learning.py").read_text(encoding="utf-8")
        assert "hashlib.sha1(" not in text, "SHA-1 must be replaced with SHA-256"


def _pool_tree() -> ast.Module:
    return ast.parse(Path(review_pool.__file__).read_text(encoding="utf-8"))


def _owner(tree: ast.Module, target: ast.AST) -> str:
    parents = {child: parent for parent in ast.walk(tree) for child in ast.iter_child_nodes(parent)}
    node = parents.get(target)
    while node is not None and not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
        node = parents.get(node)
    assert node is not None
    return node.name


def _calls(tree: ast.Module, attr: str) -> list[ast.Call]:
    return [
        n
        for n in ast.walk(tree)
        if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute) and n.func.attr == attr
    ]


class TestToolPermissionSites:
    def test_the_pool_approves_a_tool_in_one_place(self) -> None:
        tree = _pool_tree()
        assert [_owner(tree, c) for c in _calls(tree, "approve_tool")] == ["_send"]

    def test_the_approval_is_gated_by_the_host_permission_floor(self) -> None:
        source = inspect.getsource(review_pool.ReviewPool._send)
        assert source.index("refusal_for") < source.index(".approve_tool(")
        assert source.index("SEL_UNAVAILABLE_REFUSAL") < source.index(".approve_tool(")

    def test_the_one_wire_reject_is_preceded_by_the_host_deny_steer(self) -> None:
        tree = _pool_tree()
        text = Path(review_pool.__file__).read_text(encoding="utf-8")
        assert text.count(".reject_tool(") == 1
        found = []
        for node in ast.walk(tree):
            for field in ("body", "orelse", "finalbody"):
                stmts = getattr(node, field, None)
                if not (isinstance(stmts, list) and stmts and isinstance(stmts[0], ast.stmt)):
                    continue
                for i, stmt in enumerate(stmts):
                    if ".reject_tool(" in ast.unparse(stmt) and isinstance(stmt, ast.Expr):
                        found.append((stmts, i))
        assert len(found) == 1
        stmts, i = found[0]
        prev = stmts[i - 1]
        assert isinstance(prev, ast.If) and "_steer_host_deny" in ast.unparse(prev.test)
        assert "_steer_host_deny(" in ast.unparse(prev.body[0])
