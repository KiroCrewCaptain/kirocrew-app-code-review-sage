"""Kiro Crew can move an existing built-in install onto this tree.

The move keeps ``data/`` and replaces the old folder with this tree, and it is
refused while the old folder holds an entry beside ``app.json`` that nothing
rebuilds and this tree does not ship (Kiro Crew's
``builtin_adoption_apply._nothing_beside_the_manifest``). A built-in that ran a
review has ``.kiro/settings/cli.json`` there: the review worker's workspace
settings, written into its working directory, the app's folder. This tree ships
``.kiro/`` so that move goes ahead.
"""

from __future__ import annotations

import json
import shutil
import tempfile
import unittest
import unittest.mock
from pathlib import Path

from code_review_sage.sage_lib import review_pool

from kiro_crew.apps import builtin_adoption_apply, manager

APP_ROOT = Path(__file__).resolve().parents[1]
NAME = "code-review-sage"


def _builtin_record(root: Path) -> Path:
    """A built-in record's folder as a review leaves it."""
    record = root / NAME
    (record / "data").mkdir(parents=True)
    (record / "app.json").write_text("{}", encoding="utf-8")
    (record / "installed.json").write_text("{}", encoding="utf-8")
    review_pool._write_effort_overlay(str(record), "some-model", "high")
    return record


class TestTheSwapIsNotRefused(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.record = _builtin_record(self.tmp / "apps")
        patcher = unittest.mock.patch.object(manager, "app_dir", lambda name: self.tmp / "apps" / name)
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_a_review_leaves_its_workspace_settings_beside_app_json(self) -> None:
        cli = self.record / ".kiro" / "settings" / "cli.json"
        self.assertTrue(cli.is_file())
        self.assertIn("chat.modelDefaults", json.loads(cli.read_text(encoding="utf-8")))

    def test_this_tree_ships_the_folder_so_the_swap_replaces_it(self) -> None:
        self.assertTrue((APP_ROOT / ".kiro" / "README.md").is_file())
        self.assertTrue(builtin_adoption_apply._nothing_beside_the_manifest(NAME, APP_ROOT))

    def test_a_tree_without_it_keeps_the_user_on_the_builtin(self) -> None:
        bare = self.tmp / "tree"
        bare.mkdir()
        for entry in APP_ROOT.iterdir():
            if entry.name not in (".kiro", ".git"):
                (bare / entry.name).touch()
        self.assertFalse(builtin_adoption_apply._nothing_beside_the_manifest(NAME, bare))


if __name__ == "__main__":
    unittest.main()
