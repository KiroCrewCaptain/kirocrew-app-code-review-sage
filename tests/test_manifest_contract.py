"""What an existing user's copy of the built-in needs from this repository.

Kiro Crew adopts a user's built-in record onto this repository in place, at a
pinned commit, with no consent dialog, so the tree must be something it can take
over unchanged:

- the same name, version, permissions, platform and ``defaultEnabled`` as the
  built-in (``tests/fixtures/builtin-app.json`` is its manifest at the commit
  this was ported from). A widened grant would be held back or force the app
  off, and adoption refuses that;
- hooks that load the way the gateway loads them: from their file path into a
  synthetic package, with the routes and the review library reached relatively,
  and one routes module shared by all three hooks;
- nothing that needs a build at install time, and no symlinks or file names a
  Windows checkout cannot hold;
- a committed UI bundle that imports only the seven modules the dashboard
  provides, and from the two SDK modules only names every supported host exports
  (a named import of a missing export fails the whole bundle at load);
- ``minKiroCrewVersion`` set, so a host without the App Kit seams refuses a
  fresh install instead of serving a half-working app;
- no hardcoded model id anywhere: the review's model is the user's pick or the
  host's default, never a literal that fails for an account not entitled to it;
- the two skills, byte for byte the built-in's, so the materialized skill names
  and the reviewer's instructions do not change on adoption.
"""

from __future__ import annotations

import json
import os
import re
import sys
import unittest
from pathlib import Path

APP_ROOT = Path(__file__).resolve().parents[1]
BUNDLE = APP_ROOT / "ui" / "dist" / "index.mjs"

HOST_MODULES = {
    "react",
    "react-dom",
    "react/jsx-runtime",
    "lucide-react",
    "@tanstack/react-query",
    "@kirocrew/app-sdk",
    "@kirocrew/app-sdk/ui",
}

# What a host BEFORE App Kit level 1 exports from each SDK module (its
# public/vendor/*.mjs stubs). A named import from these modules must stay in this
# set; a level-1 name is read off a namespace import in ui/src/hostSdk.ts.
LEVEL0_EXPORTS = {
    "@kirocrew/app-sdk": {
        "useAppApi",
        "useAppEvents",
        "useTheme",
        "useAppInfo",
        "useNavigate",
        "useNotify",
        "useNavBadge",
        "useChatLauncher",
        "AppApiProvider",
        "useImeGuard",
        "useLanguageGeneration",
        "activeLocale",
        "fmtNumber",
        "fmtDate",
        "fmtTime",
        "fmtDateTime",
        "fmtRelative",
        "compareText",
    },
    "@kirocrew/app-sdk/ui": {
        "Card",
        "CardTitle",
        "Btn",
        "SendBtn",
        "Input",
        "SearchInput",
        "Badge",
        "SourceBadge",
        "StatCard",
        "Skeleton",
        "ContentSkeleton",
        "EmptyState",
        "PageHeader",
        "Toggle",
        "InfoTip",
        "SegmentedControl",
        "MarkdownRenderer",
        "Clickable",
        "Modal",
        "ErrorNotice",
        "SettingsSection",
        "SettingsCard",
        "SettingsInput",
        "SettingsToggle",
        "SettingsSelect",
    },
}

# Directories git ignores here (see .gitignore): never part of a clone.
_UNTRACKED_DIRS = {".git", "node_modules", "__pycache__", ".pytest_cache", ".venv"}
_WINDOWS_RESERVED = re.compile(r"^(con|prn|aux|nul|com[1-9]|lpt[1-9])$", re.IGNORECASE)
#: sha256 of each skill's SKILL.md in the built-in (KiroCrew main 55439d8770).
_BUILTIN_SKILL_DIGESTS = {
    "skills/sage-review": "ef996f58d470b7260ba61974a2496148bbe528d8e2aa97d8b8ecf0638bf50772",
    "skills/learn-from-sage": "effb17341400cfb6d9e528b9087b35d995618b6a6cf81fd5fa107efb04af3711",
}

_STATIC_IMPORT = re.compile(
    r"^import\s+(?:(?P<clause>[^'\"]+?)\s+from\s+)?[\"'](?P<spec>[^\"']+)[\"'];?\s*$",
    re.MULTILINE,
)


def _manifest() -> dict:
    return json.loads((APP_ROOT / "app.json").read_text(encoding="utf-8"))


def _builtin() -> dict:
    return json.loads((APP_ROOT / "tests" / "fixtures" / "builtin-app.json").read_text("utf-8"))


def _bundle_imports() -> list[tuple[str, str]]:
    return [(m["spec"], (m["clause"] or "").strip()) for m in _STATIC_IMPORT.finditer(_text())]


def _text() -> str:
    return BUNDLE.read_text(encoding="utf-8")


def _named(clause: str) -> set[str]:
    """The imported names of ``{ a, b as c }``; empty for a namespace import."""
    match = re.search(r"\{([^}]*)\}", clause)
    if not match:
        return set()
    return {part.split(" as ")[0].strip() for part in match.group(1).split(",") if part.strip()}


def _tree() -> list[Path]:
    files: list[Path] = []
    for dirpath, dirnames, filenames in os.walk(APP_ROOT):
        dirnames[:] = [d for d in dirnames if d not in _UNTRACKED_DIRS]
        files += [Path(dirpath) / name for name in filenames]
        files += [Path(dirpath) / d for d in dirnames if (Path(dirpath) / d).is_symlink()]
    return files


class TestTheBundle(unittest.TestCase):
    def test_the_entry_the_manifest_names_is_committed(self) -> None:
        ui = _manifest()["ui"]
        self.assertEqual(ui["entry"], "dist/index.mjs")
        # ui.entry is relative to ui/.
        self.assertTrue((APP_ROOT / "ui" / ui["entry"]).is_file(), "run `npm run build` in ui/")

    def test_it_imports_only_what_the_host_provides(self) -> None:
        imports = _bundle_imports()
        self.assertTrue(imports, "no import statements found; the scan is broken")
        # Every top-level import statement is one the pattern read in full.
        starts = re.findall(r"^import\b", _text(), re.MULTILINE)
        self.assertEqual(len(starts), len(imports), "an import the scan could not parse")
        self.assertLessEqual({spec for spec, _ in imports}, HOST_MODULES)
        self.assertNotRegex(_text(), r"\bimport\s*\(", "a dynamic import would load a second file")

    def test_named_sdk_imports_exist_on_every_supported_host(self) -> None:
        for spec, clause in _bundle_imports():
            if spec in LEVEL0_EXPORTS:
                with self.subTest(module=spec):
                    self.assertLessEqual(_named(clause), LEVEL0_EXPORTS[spec])

    def test_level_1_names_are_feature_detected(self) -> None:
        text = _text()
        for name in ("Select", "guideCaution"):
            with self.subTest(name=name):
                self.assertIn(f'"{name}" in ', text)

    def test_no_build_machine_path_is_baked_in(self) -> None:
        self.assertNotRegex(_text(), r"/(?:home|Users|workplace)/|[A-Za-z]:\\\\")


class TestTheManifest(unittest.TestCase):
    def test_declares_the_first_kiro_crew_with_the_seams(self) -> None:
        self.assertRegex(_manifest().get("minKiroCrewVersion", ""), r"^\d+\.\d+\.\d+$")

    def test_what_adoption_compares_is_the_builtins(self) -> None:
        manifest, builtin = _manifest(), _builtin()
        for key in ("name", "version", "permissions", "dependencies", "defaultEnabled"):
            with self.subTest(field=key):
                self.assertEqual(manifest.get(key), builtin.get(key))
        self.assertEqual(manifest["platform"], builtin["platform"])

    def test_declares_nothing_adoption_cannot_carry(self) -> None:
        manifest = _manifest()
        self.assertNotIn("mcpServers", manifest)
        self.assertNotIn("overlays", manifest["ui"])
        self.assertNotIn("sessionApproval", manifest)
        self.assertIs(manifest["defaultEnabled"], False)

    def test_the_page_carries_no_glyph_of_its_own(self) -> None:
        """The legacy route and sidebar glyph come from Kiro Crew's pin, not from here."""
        pages = _manifest()["ui"]["pages"]
        self.assertEqual(
            pages, [{"route": "/apps/code-review-sage", "label": "Code Review Sage"}]
        )

    def test_listing_copy_matches_the_bundled_catalogs(self) -> None:
        """One source per string: the l10n block is the catalogs' ``manifest`` subtree,
        and the English fields are the built-in's own."""
        manifest, builtin = _manifest(), _builtin()
        catalogs = {
            p.stem: json.loads(p.read_text(encoding="utf-8"))["apps"]["codeReviewSage"]["manifest"]
            for p in sorted((APP_ROOT / "ui" / "i18n").glob("*.json"))
        }
        english = catalogs.pop("en")
        for key in ("displayName", "description", "highlights", "useCases", "configuration"):
            with self.subTest(field=key):
                self.assertEqual(manifest[key], builtin[key])
        self.assertEqual(manifest["displayName"], english["display_name"])
        self.assertEqual(manifest["description"], english["description"])
        self.assertEqual(manifest["ui"]["pages"][0]["label"], english["page_label"])
        count = len(manifest["highlights"])
        self.assertEqual(manifest["highlights"], [english[f"highlight_{i}"] for i in range(1, count + 1)])
        self.assertEqual(set(manifest["l10n"]), set(catalogs))
        for locale, strings in catalogs.items():
            with self.subTest(locale=locale):
                self.assertEqual(
                    manifest["l10n"][locale],
                    {
                        "displayName": strings["display_name"],
                        "description": strings["description"],
                        "pageLabel": strings["page_label"],
                        "highlights": [strings[f"highlight_{i}"] for i in range(1, count + 1)],
                    },
                )

    def test_art_is_repo_relative_png(self) -> None:
        manifest = _manifest()
        for key in ("iconPath", "heroImage", "heroImageDark", "heroImageDetail", "heroImageDetailDark"):
            with self.subTest(field=key):
                self.assertRegex(manifest[key], r"^assets/[a-z0-9-]+\.png$")
                self.assertTrue((APP_ROOT / manifest[key]).is_file())
        for shot in manifest["screenshots"]:
            self.assertTrue((APP_ROOT / shot).is_file(), shot)

    def test_hooks_name_callables(self) -> None:
        import importlib

        for hook, target in _manifest()["backend"]["hooks"].items():
            with self.subTest(hook=hook):
                module, _, attr = target.partition(":")
                mod = importlib.import_module(f"code_review_sage.{module}")
                self.assertTrue(callable(getattr(mod, attr)))

    def test_declares_the_builtins_skills_and_nothing_more(self) -> None:
        manifest = _manifest()
        self.assertEqual(manifest["skills"], _builtin()["skills"])
        for key in ("agents", "mcpServers", "crons"):
            with self.subTest(field=key):
                self.assertNotIn(key, manifest)
                self.assertNotIn(key, _builtin())
        for skill in manifest["skills"]:
            with self.subTest(skill=skill):
                self.assertTrue((APP_ROOT / skill / "SKILL.md").is_file())

    def test_the_skills_are_the_builtins_byte_for_byte(self) -> None:
        """Pinned by digest: the reviewer's instructions are part of what adoption keeps.

        Line endings are normalized first: a Windows checkout with core.autocrlf
        writes CRLF, and the root may hold no .gitattributes to stop it.
        """
        import hashlib

        digests = {
            skill: hashlib.sha256(
                (APP_ROOT / skill / "SKILL.md").read_bytes().replace(b"\r\n", b"\n")
            ).hexdigest()
            for skill in _manifest()["skills"]
        }
        self.assertEqual(digests, _BUILTIN_SKILL_DIGESTS)

    def test_hooks_load_the_way_the_gateway_loads_them(self) -> None:
        """Through the gateway's own module loader: a synthetic package, relative imports."""
        from unittest import mock

        from kiro_crew.apps import module_loader
        from kiro_crew.apps.module_loader import load_app_module, unload_app_modules

        name = "code-review-sage-loadcheck"
        path_before = list(sys.path)
        bare_before = "sage_lib" in sys.modules
        # Unloading also purges every module imported from this repository's files
        # under its real name, which is how this suite imports the app
        # (``code_review_sage.*``) and itself (``tests.*``); put those back so the
        # rest of the run keeps one copy of each module.
        ours = {
            key: module
            for key, module in sys.modules.items()
            if key.split(".")[0] in {"code_review_sage", "tests"}
        }
        # The operator's trust decision is not what this checks; loading is.
        with mock.patch.object(module_loader, "app_execution_denied", return_value=None):
            try:
                loaded = {
                    hook: load_app_module(name, APP_ROOT, target)
                    for hook, target in _manifest()["backend"]["hooks"].items()
                }
                for hook, fn in loaded.items():
                    with self.subTest(hook=hook):
                        self.assertTrue(callable(fn))
                        self.assertTrue(fn.__module__.startswith(f"_kirocrew_app_{name}."))
                # Each hook entry gets its own execution of backend/entry.py, so the
                # state the hooks share lives in backend/routes.py, imported once.
                routes = {id(fn.__globals__["routes"]) for fn in loaded.values()}
                self.assertEqual(len(routes), 1)
                self.assertEqual(len({id(fn.__globals__) for fn in loaded.values()}), len(loaded))
                for module in ("backend.routes", "sage_lib.review_driver", "sage_lib.store"):
                    self.assertIn(f"_kirocrew_app_{name}.{module}", sys.modules)
                # Nothing was added to sys.path or registered under a bare name.
                self.assertEqual(sys.path, path_before)
                self.assertEqual("sage_lib" in sys.modules, bare_before)
            finally:
                unload_app_modules(name)
                sys.modules.update(ours)

    def test_l10n_is_within_the_host_parser_limits(self) -> None:
        """A locale over a limit is dropped by the host, silently for the reader."""
        l10n = _manifest()["l10n"]
        self.assertLessEqual(len(l10n), 32)
        for locale, entry in l10n.items():
            with self.subTest(locale=locale):
                self.assertRegex(locale, r"^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})?$")
                self.assertLessEqual(
                    set(entry), {"displayName", "description", "pageLabel", "highlights"}
                )
                self.assertLessEqual(len(entry["displayName"]), 120)
                self.assertLessEqual(len(entry["description"]), 1000)
                self.assertLessEqual(len(entry["pageLabel"]), 60)
                self.assertLessEqual(len(entry["highlights"]), 12)
                self.assertTrue(all(len(h) <= 300 for h in entry["highlights"]))


# A model id literal in code: the families Kiro Crew's own review gate refuses.
_MODEL_LITERAL = re.compile(r"""["'`](?:claude-|opus|sonnet|haiku|gpt-|fable)[\w.:-]*["'`]""", re.I)


class TestNoHardcodedModel(unittest.TestCase):
    def test_no_model_id_literal_in_the_backend_or_the_page(self) -> None:
        roots = [APP_ROOT / "backend", APP_ROOT / "sage_lib", APP_ROOT / "ui" / "src"]
        found = []
        for root in roots:
            for path in sorted(root.rglob("*")):
                if path.suffix in {".py", ".ts", ".tsx"} and "__pycache__" not in path.parts:
                    for m in _MODEL_LITERAL.finditer(path.read_text(encoding="utf-8")):
                        found.append(f"{path.relative_to(APP_ROOT)}: {m.group(0)}")
        self.assertEqual(found, [])

    def test_the_default_model_is_the_hosts(self) -> None:
        """No configured model means the reviewer agent's model, else the host default."""
        from code_review_sage.sage_lib import review_pool, store

        self.assertIsNone(store.DEFAULT_CONFIG["review"]["model"])
        self.assertEqual(review_pool._DEFAULT_REVIEW_MODEL, review_pool._SYSTEM_DEFAULT_MODEL)
        from kiro_crew.config.loader import DEFAULT_MODEL

        self.assertEqual(review_pool._SYSTEM_DEFAULT_MODEL, DEFAULT_MODEL)


class TestTheTreeIsAdoptable(unittest.TestCase):
    def test_no_root_build_file(self) -> None:
        for name in (
            "package.json",
            "pyproject.toml",
            "setup.py",
            "requirements.txt",
            ".gitattributes",
        ):
            with self.subTest(name=name):
                self.assertFalse((APP_ROOT / name).exists())

    def test_no_link_and_no_unportable_name(self) -> None:
        seen: dict[str, str] = {}
        for path in _tree():
            rel = path.relative_to(APP_ROOT).as_posix()
            with self.subTest(path=rel):
                self.assertFalse(path.is_symlink(), "a link is refused by adoption")
                self.assertTrue(path.is_file(), "only regular files")
                self.assertNotRegex(rel, r"[\\:]")
                for part in rel.split("/"):
                    self.assertFalse(part.endswith((".", " ")), part)
                    self.assertIsNone(_WINDOWS_RESERVED.match(part.split(".")[0]), part)
                self.assertNotIn(
                    rel.lower(), seen, f"differs only in case from {seen.get(rel.lower())}"
                )
                seen[rel.lower()] = rel

    def test_the_tree_is_within_the_adoption_caps(self) -> None:
        files = _tree()
        self.assertLessEqual(len(files), 5000)
        self.assertLessEqual(sum(p.stat().st_size for p in files), 64 * 1024 * 1024)


if __name__ == "__main__":
    unittest.main()
