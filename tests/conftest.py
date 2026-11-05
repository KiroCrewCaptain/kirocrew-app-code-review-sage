"""Test floor: the app as one package, an isolated data home, a bound context.

* The gateway loads the hook files into one synthetic package per app, so
  ``backend`` imports ``..sage_lib`` relatively. A plain pytest run has no such
  loader, so the app root is registered here as the package ``code_review_sage``
  (``code_review_sage.backend``, ``code_review_sage.sage_lib``) before any test
  module is imported. Every test reaches the app through that one name, so a
  patch on a module is the binding the backend sees.
* Kiro Crew (a pinned test dependency, ``tests/requirements.txt``) is the host
  the library resolves its services from. Its data home, the kiro home and the
  workspace are pinned to throwaway directories BEFORE anything imports it, and
  again per test, so no test reads or writes the operator's real ``~/.kiro``.
* Every test runs with a context bound the way ``register_routes`` binds the
  gateway's: the host's own ``AppContext`` (its real owner gate and audit sink)
  for ``code-review-sage``, with a data directory under the test's home.
"""

from __future__ import annotations

import importlib.machinery
import importlib.util
import os
import shutil
import sys
import tempfile
from pathlib import Path

import pytest

APP_ROOT = Path(__file__).resolve().parent.parent
PACKAGE = "code_review_sage"

if PACKAGE not in sys.modules:
    _pkg = importlib.util.module_from_spec(
        importlib.machinery.ModuleSpec(PACKAGE, None, is_package=True)
    )
    _pkg.__path__ = [str(APP_ROOT)]
    sys.modules[PACKAGE] = _pkg

_SESSION_HOME = Path(tempfile.mkdtemp(prefix="kca-code-review-sage-home-"))
os.environ["KIROCREW_HOME"] = str(_SESSION_HOME / "crew")
os.environ["KIROCREW_WORKSPACE"] = str(_SESSION_HOME / "workspace")
os.environ["KIRO_HOME"] = str(_SESSION_HOME / "kiro")


def pytest_unconfigure(config: pytest.Config) -> None:
    shutil.rmtree(_SESSION_HOME, ignore_errors=True)


@pytest.fixture(autouse=True)
def _isolated_home(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    home = tmp_path / "kirocrew-home"
    monkeypatch.setenv("KIROCREW_HOME", str(home))
    monkeypatch.setenv("KIROCREW_WORKSPACE", str(tmp_path / "kirocrew-workspace"))
    monkeypatch.setenv("KIRO_HOME", str(tmp_path / "kiro-home"))
    return home


@pytest.fixture(autouse=True)
def _mute_shared_runner_audit(monkeypatch: pytest.MonkeyPatch):
    """No test in this suite may write a real SEL log through the gh runner.

    ``discovery.run_gh_json`` / ``current_login`` / ``pipeline.list_open_prs``
    route through the host's ``github_runner.run_gh``, which emits a SEL event per
    spawn. The audit is not under test here (Kiro Crew's own suite covers it), so
    the emitter itself is muted.
    """
    from kiro_crew import github_runner

    monkeypatch.setattr(github_runner, "_audit_run", lambda *a, **k: None)
    yield


@pytest.fixture(autouse=True)
def bound_ctx(_isolated_home: Path):
    """The context ``register_routes`` would bind, for every test."""
    from code_review_sage.backend import _host

    from .harness import make_ctx

    ctx = make_ctx(_isolated_home)
    _host.bind(ctx)
    yield ctx
    _host.unbind()
