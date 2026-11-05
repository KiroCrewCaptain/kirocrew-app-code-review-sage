"""No module of this app imports ``kiro_crew``; host names go through the two shims.

The gateway's public surface for an app is the ``AppContext`` its hooks get and
the structural route records the registry accepts. The review library also uses
gateway services no App Kit seam provides yet (the ACP runtime, the permission
floor, the gh runner, the planted-link guards; see PORTING.md). Those are looked
up by name, through ``importlib``, in ``sage_lib/_host.py`` (``attr`` /
``module``), which ``backend/_host.py`` reuses, so a missing one degrades or
refuses the operation instead of breaking the module load.

So: no module of the app has an ``import kiro_crew`` / ``from kiro_crew ...``
statement or an ``import_module("kiro_crew...")`` call outside ``sage_lib/_host.py``;
every name of a ``kiro_crew`` module that appears in code is a literal handed to
``_host.attr`` / ``_host.module`` (or to the backend shim, which calls them);
and nothing imports the built-in's own package.
"""

from __future__ import annotations

import ast
import re
import unittest
from pathlib import Path

APP_ROOT = Path(__file__).resolve().parents[1]
CODE_DIRS = ("backend", "sage_lib")
_RESOLVER = APP_ROOT / "sage_lib" / "_host.py"
_HOST_NAME = re.compile(r"kiro_crew(\.[A-Za-z_]+)*")


def _files() -> list[Path]:
    return sorted(p for d in CODE_DIRS for p in (APP_ROOT / d).rglob("*.py"))


def _imports(tree: ast.Module) -> list[str]:
    found: list[str] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            found += [a.name for a in node.names if a.name.split(".")[0] == "kiro_crew"]
        elif isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
            if node.module.split(".")[0] == "kiro_crew":
                found.append(node.module)
        elif isinstance(node, ast.Call):
            name = getattr(node.func, "attr", None) or getattr(node.func, "id", None)
            if name in {"import_module", "__import__"} and node.args:
                arg = node.args[0]
                if not (isinstance(arg, ast.Constant) and isinstance(arg.value, str)):
                    found.append(f"<computed import at line {node.lineno}>")
                elif arg.value.split(".")[0] == "kiro_crew":
                    found.append(arg.value)
    return found


def _lookup_args(tree: ast.Module) -> set[int]:
    """ids of the string constants handed to ``_host.attr`` / ``_host.module``."""
    ok: set[int] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute):
            if node.func.attr in {"attr", "module"} and ast.unparse(node.func.value) in {
                "_host",
                "_lib_host",
            }:
                if node.args and isinstance(node.args[0], ast.Constant):
                    ok.add(id(node.args[0]))
    return ok


def _docstrings(tree: ast.Module) -> set[int]:
    ids: set[int] = set()
    for node in ast.walk(tree):
        if isinstance(node, (ast.Module, ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)):
            body = node.body
            if body and isinstance(body[0], ast.Expr) and isinstance(body[0].value, ast.Constant):
                ids.add(id(body[0].value))
    return ids


class TestNoHostImports(unittest.TestCase):
    def test_no_module_imports_kiro_crew(self) -> None:
        files = _files()
        self.assertGreater(len(files), 20, "the scan found too few modules")
        for path in files:
            tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
            found = _imports(tree)
            if path == _RESOLVER:
                # The resolver's one call is `importlib.import_module(name)` on its
                # argument, which this scan reports as a computed import.
                found = [f for f in found if not f.startswith("<computed import")]
            with self.subTest(module=path.relative_to(APP_ROOT).as_posix()):
                self.assertEqual(found, [])

    def test_every_host_name_in_code_is_a_lookup_argument(self) -> None:
        for path in _files():
            tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
            allowed = _lookup_args(tree) | _docstrings(tree)
            stray = [
                node.value
                for node in ast.walk(tree)
                if isinstance(node, ast.Constant)
                and isinstance(node.value, str)
                and _HOST_NAME.fullmatch(node.value)
                and id(node) not in allowed
            ]
            with self.subTest(module=path.relative_to(APP_ROOT).as_posix()):
                self.assertEqual(stray, [])

    def test_the_resolver_has_no_host_import_of_its_own(self) -> None:
        tree = ast.parse(_RESOLVER.read_text(encoding="utf-8"))
        names = [
            a.name if isinstance(node, ast.Import) else (node.module or "")
            for node in tree.body
            if isinstance(node, (ast.Import, ast.ImportFrom))
            for a in (node.names if isinstance(node, ast.Import) else [None])  # type: ignore[list-item]
        ]
        self.assertEqual(sorted(n for n in names if n), ["__future__", "importlib", "typing"])

    def test_nothing_names_the_builtin_package(self) -> None:
        for path in _files():
            text = path.read_text(encoding="utf-8")
            with self.subTest(module=path.relative_to(APP_ROOT).as_posix()):
                self.assertNotIn("apps.builtins", text)

    def test_the_scan_reports_a_planted_import(self) -> None:
        planted = ast.parse(
            "import kiro_crew.sel\n"
            "from kiro_crew import hooks\n"
            "import importlib\n"
            "importlib.import_module('kiro_crew.security')\n"
            "from . import _host\n"
        )
        self.assertEqual(_imports(planted), ["kiro_crew.sel", "kiro_crew", "kiro_crew.security"])


if __name__ == "__main__":
    unittest.main()
