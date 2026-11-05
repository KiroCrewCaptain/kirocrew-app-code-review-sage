"""Write data.json: the fictional GitHub the capture's stand-in `gh` serves.

Everything here is invented for the README: the `fernleaf-garden` organisation,
its two repositories, their pull requests, people and diffs. Run it after editing
the pull requests below; capture never runs it.
"""
import json
from pathlib import Path

ORG = "fernleaf-garden"
ME = "sam-fernleaf"
NOW = "2026-11-03T16:20:00Z"


def sha(seed: str) -> str:
    import hashlib
    return hashlib.sha1(seed.encode()).hexdigest()


FROST_PATCH = """@@ -1,18 +1,34 @@
 \"\"\"Last spring frost and first autumn frost, by postcode.\"\"\"
 
 import datetime as dt
 
 import requests
 
 from seedswap.config import settings
 
+# Frost dates barely change from one request to the next, so remember every
+# postcode we have looked up instead of asking the climate service each time.
+_FROST_CACHE: dict[str, dict] = {}
+
 
 def frost_dates(postcode: str) -> dict:
     \"\"\"Return {"last_spring": date, "first_autumn": date} for a postcode.\"\"\"
-    resp = requests.get(
-        f"{settings.CLIMATE_API}/frost",
-        params={"postcode": postcode},
-        timeout=5,
-    )
-    resp.raise_for_status()
-    body = resp.json()
-    return {
-        "last_spring": dt.date.fromisoformat(body["last_spring"]),
-        "first_autumn": dt.date.fromisoformat(body["first_autumn"]),
-    }
+    key = postcode.strip().upper()
+    if key in _FROST_CACHE:
+        return _FROST_CACHE[key]
+    try:
+        resp = requests.get(
+            f"{settings.CLIMATE_API}/frost",
+            params={"postcode": key},
+        )
+        resp.raise_for_status()
+        body = resp.json()
+        result = {
+            "last_spring": dt.date.fromisoformat(body["last_spring"]),
+            "first_autumn": dt.date.fromisoformat(body["first_autumn"]),
+        }
+    except Exception:
+        # Fall back to the national average so the calendar still renders.
+        result = {"last_spring": dt.date(2026, 4, 15), "first_autumn": dt.date(2026, 10, 20)}
+    _FROST_CACHE[key] = result
+    return result
"""

FROST_TEST_PATCH = """@@ -10,3 +10,14 @@ def test_frost_dates_parses_the_service_reply(climate):
     climate.reply({"last_spring": "2026-04-02", "first_autumn": "2026-10-28"})
     dates = frost.frost_dates("FL1 2AB")
     assert dates["last_spring"] == dt.date(2026, 4, 2)
+
+
+def test_frost_dates_are_cached(climate):
+    climate.reply({"last_spring": "2026-04-02", "first_autumn": "2026-10-28"})
+    frost.frost_dates("FL1 2AB")
+    frost.frost_dates("fl1 2ab")
+    assert climate.calls == 1
"""

CANCEL_PATCH = """@@ -1,9 +1,10 @@
 from flask import Blueprint, abort, jsonify, request
 
 from seedswap.auth.session import current_member, login_required
 from seedswap.db import db
 from seedswap.models import SwapRequest
+from seedswap.notify import tell_member
 
 bp = Blueprint("swaps", __name__, url_prefix="/swaps")
 
@@ -38,3 +39,22 @@ def accept_swap(swap_id: int):
     swap.status = "accepted"
     db.session.commit()
     return jsonify(swap.to_dict())
+
+
+@bp.route("/<int:swap_id>", methods=["DELETE"])
+@login_required
+def cancel_swap(swap_id: int):
+    \"\"\"Let a member take back a swap request they no longer want.\"\"\"
+    swap = SwapRequest.query.get(swap_id)
+    if swap is None:
+        abort(404)
+    if swap.status == "accepted":
+        return jsonify({"error": "this swap was already accepted"}), 409
+    reason = request.args.get("reason", "")
+    db.session.delete(swap)
+    db.session.commit()
+    tell_member(
+        swap.offered_by_id,
+        f"{current_member().display_name} cancelled their request: {reason}",
+    )
+    return "", 204
"""

WELCOME_PATCH = """@@ -1,7 +1,7 @@
 Hi {{ member.display_name }},
 
-Welcome to Seed Swap! You can now list the seeds you have spare and recieve
+Welcome to Seed Swap! You can now list the seeds you have spare and receive
 seeds from gardeners near you.
 
 Happy growing,
 The Fernleaf Garden volunteers
"""

CAL_PATCH = """@@ -12,6 +12,12 @@ export function MonthHeader({ month, frost }: Props) {
   return (
     <header className="month">
       <h2>{monthName(month)}</h2>
+      {frost?.lastSpring && sameMonth(frost.lastSpring, month) && (
+        <p className="frost">Last frost around {formatDay(frost.lastSpring)}</p>
+      )}
+      {frost?.firstAutumn && sameMonth(frost.firstAutumn, month) && (
+        <p className="frost">First frost around {formatDay(frost.firstAutumn)}</p>
+      )}
     </header>
   )
 }
"""


def file_row(filename, patch, status="modified"):
    adds = sum(1 for l in patch.splitlines() if l.startswith("+") and not l.startswith("+++"))
    dels = sum(1 for l in patch.splitlines() if l.startswith("-") and not l.startswith("---"))
    return {"filename": filename, "status": status, "additions": adds, "deletions": dels,
            "changes": adds + dels, "patch": patch}


def pr(repo, number, title, author, body, files, updated, labels, draft=False):
    full = f"{ORG}/{repo}"
    url = f"https://github.com/{full}/pull/{number}"
    head = sha(f"{full}#{number}")
    adds = sum(f["additions"] for f in files)
    dels = sum(f["deletions"] for f in files)
    return {
        "url": f"https://api.github.com/repos/{full}/pulls/{number}",
        "html_url": url, "number": number, "state": "open", "title": title,
        "body": body, "draft": draft, "user": {"login": author},
        "labels": [{"name": n} for n in labels],
        "created_at": "2026-11-02T09:00:00Z", "updated_at": updated,
        "head": {"ref": f"{author}/pr-{number}", "sha": head,
                 "repo": {"full_name": full}},
        "base": {"ref": "main", "sha": sha(f"{full}@main"), "repo": {"full_name": full}},
        "additions": adds, "deletions": dels, "changed_files": len(files),
        "mergeable": True, "mergeable_state": "clean", "merged_at": None,
        "requested_reviewers": [{"login": ME}],
        "_files": files,
    }


PRS = [
    pr("seed-swap", 42, "Cache the frost-date lookup per postcode", "ana-greenleaf",
       "The planting calendar asks the climate service for frost dates on every page "
       "view. This keeps each postcode's answer in memory so the calendar renders "
       "without waiting on the service.",
       [file_row("seedswap/weather/frost.py", FROST_PATCH),
        file_row("tests/weather/test_frost.py", FROST_TEST_PATCH)],
       "2026-11-03T15:05:00Z", ["performance", "calendar"]),
    pr("seed-swap", 43, "Let members cancel a swap request", "ravi-sprout",
       "Adds DELETE /swaps/<id> so a member can withdraw a request they no longer "
       "need, and tells the member who offered the seeds.",
       [file_row("seedswap/routes/swaps.py", CANCEL_PATCH)],
       "2026-11-03T14:40:00Z", ["swaps"]),
    pr("seed-swap", 44, "Fix a typo in the welcome email", "jo-compost",
       "\"recieve\" -> \"receive\".",
       [file_row("seedswap/templates/email/welcome.txt", WELCOME_PATCH)],
       "2026-11-02T18:10:00Z", ["docs"]),
    pr("planting-calendar", 7, "Show the frost dates on the month header", "ana-greenleaf",
       "The calendar now says when the last spring frost and the first autumn frost "
       "fall, in the month they fall in.",
       [file_row("src/MonthHeader.tsx", CAL_PATCH)],
       "2026-11-03T11:30:00Z", ["calendar"]),
]

REPOS = [
    {"owner": {"login": ORG}, "name": "seed-swap", "full_name": f"{ORG}/seed-swap",
     "pushed_at": "2026-11-03T15:05:00Z", "private": False, "archived": False,
     "permissions": {"push": True}, "default_branch": "main",
     "html_url": f"https://github.com/{ORG}/seed-swap"},
    {"owner": {"login": ORG}, "name": "planting-calendar",
     "full_name": f"{ORG}/planting-calendar", "pushed_at": "2026-11-03T11:30:00Z",
     "private": False, "archived": False, "permissions": {"push": True},
     "default_branch": "main", "html_url": f"https://github.com/{ORG}/planting-calendar"},
    {"owner": {"login": ME}, "name": "allotment-notes", "full_name": f"{ME}/allotment-notes",
     "pushed_at": "2026-10-28T08:00:00Z", "private": True, "archived": False,
     "permissions": {"push": True}, "default_branch": "main",
     "html_url": f"https://github.com/{ME}/allotment-notes"},
]

EVENTS = [
    {"type": "PullRequestReviewEvent", "repo": {"name": f"{ORG}/seed-swap"},
     "created_at": "2026-11-03T10:00:00Z"},
    {"type": "PushEvent", "repo": {"name": f"{ORG}/planting-calendar"},
     "created_at": "2026-11-02T10:00:00Z"},
]

data = {"me": ME, "repos": REPOS, "events": EVENTS, "pulls": PRS,
        "review_requested": [f"{ORG}/seed-swap#43", f"{ORG}/planting-calendar#7"]}
Path(__file__).with_name("data.json").write_text(
    json.dumps(data, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
print("wrote data.json")
