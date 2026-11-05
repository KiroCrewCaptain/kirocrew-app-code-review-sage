"""Serve the backend the way the gateway's RouteRegistry and lifecycle do.

The registry mounts one catch-all at ``/api/apps/{app_name}/{path}``, matches the
remainder against each route record, injects path params into ``match_info`` and
calls ``handler(request, ctx)``; the lifecycle dispatcher calls
``on_startup(ctx)`` and ``on_shutdown(ctx)``. :func:`mount` does the same on a
test's own ``web.Application``, with aiohttp's router doing the matching under the
same prefix, so a test request uses the URL a dashboard request uses and
``ctx.http_app`` is that application, as the gateway's is.

:func:`make_ctx` builds the host's own ``AppContext`` (Kiro Crew is a pinned test
dependency), so the owner gate a route asks is the gateway's real one.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from aiohttp import web

APP = "code-review-sage"
PREFIX = f"/api/apps/{APP}"


def make_ctx(home: Path, **overrides: Any) -> Any:
    from kiro_crew.apps.audit_sdk import AuditSDK
    from kiro_crew.apps.context import AppContext

    values: dict[str, Any] = {
        "name": APP,
        "data_dir": Path(home) / "apps" / APP / "data",
        "audit": AuditSDK(APP),
    }
    values.update(overrides)
    return AppContext(**values)


def mount(app: web.Application, routes: Any = None, ctx: Any = None) -> Any:
    """Register the app's routes and lifecycle hooks on *app*, as the gateway does.

    *routes* is the routes module to serve (a test's private copy, or the real
    one). Returns the context, whose ``http_app`` is *app*. With no *ctx*, the
    bound one (the autouse ``bound_ctx`` fixture's) is reused.
    """
    from code_review_sage.backend import _host

    if routes is None:
        from code_review_sage.backend import routes as routes_mod

        routes = routes_mod
    if ctx is None:
        ctx = _host.bound()
    ctx.http_app = app
    for route in routes.register_routes(ctx):

        async def _dispatch(request: web.Request, _route=route) -> web.StreamResponse:
            return await _route.handler(request, ctx)

        app.router.add_route(route.method, PREFIX + route.path, _dispatch)

    async def _start(_app: web.Application) -> None:
        await routes.on_startup(ctx)

    async def _stop(_app: web.Application) -> None:
        await routes.on_shutdown(ctx)

    app.on_startup.append(_start)
    app.on_cleanup.append(_stop)
    return ctx
