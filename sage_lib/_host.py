"""Every name the review library takes from the Kiro Crew gateway, by name, at load time.

``sage_lib`` runs in two places. The backend imports it inside the gateway, and a
review worker runs its scripts (``<python> sage_lib/store.py --ensure``,
``sage_lib/pipeline.py``, ``sage_lib/learning.py`` ...) as child processes of
the gateway's own interpreter. In both, Kiro Crew is importable, and the built-in
used its private helpers directly: the data home resolver, owner-only file
creation, the planted-link guards, the redaction passes, the gh runner, the ACP
runtime the reviews run on and its permission floor.

None of those is an App Kit seam (``PORTING.md``, "Host services without a
seam"), so this module is the ONE place the library names them. Each is looked up
through :func:`attr` by module and attribute name; a gateway without it answers
``None`` and the caller falls back exactly as the built-in did when its guarded
import failed. Where the built-in had no fallback (the import was unguarded) the
caller refuses instead. ``tests/test_no_host_imports.py`` pins that no other
module of this repository names ``kiro_crew``.

Every lookup is a plain ``importlib.import_module`` plus ``getattr``. It runs once
per name, when the module that needs it is imported, so a test that models an
older gateway patches :func:`attr` before importing, or replaces the bound name.
"""

from __future__ import annotations

import importlib
from typing import Any


def module(name: str) -> Any | None:
    """The gateway module *name*, or ``None`` when this host has none."""
    try:
        return importlib.import_module(name)
    except Exception:  # noqa: BLE001 - any import failure means "not provided"
        return None


def attr(module_name: str, name: str) -> Any | None:
    """``module_name.name`` from the gateway, or ``None`` when it has none."""
    mod = module(module_name)
    return getattr(mod, name, None) if mod is not None else None
