"""The hook module ``app.json`` names: ``routes``, ``on_startup`` and ``on_shutdown``.

The gateway executes a hook's module file once per hook entry, so state kept in
that module would be three different objects. This one holds none: it forwards
to ``backend/routes.py``, which it imports as a sibling, so the routes, the run
registry and the background tasks are one module shared by all three hooks.
"""

from __future__ import annotations

from typing import Any

from . import routes


def register_routes(ctx: Any) -> list[Any]:
    return routes.register_routes(ctx)


async def on_startup(ctx: Any) -> None:
    await routes.on_startup(ctx)


async def on_shutdown(ctx: Any) -> None:
    await routes.on_shutdown(ctx)
