"""Every place the backend reaches into the Kiro Crew gateway, in one module.

An external app's Python runs inside the gateway process. The backend needs three
kinds of host surface:

1. **The App Kit context** handed to its hooks (``ctx``). These are public seams,
   each read off the context with ``getattr`` and each with a fallback that is
   never MORE permissive than the host:

   * ``ctx.require_owner(request, operation)`` (level 1): the host's own owner
     gate, which audits a denial as ``code-review-sage.<operation>``. Without it
     every caller is refused, the owner included.
   * ``ctx.sdk_level`` (level 1): read so ``register_routes`` can report a
     gateway below level 1 through ``ctx.health``.
   * ``ctx.audit`` (level 0): the security event log, for the settings and
     namespace writes the built-in audited through ``sel().log_api_access``.
     Without it the write still happens and a warning is logged, as a failed
     audit write was in the built-in (see :func:`audit_log`).
   * ``ctx.http_app`` (granted because the manifest declares routes): the
     gateway's own application, whose ``"state"`` is the dashboard state the
     built-in read off ``app["state"]``: the owner's bell feed, the session map a
     follow-up seeds, the chat folders it files into and the slot table it reads.
   * ``ctx.data_dir``: checked against the library's own data directory.

   ``ctx.embed`` is a level-1 seam too; this app embeds nothing.

2. **Gateway helpers with no App Kit seam.** The backend's planted-link reader,
   its atomic and retrying file writes, the model registry the settings page
   lists, and two dashboard folder helpers. They are looked up by name through
   :func:`sage_lib._host.attr` (``importlib``) when this module loads, each with
   the fallback named beside it, and ``PORTING.md`` lists each one with the seam
   that would replace it.

3. **The review library** (``sage_lib``), which resolves its own host names the
   same way (``sage_lib/_host.py``).

Nothing else in ``backend/`` names ``kiro_crew`` (``tests/test_no_host_imports.py``).
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import tempfile
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Awaitable, Callable

from aiohttp import web

from ..sage_lib import _host as _lib_host

logger = logging.getLogger("kirocrew.app.code-review-sage")

APP_NAME = "code-review-sage"

#: The App Kit seam level this app is written against: structural route records
#: and ``ctx.require_owner``.
REQUIRED_SDK_LEVEL = 1

#: The prefix the built-in gave every owner-gate operation. The host now prefixes
#: the app's own name (``code-review-sage.``), so the old one is dropped.
_LEGACY_OPERATION_PREFIX = "code_review_sage."

Handler = Callable[[web.Request, Any], Awaitable[web.StreamResponse]]


class HostCapabilityMissing(RuntimeError):
    """The gateway does not provide a service this operation requires."""


# ── route records ───────────────────────────────────────────────────────────


@dataclass(frozen=True)
class Route:
    """One ``hooks.routes`` record, accepted structurally by the gateway.

    A level-1 ``RouteRegistry`` takes any record with a str ``method``, a str
    ``path`` (relative to ``/api/apps/code-review-sage``) and a callable
    ``handler(request, ctx)``.
    """

    method: str
    path: str
    handler: Handler


def sdk_level(ctx: Any) -> int:
    """The seam level the gateway reports; 0 for a gateway that predates the field."""
    level = getattr(ctx, "sdk_level", 0)
    return level if isinstance(level, int) and not isinstance(level, bool) else 0


# ── the bound app context ───────────────────────────────────────────────────

_ctx: Any | None = None
_ctx_lock = threading.Lock()


def bind(ctx: Any) -> None:
    """Remember the context the gateway handed to ``register_routes``.

    Review runs reach it from places no request passes through (the background
    driver, the poster, the finished-run notification), so it is held here. A
    later context replaces an earlier one: an update or a re-enable hands a fresh
    one.
    """
    global _ctx
    with _ctx_lock:
        _ctx = ctx


def unbind(ctx: Any | None = None) -> None:
    """Forget the bound context (only *ctx*, when given)."""
    global _ctx
    with _ctx_lock:
        if ctx is None or _ctx is ctx:
            _ctx = None


def bound() -> Any | None:
    with _ctx_lock:
        return _ctx


def dashboard_state(ctx: Any) -> Any | None:
    """``ctx.http_app["state"]``, the dashboard state, or ``None`` without one."""
    app = getattr(ctx, "http_app", None)
    if app is None:
        return None
    try:
        return app.get("state")
    except Exception:  # noqa: BLE001 - an application without the key has no state
        return None


# ── the owner gate (ctx.require_owner) ──────────────────────────────────────


def owner_denied() -> web.Response:
    """The host's own 403 body for a caller who is not the dashboard owner."""
    return web.json_response(
        {"error": "owner authorization required", "code": "owner_only"}, status=403
    )


async def require_owner(request: web.Request, operation: str) -> web.StreamResponse | None:
    """``None`` when the caller is the dashboard owner, else the refusal to return.

    The gate is the bound context's ``require_owner``. *operation* may carry the
    built-in's ``code_review_sage.`` prefix; the host prefixes the app's own name
    when it audits a denial, so that prefix is dropped. No context, or a context
    without the seam, refuses everyone, the owner included.
    """
    gate = getattr(bound(), "require_owner", None)
    if not callable(gate):
        return owner_denied()
    return await gate(request, operation.removeprefix(_LEGACY_OPERATION_PREFIX))


# ── audit (ctx.audit) ───────────────────────────────────────────────────────


class _AuditLog:
    """``log_api_access(...)`` over ``ctx.audit.record``, the built-in's SEL call shape.

    ``ctx.audit`` records ``app:code-review-sage`` as the caller and prefixes the
    operation with the app name, so the built-in's ``caller=`` is dropped.
    """

    def __init__(self, sink: Any) -> None:
        self._sink = sink

    def log_api_access(
        self,
        *,
        caller: str = "",
        operation: str,
        outcome: str = "success",
        resources: str = "",
        error: str = "",
    ) -> None:
        del caller  # the host sets the caller from the app's identity
        self._sink.record(operation, outcome, resources=resources, error=error)


def audit_log() -> _AuditLog:
    """The audit sink of the bound context; raises when the context has none."""
    sink = getattr(bound(), "audit", None)
    if not callable(getattr(sink, "record", None)):
        raise HostCapabilityMissing("no audit seam")
    return _AuditLog(sink)


# ── gateway helpers without a seam ──────────────────────────────────────────

#: The gateway's link-safe reader (``safe_read_file_bytes_nolink``). The one caller
#: refuses a read without it rather than follow a planted link.
hooks = _lib_host.module("kiro_crew.hooks")

#: The model registry the settings page offers. Without it the page offers only
#: "Default (agent config)", the built-in's own failure path.
model_registry = _lib_host.module("kiro_crew.model_registry")


def _fallback_read_bytes_with_retry(path: Path | str, *, max_bytes: int | None = None) -> bytes:
    """One read, no Windows sharing-violation retry (the gateway's helper has it)."""
    with open(path, "rb") as fh:
        return fh.read() if max_bytes is None else fh.read(max_bytes + 1)


def _fallback_atomic_write(
    path: Path | str, content: str | bytes, *, restrict_to_owner: bool = False, **_: Any
) -> None:
    """Stage beside *path*, then rename over it.

    The gateway's ``atomic_write`` also retries a Windows sharing violation on the
    rename and carries the old file's access control over. This keeps the two
    properties the callers rely on: a reader never sees half a file, and
    ``restrict_to_owner`` makes the staged file ``0600`` before a byte is written
    (``mkstemp`` creates it so on POSIX).
    """
    target = Path(path)
    data = content.encode("utf-8") if isinstance(content, str) else content
    fd, tmp = tempfile.mkstemp(dir=str(target.parent), prefix=f".{target.name}.", suffix=".tmp")
    try:
        with os.fdopen(fd, "wb") as fh:
            fh.write(data)
            fh.flush()
            os.fsync(fh.fileno())
        if not restrict_to_owner:
            os.chmod(tmp, 0o644)
        os.replace(tmp, target)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


atomic_write = _lib_host.attr("kiro_crew.atomic_write", "atomic_write") or _fallback_atomic_write
read_bytes_with_retry = (
    _lib_host.attr("kiro_crew.atomic_write", "read_bytes_with_retry")
    or _fallback_read_bytes_with_retry
)


def _fallback_loads_user_json(text: str) -> Any:
    return json.loads(text.removeprefix("\ufeff"))


loads_user_json = _lib_host.attr("kiro_crew.user_json", "loads_user_json") or _fallback_loads_user_json


def _fallback_next_folder_order(folders: list[dict]) -> int:
    """One past the highest ``order`` (the dashboard's own rule for a new folder)."""
    orders = [f.get("order") for f in folders if isinstance(f.get("order"), (int, float))]
    return int(max(orders)) + 1 if orders else 0


def _fallback_home_owner_of(folders: list[dict], folder_id: str) -> str:
    """Refuse every folder: without the helper a mate's home cannot be told apart.

    ``"?"`` is truthy, so the follow-up creates a folder of its own rather than
    adopt one that may belong to a crewmate.
    """
    return "?"


next_folder_order = (
    _lib_host.attr("kiro_crew.dashboard.chat_folder_order", "next_folder_order")
    or _fallback_next_folder_order
)
home_owner_of = (
    _lib_host.attr("kiro_crew.dashboard.mate_folders", "home_owner_of") or _fallback_home_owner_of
)


class LoopBoundLock:
    """An ``asyncio.Lock`` bound to the loop that first awaits it.

    The built-in used the gateway's ``kiro_crew.loop_lock.LoopBoundLock``, a
    private module. Every contender here is a route handler or a task on the
    gateway's one loop, so one lock per loop is all that is needed: a new loop
    (a test's, or a restarted gateway's) gets a fresh lock instead of one bound
    to a loop that is gone.
    """

    def __init__(self) -> None:
        self._lock: asyncio.Lock | None = None
        self._loop: asyncio.AbstractEventLoop | None = None

    def _current(self) -> asyncio.Lock:
        loop = asyncio.get_running_loop()
        if self._lock is None or self._loop is not loop:
            self._lock = asyncio.Lock()
            self._loop = loop
        return self._lock

    def locked(self) -> bool:
        return self._lock is not None and self._lock.locked()

    async def acquire(self) -> bool:
        return await self._current().acquire()

    def release(self) -> None:
        if self._lock is None:
            raise RuntimeError("release of an unacquired LoopBoundLock")
        self._lock.release()

    async def __aenter__(self) -> "LoopBoundLock":
        await self.acquire()
        return self

    async def __aexit__(self, *exc: object) -> None:
        self.release()


# ── capability report ───────────────────────────────────────────────────────


def capability_issues(ctx: Any) -> list[str]:
    """What this gateway lacks, one short sentence each, for ``ctx.health``."""
    issues: list[str] = []
    level = sdk_level(ctx)
    if level < REQUIRED_SDK_LEVEL:
        issues.append(
            f"App Kit level {level} (needs {REQUIRED_SDK_LEVEL}): every write is refused"
        )
    if not callable(getattr(ctx, "require_owner", None)):
        issues.append("no owner gate (ctx.require_owner): every write is refused")
    if not callable(getattr(getattr(ctx, "audit", None), "record", None)):
        issues.append("no audit seam (ctx.audit): settings and namespace writes are not audited")
    if dashboard_state(ctx) is None:
        issues.append(
            "no dashboard state (ctx.http_app): no finished-run notifications and no follow-up"
        )
    if hooks is None:
        issues.append("no link-safe reader: consolidation results cannot be read")
    from ..sage_lib import review_pool

    if review_pool.AcpRuntime is None:
        issues.append("no ACP runtime: no review can start")
    return issues
