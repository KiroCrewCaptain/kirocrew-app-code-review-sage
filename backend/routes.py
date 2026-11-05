"""Deterministic backend route for the Code Review Sage builtin.

Kicks off the two-stage review driver **in-process** (no LLM orchestrator), so
the Phase 1 -> Phase 2 switch AND the finalize step (report -> archive -> clean)
are guaranteed to run as Python, never left to an LLM session that can deviate.
The only LLM work is the per-change gate/deep tasks the driver dispatches to a
reusable worker pool (``sage_lib/review_pool.py``) — long-lived ACP sessions reused
across CRs, not per-CR ``/api/spawn`` sub-agents — so reviews run silently.

Why this exists: when an LLM orchestrator session was merely *asked* to shell
``review_driver.py``, it could instead run Phase 1 inline and stop — leaving a
gate-only record, a stale report, and no Phase 2 (observed in practice).
Routing the kickoff through this route removes that discretion entirely.

Served by the gateway's App Kit route registry: ``register_routes(ctx)`` returns
the route records (paths relative to ``/api/apps/code-review-sage``), and
``backend/entry.py`` is the hook module the manifest names, so this module is
imported once and its process state is shared by every hook.

Routes (browser-facing, same-origin authed exactly like ``/config``):
  POST /api/apps/code-review-sage/review   {links | changes} -> {run_id, changes}
  GET  /api/apps/code-review-sage/runs                       -> {runs: [...]}

The ``/runs`` registry lets the page render live status and reconstruct it after
navigating away (the backend owns the run, not ephemeral React state). Per-change
detail still comes from the on-disk result records the driver writes.

The handlers and their helpers live in the ``routes_parts`` package beside this file,
one module per responsibility, and run on this module's globals through
:func:`backend._compose.compose` (see ``routes_parts/__init__.py``), so this
file stays the one import path and the one patch surface. It keeps the import header,
the process state, the follow-up endpoints, ``register_routes`` and the lifecycle hooks.
"""
from __future__ import annotations

import asyncio
import json
import logging
import threading
import time
import uuid
from pathlib import Path
from typing import Any

from aiohttp import web

from . import _host
from ._host import (  # noqa: F401 - names the composed parts read off this module
    LoopBoundLock,
    Route,
    atomic_write,
    hooks,
    home_owner_of,
    loads_user_json,
    model_registry,
    next_folder_order,
    read_bytes_with_retry,
)

logger = logging.getLogger("kirocrew.app.code-review-sage")

# The app root holds ``sage_lib/`` next to this ``backend/`` dir. The gateway loads
# the hook files into one package per app, so the library is a relative import.
_APP_ROOT = Path(__file__).resolve().parent.parent

from ..sage_lib import (  # noqa: E402
    adapters,
    discovery,
    followup,
    learning,
    pipeline,
    report,
    results,
    review_driver,
    review_pool,
    store,
)

# In-memory run registry, most-recent first. Bounded so it can't grow unbounded.
# Holds lightweight run descriptors the page polls; on-disk result records carry
# per-change detail.
_RUNS: list[dict[str, Any]] = []
_RUNS_MAX = 25
_LOCK = LoopBoundLock()
# Guards the claim/dedup step below. Runs themselves are NOT serialized: each run
# owns a private ``data/runs/<run_id>/`` subtree (results + report), so several
# reviews can be in flight at once. What still needs mutual exclusion is the
# moment a run decides WHICH changes it owns.
# Serializes whole runs. Workers hand results back through a directory shared
# ACROSS runs, so overlapping runs would mean two writers to one path.
# LoopBoundLock excludes within one loop only; all run starters are route
# handlers on the app's single gateway loop, so every contender shares it.
_RUN_LOCK = LoopBoundLock()

# Serialises "start a consolidation" against "delete this namespace". Both are
# short critical sections; holding one lock across each removes the interleaving
# rather than trying to place checks around the awaits.
_NS_OPS_LOCK = LoopBoundLock()
# reviewed-key -> run_id for every change a LIVE run has claimed. Two runs must
# never review and post to the same PR concurrently: the old whole-run lock
# prevented that by refusing to overlap at all; this claim registry gets the same
# guarantee while letting unrelated runs proceed in parallel. It also closes a gap
# the old lock never covered — a pasted-link run overlapping a repo run.
_INFLIGHT: dict[str, str] = {}
# staging-key -> the reviewed key that owns it. `_INFLIGHT` alone cannot express
# this: exempting a run's own claims (needed so re-claiming is idempotent) also
# exempted a SECOND change in the same run whose lossy id collapsed onto the same
# staging file — both were kept, both workers wrote one path, and one review was
# adopted under the wrong pull request. Ownership is per CHANGE, not per run.
_STAGE_OWNER: dict[str, str] = {}
# Run ids the user asked to cancel. The driver polls this between changes.
_CANCELLED: set[str] = set()
# Guards copy-on-write updates to a run's per-change ``progress`` map, which the
# (threaded) driver writes and the /runs handler reads concurrently.
_PROGRESS_LOCK = threading.Lock()
# Keep strong refs to background tasks so they aren't garbage-collected mid-flight.
_TASKS: set[asyncio.Task] = set()  # type: ignore[type-arg]
# Dashboard state, captured at route registration. A finished run notifies the
# bell feed, and that happens in a background task with no ``request`` in scope —
# so the state has to be reachable without one. Populated lazily and treated as
# optional everywhere (tests register routes on a bare aiohttp app).
_APP_STATE: dict[str, Any] = {}


async def require_owner_dashboard_request(request: web.Request, operation: str) -> Any:
    """The host's owner gate (``ctx.require_owner``), under the built-in's name.

    The parts call it with the built-in's ``code_review_sage.<verb>`` operation
    names; ``_host.require_owner`` drops that prefix, because the host prefixes
    the app's own. A gateway without the seam refuses every caller.
    """
    return await _host.require_owner(request, operation)


def sel() -> Any:
    """The audit sink under the built-in's ``sel()`` name (``ctx.audit``)."""
    return _host.audit_log()


# --- Composed parts -----------------------------------------------------------
# The run registry, the review runs, the per-run endpoints, publishing, repo
# discovery, the settings and the learning namespaces live in ``routes_parts`` and run
# on THIS module's globals (:func:`backend._compose.compose`): a patch of a
# name here reaches them, a ``global`` write in one lands here, and each reports this
# module as its ``__module__``. A test's private copy of this file composes them onto
# that copy.
from . import routes_parts as _parts  # noqa: E402
from ._compose import compose as _facade_compose  # noqa: E402
from .routes_parts.namespaces import (  # noqa: E402,F401
    _consolidate_bg,
    _handle_consolidate,
    _handle_learnings,
    _handle_namespaces,
)
from .routes_parts.publishing import (  # noqa: E402,F401
    _DISMISS_REASON_MAX,
    _collect_delivered,
    _dismissed_keys,
    _handle_run_dismiss,
    _handle_run_post,
    _notify_posted,
    _pending_comment_count,
    _post_comments_bg,
    _without_dismissed,
)
from .routes_parts.registry import (  # noqa: E402,F401
    _claim_changes_under_lock,
    _find_run,
    _is_live,
    _load_runs,
    _make_progress,
    _now,
    _reap_orphan_run_dirs,
    _record,
    _release_claims,
    _runs_file,
    _save_runs,
    _stage_key,
    _write_runs,
)
from .routes_parts.repos import (  # noqa: E402,F401
    _handle_my_repos,
    _handle_recent_repos,
    _handle_repos,
    _handle_review_queue,
    _pull_request_ref,
)
from .routes_parts.review_runs import (  # noqa: E402,F401
    _first_change_error,
    _first_change_failure,
    _handle_repo_prs,
    _handle_review,
    _handle_review_repo,
    _handle_runs,
    _list_repo_prs,
    _notify_finished,
    _posting_expected,
    _record_reviewed,
    _run_headline,
    _run_review_bg,
)
from .routes_parts.run_threads import (  # noqa: E402,F401
    _handle_run_archive,
    _handle_run_cancel,
    _handle_run_delete,
    _handle_run_detail,
    _handle_run_report,
    _rebanded_report,
    _run_id_param,
)
from .routes_parts.settings import (  # noqa: E402,F401
    _handle_settings,
    _known_models,
    _load_known_models,
    _load_review_section,
    _valid_model,
    _write_review_section,
)

_facade_compose(
    globals(),
    (
        _parts.registry,
        _parts.review_runs,
        _parts.run_threads,
        _parts.publishing,
        _parts.repos,
        _parts.settings,
        _parts.namespaces,
    ),
)


# Computed once at import (the registry is immutable after load). A module-level
# constant so the settings validator and the /settings enumerator share one list.
_KNOWN_MODELS: list[str] = _load_known_models()


# Namespaces with a merge in flight. Consolidation replaces the whole ruleset, so
# two concurrent merges could interleave writes and lose patterns; the claim is
# held for the life of the request rather than per-write.
# A consolidated ruleset is a handful of short patterns; anything larger is not
# a merge result. Bounds the read of an LLM-written file.
_MERGE_MAX_BYTES = 256 * 1024

_CONSOLIDATING: set[str] = set()

# Last outcome per namespace, so a merge that finished while the page was closed
# still reports itself instead of looking like it never ran.
_CONSOLIDATE_STATE: dict[str, dict] = {}


# --- follow-up sessions -----------------------------------------------------
# A finished review can be asked about later. Its session transcript is kept (see
# ``sage_lib/followup.py``) and a follow-up RESUMES it as an ordinary chat
# session, so the reviewer's own reasoning comes back cold from disk and the
# conversation from then on is a normal session: it survives restarts, is filed in
# the sidebar, and its tool use runs through the dashboard's approval pipeline.
#
# This app's part is deliberately small — validate, seed the resume, and hand back
# what the slot needs. Creating the slot itself stays with the dashboard's own
# endpoint so slot policy (agent binding, workspace, title redaction, ownership)
# has exactly one implementation.

# How often kept transcripts are aged out. They are the largest thing this app
# leaves on disk and a closed tab reports nothing, so this cannot be lazy.
_FOLLOWUP_SWEEP_INTERVAL = 3600.0


def _chat_params(run_id: str, change_id: str) -> str:
    """Validate the pair identifying a review. Returns an error code, or ""."""
    if not run_id or not change_id:
        return "chat_params_required"
    return ""


async def _handle_chat_get(request: web.Request) -> web.Response:
    """GET .../chat?run_id=&change_id= — stored history plus follow-up readiness.

    200 even with nothing to show: "this review was never discussed" is a normal
    state for the panel, not an error.
    """
    run_id = (request.query.get("run_id") or "").strip()
    change_id = (request.query.get("change_id") or "").strip()
    bad = _chat_params(run_id, change_id)
    if bad:
        return web.json_response(
            {"code": bad, "error": "missing run_id or change_id"}, status=400)
    turns = await asyncio.to_thread(
        followup.read_transcript, run_id, change_id)
    async with _LOCK:
        run = _find_run(run_id)
        run_live = run is not None and _is_live(run)
    desc, reason = await asyncio.to_thread(
        followup.resumable, run_id, change_id)
    # A run still in flight is not offerable even with a descriptor on disk: its
    # first pass may be superseded by a second, which retires that descriptor and
    # leaves an already-open conversation pointing at findings the run replaced.
    if run_live:
        desc, reason = None, followup.ERR_RUN_LIVE
    slot_key = followup.slot_key(run_id, change_id)
    return web.json_response({
        "run_id": run_id,
        "change_id": change_id,
        "turns": turns,
        # Whether a follow-up would restore the reviewer's own context. Told to
        # the UI so it can explain why the button is absent instead of offering
        # one that opens a session which knows nothing about the review.
        "resumable": desc is not None,
        "reason": reason,
        "slot_key": slot_key,
        # Whether that session already exists. Without it the panel invites a
        # returning user to "open" a conversation they already had, with no trace
        # of it -- which reads as the review having lost it.
        "followup_open": bool(desc is not None
                              and _followup_session_exists(slot_key)),
    })


def _followup_session_exists(slot_key: str) -> bool:
    """Whether a chat session for this review is actually in the sidebar.

    Read from the SLOT, never from the session map. The two are independent and
    the map deliberately outlives the slot: closing a tab pops it from the slot
    table but keeps its mapping so a later resume can reload the conversation. So
    a mapping proves a session once existed, not that one exists now -- and this
    answer decides whether the panel offers to continue a conversation or to
    create it, which in turn decides whether the slot is handed a title and a
    folder. Deriving it from the map made a closed session read as open, so the
    recreate that followed omitted both and landed unfiled under the placeholder
    title.

    Reads the slot table directly because the dashboard exposes no read-only
    existence check; absent state (tests, a bare app) answers False, which is the
    safe direction -- it offers to create, and creating is idempotent.
    """
    slots = getattr(_APP_STATE.get("state"), "_slots", None)
    if not isinstance(slots, dict):
        return False
    return slot_key in slots


async def _ensure_followup_folder(state: Any) -> str:
    """Find-or-create the folder follow-up sessions are filed under.

    Through ``mutate_folders`` so find-then-create is one transaction: two tabs
    starting a follow-up at the same moment would otherwise each miss the other's
    folder and build a duplicate. Idempotent — an existing folder is adopted and
    nothing is written.
    """
    def _create_or_adopt(folders: list[dict]) -> tuple[bool, str]:
        for f in folders:
            if str(f.get("name", "")).strip() != followup.FOLDER_NAME:
                continue
            # A mate's home, or a folder inside one, holds only that mate's
            # sessions, so a follow-up never adopts one.
            if home_owner_of(folders, str(f.get("id") or "")):
                continue
            # Re-engaging the folder clears `hidden`, matching the folder CRUD
            # handler's own unhide-on-assign rule.
            if f.get("hidden"):
                f["hidden"] = False
                return True, str(f.get("id", ""))
            return False, str(f.get("id", ""))
        folder = {
            "id": uuid.uuid4().hex[:12],
            "name": followup.FOLDER_NAME,
            "order": next_folder_order(folders),
            "collapsed": False,
            "hidden": False,
            "parent_id": "",
            "project_dir": "",
            # Same stamp the dashboard's own folder creators write; the sidebar's
            # ``created`` folder sort reads it.
            "created_at": time.time(),
        }
        folders.append(folder)
        return True, str(folder["id"])

    try:
        return str(await state.mutate_folders(_create_or_adopt))
    except Exception:  # noqa: BLE001 - filing is a nicety, the session is not
        logger.warning("code-review-sage: follow-up folder write failed",
                       exc_info=True)
        return ""


def _change_title(run_id: str, change_id: str) -> str:
    """The reviewed pull request's title, or "" when it cannot be read."""
    try:
        rec = results.read_result(change_id, None, run_id) or {}
        return store.redact_text(str(rec.get("title") or ""))
    except Exception:  # pragma: no cover - a title is cosmetic
        logger.debug("code-review-sage: could not read change title",
                     exc_info=True)
        return ""


async def _handle_followup_start(request: web.Request) -> web.Response:
    """POST .../followup {run_id, change_id} — prepare a session on this review.

    Returns what the caller hands to ``POST /api/chat/slots``: the derived slot
    key, the agent the review ran as, the folder to file it in, and a title. The
    resume itself is already armed when this returns, so the slot's first turn
    loads the reviewer's transcript.
    """
    owner_denied = await require_owner_dashboard_request(request, "code_review_sage.followup_start")
    if owner_denied is not None:
        return owner_denied
    try:
        body = await request.json()
    except Exception:
        body = {}
    if not isinstance(body, dict):
        body = {}
    run_id = str(body.get("run_id") or "").strip()
    change_id = str(body.get("change_id") or "").strip()
    bad = _chat_params(run_id, change_id)
    if bad:
        return web.json_response(
            {"code": bad, "error": "missing run_id or change_id"}, status=400)
    async with _LOCK:
        run = _find_run(run_id)
        run_known = run is not None
        run_live = run is not None and _is_live(run)
    if not run_known:
        return web.json_response(
            {"code": followup.ERR_RUN_GONE,
             "error": "the review this belongs to was deleted"}, status=409)
    if run_live:
        # A first pass can be superseded by a second one in the same run, and that
        # retires the descriptor. Opening now would hand the user a conversation
        # whose findings the run then replaces, with nothing saying so.
        return web.json_response(
            {"code": followup.ERR_RUN_LIVE,
             "error": "this review is still running"}, status=409)

    desc, reason = await asyncio.to_thread(
        followup.resumable, run_id, change_id)
    if desc is None:
        # Literal-status returns rather than one computed `status=`: the
        # error-code contract gate cannot statically verify a site whose status is
        # a variable, so a dynamic status reads as non-compliant even when the
        # body carries a `code`.
        if reason == followup.ERR_TRANSCRIPT_GONE:
            return web.json_response(
                {"code": followup.ERR_TRANSCRIPT_GONE,
                 "error": "the reviewer's session is no longer on disk"},
                status=409)
        return web.json_response(
            {"code": followup.ERR_NO_DESCRIPTOR,
             "error": "this review did not keep a resumable session"},
            status=409)

    state = _APP_STATE.get("state")
    sessions = getattr(state, "sessions", None)
    if sessions is None or not hasattr(sessions, "seed_conversation"):
        return web.json_response(
            {"code": "followup_unavailable",
             "error": "sessions are not available in this context"}, status=503)

    slot_key = followup.slot_key(run_id, change_id)
    # The session-map key a dashboard slot resolves its resume from. Seeded before
    # the slot exists on purpose: the key is derived, so the mapping can be armed
    # first and the slot's very first turn already resumes.
    session_key = f"dashboard:{slot_key}"
    # A slot that already carries a mapping is left alone. Re-seeding would point
    # a follow-up conversation back at the review's own starting transcript and
    # discard everything discussed since.
    mapped = await asyncio.to_thread(sessions.resumable_sid, session_key)
    if not mapped:
        await asyncio.to_thread(
            sessions.seed_conversation, session_key, desc["sid"],
            provider=desc["provider"], cwd=desc["cwd"])
        # Read back rather than trust the write: the session map self-prunes an
        # entry whose files are gone, so this doubles as the last check that the
        # transcript is still there. Refusing here is the point — a slot created
        # without a mapping resumes nothing and then answers anyway, with no idea
        # what was reviewed.
        mapped = await asyncio.to_thread(sessions.resumable_sid, session_key)
    if not mapped:
        return web.json_response(
            {"code": followup.ERR_TRANSCRIPT_GONE,
             "error": "the reviewer's session is no longer on disk"}, status=409)

    folder_id = ""
    if hasattr(state, "mutate_folders"):
        folder_id = await _ensure_followup_folder(state)
    title = followup.slot_title(
        change_id, await asyncio.to_thread(_change_title, run_id, change_id))
    return web.json_response({
        "ok": True,
        "slot_key": slot_key,
        "agent": desc["agent"],
        "folder_id": folder_id,
        "title": title,
    })


async def _followup_sweep_loop() -> None:
    """Age out kept transcripts forever, so they cannot accumulate unbounded."""
    while True:
        try:
            await asyncio.sleep(_FOLLOWUP_SWEEP_INTERVAL)
            dropped = await asyncio.to_thread(followup.prune)
            if dropped:
                logger.info(
                    "code-review-sage: dropped %d idle review transcript(s)",
                    dropped)
        except asyncio.CancelledError:  # pragma: no cover - shutdown
            raise
        except Exception:  # pragma: no cover - never let the sweeper die
            logger.debug("code-review-sage: transcript sweep failed",
                         exc_info=True)


#: Every route: (method, path relative to /api/apps/code-review-sage, handler name).
#: The same method/path pairs the built-in added to the gateway's router, in its
#: order; the registry tries exact paths before ``{run_id}`` patterns, so ``/runs``
#: is never shadowed by ``/runs/{run_id}``.
ROUTE_TABLE: tuple[tuple[str, str, str], ...] = (
    ("GET", "/chat", "_handle_chat_get"),
    ("POST", "/followup", "_handle_followup_start"),
    ("POST", "/review", "_handle_review"),
    ("POST", "/review-repo", "_handle_review_repo"),
    ("GET", "/repo-prs", "_handle_repo_prs"),
    ("GET", "/recent-repos", "_handle_recent_repos"),
    ("GET", "/my-repos", "_handle_my_repos"),
    ("GET", "/review-queue", "_handle_review_queue"),
    ("GET", "/repos", "_handle_repos"),
    ("POST", "/repos", "_handle_repos"),
    ("DELETE", "/repos", "_handle_repos"),
    ("GET", "/runs", "_handle_runs"),
    ("GET", "/runs/{run_id}", "_handle_run_detail"),
    ("DELETE", "/runs/{run_id}", "_handle_run_delete"),
    ("GET", "/runs/{run_id}/report", "_handle_run_report"),
    ("POST", "/runs/{run_id}/cancel", "_handle_run_cancel"),
    ("POST", "/runs/{run_id}/archive", "_handle_run_archive"),
    ("POST", "/runs/{run_id}/post", "_handle_run_post"),
    ("POST", "/runs/{run_id}/dismiss", "_handle_run_dismiss"),
    ("GET", "/settings", "_handle_settings"),
    ("PUT", "/settings", "_handle_settings"),
    ("GET", "/namespaces", "_handle_namespaces"),
    ("POST", "/namespaces", "_handle_namespaces"),
    ("DELETE", "/namespaces", "_handle_namespaces"),
    ("GET", "/learnings", "_handle_learnings"),
    ("POST", "/learnings/consolidate", "_handle_consolidate"),
)


def _by_name(name: str) -> Any:
    """A ``(request, ctx)`` handler that calls this module's *name* at call time.

    The registry calls ``handler(request, ctx)``; the handlers keep the built-in's
    one-argument shape, and a name patched on this module after registration is
    the one a request reaches.
    """

    async def handler(request: web.Request, ctx: Any) -> web.StreamResponse:
        del ctx  # the bound context (``_host.bound()``) is the one every part reads
        return await globals()[name](request)

    handler.__name__ = handler.__qualname__ = name
    return handler


def register_routes(ctx: Any) -> list[Route]:
    """The ``hooks.routes`` entry: bind *ctx* and return the route records.

    Called by the gateway's route registry on its event loop. ``_load_runs`` stays
    inline, as it was in the built-in: one ``read_text`` of the registry file,
    which returns at once when it is absent, so a request never observes an empty
    ``_RUNS``. The layout self-heal, the orphan reap and the transcript sweeper are
    :func:`on_startup`'s, off the loop.

    The dashboard state is cached so a finished run can push a bell notification
    from a background task (no request in scope there). A gateway that hands no
    application (``ctx.http_app``) leaves it absent, and every read site treats it
    as optional. What this gateway lacks is reported through ``ctx.health``.
    """
    _host.bind(ctx)
    state = _host.dashboard_state(ctx)
    if state is not None:
        _APP_STATE["state"] = state
    else:
        _APP_STATE.pop("state", None)
    data_dir = getattr(ctx, "data_dir", None)
    if data_dir is not None and Path(data_dir) != store.data_dir():
        # The library derives its data directory from the gateway's data home, the
        # place the built-in kept it; ``ctx.data_dir`` names the same directory for
        # an app installed where the gateway installs apps.
        logger.warning(
            "code-review-sage: ctx.data_dir %s is not the library's data directory %s",
            data_dir, store.data_dir())
    health = getattr(ctx, "health", None)
    for issue in _host.capability_issues(ctx):
        if callable(getattr(health, "mark_degraded", None)):
            health.mark_degraded(issue)
        logger.warning("code-review-sage: %s", issue)
    _load_runs()  # restore durable job status (mark orphaned 'running' as 'interrupted')
    logger.info("code-review-sage backend routes registered (deterministic review kickoff)")
    return [Route(method, path, _by_name(name)) for method, path, name in ROUTE_TABLE]


async def _ensure_layout_on_startup() -> None:
    """Self-heal the data layout (dirs + config.json with resolved_paths).

    Without it the page reads ``{}`` and shows a perpetual "Initializing…"
    message, because it needs ``resolved_paths.reports`` to render the main view.
    OFF the event loop: the layout pass walks each of nine directories' ancestor
    chain to refuse a planted link before creating it, and on a network-homed or
    stalled data directory those walks would freeze the gateway heartbeat.
    """
    try:
        await asyncio.to_thread(store.ensure_layout)
    except Exception:  # pragma: no cover - never break gateway startup
        logger.warning("code-review-sage: ensure_layout failed at startup", exc_info=True)


async def _reap_on_startup() -> None:
    """Reap run dirs with no registry entry, once, OFF the event loop.

    A run dir with no registry entry is unreachable residue (a crash between the
    two writes, or an older layout). The reap walks every run dir, and its cost
    grows with accumulated residue, so inline it would stall startup.
    """
    try:
        reaped = await asyncio.to_thread(_reap_orphan_run_dirs)
        if reaped:
            logger.info("code-review-sage: reaped %d orphan run dir(s)", reaped)
    except Exception:  # pragma: no cover - never break startup
        logger.debug("code-review-sage: orphan reap failed", exc_info=True)


#: The transcript sweeper started by :func:`on_startup`, stopped by :func:`on_shutdown`.
_SWEEPER: dict[str, asyncio.Task] = {}  # type: ignore[type-arg]


async def on_startup(ctx: Any) -> None:
    """The ``hooks.on_startup`` entry: layout, reap, then the transcript sweeper."""
    _host.bind(ctx)
    await _ensure_layout_on_startup()
    await _reap_on_startup()
    old = _SWEEPER.pop("task", None)
    if old is not None and not old.done():
        old.cancel()
    task = asyncio.create_task(_followup_sweep_loop())
    _SWEEPER["task"] = task
    _TASKS.add(task)
    task.add_done_callback(_TASKS.discard)


async def on_shutdown(ctx: Any) -> None:
    """The ``hooks.on_shutdown`` entry: stop the sweeper and retire the review workers.

    Runs on disable, uninstall, update and gateway exit. The built-in retired the
    workers only at gateway exit (``on_cleanup``); an external app's modules are
    unloaded on disable, so the shared reviewer subprocess is stopped then too.
    """
    task = _SWEEPER.pop("task", None)
    if task is not None and not task.done():
        task.cancel()
        try:
            await task
        except (asyncio.CancelledError, Exception):  # noqa: BLE001 - a stopped sweeper
            pass
    try:
        await review_pool.shutdown_pool()
    except Exception:  # pragma: no cover - defensive
        logger.warning("failed to shut down review pool", exc_info=True)
    _host.unbind(ctx)
