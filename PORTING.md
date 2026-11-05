# Porting notes: built-in → external app

This repository was ported from Kiro Crew's built-in Code Review Sage at KiroCrew
`main` `55439d8770`:

- the app, `src/kiro_crew/apps/builtins/code_review_sage/` (`app.json`,
  `backend/routes.py` and `backend/routes_parts/*.py`, every `sage_lib/*.py`, both
  skills, and its own `tests/`);
- the dashboard page, `website/src/apps/code-review-sage/`, and its store art,
  `website/public/app-assets/code-review-sage/`;
- the `apps.codeReviewSage.*` strings of `website/src/i18n/locales/*.json` (for
  English, `en.json` and `en.manual.json` merged), plus the eight dashboard keys
  the page also reads (`app.collapse_sidebar`, `app.expand_sidebar`,
  `apps.issueRadar.components.prDetail.labels`,
  `components.resizeHandle.drag_to_resize`, `lib.scriptLabel.*`);
- the tests outside the app: `test/test_routes_parts_sage_composition_contract.py`,
  `test/test_sage_backend_routes_coverage.py`, `test/test_review_driver_loopback.py`,
  the Code Review Sage cases of `test/test_instance_credential_pairing.py`,
  `test/test_chat_folder_created_at.py`, `test/test_windows_replace_retry_sweep.py`,
  `test/test_security_source_scan_invariants.py`,
  `test/test_transport_permission_floor.py` and
  `test/test_surface_deny_notice_sites.py`, and every
  `website/src/test/CodeReviewSage*.test.*`, `codeReviewSage*.test.ts` and
  `Sage*.test.*`, plus the page's own `api.coverage.test.ts`.

Paths with a line number below refer to that commit. A **gap** is something the
built-in gets from Kiro Crew that an external app has no public way to get yet;
closing one is a Kiro Crew change (a generic, app-agnostic App Kit seam), not a
change here.

## What carried over unchanged

- `app.json` `name` (`code-review-sage`), `version` (`0.9.3`), `author`,
  `permissions` (`api: ["/api/apps/code-review-sage", "/api/apps/code-review-sage/*"]`,
  `network`, `storage`), `dependencies` (`commands: ["gh"]`), `platform`,
  `defaultEnabled: false`, `skills`, and every display field. 
  `tests/test_manifest_contract.py` compares them with the built-in's manifest
  (`tests/fixtures/builtin-app.json`), because adoption refuses a manifest that
  widens a grant or forces the app off.
- Both skills, `skills/sage-review/SKILL.md` and `skills/learn-from-sage/SKILL.md`,
  byte for byte (pinned by digest), so the materialized skill names and the
  reviewer's instructions do not change.
- The whole review engine in `sage_lib/`: the one-isolated-session-per-change
  driver, the worker response envelope, the reviewer pool and its batch-scoped
  runtime, the blast-radius signals, the Focus Report, the learning store and
  its consolidation, the follow-up transcripts, the GitHub adapter and the
  posting path, with their imports changed (below) and nothing else but the
  fail-closed fallbacks this file lists.
- Every route's method, path, validation, status codes and response shape; the
  run registry (`runs.json`) and its claims; the owner gate on every write.
- Where the data lives: `<data home>/apps/code-review-sage/data/` (`config.json`,
  `runs.json`, `repos.json`, `runs/`, `results/`, `reports/`, `learnings/`). The
  library derives it from the gateway's data home exactly as the built-in did,
  and it is the directory the gateway hands an installed app as `ctx.data_dir`
  (`register_routes` logs a context that names another one). An update or an
  adoption keeps `data/`, so nothing a user has is lost. The review workers still
  run with the app's root as their working directory, so the skills' relative
  `sage_lib/*.py` and `data/...` paths resolve in an installed copy too.
- The worker scripts (`<python> sage_lib/store.py --ensure`, `sage_lib/learning.py`,
  `sage_lib/pipeline.py`, `sage_lib/report.py`, `sage_lib/review_driver.py`) still
  run as scripts from the app root.

## What changed, and why

| Built-in | Here | Why |
|---|---|---|
| No `backend` in `app.json`; `register_routes(app)` called by the `BUILTIN_NAMES` loop and adding 26 absolute routes to `app.router` (`backend/routes.py:550-649`) | `"backend": {"hooks": {"routes", "on_startup", "on_shutdown"}}`, all three in `backend/entry.py`, which forwards to `backend/routes.py`: `register_routes(ctx) -> list[Route]` (`routes.ROUTE_TABLE`, relative paths, the same 26 method/path pairs in the same order), `on_startup(ctx)`, `on_shutdown(ctx)` | The `hooks.routes` contract. `Route` is the app's own frozen dataclass (`backend/_host.py`), accepted structurally from App Kit level 1. The handlers keep their one-argument shape; each record's handler looks its function up by name at call time. The gateway executes a hook's module once per hook entry, so the entry module holds no state and the routes module (imported once, as a sibling) holds all of it. |
| `app.on_startup` hooks for the layout self-heal, the orphan run-dir reap and the transcript sweeper; `app.on_cleanup` retired the review pool (`backend/routes.py:576-643`) | `on_startup(ctx)` runs the same three (the first two off the loop, as before; a re-run replaces the sweeper instead of stacking one); `on_shutdown(ctx)` stops the sweeper and retires the review pool | The gateway's application is frozen once it serves; an app must not append to it. `on_shutdown` also runs on disable and update, not only at exit, so the shared reviewer subprocess no longer outlives a disabled app. |
| `_require_enabled` on the two follow-up handlers (`backend/routes.py:268-290`) | Removed | The route registry deregisters a disabled app's routes; a request already in flight after `on_shutdown` meets an unbound context, and the owner gate refuses it (`tests/test_backend_routes_followup.py::test_a_shut_down_app_starts_no_follow_up`). The `app_disabled` 403 code is gone; the page never branched on it. |
| Absolute self-imports `kiro_crew.apps.builtins.code_review_sage.backend.routes_parts.*` (`backend/routes.py:136-207`), `sys.path.insert(<app root>)` and `from sage_lib import ...` (`backend/routes.py:59-80`, `sage_lib/review_pool.py:45-47`, and the five scripts) | Relative imports everywhere (`from ..sage_lib import ...`, `from . import store`); a script run adds the app root to `sys.path` only when it IS a script (`__package__` empty) | Hook files load into a synthetic package named after the app. Nothing of this app now lands under a bare top-level name (`sage_lib`) or on `sys.path` in the gateway (`tests/test_manifest_contract.py` loads the hooks through the gateway's own loader and checks both). |
| `kiro_crew._facade_compose.compose` (`backend/routes.py:135`) | `backend/_compose.py`, the same rebinding without the orchestrator-class branch the routes never used | A private module. Pure, no policy; the ported composition-contract test pins what it must do. |
| `kiro_crew.dashboard.handlers._shared.require_owner_dashboard_request` (`backend/routes.py:52`, and every part) | `ctx.require_owner(request, operation)` through `_host.require_owner` (App Kit level 1), bound as `require_owner_dashboard_request` on the facade so the parts read unchanged | The same host gate. A denial is audited as `code-review-sage.<verb>` (the built-in wrote `code_review_sage.<verb>`). No context, or a context without the seam: every caller is refused, the owner included. |
| `kiro_crew.sel.sel().log_api_access(caller="code-review-sage", ...)` for settings and namespace writes (`backend/routes_parts/settings.py:199`, `namespaces.py:88`) | `ctx.audit.record(operation, outcome, resources=...)` behind the facade's `sel()` | The level-0 audit seam. Rows read caller `app:code-review-sage`, operation `code-review-sage.update_review_settings` / `.create_namespace` / `.delete_namespace`. A context without it is a logged warning, as a failed audit write was. |
| `kiro_crew.loop_lock.LoopBoundLock` (`backend/routes.py:53`) | `_host.LoopBoundLock`: an `asyncio.Lock` rebuilt for each new loop | Private, and a few lines. Every contender is on the gateway's one loop. |
| `request.app["state"]` captured at registration (`backend/routes.py:597-604`) | `ctx.http_app["state"]` (granted because the manifest declares routes) | The same object; without it there is no bell notification and no follow-up, and health says so. |
| `kiro_crew.security.redact_credentials` / `redact_exfiltration_urls`, a **no-op** when the import failed (`sage_lib/store.py:716-731`, `review_driver.py:57`, `learning.py:643`, `pipeline.py:29`) | One redactor, `store.redact_text`, over the same two host passes; a host without them gets `[REDACTED: redaction unavailable]` instead of the text | Model-written text leaves this app for GitHub and the dashboard; a missing redactor must withhold it, not pass it through. |
| `kiro_crew.hooks.safe_read_file_bytes_nolink`, falling back to a plain `read_bytes` that follows links (`sage_lib/store.py:735`, `results.py:21`, `report.py:35`) | The same reader; without it the read is refused | The worker-reachable tree is exactly where a planted link lands. |
| `sage_lib/review_pool.py`: an approval with no security event log (`_sel is None`) still approved (`:113`, `:385-425`) | Refused with `SEL_UNAVAILABLE_REFUSAL` | The permission decision must be audited; a host that cannot record it does not get the tool. |
| `kiro_crew.config.loader.read_local_secret`, falling back to `<home>/.local_secret` when the import failed (`sage_lib/review_driver.py:749-784`) | The same resolver, looked up at call time; without it no credential is sent | That file names whichever gateway generation wrote it last. |
| `kiro_crew.platform_compat` and `kiro_crew.slugs.refused_slug_char`, imported unguarded (`sage_lib/learning.py:47-48`) | Looked up by name; no lock helpers refuse the consolidation lock (`OSError`), no slug reporter names no character | Fail closed where it guards, degrade where it only reports. |
| `kiro_crew.artifacts._SLUG_RE`, unguarded (`sage_lib/report.py:30`) | The host's pattern, else the same pattern restated (pinned equal) | Never more permissive. |
| `kiro_crew.shared_crew.admission.OperationKind` / `turn_gate.run_admitted_or_raise`, unguarded (`sage_lib/review_pool.py:749-750`) | Looked up by name; without them the review is refused before any turn | As before, a host without the gate failed the review; now with a reason. |
| `kiro_crew.atomic_write.atomic_write` / `read_bytes_with_retry`, `kiro_crew.user_json.loads_user_json`, `kiro_crew.model_registry`, `kiro_crew.hooks` (`backend/routes.py:49-54`) | The gateway's own, through `backend/_host.py`, each with a fallback (see gap 7) | No seam. |
| `kiro_crew.dashboard.chat_folder_order.next_folder_order`, `mate_folders.home_owner_of` (`backend/routes.py:368-369`) | The gateway's own; without the mate-home helper no existing folder is adopted (a new one is made) | No seam; the fallback never files a follow-up into a crewmate's home. |
| Loggers `kiro_crew.apps.builtins.code_review_sage.*` / `sage_lib.*` | `kirocrew.app.code-review-sage` for the routes (unchanged), `<package>.sage_lib.*` for the library | The library logger names follow the package the gateway loads it into. |
| GET routes answered HEAD too (aiohttp's `add_get`) | GET only | The registry dispatches the five methods a record may name. The page sends no HEAD. |
| `iconUrl` / `heroImage*` as absolute `/app-assets/code-review-sage/*.svg`, `screenshots` `/app-assets/…` | `iconPath` / `heroImage*` / `screenshots` as repo-relative PNGs under `assets/` | A registry app's art is repo-relative, and the catalog's publish step refuses SVG for a non-builtin source. The PNGs were rendered from the built-in SVGs (kept beside them) in headless Chromium: the icon at 512×512 on an opaque tile with `--ico-a` / `--ico-b` resolved to fixed colours, the heroes at 1200×675 and the detail heroes at 1200×288. `screenshot-main.png` is the built-in's. |
| `ui.pages` `[{"route": "/code-review-sage", "label": "Code Review Sage", "icon": "ScanSearch"}]`, page compiled into the dashboard (`website/src/apps/builtinRegistry.ts`) | `ui.entry: "dist/index.mjs"` (a committed ESM bundle built from `ui/src/`), `ui.pages` `[{"route": "/apps/code-review-sage", "label": "Code Review Sage"}]`, no `icon` | An installed app ships its page as a bundle AppHost loads. The legacy `/code-review-sage` route and `ScanSearch` glyph of an adopted record come from Kiro Crew's adoption pin, never from this manifest. |
| App Store copy keys in the dashboard catalogs (`website/src/components/appstore/appManifest.ts:143-156`) | `l10n` block in `app.json` for the 11 non-English locales | The listing copy travels with the app: the `apps.codeReviewSage.manifest` subtree of `ui/i18n/<locale>.json`, kept equal by a test. |
| No `minKiroCrewVersion`, no `license` | `"minKiroCrewVersion": "0.13.0"`, `"license": "Apache-2.0"` | 0.13.0 is the first release line with App Kit level 1; a 0.12.x route registry skips every record that is not its own `AppRoute`, so every route of this app would answer 404 there. |

## Host services without a seam: looked up by name, fail closed

No module of this app has an `import kiro_crew` statement. The library resolves
every gateway name through `sage_lib/_host.py` (`attr(module, name)` /
`module(name)`, plain `importlib`), and the backend through `backend/_host.py`,
which reuses it; `tests/test_no_host_imports.py` pins that every `kiro_crew` name
in code is such a lookup's argument. A missing name never breaks the module load:
the caller falls back exactly as the built-in did when its guarded import failed,
or, where that fallback was more permissive than the host (the five rows marked
above), refuses. `register_routes` reports what is missing through `ctx.health`
(`_host.capability_issues`). Kiro Crew is a pinned **test** dependency
(`tests/requirements.txt`), so the suite runs against the real collaborators.

| Built-in import | Where | Seam it needs |
|---|---|---|
| `kiro_crew.acp.runtime.AcpRuntime`, `kiro_crew.acp.types` (`EVENT_*`, `STOP_REASON_*`, `PROVIDER_LABEL_DEFAULT`), `kiro_crew.acp_backends` (backend ids, `backend_from_stored`, `resolve_selected_backend`) | `sage_lib/review_pool.py:52-67`, `followup.py:55` | A headless app-worker session API: spawn one runtime for a batch, one session per task, stream text/tool/permission/complete events, keep a transcript resumable. Without it no review starts. |
| `kiro_crew.permission_floor.refusal_for` / `OUTCOME_REJECTED_TRANSPORT_FLOOR`, `kiro_crew.llm_helpers._steer_host_deny`, `kiro_crew.constants.DENY_CAUSE_POLICY`, `kiro_crew.sel.sel().log_tool_invocation` | `sage_lib/review_pool.py:69`, `:113`, `:118-119` | The same session API carrying the host's permission floor and per-tool audit, so an app worker cannot approve a tool the host would refuse. Without the floor every tool is refused; without the log, too. |
| `kiro_crew.shared_crew.admission.OperationKind`, `shared_crew.turn_gate.run_admitted_or_raise` | `sage_lib/review_pool.py:749-750` | Fair admission for an app's background turns. Without it the review is refused. |
| `kiro_crew.workspace_cli_settings.workspace_cli_settings_lock`, `kiro_crew.kiro_cli.resolve_kiro_cli`, `kiro_crew.config.paths.kiro_agents_dir`, `kiro_crew.config.loader._stored_agent_value` / `_ABSENT_AGENT_KEY` / `DEFAULT_MODEL`, `kiro_crew.effort.EFFORT_LEVELS`, `kiro_crew.sandbox.SandboxUnavailableError`, `kiro_crew.edition`, `kiro_crew.enterprise_boot.kas_refusal`, `kiro_crew.platform_compat` | `sage_lib/review_pool.py:93-141`, `:185`, `:213`, `:397-405` | Part of the worker API: the effort overlay, the preflight, the backend choice and the sandbox refusal belong to the host. Each falls back to the built-in's standalone behaviour (no overlay, the reviewer default, `"auto"`, the five effort levels, no translation). |
| `kiro_crew.github_runner` (`resolve_gh`, `run_gh`, `gh_env`) | `sage_lib/discovery.py:40` | A provider-CLI runner seam (trusted binary, minimal env, audited spawn). Without it every `gh` call raises a setup error, as before. |
| `kiro_crew.config.paths.config_dir`, `kiro_sessions_dir` | `sage_lib/store.py:44`, `followup.py:76` | The data home is `ctx.data_dir`'s grandparent for the in-gateway half; the worker scripts have no context. Without `config_dir` the store reads `KIROCREW_HOME` (else `~/.kiro/crew`), the built-in's fallback; without `kiro_sessions_dir` no transcript is located (no follow-up). |
| `kiro_crew.platform_compat` (`restrict_to_owner`, `file_lock`, `open_create_or_existing`, `is_link_or_junction`), `kiro_crew.owner_only_files.ensure_directory`, `kiro_crew.atomic_write` (`replace_with_retry`, `anchored_parent`, `refuse_linked_parent`, `read_json_or`, `atomic_write`, `read_bytes_with_retry`), `kiro_crew.pinned_fs` (`pin_parent`, `supports_pinned_walk`), `kiro_crew.user_json.loads_user_json`, `kiro_crew.hooks.safe_read_file_bytes_nolink` | `sage_lib/store.py:51-137`, `:735`; `results.py:21`; `report.py:35`; `review_driver.py:65`; `followup.py:60`; `learning.py:47`; `backend/routes.py:49-54`; `backend/routes_parts/namespaces.py:259` | A public owner-only, link-safe file helper SDK. See gap 7 for what each fallback drops. |
| `kiro_crew.security.redact_credentials`, `redact_exfiltration_urls` | `sage_lib/store.py:717`, `review_driver.py:57`, `pipeline.py:29`, `learning.py:643` | `ctx.scrub` covers the in-gateway half, but the same redactor runs in the worker's scripts, which have no context; a scrub entry point for an app's child processes would let both use the seam. Without it the text is withheld. |
| `kiro_crew.loopback_http.loopback_urlopen`, `kiro_crew.config.loader.read_local_secret`, and the gateway's `/api/artifacts` with the internal secret | `sage_lib/review_driver.py:87`, `:145-223`, `:770` | An artifact-publish seam. Today the report archive dials the gateway's own API on loopback with its internal credential. Without the resolver no credential is sent and no report is archived (the inline report is unaffected). |
| `kiro_crew.model_registry.display_list("claude_code")` | `backend/routes_parts/settings.py:53` | A model-list seam. Without it the settings page offers only "Default (agent config)". |
| `kiro_crew.dashboard.chat_folder_order.next_folder_order`, `kiro_crew.dashboard.mate_folders.home_owner_of`; `state.mutate_folders`, `state.sessions.seed_conversation` / `resumable_sid`, `state._slots`, `state.notify` | `backend/routes.py:354-510`, `routes_parts/review_runs.py:281-300`, `routes_parts/publishing.py:156-168` | A session-resume seam (seed a named chat session's resume and file it), a slot-existence read, and a notification seam (`ctx.events` publishes to the app's own subscribers, not the bell). |
| `kiro_crew.artifacts._SLUG_RE`, `kiro_crew.slugs.refused_slug_char` | `sage_lib/report.py:30`, `learning.py:48` | Small; restated or degraded (see above). |

## Remaining gaps

1. **A new follow-up session cannot be opened.** The built-in's page armed the
   resume (`POST .../followup`) and then created the named chat slot through the
   dashboard's own `POST /api/chat/slots` (`website/src/apps/code-review-sage/components/ReviewChat.tsx:155`),
   with the reviewer's agent, the `Sage Review` folder and the title. That path
   is outside this app's API grant, and adoption refuses a widened grant. This
   copy CONTINUES a follow-up session that already exists (the host's
   `useChatLauncher().openChat({slotKey})`), and says plainly that a new one
   cannot be opened from the app yet. **This is a user-visible regression, so the
   adoption pin must wait for a seam**: for example `openChat` creating a missing
   `slotKey` with an agent, a title, a folder and a memory mode, under the app's
   identity.
2. **The pull request's own view is gone from the page.** The built-in's detail
   pane had a "Pull request" tab rendering the dashboard's shared
   `PullRequestPanel` (description, checks, comments, the file diff, commits) and
   header chips (open/merged, mergeable, failing checks), all from the
   dashboard's `/api/source/pull-request` (`components/PrReviewDetail.tsx:30`,
   `:300-330`, `components/PrSourcePanel.tsx:47`). Neither the endpoint (outside
   the grant) nor the component (not in the App SDK) is available. This copy
   shows the review and links the pull request out to GitHub; the title falls
   back to the review's own report row. **Adoption waits for** a pull-request
   panel in the App SDK, or a provider-read seam.
3. **Publishing the draft review moved to GitHub.** The built-in's publish bar
   (Approve / Request changes / Submit as comment) read the pending review and
   submitted it through the dashboard's `/api/source/pull-request/pending-review`
   and its submit, bound to the draft's content digest
   (`components/DraftReviewActions.tsx:53-62`). This copy keeps the built-in's
   delivery-evidence gate and, when this run did stage a draft, says so and links
   to the pull request, where GitHub's own form publishes it. **Adoption waits
   for** the same provider seam as gap 2.
4. **The review worker is driven through Kiro Crew's private ACP runtime** (see
   the table above). A refactor of `AcpRuntime`, the permission floor, the SEL
   or the admission gate can break reviews silently; `minKiroCrewVersion`, the
   capability report and the fail-closed fallbacks are the only guards. A
   headless app-worker session API would remove all of it.
5. **The reviewer agent.** Reviews run as `code-review-sage-reviewer` when a spec
   of that name is installed, else as `kirocrew`, as the built-in did; neither
   ships a reviewer agent, so in practice it is `kirocrew`. Shipping one from
   this app (`agents/`) would change the agent every existing follow-up resumes
   under; left as is for this wave.
6. **Report archive and notifications reach the dashboard internally** (the
   loopback `/api/artifacts` with the internal credential, `state.notify`). See
   the table; seams: artifact publish, owner notification.
7. **File helper drift.** Where the gateway lacks a helper, the fallbacks keep
   the built-in's standalone behaviour or refuse: `os.replace` without the
   Windows sharing-violation retry, a plain `chmod 0600` without a Windows DACL,
   no planted-link walk on the ancestor chain, no cross-process layout lock, a
   staged rename without the host's access-control carry-over
   (`backend/_host._fallback_atomic_write`), and a refused read where the
   link-safe reader is missing. A public file helper in the SDK would remove the
   copies.
8. **Execution trust.** A built-in's in-gateway Python is exempt from the
   third-party execution gate (`apps/execution.py`, `is_builtin_app`). This copy's
   hooks load only when the operator trusts it (`agent.apps_trusted`, or
   `agent.apps_allow_third_party`). For an existing user Kiro Crew's adoption
   writes that grant for this repository; a fresh install goes through the normal
   trust dialog.
9. **Styles.** The page keeps the built-in's Tailwind utility class strings. They
   render because the dashboard's stylesheet still carries them while the
   compiled built-in page ships with Kiro Crew.
10. **Dashboard components restated in the bundle** (`ui/src/host/`): the menu
    (the dashboard's is Radix), the dialog focus trap, the column-resize hooks,
    the resize handle, the narrow-viewport check, the icon button, the GitHub
    mark and a few pure helpers (`safeHttpUrl`, `pullRequestErrorDetails`,
    `refusedLetterParams`, `focusOnMount`). Each drops the dashboard-only parts
    (guide probes, stacked overlay coordination, the layout transition, the
    label bubble, storage tier reclaim). An App SDK export of the menu and the
    dialog trap would remove the copies.
11. **Store listing localization.** The catalog's publish step does not carry
    `l10n` yet, so a store row that is not installed shows the English fields.
12. **Sidebar icon on a fresh install.** The `ScanSearch` glyph and the
    `/code-review-sage` route are shown only for an adopted record (from Kiro
    Crew's pin). A fresh install lives at `/apps/code-review-sage` with the
    `iconPath` image.
13. **Author.** `app.json` keeps `"author": "kirocrew"`, the built-in's value; the
    catalog's publish step refuses a manifest-asserted reserved author, so
    attribution is stated on the catalog row.
14. **Built-in-only references left in core.** `security_posture.py:1158-1180`
    (the sage paths), the `github_runner.py:7` docstring, the gate rows in
    `test/test_transport_permission_floor.py:803`,
    `test/test_surface_deny_notice_sites.py:151`,
    `test/test_mcp_call_site_auth_coverage.py:99`,
    `test/test_subagent_shared_scratch.py:1207`,
    `test/spawn_audit_app_spawns.py`, `test/test_ci_file_shards.py`,
    `test/campaign_facade_inventories/kiro_crew.apps.builtins.code_review_sage.backend.routes.json`,
    `test/integration/test_boot_smoke.py`, `test/gui_user/features.json` and the
    `website/scripts/capture-sage-*.mjs` scripts name the built-in. They go when
    the built-in does. Core tests that use `code-review-sage` only as a sample
    app name or agent name (token auth, API health, dashboard approval, the ACP
    client's hooks and the others) stay in Kiro Crew with a neutral fixture.

## Layout

```
backend/
  entry.py              # the three hooks app.json names; holds no state
  routes.py             # the facade: state, follow-up endpoints, ROUTE_TABLE, hooks
  routes_parts/         # the handlers, composed onto routes.py (see its __init__)
    registry.py         # durable run registry (runs.json) + per-change claims
    review_runs.py      # pasted-link / whole-repo kickoffs, background driver, outcome
    run_threads.py      # per-run detail, report, cancel, delete, report archive
    publishing.py       # posting findings to the PR, dismissals, pending count
    repos.py            # repo + PR discovery, pinned-repo list
    settings.py         # review settings: model, effort, namespaces, concurrency
    namespaces.py       # learning namespaces, learnings view, consolidation
  _compose.py           # runs the parts on the facade's namespace
  _host.py              # App Kit context, owner gate, audit, gateway helpers
sage_lib/               # the review engine (also run as scripts by the worker)
  _host.py              # the one place gateway names are looked up
skills/                 # sage-review, learn-from-sage (byte for byte)
ui/                     # the page: src/, i18n/, the committed dist/index.mjs
tests/                  # the backend suite (Kiro Crew as a pinned test dependency)
capture/                # README media: scenes, harness, the stand-in gh
```

## UI

The page is `ui/src/`, ported from `website/src/apps/code-review-sage/` with the
same markup, class strings and behaviour except where gaps 1-3 removed a host
surface. `npm run build` in `ui/` writes the committed `ui/dist/index.mjs`; CI
rebuilds it and fails on a difference. Every request goes through the host's
scoped client (`useAppApi().raw`, handed to `setTransport` by the root), so a
path outside `permissions.api` is refused in the browser; the backend's `code`
and refused character are read back out of the client's refusal, as the
built-in read them off the response. Strings are `i18nT()` over
`ui/i18n/<locale>.json` for all 12 dashboard locales, under the dashboard's own
key paths; one key is new
(`apps.codeReviewSage.components.reviewChat.new_session_unavailable`, gap 1).

| Built-in | Here |
|---|---|
| `fetch('/api/apps/code-review-sage/...')` | `ui/src/api.ts`, the same `sageApi` over the scoped client |
| `components/ErrorNotice`, `MarkdownRenderer`, `Clickable` | The same components from `@kirocrew/app-sdk/ui` |
| `components/SimpleSelect` | `Select` from `@kirocrew/app-sdk/ui` (a native `<select>` on an older host) |
| `guide/trustRoot.guideCaution` | `guideCaution` from `@kirocrew/app-sdk/ui` (no marker on an older host) |
| `hooks/useImeGuard`, `i18n/format.fmtDateTime` / `compareText` | The same names from `@kirocrew/app-sdk` |
| `components/ui/dropdown-menu` (Radix), `hooks/useDialogFocusTrap`, `hooks/useColumnResize` / `usePointerDrag` / `useIsMobile`, `components/ResizeHandle`, `ListDetailBack`, `Tablist.useRovingTabs`, `components/ui.IconButton`, `icons/GithubLogo` | `ui/src/host/` (gap 10) |
| `framer-motion` on the add-repos dialog | No animation (the host does not provide the library) |
| `react-router-dom` `useSearchParams` / `useNavigate` | `?run=` read off `window.location`; the host's chat launcher |
| `api.createChatSlot`, `api.pullRequestSource`, `api.pullRequestPendingReview` / `submitPullRequestReview`, `PullRequestPanel` | Gaps 1-3 |
| `i18n/t.i18nT` with keys in the dashboard's catalogs | `ui/src/i18n.ts` over the app's own catalogs |

## Tests

| Built-in test | Here | Change |
|---|---|---|
| The app's own `tests/test_*.py` (41 files) | `tests/`, same names | Imports name the app as the package `code_review_sage` (registered by `tests/conftest.py` over the repository root) instead of `kiro_crew.apps.builtins.code_review_sage` or a bare `sage_lib`; private copies of the routes load inside that package (`tests/backend_routes_helpers.py`); route registration goes through `tests/harness.py` (`mount`), which serves `register_routes(ctx)` and the lifecycle hooks the way the gateway does. The conftest pins the data home, the kiro home and the workspace, and binds the host's own `AppContext`, so the owner gate is the real one. `test_a_disabled_app_answers_nothing` became `test_a_shut_down_app_starts_no_follow_up`; `TestNoBareLibNamespacePollution` now also pins that no bare `sage_lib` is registered. |
| `test/test_routes_parts_sage_composition_contract.py` | `tests/test_routes_parts_composition_contract.py` | Resolves relative imports before checking them; the corpus is this repository's suite; dropped the Kiro Crew leaf-scope gate case. |
| `test/test_sage_backend_routes_coverage.py` | `tests/test_backend_routes_coverage.py` | The audit is patched on the facade's `sel`; registration is tested through the hooks. |
| `test/test_review_driver_loopback.py` | same name | The fallback opener is a named function now, so it is called directly instead of re-executing the module head. |
| The sage cases of `test/test_instance_credential_pairing.py` | `tests/test_review_driver_credential_pairing.py` | Plus: a host without the resolver sends no credential. |
| The sage cases of `test/test_chat_folder_created_at.py`, `test_windows_replace_retry_sweep.py`, `test_security_source_scan_invariants.py`, `test_transport_permission_floor.py`, `test_surface_deny_notice_sites.py` | `tests/test_ported_core_cases.py` | The same assertions over this repository's files. |
| (none) | `tests/test_host_seams.py`, `tests/test_no_host_imports.py`, `tests/test_manifest_contract.py` | Every fail-closed path above and the capability report; only `_host` lookups reach `kiro_crew`; manifest parity, the skills' digests, the bundle's imports, the hooks loading through the gateway's module loader, no hardcoded model id, an adoptable tree. |
| `website/src/test/CodeReviewSage*`, `codeReviewSage*`, `Sage*`, `api.coverage.test.ts` | `ui/tests/`, same names | Run by vitest on jsdom with stand-ins for the host SDK (`ui/tests/stubs/`, plus a router and catalog stand-in). The selects are native in the stand-in; `CodeReviewSagePublish`, `CodeReviewSagePrSource`, `CodeReviewSageReviewChat` and five cases of `CodeReviewSageShell` were rewritten for gaps 1-3. |
| (none) | `ui/tests/externalSeams.test.tsx` | Catalog coverage and fallback, the scoped transport and its error mapping, the menu and focus-trap stand-ins, the older-host fallbacks. |

## What Kiro Crew keeps doing

The release that adds adoption still ships the built-in. A user's built-in
record moves onto this repository at the commit Kiro Crew pins, on the restart
after the tree is fetched and verified; a record that cannot move keeps running
the built-in copy, unchanged. For this app the pin waits on gaps 1-3.

## Release handoff: one commit for both pins

The adoption pin and the catalog row must name the same commit, and that commit
must be the ported tree.

1. Call the full 40-hex SHA of this repository's `main` `C`
   (`git rev-parse HEAD`).
2. In the Kiro Crew release PR that adds adoption, once gaps 1-3 are closed, run
   `python3 scripts/adoption_pin.py compute <this URL> C` and add the row it
   prints (commit, `treeSha256`, `archiveSha256`, `legacyNav`) to
   `src/kiro_crew/apps/adoption-pins.json`; then
   `python3 scripts/adoption_pin.py verify`. Until that row exists the release
   adopts nothing, and the catalog row must not switch.
3. The KiroCrewApps row for `code-review-sage` switches to `"type": "git"`, this
   URL, `"ref": "C"`. Never a branch name or a placeholder.
4. Check that both files name the same `C`, and that GitHub serves it: in a
   fresh clone, `git fetch origin C` succeeds and `git cat-file -t C` prints
   `commit`.
5. The catalog PR stays a draft, labelled hold-for-release, until the Kiro Crew
   release that ships adoption and the App Kit level-1 seams is published.
