"""Shared harness for the Code Review Sage backend-route tests (``test_backend_routes*.py``).

``_load_routes_module`` loads a private copy of ``backend/routes.py`` for one test,
inside the app package (``code_review_sage.backend``) so its relative imports
resolve: the copy shares the library modules and the route parts with the real
facade, and composes the parts onto its own namespace, as the built-in's copies
did. The kept ``test_backend_routes.py`` and its planted_links, consolidation,
run_lifecycle and followup parts import it from here, and ``test_review_queue.py``
and ``test_user_repos.py`` reach it through the kept file. A helper only one part
uses stays in that part.
"""

import importlib.util
import itertools
import sys
from pathlib import Path

_APP_ROOT = Path(__file__).resolve().parent.parent
_ROUTES = _APP_ROOT / "backend" / "routes.py"
_COPIES = itertools.count()


def _load_routes_module(label: str = "routes_under_test"):
    name = f"code_review_sage.backend._{label}_{next(_COPIES)}"
    spec = importlib.util.spec_from_file_location(name, str(_ROUTES))
    assert spec and spec.loader
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod
