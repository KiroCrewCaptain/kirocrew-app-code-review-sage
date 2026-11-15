# .kiro

The review worker runs with this app's folder as its working directory, and Code
Review Sage writes that worker's Kiro CLI workspace settings here before each
review session (`.kiro/settings/cli.json`, which carries the review's reasoning
effort; `sage_lib/review_pool.py`, `_write_effort_overlay`). Nothing in this
folder is configuration to edit, and the settings file is rewritten on every
review, so it is never committed (`.gitignore`).

This README is committed so the folder is part of the app. When Kiro Crew moves an
existing built-in Code Review Sage onto this repository, it refuses the move while
the old folder holds an entry beside `app.json` that the new tree does not ship,
because the move would delete it. Every built-in install that ran a review has this
folder, so shipping it lets the move replace it (the next review writes the
settings again) instead of keeping that user on the built-in.
