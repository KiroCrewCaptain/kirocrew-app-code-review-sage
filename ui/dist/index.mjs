import { activeLocale, compareText, fmtDateTime, useAppApi, useChatLauncher, useImeGuard, useLanguageGeneration } from "@kirocrew/app-sdk";
import { Children, cloneElement, createContext, forwardRef, isValidElement, useCallback, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { AlertCircle, AlertTriangle, ArrowLeft, Brain, Check, CheckCircle2, ChevronDown, ChevronRight, Circle, CircleSlash, ClipboardCheck, ClipboardList, ClipboardPaste, Clock, ExternalLink, EyeOff, FolderGit2, GitBranch, GitMerge, GitPullRequest, Inbox, Link2, ListChecks, Loader2, Lock, MessageCircle, MessageSquarePlus, PanelLeftClose, Plus, RefreshCw, RotateCcw, ScanSearch, Search, Settings, Share2, ShieldCheck, ShipWheel, Star, Tag, Trash2, TriangleAlert, Wand2, X, XCircle, XOctagon } from "lucide-react";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as ui from "@kirocrew/app-sdk/ui";
import { Clickable, ErrorNotice, MarkdownRenderer } from "@kirocrew/app-sdk/ui";
import { createPortal } from "react-dom";
// src/api.ts
var API = "/api/apps/code-review-sage";
/** A failed request, carrying the backend's machine-readable `code`.
*
*  The prose in `message` is English produced in Python and is advisory only —
*  rendering it inside a localized page is what the error-code contract exists to
*  stop. Callers that show copy to the user switch on `code` and supply their own
*  translated string; `message` is for logs and for codes nobody has mapped yet. */
var SageApiError = class extends Error {
	code;
	/** For `invalid_namespace_name`: the refused character, or '' when none was named. */
	char;
	constructor(message, code, char = "") {
		super(message);
		this.name = "SageApiError";
		this.code = code;
		this.char = char;
	}
};
async function parseErrorBody(r) {
	try {
		const body = await r.json();
		return new SageApiError(body.error || `HTTP ${r.status}`, body.code || "", typeof body.char === "string" ? body.char : "");
	} catch {
		return new SageApiError(`HTTP ${r.status}`, "");
	}
}
/** Before the root mounts (tests, or a module evaluated early): a plain fetch
*  that answers like the scoped client, a non-2xx thrown with its raw body. */
var sameOriginFetch = { async raw(path, init) {
	const r = await fetch(path, {
		credentials: "same-origin",
		...init
	});
	if (!r.ok) {
		const text = await r.text().catch(() => r.statusText);
		throw Object.assign(/* @__PURE__ */ new Error(`API ${r.status}: ${text}`), {
			status: r.status,
			body: text
		});
	}
	return r;
} };
var transport = sameOriginFetch;
/** Route every call through *next* (the page root passes `useAppApi()`). */
function setTransport(next) {
	transport = next ?? sameOriginFetch;
}
/** The scoped client's refusal (status + raw body), as the backend's coded error. */
function fromRefusal(err) {
	if (err && typeof err === "object" && typeof err.status === "number") {
		const status = err.status;
		const raw = err.body;
		return parseErrorBody(new Response(typeof raw === "string" ? raw : "", { status: status >= 200 && status <= 599 ? status : 500 }));
	}
	return err;
}
async function call(path, init) {
	let r;
	try {
		r = await transport.raw(`${API}${path}`, init);
	} catch (err) {
		throw await fromRefusal(err);
	}
	if (!r.ok) throw await parseErrorBody(r);
	return r.json();
}
async function getJSON(path) {
	return call(path, { credentials: "same-origin" });
}
async function sendJSON(path, method, body) {
	return call(path, {
		method,
		credentials: "same-origin",
		headers: { "Content-Type": "application/json" },
		body: body === void 0 ? void 0 : JSON.stringify(body)
	});
}
var sageApi = {
	/** Stored history for one reviewed change, plus whether a follow-up session
	*  would restore the reviewer's own context. */
	chatState: (runId, changeId) => getJSON(`/chat?run_id=${encodeURIComponent(runId)}&change_id=${encodeURIComponent(changeId)}`),
	/** Arm the resume and get what the chat slot needs. Rejects with a
	*  `SageApiError` whose `code` is `followup_not_recorded` /
	*  `followup_transcript_gone` / `chat_run_deleted` / ... */
	followupStart: (runId, changeId) => sendJSON("/followup", "POST", {
		run_id: runId,
		change_id: changeId
	}),
	runs: () => getJSON("/runs"),
	run: (runId) => getJSON(`/runs/${encodeURIComponent(runId)}`),
	/** The run's Focus Report as data — this is what renders INLINE, so no part of
	* viewing a report goes through the artifact store. */
	runReport: (runId) => getJSON(`/runs/${encodeURIComponent(runId)}/report`),
	cancelRun: (runId) => sendJSON(`/runs/${encodeURIComponent(runId)}/cancel`, "POST"),
	deleteRun: (runId) => sendJSON(`/runs/${encodeURIComponent(runId)}`, "DELETE"),
	/** Publish a finished run's findings to its pull request. Never automatic —
	*  reviews are read in the app unless the user asks for them to be posted. */
	postComments: (runId, select) => sendJSON(`/runs/${encodeURIComponent(runId)}/post`, "POST", select ? {
		change_id: select.changeId,
		...select.keys ? { keys: select.keys } : {}
	} : {}),
	/** Post a selection spanning several changes as ONE request.
	*
	*  `posting` is a per-run flag, so one request per change had every request
	*  after the first refused with `already_posting` — the endpoint returns
	*  before the poster clears the flag, so no amount of client-side sequencing
	*  helps. The backend applies each group's keys to its own change inside a
	*  single posting cycle.
	*/
	postCommentGroups: (runId, groups) => sendJSON(`/runs/${encodeURIComponent(runId)}/post`, "POST", { groups: groups.map((g) => ({
		change_id: g.changeId,
		...g.keys ? { keys: g.keys } : {}
	})) }),
	/** Dismiss one finding with a reason, or undo that with `reason: null`. A
	*  dismissed finding stays in the report but is never posted. */
	dismissFinding: (runId, changeId, key, reason) => sendJSON(`/runs/${encodeURIComponent(runId)}/dismiss`, "POST", reason === null ? {
		change_id: changeId,
		key,
		dismissed: false
	} : {
		change_id: changeId,
		key,
		reason
	}),
	/** Publish this run's report as a shareable artifact (retry / share path). */
	archiveRun: (runId) => sendJSON(`/runs/${encodeURIComponent(runId)}/archive`, "POST"),
	/** Review specific PRs (the picker's path, and the pasted-links escape hatch). */
	review: (changes) => sendJSON("/review", "POST", { changes }),
	reviewLinks: (links) => sendJSON("/review", "POST", { links }),
	reviewRepo: (repo, force = false) => sendJSON("/review-repo", "POST", {
		repo,
		force
	}),
	recentRepos: (days) => getJSON(`/recent-repos${days === void 0 ? "" : `?days=${days}`}`),
	/** Every repo the gh user can reach — the "recently touched" list misses repos
	* you own but haven't pushed to lately. */
	myRepos: () => getJSON("/my-repos"),
	pinnedRepos: () => getJSON("/repos"),
	pinRepo: (owner, repo) => sendJSON("/repos", "POST", {
		owner,
		repo
	}),
	pinRepoUrl: (url) => sendJSON("/repos", "POST", { repo: url }),
	unpinRepo: (owner, repo) => sendJSON("/repos", "DELETE", {
		owner,
		repo
	}),
	repoPrs: (repo) => getJSON(`/repo-prs?repo=${encodeURIComponent(repo)}`),
	/** Open PRs across GitHub that request the gh user's review. */
	reviewQueue: () => getJSON("/review-queue"),
	settings: () => getJSON("/settings"),
	putSettings: (patch) => sendJSON("/settings", "PUT", patch),
	namespaces: () => getJSON("/namespaces"),
	createNamespace: (name) => sendJSON("/namespaces", "POST", { name }),
	deleteNamespace: (name) => sendJSON("/namespaces", "DELETE", { name }),
	learnings: (namespace) => getJSON(`/learnings?namespace=${encodeURIComponent(namespace)}`),
	/** Merge a namespace's staged learnings into the ruleset reviews load. The
	*  merge itself is one worker turn; this returns as soon as it is running. */
	consolidateLearnings: (namespace) => sendJSON("/learnings/consolidate", "POST", { namespace })
};
// src/host/cn.ts
/** Join class names, dropping empty ones (the dashboard's `cn` also merges Tailwind
*  conflicts; every caller here passes non-conflicting overrides). */
function cn(...parts) {
	return parts.filter(Boolean).join(" ");
}
// src/host/IconButton.tsx
/**
* The dashboard's small icon button (`components/ui.IconButton`), which the App
* SDK does not export. Same classes and variants; the dashboard's hover label
* bubble is the browser's own `title` tooltip here, from the required label.
*/
var VARIANTS = {
	default: "text-muted hover:text-text hover:bg-bg-hover",
	accent: "text-muted hover:text-accent hover:bg-bg-hover",
	danger: "text-muted hover:text-danger-text hover:bg-danger-subtle",
	active: "text-accent hover:bg-bg-hover"
};
var IconButton = forwardRef(({ variant = "default", className, children, title, ...rest }, ref) => /* @__PURE__ */ jsx("button", {
	ref,
	type: "button",
	title: title ?? rest["aria-label"],
	className: cn("p-[4px] rounded transition-all active:scale-[0.97] active:duration-75 cursor-pointer bg-transparent border-none disabled:opacity-30 disabled:cursor-not-allowed", VARIANTS[variant], className),
	...rest,
	children
}));
IconButton.displayName = "IconButton";
// src/host/ListDetailBack.tsx
/**
* Return-to-list control for the narrow-viewport list-detail drill-down
* (see `hooks/useListDetailView`). Rendered only while the detail pane is the
* one visible pane, so it is the sole way back — component selection state is
* not history, and a browser back-swipe would leave the page entirely.
*
* `label` names the list being returned to ("Skills", "Steering files") rather
* than a bare "Back", which also means callers reuse the label they already
* have for the list instead of every shell adding its own catalog key.
*
* 44px tall, not the 36px the rest of these headers use: this is the only way
* out of the pane on a touch device, and 44 is what Apple's HIG builds to
* (44pt default, 28pt floor) and what Fluent and Primer recommend for mobile.
* WCAG 2.2 SC 2.5.8's 24px is a floor to clear, not a target to design to.
*
* `disabled` is for callers that gate `onBack` (an in-flight save): the
* control must read as unavailable, not look live and do nothing.
*/
function ListDetailBack({ label, onBack, disabled = false }) {
	return /* @__PURE__ */ jsxs("button", {
		type: "button",
		onClick: onBack,
		disabled,
		"aria-disabled": disabled || void 0,
		className: "flex shrink-0 items-center gap-1 min-h-11 -ml-1 px-2 rounded-md bg-transparent border-none text-[13px] text-muted enabled:hover:text-text enabled:hover:bg-bg-hover cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 transition-colors focus-ring",
		children: [/* @__PURE__ */ jsx(ArrowLeft, {
			size: 14,
			"aria-hidden": "true",
			className: "lucide-inline"
		}), label]
	});
}
// src/i18n.ts
/**
* The app's own strings. A bundle cannot read the dashboard's catalogs (those
* belong to the host and change with it), so every locale the dashboard ships is
* bundled here and looked up against the host's active language.
*
* The catalogs (`ui/i18n/<locale>.json`) are the `apps.autoResearch.*` subtree
* copied from Kiro Crew's dashboard catalogs (for English, its generated and
* hand-authored catalogs merged), under the SAME key paths, so every call site
* reads as it did in the built-in.
*
* Lookup order: the exact locale (`pt`, `zh-CN`), then its base language, then
* English, then the key itself. A numeric `count` selects the plural form the
* locale's rules name (`_one`, `_few`, `_many`, `_other`), as the dashboard's own
* catalogs are keyed. `{{name}}` placeholders are filled from `vars`; one with no
* value is left as written.
*
* `t` reads the language at call time. The root component subscribes to the
* host's language changes (`useLanguageGeneration`), and its re-render reaches
* every child, so a language switch repaints the page without a reload.
*/
var CATALOGS = {
	bn: {
		app: {
			"collapse_sidebar": "সাইডবার সংকুচিত করো",
			"expand_sidebar": "সাইডবার প্রসারিত করো"
		},
		apps: /* @__PURE__ */ JSON.parse("{\"codeReviewSage\":{\"codeReviewSagePage\":{\"open_pr_one\":\"{{count}}টি open PR\",\"open_pr_other\":\"{{count}}টি open PR\",\"pattern_one\":\"{{count}}টি প্যাটার্ন\",\"pattern_other\":\"{{count}}টি প্যাটার্ন\"},\"components\":{\"addReposModal\":{\"add\":\"যোগ করো\",\"add_one_by_url_above\":\"উপরে URL দিয়ে একটা যোগ করো।\",\"add_repo\":\"{{repo}} যোগ করো\",\"add_repos\":\"রেপো যোগ করো\",\"added\":\"যোগ করা হয়েছে\",\"all_your_repos\":\"তোমার সব রেপো\",\"already_added\":\"{{repo}} আগেই যোগ করা আছে\",\"archived\":\"আর্কাইভ করা\",\"based_on_recent_github_activity\":\"তোমার সাম্প্রতিক GitHub কাজের ভিত্তিতে\",\"close\":\"বন্ধ করো\",\"close_add_repos_dialog\":\"রেপো যোগ করার ডায়ালগ বন্ধ করো\",\"contributed_events_one\":\"{{age}} · {{count}}টি কার্যক্রম\",\"contributed_events_other\":\"{{age}} · {{count}}টি কার্যক্রম\",\"filter_your_repos\":\"তোমার রেপো ছেঁকে নাও\",\"gh_auth_login\":\"gh auth login\",\"github_cli_not_ready\":\"GitHub CLI তৈরি নয়\",\"newest_100_by_push_date\":\"পুশের তারিখ অনুযায়ী সর্বশেষ 100টি\",\"no_repos_for_account\":\"তোমার অ্যাকাউন্টে কোনো রেপো পাওয়া যায়নি।\",\"no_repos_match_filter\":\"তোমার ফিল্টারের সঙ্গে কোনো রেপো মেলে না।\",\"owner_repo_a_repo_url_or_paste_a_pull_request_li\":\"owner/repo, রেপোর URL, বা pull request-এর লিংক পেস্ট করো\",\"pick_from_the_repos_you_can_reach_or_type_one_in\":\"যেসব রেপোতে তোমার নাগাল আছে সেখান থেকে বেছে নাও, বা নাম লিখে দাও। যোগ করা রেপো সাইডবারে দেখা যায়, যাতে তুমি সেখান থেকেই রিভিউ শুরু করতে পারো। pull request-এর লিংক পেস্ট করলে সেই pull request সরাসরি খুলে যায়।\",\"pinned_to_the_sidebar\":\"সাইডবারে পিন করা\",\"private\":\"ব্যক্তিগত\",\"pushed_age\":\"{{age}} পুশ করা হয়েছে\",\"re_read_your_repos_from_github\":\"GitHub থেকে তোমার রেপো আবার পড়ো\",\"read_only\":\"শুধু পড়া\",\"read_only_access\":\"শুধু পড়ার অনুমতি\",\"reading_your_repos_from_github\":\"GitHub থেকে তোমার রেপো পড়া হচ্ছে…\",\"recently_worked_on\":\"সম্প্রতি কাজ করা\",\"refresh_your_repos\":\"তোমার রেপো নতুন করে আনো\",\"remove\":\"সরাও\",\"remove_repo\":\"{{repo}} সরাও\",\"repository_or_pull_request_url_or_owner_repo\":\"রিপোজিটরি বা pull request-এর URL, বা owner/repo\",\"setup_hint\":\"GitHub CLI ইনস্টল করো আর নিচের কমান্ড দিয়ে সাইন ইন করো, তাহলে তোমার রেপোর তালিকা পাবে। উপরে URL দিয়ে যে-কোনো রেপো এখনও যোগ করতে পারো।\",\"these_lists_are_capped_so_a_repo_you_have_not_to\":\"এই তালিকাগুলোর সীমা আছে, তাই সম্প্রতি হাত না দেওয়া কোনো রেপো বাদ পড়তে পারে। না দেখলে উপরে URL দিয়ে যোগ করে নাও।\",\"your_repos\":\"তোমার রেপো\"},\"bandChips\":{\"all\":\"সব\",\"clean\":\"কোনো সমস্যা নেই\",\"filter_by_band\":\"শ্রেণি অনুযায়ী ছাঁকো\",\"needs_review\":\"পর্যালোচনা দরকার\",\"worth_a_glance\":\"একবার দেখুন\"},\"draftReviewActions\":{\"approve\":\"অনুমোদন করুন\",\"approve_is_unavailable_because_this_base_branch_\":\"অনুমোদন করা যাচ্ছে না: এই পুল রিকোয়েস্টের বেস ব্রাঞ্চ নতুন কমিট এলে অনুমোদন বাতিল করে না (বা এখান থেকে তার প্রোটেকশন পড়া যাচ্ছে না)। তা না হলে অনুমোদনটি যে কমিট রিভিউ করা হয়েছিল তার চেয়ে বেশি সময় টিকে থাকতে পারে। GitHub-এ অনুমোদন করুন।\",\"approve_is_unavailable_while_auto_merge_is_armed\":\"অটো-মার্জ চালু থাকলে অনুমোদন করা যাবে না: অনুমোদনটি head যাচাই ফিরিয়ে নেওয়ার আগেই এই পুল রিকোয়েস্ট মার্জ করে দিতে পারে। অটো-মার্জ বন্ধ করুন, বা GitHub-এ অনুমোদন করুন।\",\"ask_agent_about_this_failure\":\"এই ত্রুটি সম্পর্কে এজেন্টকে জিজ্ঞাসা করো\",\"cancel\":\"বাতিল করুন\",\"confirm_approve\":\"এই পুল রিকোয়েস্ট অনুমোদন করবেন?\",\"confirm_request_changes\":\"পরিবর্তনের অনুরোধ জানিয়ে এই রিভিউ প্রকাশ করবেন?\",\"confirm_submit_as_comment\":\"এই রিভিউ মন্তব্য হিসেবে জমা দেবেন?\",\"couldn_t_check_for_a_draft_review_on_this_pull_r\":\"এই পুল রিকোয়েস্টে খসড়া রিভিউ আছে কিনা তা যাচাই করা যায়নি। এটি সাধারণত GitHub CLI-এর প্রমাণীকরণ সমস্যা, খসড়া হারিয়ে যাওয়া নয়।\",\"draft_review\":\"খসড়া রিভিউ\",\"no_draft_review_on_this_pull_request\":\"এই পুল রিকোয়েস্টে কোনো খসড়া রিভিউ নেই।\",\"pending_only_you_can_see_it_until_you_publish\":\"মুলতুবি — প্রকাশ করা পর্যন্ত শুধু আপনিই দেখতে পাবেন।\",\"publish_failed\":\"রিভিউ প্রকাশ করা যায়নি\",\"published_as\":\"প্রকাশিত হয়েছে\",\"published_verdict_approved\":\"অনুমোদিত\",\"published_verdict_changes_requested\":\"পরিবর্তনের অনুরোধ করা হয়েছে\",\"published_verdict_comment\":\"একটি মন্তব্য\",\"publishing\":\"প্রকাশ করা হচ্ছে…\",\"publishing_is_blocked_a_later_review_replaced_th\":\"প্রকাশ করা বন্ধ রয়েছে: পরবর্তী একটি রিভিউ পুল রিকোয়েস্টে এই ড্রাফটটি প্রতিস্থাপন করেছে, তাই এতে আর এই রিভিউয়ের ফলাফল নেই। প্রকাশ করতে সবচেয়ে নতুন রিভিউ খুলুন।\",\"publishing_is_blocked_this_draft_contains_conten\":\"প্রকাশ আটকে দেওয়া হয়েছে: এই খসড়ায় এমন কিছু আছে যা আড়াল করা দরকার, আর জমা দিলে মূল লেখাটিই প্রকাশ পাবে। GitHub-এ খসড়াটি সম্পাদনা করুন বা বাতিল করুন।\",\"publishing_is_blocked_this_draft_was_written_aga\":\"প্রকাশ আটকে দেওয়া হয়েছে: এই খসড়া আগের একটি কমিটের জন্য লেখা এবং তারপর পুল রিকোয়েস্ট বদলে গেছে। আগে বর্তমান head আবার রিভিউ করুন।\",\"publishing_is_blocked_this_review_is_still_runni\":\"প্রকাশ অবরুদ্ধ: এই পর্যালোচনাটি এখনও চলছে, তাই এই পুল রিকোয়েস্টের খসড়াটি পূর্ববর্তী রানের।\",\"publishing_is_irreversible_and_visible_to_everyo\":\"প্রকাশ করা অপরিবর্তনীয় এবং পুল রিকোয়েস্টের সবাই দেখতে পাবে।\",\"request_changes\":\"পরিবর্তনের অনুরোধ করুন\",\"submit_as_comment\":\"মন্তব্য হিসেবে জমা দিন\",\"this_draft_has_no_summary_body\":\"এই খসড়ায় কোনো সারসংক্ষেপ নেই।\",\"try_again\":\"আবার চেষ্টা করুন\"},\"failureNotice\":{\"run_it_again\":\"আবার চালাও\",\"starting\":\"শুরু হচ্ছে…\",\"this_review_failed\":\"এই রিভিউ ব্যর্থ হয়েছে\"},\"findingCard\":{\"cancel_dismiss\":\"বাতিল\",\"confirm_dismiss\":\"ফাইন্ডিং খারিজ করো\",\"consequence\":\"পরিণতি\",\"dismiss\":\"খারিজ করো\",\"dismiss_failed\":\"খারিজ সংরক্ষণ করা যায়নি। আবার চেষ্টা করো।\",\"dismiss_reason_label\":\"এই ফাইন্ডিংটি কেন খারিজ করছো?\",\"dismiss_reason_placeholder\":\"যেমন: ভুল সতর্কতা, পরিধির বাইরে\",\"dismissed_reason\":\"খারিজ করা হয়েছে: {{reason}}\",\"evidence\":\"প্রমাণ\",\"observation\":\"পর্যবেক্ষণ\",\"post_finding\":\"এই পর্যবেক্ষণ pull request-এ দাও\",\"post_finding_on\":\"এই পর্যবেক্ষণ {{target}}-এ দাও\",\"post_this_comment\":\"এই মন্তব্য দাও\",\"posted_to_the_pull_request\":\"pull request-এ দেওয়া হয়েছে\",\"posting\":\"দেওয়া হচ্ছে…\",\"select_to_draft_together\":\"একসাথে ড্রাফ্টের জন্য নির্বাচন করুন\",\"select_to_post\":\"দিতে {{label}} বেছে নাও\",\"severity_must_fix\":\"আবশ্যক\",\"severity_should_fix\":\"প্রস্তাবিত\",\"suggestion\":\"প্রস্তাব\",\"this_finding\":\"এই পর্যবেক্ষণ\",\"undo_dismiss\":\"ফিরিয়ে আনুন\",\"undo_dismiss_failed\":\"ফিরিয়ে আনা যায়নি। ফাইন্ডিংটি এখনও খারিজ আছে।\"},\"learningRail\":{\"add_namespace\":\"namespace যোগ করো\",\"confirm_delete\":\"“{{name}}” আর তার শেখা সবকিছু মুছে ফেলব? এটা আর ফেরানো যাবে না।\",\"delete_2\":\"মুছে ফেলো\",\"delete_namespace\":\"namespace {{name}} মুছে ফেলো\",\"invalid_namespace_name\":\"namespace-এর নামই তার ফোল্ডারের নাম হয়, তাই এতে শুধু ছোট হাতের ল্যাটিন অক্ষর (a–z), অঙ্ক (0–9), বিন্দু, হাইফেন আর আন্ডারস্কোর থাকতে পারে। নাম কোনো অক্ষর বা অঙ্ক দিয়ে শুরু ও শেষ হতে হবে এবং 2 থেকে 64টি অক্ষরের হতে হবে।\",\"invalid_namespace_name_char\":\"“{{char}}” namespace-এর নামে ব্যবহার করা যায় না। ছোট হাতের a–z, 0–9, .\xA0-⁠\xA0_ ব্যবহার করো।\",\"invalid_namespace_name_letter\":\"“{{char}}” ({{script}}, {{code}}) namespace-এর নামে ব্যবহার করা যায় না। ছোট হাতের a–z, 0–9, .\xA0-⁠\xA0_ ব্যবহার করো।\",\"keep_it\":\"রেখে দাও\",\"load_namespace_during_reviews\":\"রিভিউয়ের সময় namespace {{name}} লোড করো\",\"loading\":\"লোড হচ্ছে…\",\"namespace_active\":\"চালু — রিভিউয়ের সময় লোড হয় (বন্ধ করতে টিক তুলে দাও)\",\"namespace_inactive\":\"বন্ধ — রিভিউয়ের সময় লোড করতে টিক দাও\",\"namespaces\":\"Namespace\",\"new_namespace\":\"নতুন namespace\",\"new_namespace_2\":\"new-namespace\",\"new_namespace_name\":\"নতুন namespace-এর নাম\",\"pattern_one\":\"{{count}} প্যাটার্ন\",\"pattern_other\":\"{{count}} প্যাটার্ন\",\"pending_count_one\":\"{{count}}টি বাকি\",\"pending_count_other\":\"{{count}}টি বাকি\",\"read_namespace\":\"namespace {{name}} পড়ো\"},\"leftRail\":{\"code_review_sage\":\"Code Review Sage\",\"learning\":\"শেখা\",\"reviews\":\"রিভিউ\",\"sections\":\"বিভাগ\",\"settings\":\"সেটিংস\",\"version\":\"v{{version}}\"},\"listSkeleton\":{\"loading_reviews\":\"রিভিউ লোড হচ্ছে…\"},\"middleColumn\":{\"all_repos\":\"সব রেপো\",\"just_this_repo\":\"শুধু {{repo}}\",\"lists_label\":\"Pull request বা রিভিউ\",\"no_reviews_for_repo\":\"{{repo}}-এর কোনো রিভিউ নেই\",\"no_reviews_yet\":\"এখনও কোনো রিভিউ নেই\",\"pick_a_repo_then_a_pr\":\"আগে রেপো বেছে নাও, তারপর pull request।\",\"pull_requests\":\"Pull request\",\"repo_lists_label\":\"{{repo}}: pull request বা রিভিউ\",\"repo_reviews_appear_here\":\"এই রেপোর জন্য তুমি যে রিভিউ শুরু করো সেগুলো এখানে দেখা যায়।\",\"reviews\":\"রিভিউ\",\"show_all_count\":\"সব দেখাও ({{count}})\",\"this_repo_only\":\"শুধু {{repo}}\"},\"postCommentsButton\":{\"cancel\":\"বাতিল করো\",\"confirm_post_one\":\"{{count}} মন্তব্য pull request-এ দেব?\",\"confirm_post_other\":\"{{count}} মন্তব্য pull request-এ দেব?\",\"drafted_publish_on_pr_page_one\":\"{{count}}টি মন্তব্যের খসড়া হয়েছে — প্রকাশ করতে পুল রিকোয়েস্ট এখানেই খুলুন\",\"drafted_publish_on_pr_page_other\":\"{{count}}টি মন্তব্যের খসড়া হয়েছে — প্রকাশ করতে পুল রিকোয়েস্ট এখানেই খুলুন\",\"post_action\":\"দাও\",\"post_count_one\":\"{{count}} মন্তব্য দাও\",\"post_count_other\":\"{{count}} মন্তব্য দাও\",\"post_failed\":\"দেওয়া যায়নি\",\"posted_age\":\"{{age}} দেওয়া হয়েছে\",\"posted_comments_one\":\"{{count}} মন্তব্য দেওয়া হয়েছে\",\"posted_comments_other\":\"{{count}} মন্তব্য দেওয়া হয়েছে\",\"posting\":\"দেওয়া হচ্ছে…\",\"publish_these_findings_as_a_review_on_the_pull_r\":\"এই পর্যবেক্ষণগুলো একটা রিভিউ হিসেবে pull request-এ দাও\"},\"prPickList\":{\"a_review_of_this_pull_request_is_running\":\"এই pull request-এর একটা রিভিউ চলছে\",\"add_a_repo\":\"একটা রেপো যোগ করো\",\"already_reviewed\":\"আগেই রিভিউ হয়েছে\",\"cancel\":\"বাতিল করো\",\"confirm_review_all\":\"সব {{count}}টি পুল রিকোয়েস্ট পর্যালোচনা করবে?\",\"draft\":\"খসড়া\",\"filter_pull_requests\":\"pull request ছাঁকো\",\"new\":\"নতুন\",\"no_open_prs_here\":\"এখানে খোলা কোনো pull request নেই।\",\"no_prs_match_filter\":\"তোমার ফিল্টারের সঙ্গে কোনো pull request মেলে না।\",\"one_or_more_github_pr_links\":\"এক বা একাধিক GitHub PR লিংক\",\"open_pr\":\"pull request #{{number}} খোলো: {{title}}\",\"paste_pr_links\":\"PR লিংক পেস্ট করো\",\"paste_pr_links_instead\":\"বরং PR লিংক পেস্ট করো\",\"pick_a_repo_to_see_its_pull_requests\":\"কোনো রেপোর pull request দেখতে সেটা বেছে নাও।\",\"pr_already_being_reviewed\":\"pull request #{{number}}-এর রিভিউ আগেই চলছে\",\"re_read_open_prs_from_github\":\"GitHub থেকে খোলা PR আবার পড়ো\",\"refresh_pull_requests\":\"pull request নতুন করে আনো\",\"repos_live_in_the_sidebar\":\"রেপো সাইডবারে থাকে।\",\"review_all_count\":\"সব {{count}}টি পর্যালোচনা করো\",\"review_every_open_pr_not_yet_reviewed_at_its_cur\":\"প্রতিটা খোলা PR রিভিউ করো, যেটার বর্তমান head-এ রিভিউ হয়নি\",\"review_pr\":\"pull request #{{number}} রিভিউ করো: {{title}}\",\"review_selected_count_one\":\"{{count}}টি নির্বাচিত রিভিউ করুন\",\"review_selected_count_other\":\"{{count}}টি নির্বাচিত রিভিউ করুন\",\"review_these\":\"এগুলো রিভিউ করো\",\"reviewed\":\"রিভিউ হয়েছে\",\"reviewed_age\":\"{{age}} রিভিউ হয়েছে\",\"reviewed_before_the_head_commit_has_moved_since\":\"আগে রিভিউ হয়েছে — তারপর head কমিট বদলে গেছে\",\"reviewing\":\"রিভিউ চলছে\",\"updated\":\"হালনাগাদ\"},\"prReviewDetail\":{\"author\":\"লেখক\",\"cancelled_before_finishing\":\"এটা শেষ হওয়ার আগেই ওটা বাতিল হয়ে গেছিল।\",\"did_not_complete_for_this_change\":\"এই পরিবর্তনের রিভিউ শেষ হয়নি।\",\"draft\":\"খসড়া\",\"findings_appear_here_as_soon_as_the_review_finis\":\"রিভিউ শেষ হলেই পর্যবেক্ষণগুলো এখানে দেখা যাবে। তুমি পাতা ছেড়ে যেতে পারো — এসে গেলে একটা নোটিফিকেশন জানিয়ে দেবে।\",\"head\":\"head\",\"loading_pull_request_details\":\"pull request-এর বিবরণ লোড হচ্ছে…\",\"loading_review\":\"রিভিউ লোড হচ্ছে…\",\"nothing_flagged_on_this_pull_request\":\"এই pull request-এ কিছুই চিহ্নিত হয়নি।\",\"open_on_github\":\"GitHub-এ খোলো\",\"pull_request\":\"পুল রিকোয়েস্ট\",\"pull_request_detail\":\"pull request-এর বিবরণ\",\"retry_review\":\"রিভিউ আবার চেষ্টা করো\",\"review\":\"রিভিউ করো\",\"review_again\":\"আবার রিভিউ করো\",\"review_again_at_current_head\":\"এই pull request তার বর্তমান head-এ আবার রিভিউ করো\",\"review_already_running\":\"এই pull request-এর রিভিউ আগেই চলছে\",\"review_completed_with_no_findings\":\"রিভিউ শেষ হয়েছে আর তোমার সময় নেওয়ার মতো কিছু পাওয়া যায়নি।\",\"review_this_pull_request\":\"এই pull request রিভিউ করো\",\"reviewing\":\"রিভিউ চলছে…\",\"running\":\"চলছে\",\"sage_review\":\"Sage রিভিউ\",\"see_the_reason_above\":\"কারণ উপরে দেখো।\",\"start_a_review_and_its_findings_appear_here_you\":\"একটা রিভিউ শুরু করো, তার পর্যবেক্ষণ এখানে দেখা যাবে — তুমি পাতা ছেড়ে যেতে পারো, এসে গেলে নোটিফিকেশন জানিয়ে দেবে।\",\"that_review_produced_no_report_for_this_pull_req\":\"ওই রিভিউ এই pull request-এর জন্য কোনো রিপোর্ট বানায়নি।\",\"this_pull_request_has_not_been_reviewed_yet\":\"এই pull request-এর এখনও রিভিউ হয়নি।\",\"updated\":\"হালনাগাদ\"},\"prSourcePanel\":{\"load_failed\":\"pull request-এর বিবরণ লোড করা যায়নি: {{reason}}\",\"partial_sections\":\"কিছু অংশ অসম্পূর্ণ ({{sections}}) — প্রদানকারীর কাছে অনুরোধ ব্যর্থ হয়েছে বা পাতার সীমায় পৌঁছেছে।\"},\"prStatusChips\":{\"all_checks_passed_one\":\"{{count}} পরীক্ষা পাশ\",\"all_checks_passed_other\":\"সব {{count}} পরীক্ষা পাশ\",\"checks_failing_one\":\"{{count}}-এর মধ্যে {{failed}} পরীক্ষা ব্যর্থ\",\"checks_failing_other\":\"{{count}}-এর মধ্যে {{failed}} পরীক্ষা ব্যর্থ\",\"checks_running_one\":\"{{count}}-এর মধ্যে {{pending}} পরীক্ষা এখনও চলছে\",\"checks_running_other\":\"{{count}}-এর মধ্যে {{pending}} পরীক্ষা এখনও চলছে\",\"closed\":\"বন্ধ\",\"conflicts\":\"সংঘাত\",\"failing_count_one\":\"{{count}}টি ব্যর্থ\",\"failing_count_other\":\"{{count}}টি ব্যর্থ\",\"merge_blocked\":\"merge আটকে আছে\",\"merged\":\"merge হয়েছে\",\"open\":\"খোলা\",\"passed_count_one\":\"{{count}}টি পাশ\",\"passed_count_other\":\"{{count}}টি পাশ\",\"running_count_one\":\"{{count}}টি চলছে\",\"running_count_other\":\"{{count}}টি চলছে\"},\"repoSwitcher\":{\"add_a_repo\":\"একটা রেপো যোগ করো\",\"all_repos\":\"সব রেপো\",\"filter_repos\":\"রেপো ছাঁকো\",\"filter_repositories\":\"রিপোজিটরি ছাঁকো\",\"loading\":\"লোড হচ্ছে…\",\"no_repo_matches_that\":\"ওর সঙ্গে কোনো রেপো মেলে না।\",\"no_repos_yet_add_one_to_pick_from_the_repos_you\":\"এখনও কোনো রেপো নেই — একটা যোগ করো, তারপর যেসব রেপোতে কাজ করো সেখান থেকে বেছে নিতে পারবে।\",\"pick_a_repo\":\"একটা রেপো বেছে নাও\",\"pick_a_repository\":\"একটা রিপোজিটরি বেছে নাও\",\"recent\":\"সাম্প্রতিক\",\"repositories\":\"রিপোজিটরি\",\"repository_named\":\"রিপোজিটরি: {{name}}\"},\"reportView\":{\"blast_radius\":\"প্রভাবের পরিসর: {{scope}}\",\"blocking_count_one\":\"{{count}}টি আটকে দেয়\",\"blocking_count_other\":\"{{count}}টি আটকে দেয়\",\"changes_reviewed_one\":\"{{count}} পরিবর্তন রিভিউ হয়েছে\",\"changes_reviewed_other\":\"{{count}} পরিবর্তন রিভিউ হয়েছে\",\"clear\":\"মুছে দাও\",\"design_gate\":\"ডিজাইন গেট ·\",\"design_risk\":\"ডিজাইন ঝুঁকি: {{level}}\",\"draft_selected_one\":\"{{count}}টি নির্বাচিত পর্যবেক্ষণের খসড়া করুন\",\"draft_selected_other\":\"{{count}}টি নির্বাচিত পর্যবেক্ষণের খসড়া করুন\",\"finding_dimension_in_file\":\"{{file}}-এ {{dimension}}\",\"generated\":\"· তৈরি\",\"moved_to\":\"এখন {{band}}-এ আছে। ফিল্টার বদলানো পর্যন্ত একই জায়গায় থাকবে।\",\"no_changes_in_this_band\":\"এই শ্রেণিতে কোনো পরিবর্তন নেই।\",\"nothing_flagged_in_this_review\":\"এই রিভিউয়ে কিছুই চিহ্নিত হয়নি।\",\"open_shared_copy\":\"ভাগ করা কপি খোলো\",\"open_the_pull_request\":\"pull request খোলো\",\"share\":\"ভাগ করো\",\"sharing\":\"ভাগ করা হচ্ছে…\",\"should_fix_count_one\":\"{{count}}টি ঠিক করা উচিত\",\"should_fix_count_other\":\"{{count}}টি ঠিক করা উচিত\",\"step_problem\":\"সমস্যা\",\"step_solution_fit\":\"সমাধান কতটা খাপ খায়\",\"step_why_it_matters\":\"এটা কেন জরুরি\"},\"reviewChat\":{\"continue_hint\":\"এই পর্যালোচকের সঙ্গে কথোপকথন চ্যাট ট্যাবে চলতে থাকে।\",\"continue_session\":\"ফলো-অাপ সেশন চালিয়ে যান\",\"earlier_questions\":\"পূর্ববর্তী প্রশ্ন\",\"error_generic\":\"ফলো-অাপ সেশন খোলা যায়নি। আবার নেষ্টা করুন।\",\"error_run_deleted\":\"এই রিভিউ মুছে ফেলা হয়েছে, তাই আলাপ শেষ হয়েছে।\",\"loading\":\"লোড হচ্ছে…\",\"new_session_unavailable\":\"এই অ্যাপ থেকে এখনও নতুন ফলো-আপ সেশন খোলা যায় না: এর জন্য এমন একটি Kiro Crew দরকার যেটি কোনো অ্যাপকে নির্দিষ্ট নামের চ্যাট সেশন খুলতে দেয়। আগে খোলা ফলো-আপ সেশন এখনও চালিয়ে যাওয়া যায়।\",\"not_recorded_notice\":\"এই পর্যালোচনা কোনো পর্যালোচক সেশন রাখেনি, তাই পুনরায় খোলার কিছু নেই। প্রশ্ন করতে এই পুল রিকোয়েস্ট আবার পর্যালোচনা করুন।\",\"open_session\":\"ফলো-অাপ সেশন খুলুন\",\"opening\":\"খোলা হচ্ছে…\",\"ran_tools\":\"দেখা হয়েছে: {{tools}}\",\"reasoning\":\"যুক্তি\",\"refused_notice\":\"সম্পূর্ণ উত্তর দিতে তার একটি টুল চালানো দরকার ছিল, যার অনুমতি মেলেনি, তাই এই উত্তরটি সীমিত। অনুমতি দিতে YOLO চালু করুন।\",\"resume_hint\":\"একটি চ্যাট খোলে যা পর্যালোচককে পুনরায় চালু করে, তাই তার পর্যবেক্ষণের পেছনের যুক্তি অক্ষত থাকে।\",\"role_reviewer\":\"রিভিউয়ার\",\"role_you\":\"আপনি\",\"run_live_notice\":\"এই পর্যালোচনা এখনও চলছে। শেষ হওয়ার আগে পর্যবেক্ষণ বদলাতে পারে, তাই এখনই জিজ্ঞাসা করার কিছু নেই।\",\"title\":\"রিভিউয়ারকে জিজ্ঞাসা করুন\",\"transcript_gone_notice\":\"পর্যালোচকের সেশন আর ডিস্কে নেই, তাই পুনরায় খোলার কিছু নেই। প্রশ্ন করতে এই পুল রিকোয়েস্ট আবার পর্যালোচনা করুন।\"},\"reviewQueue\":{\"empty\":\"তোমার রিভিউয়ের অপেক্ষায় কোনো পুল রিকোয়েস্ট নেই।\",\"filter_by_repo\":\"রিপো বা শিরোনাম দিয়ে ফিল্টার করো\",\"setup_required\":\"রিভিউ অনুরোধ দেখতে GitHub CLI সেট আপ করো\",\"starts_review\":\"প্রতিটি বাছাইয়ে একটি Sage রিভিউ চলে। ফলাফল রিভিউ-এ দেখা যায়, তুমি না চাইলে GitHub-এ পোস্ট হয় না।\",\"starts_review_truncated\":\"শুধু নতুনতম 100টি অনুরোধ দেখানো হচ্ছে। প্রতিটি বাছাইয়ে একটি Sage রিভিউ চলে। ফলাফল রিভিউ-এ দেখা যায়, তুমি না চাইলে GitHub-এ পোস্ট হয় না।\",\"tab\":\"অনুরোধ\"},\"runCard\":{\"cancel\":\"বাতিল করো\",\"clean\":\"পরিষ্কার\",\"delete\":\"মুছে ফেলো\",\"delete_review_of\":\"{{label}}-এর রিভিউ মুছে ফেলো\",\"delete_this_review\":\"এই রিভিউ মুছে ফেলো\",\"delete_this_review_2\":\"এই রিভিউ মুছে ফেলব?\",\"more_count_one\":\"আরও +{{count}}\",\"more_count_other\":\"আরও +{{count}}\",\"needs_review_count_one\":\"{{count}}-এর রিভিউ দরকার\",\"needs_review_count_other\":\"{{count}}-এর রিভিউ দরকার\",\"pull_requests\":\"pull request\",\"review\":\"রিভিউ\",\"review_of\":\"{{label}}-এর রিভিউ\",\"review_of_with_more_one\":\"{{label}} আর আরও {{count}}-এর রিভিউ\",\"review_of_with_more_other\":\"{{label}} আর আরও {{count}}-এর রিভিউ\",\"worth_a_glance_count_one\":\"{{count}}-এ চোখ রাখা ভালো\",\"worth_a_glance_count_other\":\"{{count}}-এ চোখ রাখা ভালো\"},\"runDetail\":{\"cancelled_before_any_finished\":\"কোনো pull request শেষ হওয়ার আগেই ওটা বাতিল হয়ে গেছিল।\",\"finished\":\"শেষ\",\"loading_report\":\"রিপোর্ট লোড হচ্ছে…\",\"more_count_one\":\"আরও +{{count}}\",\"more_count_other\":\"আরও +{{count}}\",\"nothing_to_report\":\"কোনো pull request-এর রিভিউ শেষ হয়নি, তাই জানানোর কিছু ছিল না।\",\"pull_request_one\":\"{{count}} pull request\",\"pull_request_other\":\"{{count}} pull request\",\"report_appears_when_the_review_finishes\":\"রিভিউ শেষ হলেই রিপোর্ট এখানে দেখা যাবে।\",\"skipped_inflight_one\":\"{{count}} pull request বাদ পড়েছে, কারণ আরেকটা রিভিউ আগেই সেটা নিয়ে নিয়েছিল।\",\"skipped_inflight_other\":\"{{count}} pull request বাদ পড়েছে, কারণ আরেকটা রিভিউ আগেই সেগুলো নিয়ে নিয়েছিল।\",\"started\":\"শুরু\",\"this_review_produced_no_report\":\"এই রিভিউ কোনো রিপোর্ট বানায়নি।\",\"you_can_leave_this_page_a_notification_will_tell\":\"তুমি এই পাতা ছেড়ে যেতে পারো — এসে গেলে একটা নোটিফিকেশন জানিয়ে দেবে।\"},\"runList\":{\"new_review\":\"নতুন রিভিউ\"},\"runProgress\":{\"cancel_review\":\"রিভিউ বাতিল করো\",\"cancelled_count_one\":\"{{count}}টি বাতিল\",\"cancelled_count_other\":\"{{count}}টি বাতিল\",\"cancelling\":\"বাতিল করা হচ্ছে…\",\"elapsed_time\":\"কেটে যাওয়া সময়\",\"failed_count_one\":\"{{count}}টি ব্যর্থ\",\"failed_count_other\":\"{{count}}টি ব্যর্থ\",\"median_of_past_runs_of_this_size\":\"এই মাপের আগের চালানোগুলোর মধ্যক\",\"review_progress\":\"রিভিউয়ের অগ্রগতি\",\"reviewed_of_one\":\"{{done}} / {{count}} রিভিউ হয়েছে\",\"reviewed_of_other\":\"{{done}} / {{count}} রিভিউ হয়েছে\",\"reviewers_busy\":\"{{max}}-এর মধ্যে {{busy}} জন রিভিউয়ার ব্যস্ত\",\"step\":\"· ধাপ\",\"stops_queued_prs_one_already_being_reviewed_will\":\"সারিতে থাকা PR থেমে যাবে; যেটার রিভিউ চলছে সেটা শেষ হবে।\",\"usually\":\"সাধারণত ~\",\"working\":\"কাজ চলছে\"},\"runStatusPill\":{\"cancelled\":\"বাতিল\",\"cancelling\":\"বাতিল হচ্ছে\",\"done\":\"সম্পন্ন\",\"error\":\"ত্রুটি\",\"interrupted\":\"ব্যাহত\",\"running\":\"চলছে\"},\"shipSummaryCard\":{\"post_the_ship_readiness_summary\":\"রিলিজের প্রস্তুতির সারসংক্ষেপ দাও\",\"post_this_comment\":\"এই মন্তব্য দাও\",\"posted_as_a_top_level_comment\":\"উপরের স্তরের মন্তব্য হিসেবে দেওয়া হয়েছে\",\"posted_to_the_pull_request\":\"pull request-এ দেওয়া হয়েছে\",\"posting\":\"দেওয়া হচ্ছে…\",\"select_the_ship_readiness_summary_to_post\":\"দিতে রিলিজের প্রস্তুতির সারসংক্ষেপ বেছে নাও\",\"ship_readiness_summary\":\"রিলিজের প্রস্তুতির সারসংক্ষেপ\"}},\"lib\":{\"format\":{\"cause_no_agent_cli\":\"রিভিউয়ার কখনও চালুই হয়নি — এই হোস্টে kiro-cli এক্সিকিউটেবল পাওয়া যায়নি। এটি ইনস্টল করো, বা PATH-এ যোগ করো।\",\"cause_no_record\":\"রিভিউয়ার কাজ শেষ করেছে কিন্তু কোনো পর্যবেক্ষণ লিখে রাখেনি।\",\"cause_record_incomplete\":\"রিভিউয়ার পর্যবেক্ষণের রেকর্ড লিখেছে, কিন্তু রিভিউ শেষ করার আগেই থেমে গেছে।\",\"cause_runtime_died\":\"রিভিউয়ারের প্রসেস রিভিউয়ের মাঝপথে থেমে গেছে — সাধারণত gateway আবার চালু হওয়ার কারণে। pull request-এ কোনো গোলমাল ছিল না।\",\"cause_runtime_not_importable\":\"রিভিউয়ার কখনও চালুই হয়নি — এই ইনস্টল তার প্রয়োজনীয় এজেন্ট রানটাইম লোড করতে পারছে না। ইনস্টল মেরামত করলে এটি ফিরে আসবে।\",\"cause_runtime_unavailable\":\"রিভিউয়ার কখনও চালুই হয়নি — তার এজেন্ট রানটাইম এই হোস্টে পাওয়া যাচ্ছে না।\",\"cause_timeout\":\"রিভিউ তার সময়সীমা ছাড়িয়ে গেছে।\",\"cause_turn_failed\":\"কিছু লিখে রাখার আগেই রিভিউয়ের পালা ব্যর্থ হয়েছে।\",\"cause_unknown\":\"রিভিউ শেষ হয়নি।\",\"days_ago_one\":\"{{count}} দিন আগে\",\"days_ago_other\":\"{{count}} দিন আগে\",\"hours_ago_one\":\"{{count}} ঘণ্টা আগে\",\"hours_ago_other\":\"{{count}} ঘণ্টা আগে\",\"just_now\":\"এই মাত্র\",\"minutes_ago_one\":\"{{count}} মিনিট আগে\",\"minutes_ago_other\":\"{{count}} মিনিট আগে\",\"phase_cancelled\":\"বাতিল\",\"phase_done\":\"শেষ\",\"phase_failed\":\"ব্যর্থ\",\"phase_pending\":\"বাকি\",\"phase_queued\":\"সারিতে\",\"phase_reviewing\":\"রিভিউ চলছে\"}},\"manifest\":{\"configuration_1\":\"গেটওয়ে হোস্টে gh CLI ইনস্টল ও প্রমাণীকরণ করে একটি রিপোজিটরি যোগ করুন, তারপর Settings-এ review model, reasoning effort ও concurrency বেছে নিন।\",\"description\":\"GitHub পুল রিকোয়েস্ট গভীরভাবে রিভিউ করে আর জানায় কোন বদলগুলো সত্যিই তোমার নজর পাওয়ার যোগ্য। প্রতিটি পুল রিকোয়েস্ট আলাদা, বিচ্ছিন্ন এজেন্ট সেশনে রিভিউ হয় এবং বদলে যাওয়া প্রতিটি ফাইল তাতে দেখা হয় — কতটা ঝুঁকি ছড়াতে পারে সেই অনুযায়ী গুরুত্ব পায় — আর সব মিলিয়ে একটি অগ্রাধিকার-সাজানো Focus Report তৈরি হয়। ফলাফল অ্যাপেই পড়া হয়, আর তুমি প্রকাশ করলে বা স্বয়ংক্রিয় পোস্টিং চালু করলে তবেই একটি খসড়া GitHub রিভিউ হিসেবে জমা হয়; আর রিভিউয়ার শিপ হওয়া ফিক্স ও আগের রিভিউ কমেন্ট থেকে তোমার রিপোজিটরির আসল মানদণ্ড শিখতে থাকে।\",\"display_name\":\"Code Review Sage\",\"highlight_1\":\"Focus Report ঝুঁকির বিস্তার অনুযায়ী বদলগুলোকে সাজায়, যাতে ঝুঁকিপূর্ণ ফাইল আগে পড়া হয়\",\"highlight_2\":\"প্রতি পুল রিকোয়েস্টের জন্য একটি বিচ্ছিন্ন এজেন্ট সেশন, তাই ফলাফল কখনও এক রিভিউ থেকে অন্য রিভিউতে মিশে যায় না\",\"highlight_3\":\"পর্যালোচনাগুলি অ্যাপেই পড়া হয় — আপনি না বললে আপনার পুল রিকোয়েস্টে কিছুই পোস্ট করা হয় না\",\"highlight_4\":\"শিপ হওয়া ফিক্স, রিভিউ কমেন্ট ও ডিজাইন আলোচনা থেকে প্রতিটি রিপোজিটরির জন্য আলাদাভাবে শেখে\",\"highlight_5\":\"GitHub পুল রিকোয়েস্ট রিভিউ করে; গেটওয়ে হোস্টে একটি অথেনটিকেটেড `gh` CLI দরকার\",\"page_label\":\"Code Review Sage\",\"use_case_1\":\"ঝুঁকি অনুযায়ী এক বা একাধিক GitHub pull request পর্যালোচনা করুন, নির্দিষ্ট ফলাফল যাচাই করুন এবং প্রকাশের যোগ্য মন্তব্যগুলোই প্রস্তুত রাখুন।\"},\"views\":{\"learningView\":{\"cancel\":\"বাতিল করো\",\"confirm_merge_one\":\"{{count}} শেখা বিষয় নিয়মের সেটে মিশিয়ে দেব?\",\"confirm_merge_other\":\"{{count}} শেখা বিষয় নিয়মের সেটে মিশিয়ে দেব?\",\"consolidate\":\"এক করো\",\"consolidate_pending_one\":\"{{namespace}}-এ {{count}} বাকি শেখা বিষয় এক করো\",\"consolidate_pending_other\":\"{{namespace}}-এ {{count}} বাকি শেখা বিষয় এক করো\",\"consolidating\":\"এক করা হচ্ছে…\",\"learning\":\"শেখা\",\"loaded_during_reviews\":\"রিভিউয়ের সময় লোড হয়\",\"loading_learnings\":\"শেখা বিষয়গুলো লোড হচ্ছে…\",\"merge_failed_ruleset_unchanged\":\"মেশানো ব্যর্থ — নিয়মের সেট বদলায়নি\",\"not_loaded\":\"লোড হয় না\",\"nothing_consolidated_yet_reviews_in_this_namespa\":\"এখনও কিছু এক করা হয়নি — এই namespace-এর রিভিউ এখন কোনো শেখা প্যাটার্ন লোড করে না।\",\"nothing_staged_new_learnings_land_here_when_a_re\":\"কিছু তৈরি নেই। কোনো রিভিউ যখন রিলিজ হওয়া সংশোধন বা মেনে নেওয়া রিভিউ মন্তব্য বিশ্লেষণ করে, নতুন শেখা তখন এখানে আসে।\",\"pattern_one\":\"{{count}} প্যাটার্ন\",\"pattern_other\":\"{{count}} প্যাটার্ন\",\"pending_consolidation\":\"এক করা বাকি ·\",\"pick_a_namespace_in_the_sidebar_to_read_the_patt\":\"সাইডবারে একটা namespace বেছে নাও, তাতে রিভিউ ওখান থেকে যে প্যাটার্ন লোড করে সেগুলো পড়তে পারবে।\",\"reviews_read_the_consolidated_ruleset_below_neve\":\"রিভিউ নিচের এক করা নিয়মের সেট পড়ে, বাকি পড়ে থাকা প্রার্থীগুলো কখনও নয়। এক করলে যা তৈরি আছে তা ওতেই মিশে যায় — এটা একবারের AI মেশানো, যেটা তুমি চালাও, তাই তুমি না চালানো পর্যন্ত রিভিউ যা দেখে তার কিছুই বদলায় না।\",\"ruleset\":\"নিয়মের সেট ·\"},\"settingsView\":{\"default_agent_config\":\"ডিফল্ট (এজেন্ট কনফিগ)\",\"default_model_provider\":\"ডিফল্ট (মডেল / প্রদানকারী)\",\"higher_effort_finds_more_costs_more_and_takes_lo\":\"বেশি খাটলে বেশি ধরা পড়ে, খরচ বাড়ে, আর প্রতি pull request-এ সময়ও বেশি লাগে। ডিফল্টে মডেল বা প্রদানকারী ঠিক করে।\",\"how_many_pull_requests_are_reviewed_in_parallel\":\"ভাগ করা worker রানটাইমে একসঙ্গে কতগুলো pull request রিভিউ হয়। রিভিউয়ের গতির আসল সীমা এটাই — একসঙ্গে কয়েকটা রিভিউ চলতে পারে, কিন্তু সবাই এই বাজেট থেকেই নেয়।\",\"loading_settings\":\"সেটিংস লোড হচ্ছে…\",\"model\":\"মডেল\",\"reasoning_effort\":\"যুক্তির খাটনি\",\"review_model\":\"রিভিউয়ের মডেল\",\"reviews_at_once\":\"একসঙ্গে রিভিউ\",\"settings\":\"সেটিংস\",\"these_apply_to_every_review_started_from_here\":\"এখান থেকে শুরু হওয়া প্রতিটা রিভিউয়ে এটা খাটে।\",\"which_model_performs_the_review_default_inherits\":\"কোন মডেল রিভিউ করে। ডিফল্ট এজেন্ট কনফিগ থেকে আসে, তাই তোমার ডিফল্ট মডেল বদলালে এটাও বদলায়।\"}},\"workspace\":{\"drag_to_resize\":\"মাপ বদলাতে টানো\",\"resize_sidebar\":\"সাইডবারের মাপ বদলাও\",\"select_a_review_to_see_its_progress_and_report\":\"কোনো রিভিউয়ের অগ্রগতি আর রিপোর্ট দেখতে সেটা বেছে নাও।\",\"start_a_new_one_several_can_run_at_once\":\"নতুন একটা শুরু করো — কয়েকটা একসঙ্গে চলতে পারে।\"}},\"issueRadar\":{\"components\":{\"prDetail\":{\"labels\":\"লেবেল\"}}}}"),
		components: { "resizeHandle": { "drag_to_resize": "আকার বদলাতে টানুন" } },
		lib: { "scriptLabel": {
			"cyrillic": "সিরিলিক অক্ষর",
			"greek": "গ্রিক অক্ষর",
			"latin": "ল্যাটিন অক্ষর",
			"other": "অক্ষর"
		} }
	},
	de: {
		app: {
			"collapse_sidebar": "Seitenleiste einklappen",
			"expand_sidebar": "Seitenleiste ausklappen"
		},
		apps: /* @__PURE__ */ JSON.parse("{\"codeReviewSage\":{\"codeReviewSagePage\":{\"open_pr_one\":\"{{count}} offener PR\",\"open_pr_other\":\"{{count}} offene PRs\",\"pattern_one\":\"{{count}} Muster\",\"pattern_other\":\"{{count}} Muster\"},\"components\":{\"addReposModal\":{\"add\":\"Hinzufügen\",\"add_one_by_url_above\":\"Füge oben eines per URL hinzu.\",\"add_repo\":\"{{repo}} hinzufügen\",\"add_repos\":\"Repos hinzufügen\",\"added\":\"hinzugefügt\",\"all_your_repos\":\"Alle deine Repos\",\"already_added\":\"{{repo}} ist bereits hinzugefügt\",\"archived\":\"archiviert\",\"based_on_recent_github_activity\":\"Basierend auf deiner letzten GitHub-Aktivität\",\"close\":\"Schließen\",\"close_add_repos_dialog\":\"Dialog zum Hinzufügen von Repos schließen\",\"contributed_events_one\":\"{{age}} · {{count}} Aktivität\",\"contributed_events_other\":\"{{age}} · {{count}} Aktivitäten\",\"filter_your_repos\":\"Deine Repos filtern\",\"gh_auth_login\":\"gh auth login\",\"github_cli_not_ready\":\"GitHub CLI ist nicht bereit\",\"newest_100_by_push_date\":\"die 100 neuesten nach Push-Datum\",\"no_repos_for_account\":\"Für dein Konto wurden keine Repos gefunden.\",\"no_repos_match_filter\":\"Kein Repo passt zu deinem Filter.\",\"owner_repo_a_repo_url_or_paste_a_pull_request_li\":\"owner/repo, eine Repo-URL, oder füge einen Pull-Request-Link ein\",\"pick_from_the_repos_you_can_reach_or_type_one_in\":\"Wähle aus den Repos, die du erreichst, oder tippe eines ein. Hinzugefügte Repos erscheinen in der Seitenleiste, damit du von dort ein Review starten kannst. Füge einen Pull-Request-Link ein, und dieser Pull-Request wird direkt geöffnet.\",\"pinned_to_the_sidebar\":\"an die Seitenleiste angepinnt\",\"private\":\"Privat\",\"pushed_age\":\"gepusht {{age}}\",\"re_read_your_repos_from_github\":\"Deine Repos erneut von GitHub lesen\",\"read_only\":\"nur lesen\",\"read_only_access\":\"Nur-Lese-Zugriff\",\"reading_your_repos_from_github\":\"Deine Repos werden von GitHub gelesen…\",\"recently_worked_on\":\"Zuletzt bearbeitet\",\"refresh_your_repos\":\"Deine Repos aktualisieren\",\"remove\":\"Entfernen\",\"remove_repo\":\"{{repo}} entfernen\",\"repository_or_pull_request_url_or_owner_repo\":\"Repository- oder Pull-Request-URL, oder owner/repo\",\"setup_hint\":\"Installiere die GitHub CLI und melde dich mit dem Befehl unten an, um deine Repos zu listen. Du kannst oben weiterhin jedes Repo per URL hinzufügen.\",\"these_lists_are_capped_so_a_repo_you_have_not_to\":\"Diese Listen sind begrenzt, daher kann ein Repo fehlen, das du länger nicht angefasst hast. Füge es oben per URL hinzu, wenn du es nicht siehst.\",\"your_repos\":\"Deine Repos\"},\"bandChips\":{\"all\":\"Alle\",\"clean\":\"Unauffällig\",\"filter_by_band\":\"Nach Kategorie filtern\",\"needs_review\":\"Review nötig\",\"worth_a_glance\":\"Kurzer Blick\"},\"draftReviewActions\":{\"approve\":\"Genehmigen\",\"approve_is_unavailable_because_this_base_branch_\":\"Genehmigen ist nicht verfügbar, weil der Ziel-Branch dieses Pull Requests Genehmigungen bei neuen Commits nicht zurücknimmt (oder sein Schutz von hier nicht lesbar ist). Andernfalls könnte eine Genehmigung den geprüften Commit überdauern. Genehmigen Sie stattdessen auf GitHub.\",\"approve_is_unavailable_while_auto_merge_is_armed\":\"Genehmigen ist nicht verfügbar, solange Auto-Merge aktiv ist: Eine Genehmigung könnte diesen Pull Request zusammenführen, bevor eine Head-Prüfung sie zurücknehmen kann. Deaktivieren Sie Auto-Merge oder genehmigen Sie auf GitHub.\",\"ask_agent_about_this_failure\":\"Den Agenten zu diesem Fehler fragen\",\"cancel\":\"Abbrechen\",\"confirm_approve\":\"Diesen Pull Request genehmigen?\",\"confirm_request_changes\":\"Diese Überprüfung mit Änderungswunsch veröffentlichen?\",\"confirm_submit_as_comment\":\"Diese Überprüfung als Kommentar einreichen?\",\"couldn_t_check_for_a_draft_review_on_this_pull_r\":\"Der Entwurf einer Review konnte für diesen Pull Request nicht geprüft werden. Das ist meist ein Authentifizierungsproblem der GitHub CLI und bedeutet nicht, dass der Entwurf fehlt.\",\"draft_review\":\"Review-Entwurf\",\"no_draft_review_on_this_pull_request\":\"Kein Review-Entwurf für diesen Pull Request.\",\"pending_only_you_can_see_it_until_you_publish\":\"Ausstehend – nur Sie sehen ihn, bis Sie ihn veröffentlichen.\",\"publish_failed\":\"Überprüfung konnte nicht veröffentlicht werden\",\"published_as\":\"Veröffentlicht als\",\"published_verdict_approved\":\"genehmigt\",\"published_verdict_changes_requested\":\"Änderungen angefordert\",\"published_verdict_comment\":\"ein Kommentar\",\"publishing\":\"Wird veröffentlicht …\",\"publishing_is_blocked_a_later_review_replaced_th\":\"Veröffentlichen ist blockiert: Eine spätere Überprüfung hat diesen Entwurf im Pull Request ersetzt, sodass er die Ergebnisse dieser Überprüfung nicht mehr enthält. Öffnen Sie die neueste Überprüfung, um sie zu veröffentlichen.\",\"publishing_is_blocked_this_draft_contains_conten\":\"Veröffentlichen ist blockiert: Dieser Entwurf enthält Inhalte, die unkenntlich gemacht werden müssen, und beim Absenden würde der Originaltext veröffentlicht. Bearbeiten oder verwerfen Sie den Entwurf auf GitHub.\",\"publishing_is_blocked_this_draft_was_written_aga\":\"Veröffentlichen ist blockiert: Dieser Entwurf wurde für einen älteren Commit geschrieben und der Pull Request hat sich seitdem geändert. Prüfen Sie zuerst den aktuellen Head erneut.\",\"publishing_is_blocked_this_review_is_still_runni\":\"Veröffentlichen ist blockiert: Diese Überprüfung läuft noch, daher stammt der Entwurf an diesem Pull Request aus einem früheren Durchlauf.\",\"publishing_is_irreversible_and_visible_to_everyo\":\"Das Veröffentlichen ist unwiderruflich und für alle am Pull Request sichtbar.\",\"request_changes\":\"Änderungen anfordern\",\"submit_as_comment\":\"Als Kommentar absenden\",\"this_draft_has_no_summary_body\":\"Dieser Entwurf hat keinen Zusammenfassungstext.\",\"try_again\":\"Erneut versuchen\"},\"failureNotice\":{\"run_it_again\":\"Nochmal ausführen\",\"starting\":\"Startet…\",\"this_review_failed\":\"Dieses Review ist fehlgeschlagen\"},\"findingCard\":{\"cancel_dismiss\":\"Abbrechen\",\"confirm_dismiss\":\"Befund verwerfen\",\"consequence\":\"Folge\",\"dismiss\":\"Verwerfen\",\"dismiss_failed\":\"Das Verwerfen konnte nicht gespeichert werden. Versuch es erneut.\",\"dismiss_reason_label\":\"Warum wird dieser Befund verworfen?\",\"dismiss_reason_placeholder\":\"Zum Beispiel: Fehlalarm, nicht im Umfang\",\"dismissed_reason\":\"Verworfen: {{reason}}\",\"evidence\":\"Belege\",\"observation\":\"Beobachtung\",\"post_finding\":\"Diesen Befund am Pull-Request veröffentlichen\",\"post_finding_on\":\"Diesen Befund zu {{target}} veröffentlichen\",\"post_this_comment\":\"Diesen Kommentar veröffentlichen\",\"posted_to_the_pull_request\":\"Am Pull-Request veröffentlicht\",\"posting\":\"Wird veröffentlicht…\",\"select_to_draft_together\":\"Für Sammelentwurf auswählen\",\"select_to_post\":\"{{label}} zum Veröffentlichen auswählen\",\"severity_must_fix\":\"Pflicht\",\"severity_should_fix\":\"Empfohlen\",\"suggestion\":\"Vorschlag\",\"this_finding\":\"diesen Befund\",\"undo_dismiss\":\"Rückgängig\",\"undo_dismiss_failed\":\"Rückgängig machen fehlgeschlagen. Der Befund bleibt verworfen.\"},\"learningRail\":{\"add_namespace\":\"Namespace hinzufügen\",\"confirm_delete\":\"„{{name}}“ und alle zugehörigen Erkenntnisse löschen? Das lässt sich nicht rückgängig machen.\",\"delete_2\":\"Löschen\",\"delete_namespace\":\"Namespace {{name}} löschen\",\"invalid_namespace_name\":\"Namespace-Namen werden zu Ordnernamen und dürfen daher nur Kleinbuchstaben des lateinischen Alphabets (a–z), Ziffern (0–9), Punkte, Bindestriche und Unterstriche enthalten, müssen mit einem Buchstaben oder einer Ziffer beginnen und enden und 2 bis 64 Zeichen lang sein.\",\"invalid_namespace_name_char\":\"„{{char}}“ kann in einem Namespace-Namen nicht verwendet werden. Nutze Kleinbuchstaben a–z, 0–9, .\xA0-⁠\xA0_\",\"invalid_namespace_name_letter\":\"„{{char}}“ ({{script}}, {{code}}) kann in einem Namespace-Namen nicht verwendet werden. Nutze Kleinbuchstaben a–z, 0–9, .\xA0-⁠\xA0_\",\"keep_it\":\"Behalten\",\"load_namespace_during_reviews\":\"Namespace {{name}} bei Reviews laden\",\"loading\":\"Lädt…\",\"namespace_active\":\"Aktiv — wird bei Reviews geladen (abwählen, um zu deaktivieren)\",\"namespace_inactive\":\"Inaktiv — anwählen, um bei Reviews zu laden\",\"namespaces\":\"Namespaces\",\"new_namespace\":\"Neuer Namespace\",\"new_namespace_2\":\"new-namespace\",\"new_namespace_name\":\"Name des neuen Namespace\",\"pattern_one\":\"{{count}} Muster\",\"pattern_other\":\"{{count}} Muster\",\"pending_count_one\":\"{{count}} ausstehend\",\"pending_count_other\":\"{{count}} ausstehend\",\"read_namespace\":\"Namespace {{name}} lesen\"},\"leftRail\":{\"code_review_sage\":\"Code Review Sage\",\"learning\":\"Lernen\",\"reviews\":\"Reviews\",\"sections\":\"Bereiche\",\"settings\":\"Einstellungen\",\"version\":\"v{{version}}\"},\"listSkeleton\":{\"loading_reviews\":\"Reviews werden geladen…\"},\"middleColumn\":{\"all_repos\":\"Alle Repos\",\"just_this_repo\":\"Nur {{repo}}\",\"lists_label\":\"Pull-Requests oder Reviews\",\"no_reviews_for_repo\":\"Keine Reviews für {{repo}}\",\"no_reviews_yet\":\"Noch keine Reviews\",\"pick_a_repo_then_a_pr\":\"Wähle ein Repo und dann einen Pull-Request.\",\"pull_requests\":\"Pull-Requests\",\"repo_lists_label\":\"{{repo}}: Pull-Requests oder Reviews\",\"repo_reviews_appear_here\":\"Reviews, die du für dieses Repo startest, erscheinen hier.\",\"reviews\":\"Reviews\",\"show_all_count\":\"Alle anzeigen ({{count}})\",\"this_repo_only\":\"nur {{repo}}\"},\"postCommentsButton\":{\"cancel\":\"Abbrechen\",\"confirm_post_one\":\"{{count}} Kommentar am Pull-Request veröffentlichen?\",\"confirm_post_other\":\"{{count}} Kommentare am Pull-Request veröffentlichen?\",\"drafted_publish_on_pr_page_one\":\"{{count}} Kommentar entworfen — Pull Request hier öffnen, um zu veröffentlichen\",\"drafted_publish_on_pr_page_other\":\"{{count}} Kommentare entworfen — Pull Request hier öffnen, um zu veröffentlichen\",\"post_action\":\"Veröffentlichen\",\"post_count_one\":\"{{count}} Kommentar veröffentlichen\",\"post_count_other\":\"{{count}} Kommentare veröffentlichen\",\"post_failed\":\"Veröffentlichen fehlgeschlagen\",\"posted_age\":\"Veröffentlicht {{age}}\",\"posted_comments_one\":\"{{count}} Kommentar veröffentlicht\",\"posted_comments_other\":\"{{count}} Kommentare veröffentlicht\",\"posting\":\"Wird veröffentlicht…\",\"publish_these_findings_as_a_review_on_the_pull_r\":\"Diese Befunde als Review am Pull-Request veröffentlichen\"},\"prPickList\":{\"a_review_of_this_pull_request_is_running\":\"Ein Review dieses Pull-Requests läuft\",\"add_a_repo\":\"Repo hinzufügen\",\"already_reviewed\":\"Bereits reviewt\",\"cancel\":\"Abbrechen\",\"confirm_review_all\":\"Alle {{count}} Pull Requests prüfen?\",\"draft\":\"Entwurf\",\"filter_pull_requests\":\"Pull-Requests filtern\",\"new\":\"neu\",\"no_open_prs_here\":\"Hier gibt es keine offenen Pull-Requests.\",\"no_prs_match_filter\":\"Kein Pull-Request passt zu deinem Filter.\",\"one_or_more_github_pr_links\":\"Ein oder mehrere GitHub-PR-Links\",\"open_pr\":\"Pull-Request #{{number}} öffnen: {{title}}\",\"paste_pr_links\":\"PR-Links einfügen\",\"paste_pr_links_instead\":\"Stattdessen PR-Links einfügen\",\"pick_a_repo_to_see_its_pull_requests\":\"Wähle ein Repo, um seine Pull-Requests zu sehen.\",\"pr_already_being_reviewed\":\"Pull-Request #{{number}} wird bereits reviewt\",\"re_read_open_prs_from_github\":\"Offene PRs erneut von GitHub lesen\",\"refresh_pull_requests\":\"Pull-Requests aktualisieren\",\"repos_live_in_the_sidebar\":\"Repos findest du in der Seitenleiste.\",\"review_all_count\":\"Alle {{count}} prüfen\",\"review_every_open_pr_not_yet_reviewed_at_its_cur\":\"Jeden offenen PR reviewen, der auf seinem aktuellen Head noch nicht reviewt wurde\",\"review_pr\":\"Pull-Request #{{number}} reviewen: {{title}}\",\"review_selected_count_one\":\"{{count}} ausgewählten prüfen\",\"review_selected_count_other\":\"{{count}} ausgewählte prüfen\",\"review_these\":\"Diese reviewen\",\"reviewed\":\"reviewt\",\"reviewed_age\":\"Reviewt {{age}}\",\"reviewed_before_the_head_commit_has_moved_since\":\"Schon einmal reviewt — der Head-Commit hat sich seitdem verschoben\",\"reviewing\":\"wird reviewt\",\"updated\":\"aktualisiert\"},\"prReviewDetail\":{\"author\":\"Autor\",\"cancelled_before_finishing\":\"Es wurde abgebrochen, bevor dieses fertig war.\",\"did_not_complete_for_this_change\":\"Das Review wurde für diese Änderung nicht abgeschlossen.\",\"draft\":\"Entwurf\",\"findings_appear_here_as_soon_as_the_review_finis\":\"Die Befunde erscheinen hier, sobald das Review fertig ist. Du kannst die Seite verlassen — eine Benachrichtigung sagt dir, wenn es eintrifft.\",\"head\":\"Head\",\"loading_pull_request_details\":\"Pull-Request-Details werden geladen…\",\"loading_review\":\"Review wird geladen…\",\"nothing_flagged_on_this_pull_request\":\"An diesem Pull-Request wurde nichts markiert.\",\"open_on_github\":\"Auf GitHub öffnen\",\"pull_request\":\"Pull Request\",\"pull_request_detail\":\"Pull-Request-Detail\",\"retry_review\":\"Review wiederholen\",\"review\":\"Review\",\"review_again\":\"Erneut reviewen\",\"review_again_at_current_head\":\"Diesen Pull-Request auf seinem aktuellen Head erneut reviewen\",\"review_already_running\":\"Ein Review dieses Pull-Requests läuft bereits\",\"review_completed_with_no_findings\":\"Das Review ist abgeschlossen und hat keine Befunde ergeben, die deine Zeit wert sind.\",\"review_this_pull_request\":\"Diesen Pull-Request reviewen\",\"reviewing\":\"Wird reviewt…\",\"running\":\"läuft\",\"sage_review\":\"Sage-Review\",\"see_the_reason_above\":\"Siehe den Grund oben.\",\"start_a_review_and_its_findings_appear_here_you\":\"Starte ein Review, und seine Befunde erscheinen hier — du kannst die Seite verlassen, eine Benachrichtigung sagt dir, wenn es eintrifft.\",\"that_review_produced_no_report_for_this_pull_req\":\"Dieses Review hat für diesen Pull-Request keinen Bericht erzeugt.\",\"this_pull_request_has_not_been_reviewed_yet\":\"Dieser Pull-Request wurde noch nicht reviewt.\",\"updated\":\"aktualisiert\"},\"prSourcePanel\":{\"load_failed\":\"Pull-Request-Details konnten nicht geladen werden: {{reason}}\",\"partial_sections\":\"Einige Abschnitte sind unvollständig ({{sections}}) — die Provider-Anfrage ist fehlgeschlagen oder hat ein Seitenlimit erreicht.\"},\"prStatusChips\":{\"all_checks_passed_one\":\"{{count}} Check bestanden\",\"all_checks_passed_other\":\"alle {{count}} Checks bestanden\",\"checks_failing_one\":\"{{failed}} von {{count}} Check fehlgeschlagen\",\"checks_failing_other\":\"{{failed}} von {{count}} Checks fehlgeschlagen\",\"checks_running_one\":\"{{pending}} von {{count}} Check läuft noch\",\"checks_running_other\":\"{{pending}} von {{count}} Checks laufen noch\",\"closed\":\"geschlossen\",\"conflicts\":\"Konflikte\",\"failing_count_one\":\"{{count}} fehlgeschlagen\",\"failing_count_other\":\"{{count}} fehlgeschlagen\",\"merge_blocked\":\"Merge blockiert\",\"merged\":\"gemerged\",\"open\":\"offen\",\"passed_count_one\":\"{{count}} bestanden\",\"passed_count_other\":\"{{count}} bestanden\",\"running_count_one\":\"{{count}} läuft\",\"running_count_other\":\"{{count}} laufen\"},\"repoSwitcher\":{\"add_a_repo\":\"Repo hinzufügen\",\"all_repos\":\"Alle Repos\",\"filter_repos\":\"Repos filtern\",\"filter_repositories\":\"Repositories filtern\",\"loading\":\"Lädt…\",\"no_repo_matches_that\":\"Dazu passt kein Repo.\",\"no_repos_yet_add_one_to_pick_from_the_repos_you\":\"Noch keine Repos — füge eines hinzu, um aus den Repos zu wählen, an denen du arbeitest.\",\"pick_a_repo\":\"Repo wählen\",\"pick_a_repository\":\"Repository wählen\",\"recent\":\"Zuletzt\",\"repositories\":\"Repositories\",\"repository_named\":\"Repository: {{name}}\"},\"reportView\":{\"blast_radius\":\"Auswirkungsbereich: {{scope}}\",\"blocking_count_one\":\"{{count}} blockierend\",\"blocking_count_other\":\"{{count}} blockierend\",\"changes_reviewed_one\":\"{{count}} Änderung reviewt\",\"changes_reviewed_other\":\"{{count}} Änderungen reviewt\",\"clear\":\"Zurücksetzen\",\"design_gate\":\"Design-Gate ·\",\"design_risk\":\"Designrisiko: {{level}}\",\"draft_selected_one\":\"{{count}} ausgewählten Befund als Entwurf anlegen\",\"draft_selected_other\":\"{{count}} ausgewählte Befunde als Entwurf anlegen\",\"finding_dimension_in_file\":\"{{dimension}} in {{file}}\",\"generated\":\"· erzeugt\",\"moved_to\":\"Jetzt in {{band}}. Bleibt an dieser Stelle, bis du den Filter wechselst.\",\"no_changes_in_this_band\":\"Keine Änderungen in dieser Kategorie.\",\"nothing_flagged_in_this_review\":\"In diesem Review wurde nichts markiert.\",\"open_shared_copy\":\"Geteilte Kopie öffnen\",\"open_the_pull_request\":\"Den Pull-Request öffnen\",\"share\":\"Teilen\",\"sharing\":\"Wird geteilt…\",\"should_fix_count_one\":\"{{count}} sollte behoben werden\",\"should_fix_count_other\":\"{{count}} sollten behoben werden\",\"step_problem\":\"Problem\",\"step_solution_fit\":\"Passung der Lösung\",\"step_why_it_matters\":\"Warum das wichtig ist\"},\"reviewChat\":{\"continue_hint\":\"Das Gespräch mit diesem Reviewer wird im Chat-Tab fortgesetzt.\",\"continue_session\":\"Folgesitzung fortsetzen\",\"earlier_questions\":\"Frühere Fragen\",\"error_generic\":\"Die Folgesitzung konnte nicht geöffnet werden. Versuche es erneut.\",\"error_run_deleted\":\"Diese Prüfung wurde gelöscht, damit ist das Gespräch beendet.\",\"loading\":\"Wird geladen…\",\"new_session_unavailable\":\"Eine neue Folgesitzung lässt sich aus dieser App noch nicht öffnen: Dafür braucht es ein Kiro Crew, das einer App erlaubt, eine benannte Chat-Sitzung zu öffnen. Eine Folgesitzung, die du schon geöffnet hast, kannst du weiterführen.\",\"not_recorded_notice\":\"Diese Review hat keine Reviewer-Sitzung aufbewahrt, daher lässt sich nichts erneut öffnen. Prüfe diesen Pull Request erneut, um Fragen zu stellen.\",\"open_session\":\"Folgesitzung öffnen\",\"opening\":\"Wird geöffnet…\",\"ran_tools\":\"Angesehen: {{tools}}\",\"reasoning\":\"Begründung\",\"refused_notice\":\"Für eine vollständige Antwort war ein Werkzeug nötig, das nicht erlaubt war – diese Antwort ist daher eingeschränkt. Aktiviere YOLO, um es zuzulassen.\",\"resume_hint\":\"Öffnet einen Chat, der den Reviewer wiederherstellt — mit der Begründung hinter seinen Befunden.\",\"role_reviewer\":\"Prüfer\",\"role_you\":\"Du\",\"run_live_notice\":\"Diese Review läuft noch. Ihre Befunde können sich bis zum Ende ändern, daher gibt es noch nichts zu fragen.\",\"title\":\"Prüfer fragen\",\"transcript_gone_notice\":\"Die Sitzung des Reviewers liegt nicht mehr auf der Festplatte, daher lässt sich nichts erneut öffnen. Prüfe diesen Pull Request erneut, um Fragen zu stellen.\"},\"reviewQueue\":{\"empty\":\"Keine Pull Requests warten auf dein Review.\",\"filter_by_repo\":\"Nach Repo oder Titel filtern\",\"setup_required\":\"Richte die GitHub CLI ein, um Review-Anfragen zu sehen\",\"starts_review\":\"Jede Auswahl startet ein Sage-Review. Die Ergebnisse erscheinen unter Reviews und werden nur auf GitHub gepostet, wenn du es willst.\",\"starts_review_truncated\":\"Nur die neuesten 100 Anfragen werden angezeigt. Jede Auswahl startet ein Sage-Review. Die Ergebnisse erscheinen unter Reviews und werden nur auf GitHub gepostet, wenn du es willst.\",\"tab\":\"Anfragen\"},\"runCard\":{\"cancel\":\"Abbrechen\",\"clean\":\"Sauber\",\"delete\":\"Löschen\",\"delete_review_of\":\"Review von {{label}} löschen\",\"delete_this_review\":\"Dieses Review löschen\",\"delete_this_review_2\":\"Dieses Review löschen?\",\"more_count_one\":\"+{{count}} weiterer\",\"more_count_other\":\"+{{count}} weitere\",\"needs_review_count_one\":\"{{count}} braucht ein Review\",\"needs_review_count_other\":\"{{count}} brauchen ein Review\",\"pull_requests\":\"Pull-Requests\",\"review\":\"Review\",\"review_of\":\"Review von {{label}}\",\"review_of_with_more_one\":\"Review von {{label}} und {{count}} weiteren\",\"review_of_with_more_other\":\"Review von {{label}} und {{count}} weiteren\",\"worth_a_glance_count_one\":\"{{count}} lohnt einen Blick\",\"worth_a_glance_count_other\":\"{{count}} lohnen einen Blick\"},\"runDetail\":{\"cancelled_before_any_finished\":\"Es wurde abgebrochen, bevor ein Pull-Request fertig war.\",\"finished\":\"fertig\",\"loading_report\":\"Bericht wird geladen…\",\"more_count_one\":\"+{{count}} weiterer\",\"more_count_other\":\"+{{count}} weitere\",\"nothing_to_report\":\"Kein Pull-Request hat ein Review abgeschlossen, daher gab es nichts zu berichten.\",\"pull_request_one\":\"{{count}} Pull-Request\",\"pull_request_other\":\"{{count}} Pull-Requests\",\"report_appears_when_the_review_finishes\":\"Der Bericht erscheint hier, sobald das Review fertig ist.\",\"skipped_inflight_one\":\"{{count}} Pull-Request wurde übersprungen, weil ein anderes Review ihn schon hatte.\",\"skipped_inflight_other\":\"{{count}} Pull-Requests wurden übersprungen, weil ein anderes Review sie schon hatte.\",\"started\":\"gestartet\",\"this_review_produced_no_report\":\"Dieses Review hat keinen Bericht erzeugt.\",\"you_can_leave_this_page_a_notification_will_tell\":\"Du kannst diese Seite verlassen — eine Benachrichtigung sagt dir, wenn es eintrifft.\"},\"runList\":{\"new_review\":\"Neues Review\"},\"runProgress\":{\"cancel_review\":\"Review abbrechen\",\"cancelled_count_one\":\"{{count}} abgebrochen\",\"cancelled_count_other\":\"{{count}} abgebrochen\",\"cancelling\":\"Wird abgebrochen…\",\"elapsed_time\":\"Vergangene Zeit\",\"failed_count_one\":\"{{count}} fehlgeschlagen\",\"failed_count_other\":\"{{count}} fehlgeschlagen\",\"median_of_past_runs_of_this_size\":\"Median früherer Läufe dieser Größe\",\"review_progress\":\"Review-Fortschritt\",\"reviewed_of_one\":\"{{done}} / {{count}} reviewt\",\"reviewed_of_other\":\"{{done}} / {{count}} reviewt\",\"reviewers_busy\":\"{{busy}} von {{max}} Reviewern beschäftigt\",\"step\":\"· Schritt\",\"stops_queued_prs_one_already_being_reviewed_will\":\"Stoppt wartende PRs; ein bereits laufendes Review wird fertig.\",\"usually\":\"meist ~\",\"working\":\"Arbeitet\"},\"runStatusPill\":{\"cancelled\":\"Abgebrochen\",\"cancelling\":\"Wird abgebrochen\",\"done\":\"Fertig\",\"error\":\"Fehler\",\"interrupted\":\"Unterbrochen\",\"running\":\"Läuft\"},\"shipSummaryCard\":{\"post_the_ship_readiness_summary\":\"Die Freigabe-Zusammenfassung veröffentlichen\",\"post_this_comment\":\"Diesen Kommentar veröffentlichen\",\"posted_as_a_top_level_comment\":\"als Top-Level-Kommentar veröffentlicht\",\"posted_to_the_pull_request\":\"Am Pull-Request veröffentlicht\",\"posting\":\"Wird veröffentlicht…\",\"select_the_ship_readiness_summary_to_post\":\"Die Freigabe-Zusammenfassung zum Veröffentlichen auswählen\",\"ship_readiness_summary\":\"Freigabe-Zusammenfassung\"}},\"lib\":{\"format\":{\"cause_no_agent_cli\":\"Der Reviewer ist nie gestartet — auf diesem Host wurde keine ausführbare kiro-cli-Datei gefunden. Installiere sie, oder nimm sie in PATH auf.\",\"cause_no_record\":\"Der Reviewer ist fertig geworden, hat aber keine Befunde aufgezeichnet.\",\"cause_record_incomplete\":\"Der Reviewer hat einen Befund-Datensatz geschrieben, aber vor dem Abschluss des Reviews aufgehört.\",\"cause_runtime_died\":\"Der Reviewer-Prozess wurde mitten im Review gestoppt — meist durch einen Neustart des Gateways. Am Pull-Request war nichts falsch.\",\"cause_runtime_not_importable\":\"Der Reviewer ist nie gestartet — diese Installation kann die benötigte Agent-Runtime nicht laden. Repariere die Installation, um sie wiederherzustellen.\",\"cause_runtime_unavailable\":\"Der Reviewer ist nie gestartet — seine Agent-Runtime ist auf diesem Host nicht verfügbar.\",\"cause_timeout\":\"Das Review hat sein Zeitlimit überschritten.\",\"cause_turn_failed\":\"Der Review-Turn ist fehlgeschlagen, bevor etwas aufgezeichnet wurde.\",\"cause_unknown\":\"Das Review wurde nicht abgeschlossen.\",\"days_ago_one\":\"vor {{count}} T\",\"days_ago_other\":\"vor {{count}} T\",\"hours_ago_one\":\"vor {{count}} Std\",\"hours_ago_other\":\"vor {{count}} Std\",\"just_now\":\"gerade eben\",\"minutes_ago_one\":\"vor {{count}} Min\",\"minutes_ago_other\":\"vor {{count}} Min\",\"phase_cancelled\":\"Abgebrochen\",\"phase_done\":\"Fertig\",\"phase_failed\":\"Fehlgeschlagen\",\"phase_pending\":\"Ausstehend\",\"phase_queued\":\"In der Warteschlange\",\"phase_reviewing\":\"Wird reviewt\"}},\"manifest\":{\"configuration_1\":\"Installiere und authentifiziere die gh-CLI auf dem Gateway-Host, füge ein Repository hinzu und wähle dann in den Einstellungen Review-Modell, Reasoning-Aufwand und Parallelität.\",\"description\":\"Prüft Pull Requests auf GitHub in der Tiefe und sagt dir, welche Änderungen wirklich deine Aufmerksamkeit verdienen. Jeder Pull-Request wird in einer eigenen, isolierten Agentensitzung überprüft, die jede geänderte Datei abdeckt, nach ihrer möglichen Wirkungsbreite gewichtet und zu einem priorisierten Fokusbericht zusammengefasst. Ergebnisse liest du in der App; als Entwurf einer Überprüfung auf GitHub werden sie nur vorbereitet, wenn du sie veröffentlichst oder automatisches Posten aktivierst, und der Prüfer lernt fortlaufend die echten Standards deines Repositorys aus ausgelieferten Korrekturen und früheren Review-Kommentaren.\",\"display_name\":\"Code Review Sage\",\"highlight_1\":\"Der Fokusbericht sortiert Änderungen nach Wirkungsbreite, damit die riskanten Dateien zuerst gelesen werden\",\"highlight_2\":\"Eine isolierte Agentensitzung pro Pull-Request, damit Ergebnisse nie zwischen Überprüfungen verschwimmen\",\"highlight_3\":\"Reviews werden in der App gelesen – es wird nichts an deinen Pull Request gepostet, sofern du es nicht anforderst\",\"highlight_4\":\"Lernt pro Repository aus ausgelieferten Korrekturen, Review-Kommentaren und Design-Diskussionen\",\"highlight_5\":\"Überprüft Pull Requests auf GitHub; benötigt eine authentifizierte `gh` CLI auf dem Gateway-Host\",\"page_label\":\"Code Review Sage\",\"use_case_1\":\"Prüfe einen oder mehrere GitHub-Pull-Requests nach Risiko, untersuche gezielte Ergebnisse und bereite nur veröffentlichungswürdige Kommentare vor.\"},\"views\":{\"learningView\":{\"cancel\":\"Abbrechen\",\"confirm_merge_one\":\"{{count}} Erkenntnis in den Regelsatz übernehmen?\",\"confirm_merge_other\":\"{{count}} Erkenntnisse in den Regelsatz übernehmen?\",\"consolidate\":\"Zusammenführen\",\"consolidate_pending_one\":\"{{count}} ausstehende Erkenntnis in {{namespace}} zusammenführen\",\"consolidate_pending_other\":\"{{count}} ausstehende Erkenntnisse in {{namespace}} zusammenführen\",\"consolidating\":\"Wird zusammengeführt…\",\"learning\":\"Lernen\",\"loaded_during_reviews\":\"bei Reviews geladen\",\"loading_learnings\":\"Erkenntnisse werden geladen…\",\"merge_failed_ruleset_unchanged\":\"Zusammenführen fehlgeschlagen — Regelsatz unverändert\",\"not_loaded\":\"nicht geladen\",\"nothing_consolidated_yet_reviews_in_this_namespa\":\"Noch nichts zusammengeführt — Reviews in diesem Namespace laden derzeit keine gelernten Muster.\",\"nothing_staged_new_learnings_land_here_when_a_re\":\"Nichts vorgemerkt. Neue Erkenntnisse landen hier, wenn ein Review einen ausgelieferten Fix oder einen umgesetzten Review-Kommentar analysiert.\",\"pattern_one\":\"{{count}} Muster\",\"pattern_other\":\"{{count}} Muster\",\"pending_consolidation\":\"Ausstehende Zusammenführung ·\",\"pick_a_namespace_in_the_sidebar_to_read_the_patt\":\"Wähle in der Seitenleiste einen Namespace, um die Muster zu lesen, die Reviews daraus laden.\",\"reviews_read_the_consolidated_ruleset_below_neve\":\"Reviews lesen den zusammengeführten Regelsatz unten, niemals die ausstehenden Kandidaten. Das Zusammenführen übernimmt das Vorgemerkte in ihn — ein einmaliger KI-Merge, den du auslöst, sodass sich nichts an dem ändert, was Reviews sehen, bis du ihn ausführst.\",\"ruleset\":\"Regelsatz ·\"},\"settingsView\":{\"default_agent_config\":\"Standard (Agent-Konfiguration)\",\"default_model_provider\":\"Standard (Modell / Provider)\",\"higher_effort_finds_more_costs_more_and_takes_lo\":\"Mehr Aufwand findet mehr, kostet mehr und dauert länger pro Pull-Request. Bei Standard entscheidet das Modell oder der Provider.\",\"how_many_pull_requests_are_reviewed_in_parallel\":\"Wie viele Pull-Requests parallel auf der gemeinsamen Worker-Runtime reviewt werden. Das ist die eigentliche Grenze für den Review-Durchsatz — mehrere Review-Threads können gleichzeitig offen sein, aber sie schöpfen alle aus diesem Budget.\",\"loading_settings\":\"Einstellungen werden geladen…\",\"model\":\"Modell\",\"reasoning_effort\":\"Reasoning-Aufwand\",\"review_model\":\"Review-Modell\",\"reviews_at_once\":\"Reviews gleichzeitig\",\"settings\":\"Einstellungen\",\"these_apply_to_every_review_started_from_here\":\"Das gilt für jedes Review, das von hier gestartet wird.\",\"which_model_performs_the_review_default_inherits\":\"Welches Modell das Review durchführt. Standard übernimmt die Agent-Konfiguration, sodass eine Änderung deines Standardmodells auch das hier ändert.\"}},\"workspace\":{\"drag_to_resize\":\"Zum Ändern der Größe ziehen\",\"resize_sidebar\":\"Größe der Seitenleiste ändern\",\"select_a_review_to_see_its_progress_and_report\":\"Wähle ein Review, um seinen Fortschritt und Bericht zu sehen.\",\"start_a_new_one_several_can_run_at_once\":\"Starte ein neues — mehrere können gleichzeitig laufen.\"}},\"issueRadar\":{\"components\":{\"prDetail\":{\"labels\":\"Labels\"}}}}"),
		components: { "resizeHandle": { "drag_to_resize": "Ziehen zum Ändern der Größe" } },
		lib: { "scriptLabel": {
			"cyrillic": "kyrillischer Buchstabe",
			"greek": "griechischer Buchstabe",
			"latin": "lateinischer Buchstabe",
			"other": "Zeichen"
		} }
	},
	en: {
		app: {
			"collapse_sidebar": "Collapse sidebar",
			"expand_sidebar": "Expand sidebar"
		},
		apps: /* @__PURE__ */ JSON.parse("{\"codeReviewSage\":{\"codeReviewSagePage\":{\"open_pr_one\":\"{{count}} open PR\",\"open_pr_other\":\"{{count}} open PRs\",\"pattern_one\":\"{{count}} pattern\",\"pattern_other\":\"{{count}} patterns\"},\"components\":{\"addReposModal\":{\"add\":\"Add\",\"add_one_by_url_above\":\"Add one by URL above.\",\"add_repo\":\"Add {{repo}}\",\"add_repos\":\"Add repos\",\"added\":\"added\",\"all_your_repos\":\"All your repos\",\"already_added\":\"{{repo}} already added\",\"archived\":\"archived\",\"based_on_recent_github_activity\":\"Based on your recent GitHub activity\",\"close\":\"Close\",\"close_add_repos_dialog\":\"Close add-repos dialog\",\"contributed_events_one\":\"{{age}} · {{count}} event\",\"contributed_events_other\":\"{{age}} · {{count}} events\",\"filter_your_repos\":\"Filter your repos\",\"gh_auth_login\":\"gh auth login\",\"github_cli_not_ready\":\"GitHub CLI not ready\",\"newest_100_by_push_date\":\"newest 100 by push date\",\"no_repos_for_account\":\"No repos found for your account.\",\"no_repos_match_filter\":\"No repos match your filter.\",\"owner_repo_a_repo_url_or_paste_a_pull_request_li\":\"owner/repo, a repo URL, or paste a pull request link\",\"pick_from_the_repos_you_can_reach_or_type_one_in\":\"Pick from the repos you can reach, or type one in. Added repos appear\\n              in the sidebar so you can start a review from them. Paste a pull\\n              request link and it opens that pull request directly.\",\"pinned_to_the_sidebar\":\"pinned to the sidebar\",\"private\":\"Private\",\"pushed_age\":\"pushed {{age}}\",\"re_read_your_repos_from_github\":\"Re-read your repos from GitHub\",\"read_only\":\"read-only\",\"read_only_access\":\"Read-only access\",\"reading_your_repos_from_github\":\"Reading your repos from GitHub…\",\"recently_worked_on\":\"Recently worked on\",\"refresh_your_repos\":\"Refresh your repos\",\"remove\":\"Remove\",\"remove_repo\":\"Remove {{repo}}\",\"repository_or_pull_request_url_or_owner_repo\":\"Repository or pull request URL, or owner/repo\",\"setup_hint\":\"Install the GitHub CLI and sign in with the command below to list your repos. You can still add any repo by URL above.\",\"these_lists_are_capped_so_a_repo_you_have_not_to\":\"These lists are capped, so a repo you have not touched lately may\\n                    be missing. Add it by URL above if you don't see it.\",\"your_repos\":\"Your repos\"},\"bandChips\":{\"all\":\"All\",\"clean\":\"Clean\",\"filter_by_band\":\"Filter by band\",\"needs_review\":\"Needs review\",\"worth_a_glance\":\"Worth a glance\"},\"draftReviewActions\":{\"approve\":\"Approve\",\"approve_is_unavailable_because_this_base_branch_\":\"Approve is unavailable because this pull request's base branch does not dismiss approvals when new commits are pushed (or its protection is not readable from here). Without that, an approval could outlive the commit it reviewed. Approve on GitHub instead.\",\"approve_is_unavailable_while_auto_merge_is_armed\":\"Approve is unavailable while auto-merge is armed: an approval could merge this pull request before a stale-head check could take it back. Disarm auto-merge, or approve on GitHub.\",\"ask_agent_about_this_failure\":\"Ask the agent about this failure\",\"cancel\":\"Cancel\",\"confirm_approve\":\"Approve this pull request?\",\"confirm_request_changes\":\"Publish this review requesting changes?\",\"confirm_submit_as_comment\":\"Submit this review as a comment?\",\"couldn_t_check_for_a_draft_review_on_this_pull_r\":\"Couldn't check for a draft review on this pull request. This is usually a GitHub CLI authentication problem, not a missing draft.\",\"draft_review\":\"Draft review\",\"no_draft_review_on_this_pull_request\":\"No draft review on this pull request.\",\"pending_only_you_can_see_it_until_you_publish\":\"Pending — only you can see it until you publish.\",\"publish_failed\":\"Could not publish the review\",\"published_as\":\"Published as\",\"published_verdict_approved\":\"approved\",\"published_verdict_changes_requested\":\"changes requested\",\"published_verdict_comment\":\"a comment\",\"publishing\":\"Publishing…\",\"publishing_is_blocked_a_later_review_replaced_th\":\"Publishing is blocked: a later review replaced this draft on the pull request, so it no longer holds this review's findings. Open the newest review to publish it.\",\"publishing_is_blocked_this_draft_contains_conten\":\"Publishing is blocked: this draft contains content that must be redacted, and submitting would post the original text. Edit or discard the draft on GitHub.\",\"publishing_is_blocked_this_draft_was_written_aga\":\"Publishing is blocked: this draft was written against an earlier commit and the pull request has moved since. Re-review the current head first.\",\"publishing_is_blocked_this_review_is_still_runni\":\"Publishing is blocked: this review is still running, so the draft on this pull request is from an earlier run.\",\"publishing_is_irreversible_and_visible_to_everyo\":\"Publishing is irreversible and visible to everyone on the pull request.\",\"request_changes\":\"Request changes\",\"submit_as_comment\":\"Submit as comment\",\"this_draft_has_no_summary_body\":\"This draft has no summary body.\",\"try_again\":\"Try again\"},\"failureNotice\":{\"run_it_again\":\"Run it again\",\"starting\":\"Starting…\",\"this_review_failed\":\"This review failed\"},\"findingCard\":{\"cancel_dismiss\":\"Cancel\",\"confirm_dismiss\":\"Dismiss finding\",\"consequence\":\"Consequence\",\"dismiss\":\"Dismiss\",\"dismiss_failed\":\"Could not save the dismissal. Try again.\",\"dismiss_reason_label\":\"Why dismiss this finding?\",\"dismiss_reason_placeholder\":\"For example: false positive, out of scope\",\"dismissed_reason\":\"Dismissed: {{reason}}\",\"evidence\":\"Evidence\",\"observation\":\"Observation\",\"post_finding\":\"Draft this finding as a review comment\",\"post_finding_on\":\"Draft this finding as a review comment on {{target}}\",\"post_this_comment\":\"Draft this finding\",\"posted_to_the_pull_request\":\"Drafted — publish below\",\"posting\":\"Drafting…\",\"select_to_draft_together\":\"Select for bulk draft\",\"select_to_post\":\"Select {{label}} to draft\",\"severity_must_fix\":\"must-fix\",\"severity_should_fix\":\"should-fix\",\"suggestion\":\"Suggestion\",\"this_finding\":\"this finding\",\"undo_dismiss\":\"Undo\",\"undo_dismiss_failed\":\"Could not undo. The finding is still dismissed.\"},\"learningRail\":{\"add_namespace\":\"Add namespace\",\"confirm_delete\":\"Delete “{{name}}” and all its learnings? This cannot be undone.\",\"delete_2\":\"Delete\",\"delete_namespace\":\"Delete namespace {{name}}\",\"invalid_namespace_name\":\"Namespace names become folder names, so they can use only lowercase Latin letters (a–z), digits (0–9), dots, hyphens and underscores, must start and end with a letter or digit, and must be 2 to 64 characters long.\",\"invalid_namespace_name_char\":\"“{{char}}” can’t be used in a namespace name. Use lowercase a–z, 0–9, .\xA0-⁠\xA0_\",\"invalid_namespace_name_letter\":\"“{{char}}” ({{script}}, {{code}}) can’t be used in a namespace name. Use lowercase a–z, 0–9, .\xA0-⁠\xA0_\",\"keep_it\":\"Keep it\",\"load_namespace_during_reviews\":\"Load namespace {{name}} during reviews\",\"loading\":\"Loading…\",\"namespace_active\":\"Active — loaded during reviews (uncheck to disable)\",\"namespace_inactive\":\"Inactive — check to load during reviews\",\"namespaces\":\"Namespaces\",\"new_namespace\":\"New namespace\",\"new_namespace_2\":\"new-namespace\",\"new_namespace_name\":\"New namespace name\",\"pattern_one\":\"{{count}} pattern\",\"pattern_other\":\"{{count}} patterns\",\"pending_count_one\":\"{{count}} pending\",\"pending_count_other\":\"{{count}} pending\",\"read_namespace\":\"Read namespace {{name}}\"},\"leftRail\":{\"code_review_sage\":\"Code Review Sage\",\"learning\":\"Learning\",\"reviews\":\"Reviews\",\"sections\":\"Sections\",\"settings\":\"Settings\",\"version\":\"v{{version}}\"},\"listSkeleton\":{\"loading_reviews\":\"Loading reviews…\"},\"middleColumn\":{\"all_repos\":\"All repos\",\"just_this_repo\":\"Just {{repo}}\",\"lists_label\":\"Pull requests or reviews\",\"no_reviews_for_repo\":\"No reviews for {{repo}}\",\"no_reviews_yet\":\"No reviews yet\",\"pick_a_repo_then_a_pr\":\"Pick a repo, then a pull request.\",\"pull_requests\":\"Pull requests\",\"repo_lists_label\":\"{{repo}}: pull requests or reviews\",\"repo_reviews_appear_here\":\"Reviews you start for this repo appear here.\",\"reviews\":\"Reviews\",\"show_all_count\":\"Show all ({{count}})\",\"this_repo_only\":\"{{repo}} only\"},\"postCommentsButton\":{\"cancel\":\"Cancel\",\"confirm_post_one\":\"Draft {{count}} comment as a pending review?\",\"confirm_post_other\":\"Draft {{count}} comments as a pending review?\",\"drafted_publish_on_pr_page_one\":\"Drafted {{count}} comment — open the pull request here to publish\",\"drafted_publish_on_pr_page_other\":\"Drafted {{count}} comments — open the pull request here to publish\",\"post_action\":\"Draft\",\"post_count_one\":\"Draft {{count}} comment\",\"post_count_other\":\"Draft {{count}} comments\",\"post_failed\":\"Could not draft the review\",\"posted_age\":\"Drafted {{age}}\",\"posted_comments_one\":\"Drafted {{count}} comment — publish below\",\"posted_comments_other\":\"Drafted {{count}} comments — publish below\",\"posting\":\"Drafting…\",\"publish_these_findings_as_a_review_on_the_pull_r\":\"Draft these findings as a review — only you can see it until you publish\"},\"prPickList\":{\"a_review_of_this_pull_request_is_running\":\"A review of this pull request is running\",\"add_a_repo\":\"Add a repo\",\"already_reviewed\":\"Already reviewed\",\"cancel\":\"Cancel\",\"confirm_review_all\":\"Review all {{count}} pull requests?\",\"draft\":\"draft\",\"filter_pull_requests\":\"Filter pull requests\",\"new\":\"new\",\"no_open_prs_here\":\"No open pull requests here.\",\"no_prs_match_filter\":\"No pull requests match your filter.\",\"one_or_more_github_pr_links\":\"One or more GitHub PR links\",\"open_pr\":\"Open pull request #{{number}}: {{title}}\",\"paste_pr_links\":\"Paste PR links\",\"paste_pr_links_instead\":\"Paste PR links instead\",\"pick_a_repo_to_see_its_pull_requests\":\"Pick a repo to see its pull requests.\",\"pr_already_being_reviewed\":\"Pull request #{{number}} is already being reviewed\",\"re_read_open_prs_from_github\":\"Re-read open PRs from GitHub\",\"refresh_pull_requests\":\"Refresh pull requests\",\"repos_live_in_the_sidebar\":\"Repos live in the sidebar.\",\"review_all_count\":\"Review all {{count}}\",\"review_every_open_pr_not_yet_reviewed_at_its_cur\":\"Review every open PR not yet reviewed at its current head\",\"review_pr\":\"Review pull request #{{number}}: {{title}}\",\"review_selected_count_one\":\"Review {{count}} selected\",\"review_selected_count_other\":\"Review {{count}} selected\",\"review_these\":\"Review these\",\"reviewed\":\"reviewed\",\"reviewed_age\":\"Reviewed {{age}}\",\"reviewed_before_the_head_commit_has_moved_since\":\"Reviewed before — the head commit has moved since\",\"reviewing\":\"reviewing\",\"updated\":\"updated\"},\"prReviewDetail\":{\"author\":\"Author\",\"cancelled_before_finishing\":\"It was cancelled before this one finished.\",\"did_not_complete_for_this_change\":\"Review did not complete for this change.\",\"draft\":\"Draft PR\",\"findings_appear_here_as_soon_as_the_review_finis\":\"Findings appear here as soon as the review finishes. You can leave the\\n          page — a notification will tell you when it lands.\",\"head\":\"head\",\"loading_pull_request_details\":\"Loading pull-request details…\",\"loading_review\":\"Loading review…\",\"nothing_flagged_on_this_pull_request\":\"Nothing flagged on this pull request.\",\"open_on_github\":\"Open on GitHub\",\"pull_request\":\"Pull request\",\"pull_request_detail\":\"Pull request detail\",\"retry_review\":\"Retry review\",\"review\":\"Review\",\"review_again\":\"Review again\",\"review_again_at_current_head\":\"Review this pull request again at its current head\",\"review_already_running\":\"A review of this pull request is already running\",\"review_completed_with_no_findings\":\"Review completed and raised no findings worth your time.\",\"review_this_pull_request\":\"Review this pull request\",\"reviewing\":\"Reviewing…\",\"running\":\"running\",\"sage_review\":\"Sage Review\",\"see_the_reason_above\":\"See the reason above.\",\"start_a_review_and_its_findings_appear_here_you\":\"Start a review and its findings appear here — you can leave the page,\\n                a notification will tell you when it lands.\",\"that_review_produced_no_report_for_this_pull_req\":\"That review produced no report for this pull request.\",\"this_pull_request_has_not_been_reviewed_yet\":\"This pull request has not been reviewed yet.\",\"updated\":\"updated\"},\"prSourcePanel\":{\"load_failed\":\"Could not load pull-request details: {{reason}}\",\"partial_sections\":\"Some sections are incomplete ({{sections}}) — the provider request failed or hit a page limit.\"},\"prStatusChips\":{\"all_checks_passed_one\":\"{{count}} check passed\",\"all_checks_passed_other\":\"all {{count}} checks passed\",\"checks_failing_one\":\"{{failed}} of {{count}} check failing\",\"checks_failing_other\":\"{{failed}} of {{count}} checks failing\",\"checks_running_one\":\"{{pending}} of {{count}} check still running\",\"checks_running_other\":\"{{pending}} of {{count}} checks still running\",\"closed\":\"closed\",\"conflicts\":\"conflicts\",\"failing_count_one\":\"{{count}} failing\",\"failing_count_other\":\"{{count}} failing\",\"merge_blocked\":\"merge blocked\",\"merged\":\"merged\",\"open\":\"open\",\"passed_count_one\":\"{{count}} passed\",\"passed_count_other\":\"{{count}} passed\",\"running_count_one\":\"{{count}} running\",\"running_count_other\":\"{{count}} running\"},\"repoSwitcher\":{\"add_a_repo\":\"Add a repo\",\"all_repos\":\"All repos\",\"filter_repos\":\"Filter repos\",\"filter_repositories\":\"Filter repositories\",\"loading\":\"Loading…\",\"no_repo_matches_that\":\"No repo matches that.\",\"no_repos_yet_add_one_to_pick_from_the_repos_you\":\"No repos yet — add one to pick from the repos you work on.\",\"pick_a_repo\":\"Pick a repo\",\"pick_a_repository\":\"Pick a repository\",\"recent\":\"Recent\",\"repositories\":\"Repositories\",\"repository_named\":\"Repository: {{name}}\"},\"reportView\":{\"blast_radius\":\"Blast radius: {{scope}}\",\"blocking_count_one\":\"{{count}} blocking\",\"blocking_count_other\":\"{{count}} blocking\",\"changes_reviewed_one\":\"{{count}} change reviewed\",\"changes_reviewed_other\":\"{{count}} changes reviewed\",\"clear\":\"Clear\",\"design_gate\":\"Design gate ·\",\"design_risk\":\"Design risk: {{level}}\",\"draft_selected_one\":\"Draft {{count}} selected finding\",\"draft_selected_other\":\"Draft {{count}} selected findings\",\"finding_dimension_in_file\":\"{{dimension}} in {{file}}\",\"generated\":\"· generated\",\"moved_to\":\"Now in {{band}}. Kept in place until you change the filter.\",\"no_changes_in_this_band\":\"No changes in this band.\",\"nothing_flagged_in_this_review\":\"Nothing flagged in this review.\",\"open_shared_copy\":\"Open shared copy\",\"open_the_pull_request\":\"Open the pull request\",\"share\":\"Share\",\"sharing\":\"Sharing…\",\"should_fix_count_one\":\"{{count}} should-fix\",\"should_fix_count_other\":\"{{count}} should-fix\",\"step_problem\":\"Problem\",\"step_solution_fit\":\"Solution fit\",\"step_why_it_matters\":\"Why it matters\"},\"reviewChat\":{\"continue_hint\":\"The conversation with this reviewer continues in the Chat tab.\",\"continue_session\":\"Continue the follow-up session\",\"earlier_questions\":\"Earlier questions\",\"error_generic\":\"The follow-up session could not be opened. Try again.\",\"error_run_deleted\":\"This review was deleted, so the conversation has ended.\",\"loading\":\"Loading…\",\"new_session_unavailable\":\"A new follow-up session cannot be opened from this app yet: it needs a Kiro Crew that lets an app open a named chat session. A follow-up session you already opened can still be continued.\",\"not_recorded_notice\":\"This review did not keep a reviewer session, so there is nothing to reopen. Review this pull request again to ask about it.\",\"open_session\":\"Open a follow-up session\",\"opening\":\"Opening…\",\"ran_tools\":\"Looked at: {{tools}}\",\"reasoning\":\"Reasoning\",\"refused_notice\":\"It needed to run a tool to answer fully and was not allowed, so this answer is limited. Turn on YOLO to let it.\",\"resume_hint\":\"Opens a chat that resumes the reviewer, so it still has the reasoning behind its findings.\",\"role_reviewer\":\"Reviewer\",\"role_you\":\"You\",\"run_live_notice\":\"This review is still running. Its findings can change until it finishes, so there is nothing to ask about yet.\",\"title\":\"Ask the reviewer\",\"transcript_gone_notice\":\"The reviewer's session is no longer on disk, so there is nothing to reopen. Review this pull request again to ask about it.\"},\"reviewQueue\":{\"empty\":\"No pull requests await your review.\",\"filter_by_repo\":\"Filter by repo or title\",\"setup_required\":\"Set up the GitHub CLI to see review requests\",\"starts_review\":\"Each pick runs a Sage review. Findings appear under Reviews and are not posted to GitHub unless you choose to.\",\"starts_review_truncated\":\"Only the newest 100 requests are shown. Each pick runs a Sage review. Findings appear under Reviews and are not posted to GitHub unless you choose to.\",\"tab\":\"Requests\"},\"runCard\":{\"cancel\":\"Cancel\",\"clean\":\"Clean\",\"delete\":\"Delete\",\"delete_review_of\":\"Delete review of {{label}}\",\"delete_this_review\":\"Delete this review\",\"delete_this_review_2\":\"Delete this review?\",\"more_count_one\":\"+{{count}} more\",\"more_count_other\":\"+{{count}} more\",\"needs_review_count_one\":\"{{count}} needs review\",\"needs_review_count_other\":\"{{count}} need review\",\"pull_requests\":\"pull requests\",\"review\":\"Review\",\"review_of\":\"Review of {{label}}\",\"review_of_with_more_one\":\"Review of {{label}} and {{count}} more\",\"review_of_with_more_other\":\"Review of {{label}} and {{count}} more\",\"worth_a_glance_count_one\":\"{{count}} worth a glance\",\"worth_a_glance_count_other\":\"{{count}} worth a glance\"},\"runDetail\":{\"cancelled_before_any_finished\":\"It was cancelled before any pull request finished.\",\"finished\":\"finished\",\"loading_report\":\"Loading report…\",\"more_count_one\":\"+{{count}} more\",\"more_count_other\":\"+{{count}} more\",\"nothing_to_report\":\"No pull request completed a review, so there was nothing to report.\",\"pull_request_one\":\"{{count}} pull request\",\"pull_request_other\":\"{{count}} pull requests\",\"report_appears_when_the_review_finishes\":\"Report appears here as soon as the review finishes.\",\"skipped_inflight_one\":\"{{count}} pull request was skipped because another review already had it.\",\"skipped_inflight_other\":\"{{count}} pull requests were skipped because another review already had them.\",\"started\":\"started\",\"this_review_produced_no_report\":\"This review produced no report.\",\"you_can_leave_this_page_a_notification_will_tell\":\"You can leave this page — a notification will tell you when it lands.\"},\"runList\":{\"new_review\":\"New review\"},\"runProgress\":{\"cancel_review\":\"Cancel review\",\"cancelled_count_one\":\"{{count}} cancelled\",\"cancelled_count_other\":\"{{count}} cancelled\",\"cancelling\":\"Cancelling…\",\"elapsed_time\":\"Elapsed time\",\"failed_count_one\":\"{{count}} failed\",\"failed_count_other\":\"{{count}} failed\",\"median_of_past_runs_of_this_size\":\"Median of past runs of this size\",\"review_progress\":\"Review progress\",\"reviewed_of_one\":\"{{done}} / {{count}} reviewed\",\"reviewed_of_other\":\"{{done}} / {{count}} reviewed\",\"reviewers_busy\":\"{{busy}} of {{max}} reviewers busy\",\"step\":\"· step\",\"stops_queued_prs_one_already_being_reviewed_will\":\"Stops queued PRs; one already being reviewed will finish.\",\"usually\":\"usually ~\",\"working\":\"Working\"},\"runStatusPill\":{\"cancelled\":\"Cancelled\",\"cancelling\":\"Cancelling\",\"done\":\"Done\",\"error\":\"Error\",\"interrupted\":\"Interrupted\",\"running\":\"Running\"},\"shipSummaryCard\":{\"post_the_ship_readiness_summary\":\"Draft the ship-readiness summary\",\"post_this_comment\":\"Draft this comment\",\"posted_as_a_top_level_comment\":\"drafted as a top-level comment\",\"posted_to_the_pull_request\":\"Drafted — publish below\",\"posting\":\"Drafting…\",\"select_the_ship_readiness_summary_to_post\":\"Select the ship-readiness summary to draft\",\"ship_readiness_summary\":\"Ship-readiness summary\"}},\"lib\":{\"format\":{\"cause_no_agent_cli\":\"Reviewer never started — no kiro-cli executable was found on this host. Install it, or add it to PATH.\",\"cause_no_record\":\"Reviewer finished but recorded no findings.\",\"cause_record_incomplete\":\"Reviewer wrote a findings record but stopped before completing the review.\",\"cause_runtime_died\":\"Reviewer process stopped mid-review — usually the gateway restarting. Nothing was wrong with the pull request.\",\"cause_runtime_not_importable\":\"Reviewer never started — this install cannot load the agent runtime it needs. Repair the install to restore it.\",\"cause_runtime_unavailable\":\"Reviewer never started — its agent runtime is unavailable on this host.\",\"cause_timeout\":\"Review ran past its time limit.\",\"cause_turn_failed\":\"Review turn failed before recording anything.\",\"cause_unknown\":\"Review did not complete.\",\"days_ago_one\":\"{{count}}d ago\",\"days_ago_other\":\"{{count}}d ago\",\"hours_ago_one\":\"{{count}}h ago\",\"hours_ago_other\":\"{{count}}h ago\",\"just_now\":\"just now\",\"minutes_ago_one\":\"{{count}}m ago\",\"minutes_ago_other\":\"{{count}}m ago\",\"phase_cancelled\":\"Cancelled\",\"phase_done\":\"Done\",\"phase_failed\":\"Failed\",\"phase_pending\":\"Pending\",\"phase_queued\":\"Queued\",\"phase_reviewing\":\"Reviewing\"}},\"manifest\":{\"configuration_1\":\"Install and authenticate the gh CLI on the gateway host, add a repository, then choose the review model, reasoning effort, and concurrency in Settings.\",\"description\":\"Deep-reviews GitHub pull requests and tells you which changes actually deserve your attention. Each pull request is reviewed in its own isolated agent session that covers every changed file, weighted by how much blast radius it carries, and rolled up into a prioritized Focus Report. Findings are read in the app and staged as a draft GitHub review only when you publish them or turn on automatic posting, and the reviewer keeps learning your repository's real standards from shipped fixes and past review comments.\",\"display_name\":\"Code Review Sage\",\"highlight_1\":\"Focus Report ranks changes by blast radius so the risky files get read first\",\"highlight_2\":\"One isolated agent session per pull request, so findings never bleed between reviews\",\"highlight_3\":\"Reviews are read in the app — nothing is posted to your pull request unless you ask\",\"highlight_4\":\"Learns per-repository from shipped fixes, review comments, and design discussions\",\"highlight_5\":\"Reviews GitHub pull requests; needs an authenticated `gh` CLI on the gateway host\",\"page_label\":\"Code Review Sage\",\"use_case_1\":\"Review one or many GitHub pull requests by risk, inspect focused findings, and stage only the comments worth publishing.\"},\"views\":{\"learningView\":{\"cancel\":\"Cancel\",\"confirm_merge_one\":\"Merge {{count}} learning into the ruleset?\",\"confirm_merge_other\":\"Merge {{count}} learnings into the ruleset?\",\"consolidate\":\"Consolidate\",\"consolidate_pending_one\":\"Consolidate {{count}} pending learning in {{namespace}}\",\"consolidate_pending_other\":\"Consolidate {{count}} pending learnings in {{namespace}}\",\"consolidating\":\"Consolidating…\",\"learning\":\"Learning\",\"loaded_during_reviews\":\"loaded during reviews\",\"loading_learnings\":\"Loading learnings…\",\"merge_failed_ruleset_unchanged\":\"Merge failed — ruleset unchanged\",\"not_loaded\":\"not loaded\",\"nothing_consolidated_yet_reviews_in_this_namespa\":\"Nothing consolidated yet — reviews in this namespace currently load\\n                no learned patterns.\",\"nothing_staged_new_learnings_land_here_when_a_re\":\"Nothing staged. New learnings land here when a review analyses a\\n                shipped fix or an acted-on review comment.\",\"pattern_one\":\"{{count}} pattern\",\"pattern_other\":\"{{count}} patterns\",\"pending_consolidation\":\"Pending consolidation ·\",\"pick_a_namespace_in_the_sidebar_to_read_the_patt\":\"Pick a namespace in the sidebar to read the patterns reviews load from it.\",\"reviews_read_the_consolidated_ruleset_below_neve\":\"Reviews read the consolidated ruleset below, never the pending candidates.\\n          Consolidating merges what is staged into it — a one-shot AI merge you\\n          trigger, so nothing changes what reviews see until you run it.\",\"ruleset\":\"Ruleset ·\"},\"settingsView\":{\"default_agent_config\":\"Default (agent config)\",\"default_model_provider\":\"Default (model / provider)\",\"higher_effort_finds_more_costs_more_and_takes_lo\":\"Higher effort finds more, costs more, and takes longer per pull\\n                    request. Default lets the model or provider decide.\",\"how_many_pull_requests_are_reviewed_in_parallel\":\"How many pull requests are reviewed in parallel on the shared\\n                    worker runtime. This is the real limit on review throughput —\\n                    several review threads can be open at the same time, but they\\n                    all draw from this budget.\",\"loading_settings\":\"Loading settings…\",\"model\":\"Model\",\"reasoning_effort\":\"Reasoning effort\",\"review_model\":\"Review model\",\"reviews_at_once\":\"Reviews at once\",\"settings\":\"Settings\",\"these_apply_to_every_review_started_from_here\":\"These apply to every review started from here.\",\"which_model_performs_the_review_default_inherits\":\"Which model performs the review. Default inherits the agent\\n                    configuration, so changing your default model changes this too.\"}},\"workspace\":{\"drag_to_resize\":\"Drag to resize\",\"resize_sidebar\":\"Resize sidebar\",\"select_a_review_to_see_its_progress_and_report\":\"Select a review to see its progress and report.\",\"start_a_new_one_several_can_run_at_once\":\"Start a new one — several can run at the same time.\"}},\"issueRadar\":{\"components\":{\"prDetail\":{\"labels\":\"Labels\"}}}}"),
		components: { "resizeHandle": { "drag_to_resize": "Drag to resize" } },
		lib: { "scriptLabel": {
			"cyrillic": "Cyrillic letter",
			"greek": "Greek letter",
			"latin": "Latin letter",
			"other": "character"
		} }
	},
	es: {
		app: {
			"collapse_sidebar": "Contraer la barra lateral",
			"expand_sidebar": "Expandir la barra lateral"
		},
		apps: /* @__PURE__ */ JSON.parse("{\"codeReviewSage\":{\"codeReviewSagePage\":{\"open_pr_many\":\"{{count}} PR abiertos\",\"open_pr_one\":\"{{count}} PR abierto\",\"open_pr_other\":\"{{count}} PR abiertos\",\"pattern_many\":\"{{count}} patrones\",\"pattern_one\":\"{{count}} patrón\",\"pattern_other\":\"{{count}} patrones\"},\"components\":{\"addReposModal\":{\"add\":\"Añadir\",\"add_one_by_url_above\":\"Añade uno por URL arriba.\",\"add_repo\":\"Añadir {{repo}}\",\"add_repos\":\"Añadir repos\",\"added\":\"añadido\",\"all_your_repos\":\"Todos tus repos\",\"already_added\":\"{{repo}} ya está añadido\",\"archived\":\"archivado\",\"based_on_recent_github_activity\":\"Según tu actividad reciente en GitHub\",\"close\":\"Cerrar\",\"close_add_repos_dialog\":\"Cerrar el diálogo de añadir repos\",\"contributed_events_many\":\"{{age}} · {{count}} eventos\",\"contributed_events_one\":\"{{age}} · {{count}} evento\",\"contributed_events_other\":\"{{age}} · {{count}} eventos\",\"filter_your_repos\":\"Filtra tus repos\",\"gh_auth_login\":\"gh auth login\",\"github_cli_not_ready\":\"GitHub CLI no está listo\",\"newest_100_by_push_date\":\"los 100 más recientes por fecha de subida\",\"no_repos_for_account\":\"No se encontraron repos para tu cuenta.\",\"no_repos_match_filter\":\"Ningún repo coincide con tu filtro.\",\"owner_repo_a_repo_url_or_paste_a_pull_request_li\":\"owner/repo, una URL de repo, o pega un enlace de pull request\",\"pick_from_the_repos_you_can_reach_or_type_one_in\":\"Elige entre los repos a los que llegas, o escribe uno. Los repos añadidos aparecen en la barra lateral para que puedas iniciar una revisión desde ellos. Pega un enlace de pull request y se abrirá ese pull request directamente.\",\"pinned_to_the_sidebar\":\"fijado en la barra lateral\",\"private\":\"Privado\",\"pushed_age\":\"subido {{age}}\",\"re_read_your_repos_from_github\":\"Volver a leer tus repos desde GitHub\",\"read_only\":\"solo lectura\",\"read_only_access\":\"Acceso de solo lectura\",\"reading_your_repos_from_github\":\"Leyendo tus repos desde GitHub…\",\"recently_worked_on\":\"Trabajados hace poco\",\"refresh_your_repos\":\"Actualizar tus repos\",\"remove\":\"Quitar\",\"remove_repo\":\"Quitar {{repo}}\",\"repository_or_pull_request_url_or_owner_repo\":\"URL de repositorio o de pull request, u owner/repo\",\"setup_hint\":\"Instala GitHub CLI e inicia sesión con el comando de abajo para listar tus repos. Aún puedes añadir cualquier repo por URL arriba.\",\"these_lists_are_capped_so_a_repo_you_have_not_to\":\"Estas listas tienen un límite, así que puede faltar un repo que no hayas tocado últimamente. Añádelo por URL arriba si no lo ves.\",\"your_repos\":\"Tus repos\"},\"bandChips\":{\"all\":\"Todas\",\"clean\":\"Sin hallazgos\",\"filter_by_band\":\"Filtrar por categoría\",\"needs_review\":\"Requiere revisión\",\"worth_a_glance\":\"Merece un vistazo\"},\"draftReviewActions\":{\"approve\":\"Aprobar\",\"approve_is_unavailable_because_this_base_branch_\":\"Aprobar no está disponible porque la rama base de este pull request no descarta las aprobaciones cuando se suben nuevos commits (o su protección no es legible desde aquí). Sin eso, una aprobación podría sobrevivir al commit que revisó. Aprueba en GitHub.\",\"approve_is_unavailable_while_auto_merge_is_armed\":\"Aprobar no está disponible mientras la fusión automática está activada: una aprobación podría fusionar este pull request antes de que una comprobación del head pudiera retirarla. Desactiva la fusión automática o aprueba en GitHub.\",\"ask_agent_about_this_failure\":\"Preguntar al agente sobre este error\",\"cancel\":\"Cancelar\",\"confirm_approve\":\"¿Aprobar esta solicitud de incorporación de cambios?\",\"confirm_request_changes\":\"¿Publicar esta revisión solicitando cambios?\",\"confirm_submit_as_comment\":\"¿Enviar esta revisión como comentario?\",\"couldn_t_check_for_a_draft_review_on_this_pull_r\":\"No se pudo comprobar si hay una revisión en borrador en esta pull request. Normalmente es un problema de autenticación de la CLI de GitHub, no un borrador que falte.\",\"draft_review\":\"Revisión en borrador\",\"no_draft_review_on_this_pull_request\":\"No hay ninguna revisión en borrador en este pull request.\",\"pending_only_you_can_see_it_until_you_publish\":\"Pendiente: solo tú puedes verla hasta que la publiques.\",\"publish_failed\":\"No se pudo publicar la revisión\",\"published_as\":\"Publicada como\",\"published_verdict_approved\":\"aprobada\",\"published_verdict_changes_requested\":\"cambios solicitados\",\"published_verdict_comment\":\"un comentario\",\"publishing\":\"Publicando…\",\"publishing_is_blocked_a_later_review_replaced_th\":\"Publicación bloqueada: una revisión posterior reemplazó este borrador en la solicitud de incorporación de cambios, por lo que ya no contiene los hallazgos de esta revisión. Abre la revisión más reciente para publicarla.\",\"publishing_is_blocked_this_draft_contains_conten\":\"La publicación está bloqueada: este borrador contiene contenido que debe redactarse, y enviarlo publicaría el texto original. Edita o descarta el borrador en GitHub.\",\"publishing_is_blocked_this_draft_was_written_aga\":\"La publicación está bloqueada: este borrador se escribió sobre un commit anterior y el pull request ha cambiado desde entonces. Revisa primero el head actual.\",\"publishing_is_blocked_this_review_is_still_runni\":\"La publicación está bloqueada: esta revisión aún se está ejecutando, por lo que el borrador de esta pull request proviene de una ejecución anterior.\",\"publishing_is_irreversible_and_visible_to_everyo\":\"La publicación es irreversible y visible para todos en el pull request.\",\"request_changes\":\"Solicitar cambios\",\"submit_as_comment\":\"Enviar como comentario\",\"this_draft_has_no_summary_body\":\"Este borrador no tiene texto de resumen.\",\"try_again\":\"Intentar de nuevo\"},\"failureNotice\":{\"run_it_again\":\"Ejecutarla otra vez\",\"starting\":\"Iniciando…\",\"this_review_failed\":\"Esta revisión falló\"},\"findingCard\":{\"cancel_dismiss\":\"Cancelar\",\"confirm_dismiss\":\"Descartar hallazgo\",\"consequence\":\"Consecuencia\",\"dismiss\":\"Descartar\",\"dismiss_failed\":\"No se pudo guardar el descarte. Inténtalo de nuevo.\",\"dismiss_reason_label\":\"¿Por qué descartas este hallazgo?\",\"dismiss_reason_placeholder\":\"Por ejemplo: falso positivo, fuera de alcance\",\"dismissed_reason\":\"Descartado: {{reason}}\",\"evidence\":\"Evidencia\",\"observation\":\"Observación\",\"post_finding\":\"Publicar este hallazgo en el pull request\",\"post_finding_on\":\"Publicar este hallazgo en {{target}}\",\"post_this_comment\":\"Publicar este comentario\",\"posted_to_the_pull_request\":\"Publicado en el pull request\",\"posting\":\"Publicando…\",\"select_to_draft_together\":\"Seleccionar para borrador en lote\",\"select_to_post\":\"Seleccionar {{label}} para publicar\",\"severity_must_fix\":\"Obligatorio\",\"severity_should_fix\":\"Recomendado\",\"suggestion\":\"Sugerencia\",\"this_finding\":\"este hallazgo\",\"undo_dismiss\":\"Deshacer\",\"undo_dismiss_failed\":\"No se pudo deshacer. El hallazgo sigue descartado.\"},\"learningRail\":{\"add_namespace\":\"Añadir namespace\",\"confirm_delete\":\"¿Eliminar “{{name}}” y todos sus aprendizajes? Esto no se puede deshacer.\",\"delete_2\":\"Eliminar\",\"delete_namespace\":\"Eliminar el namespace {{name}}\",\"invalid_namespace_name\":\"Los nombres de los namespaces se convierten en nombres de carpeta, así que solo pueden contener letras latinas minúsculas (a–z), dígitos (0–9), puntos, guiones y guiones bajos, deben empezar y terminar con una letra o un dígito y tener entre 2 y 64 caracteres.\",\"invalid_namespace_name_char\":\"“{{char}}” no se puede usar en el nombre de un namespace. Usa letras minúsculas a–z, 0–9, .\xA0-⁠\xA0_\",\"invalid_namespace_name_letter\":\"“{{char}}” ({{script}}, {{code}}) no se puede usar en el nombre de un namespace. Usa letras minúsculas a–z, 0–9, .\xA0-⁠\xA0_\",\"keep_it\":\"Conservarlo\",\"load_namespace_during_reviews\":\"Cargar el namespace {{name}} durante las revisiones\",\"loading\":\"Cargando…\",\"namespace_active\":\"Activo — se carga durante las revisiones (desmarca para desactivarlo)\",\"namespace_inactive\":\"Inactivo — marca para cargarlo durante las revisiones\",\"namespaces\":\"Namespaces\",\"new_namespace\":\"Nuevo namespace\",\"new_namespace_2\":\"new-namespace\",\"new_namespace_name\":\"Nombre del nuevo namespace\",\"pattern_many\":\"{{count}} patrones\",\"pattern_one\":\"{{count}} patrón\",\"pattern_other\":\"{{count}} patrones\",\"pending_count_many\":\"{{count}} pendientes\",\"pending_count_one\":\"{{count}} pendiente\",\"pending_count_other\":\"{{count}} pendientes\",\"read_namespace\":\"Leer el namespace {{name}}\"},\"leftRail\":{\"code_review_sage\":\"Code Review Sage\",\"learning\":\"Aprendizaje\",\"reviews\":\"Revisiones\",\"sections\":\"Secciones\",\"settings\":\"Ajustes\",\"version\":\"v{{version}}\"},\"listSkeleton\":{\"loading_reviews\":\"Cargando revisiones…\"},\"middleColumn\":{\"all_repos\":\"Todos los repos\",\"just_this_repo\":\"Solo {{repo}}\",\"lists_label\":\"Pull requests o revisiones\",\"no_reviews_for_repo\":\"No hay revisiones de {{repo}}\",\"no_reviews_yet\":\"Todavía no hay revisiones\",\"pick_a_repo_then_a_pr\":\"Elige un repo y luego un pull request.\",\"pull_requests\":\"Pull requests\",\"repo_lists_label\":\"{{repo}}: pull requests o revisiones\",\"repo_reviews_appear_here\":\"Las revisiones que inicies para este repo aparecen aquí.\",\"reviews\":\"Revisiones\",\"show_all_count\":\"Mostrar todas ({{count}})\",\"this_repo_only\":\"solo {{repo}}\"},\"postCommentsButton\":{\"cancel\":\"Cancelar\",\"confirm_post_many\":\"¿Publicar {{count}} comentarios en el pull request?\",\"confirm_post_one\":\"¿Publicar {{count}} comentario en el pull request?\",\"confirm_post_other\":\"¿Publicar {{count}} comentarios en el pull request?\",\"drafted_publish_on_pr_page_many\":\"Se redactaron {{count}} comentarios: abre aquí la solicitud para publicarlos\",\"drafted_publish_on_pr_page_one\":\"Se redactó {{count}} comentario: abre aquí la solicitud para publicarlo\",\"drafted_publish_on_pr_page_other\":\"Se redactaron {{count}} comentarios: abre aquí la solicitud para publicarlos\",\"post_action\":\"Publicar\",\"post_count_many\":\"Publicar {{count}} comentarios\",\"post_count_one\":\"Publicar {{count}} comentario\",\"post_count_other\":\"Publicar {{count}} comentarios\",\"post_failed\":\"Fallo al publicar\",\"posted_age\":\"Publicado {{age}}\",\"posted_comments_many\":\"Se publicaron {{count}} comentarios\",\"posted_comments_one\":\"Se publicó {{count}} comentario\",\"posted_comments_other\":\"Se publicaron {{count}} comentarios\",\"posting\":\"Publicando…\",\"publish_these_findings_as_a_review_on_the_pull_r\":\"Publicar estos hallazgos como una revisión en el pull request\"},\"prPickList\":{\"a_review_of_this_pull_request_is_running\":\"Ya se está ejecutando una revisión de este pull request\",\"add_a_repo\":\"Añadir un repo\",\"already_reviewed\":\"Ya revisado\",\"cancel\":\"Cancelar\",\"confirm_review_all\":\"¿Revisar las {{count}} pull requests?\",\"draft\":\"borrador\",\"filter_pull_requests\":\"Filtrar pull requests\",\"new\":\"nuevo\",\"no_open_prs_here\":\"Aquí no hay pull requests abiertos.\",\"no_prs_match_filter\":\"Ningún pull request coincide con tu filtro.\",\"one_or_more_github_pr_links\":\"Uno o más enlaces de PR de GitHub\",\"open_pr\":\"Abrir el pull request #{{number}}: {{title}}\",\"paste_pr_links\":\"Pegar enlaces de PR\",\"paste_pr_links_instead\":\"Pegar enlaces de PR en su lugar\",\"pick_a_repo_to_see_its_pull_requests\":\"Elige un repo para ver sus pull requests.\",\"pr_already_being_reviewed\":\"El pull request #{{number}} ya se está revisando\",\"re_read_open_prs_from_github\":\"Volver a leer los PR abiertos desde GitHub\",\"refresh_pull_requests\":\"Actualizar los pull requests\",\"repos_live_in_the_sidebar\":\"Los repos están en la barra lateral.\",\"review_all_count\":\"Revisar las {{count}}\",\"review_every_open_pr_not_yet_reviewed_at_its_cur\":\"Revisar todos los PR abiertos que aún no se han revisado en su head actual\",\"review_pr\":\"Revisar el pull request #{{number}}: {{title}}\",\"review_selected_count_many\":\"Revisar {{count}} seleccionados\",\"review_selected_count_one\":\"Revisar {{count}} seleccionado\",\"review_selected_count_other\":\"Revisar {{count}} seleccionados\",\"review_these\":\"Revisar estos\",\"reviewed\":\"revisado\",\"reviewed_age\":\"Revisado {{age}}\",\"reviewed_before_the_head_commit_has_moved_since\":\"Revisado antes — el commit head ha cambiado desde entonces\",\"reviewing\":\"revisando\",\"updated\":\"actualizado\"},\"prReviewDetail\":{\"author\":\"Autor\",\"cancelled_before_finishing\":\"Se canceló antes de que esta terminara.\",\"did_not_complete_for_this_change\":\"La revisión no se completó para este cambio.\",\"draft\":\"borrador\",\"findings_appear_here_as_soon_as_the_review_finis\":\"Los hallazgos aparecen aquí en cuanto termina la revisión. Puedes salir de la página — una notificación te avisará cuando llegue.\",\"head\":\"head\",\"loading_pull_request_details\":\"Cargando los detalles del pull request…\",\"loading_review\":\"Cargando la revisión…\",\"nothing_flagged_on_this_pull_request\":\"No se marcó nada en este pull request.\",\"open_on_github\":\"Abrir en GitHub\",\"pull_request\":\"Pull request\",\"pull_request_detail\":\"Detalle del pull request\",\"retry_review\":\"Reintentar la revisión\",\"review\":\"Revisar\",\"review_again\":\"Revisar otra vez\",\"review_again_at_current_head\":\"Revisar este pull request otra vez en su head actual\",\"review_already_running\":\"Ya se está ejecutando una revisión de este pull request\",\"review_completed_with_no_findings\":\"La revisión terminó y no arrojó hallazgos que merezcan tu tiempo.\",\"review_this_pull_request\":\"Revisar este pull request\",\"reviewing\":\"Revisando…\",\"running\":\"en ejecución\",\"sage_review\":\"Revisión de Sage\",\"see_the_reason_above\":\"Mira el motivo más arriba.\",\"start_a_review_and_its_findings_appear_here_you\":\"Inicia una revisión y sus hallazgos aparecerán aquí — puedes salir de la página, una notificación te avisará cuando llegue.\",\"that_review_produced_no_report_for_this_pull_req\":\"Esa revisión no generó ningún informe para este pull request.\",\"this_pull_request_has_not_been_reviewed_yet\":\"Este pull request aún no se ha revisado.\",\"updated\":\"actualizado\"},\"prSourcePanel\":{\"load_failed\":\"No se pudieron cargar los detalles del pull request: {{reason}}\",\"partial_sections\":\"Algunas secciones están incompletas ({{sections}}) — la petición al proveedor falló o alcanzó un límite de página.\"},\"prStatusChips\":{\"all_checks_passed_many\":\"las {{count}} comprobaciones pasaron\",\"all_checks_passed_one\":\"{{count}} comprobación pasó\",\"all_checks_passed_other\":\"las {{count}} comprobaciones pasaron\",\"checks_failing_many\":\"{{failed}} de {{count}} comprobaciones fallando\",\"checks_failing_one\":\"{{failed}} de {{count}} comprobación fallando\",\"checks_failing_other\":\"{{failed}} de {{count}} comprobaciones fallando\",\"checks_running_many\":\"{{pending}} de {{count}} comprobaciones aún en ejecución\",\"checks_running_one\":\"{{pending}} de {{count}} comprobación aún en ejecución\",\"checks_running_other\":\"{{pending}} de {{count}} comprobaciones aún en ejecución\",\"closed\":\"cerrado\",\"conflicts\":\"conflictos\",\"failing_count_many\":\"{{count}} fallan\",\"failing_count_one\":\"{{count}} falla\",\"failing_count_other\":\"{{count}} fallan\",\"merge_blocked\":\"merge bloqueado\",\"merged\":\"merged\",\"open\":\"abierto\",\"passed_count_many\":\"{{count}} pasaron\",\"passed_count_one\":\"{{count}} pasó\",\"passed_count_other\":\"{{count}} pasaron\",\"running_count_many\":\"{{count}} en ejecución\",\"running_count_one\":\"{{count}} en ejecución\",\"running_count_other\":\"{{count}} en ejecución\"},\"repoSwitcher\":{\"add_a_repo\":\"Añadir un repo\",\"all_repos\":\"Todos los repos\",\"filter_repos\":\"Filtrar repos\",\"filter_repositories\":\"Filtrar repositorios\",\"loading\":\"Cargando…\",\"no_repo_matches_that\":\"Ningún repo coincide con eso.\",\"no_repos_yet_add_one_to_pick_from_the_repos_you\":\"Todavía no hay repos — añade uno para elegir entre los repos en los que trabajas.\",\"pick_a_repo\":\"Elige un repo\",\"pick_a_repository\":\"Elige un repositorio\",\"recent\":\"Recientes\",\"repositories\":\"Repositorios\",\"repository_named\":\"Repositorio: {{name}}\"},\"reportView\":{\"blast_radius\":\"Alcance del impacto: {{scope}}\",\"blocking_count_many\":\"{{count}} bloqueantes\",\"blocking_count_one\":\"{{count}} bloqueante\",\"blocking_count_other\":\"{{count}} bloqueantes\",\"changes_reviewed_many\":\"{{count}} cambios revisados\",\"changes_reviewed_one\":\"{{count}} cambio revisado\",\"changes_reviewed_other\":\"{{count}} cambios revisados\",\"clear\":\"Limpiar\",\"design_gate\":\"Puerta de diseño ·\",\"design_risk\":\"Riesgo de diseño: {{level}}\",\"draft_selected_many\":\"Redactar {{count}} hallazgos seleccionados\",\"draft_selected_one\":\"Redactar {{count}} hallazgo seleccionado\",\"draft_selected_other\":\"Redactar {{count}} hallazgos seleccionados\",\"finding_dimension_in_file\":\"{{dimension}} en {{file}}\",\"generated\":\"· generado\",\"moved_to\":\"Ahora en {{band}}. Se mantiene en su sitio hasta que cambies el filtro.\",\"no_changes_in_this_band\":\"No hay cambios en esta categoría.\",\"nothing_flagged_in_this_review\":\"No se marcó nada en esta revisión.\",\"open_shared_copy\":\"Abrir la copia compartida\",\"open_the_pull_request\":\"Abrir el pull request\",\"share\":\"Compartir\",\"sharing\":\"Compartiendo…\",\"should_fix_count_many\":\"{{count}} deberían corregirse\",\"should_fix_count_one\":\"{{count}} debería corregirse\",\"should_fix_count_other\":\"{{count}} deberían corregirse\",\"step_problem\":\"Problema\",\"step_solution_fit\":\"Idoneidad de la solución\",\"step_why_it_matters\":\"Por qué importa\"},\"reviewChat\":{\"continue_hint\":\"La conversación con este revisor continúa en la pestaña de chat.\",\"continue_session\":\"Continuar la sesión de seguimiento\",\"earlier_questions\":\"Preguntas anteriores\",\"error_generic\":\"No se pudo abrir la sesión de seguimiento. Inténtalo de nuevo.\",\"error_run_deleted\":\"Esta revisión se eliminó, así que la conversación terminó.\",\"loading\":\"Cargando…\",\"new_session_unavailable\":\"Esta app todavía no puede abrir una nueva sesión de seguimiento: hace falta un Kiro Crew que permita a una app abrir una sesión de chat con nombre. Una sesión de seguimiento que ya abriste se puede seguir usando.\",\"not_recorded_notice\":\"Esta revisión no conservó una sesión del revisor, así que no hay nada que reabrir. Revisa esta pull request de nuevo para preguntar.\",\"open_session\":\"Abrir una sesión de seguimiento\",\"opening\":\"Abriendo…\",\"ran_tools\":\"Revisó: {{tools}}\",\"reasoning\":\"Razonamiento\",\"refused_notice\":\"Necesitaba ejecutar una herramienta para responder por completo y no se le permitió, así que esta respuesta es limitada. Activa YOLO para permitirlo.\",\"resume_hint\":\"Abre un chat que reanuda al revisor, por lo que conserva el razonamiento detrás de sus hallazgos.\",\"role_reviewer\":\"Revisor\",\"role_you\":\"Tú\",\"run_live_notice\":\"Esta revisión sigue en curso. Sus hallazgos pueden cambiar hasta que termine, así que aún no hay nada que preguntar.\",\"title\":\"Preguntar al revisor\",\"transcript_gone_notice\":\"La sesión del revisor ya no está en el disco, así que no hay nada que reabrir. Revisa esta pull request de nuevo para preguntar.\"},\"reviewQueue\":{\"empty\":\"Ningún pull request espera tu revisión.\",\"filter_by_repo\":\"Filtrar por repositorio o título\",\"setup_required\":\"Configura la CLI de GitHub para ver las solicitudes de revisión\",\"starts_review\":\"Cada selección ejecuta una revisión de Sage. Los resultados aparecen en Revisiones y no se publican en GitHub salvo que tú lo decidas.\",\"starts_review_truncated\":\"Solo se muestran las 100 solicitudes más recientes. Cada selección ejecuta una revisión de Sage. Los resultados aparecen en Revisiones y no se publican en GitHub salvo que tú lo decidas.\",\"tab\":\"Solicitudes\"},\"runCard\":{\"cancel\":\"Cancelar\",\"clean\":\"Limpio\",\"delete\":\"Eliminar\",\"delete_review_of\":\"Eliminar la revisión de {{label}}\",\"delete_this_review\":\"Eliminar esta revisión\",\"delete_this_review_2\":\"¿Eliminar esta revisión?\",\"more_count_many\":\"+{{count}} más\",\"more_count_one\":\"+{{count}} más\",\"more_count_other\":\"+{{count}} más\",\"needs_review_count_many\":\"{{count}} necesitan revisión\",\"needs_review_count_one\":\"{{count}} necesita revisión\",\"needs_review_count_other\":\"{{count}} necesitan revisión\",\"pull_requests\":\"pull requests\",\"review\":\"Revisión\",\"review_of\":\"Revisión de {{label}}\",\"review_of_with_more_many\":\"Revisión de {{label}} y {{count}} más\",\"review_of_with_more_one\":\"Revisión de {{label}} y {{count}} más\",\"review_of_with_more_other\":\"Revisión de {{label}} y {{count}} más\",\"worth_a_glance_count_many\":\"{{count}} merecen un vistazo\",\"worth_a_glance_count_one\":\"{{count}} merece un vistazo\",\"worth_a_glance_count_other\":\"{{count}} merecen un vistazo\"},\"runDetail\":{\"cancelled_before_any_finished\":\"Se canceló antes de que ningún pull request terminara.\",\"finished\":\"terminada\",\"loading_report\":\"Cargando el informe…\",\"more_count_many\":\"+{{count}} más\",\"more_count_one\":\"+{{count}} más\",\"more_count_other\":\"+{{count}} más\",\"nothing_to_report\":\"Ningún pull request completó una revisión, así que no hubo nada que informar.\",\"pull_request_many\":\"{{count}} pull requests\",\"pull_request_one\":\"{{count}} pull request\",\"pull_request_other\":\"{{count}} pull requests\",\"report_appears_when_the_review_finishes\":\"El informe aparece aquí en cuanto termina la revisión.\",\"skipped_inflight_many\":\"Se omitieron {{count}} pull requests porque otra revisión ya los tenía.\",\"skipped_inflight_one\":\"Se omitió {{count}} pull request porque otra revisión ya lo tenía.\",\"skipped_inflight_other\":\"Se omitieron {{count}} pull requests porque otra revisión ya los tenía.\",\"started\":\"iniciada\",\"this_review_produced_no_report\":\"Esta revisión no generó ningún informe.\",\"you_can_leave_this_page_a_notification_will_tell\":\"Puedes salir de esta página — una notificación te avisará cuando llegue.\"},\"runList\":{\"new_review\":\"Nueva revisión\"},\"runProgress\":{\"cancel_review\":\"Cancelar la revisión\",\"cancelled_count_many\":\"{{count}} canceladas\",\"cancelled_count_one\":\"{{count}} cancelada\",\"cancelled_count_other\":\"{{count}} canceladas\",\"cancelling\":\"Cancelando…\",\"elapsed_time\":\"Tiempo transcurrido\",\"failed_count_many\":\"{{count}} fallidas\",\"failed_count_one\":\"{{count}} fallida\",\"failed_count_other\":\"{{count}} fallidas\",\"median_of_past_runs_of_this_size\":\"Mediana de ejecuciones anteriores de este tamaño\",\"review_progress\":\"Progreso de la revisión\",\"reviewed_of_many\":\"{{done}} / {{count}} revisadas\",\"reviewed_of_one\":\"{{done}} / {{count}} revisada\",\"reviewed_of_other\":\"{{done}} / {{count}} revisadas\",\"reviewers_busy\":\"{{busy}} de {{max}} revisores ocupados\",\"step\":\"· paso\",\"stops_queued_prs_one_already_being_reviewed_will\":\"Detiene los PR en cola; el que ya se está revisando terminará.\",\"usually\":\"normalmente ~\",\"working\":\"Trabajando\"},\"runStatusPill\":{\"cancelled\":\"Cancelado\",\"cancelling\":\"Cancelando\",\"done\":\"Listo\",\"error\":\"Error\",\"interrupted\":\"Interrumpido\",\"running\":\"En curso\"},\"shipSummaryCard\":{\"post_the_ship_readiness_summary\":\"Publicar el resumen de preparación para publicar\",\"post_this_comment\":\"Publicar este comentario\",\"posted_as_a_top_level_comment\":\"publicado como comentario de nivel superior\",\"posted_to_the_pull_request\":\"Publicado en el pull request\",\"posting\":\"Publicando…\",\"select_the_ship_readiness_summary_to_post\":\"Seleccionar el resumen de preparación para publicarlo\",\"ship_readiness_summary\":\"Resumen de preparación para publicar\"}},\"lib\":{\"format\":{\"cause_no_agent_cli\":\"El revisor nunca se inició — no se encontró ningún ejecutable de kiro-cli en este host. Instálalo, o añádelo a PATH.\",\"cause_no_record\":\"El revisor terminó pero no registró ningún hallazgo.\",\"cause_record_incomplete\":\"El revisor escribió un registro de hallazgos pero se detuvo antes de completar la revisión.\",\"cause_runtime_died\":\"El proceso del revisor se detuvo a mitad de la revisión — normalmente porque el gateway se reinició. El pull request no tenía nada mal.\",\"cause_runtime_not_importable\":\"El revisor nunca se inició — esta instalación no puede cargar el runtime de agente que necesita. Repara la instalación para restaurarlo.\",\"cause_runtime_unavailable\":\"El revisor nunca se inició — su runtime de agente no está disponible en este host.\",\"cause_timeout\":\"La revisión superó su límite de tiempo.\",\"cause_turn_failed\":\"El turno de revisión falló antes de registrar nada.\",\"cause_unknown\":\"La revisión no se completó.\",\"days_ago_many\":\"hace {{count}} d\",\"days_ago_one\":\"hace {{count}} d\",\"days_ago_other\":\"hace {{count}} d\",\"hours_ago_many\":\"hace {{count}} h\",\"hours_ago_one\":\"hace {{count}} h\",\"hours_ago_other\":\"hace {{count}} h\",\"just_now\":\"ahora mismo\",\"minutes_ago_many\":\"hace {{count}} min\",\"minutes_ago_one\":\"hace {{count}} min\",\"minutes_ago_other\":\"hace {{count}} min\",\"phase_cancelled\":\"Cancelada\",\"phase_done\":\"Hecha\",\"phase_failed\":\"Fallida\",\"phase_pending\":\"Pendiente\",\"phase_queued\":\"En cola\",\"phase_reviewing\":\"Revisando\"}},\"manifest\":{\"configuration_1\":\"Instala y autentica la CLI gh en el host del gateway, añade un repositorio y elige en Ajustes el modelo de revisión, el nivel de razonamiento y la concurrencia.\",\"description\":\"Revisa a fondo las pull requests de GitHub y te dice qué cambios merecen de verdad tu atención. Cada pull request se revisa en su propia sesión de agente aislada que cubre todos los archivos modificados, ponderada por el alcance del impacto que tiene, y todo se resume en un informe de enfoque priorizado. Los hallazgos se leen en la app y solo se preparan como una revisión de GitHub en borrador cuando los publicas o activas la publicación automática, y el revisor sigue aprendiendo los estándares reales de tu repositorio a partir de correcciones ya integradas y comentarios de revisiones anteriores.\",\"display_name\":\"Code Review Sage\",\"highlight_1\":\"El informe de enfoque ordena los cambios por alcance del impacto, así los archivos riesgosos se leen primero\",\"highlight_2\":\"Una sesión de agente aislada por pull request, así los hallazgos nunca se filtran entre revisiones\",\"highlight_3\":\"Las revisiones se leen en la aplicación: no se publica nada en tu pull request a menos que lo pidas\",\"highlight_4\":\"Aprende por repositorio a partir de correcciones ya integradas, comentarios de revisión y discusiones de diseño\",\"highlight_5\":\"Revisa pull requests de GitHub; necesita una CLI `gh` autenticada en el host del gateway\",\"page_label\":\"Code Review Sage\",\"use_case_1\":\"Revisa una o varias pull requests de GitHub según su riesgo, inspecciona hallazgos concretos y prepara solo los comentarios que merezca la pena publicar.\"},\"views\":{\"learningView\":{\"cancel\":\"Cancelar\",\"confirm_merge_many\":\"¿Fusionar {{count}} aprendizajes en el conjunto de reglas?\",\"confirm_merge_one\":\"¿Fusionar {{count}} aprendizaje en el conjunto de reglas?\",\"confirm_merge_other\":\"¿Fusionar {{count}} aprendizajes en el conjunto de reglas?\",\"consolidate\":\"Consolidar\",\"consolidate_pending_many\":\"Consolidar {{count}} aprendizajes pendientes en {{namespace}}\",\"consolidate_pending_one\":\"Consolidar {{count}} aprendizaje pendiente en {{namespace}}\",\"consolidate_pending_other\":\"Consolidar {{count}} aprendizajes pendientes en {{namespace}}\",\"consolidating\":\"Consolidando…\",\"learning\":\"Aprendizaje\",\"loaded_during_reviews\":\"cargado durante las revisiones\",\"loading_learnings\":\"Cargando aprendizajes…\",\"merge_failed_ruleset_unchanged\":\"La fusión falló — el conjunto de reglas no cambió\",\"not_loaded\":\"no cargado\",\"nothing_consolidated_yet_reviews_in_this_namespa\":\"Todavía no se ha consolidado nada — las revisiones en este namespace no cargan ningún patrón aprendido por ahora.\",\"nothing_staged_new_learnings_land_here_when_a_re\":\"No hay nada preparado. Los nuevos aprendizajes llegan aquí cuando una revisión analiza una corrección publicada o un comentario de revisión atendido.\",\"pattern_many\":\"{{count}} patrones\",\"pattern_one\":\"{{count}} patrón\",\"pattern_other\":\"{{count}} patrones\",\"pending_consolidation\":\"Consolidación pendiente ·\",\"pick_a_namespace_in_the_sidebar_to_read_the_patt\":\"Elige un namespace en la barra lateral para leer los patrones que las revisiones cargan de él.\",\"reviews_read_the_consolidated_ruleset_below_neve\":\"Las revisiones leen el conjunto de reglas consolidado de abajo, nunca los candidatos pendientes. Consolidar fusiona en él lo que está preparado — una fusión con IA de una sola vez que tú activas, así que nada cambia lo que ven las revisiones hasta que la ejecutes.\",\"ruleset\":\"Conjunto de reglas ·\"},\"settingsView\":{\"default_agent_config\":\"Predeterminado (configuración del agente)\",\"default_model_provider\":\"Predeterminado (modelo / proveedor)\",\"higher_effort_finds_more_costs_more_and_takes_lo\":\"Más esfuerzo encuentra más, cuesta más y tarda más por pull request. Con el valor predeterminado decide el modelo o el proveedor.\",\"how_many_pull_requests_are_reviewed_in_parallel\":\"Cuántos pull requests se revisan en paralelo en el runtime de workers compartido. Este es el límite real del rendimiento de las revisiones — pueden estar abiertos varios hilos de revisión a la vez, pero todos consumen de este presupuesto.\",\"loading_settings\":\"Cargando los ajustes…\",\"model\":\"Modelo\",\"reasoning_effort\":\"Esfuerzo de razonamiento\",\"review_model\":\"Modelo de revisión\",\"reviews_at_once\":\"Revisiones a la vez\",\"settings\":\"Ajustes\",\"these_apply_to_every_review_started_from_here\":\"Esto se aplica a todas las revisiones que se inicien desde aquí.\",\"which_model_performs_the_review_default_inherits\":\"Qué modelo realiza la revisión. El valor predeterminado hereda la configuración del agente, así que cambiar tu modelo predeterminado también cambia esto.\"}},\"workspace\":{\"drag_to_resize\":\"Arrastra para cambiar el tamaño\",\"resize_sidebar\":\"Cambiar el tamaño de la barra lateral\",\"select_a_review_to_see_its_progress_and_report\":\"Elige una revisión para ver su progreso y su informe.\",\"start_a_new_one_several_can_run_at_once\":\"Inicia una nueva — pueden ejecutarse varias a la vez.\"}},\"issueRadar\":{\"components\":{\"prDetail\":{\"labels\":\"Etiquetas\"}}}}"),
		components: { "resizeHandle": { "drag_to_resize": "Arrastra para redimensionar" } },
		lib: { "scriptLabel": {
			"cyrillic": "letra cirílica",
			"greek": "letra griega",
			"latin": "letra latina",
			"other": "carácter"
		} }
	},
	fr: {
		app: {
			"collapse_sidebar": "Réduire la barre latérale",
			"expand_sidebar": "Développer la barre latérale"
		},
		apps: /* @__PURE__ */ JSON.parse("{\"codeReviewSage\":{\"codeReviewSagePage\":{\"open_pr_many\":\"{{count}} PR ouvertes\",\"open_pr_one\":\"{{count}} PR ouverte\",\"open_pr_other\":\"{{count}} PR ouvertes\",\"pattern_many\":\"{{count}} motifs\",\"pattern_one\":\"{{count}} motif\",\"pattern_other\":\"{{count}} motifs\"},\"components\":{\"addReposModal\":{\"add\":\"Ajouter\",\"add_one_by_url_above\":\"Ajoutes-en un par URL ci-dessus.\",\"add_repo\":\"Ajouter {{repo}}\",\"add_repos\":\"Ajouter des repos\",\"added\":\"ajouté\",\"all_your_repos\":\"Tous tes repos\",\"already_added\":\"{{repo}} est déjà ajouté\",\"archived\":\"archivé\",\"based_on_recent_github_activity\":\"D’après ton activité GitHub récente\",\"close\":\"Fermer\",\"close_add_repos_dialog\":\"Fermer la boîte de dialogue d’ajout de repos\",\"contributed_events_many\":\"{{age}} · {{count}} événements\",\"contributed_events_one\":\"{{age}} · {{count}} événement\",\"contributed_events_other\":\"{{age}} · {{count}} événements\",\"filter_your_repos\":\"Filtre tes repos\",\"gh_auth_login\":\"gh auth login\",\"github_cli_not_ready\":\"GitHub CLI n’est pas prêt\",\"newest_100_by_push_date\":\"les 100 plus récents par date de push\",\"no_repos_for_account\":\"Aucun repo trouvé pour ton compte.\",\"no_repos_match_filter\":\"Aucun repo ne correspond à ton filtre.\",\"owner_repo_a_repo_url_or_paste_a_pull_request_li\":\"owner/repo, une URL de repo, ou colle un lien de pull request\",\"pick_from_the_repos_you_can_reach_or_type_one_in\":\"Choisis parmi les repos que tu peux atteindre, ou saisis-en un. Les repos ajoutés apparaissent dans la barre latérale pour que tu puisses y lancer une revue. Colle un lien de pull request et cette pull request s’ouvre directement.\",\"pinned_to_the_sidebar\":\"épinglé à la barre latérale\",\"private\":\"Privé\",\"pushed_age\":\"poussé {{age}}\",\"re_read_your_repos_from_github\":\"Relire tes repos depuis GitHub\",\"read_only\":\"lecture seule\",\"read_only_access\":\"Accès en lecture seule\",\"reading_your_repos_from_github\":\"Lecture de tes repos depuis GitHub…\",\"recently_worked_on\":\"Travaillés récemment\",\"refresh_your_repos\":\"Actualiser tes repos\",\"remove\":\"Retirer\",\"remove_repo\":\"Retirer {{repo}}\",\"repository_or_pull_request_url_or_owner_repo\":\"URL de dépôt ou de pull request, ou owner/repo\",\"setup_hint\":\"Installe GitHub CLI et connecte-toi avec la commande ci-dessous pour lister tes repos. Tu peux toujours ajouter n’importe quel repo par URL ci-dessus.\",\"these_lists_are_capped_so_a_repo_you_have_not_to\":\"Ces listes sont plafonnées, donc un repo que tu n’as pas touché récemment peut manquer. Ajoute-le par URL ci-dessus si tu ne le vois pas.\",\"your_repos\":\"Tes repos\"},\"bandChips\":{\"all\":\"Toutes\",\"clean\":\"Sans problème\",\"filter_by_band\":\"Filtrer par catégorie\",\"needs_review\":\"À examiner\",\"worth_a_glance\":\"Coup d’œil utile\"},\"draftReviewActions\":{\"approve\":\"Approuver\",\"approve_is_unavailable_because_this_base_branch_\":\"Approuver est indisponible car la branche de base de cette pull request ne retire pas les approbations lorsque de nouveaux commits sont poussés (ou sa protection n’est pas lisible ici). Sans cela, une approbation pourrait survivre au commit qu’elle a relu. Approuvez sur GitHub.\",\"approve_is_unavailable_while_auto_merge_is_armed\":\"Approuver est indisponible tant que la fusion automatique est armée : une approbation pourrait fusionner cette pull request avant qu’une vérification du head puisse la retirer. Désarmez la fusion automatique, ou approuvez sur GitHub.\",\"ask_agent_about_this_failure\":\"Interroger l'agent sur cet échec\",\"cancel\":\"Annuler\",\"confirm_approve\":\"Approuver cette pull request ?\",\"confirm_request_changes\":\"Publier cette revue en demandant des modifications ?\",\"confirm_submit_as_comment\":\"Soumettre cette revue en tant que commentaire ?\",\"couldn_t_check_for_a_draft_review_on_this_pull_r\":\"Impossible de vérifier la présence d'une revue brouillon sur cette pull request. Il s'agit généralement d'un problème d'authentification de la CLI GitHub, pas d'un brouillon manquant.\",\"draft_review\":\"Revue en brouillon\",\"no_draft_review_on_this_pull_request\":\"Aucune revue en brouillon sur cette pull request.\",\"pending_only_you_can_see_it_until_you_publish\":\"En attente – vous seul pouvez la voir jusqu'à sa publication.\",\"publish_failed\":\"Impossible de publier la revue\",\"published_as\":\"Publiée en tant que\",\"published_verdict_approved\":\"approuvée\",\"published_verdict_changes_requested\":\"modifications demandées\",\"published_verdict_comment\":\"un commentaire\",\"publishing\":\"Publication…\",\"publishing_is_blocked_a_later_review_replaced_th\":\"Publication bloquée : une revue ultérieure a remplacé ce brouillon sur la pull request, il ne contient donc plus les constats de cette revue. Ouvrez la revue la plus récente pour la publier.\",\"publishing_is_blocked_this_draft_contains_conten\":\"La publication est bloquée : ce brouillon contient du contenu à masquer, et l’envoyer publierait le texte d’origine. Modifiez ou supprimez le brouillon sur GitHub.\",\"publishing_is_blocked_this_draft_was_written_aga\":\"La publication est bloquée : ce brouillon a été écrit sur un commit antérieur et la pull request a évolué depuis. Relisez d’abord le head actuel.\",\"publishing_is_blocked_this_review_is_still_runni\":\"La publication est bloquée : cette revue est toujours en cours, le brouillon de cette pull request provient donc d'une exécution précédente.\",\"publishing_is_irreversible_and_visible_to_everyo\":\"La publication est irréversible et visible par tous sur la pull request.\",\"request_changes\":\"Demander des modifications\",\"submit_as_comment\":\"Envoyer comme commentaire\",\"this_draft_has_no_summary_body\":\"Ce brouillon n’a pas de texte de synthèse.\",\"try_again\":\"Réessayer\"},\"failureNotice\":{\"run_it_again\":\"Relancer\",\"starting\":\"Démarrage…\",\"this_review_failed\":\"Cette revue a échoué\"},\"findingCard\":{\"cancel_dismiss\":\"Annuler\",\"confirm_dismiss\":\"Écarter le constat\",\"consequence\":\"Conséquence\",\"dismiss\":\"Écarter\",\"dismiss_failed\":\"Impossible d’enregistrer le rejet. Réessaie.\",\"dismiss_reason_label\":\"Pourquoi écarter ce constat ?\",\"dismiss_reason_placeholder\":\"Par exemple : faux positif, hors périmètre\",\"dismissed_reason\":\"Écarté : {{reason}}\",\"evidence\":\"Preuve\",\"observation\":\"Observation\",\"post_finding\":\"Publier ce constat sur la pull request\",\"post_finding_on\":\"Publier ce constat sur {{target}}\",\"post_this_comment\":\"Publier ce commentaire\",\"posted_to_the_pull_request\":\"Publié sur la pull request\",\"posting\":\"Publication…\",\"select_to_draft_together\":\"Sélectionner pour le brouillon groupé\",\"select_to_post\":\"Sélectionner {{label}} pour publier\",\"severity_must_fix\":\"Obligatoire\",\"severity_should_fix\":\"Recommandé\",\"suggestion\":\"Suggestion\",\"this_finding\":\"ce constat\",\"undo_dismiss\":\"Annuler le rejet\",\"undo_dismiss_failed\":\"Impossible d’annuler. Le constat reste rejeté.\"},\"learningRail\":{\"add_namespace\":\"Ajouter un namespace\",\"confirm_delete\":\"Supprimer « {{name}} » et tous ses acquis ? C’est irréversible.\",\"delete_2\":\"Supprimer\",\"delete_namespace\":\"Supprimer le namespace {{name}}\",\"invalid_namespace_name\":\"Les noms de namespace servent de noms de dossier. Ils ne peuvent donc contenir que des lettres latines minuscules (a–z), des chiffres (0–9), des points, des traits d’union et des tirets bas, doivent commencer et finir par une lettre ou un chiffre et comporter de 2 à 64 caractères.\",\"invalid_namespace_name_char\":\"« {{char}} » ne peut pas être utilisé dans un nom de namespace. Utilise des minuscules a–z, 0–9, .\xA0-⁠\xA0_\",\"invalid_namespace_name_letter\":\"« {{char}} » ({{script}}, {{code}}) ne peut pas être utilisé dans un nom de namespace. Utilise des minuscules a–z, 0–9, .\xA0-⁠\xA0_\",\"keep_it\":\"Le garder\",\"load_namespace_during_reviews\":\"Charger le namespace {{name}} pendant les revues\",\"loading\":\"Chargement…\",\"namespace_active\":\"Actif — chargé pendant les revues (décoche pour désactiver)\",\"namespace_inactive\":\"Inactif — coche pour charger pendant les revues\",\"namespaces\":\"Namespaces\",\"new_namespace\":\"Nouveau namespace\",\"new_namespace_2\":\"new-namespace\",\"new_namespace_name\":\"Nom du nouveau namespace\",\"pattern_many\":\"{{count}} motifs\",\"pattern_one\":\"{{count}} motif\",\"pattern_other\":\"{{count}} motifs\",\"pending_count_many\":\"{{count}} en attente\",\"pending_count_one\":\"{{count}} en attente\",\"pending_count_other\":\"{{count}} en attente\",\"read_namespace\":\"Lire le namespace {{name}}\"},\"leftRail\":{\"code_review_sage\":\"Code Review Sage\",\"learning\":\"Apprentissage\",\"reviews\":\"Revues\",\"sections\":\"Sections\",\"settings\":\"Réglages\",\"version\":\"v{{version}}\"},\"listSkeleton\":{\"loading_reviews\":\"Chargement des revues…\"},\"middleColumn\":{\"all_repos\":\"Tous les repos\",\"just_this_repo\":\"Seulement {{repo}}\",\"lists_label\":\"Pull requests ou revues\",\"no_reviews_for_repo\":\"Aucune revue pour {{repo}}\",\"no_reviews_yet\":\"Pas encore de revues\",\"pick_a_repo_then_a_pr\":\"Choisis un repo, puis une pull request.\",\"pull_requests\":\"Pull requests\",\"repo_lists_label\":\"{{repo}} : pull requests ou revues\",\"repo_reviews_appear_here\":\"Les revues que tu lances pour ce repo apparaissent ici.\",\"reviews\":\"Revues\",\"show_all_count\":\"Tout afficher ({{count}})\",\"this_repo_only\":\"{{repo}} seulement\"},\"postCommentsButton\":{\"cancel\":\"Annuler\",\"confirm_post_many\":\"Publier {{count}} commentaires sur la pull request ?\",\"confirm_post_one\":\"Publier {{count}} commentaire sur la pull request ?\",\"confirm_post_other\":\"Publier {{count}} commentaires sur la pull request ?\",\"drafted_publish_on_pr_page_many\":\"{{count}} commentaires rédigés — ouvrez ici la pull request pour publier\",\"drafted_publish_on_pr_page_one\":\"{{count}} commentaire rédigé — ouvrez ici la pull request pour publier\",\"drafted_publish_on_pr_page_other\":\"{{count}} commentaires rédigés — ouvrez ici la pull request pour publier\",\"post_action\":\"Publier\",\"post_count_many\":\"Publier {{count}} commentaires\",\"post_count_one\":\"Publier {{count}} commentaire\",\"post_count_other\":\"Publier {{count}} commentaires\",\"post_failed\":\"Échec de la publication\",\"posted_age\":\"Publié {{age}}\",\"posted_comments_many\":\"{{count}} commentaires publiés\",\"posted_comments_one\":\"{{count}} commentaire publié\",\"posted_comments_other\":\"{{count}} commentaires publiés\",\"posting\":\"Publication…\",\"publish_these_findings_as_a_review_on_the_pull_r\":\"Publier ces constats comme une revue sur la pull request\"},\"prPickList\":{\"a_review_of_this_pull_request_is_running\":\"Une revue de cette pull request est en cours\",\"add_a_repo\":\"Ajouter un repo\",\"already_reviewed\":\"Déjà revue\",\"cancel\":\"Annuler\",\"confirm_review_all\":\"Examiner les {{count}} pull requests ?\",\"draft\":\"brouillon\",\"filter_pull_requests\":\"Filtrer les pull requests\",\"new\":\"nouveau\",\"no_open_prs_here\":\"Aucune pull request ouverte ici.\",\"no_prs_match_filter\":\"Aucune pull request ne correspond à ton filtre.\",\"one_or_more_github_pr_links\":\"Un ou plusieurs liens de PR GitHub\",\"open_pr\":\"Ouvrir la pull request #{{number}} : {{title}}\",\"paste_pr_links\":\"Coller des liens de PR\",\"paste_pr_links_instead\":\"Coller plutôt des liens de PR\",\"pick_a_repo_to_see_its_pull_requests\":\"Choisis un repo pour voir ses pull requests.\",\"pr_already_being_reviewed\":\"La pull request #{{number}} est déjà en cours de revue\",\"re_read_open_prs_from_github\":\"Relire les PR ouvertes depuis GitHub\",\"refresh_pull_requests\":\"Actualiser les pull requests\",\"repos_live_in_the_sidebar\":\"Les repos se trouvent dans la barre latérale.\",\"review_all_count\":\"Examiner les {{count}}\",\"review_every_open_pr_not_yet_reviewed_at_its_cur\":\"Revoir chaque PR ouverte qui ne l’a pas encore été sur son head actuel\",\"review_pr\":\"Revoir la pull request #{{number}} : {{title}}\",\"review_selected_count_many\":\"Examiner {{count}} sélectionnés\",\"review_selected_count_one\":\"Examiner {{count}} sélectionné\",\"review_selected_count_other\":\"Examiner {{count}} sélectionnés\",\"review_these\":\"Revoir celles-ci\",\"reviewed\":\"revue\",\"reviewed_age\":\"Revue {{age}}\",\"reviewed_before_the_head_commit_has_moved_since\":\"Déjà revue — le commit head a bougé depuis\",\"reviewing\":\"en cours de revue\",\"updated\":\"mise à jour\"},\"prReviewDetail\":{\"author\":\"Auteur\",\"cancelled_before_finishing\":\"Elle a été annulée avant que celle-ci se termine.\",\"did_not_complete_for_this_change\":\"La revue ne s’est pas terminée pour ce changement.\",\"draft\":\"brouillon\",\"findings_appear_here_as_soon_as_the_review_finis\":\"Les constats apparaissent ici dès que la revue se termine. Tu peux quitter la page — une notification te dira quand elle arrive.\",\"head\":\"head\",\"loading_pull_request_details\":\"Chargement des détails de la pull request…\",\"loading_review\":\"Chargement de la revue…\",\"nothing_flagged_on_this_pull_request\":\"Rien n’a été signalé sur cette pull request.\",\"open_on_github\":\"Ouvrir sur GitHub\",\"pull_request\":\"Pull request\",\"pull_request_detail\":\"Détail de la pull request\",\"retry_review\":\"Relancer la revue\",\"review\":\"Revoir\",\"review_again\":\"Revoir à nouveau\",\"review_again_at_current_head\":\"Revoir cette pull request sur son head actuel\",\"review_already_running\":\"Une revue de cette pull request est déjà en cours\",\"review_completed_with_no_findings\":\"La revue s’est terminée et n’a produit aucun constat qui mérite ton temps.\",\"review_this_pull_request\":\"Revoir cette pull request\",\"reviewing\":\"Revue en cours…\",\"running\":\"en cours\",\"sage_review\":\"Revue Sage\",\"see_the_reason_above\":\"Vois la raison ci-dessus.\",\"start_a_review_and_its_findings_appear_here_you\":\"Lance une revue et ses constats apparaîtront ici — tu peux quitter la page, une notification te dira quand elle arrive.\",\"that_review_produced_no_report_for_this_pull_req\":\"Cette revue n’a produit aucun rapport pour cette pull request.\",\"this_pull_request_has_not_been_reviewed_yet\":\"Cette pull request n’a pas encore été revue.\",\"updated\":\"mise à jour\"},\"prSourcePanel\":{\"load_failed\":\"Impossible de charger les détails de la pull request : {{reason}}\",\"partial_sections\":\"Certaines sections sont incomplètes ({{sections}}) — la requête au fournisseur a échoué ou atteint une limite de page.\"},\"prStatusChips\":{\"all_checks_passed_many\":\"les {{count}} vérifications ont réussi\",\"all_checks_passed_one\":\"{{count}} vérification réussie\",\"all_checks_passed_other\":\"les {{count}} vérifications ont réussi\",\"checks_failing_many\":\"{{failed}} vérifications sur {{count}} en échec\",\"checks_failing_one\":\"{{failed}} vérification sur {{count}} en échec\",\"checks_failing_other\":\"{{failed}} vérifications sur {{count}} en échec\",\"checks_running_many\":\"{{pending}} vérifications sur {{count}} encore en cours\",\"checks_running_one\":\"{{pending}} vérification sur {{count}} encore en cours\",\"checks_running_other\":\"{{pending}} vérifications sur {{count}} encore en cours\",\"closed\":\"fermée\",\"conflicts\":\"conflits\",\"failing_count_many\":\"{{count}} en échec\",\"failing_count_one\":\"{{count}} en échec\",\"failing_count_other\":\"{{count}} en échec\",\"merge_blocked\":\"merge bloqué\",\"merged\":\"mergée\",\"open\":\"ouverte\",\"passed_count_many\":\"{{count}} réussies\",\"passed_count_one\":\"{{count}} réussie\",\"passed_count_other\":\"{{count}} réussies\",\"running_count_many\":\"{{count}} en cours\",\"running_count_one\":\"{{count}} en cours\",\"running_count_other\":\"{{count}} en cours\"},\"repoSwitcher\":{\"add_a_repo\":\"Ajouter un repo\",\"all_repos\":\"Tous les repos\",\"filter_repos\":\"Filtrer les repos\",\"filter_repositories\":\"Filtrer les dépôts\",\"loading\":\"Chargement…\",\"no_repo_matches_that\":\"Aucun repo ne correspond.\",\"no_repos_yet_add_one_to_pick_from_the_repos_you\":\"Pas encore de repos — ajoute-en un pour choisir parmi les repos sur lesquels tu travailles.\",\"pick_a_repo\":\"Choisis un repo\",\"pick_a_repository\":\"Choisis un dépôt\",\"recent\":\"Récents\",\"repositories\":\"Dépôts\",\"repository_named\":\"Dépôt : {{name}}\"},\"reportView\":{\"blast_radius\":\"Portée de l'impact : {{scope}}\",\"blocking_count_many\":\"{{count}} bloquants\",\"blocking_count_one\":\"{{count}} bloquant\",\"blocking_count_other\":\"{{count}} bloquants\",\"changes_reviewed_many\":\"{{count}} changements revus\",\"changes_reviewed_one\":\"{{count}} changement revu\",\"changes_reviewed_other\":\"{{count}} changements revus\",\"clear\":\"Effacer\",\"design_gate\":\"Porte de conception ·\",\"design_risk\":\"Risque de conception : {{level}}\",\"draft_selected_many\":\"Rédiger {{count}} constats sélectionnés\",\"draft_selected_one\":\"Rédiger {{count}} constat sélectionné\",\"draft_selected_other\":\"Rédiger {{count}} constats sélectionnés\",\"finding_dimension_in_file\":\"{{dimension}} dans {{file}}\",\"generated\":\"· généré\",\"moved_to\":\"Maintenant dans {{band}}. Gardé à sa place jusqu’à ce que tu changes le filtre.\",\"no_changes_in_this_band\":\"Aucun changement dans cette catégorie.\",\"nothing_flagged_in_this_review\":\"Rien n’a été signalé dans cette revue.\",\"open_shared_copy\":\"Ouvrir la copie partagée\",\"open_the_pull_request\":\"Ouvrir la pull request\",\"share\":\"Partager\",\"sharing\":\"Partage…\",\"should_fix_count_many\":\"{{count}} à corriger\",\"should_fix_count_one\":\"{{count}} à corriger\",\"should_fix_count_other\":\"{{count}} à corriger\",\"step_problem\":\"Problème\",\"step_solution_fit\":\"Adéquation de la solution\",\"step_why_it_matters\":\"Pourquoi c’est important\"},\"reviewChat\":{\"continue_hint\":\"La conversation avec ce relecteur se poursuit dans l'onglet Chat.\",\"continue_session\":\"Reprendre la session de suivi\",\"earlier_questions\":\"Questions précédentes\",\"error_generic\":\"La session de suivi n'a pas pu être ouverte. Réessayez.\",\"error_run_deleted\":\"Cette relecture a été supprimée, la conversation est donc terminée.\",\"loading\":\"Chargement…\",\"new_session_unavailable\":\"Cette app ne peut pas encore ouvrir une nouvelle session de suivi : il faut un Kiro Crew qui permette à une app d’ouvrir une session de chat nommée. Une session de suivi déjà ouverte peut toujours être poursuivie.\",\"not_recorded_notice\":\"Cette relecture n'a pas conservé de session du relecteur : il n'y a rien à réouvrir. Relancez la relecture de cette pull request pour poser des questions.\",\"open_session\":\"Ouvrir une session de suivi\",\"opening\":\"Ouverture…\",\"ran_tools\":\"Consulté : {{tools}}\",\"reasoning\":\"Raisonnement\",\"refused_notice\":\"Il lui fallait exécuter un outil pour répondre pleinement, ce qui n'a pas été autorisé : cette réponse est donc limitée. Active YOLO pour l'autoriser.\",\"resume_hint\":\"Ouvre un chat qui reprend le relecteur, avec le raisonnement à l'origine de ses constats.\",\"role_reviewer\":\"Relecteur\",\"role_you\":\"Toi\",\"run_live_notice\":\"Cette relecture est encore en cours. Ses constats peuvent changer jusqu'à la fin, il n'y a donc rien à demander pour l'instant.\",\"title\":\"Interroger le relecteur\",\"transcript_gone_notice\":\"La session du relecteur n'est plus sur le disque : il n'y a rien à réouvrir. Relancez la relecture de cette pull request pour poser des questions.\"},\"reviewQueue\":{\"empty\":\"Aucune pull request n’attend ta relecture.\",\"filter_by_repo\":\"Filtrer par dépôt ou titre\",\"setup_required\":\"Configure la CLI GitHub pour voir les demandes de relecture\",\"starts_review\":\"Chaque sélection lance une relecture Sage. Les résultats apparaissent dans Revues et ne sont publiés sur GitHub que si tu le décides.\",\"starts_review_truncated\":\"Seules les 100 demandes les plus récentes sont affichées. Chaque sélection lance une relecture Sage. Les résultats apparaissent dans Revues et ne sont publiés sur GitHub que si tu le décides.\",\"tab\":\"Demandes\"},\"runCard\":{\"cancel\":\"Annuler\",\"clean\":\"Propre\",\"delete\":\"Supprimer\",\"delete_review_of\":\"Supprimer la revue de {{label}}\",\"delete_this_review\":\"Supprimer cette revue\",\"delete_this_review_2\":\"Supprimer cette revue ?\",\"more_count_many\":\"+{{count}} de plus\",\"more_count_one\":\"+{{count}} de plus\",\"more_count_other\":\"+{{count}} de plus\",\"needs_review_count_many\":\"{{count}} à revoir\",\"needs_review_count_one\":\"{{count}} à revoir\",\"needs_review_count_other\":\"{{count}} à revoir\",\"pull_requests\":\"pull requests\",\"review\":\"Revue\",\"review_of\":\"Revue de {{label}}\",\"review_of_with_more_many\":\"Revue de {{label}} et {{count}} de plus\",\"review_of_with_more_one\":\"Revue de {{label}} et {{count}} de plus\",\"review_of_with_more_other\":\"Revue de {{label}} et {{count}} de plus\",\"worth_a_glance_count_many\":\"{{count}} méritent un coup d’œil\",\"worth_a_glance_count_one\":\"{{count}} mérite un coup d’œil\",\"worth_a_glance_count_other\":\"{{count}} méritent un coup d’œil\"},\"runDetail\":{\"cancelled_before_any_finished\":\"Elle a été annulée avant qu’aucune pull request ne se termine.\",\"finished\":\"terminée\",\"loading_report\":\"Chargement du rapport…\",\"more_count_many\":\"+{{count}} de plus\",\"more_count_one\":\"+{{count}} de plus\",\"more_count_other\":\"+{{count}} de plus\",\"nothing_to_report\":\"Aucune pull request n’a terminé une revue, il n’y avait donc rien à rapporter.\",\"pull_request_many\":\"{{count}} pull requests\",\"pull_request_one\":\"{{count}} pull request\",\"pull_request_other\":\"{{count}} pull requests\",\"report_appears_when_the_review_finishes\":\"Le rapport apparaît ici dès que la revue se termine.\",\"skipped_inflight_many\":\"{{count}} pull requests ont été ignorées parce qu’une autre revue les avait déjà.\",\"skipped_inflight_one\":\"{{count}} pull request a été ignorée parce qu’une autre revue l’avait déjà.\",\"skipped_inflight_other\":\"{{count}} pull requests ont été ignorées parce qu’une autre revue les avait déjà.\",\"started\":\"démarrée\",\"this_review_produced_no_report\":\"Cette revue n’a produit aucun rapport.\",\"you_can_leave_this_page_a_notification_will_tell\":\"Tu peux quitter cette page — une notification te dira quand elle arrive.\"},\"runList\":{\"new_review\":\"Nouvelle revue\"},\"runProgress\":{\"cancel_review\":\"Annuler la revue\",\"cancelled_count_many\":\"{{count}} annulées\",\"cancelled_count_one\":\"{{count}} annulée\",\"cancelled_count_other\":\"{{count}} annulées\",\"cancelling\":\"Annulation…\",\"elapsed_time\":\"Temps écoulé\",\"failed_count_many\":\"{{count}} en échec\",\"failed_count_one\":\"{{count}} en échec\",\"failed_count_other\":\"{{count}} en échec\",\"median_of_past_runs_of_this_size\":\"Médiane des exécutions passées de cette taille\",\"review_progress\":\"Progression de la revue\",\"reviewed_of_many\":\"{{done}} / {{count}} revues\",\"reviewed_of_one\":\"{{done}} / {{count}} revue\",\"reviewed_of_other\":\"{{done}} / {{count}} revues\",\"reviewers_busy\":\"{{busy}} relecteurs sur {{max}} occupés\",\"step\":\"· étape\",\"stops_queued_prs_one_already_being_reviewed_will\":\"Arrête les PR en file ; celle déjà en cours de revue se terminera.\",\"usually\":\"d’habitude ~\",\"working\":\"Travaille\"},\"runStatusPill\":{\"cancelled\":\"Annulé\",\"cancelling\":\"Annulation\",\"done\":\"Terminé\",\"error\":\"Erreur\",\"interrupted\":\"Interrompu\",\"running\":\"En cours\"},\"shipSummaryCard\":{\"post_the_ship_readiness_summary\":\"Publier le résumé de préparation à la livraison\",\"post_this_comment\":\"Publier ce commentaire\",\"posted_as_a_top_level_comment\":\"publié comme commentaire de premier niveau\",\"posted_to_the_pull_request\":\"Publié sur la pull request\",\"posting\":\"Publication…\",\"select_the_ship_readiness_summary_to_post\":\"Sélectionner le résumé de préparation à la livraison pour le publier\",\"ship_readiness_summary\":\"Résumé de préparation à la livraison\"}},\"lib\":{\"format\":{\"cause_no_agent_cli\":\"Le relecteur n’a jamais démarré — aucun exécutable kiro-cli n’a été trouvé sur cet hôte. Installe-le, ou ajoute-le au PATH.\",\"cause_no_record\":\"Le relecteur a terminé mais n’a enregistré aucun constat.\",\"cause_record_incomplete\":\"Le relecteur a écrit un enregistrement de constats mais s’est arrêté avant de terminer la revue.\",\"cause_runtime_died\":\"Le processus du relecteur s’est arrêté en pleine revue — généralement parce que le gateway a redémarré. Rien n’allait mal du côté de la pull request.\",\"cause_runtime_not_importable\":\"Le relecteur n’a jamais démarré — cette installation ne peut pas charger le runtime d’agent dont elle a besoin. Répare l’installation pour le rétablir.\",\"cause_runtime_unavailable\":\"Le relecteur n’a jamais démarré — son runtime d’agent n’est pas disponible sur cet hôte.\",\"cause_timeout\":\"La revue a dépassé sa limite de temps.\",\"cause_turn_failed\":\"Le tour de revue a échoué avant d’enregistrer quoi que ce soit.\",\"cause_unknown\":\"La revue ne s’est pas terminée.\",\"days_ago_many\":\"il y a {{count}} j\",\"days_ago_one\":\"il y a {{count}} j\",\"days_ago_other\":\"il y a {{count}} j\",\"hours_ago_many\":\"il y a {{count}} h\",\"hours_ago_one\":\"il y a {{count}} h\",\"hours_ago_other\":\"il y a {{count}} h\",\"just_now\":\"à l’instant\",\"minutes_ago_many\":\"il y a {{count}} min\",\"minutes_ago_one\":\"il y a {{count}} min\",\"minutes_ago_other\":\"il y a {{count}} min\",\"phase_cancelled\":\"Annulée\",\"phase_done\":\"Terminée\",\"phase_failed\":\"Échouée\",\"phase_pending\":\"En attente\",\"phase_queued\":\"En file\",\"phase_reviewing\":\"Revue en cours\"}},\"manifest\":{\"configuration_1\":\"Installe et authentifie la CLI gh sur l'hôte de la passerelle, ajoute un dépôt, puis choisis dans les paramètres le modèle de revue, l'effort de raisonnement et la concurrence.\",\"description\":\"Examine en profondeur les pull requests GitHub et te dit quelles modifications méritent vraiment ton attention. Chaque pull request est relue dans sa propre session d’agent isolée qui couvre tous les fichiers modifiés, pondérés par l’ampleur de son rayon d’impact, puis consolidé dans un rapport de focus priorisé. Les conclusions se lisent dans l’application et ne sont préparées sous forme de revue GitHub en brouillon que lorsque tu les publies ou actives la publication automatique, et le relecteur continue d’apprendre les vraies normes de ton dépôt à partir des correctifs livrés et des commentaires de revue passés.\",\"display_name\":\"Code Review Sage\",\"highlight_1\":\"Le rapport de focus classe les modifications par rayon d’impact, pour lire d’abord les fichiers risqués\",\"highlight_2\":\"Une session d’agent isolée par pull request, pour que les conclusions ne débordent jamais d’une revue à l’autre\",\"highlight_3\":\"Les revues se lisent dans l’application : rien n’est publié sur votre pull request sans votre demande\",\"highlight_4\":\"Apprend dépôt par dépôt à partir des correctifs livrés, des commentaires de revue et des discussions de conception\",\"highlight_5\":\"Relit les pull requests GitHub ; nécessite une CLI `gh` authentifiée sur l’hôte du gateway\",\"page_label\":\"Code Review Sage\",\"use_case_1\":\"Examine une ou plusieurs pull requests GitHub selon leur risque, analyse les conclusions ciblées et ne prépare que les commentaires utiles à publier.\"},\"views\":{\"learningView\":{\"cancel\":\"Annuler\",\"confirm_merge_many\":\"Fusionner {{count}} acquis dans le jeu de règles ?\",\"confirm_merge_one\":\"Fusionner {{count}} acquis dans le jeu de règles ?\",\"confirm_merge_other\":\"Fusionner {{count}} acquis dans le jeu de règles ?\",\"consolidate\":\"Consolider\",\"consolidate_pending_many\":\"Consolider {{count}} acquis en attente dans {{namespace}}\",\"consolidate_pending_one\":\"Consolider {{count}} acquis en attente dans {{namespace}}\",\"consolidate_pending_other\":\"Consolider {{count}} acquis en attente dans {{namespace}}\",\"consolidating\":\"Consolidation…\",\"learning\":\"Apprentissage\",\"loaded_during_reviews\":\"chargé pendant les revues\",\"loading_learnings\":\"Chargement des acquis…\",\"merge_failed_ruleset_unchanged\":\"La fusion a échoué — jeu de règles inchangé\",\"not_loaded\":\"non chargé\",\"nothing_consolidated_yet_reviews_in_this_namespa\":\"Rien de consolidé pour l’instant — les revues dans ce namespace ne chargent actuellement aucun motif appris.\",\"nothing_staged_new_learnings_land_here_when_a_re\":\"Rien en attente. De nouveaux acquis arrivent ici quand une revue analyse un correctif livré ou un commentaire de revue pris en compte.\",\"pattern_many\":\"{{count}} motifs\",\"pattern_one\":\"{{count}} motif\",\"pattern_other\":\"{{count}} motifs\",\"pending_consolidation\":\"Consolidation en attente ·\",\"pick_a_namespace_in_the_sidebar_to_read_the_patt\":\"Choisis un namespace dans la barre latérale pour lire les motifs que les revues en chargent.\",\"reviews_read_the_consolidated_ruleset_below_neve\":\"Les revues lisent le jeu de règles consolidé ci-dessous, jamais les candidats en attente. La consolidation y fusionne ce qui est en attente — une fusion IA en une fois que tu déclenches, donc rien ne change ce que voient les revues avant que tu la lances.\",\"ruleset\":\"Jeu de règles ·\"},\"settingsView\":{\"default_agent_config\":\"Par défaut (configuration de l’agent)\",\"default_model_provider\":\"Par défaut (modèle / fournisseur)\",\"higher_effort_finds_more_costs_more_and_takes_lo\":\"Plus d’effort trouve davantage, coûte plus cher et prend plus de temps par pull request. Par défaut, c’est le modèle ou le fournisseur qui décide.\",\"how_many_pull_requests_are_reviewed_in_parallel\":\"Combien de pull requests sont revues en parallèle sur le runtime de workers partagé. C’est la vraie limite du débit de revue — plusieurs fils de revue peuvent être ouverts en même temps, mais ils puisent tous dans ce budget.\",\"loading_settings\":\"Chargement des réglages…\",\"model\":\"Modèle\",\"reasoning_effort\":\"Effort de raisonnement\",\"review_model\":\"Modèle de revue\",\"reviews_at_once\":\"Revues simultanées\",\"settings\":\"Réglages\",\"these_apply_to_every_review_started_from_here\":\"Cela s’applique à toutes les revues lancées d’ici.\",\"which_model_performs_the_review_default_inherits\":\"Quel modèle réalise la revue. Par défaut, la configuration de l’agent est héritée, donc changer ton modèle par défaut change aussi ceci.\"}},\"workspace\":{\"drag_to_resize\":\"Fais glisser pour redimensionner\",\"resize_sidebar\":\"Redimensionner la barre latérale\",\"select_a_review_to_see_its_progress_and_report\":\"Choisis une revue pour voir sa progression et son rapport.\",\"start_a_new_one_several_can_run_at_once\":\"Lances-en une nouvelle — plusieurs peuvent tourner en même temps.\"}},\"issueRadar\":{\"components\":{\"prDetail\":{\"labels\":\"Étiquettes\"}}}}"),
		components: { "resizeHandle": { "drag_to_resize": "Faire glisser pour redimensionner" } },
		lib: { "scriptLabel": {
			"cyrillic": "lettre cyrillique",
			"greek": "lettre grecque",
			"latin": "lettre latine",
			"other": "caractère"
		} }
	},
	hi: {
		app: {
			"collapse_sidebar": "साइडबार समेटें",
			"expand_sidebar": "साइडबार विस्तृत करें"
		},
		apps: /* @__PURE__ */ JSON.parse("{\"codeReviewSage\":{\"codeReviewSagePage\":{\"open_pr_one\":\"{{count}} open PR\",\"open_pr_other\":\"{{count}} open PRs\",\"pattern_one\":\"{{count}} पैटर्न\",\"pattern_other\":\"{{count}} पैटर्न\"},\"components\":{\"addReposModal\":{\"add\":\"जोड़ो\",\"add_one_by_url_above\":\"ऊपर URL से एक जोड़ो।\",\"add_repo\":\"{{repo}} जोड़ो\",\"add_repos\":\"रेपो जोड़ो\",\"added\":\"जुड़ा हुआ\",\"all_your_repos\":\"तुम्हारे सारे रेपो\",\"already_added\":\"{{repo}} पहले से जुड़ा है\",\"archived\":\"संग्रहित\",\"based_on_recent_github_activity\":\"तुम्हारी हाल की GitHub गतिविधि के आधार पर\",\"close\":\"बंद करो\",\"close_add_repos_dialog\":\"रेपो जोड़ने का डायलॉग बंद करो\",\"contributed_events_one\":\"{{age}} · {{count}} गतिविधि\",\"contributed_events_other\":\"{{age}} · {{count}} गतिविधियां\",\"filter_your_repos\":\"अपने रेपो छानो\",\"gh_auth_login\":\"gh auth login\",\"github_cli_not_ready\":\"GitHub CLI तैयार नहीं है\",\"newest_100_by_push_date\":\"पुश तिथि के अनुसार नवीनतम 100\",\"no_repos_for_account\":\"तुम्हारे खाते के लिए कोई रेपो नहीं मिला।\",\"no_repos_match_filter\":\"तुम्हारे फ़िल्टर से कोई रेपो मेल नहीं खाता।\",\"owner_repo_a_repo_url_or_paste_a_pull_request_li\":\"owner/repo, रेपो का URL, या pull request का लिंक चिपकाओ\",\"pick_from_the_repos_you_can_reach_or_type_one_in\":\"जिन रेपो तक तुम्हारी पहुँच है उनमें से चुनो, या कोई नाम लिखो। जुड़े हुए रेपो साइडबार में दिखते हैं, ताकि तुम वहीं से समीक्षा शुरू कर सको। pull request का लिंक चिपकाओ और वही pull request सीधे खुल जाएगा।\",\"pinned_to_the_sidebar\":\"साइडबार में पिन किया\",\"private\":\"निजी\",\"pushed_age\":\"{{age}} पुश किया गया\",\"re_read_your_repos_from_github\":\"GitHub से अपने रेपो दोबारा पढ़ो\",\"read_only\":\"सिर्फ़ पढ़ना\",\"read_only_access\":\"सिर्फ़ पढ़ने की पहुँच\",\"reading_your_repos_from_github\":\"GitHub से तुम्हारे रेपो पढ़ रहा हूँ…\",\"recently_worked_on\":\"हाल में काम किए हुए\",\"refresh_your_repos\":\"अपने रेपो ताज़ा करो\",\"remove\":\"हटाओ\",\"remove_repo\":\"{{repo}} हटाओ\",\"repository_or_pull_request_url_or_owner_repo\":\"रिपॉज़िटरी या pull request का URL, या owner/repo\",\"setup_hint\":\"GitHub CLI इंस्टॉल करो और नीचे दिए कमांड से साइन इन करो, तब तुम्हारे रेपो की सूची मिलेगी। ऊपर URL से कोई भी रेपो अब भी जोड़ सकते हो।\",\"these_lists_are_capped_so_a_repo_you_have_not_to\":\"इन सूचियों की सीमा है, तो जिस रेपो को तुमने हाल में नहीं छुआ वह छूट सकता है। न दिखे तो ऊपर URL से जोड़ लो।\",\"your_repos\":\"तुम्हारे रेपो\"},\"bandChips\":{\"all\":\"सभी\",\"clean\":\"कोई समस्या नहीं\",\"filter_by_band\":\"श्रेणी से छानो\",\"needs_review\":\"समीक्षा चाहिए\",\"worth_a_glance\":\"एक नज़र डालें\"},\"draftReviewActions\":{\"approve\":\"स्वीकृत करो\",\"approve_is_unavailable_because_this_base_branch_\":\"स्वीकृति उपलब्ध नहीं है: इस पुल रिक्वेस्ट की बेस ब्रांच नए कमिट आने पर स्वीकृतियाँ रद्द नहीं करती (या यहाँ से उसकी प्रोटेक्शन पढ़ी नहीं जा सकती)। इसके बिना स्वीकृति उस कमिट से ज़्यादा देर टिक सकती है जिसकी समीक्षा हुई थी। GitHub पर स्वीकृत करो।\",\"approve_is_unavailable_while_auto_merge_is_armed\":\"ऑटो-मर्ज चालू रहने तक स्वीकृति उपलब्ध नहीं है: स्वीकृति इस पुल रिक्वेस्ट को head जाँच द्वारा वापस लिए जाने से पहले ही मर्ज कर सकती है। ऑटो-मर्ज बंद करो, या GitHub पर स्वीकृत करो।\",\"ask_agent_about_this_failure\":\"इस त्रुटि के बारे में एजेंट से पूछें\",\"cancel\":\"रद्द करें\",\"confirm_approve\":\"इस पुल रिक्वेस्ट को स्वीकृत करें?\",\"confirm_request_changes\":\"बदलाव का अनुरोध करते हुए यह समीक्षा प्रकाशित करें?\",\"confirm_submit_as_comment\":\"इस समीक्षा को टिप्पणी के रूप में सबमिट करें?\",\"couldn_t_check_for_a_draft_review_on_this_pull_r\":\"इस पुल रिक्वेस्ट पर ड्राफ़्ट समीक्षा की जाँच नहीं हो सकी। यह आम तौर पर GitHub CLI के प्रमाणीकरण की समस्या होती है, ड्राफ़्ट के गायब होने की नहीं।\",\"draft_review\":\"ड्राफ़्ट समीक्षा\",\"no_draft_review_on_this_pull_request\":\"इस पुल रिक्वेस्ट पर कोई ड्राफ़्ट समीक्षा नहीं है।\",\"pending_only_you_can_see_it_until_you_publish\":\"लंबित — प्रकाशित करने तक इसे केवल तुम देख सकते हो।\",\"publish_failed\":\"समीक्षा प्रकाशित नहीं हो सकी\",\"published_as\":\"इस रूप में प्रकाशित\",\"published_verdict_approved\":\"स्वीकृत\",\"published_verdict_changes_requested\":\"बदलाव का अनुरोध किया गया\",\"published_verdict_comment\":\"एक टिप्पणी\",\"publishing\":\"प्रकाशित किया जा रहा है…\",\"publishing_is_blocked_a_later_review_replaced_th\":\"प्रकाशन अवरुद्ध है: बाद की एक समीक्षा ने पुल रिक्वेस्ट पर इस ड्राफ़्ट को बदल दिया, इसलिए इसमें अब इस समीक्षा के निष्कर्ष नहीं हैं। प्रकाशित करने के लिए सबसे नई समीक्षा खोलें।\",\"publishing_is_blocked_this_draft_contains_conten\":\"प्रकाशन रोक दिया गया: इस ड्राफ़्ट में ऐसा कुछ है जिसे छिपाना ज़रूरी है, और भेजने पर मूल टेक्स्ट प्रकाशित हो जाएगा। GitHub पर ड्राफ़्ट संपादित करो या हटाओ।\",\"publishing_is_blocked_this_draft_was_written_aga\":\"प्रकाशन रोक दिया गया: यह ड्राफ़्ट पुराने कमिट के लिए लिखा गया था और उसके बाद पुल रिक्वेस्ट बदल गई है। पहले मौजूदा head की फिर समीक्षा करो।\",\"publishing_is_blocked_this_review_is_still_runni\":\"प्रकाशन अवरुद्ध है: यह समीक्षा अभी भी चल रही है, इसलिए इस पुल रिक्वेस्ट का ड्राफ़्ट पिछले रन का है।\",\"publishing_is_irreversible_and_visible_to_everyo\":\"प्रकाशन अपरिवर्तनीय है और पुल रिक्वेस्ट के सभी लोगों को दिखता है।\",\"request_changes\":\"बदलाव का अनुरोध करो\",\"submit_as_comment\":\"टिप्पणी के रूप में सबमिट करो\",\"this_draft_has_no_summary_body\":\"इस ड्राफ़्ट में कोई सारांश नहीं है।\",\"try_again\":\"पुन: प्रयास करें\"},\"failureNotice\":{\"run_it_again\":\"दोबारा चलाओ\",\"starting\":\"शुरू हो रहा है…\",\"this_review_failed\":\"यह समीक्षा विफल रही\"},\"findingCard\":{\"cancel_dismiss\":\"रद्द करो\",\"confirm_dismiss\":\"फ़ाइंडिंग खारिज करो\",\"consequence\":\"परिणाम\",\"dismiss\":\"खारिज करो\",\"dismiss_failed\":\"खारिज करना सहेजा नहीं जा सका। फिर से कोशिश करो।\",\"dismiss_reason_label\":\"इस फ़ाइंडिंग को क्यों खारिज कर रहे हो?\",\"dismiss_reason_placeholder\":\"उदाहरण: गलत चेतावनी, दायरे से बाहर\",\"dismissed_reason\":\"खारिज किया गया: {{reason}}\",\"evidence\":\"प्रमाण\",\"observation\":\"अवलोकन\",\"post_finding\":\"यह निष्कर्ष pull request पर डालो\",\"post_finding_on\":\"यह निष्कर्ष {{target}} पर डालो\",\"post_this_comment\":\"यह टिप्पणी डालो\",\"posted_to_the_pull_request\":\"pull request पर डाल दिया\",\"posting\":\"डाल रहा हूँ…\",\"select_to_draft_together\":\"बल्क ड्राफ़्ट के लिए चुनें\",\"select_to_post\":\"डालने के लिए {{label}} चुनो\",\"severity_must_fix\":\"अनिवार्य\",\"severity_should_fix\":\"सुझाव\",\"suggestion\":\"सुझाव\",\"this_finding\":\"यह निष्कर्ष\",\"undo_dismiss\":\"पूर्ववत करो\",\"undo_dismiss_failed\":\"पूर्ववत नहीं हो सका। यह फ़ाइंडिंग अब भी खारिज है।\"},\"learningRail\":{\"add_namespace\":\"namespace जोड़ो\",\"confirm_delete\":\"“{{name}}” और उसकी सारी सीख मिटा दें? यह वापस नहीं आएगा।\",\"delete_2\":\"मिटाओ\",\"delete_namespace\":\"namespace {{name}} मिटाओ\",\"invalid_namespace_name\":\"namespace का नाम उसके फ़ोल्डर का नाम बनता है, इसलिए उसमें सिर्फ़ छोटे लैटिन अक्षर (a–z), अंक (0–9), बिंदु, हाइफ़न और अंडरस्कोर हो सकते हैं। नाम किसी अक्षर या अंक से शुरू और ख़त्म होना चाहिए और उसमें 2 से 64 वर्ण होने चाहिए।\",\"invalid_namespace_name_char\":\"“{{char}}” namespace के नाम में इस्तेमाल नहीं किया जा सकता। छोटे अक्षर a–z, 0–9, .\xA0-⁠\xA0_ इस्तेमाल करो।\",\"invalid_namespace_name_letter\":\"“{{char}}” ({{script}}, {{code}}) namespace के नाम में इस्तेमाल नहीं किया जा सकता। छोटे अक्षर a–z, 0–9, .\xA0-⁠\xA0_ इस्तेमाल करो।\",\"keep_it\":\"रहने दो\",\"load_namespace_during_reviews\":\"समीक्षाओं में namespace {{name}} लोड करो\",\"loading\":\"लोड हो रहा है…\",\"namespace_active\":\"सक्रिय — समीक्षाओं में लोड होता है (बंद करने के लिए निशान हटाओ)\",\"namespace_inactive\":\"निष्क्रिय — समीक्षाओं में लोड करने के लिए निशान लगाओ\",\"namespaces\":\"Namespace\",\"new_namespace\":\"नया namespace\",\"new_namespace_2\":\"new-namespace\",\"new_namespace_name\":\"नए namespace का नाम\",\"pattern_one\":\"{{count}} पैटर्न\",\"pattern_other\":\"{{count}} पैटर्न\",\"pending_count_one\":\"{{count}} बाकी\",\"pending_count_other\":\"{{count}} बाकी\",\"read_namespace\":\"namespace {{name}} पढ़ो\"},\"leftRail\":{\"code_review_sage\":\"Code Review Sage\",\"learning\":\"सीख\",\"reviews\":\"समीक्षाएँ\",\"sections\":\"खंड\",\"settings\":\"सेटिंग\",\"version\":\"v{{version}}\"},\"listSkeleton\":{\"loading_reviews\":\"समीक्षाएँ लोड हो रही हैं…\"},\"middleColumn\":{\"all_repos\":\"सारे रेपो\",\"just_this_repo\":\"सिर्फ़ {{repo}}\",\"lists_label\":\"Pull request या समीक्षाएँ\",\"no_reviews_for_repo\":\"{{repo}} की कोई समीक्षा नहीं\",\"no_reviews_yet\":\"अभी कोई समीक्षा नहीं\",\"pick_a_repo_then_a_pr\":\"पहले रेपो चुनो, फिर pull request।\",\"pull_requests\":\"Pull request\",\"repo_lists_label\":\"{{repo}}: pull request या समीक्षाएँ\",\"repo_reviews_appear_here\":\"इस रेपो के लिए तुम जो समीक्षाएँ शुरू करते हो वे यहाँ दिखती हैं।\",\"reviews\":\"समीक्षाएँ\",\"show_all_count\":\"सभी दिखाओ ({{count}})\",\"this_repo_only\":\"सिर्फ़ {{repo}}\"},\"postCommentsButton\":{\"cancel\":\"रद्द करो\",\"confirm_post_one\":\"{{count}} टिप्पणी pull request पर डालें?\",\"confirm_post_other\":\"{{count}} टिप्पणियाँ pull request पर डालें?\",\"drafted_publish_on_pr_page_one\":\"{{count}} टिप्पणी का ड्राफ़्ट बना — प्रकाशित करने के लिए पुल रिक्वेस्ट यहीं खोलें\",\"drafted_publish_on_pr_page_other\":\"{{count}} टिप्पणियों का ड्राफ़्ट बना — प्रकाशित करने के लिए पुल रिक्वेस्ट यहीं खोलें\",\"post_action\":\"डालो\",\"post_count_one\":\"{{count}} टिप्पणी डालो\",\"post_count_other\":\"{{count}} टिप्पणियाँ डालो\",\"post_failed\":\"डालना विफल रहा\",\"posted_age\":\"{{age}} डाला गया\",\"posted_comments_one\":\"{{count}} टिप्पणी डाली\",\"posted_comments_other\":\"{{count}} टिप्पणियाँ डालीं\",\"posting\":\"डाल रहा हूँ…\",\"publish_these_findings_as_a_review_on_the_pull_r\":\"इन निष्कर्षों को pull request पर एक समीक्षा के रूप में डालो\"},\"prPickList\":{\"a_review_of_this_pull_request_is_running\":\"इस pull request की समीक्षा चल रही है\",\"add_a_repo\":\"रेपो जोड़ो\",\"already_reviewed\":\"पहले ही समीक्षित\",\"cancel\":\"रद्द करो\",\"confirm_review_all\":\"सभी {{count}} पुल रिक्वेस्ट की समीक्षा करें?\",\"draft\":\"मसौदा\",\"filter_pull_requests\":\"pull request छानो\",\"new\":\"नया\",\"no_open_prs_here\":\"यहाँ कोई खुला pull request नहीं है।\",\"no_prs_match_filter\":\"तुम्हारे फ़िल्टर से कोई pull request मेल नहीं खाता।\",\"one_or_more_github_pr_links\":\"एक या ज़्यादा GitHub PR लिंक\",\"open_pr\":\"pull request #{{number}} खोलो: {{title}}\",\"paste_pr_links\":\"PR लिंक चिपकाओ\",\"paste_pr_links_instead\":\"इसके बजाय PR लिंक चिपकाओ\",\"pick_a_repo_to_see_its_pull_requests\":\"किसी रेपो के pull request देखने के लिए उसे चुनो।\",\"pr_already_being_reviewed\":\"pull request #{{number}} की समीक्षा पहले से चल रही है\",\"re_read_open_prs_from_github\":\"GitHub से खुले PR दोबारा पढ़ो\",\"refresh_pull_requests\":\"pull request ताज़ा करो\",\"repos_live_in_the_sidebar\":\"रेपो साइडबार में रहते हैं।\",\"review_all_count\":\"सभी {{count}} की समीक्षा करो\",\"review_every_open_pr_not_yet_reviewed_at_its_cur\":\"हर खुले PR की समीक्षा करो जिसकी उसके मौजूदा head पर समीक्षा नहीं हुई\",\"review_pr\":\"pull request #{{number}} की समीक्षा करो: {{title}}\",\"review_selected_count_one\":\"{{count}} चयनित की समीक्षा करें\",\"review_selected_count_other\":\"{{count}} चयनित की समीक्षा करें\",\"review_these\":\"इनकी समीक्षा करो\",\"reviewed\":\"समीक्षित\",\"reviewed_age\":\"{{age}} समीक्षित\",\"reviewed_before_the_head_commit_has_moved_since\":\"पहले समीक्षित — तब से head कमिट बदल गया है\",\"reviewing\":\"समीक्षा हो रही है\",\"updated\":\"अपडेट हुआ\"},\"prReviewDetail\":{\"author\":\"लेखक\",\"cancelled_before_finishing\":\"यह पूरा होने से पहले ही उसे रद्द कर दिया गया था।\",\"did_not_complete_for_this_change\":\"इस बदलाव की समीक्षा पूरी नहीं हुई।\",\"draft\":\"मसौदा\",\"findings_appear_here_as_soon_as_the_review_finis\":\"समीक्षा खत्म होते ही निष्कर्ष यहाँ दिखेंगे। तुम पेज छोड़ सकते हो — आने पर सूचना बता देगी।\",\"head\":\"head\",\"loading_pull_request_details\":\"pull request का विवरण लोड हो रहा है…\",\"loading_review\":\"समीक्षा लोड हो रही है…\",\"nothing_flagged_on_this_pull_request\":\"इस pull request पर कुछ भी चिह्नित नहीं हुआ।\",\"open_on_github\":\"GitHub पर खोलो\",\"pull_request\":\"पुल रिक्वेस्ट\",\"pull_request_detail\":\"pull request का विवरण\",\"retry_review\":\"समीक्षा फिर से करो\",\"review\":\"समीक्षा करो\",\"review_again\":\"फिर समीक्षा करो\",\"review_again_at_current_head\":\"इस pull request की उसके मौजूदा head पर फिर समीक्षा करो\",\"review_already_running\":\"इस pull request की समीक्षा पहले से चल रही है\",\"review_completed_with_no_findings\":\"समीक्षा पूरी हुई और ऐसा कुछ नहीं मिला जो तुम्हारा समय ले।\",\"review_this_pull_request\":\"इस pull request की समीक्षा करो\",\"reviewing\":\"समीक्षा हो रही है…\",\"running\":\"चल रही है\",\"sage_review\":\"Sage समीक्षा\",\"see_the_reason_above\":\"कारण ऊपर देखो।\",\"start_a_review_and_its_findings_appear_here_you\":\"समीक्षा शुरू करो और उसके निष्कर्ष यहाँ दिखेंगे — तुम पेज छोड़ सकते हो, आने पर सूचना बता देगी।\",\"that_review_produced_no_report_for_this_pull_req\":\"उस समीक्षा ने इस pull request के लिए कोई रिपोर्ट नहीं बनाई।\",\"this_pull_request_has_not_been_reviewed_yet\":\"इस pull request की अभी समीक्षा नहीं हुई।\",\"updated\":\"अपडेट हुआ\"},\"prSourcePanel\":{\"load_failed\":\"pull request का विवरण लोड नहीं हो सका: {{reason}}\",\"partial_sections\":\"कुछ खंड अधूरे हैं ({{sections}}) — प्रदाता से अनुरोध विफल रहा या पेज की सीमा तक पहुँच गया।\"},\"prStatusChips\":{\"all_checks_passed_one\":\"{{count}} जाँच पास हुई\",\"all_checks_passed_other\":\"सभी {{count}} जाँचें पास हुईं\",\"checks_failing_one\":\"{{count}} में से {{failed}} जाँच विफल\",\"checks_failing_other\":\"{{count}} में से {{failed}} जाँचें विफल\",\"checks_running_one\":\"{{count}} में से {{pending}} जाँच अब भी चल रही\",\"checks_running_other\":\"{{count}} में से {{pending}} जाँचें अब भी चल रही हैं\",\"closed\":\"बंद\",\"conflicts\":\"टकराव\",\"failing_count_one\":\"{{count}} विफल\",\"failing_count_other\":\"{{count}} विफल\",\"merge_blocked\":\"merge रुका हुआ\",\"merged\":\"merge हो गया\",\"open\":\"खुला\",\"passed_count_one\":\"{{count}} पास\",\"passed_count_other\":\"{{count}} पास\",\"running_count_one\":\"{{count}} चल रही\",\"running_count_other\":\"{{count}} चल रही\"},\"repoSwitcher\":{\"add_a_repo\":\"रेपो जोड़ो\",\"all_repos\":\"सारे रेपो\",\"filter_repos\":\"रेपो छानो\",\"filter_repositories\":\"रिपॉज़िटरी छानो\",\"loading\":\"लोड हो रहा है…\",\"no_repo_matches_that\":\"उससे कोई रेपो मेल नहीं खाता।\",\"no_repos_yet_add_one_to_pick_from_the_repos_you\":\"अभी कोई रेपो नहीं — एक जोड़ो, फिर जिन रेपो पर तुम काम करते हो उनमें से चुन सकोगे।\",\"pick_a_repo\":\"रेपो चुनो\",\"pick_a_repository\":\"रिपॉज़िटरी चुनो\",\"recent\":\"हाल के\",\"repositories\":\"रिपॉज़िटरी\",\"repository_named\":\"रिपॉज़िटरी: {{name}}\"},\"reportView\":{\"blast_radius\":\"प्रभाव क्षेत्र: {{scope}}\",\"blocking_count_one\":\"{{count}} अवरोधक\",\"blocking_count_other\":\"{{count}} अवरोधक\",\"changes_reviewed_one\":\"{{count}} बदलाव समीक्षित\",\"changes_reviewed_other\":\"{{count}} बदलाव समीक्षित\",\"clear\":\"साफ़ करो\",\"design_gate\":\"डिज़ाइन गेट ·\",\"design_risk\":\"डिज़ाइन जोखिम: {{level}}\",\"draft_selected_one\":\"{{count}} चयनित निष्कर्ष का ड्राफ़्ट बनाएं\",\"draft_selected_other\":\"{{count}} चयनित निष्कर्षों का ड्राफ़्ट बनाएं\",\"finding_dimension_in_file\":\"{{file}} में {{dimension}}\",\"generated\":\"· बना\",\"moved_to\":\"अब {{band}} में है। फ़िल्टर बदलने तक इसी जगह रहेगा।\",\"no_changes_in_this_band\":\"इस श्रेणी में कोई बदलाव नहीं।\",\"nothing_flagged_in_this_review\":\"इस समीक्षा में कुछ भी चिह्नित नहीं हुआ।\",\"open_shared_copy\":\"साझा प्रति खोलो\",\"open_the_pull_request\":\"pull request खोलो\",\"share\":\"साझा करो\",\"sharing\":\"साझा हो रहा है…\",\"should_fix_count_one\":\"{{count}} ठीक करना चाहिए\",\"should_fix_count_other\":\"{{count}} ठीक करना चाहिए\",\"step_problem\":\"समस्या\",\"step_solution_fit\":\"समाधान का मेल\",\"step_why_it_matters\":\"यह क्यों मायने रखता है\"},\"reviewChat\":{\"continue_hint\":\"इस समीक्षक से बातचीत चैट टैब में जारी रहती है।\",\"continue_session\":\"फ़ॉलो-अप सेशन जारी रखें\",\"earlier_questions\":\"पिछले प्रश्न\",\"error_generic\":\"फ़ॉलो-अप सेशन नहीं खोला जा सका। पुनः प्रयास करें।\",\"error_run_deleted\":\"यह समीक्षा हटा दी गई, इसलिए बातचीत समाप्त हो गई।\",\"loading\":\"लोड हो रहा है…\",\"new_session_unavailable\":\"इस ऐप से अभी नया फ़ॉलो-अप सेशन नहीं खोला जा सकता: इसके लिए ऐसा Kiro Crew चाहिए जो किसी ऐप को नाम वाला चैट सेशन खोलने दे। जो फ़ॉलो-अप सेशन तुम पहले खोल चुके हो, उसे अब भी जारी रख सकते हो।\",\"not_recorded_notice\":\"इस समीक्षा ने समीक्षक सेशन नहीं रखा, इसलिए फिर से खोलने के लिए कुछ नहीं है। सवाल पूने के लिए इस पुल रिक्वेस्ट की समीक्षा दोबारा करें।\",\"open_session\":\"फ़ॉलो-अप सेशन खोलें\",\"opening\":\"खोल रहे हैं…\",\"ran_tools\":\"देखा गया: {{tools}}\",\"reasoning\":\"तर्क\",\"refused_notice\":\"पूरा उत्तर देने के लिए उसे एक टूल चलाना था, जिसकी अनुमति नहीं मिली, इसलिए यह उत्तर सीमित है। अनुमति देने के लिए YOLO चालू करें।\",\"resume_hint\":\"एक चैट खोलता है जो समीक्षक को फिर से शुरू करता है, इसलिए निष्कर्षों के पीछे का तर्क बना रहता है।\",\"role_reviewer\":\"समीक्षक\",\"role_you\":\"आप\",\"run_live_notice\":\"यह समीक्षा अफी चल रही है। पूरी होने तक निष्कर्ष बदल सकते हैं, इसलिए अबी पूछने के लिए कुछ नहीं है।\",\"title\":\"समीक्षक से पूछें\",\"transcript_gone_notice\":\"समीक्षक का सेशन अब डिस्क पर नहीं है, इसलिए फिर से खोलने के लिए कुछ नहीं है। सवाल पूछने के लिए इस पुल रिक्वेस्ट की समीक्षा दोबारा करें।\"},\"reviewQueue\":{\"empty\":\"कोई पुल रिक्वेस्ट तुम्हारी समीक्षा का इंतज़ार नहीं कर रहा।\",\"filter_by_repo\":\"रिपो या शीर्षक से फ़िल्टर करो\",\"setup_required\":\"समीक्षा अनुरोध देखने के लिए GitHub CLI सेट अप करो\",\"starts_review\":\"हर चुने गए PR की Sage समीक्षा चलती है। नतीजे समीक्षाएँ में दिखते हैं और तुम्हारे चाहे बिना GitHub पर पोस्ट नहीं होते।\",\"starts_review_truncated\":\"सिर्फ़ सबसे नए 100 अनुरोध दिखाए गए हैं। हर चुने गए PR की Sage समीक्षा चलती है। नतीजे समीक्षाएँ में दिखते हैं और तुम्हारे चाहे बिना GitHub पर पोस्ट नहीं होते।\",\"tab\":\"अनुरोध\"},\"runCard\":{\"cancel\":\"रद्द करो\",\"clean\":\"साफ़\",\"delete\":\"मिटाओ\",\"delete_review_of\":\"{{label}} की समीक्षा मिटाओ\",\"delete_this_review\":\"यह समीक्षा मिटाओ\",\"delete_this_review_2\":\"यह समीक्षा मिटा दें?\",\"more_count_one\":\"+{{count}} और\",\"more_count_other\":\"+{{count}} और\",\"needs_review_count_one\":\"{{count}} को समीक्षा चाहिए\",\"needs_review_count_other\":\"{{count}} को समीक्षा चाहिए\",\"pull_requests\":\"pull request\",\"review\":\"समीक्षा\",\"review_of\":\"{{label}} की समीक्षा\",\"review_of_with_more_one\":\"{{label}} और {{count}} और की समीक्षा\",\"review_of_with_more_other\":\"{{label}} और {{count}} और की समीक्षा\",\"worth_a_glance_count_one\":\"{{count}} पर नज़र डालने लायक\",\"worth_a_glance_count_other\":\"{{count}} पर नज़र डालने लायक\"},\"runDetail\":{\"cancelled_before_any_finished\":\"किसी भी pull request के पूरा होने से पहले उसे रद्द कर दिया गया।\",\"finished\":\"खत्म हुई\",\"loading_report\":\"रिपोर्ट लोड हो रही है…\",\"more_count_one\":\"+{{count}} और\",\"more_count_other\":\"+{{count}} और\",\"nothing_to_report\":\"किसी pull request की समीक्षा पूरी नहीं हुई, इसलिए बताने को कुछ नहीं था।\",\"pull_request_one\":\"{{count}} pull request\",\"pull_request_other\":\"{{count}} pull request\",\"report_appears_when_the_review_finishes\":\"समीक्षा खत्म होते ही रिपोर्ट यहाँ दिखेगी।\",\"skipped_inflight_one\":\"{{count}} pull request छोड़ा गया क्योंकि दूसरी समीक्षा उसे पहले ही ले चुकी थी।\",\"skipped_inflight_other\":\"{{count}} pull request छोड़े गए क्योंकि दूसरी समीक्षा उन्हें पहले ही ले चुकी थी।\",\"started\":\"शुरू हुई\",\"this_review_produced_no_report\":\"इस समीक्षा ने कोई रिपोर्ट नहीं बनाई।\",\"you_can_leave_this_page_a_notification_will_tell\":\"तुम यह पेज छोड़ सकते हो — आने पर सूचना बता देगी।\"},\"runList\":{\"new_review\":\"नई समीक्षा\"},\"runProgress\":{\"cancel_review\":\"समीक्षा रद्द करो\",\"cancelled_count_one\":\"{{count}} रद्द\",\"cancelled_count_other\":\"{{count}} रद्द\",\"cancelling\":\"रद्द हो रही है…\",\"elapsed_time\":\"बीता समय\",\"failed_count_one\":\"{{count}} विफल\",\"failed_count_other\":\"{{count}} विफल\",\"median_of_past_runs_of_this_size\":\"इस आकार के पिछले रनों का मध्यमान\",\"review_progress\":\"समीक्षा की प्रगति\",\"reviewed_of_one\":\"{{done}} / {{count}} समीक्षित\",\"reviewed_of_other\":\"{{done}} / {{count}} समीक्षित\",\"reviewers_busy\":\"{{max}} में से {{busy}} समीक्षक व्यस्त\",\"step\":\"· चरण\",\"stops_queued_prs_one_already_being_reviewed_will\":\"कतार में लगे PR रुक जाएँगे; जिसकी समीक्षा चल रही है वह पूरी होगी।\",\"usually\":\"आम तौर पर ~\",\"working\":\"काम चल रहा है\"},\"runStatusPill\":{\"cancelled\":\"रद्द\",\"cancelling\":\"रद्द हो रहा है\",\"done\":\"पूर्ण\",\"error\":\"त्रुटि\",\"interrupted\":\"बाधित\",\"running\":\"चल रहा है\"},\"shipSummaryCard\":{\"post_the_ship_readiness_summary\":\"रिलीज़ तैयारी का सारांश डालो\",\"post_this_comment\":\"यह टिप्पणी डालो\",\"posted_as_a_top_level_comment\":\"शीर्ष स्तर की टिप्पणी के रूप में डाला\",\"posted_to_the_pull_request\":\"pull request पर डाल दिया\",\"posting\":\"डाल रहा हूँ…\",\"select_the_ship_readiness_summary_to_post\":\"डालने के लिए रिलीज़ तैयारी का सारांश चुनो\",\"ship_readiness_summary\":\"रिलीज़ तैयारी का सारांश\"}},\"lib\":{\"format\":{\"cause_no_agent_cli\":\"समीक्षक कभी शुरू ही नहीं हुआ — इस होस्ट पर kiro-cli एक्ज़ीक्यूटेबल नहीं मिला। इसे इंस्टॉल करो, या PATH में जोड़ो।\",\"cause_no_record\":\"समीक्षक ने काम खत्म किया पर कोई निष्कर्ष दर्ज नहीं किया।\",\"cause_record_incomplete\":\"समीक्षक ने निष्कर्षों का रिकॉर्ड लिखा, पर समीक्षा पूरी करने से पहले रुक गया।\",\"cause_runtime_died\":\"समीक्षक की प्रक्रिया समीक्षा के बीच रुक गई — आम तौर पर gateway के फिर शुरू होने से। pull request में कोई गड़बड़ नहीं थी।\",\"cause_runtime_not_importable\":\"समीक्षक कभी शुरू ही नहीं हुआ — यह इंस्टॉल अपनी ज़रूरत का एजेंट रनटाइम लोड नहीं कर पाता। इंस्टॉल की मरम्मत करो, तो यह वापस आ जाएगा।\",\"cause_runtime_unavailable\":\"समीक्षक कभी शुरू ही नहीं हुआ — उसका एजेंट रनटाइम इस होस्ट पर उपलब्ध नहीं है।\",\"cause_timeout\":\"समीक्षा अपनी समय सीमा से आगे चली गई।\",\"cause_turn_failed\":\"समीक्षा की बारी कुछ भी दर्ज करने से पहले विफल हो गई।\",\"cause_unknown\":\"समीक्षा पूरी नहीं हुई।\",\"days_ago_one\":\"{{count}} दिन पहले\",\"days_ago_other\":\"{{count}} दिन पहले\",\"hours_ago_one\":\"{{count}} घंटे पहले\",\"hours_ago_other\":\"{{count}} घंटे पहले\",\"just_now\":\"अभी अभी\",\"minutes_ago_one\":\"{{count}} मिनट पहले\",\"minutes_ago_other\":\"{{count}} मिनट पहले\",\"phase_cancelled\":\"रद्द\",\"phase_done\":\"पूरा\",\"phase_failed\":\"विफल\",\"phase_pending\":\"बाकी\",\"phase_queued\":\"कतार में\",\"phase_reviewing\":\"समीक्षा हो रही है\"}},\"manifest\":{\"configuration_1\":\"गेटवे होस्ट पर gh CLI इंस्टॉल करके प्रमाणित करें, रिपॉज़िटरी जोड़ें, फिर Settings में समीक्षा मॉडल, reasoning effort और concurrency चुनें।\",\"description\":\"GitHub पुल रिक्वेस्ट की गहरी समीक्षा करता है और बताता है कि किन बदलावों पर असल में ध्यान देने की ज़रूरत है। हर पुल रिक्वेस्ट की समीक्षा अपने अलग एजेंट सेशन में होती है, जो हर बदली हुई फ़ाइल को देखता है, उसके असर के दायरे के हिसाब से वज़न मिलता है, और सब कुछ प्राथमिकता वाली Focus Report में जुड़ जाता है। नतीजे ऐप में पढ़े जाते हैं और ड्राफ़्ट GitHub समीक्षा के रूप में तभी तैयार होते हैं जब तुम उन्हें प्रकाशित करो या स्वचालित पोस्टिंग चालू करो, और समीक्षक शिप हुए फ़िक्स और पुरानी समीक्षा टिप्पणियों से तुम्हारी रिपॉज़िटरी के असली मानक सीखता रहता है।\",\"display_name\":\"Code Review Sage\",\"highlight_1\":\"Focus Report बदलावों को असर के दायरे से क्रम देती है, ताकि जोखिम वाली फ़ाइलें पहले पढ़ी जाएँ\",\"highlight_2\":\"हर पुल रिक्वेस्ट के लिए एक अलग एजेंट सेशन, ताकि नतीजे समीक्षाओं के बीच कभी न मिलें\",\"highlight_3\":\"समीक्षाएँ ऐप में ही पढ़ी जाती हैं — जब तक तुम न कहो, तुम्हारे पुल रिक्वेस्ट पर कुछ भी पोस्ट नहीं किया जाता\",\"highlight_4\":\"हर रिपॉज़िटरी के लिए शिप हुए फ़िक्स, समीक्षा टिप्पणियों और डिज़ाइन चर्चाओं से सीखता है\",\"highlight_5\":\"GitHub पुल रिक्वेस्ट की समीक्षा करता है; गेटवे होस्ट पर प्रमाणित `gh` CLI चाहिए\",\"page_label\":\"Code Review Sage\",\"use_case_1\":\"जोखिम के आधार पर एक या कई GitHub pull request की समीक्षा करें, केंद्रित निष्कर्ष जाँचें और केवल प्रकाशित करने योग्य टिप्पणियाँ तैयार रखें।\"},\"views\":{\"learningView\":{\"cancel\":\"रद्द करो\",\"confirm_merge_one\":\"{{count}} सीख नियम-समूह में मिला दें?\",\"confirm_merge_other\":\"{{count}} सीखें नियम-समूह में मिला दें?\",\"consolidate\":\"एक साथ मिलाओ\",\"consolidate_pending_one\":\"{{namespace}} में {{count}} बाकी सीख मिलाओ\",\"consolidate_pending_other\":\"{{namespace}} में {{count}} बाकी सीखें मिलाओ\",\"consolidating\":\"मिलाया जा रहा है…\",\"learning\":\"सीख\",\"loaded_during_reviews\":\"समीक्षाओं में लोड होता है\",\"loading_learnings\":\"सीख लोड हो रही है…\",\"merge_failed_ruleset_unchanged\":\"मिलाना विफल रहा — नियम-समूह नहीं बदला\",\"not_loaded\":\"लोड नहीं होता\",\"nothing_consolidated_yet_reviews_in_this_namespa\":\"अभी कुछ भी मिलाया नहीं गया — इस namespace की समीक्षाएँ फ़िलहाल कोई सीखा हुआ पैटर्न लोड नहीं करतीं।\",\"nothing_staged_new_learnings_land_here_when_a_re\":\"कुछ भी तैयार नहीं है। नई सीख यहाँ आती है जब कोई समीक्षा किसी रिलीज़ हुए सुधार या मानी गई समीक्षा टिप्पणी को परखती है।\",\"pattern_one\":\"{{count}} पैटर्न\",\"pattern_other\":\"{{count}} पैटर्न\",\"pending_consolidation\":\"मिलाना बाकी ·\",\"pick_a_namespace_in_the_sidebar_to_read_the_patt\":\"साइडबार में कोई namespace चुनो, ताकि उससे समीक्षाएँ जो पैटर्न लोड करती हैं वे पढ़ सको।\",\"reviews_read_the_consolidated_ruleset_below_neve\":\"समीक्षाएँ नीचे दिया मिलाया हुआ नियम-समूह पढ़ती हैं, बाकी पड़े उम्मीदवार कभी नहीं। मिलाने पर जो तैयार है वह उसी में जुड़ जाता है — यह एक बार का AI मिलान है जिसे तुम चलाते हो, तो जब तक तुम इसे नहीं चलाते समीक्षाओं को दिखने वाला कुछ नहीं बदलता।\",\"ruleset\":\"नियम-समूह ·\"},\"settingsView\":{\"default_agent_config\":\"डिफ़ॉल्ट (एजेंट कॉन्फ़िग)\",\"default_model_provider\":\"डिफ़ॉल्ट (मॉडल / प्रदाता)\",\"higher_effort_finds_more_costs_more_and_takes_lo\":\"ज़्यादा मेहनत ज़्यादा ढूँढती है, ज़्यादा खर्च करती है, और हर pull request पर ज़्यादा वक़्त लेती है। डिफ़ॉल्ट पर मॉडल या प्रदाता तय करता है।\",\"how_many_pull_requests_are_reviewed_in_parallel\":\"साझा worker रनटाइम पर एक साथ कितने pull request समीक्षित होते हैं। समीक्षा की रफ़्तार की असली सीमा यही है — कई समीक्षा सूत्र एक साथ खुले रह सकते हैं, पर वे सब इसी बजट से लेते हैं।\",\"loading_settings\":\"सेटिंग लोड हो रही है…\",\"model\":\"मॉडल\",\"reasoning_effort\":\"तर्क की मेहनत\",\"review_model\":\"समीक्षा का मॉडल\",\"reviews_at_once\":\"एक साथ समीक्षाएँ\",\"settings\":\"सेटिंग\",\"these_apply_to_every_review_started_from_here\":\"यह यहाँ से शुरू होने वाली हर समीक्षा पर लागू होता है।\",\"which_model_performs_the_review_default_inherits\":\"समीक्षा कौन सा मॉडल करता है। डिफ़ॉल्ट एजेंट कॉन्फ़िग से आता है, तो अपना डिफ़ॉल्ट मॉडल बदलने पर यह भी बदल जाता है।\"}},\"workspace\":{\"drag_to_resize\":\"आकार बदलने के लिए खींचो\",\"resize_sidebar\":\"साइडबार का आकार बदलो\",\"select_a_review_to_see_its_progress_and_report\":\"किसी समीक्षा की प्रगति और रिपोर्ट देखने के लिए उसे चुनो।\",\"start_a_new_one_several_can_run_at_once\":\"नई शुरू करो — कई एक साथ चल सकती हैं।\"}},\"issueRadar\":{\"components\":{\"prDetail\":{\"labels\":\"लेबल\"}}}}"),
		components: { "resizeHandle": { "drag_to_resize": "आकार बदलने के लिए खींचें" } },
		lib: { "scriptLabel": {
			"cyrillic": "सिरिलिक अक्षर",
			"greek": "ग्रीक अक्षर",
			"latin": "लैटिन अक्षर",
			"other": "वर्ण"
		} }
	},
	it: {
		app: {
			"collapse_sidebar": "Comprimi la barra laterale",
			"expand_sidebar": "Espandi la barra laterale"
		},
		apps: /* @__PURE__ */ JSON.parse("{\"codeReviewSage\":{\"codeReviewSagePage\":{\"open_pr_many\":\"{{count}} PR aperte\",\"open_pr_one\":\"{{count}} PR aperta\",\"open_pr_other\":\"{{count}} PR aperte\",\"pattern_many\":\"{{count}} pattern\",\"pattern_one\":\"{{count}} pattern\",\"pattern_other\":\"{{count}} pattern\"},\"components\":{\"addReposModal\":{\"add\":\"Aggiungi\",\"add_one_by_url_above\":\"Aggiungine uno per URL qui sopra.\",\"add_repo\":\"Aggiungi {{repo}}\",\"add_repos\":\"Aggiungi repo\",\"added\":\"aggiunto\",\"all_your_repos\":\"Tutti i tuoi repo\",\"already_added\":\"{{repo}} è già aggiunto\",\"archived\":\"archiviato\",\"based_on_recent_github_activity\":\"In base alla tua attività recente su GitHub\",\"close\":\"Chiudi\",\"close_add_repos_dialog\":\"Chiudi la finestra per aggiungere repo\",\"contributed_events_many\":\"{{age}} · {{count}} eventi\",\"contributed_events_one\":\"{{age}} · {{count}} evento\",\"contributed_events_other\":\"{{age}} · {{count}} eventi\",\"filter_your_repos\":\"Filtra i tuoi repo\",\"gh_auth_login\":\"gh auth login\",\"github_cli_not_ready\":\"GitHub CLI non è pronta\",\"newest_100_by_push_date\":\"i 100 più recenti per data di invio\",\"no_repos_for_account\":\"Nessun repo trovato per il tuo account.\",\"no_repos_match_filter\":\"Nessun repo corrisponde al tuo filtro.\",\"owner_repo_a_repo_url_or_paste_a_pull_request_li\":\"owner/repo, un URL di repo, oppure incolla un link a una pull request\",\"pick_from_the_repos_you_can_reach_or_type_one_in\":\"Scegli tra i repo che puoi raggiungere, oppure scrivine uno. I repo aggiunti compaiono nella barra laterale, così puoi avviare una revisione da lì. Incolla un link a una pull request e quella pull request si apre direttamente.\",\"pinned_to_the_sidebar\":\"fissato nella barra laterale\",\"private\":\"Privato\",\"pushed_age\":\"inviato {{age}}\",\"re_read_your_repos_from_github\":\"Rileggi i tuoi repo da GitHub\",\"read_only\":\"sola lettura\",\"read_only_access\":\"Accesso in sola lettura\",\"reading_your_repos_from_github\":\"Lettura dei tuoi repo da GitHub…\",\"recently_worked_on\":\"Lavorati di recente\",\"refresh_your_repos\":\"Aggiorna i tuoi repo\",\"remove\":\"Rimuovi\",\"remove_repo\":\"Rimuovi {{repo}}\",\"repository_or_pull_request_url_or_owner_repo\":\"URL del repository o della pull request, oppure owner/repo\",\"setup_hint\":\"Installa GitHub CLI e accedi con il comando qui sotto per elencare i tuoi repo. Puoi comunque aggiungere qualsiasi repo per URL qui sopra.\",\"these_lists_are_capped_so_a_repo_you_have_not_to\":\"Queste liste hanno un limite, quindi un repo che non tocchi da un po' potrebbe mancare. Aggiungilo per URL qui sopra se non lo vedi.\",\"your_repos\":\"I tuoi repo\"},\"bandChips\":{\"all\":\"Tutte\",\"clean\":\"Nessun rilievo\",\"filter_by_band\":\"Filtra per categoria\",\"needs_review\":\"Da esaminare\",\"worth_a_glance\":\"Merita un'occhiata\"},\"draftReviewActions\":{\"approve\":\"Approva\",\"approve_is_unavailable_because_this_base_branch_\":\"Approva non è disponibile perché il branch di base di questa pull request non annulla le approvazioni quando vengono inviati nuovi commit (o la sua protezione non è leggibile da qui). Senza questo, un'approvazione potrebbe sopravvivere al commit che ha revisionato. Approva su GitHub.\",\"approve_is_unavailable_while_auto_merge_is_armed\":\"Approva non è disponibile mentre l'unione automatica è attiva: un'approvazione potrebbe unire questa pull request prima che un controllo dell'head possa ritirarla. Disattiva l'unione automatica o approva su GitHub.\",\"ask_agent_about_this_failure\":\"Chiedi all'agente di questo errore\",\"cancel\":\"Annulla\",\"confirm_approve\":\"Approvare questa pull request?\",\"confirm_request_changes\":\"Pubblicare questa revisione richiedendo modifiche?\",\"confirm_submit_as_comment\":\"Inviare questa revisione come commento?\",\"couldn_t_check_for_a_draft_review_on_this_pull_r\":\"Non è stato possibile verificare la presenza di una revisione in bozza su questa pull request. Di solito è un problema di autenticazione della CLI di GitHub, non una bozza mancante.\",\"draft_review\":\"Revisione in bozza\",\"no_draft_review_on_this_pull_request\":\"Nessuna revisione in bozza su questa pull request.\",\"pending_only_you_can_see_it_until_you_publish\":\"In sospeso: solo tu puoi vederla finché non la pubblichi.\",\"publish_failed\":\"Non è stato possibile pubblicare la revisione\",\"published_as\":\"Pubblicata come\",\"published_verdict_approved\":\"approvata\",\"published_verdict_changes_requested\":\"modifiche richieste\",\"published_verdict_comment\":\"un commento\",\"publishing\":\"Pubblicazione…\",\"publishing_is_blocked_a_later_review_replaced_th\":\"Pubblicazione bloccata: una revisione successiva ha sostituito questa bozza nella pull request, quindi non contiene più i risultati di questa revisione. Apri la revisione più recente per pubblicarla.\",\"publishing_is_blocked_this_draft_contains_conten\":\"La pubblicazione è bloccata: questa bozza contiene contenuti da oscurare e inviarla pubblicherebbe il testo originale. Modifica o elimina la bozza su GitHub.\",\"publishing_is_blocked_this_draft_was_written_aga\":\"La pubblicazione è bloccata: questa bozza è stata scritta su un commit precedente e la pull request è cambiata da allora. Rivedi prima l'head attuale.\",\"publishing_is_blocked_this_review_is_still_runni\":\"La pubblicazione è bloccata: questa revisione è ancora in corso, quindi la bozza su questa pull request proviene da un'esecuzione precedente.\",\"publishing_is_irreversible_and_visible_to_everyo\":\"La pubblicazione è irreversibile e visibile a tutti nella pull request.\",\"request_changes\":\"Richiedi modifiche\",\"submit_as_comment\":\"Invia come commento\",\"this_draft_has_no_summary_body\":\"Questa bozza non ha un corpo riassuntivo.\",\"try_again\":\"Riprova\"},\"failureNotice\":{\"run_it_again\":\"Esegui di nuovo\",\"starting\":\"Avvio…\",\"this_review_failed\":\"Questa revisione è fallita\"},\"findingCard\":{\"cancel_dismiss\":\"Annulla\",\"confirm_dismiss\":\"Ignora rilievo\",\"consequence\":\"Conseguenza\",\"dismiss\":\"Ignora\",\"dismiss_failed\":\"Impossibile salvare. Riprova.\",\"dismiss_reason_label\":\"Perché ignori questo rilievo?\",\"dismiss_reason_placeholder\":\"Ad esempio: falso positivo, fuori ambito\",\"dismissed_reason\":\"Ignorato: {{reason}}\",\"evidence\":\"Prova\",\"observation\":\"Osservazione\",\"post_finding\":\"Pubblica questo rilievo sulla pull request\",\"post_finding_on\":\"Pubblica questo rilievo su {{target}}\",\"post_this_comment\":\"Pubblica questo commento\",\"posted_to_the_pull_request\":\"Pubblicato sulla pull request\",\"posting\":\"Pubblicazione…\",\"select_to_draft_together\":\"Seleziona per la bozza in blocco\",\"select_to_post\":\"Seleziona {{label}} da pubblicare\",\"severity_must_fix\":\"Obbligatorio\",\"severity_should_fix\":\"Consigliato\",\"suggestion\":\"Suggerimento\",\"this_finding\":\"questo rilievo\",\"undo_dismiss\":\"Ripristina\",\"undo_dismiss_failed\":\"Impossibile ripristinare. Il rilievo resta scartato.\"},\"learningRail\":{\"add_namespace\":\"Aggiungi namespace\",\"confirm_delete\":\"Eliminare «{{name}}» e tutto ciò che ha imparato? Non si può annullare.\",\"delete_2\":\"Elimina\",\"delete_namespace\":\"Elimina il namespace {{name}}\",\"invalid_namespace_name\":\"I nomi dei namespace diventano nomi di cartella, quindi possono contenere solo lettere latine minuscole (a–z), cifre (0–9), punti, trattini e trattini bassi, devono iniziare e finire con una lettera o una cifra e avere da 2 a 64 caratteri.\",\"invalid_namespace_name_char\":\"«{{char}}» non può essere usato nel nome di un namespace. Usa lettere minuscole a–z, 0–9, .\xA0-⁠\xA0_\",\"invalid_namespace_name_letter\":\"«{{char}}» ({{script}}, {{code}}) non può essere usato nel nome di un namespace. Usa lettere minuscole a–z, 0–9, .\xA0-⁠\xA0_\",\"keep_it\":\"Conservalo\",\"load_namespace_during_reviews\":\"Carica il namespace {{name}} durante le revisioni\",\"loading\":\"Caricamento…\",\"namespace_active\":\"Attivo — caricato durante le revisioni (togli la spunta per disattivarlo)\",\"namespace_inactive\":\"Inattivo — spunta per caricarlo durante le revisioni\",\"namespaces\":\"Namespace\",\"new_namespace\":\"Nuovo namespace\",\"new_namespace_2\":\"new-namespace\",\"new_namespace_name\":\"Nome del nuovo namespace\",\"pattern_many\":\"{{count}} schemi\",\"pattern_one\":\"{{count}} schema\",\"pattern_other\":\"{{count}} schemi\",\"pending_count_many\":\"{{count}} in attesa\",\"pending_count_one\":\"{{count}} in attesa\",\"pending_count_other\":\"{{count}} in attesa\",\"read_namespace\":\"Leggi il namespace {{name}}\"},\"leftRail\":{\"code_review_sage\":\"Code Review Sage\",\"learning\":\"Apprendimento\",\"reviews\":\"Revisioni\",\"sections\":\"Sezioni\",\"settings\":\"Impostazioni\",\"version\":\"v{{version}}\"},\"listSkeleton\":{\"loading_reviews\":\"Caricamento delle revisioni…\"},\"middleColumn\":{\"all_repos\":\"Tutti i repo\",\"just_this_repo\":\"Solo {{repo}}\",\"lists_label\":\"Pull request o revisioni\",\"no_reviews_for_repo\":\"Nessuna revisione per {{repo}}\",\"no_reviews_yet\":\"Ancora nessuna revisione\",\"pick_a_repo_then_a_pr\":\"Scegli un repo, poi una pull request.\",\"pull_requests\":\"Pull request\",\"repo_lists_label\":\"{{repo}}: pull request o revisioni\",\"repo_reviews_appear_here\":\"Le revisioni che avvii per questo repo compaiono qui.\",\"reviews\":\"Revisioni\",\"show_all_count\":\"Mostra tutte ({{count}})\",\"this_repo_only\":\"solo {{repo}}\"},\"postCommentsButton\":{\"cancel\":\"Annulla\",\"confirm_post_many\":\"Pubblicare {{count}} commenti sulla pull request?\",\"confirm_post_one\":\"Pubblicare {{count}} commento sulla pull request?\",\"confirm_post_other\":\"Pubblicare {{count}} commenti sulla pull request?\",\"drafted_publish_on_pr_page_many\":\"{{count}} commenti redatti: apri qui la pull request per pubblicarli\",\"drafted_publish_on_pr_page_one\":\"{{count}} commento redatto: apri qui la pull request per pubblicarlo\",\"drafted_publish_on_pr_page_other\":\"{{count}} commenti redatti: apri qui la pull request per pubblicarli\",\"post_action\":\"Pubblica\",\"post_count_many\":\"Pubblica {{count}} commenti\",\"post_count_one\":\"Pubblica {{count}} commento\",\"post_count_other\":\"Pubblica {{count}} commenti\",\"post_failed\":\"Pubblicazione fallita\",\"posted_age\":\"Pubblicato {{age}}\",\"posted_comments_many\":\"{{count}} commenti pubblicati\",\"posted_comments_one\":\"{{count}} commento pubblicato\",\"posted_comments_other\":\"{{count}} commenti pubblicati\",\"posting\":\"Pubblicazione…\",\"publish_these_findings_as_a_review_on_the_pull_r\":\"Pubblica questi rilievi come revisione sulla pull request\"},\"prPickList\":{\"a_review_of_this_pull_request_is_running\":\"È in corso una revisione di questa pull request\",\"add_a_repo\":\"Aggiungi un repo\",\"already_reviewed\":\"Già revisionata\",\"cancel\":\"Annulla\",\"confirm_review_all\":\"Rivedere tutte le {{count}} pull request?\",\"draft\":\"bozza\",\"filter_pull_requests\":\"Filtra le pull request\",\"new\":\"nuova\",\"no_open_prs_here\":\"Qui non ci sono pull request aperte.\",\"no_prs_match_filter\":\"Nessuna pull request corrisponde al tuo filtro.\",\"one_or_more_github_pr_links\":\"Uno o più link a PR di GitHub\",\"open_pr\":\"Apri la pull request #{{number}}: {{title}}\",\"paste_pr_links\":\"Incolla link a PR\",\"paste_pr_links_instead\":\"Incolla invece link a PR\",\"pick_a_repo_to_see_its_pull_requests\":\"Scegli un repo per vedere le sue pull request.\",\"pr_already_being_reviewed\":\"La pull request #{{number}} è già in revisione\",\"re_read_open_prs_from_github\":\"Rileggi le PR aperte da GitHub\",\"refresh_pull_requests\":\"Aggiorna le pull request\",\"repos_live_in_the_sidebar\":\"I repo stanno nella barra laterale.\",\"review_all_count\":\"Rivedi tutte {{count}}\",\"review_every_open_pr_not_yet_reviewed_at_its_cur\":\"Revisiona ogni PR aperta non ancora revisionata sul suo head attuale\",\"review_pr\":\"Revisiona la pull request #{{number}}: {{title}}\",\"review_selected_count_many\":\"Esamina {{count}} selezionati\",\"review_selected_count_one\":\"Esamina {{count}} selezionato\",\"review_selected_count_other\":\"Esamina {{count}} selezionati\",\"review_these\":\"Revisiona queste\",\"reviewed\":\"revisionata\",\"reviewed_age\":\"Revisionata {{age}}\",\"reviewed_before_the_head_commit_has_moved_since\":\"Già revisionata — da allora il commit head è cambiato\",\"reviewing\":\"in revisione\",\"updated\":\"aggiornata\"},\"prReviewDetail\":{\"author\":\"Autore\",\"cancelled_before_finishing\":\"È stata annullata prima che questa finisse.\",\"did_not_complete_for_this_change\":\"La revisione non è stata completata per questa modifica.\",\"draft\":\"bozza\",\"findings_appear_here_as_soon_as_the_review_finis\":\"I rilievi compaiono qui appena la revisione finisce. Puoi lasciare la pagina — una notifica ti dirà quando arriva.\",\"head\":\"head\",\"loading_pull_request_details\":\"Caricamento dei dettagli della pull request…\",\"loading_review\":\"Caricamento della revisione…\",\"nothing_flagged_on_this_pull_request\":\"Non è stato segnalato nulla su questa pull request.\",\"open_on_github\":\"Apri su GitHub\",\"pull_request\":\"Pull request\",\"pull_request_detail\":\"Dettaglio della pull request\",\"retry_review\":\"Riprova la revisione\",\"review\":\"Revisiona\",\"review_again\":\"Revisiona di nuovo\",\"review_again_at_current_head\":\"Revisiona di nuovo questa pull request sul suo head attuale\",\"review_already_running\":\"È già in corso una revisione di questa pull request\",\"review_completed_with_no_findings\":\"La revisione è finita e non ha prodotto rilievi che valgano il tuo tempo.\",\"review_this_pull_request\":\"Revisiona questa pull request\",\"reviewing\":\"In revisione…\",\"running\":\"in corso\",\"sage_review\":\"Revisione Sage\",\"see_the_reason_above\":\"Vedi il motivo qui sopra.\",\"start_a_review_and_its_findings_appear_here_you\":\"Avvia una revisione e i suoi rilievi compariranno qui — puoi lasciare la pagina, una notifica ti dirà quando arriva.\",\"that_review_produced_no_report_for_this_pull_req\":\"Quella revisione non ha prodotto alcun report per questa pull request.\",\"this_pull_request_has_not_been_reviewed_yet\":\"Questa pull request non è ancora stata revisionata.\",\"updated\":\"aggiornata\"},\"prSourcePanel\":{\"load_failed\":\"Non è stato possibile caricare i dettagli della pull request: {{reason}}\",\"partial_sections\":\"Alcune sezioni sono incomplete ({{sections}}) — la richiesta al provider è fallita o ha raggiunto un limite di pagina.\"},\"prStatusChips\":{\"all_checks_passed_many\":\"tutti i {{count}} controlli superati\",\"all_checks_passed_one\":\"{{count}} controllo superato\",\"all_checks_passed_other\":\"tutti i {{count}} controlli superati\",\"checks_failing_many\":\"{{failed}} controlli su {{count}} in errore\",\"checks_failing_one\":\"{{failed}} controllo su {{count}} in errore\",\"checks_failing_other\":\"{{failed}} controlli su {{count}} in errore\",\"checks_running_many\":\"{{pending}} controlli su {{count}} ancora in corso\",\"checks_running_one\":\"{{pending}} controllo su {{count}} ancora in corso\",\"checks_running_other\":\"{{pending}} controlli su {{count}} ancora in corso\",\"closed\":\"chiusa\",\"conflicts\":\"conflitti\",\"failing_count_many\":\"{{count}} non superati\",\"failing_count_one\":\"{{count}} non superato\",\"failing_count_other\":\"{{count}} non superati\",\"merge_blocked\":\"merge bloccato\",\"merged\":\"merged\",\"open\":\"aperta\",\"passed_count_many\":\"{{count}} superati\",\"passed_count_one\":\"{{count}} superato\",\"passed_count_other\":\"{{count}} superati\",\"running_count_many\":\"{{count}} in corso\",\"running_count_one\":\"{{count}} in corso\",\"running_count_other\":\"{{count}} in corso\"},\"repoSwitcher\":{\"add_a_repo\":\"Aggiungi un repo\",\"all_repos\":\"Tutti i repo\",\"filter_repos\":\"Filtra i repo\",\"filter_repositories\":\"Filtra i repository\",\"loading\":\"Caricamento…\",\"no_repo_matches_that\":\"Nessun repo corrisponde.\",\"no_repos_yet_add_one_to_pick_from_the_repos_you\":\"Ancora nessun repo — aggiungine uno per scegliere tra i repo su cui lavori.\",\"pick_a_repo\":\"Scegli un repo\",\"pick_a_repository\":\"Scegli un repository\",\"recent\":\"Recenti\",\"repositories\":\"Repository\",\"repository_named\":\"Repository: {{name}}\"},\"reportView\":{\"blast_radius\":\"Ambito di impatto: {{scope}}\",\"blocking_count_many\":\"{{count}} bloccanti\",\"blocking_count_one\":\"{{count}} bloccante\",\"blocking_count_other\":\"{{count}} bloccanti\",\"changes_reviewed_many\":\"{{count}} modifiche revisionate\",\"changes_reviewed_one\":\"{{count}} modifica revisionata\",\"changes_reviewed_other\":\"{{count}} modifiche revisionate\",\"clear\":\"Azzera\",\"design_gate\":\"Gate di design ·\",\"design_risk\":\"Rischio di progettazione: {{level}}\",\"draft_selected_many\":\"Redigi {{count}} rilievi selezionati\",\"draft_selected_one\":\"Redigi {{count}} rilievo selezionato\",\"draft_selected_other\":\"Redigi {{count}} rilievi selezionati\",\"finding_dimension_in_file\":\"{{dimension}} in {{file}}\",\"generated\":\"· generato\",\"moved_to\":\"Ora in {{band}}. Resta al suo posto finché non cambi il filtro.\",\"no_changes_in_this_band\":\"Nessuna modifica in questa categoria.\",\"nothing_flagged_in_this_review\":\"Non è stato segnalato nulla in questa revisione.\",\"open_shared_copy\":\"Apri la copia condivisa\",\"open_the_pull_request\":\"Apri la pull request\",\"share\":\"Condividi\",\"sharing\":\"Condivisione…\",\"should_fix_count_many\":\"{{count}} da correggere\",\"should_fix_count_one\":\"{{count}} da correggere\",\"should_fix_count_other\":\"{{count}} da correggere\",\"step_problem\":\"Problema\",\"step_solution_fit\":\"Adeguatezza della soluzione\",\"step_why_it_matters\":\"Perché è importante\"},\"reviewChat\":{\"continue_hint\":\"La conversazione con questo revisore prosegue nella schermata Chat.\",\"continue_session\":\"Continua la sessione di follow-up\",\"earlier_questions\":\"Domande precedenti\",\"error_generic\":\"Non è stato possibile aprire la sessione di follow-up. Riprova.\",\"error_run_deleted\":\"Questa revisione è stata eliminata, quindi la conversazione è terminata.\",\"loading\":\"Caricamento…\",\"new_session_unavailable\":\"Questa app non può ancora aprire una nuova sessione di approfondimento: serve un Kiro Crew che permetta a un’app di aprire una sessione di chat con un nome. Una sessione di approfondimento già aperta si può ancora continuare.\",\"not_recorded_notice\":\"Questa revisione non ha conservato una sessione del revisore, quindi non c'è nulla da riaprire. Rivedi di nuovo questa pull request per fare domande.\",\"open_session\":\"Apri una sessione di follow-up\",\"opening\":\"Apertura…\",\"ran_tools\":\"Ha esaminato: {{tools}}\",\"reasoning\":\"Ragionamento\",\"refused_notice\":\"Per rispondere in modo completo doveva eseguire uno strumento e non è stato autorizzato, quindi questa risposta è limitata. Attiva YOLO per consentirlo.\",\"resume_hint\":\"Apre una chat che riprende il revisore, con il ragionamento dietro i suoi rilievi.\",\"role_reviewer\":\"Revisore\",\"role_you\":\"Tu\",\"run_live_notice\":\"Questa revisione è ancora in corso. I rilievi possono cambiare fino al termine, quindi non c'è ancora nulla da chiedere.\",\"title\":\"Chiedi al revisore\",\"transcript_gone_notice\":\"La sessione del revisore non è più su disco, quindi non c'è nulla da riaprire. Rivedi di nuovo questa pull request per fare domande.\"},\"reviewQueue\":{\"empty\":\"Nessuna pull request attende la tua revisione.\",\"filter_by_repo\":\"Filtra per repository o titolo\",\"setup_required\":\"Configura la CLI di GitHub per vedere le richieste di revisione\",\"starts_review\":\"Ogni scelta avvia una revisione di Sage. I risultati compaiono in Revisioni e vengono pubblicati su GitHub solo se lo decidi tu.\",\"starts_review_truncated\":\"Sono mostrate solo le 100 richieste più recenti. Ogni scelta avvia una revisione di Sage. I risultati compaiono in Revisioni e vengono pubblicati su GitHub solo se lo decidi tu.\",\"tab\":\"Richieste\"},\"runCard\":{\"cancel\":\"Annulla\",\"clean\":\"Pulita\",\"delete\":\"Elimina\",\"delete_review_of\":\"Elimina la revisione di {{label}}\",\"delete_this_review\":\"Elimina questa revisione\",\"delete_this_review_2\":\"Eliminare questa revisione?\",\"more_count_many\":\"+{{count}} altre\",\"more_count_one\":\"+{{count}} altra\",\"more_count_other\":\"+{{count}} altre\",\"needs_review_count_many\":\"{{count}} da revisionare\",\"needs_review_count_one\":\"{{count}} da revisionare\",\"needs_review_count_other\":\"{{count}} da revisionare\",\"pull_requests\":\"pull request\",\"review\":\"Revisione\",\"review_of\":\"Revisione di {{label}}\",\"review_of_with_more_many\":\"Revisione di {{label}} e altre {{count}}\",\"review_of_with_more_one\":\"Revisione di {{label}} e altre {{count}}\",\"review_of_with_more_other\":\"Revisione di {{label}} e altre {{count}}\",\"worth_a_glance_count_many\":\"{{count}} meritano uno sguardo\",\"worth_a_glance_count_one\":\"{{count}} merita uno sguardo\",\"worth_a_glance_count_other\":\"{{count}} meritano uno sguardo\"},\"runDetail\":{\"cancelled_before_any_finished\":\"È stata annullata prima che qualsiasi pull request finisse.\",\"finished\":\"finita\",\"loading_report\":\"Caricamento del report…\",\"more_count_many\":\"+{{count}} altre\",\"more_count_one\":\"+{{count}} altra\",\"more_count_other\":\"+{{count}} altre\",\"nothing_to_report\":\"Nessuna pull request ha completato una revisione, quindi non c'era nulla da riportare.\",\"pull_request_many\":\"{{count}} pull request\",\"pull_request_one\":\"{{count}} pull request\",\"pull_request_other\":\"{{count}} pull request\",\"report_appears_when_the_review_finishes\":\"Il report compare qui appena la revisione finisce.\",\"skipped_inflight_many\":\"{{count}} pull request sono state saltate perché un'altra revisione le aveva già.\",\"skipped_inflight_one\":\"{{count}} pull request è stata saltata perché un'altra revisione l'aveva già.\",\"skipped_inflight_other\":\"{{count}} pull request sono state saltate perché un'altra revisione le aveva già.\",\"started\":\"avviata\",\"this_review_produced_no_report\":\"Questa revisione non ha prodotto alcun report.\",\"you_can_leave_this_page_a_notification_will_tell\":\"Puoi lasciare questa pagina — una notifica ti dirà quando arriva.\"},\"runList\":{\"new_review\":\"Nuova revisione\"},\"runProgress\":{\"cancel_review\":\"Annulla la revisione\",\"cancelled_count_many\":\"{{count}} annullate\",\"cancelled_count_one\":\"{{count}} annullata\",\"cancelled_count_other\":\"{{count}} annullate\",\"cancelling\":\"Annullamento…\",\"elapsed_time\":\"Tempo trascorso\",\"failed_count_many\":\"{{count}} fallite\",\"failed_count_one\":\"{{count}} fallita\",\"failed_count_other\":\"{{count}} fallite\",\"median_of_past_runs_of_this_size\":\"Mediana delle esecuzioni passate di questa dimensione\",\"review_progress\":\"Avanzamento della revisione\",\"reviewed_of_many\":\"{{done}} / {{count}} revisionate\",\"reviewed_of_one\":\"{{done}} / {{count}} revisionata\",\"reviewed_of_other\":\"{{done}} / {{count}} revisionate\",\"reviewers_busy\":\"{{busy}} revisori su {{max}} occupati\",\"step\":\"· passo\",\"stops_queued_prs_one_already_being_reviewed_will\":\"Ferma le PR in coda; quella già in revisione finirà.\",\"usually\":\"di solito ~\",\"working\":\"Al lavoro\"},\"runStatusPill\":{\"cancelled\":\"Annullato\",\"cancelling\":\"Annullamento\",\"done\":\"Completato\",\"error\":\"Errore\",\"interrupted\":\"Interrotto\",\"running\":\"In corso\"},\"shipSummaryCard\":{\"post_the_ship_readiness_summary\":\"Pubblica il riepilogo di prontezza al rilascio\",\"post_this_comment\":\"Pubblica questo commento\",\"posted_as_a_top_level_comment\":\"pubblicato come commento di primo livello\",\"posted_to_the_pull_request\":\"Pubblicato sulla pull request\",\"posting\":\"Pubblicazione…\",\"select_the_ship_readiness_summary_to_post\":\"Seleziona il riepilogo di prontezza al rilascio da pubblicare\",\"ship_readiness_summary\":\"Riepilogo di prontezza al rilascio\"}},\"lib\":{\"format\":{\"cause_no_agent_cli\":\"Il revisore non è mai partito — su questo host non è stato trovato alcun eseguibile kiro-cli. Installalo, o aggiungilo a PATH.\",\"cause_no_record\":\"Il revisore ha finito ma non ha registrato alcun rilievo.\",\"cause_record_incomplete\":\"Il revisore ha scritto un record di rilievi ma si è fermato prima di completare la revisione.\",\"cause_runtime_died\":\"Il processo del revisore si è fermato a metà revisione — di solito perché il gateway si è riavviato. Non c'era nulla di sbagliato nella pull request.\",\"cause_runtime_not_importable\":\"Il revisore non è mai partito — questa installazione non riesce a caricare il runtime dell'agente che le serve. Ripara l'installazione per ripristinarlo.\",\"cause_runtime_unavailable\":\"Il revisore non è mai partito — il suo runtime dell'agente non è disponibile su questo host.\",\"cause_timeout\":\"La revisione ha superato il suo limite di tempo.\",\"cause_turn_failed\":\"Il turno di revisione è fallito prima di registrare qualcosa.\",\"cause_unknown\":\"La revisione non è stata completata.\",\"days_ago_many\":\"{{count}} g fa\",\"days_ago_one\":\"{{count}} g fa\",\"days_ago_other\":\"{{count}} g fa\",\"hours_ago_many\":\"{{count}} h fa\",\"hours_ago_one\":\"{{count}} h fa\",\"hours_ago_other\":\"{{count}} h fa\",\"just_now\":\"proprio ora\",\"minutes_ago_many\":\"{{count}} min fa\",\"minutes_ago_one\":\"{{count}} min fa\",\"minutes_ago_other\":\"{{count}} min fa\",\"phase_cancelled\":\"Annullata\",\"phase_done\":\"Fatta\",\"phase_failed\":\"Fallita\",\"phase_pending\":\"In attesa\",\"phase_queued\":\"In coda\",\"phase_reviewing\":\"In revisione\"}},\"manifest\":{\"configuration_1\":\"Installa e autentica la CLI gh sull'host del gateway, aggiungi un repository, quindi scegli in Impostazioni il modello di revisione, il livello di ragionamento e la concorrenza.\",\"description\":\"Analizza in profondità le pull request di GitHub e ti dice quali modifiche meritano davvero attenzione. Ogni pull request viene revisionata in una sessione di agente isolata che copre tutti i file modificati, pesati in base al raggio d’impatto che ha, e tutto viene riunito in un report di focus con le priorità. I rilievi si leggono nell’app e vengono preparati come revisione GitHub in bozza solo quando li pubblichi o attivi la pubblicazione automatica, e il revisore continua a imparare gli standard reali del tuo repository dalle correzioni già rilasciate e dai commenti di revisione passati.\",\"display_name\":\"Code Review Sage\",\"highlight_1\":\"Il report di focus ordina le modifiche per raggio d’impatto, così i file rischiosi vengono letti per primi\",\"highlight_2\":\"Una sessione di agente isolata per ogni pull request, così i rilievi non si mescolano mai tra revisioni\",\"highlight_3\":\"Le revisioni si leggono nell’app: nulla viene pubblicato nella tua pull request se non lo chiedi\",\"highlight_4\":\"Impara per singolo repository dalle correzioni rilasciate, dai commenti di revisione e dalle discussioni di design\",\"highlight_5\":\"Revisiona le pull request di GitHub; richiede una CLI `gh` autenticata sull’host del gateway\",\"page_label\":\"Code Review Sage\",\"use_case_1\":\"Revisiona una o più pull request GitHub in base al rischio, esamina i risultati mirati e prepara solo i commenti che vale la pena pubblicare.\"},\"views\":{\"learningView\":{\"cancel\":\"Annulla\",\"confirm_merge_many\":\"Unire {{count}} apprendimenti nell'insieme di regole?\",\"confirm_merge_one\":\"Unire {{count}} apprendimento nell'insieme di regole?\",\"confirm_merge_other\":\"Unire {{count}} apprendimenti nell'insieme di regole?\",\"consolidate\":\"Consolida\",\"consolidate_pending_many\":\"Consolida {{count}} apprendimenti in attesa in {{namespace}}\",\"consolidate_pending_one\":\"Consolida {{count}} apprendimento in attesa in {{namespace}}\",\"consolidate_pending_other\":\"Consolida {{count}} apprendimenti in attesa in {{namespace}}\",\"consolidating\":\"Consolidamento…\",\"learning\":\"Apprendimento\",\"loaded_during_reviews\":\"caricato durante le revisioni\",\"loading_learnings\":\"Caricamento di ciò che è stato imparato…\",\"merge_failed_ruleset_unchanged\":\"Unione fallita — insieme di regole invariato\",\"not_loaded\":\"non caricato\",\"nothing_consolidated_yet_reviews_in_this_namespa\":\"Ancora nulla di consolidato — le revisioni in questo namespace al momento non caricano alcuno schema appreso.\",\"nothing_staged_new_learnings_land_here_when_a_re\":\"Nulla in preparazione. Ciò che viene imparato arriva qui quando una revisione analizza una correzione rilasciata o un commento di revisione a cui si è dato seguito.\",\"pattern_many\":\"{{count}} schemi\",\"pattern_one\":\"{{count}} schema\",\"pattern_other\":\"{{count}} schemi\",\"pending_consolidation\":\"Consolidamento in attesa ·\",\"pick_a_namespace_in_the_sidebar_to_read_the_patt\":\"Scegli un namespace nella barra laterale per leggere gli schemi che le revisioni caricano da esso.\",\"reviews_read_the_consolidated_ruleset_below_neve\":\"Le revisioni leggono l'insieme di regole consolidato qui sotto, mai i candidati in attesa. Il consolidamento unisce in esso ciò che è in preparazione — un'unione con l'IA una volta sola, che avvii tu, quindi nulla cambia ciò che vedono le revisioni finché non la esegui.\",\"ruleset\":\"Insieme di regole ·\"},\"settingsView\":{\"default_agent_config\":\"Predefinito (configurazione dell'agente)\",\"default_model_provider\":\"Predefinito (modello / provider)\",\"higher_effort_finds_more_costs_more_and_takes_lo\":\"Più impegno trova di più, costa di più e richiede più tempo per pull request. Con il valore predefinito decide il modello o il provider.\",\"how_many_pull_requests_are_reviewed_in_parallel\":\"Quante pull request vengono revisionate in parallelo sul runtime dei worker condiviso. Questo è il vero limite alla resa delle revisioni — più thread di revisione possono essere aperti insieme, ma attingono tutti da questo budget.\",\"loading_settings\":\"Caricamento delle impostazioni…\",\"model\":\"Modello\",\"reasoning_effort\":\"Impegno di ragionamento\",\"review_model\":\"Modello di revisione\",\"reviews_at_once\":\"Revisioni contemporanee\",\"settings\":\"Impostazioni\",\"these_apply_to_every_review_started_from_here\":\"Questo vale per ogni revisione avviata da qui.\",\"which_model_performs_the_review_default_inherits\":\"Quale modello esegue la revisione. Il valore predefinito eredita la configurazione dell'agente, quindi cambiare il tuo modello predefinito cambia anche questo.\"}},\"workspace\":{\"drag_to_resize\":\"Trascina per ridimensionare\",\"resize_sidebar\":\"Ridimensiona la barra laterale\",\"select_a_review_to_see_its_progress_and_report\":\"Scegli una revisione per vedere il suo avanzamento e il suo report.\",\"start_a_new_one_several_can_run_at_once\":\"Avviane una nuova — possono girarne diverse insieme.\"}},\"issueRadar\":{\"components\":{\"prDetail\":{\"labels\":\"Etichette\"}}}}"),
		components: { "resizeHandle": { "drag_to_resize": "Trascina per ridimensionare" } },
		lib: { "scriptLabel": {
			"cyrillic": "lettera cirillica",
			"greek": "lettera greca",
			"latin": "lettera latina",
			"other": "carattere"
		} }
	},
	ja: {
		app: {
			"collapse_sidebar": "サイドバーを折りたたむ",
			"expand_sidebar": "サイドバーを展開"
		},
		apps: /* @__PURE__ */ JSON.parse("{\"codeReviewSage\":{\"codeReviewSagePage\":{\"open_pr_other\":\"{{count}}個のOpen PR\",\"pattern_other\":\"{{count}}個のパターン\"},\"components\":{\"addReposModal\":{\"add\":\"追加\",\"add_one_by_url_above\":\"上の欄に URL を入力して追加してください。\",\"add_repo\":\"{{repo}} を追加\",\"add_repos\":\"リポジトリを追加\",\"added\":\"追加済み\",\"all_your_repos\":\"すべてのリポジトリ\",\"already_added\":\"{{repo}} は既に追加されています\",\"archived\":\"アーカイブ済み\",\"based_on_recent_github_activity\":\"最近の GitHub での活動に基づいています\",\"close\":\"閉じる\",\"close_add_repos_dialog\":\"リポジトリ追加ダイアログを閉じる\",\"contributed_events_other\":\"{{age}} · {{count}} 件のアクティビティ\",\"filter_your_repos\":\"リポジトリを絞り込む\",\"gh_auth_login\":\"gh auth login\",\"github_cli_not_ready\":\"GitHub CLI が利用できません\",\"newest_100_by_push_date\":\"プッシュ日時が新しい 100 件\",\"no_repos_for_account\":\"このアカウントのリポジトリが見つかりません。\",\"no_repos_match_filter\":\"条件に一致するリポジトリがありません。\",\"owner_repo_a_repo_url_or_paste_a_pull_request_li\":\"owner/repo、リポジトリの URL、またはプルリクエストのリンク\",\"pick_from_the_repos_you_can_reach_or_type_one_in\":\"アクセスできるリポジトリから選ぶか、直接入力してください。追加したリポジトリはサイドバーに表示され、そこからレビューを開始できます。プルリクエストのリンクを貼り付けると、そのプルリクエストが直接開きます。\",\"pinned_to_the_sidebar\":\"サイドバーに固定済み\",\"private\":\"プライベート\",\"pushed_age\":\"{{age}}にプッシュ\",\"re_read_your_repos_from_github\":\"GitHub からリポジトリを再読み込みする\",\"read_only\":\"読み取り専用\",\"read_only_access\":\"読み取り専用アクセス\",\"reading_your_repos_from_github\":\"GitHub からリポジトリを読み込んでいます…\",\"recently_worked_on\":\"最近作業したもの\",\"refresh_your_repos\":\"リポジトリを再取得する\",\"remove\":\"削除\",\"remove_repo\":\"{{repo}} を削除\",\"repository_or_pull_request_url_or_owner_repo\":\"リポジトリまたはプルリクエストの URL、あるいは owner/repo\",\"setup_hint\":\"リポジトリの一覧を表示するには、GitHub CLI をインストールして下のコマンドでサインインしてください。上の欄から URL でリポジトリを追加することもできます。\",\"these_lists_are_capped_so_a_repo_you_have_not_to\":\"これらの一覧には上限があるため、最近触っていないリポジトリは表示されない場合があります。見つからないときは上の欄から URL で追加してください。\",\"your_repos\":\"あなたのリポジトリ\"},\"bandChips\":{\"all\":\"すべて\",\"clean\":\"問題なし\",\"filter_by_band\":\"バンドで絞り込む\",\"needs_review\":\"要レビュー\",\"worth_a_glance\":\"一見の価値あり\"},\"draftReviewActions\":{\"approve\":\"承認\",\"approve_is_unavailable_because_this_base_branch_\":\"このプルリクエストのベースブランチは新しいコミットがプッシュされても承認を取り消さない設定のため（またはここから保護設定を読み取れないため）、承認は利用できません。そのままでは、レビュー対象のコミットより承認が長く残る可能性があります。GitHub 上で承認してください。\",\"approve_is_unavailable_while_auto_merge_is_armed\":\"自動マージが有効な間は承認できません。古いヘッドの検査が間に合う前に、承認によってこのプルリクエストがマージされる可能性があります。自動マージを解除するか、GitHub 上で承認してください。\",\"ask_agent_about_this_failure\":\"このエラーについてエージェントに尋ねる\",\"cancel\":\"キャンセル\",\"confirm_approve\":\"このプルリクエストを承認しますか？\",\"confirm_request_changes\":\"変更を要求するレビューを公開しますか？\",\"confirm_submit_as_comment\":\"このレビューをコメントとして送信しますか？\",\"couldn_t_check_for_a_draft_review_on_this_pull_r\":\"このプルリクエストの下書きレビューを確認できませんでした。通常は下書きが存在しないのではなく、GitHub CLI の認証の問題です。\",\"draft_review\":\"下書きレビュー\",\"no_draft_review_on_this_pull_request\":\"このプルリクエストに下書きレビューはありません。\",\"pending_only_you_can_see_it_until_you_publish\":\"保留中 — 公開するまであなたにしか見えません。\",\"publish_failed\":\"レビューを公開できませんでした\",\"published_as\":\"公開形式\",\"published_verdict_approved\":\"承認\",\"published_verdict_changes_requested\":\"変更を要求\",\"published_verdict_comment\":\"コメント\",\"publishing\":\"公開中…\",\"publishing_is_blocked_a_later_review_replaced_th\":\"公開はブロックされました: 後続のレビューがプルリクエスト上のこのドラフトを置き換えたため、このレビューの指摘はもう含まれていません。最新のレビューを開いて公開してください。\",\"publishing_is_blocked_this_draft_contains_conten\":\"公開できません。この下書きには秘匿すべき内容が含まれており、送信すると元のテキストが投稿されてしまいます。GitHub 上で下書きを編集または破棄してください。\",\"publishing_is_blocked_this_draft_was_written_aga\":\"公開できません。この下書きは以前のコミットに対して書かれており、その後プルリクエストが更新されています。まず現在のヘッドを再レビューしてください。\",\"publishing_is_blocked_this_review_is_still_runni\":\"公開できません。このレビューはまだ実行中のため、このプルリクエストの下書きは以前の実行のものです。\",\"publishing_is_irreversible_and_visible_to_everyo\":\"公開は取り消せず、このプルリクエストの全員に表示されます。\",\"request_changes\":\"変更を要求\",\"submit_as_comment\":\"コメントとして送信\",\"this_draft_has_no_summary_body\":\"この下書きに要約本文はありません。\",\"try_again\":\"再試行\"},\"failureNotice\":{\"run_it_again\":\"もう一度実行する\",\"starting\":\"開始しています…\",\"this_review_failed\":\"このレビューは失敗しました\"},\"findingCard\":{\"cancel_dismiss\":\"キャンセル\",\"confirm_dismiss\":\"指摘を却下\",\"consequence\":\"影響\",\"dismiss\":\"却下\",\"dismiss_failed\":\"却下を保存できませんでした。もう一度お試しください。\",\"dismiss_reason_label\":\"この指摘を却下する理由は？\",\"dismiss_reason_placeholder\":\"例：誤検出、対象外\",\"dismissed_reason\":\"却下済み：{{reason}}\",\"evidence\":\"根拠\",\"observation\":\"事象\",\"post_finding\":\"この指摘をプルリクエストに投稿する\",\"post_finding_on\":\"この指摘を {{target}} に投稿する\",\"post_this_comment\":\"このコメントを投稿する\",\"posted_to_the_pull_request\":\"プルリクエストに投稿済み\",\"posting\":\"投稿しています…\",\"select_to_draft_together\":\"一括下書き用に選択\",\"select_to_post\":\"投稿する {{label}} を選択\",\"severity_must_fix\":\"要修正\",\"severity_should_fix\":\"修正推奨\",\"suggestion\":\"提案\",\"this_finding\":\"この指摘\",\"undo_dismiss\":\"元に戻す\",\"undo_dismiss_failed\":\"元に戻せませんでした。この指摘は却下されたままです。\"},\"learningRail\":{\"add_namespace\":\"名前空間を追加\",\"confirm_delete\":\"「{{name}}」とその学習内容をすべて削除しますか？この操作は取り消せません。\",\"delete_2\":\"削除\",\"delete_namespace\":\"名前空間 {{name}} を削除\",\"invalid_namespace_name\":\"名前空間の名前はフォルダー名になるため、使用できるのは小文字のラテン文字（a–z）、数字（0–9）、ピリオド、ハイフン、アンダースコアのみです。先頭と末尾は英字か数字にし、2 文字以上 64 文字以内にする必要があります。\",\"invalid_namespace_name_char\":\"「{{char}}」は名前空間の名前に使用できません。小文字の a–z、0–9、.\xA0-⁠\xA0_ を使用してください。\",\"invalid_namespace_name_letter\":\"「{{char}}」（{{script}}、{{code}}）は名前空間の名前に使用できません。小文字の a–z、0–9、.\xA0-⁠\xA0_ を使用してください。\",\"keep_it\":\"削除しない\",\"load_namespace_during_reviews\":\"レビュー時に名前空間 {{name}} を読み込む\",\"loading\":\"読み込んでいます…\",\"namespace_active\":\"有効 — レビュー時に読み込まれます（チェックを外すと無効）\",\"namespace_inactive\":\"無効 — チェックするとレビュー時に読み込まれます\",\"namespaces\":\"名前空間\",\"new_namespace\":\"新しい名前空間\",\"new_namespace_2\":\"new-namespace\",\"new_namespace_name\":\"新しい名前空間の名前\",\"pattern_other\":\"{{count}} 件のパターン\",\"pending_count_other\":\"{{count}} 件保留中\",\"read_namespace\":\"名前空間 {{name}} を読む\"},\"leftRail\":{\"code_review_sage\":\"Code Review Sage\",\"learning\":\"学習\",\"reviews\":\"レビュー\",\"sections\":\"セクション\",\"settings\":\"設定\",\"version\":\"v{{version}}\"},\"listSkeleton\":{\"loading_reviews\":\"レビューを読み込んでいます…\"},\"middleColumn\":{\"all_repos\":\"すべてのリポジトリ\",\"just_this_repo\":\"{{repo}} のみ\",\"lists_label\":\"プルリクエストまたはレビュー\",\"no_reviews_for_repo\":\"{{repo}} のレビューはありません\",\"no_reviews_yet\":\"まだレビューはありません\",\"pick_a_repo_then_a_pr\":\"リポジトリを選び、次にプルリクエストを選んでください。\",\"pull_requests\":\"プルリクエスト\",\"repo_lists_label\":\"{{repo}}: プルリクエストまたはレビュー\",\"repo_reviews_appear_here\":\"このリポジトリで開始したレビューがここに表示されます。\",\"reviews\":\"レビュー\",\"show_all_count\":\"すべて表示（{{count}}）\",\"this_repo_only\":\"{{repo}} のみ\"},\"postCommentsButton\":{\"cancel\":\"キャンセル\",\"confirm_post_other\":\"{{count}} 件のコメントをプルリクエストに投稿しますか？\",\"drafted_publish_on_pr_page_other\":\"{{count}} 件のコメントを下書きしました。ここでプルリクエストを開いて公開してください\",\"post_action\":\"投稿\",\"post_count_other\":\"{{count}} 件を投稿\",\"post_failed\":\"レビューを下書きできませんでした\",\"posted_age\":\"{{age}}に投稿\",\"posted_comments_other\":\"{{count}} 件のコメントを投稿済み\",\"posting\":\"投稿しています…\",\"publish_these_findings_as_a_review_on_the_pull_r\":\"これらの指摘をレビューの下書きにします。公開するまであなたにだけ見えます\"},\"prPickList\":{\"a_review_of_this_pull_request_is_running\":\"このプルリクエストのレビューが実行中です\",\"add_a_repo\":\"リポジトリを追加\",\"already_reviewed\":\"レビュー済み\",\"cancel\":\"キャンセル\",\"confirm_review_all\":\"{{count}} 件のプルリクエストすべてをレビューしますか？\",\"draft\":\"ドラフト\",\"filter_pull_requests\":\"プルリクエストを絞り込む\",\"new\":\"新規\",\"no_open_prs_here\":\"オープンなプルリクエストはありません。\",\"no_prs_match_filter\":\"条件に一致するプルリクエストがありません。\",\"one_or_more_github_pr_links\":\"1 つ以上の GitHub プルリクエストのリンク\",\"open_pr\":\"プルリクエスト #{{number}} を開く: {{title}}\",\"paste_pr_links\":\"プルリクエストのリンクを貼り付け\",\"paste_pr_links_instead\":\"代わりにプルリクエストのリンクを貼り付ける\",\"pick_a_repo_to_see_its_pull_requests\":\"リポジトリを選ぶと、そのプルリクエストが表示されます。\",\"pr_already_being_reviewed\":\"プルリクエスト #{{number}} は既にレビュー中です\",\"re_read_open_prs_from_github\":\"GitHub からオープンなプルリクエストを再読み込みする\",\"refresh_pull_requests\":\"プルリクエストを再取得する\",\"repos_live_in_the_sidebar\":\"リポジトリはサイドバーにあります。\",\"review_all_count\":\"{{count}} 件すべてをレビュー\",\"review_every_open_pr_not_yet_reviewed_at_its_cur\":\"現在の HEAD でまだレビューされていないオープンなプルリクエストをすべてレビューする\",\"review_pr\":\"プルリクエスト #{{number}} をレビュー: {{title}}\",\"review_selected_count_other\":\"選択した {{count}} 件をレビュー\",\"review_these\":\"これらをレビュー\",\"reviewed\":\"レビュー済み\",\"reviewed_age\":\"{{age}}にレビュー\",\"reviewed_before_the_head_commit_has_moved_since\":\"以前レビュー済み — その後 HEAD コミットが移動しています\",\"reviewing\":\"レビュー中\",\"updated\":\"更新\"},\"prReviewDetail\":{\"author\":\"作成者\",\"cancelled_before_finishing\":\"これが終わる前にキャンセルされました。\",\"did_not_complete_for_this_change\":\"この変更のレビューは完了しませんでした。\",\"draft\":\"ドラフト\",\"findings_appear_here_as_soon_as_the_review_finis\":\"レビューが終わり次第、指摘がここに表示されます。ページを離れても構いません — 完了したら通知でお知らせします。\",\"head\":\"HEAD\",\"loading_pull_request_details\":\"プルリクエストの詳細を読み込んでいます…\",\"loading_review\":\"レビューを読み込んでいます…\",\"nothing_flagged_on_this_pull_request\":\"このプルリクエストで指摘された点はありません。\",\"open_on_github\":\"GitHub で開く\",\"pull_request\":\"プルリクエスト\",\"pull_request_detail\":\"プルリクエストの詳細\",\"retry_review\":\"レビューを再試行\",\"review\":\"レビュー\",\"review_again\":\"再レビュー\",\"review_again_at_current_head\":\"このプルリクエストを現在の HEAD で再度レビューする\",\"review_already_running\":\"このプルリクエストのレビューは既に実行中です\",\"review_completed_with_no_findings\":\"レビューは完了し、報告に値する指摘はありませんでした。\",\"review_this_pull_request\":\"このプルリクエストをレビューする\",\"reviewing\":\"レビュー中…\",\"running\":\"実行中\",\"sage_review\":\"Sage レビュー\",\"see_the_reason_above\":\"理由は上記をご覧ください。\",\"start_a_review_and_its_findings_appear_here_you\":\"レビューを開始すると、その指摘がここに表示されます — ページを離れても構いません、完了したら通知でお知らせします。\",\"that_review_produced_no_report_for_this_pull_req\":\"そのレビューは、このプルリクエストのレポートを生成しませんでした。\",\"this_pull_request_has_not_been_reviewed_yet\":\"このプルリクエストはまだレビューされていません。\",\"updated\":\"更新\"},\"prSourcePanel\":{\"load_failed\":\"プルリクエストの詳細を読み込めませんでした: {{reason}}\",\"partial_sections\":\"一部のセクションが不完全です（{{sections}}）— プロバイダーへのリクエストが失敗したか、ページ数の上限に達しました。\"},\"prStatusChips\":{\"all_checks_passed_other\":\"{{count}} 件のチェックすべてが成功\",\"checks_failing_other\":\"{{count}} 件中 {{failed}} 件のチェックが失敗\",\"checks_running_other\":\"{{count}} 件中 {{pending}} 件のチェックが実行中\",\"closed\":\"クローズ\",\"conflicts\":\"コンフリクト\",\"failing_count_other\":\"{{count}} 件失敗\",\"merge_blocked\":\"マージ不可\",\"merged\":\"マージ済み\",\"open\":\"オープン\",\"passed_count_other\":\"{{count}} 件成功\",\"running_count_other\":\"{{count}} 件実行中\"},\"repoSwitcher\":{\"add_a_repo\":\"リポジトリを追加\",\"all_repos\":\"すべてのリポジトリ\",\"filter_repos\":\"リポジトリを絞り込む\",\"filter_repositories\":\"リポジトリを絞り込む\",\"loading\":\"読み込んでいます…\",\"no_repo_matches_that\":\"一致するリポジトリがありません。\",\"no_repos_yet_add_one_to_pick_from_the_repos_you\":\"リポジトリがまだありません — 追加すると、作業中のリポジトリから選べるようになります。\",\"pick_a_repo\":\"リポジトリを選択\",\"pick_a_repository\":\"リポジトリを選択\",\"recent\":\"最近\",\"repositories\":\"リポジトリ\",\"repository_named\":\"リポジトリ: {{name}}\"},\"reportView\":{\"blast_radius\":\"影響範囲: {{scope}}\",\"blocking_count_other\":\"ブロッカー {{count}} 件\",\"changes_reviewed_other\":\"{{count}} 件の変更をレビュー済み\",\"clear\":\"クリア\",\"design_gate\":\"デザインゲート ·\",\"design_risk\":\"設計リスク: {{level}}\",\"draft_selected_other\":\"選択した {{count}} 件の指摘を下書きします\",\"finding_dimension_in_file\":\"{{file}} の {{dimension}}\",\"generated\":\"· 生成\",\"moved_to\":\"現在は{{band}}です。フィルターを変えるまで位置はそのままです。\",\"no_changes_in_this_band\":\"このバンドに該当する変更はありません。\",\"nothing_flagged_in_this_review\":\"このレビューで指摘された点はありません。\",\"open_shared_copy\":\"共有コピーを開く\",\"open_the_pull_request\":\"プルリクエストを開く\",\"share\":\"共有\",\"sharing\":\"共有しています…\",\"should_fix_count_other\":\"修正推奨 {{count}} 件\",\"step_problem\":\"課題\",\"step_solution_fit\":\"解決策の妥当性\",\"step_why_it_matters\":\"なぜ重要か\"},\"reviewChat\":{\"continue_hint\":\"このレビュー担当者との会話はチャットタブで続けられます。\",\"continue_session\":\"フォローアップのセッションを続ける\",\"earlier_questions\":\"以前の質問\",\"error_generic\":\"フォローアップのセッションを開けませんでした。もう一度お試しください。\",\"error_run_deleted\":\"このレビューは削除されたため、会話は終了しました。\",\"loading\":\"読み込み中…\",\"new_session_unavailable\":\"このアプリからはまだ新しいフォローアップセッションを開けません。アプリが名前付きのチャットセッションを開けるKiro Crewが必要です。すでに開いたフォローアップセッションは引き続き使えます。\",\"not_recorded_notice\":\"このレビューはレビュー担当者のセッションを保持していないため、再開できるものがありません。このプルリクエストをもう一度レビューすると質問できます。\",\"open_session\":\"フォローアップのセッションを開く\",\"opening\":\"開いています…\",\"ran_tools\":\"参照: {{tools}}\",\"reasoning\":\"推論\",\"refused_notice\":\"完全に回答するにはツールの実行が必要でしたが許可されなかったため、この回答は限定的です。YOLO を有効にすると実行できます。\",\"resume_hint\":\"レビュー担当者を再開するチャットを開きます。指摘の根拠となった推論がそのまま残っています。\",\"role_reviewer\":\"レビュー担当\",\"role_you\":\"あなた\",\"run_live_notice\":\"このレビューは実行中です。完了まで指摘は変わる可能性があるため、まだ質問できることはありません。\",\"title\":\"レビュー担当に質問する\",\"transcript_gone_notice\":\"レビュー担当者のセッションはディスク上に残っていないため、再開できるものがありません。このプルリクエストをもう一度レビューすると質問できます。\"},\"reviewQueue\":{\"empty\":\"レビュー待ちのプルリクエストはありません。\",\"filter_by_repo\":\"リポジトリまたはタイトルで絞り込み\",\"setup_required\":\"レビュー依頼を表示するには GitHub CLI を設定してください\",\"starts_review\":\"選んだ PR ごとに Sage のレビューが実行されます。結果は レビュー に表示され、あなたが選ばない限り GitHub には投稿されません。\",\"starts_review_truncated\":\"最新の 100 件の依頼のみ表示しています。選んだ PR ごとに Sage のレビューが実行されます。結果は レビュー に表示され、あなたが選ばない限り GitHub には投稿されません。\",\"tab\":\"依頼\"},\"runCard\":{\"cancel\":\"キャンセル\",\"clean\":\"問題なし\",\"delete\":\"削除\",\"delete_review_of\":\"{{label}} のレビューを削除\",\"delete_this_review\":\"このレビューを削除\",\"delete_this_review_2\":\"このレビューを削除しますか？\",\"more_count_other\":\"他 +{{count}} 件\",\"needs_review_count_other\":\"{{count}} 件が要レビュー\",\"pull_requests\":\"件のプルリクエスト\",\"review\":\"レビュー\",\"review_of\":\"{{label}} のレビュー\",\"review_of_with_more_other\":\"{{label}} ほか {{count}} 件のレビュー\",\"worth_a_glance_count_other\":\"{{count}} 件が一見の価値あり\"},\"runDetail\":{\"cancelled_before_any_finished\":\"どのプルリクエストも終わる前にキャンセルされました。\",\"finished\":\"完了\",\"loading_report\":\"レポートを読み込んでいます…\",\"more_count_other\":\"他 +{{count}} 件\",\"nothing_to_report\":\"レビューを完了したプルリクエストがないため、報告する内容はありませんでした。\",\"pull_request_other\":\"{{count}} 件のプルリクエスト\",\"report_appears_when_the_review_finishes\":\"レビューが終わり次第、レポートがここに表示されます。\",\"skipped_inflight_other\":\"{{count}} 件のプルリクエストは、別のレビューが既に処理していたためスキップされました。\",\"started\":\"開始\",\"this_review_produced_no_report\":\"このレビューはレポートを生成しませんでした。\",\"you_can_leave_this_page_a_notification_will_tell\":\"このページを離れても構いません — 完了したら通知でお知らせします。\"},\"runList\":{\"new_review\":\"新しいレビュー\"},\"runProgress\":{\"cancel_review\":\"レビューをキャンセル\",\"cancelled_count_other\":\"{{count}} 件キャンセル済み\",\"cancelling\":\"キャンセルしています…\",\"elapsed_time\":\"経過時間\",\"failed_count_other\":\"{{count}} 件失敗\",\"median_of_past_runs_of_this_size\":\"同程度の規模の過去の実行の中央値\",\"review_progress\":\"レビューの進捗\",\"reviewed_of_other\":\"{{done}} / {{count}} レビュー済み\",\"reviewers_busy\":\"{{max}} 人中 {{busy}} 人のレビュアーが稼働中\",\"step\":\"· ステップ\",\"stops_queued_prs_one_already_being_reviewed_will\":\"待機中のプルリクエストを停止します。既にレビュー中のものは完了します。\",\"usually\":\"通常 約\",\"working\":\"処理中\"},\"runStatusPill\":{\"cancelled\":\"キャンセル済み\",\"cancelling\":\"キャンセル中\",\"done\":\"完了\",\"error\":\"エラー\",\"interrupted\":\"中断\",\"running\":\"実行中\"},\"shipSummaryCard\":{\"post_the_ship_readiness_summary\":\"リリース準備状況のサマリーを投稿する\",\"post_this_comment\":\"このコメントを投稿する\",\"posted_as_a_top_level_comment\":\"トップレベルのコメントとして投稿済み\",\"posted_to_the_pull_request\":\"プルリクエストに投稿済み\",\"posting\":\"投稿しています…\",\"select_the_ship_readiness_summary_to_post\":\"投稿するリリース準備状況のサマリーを選択\",\"ship_readiness_summary\":\"リリース準備状況のサマリー\"}},\"lib\":{\"format\":{\"cause_no_agent_cli\":\"レビュアーは起動しませんでした — このホストで kiro-cli の実行ファイルが見つかりませんでした。インストールするか、PATH に追加してください。\",\"cause_no_record\":\"レビュアーは終了しましたが、指摘は記録されませんでした。\",\"cause_record_incomplete\":\"レビュアーは指摘の記録を書きましたが、レビューを完了する前に止まりました。\",\"cause_runtime_died\":\"レビュアーのプロセスがレビュー中に停止しました — 通常はゲートウェイの再起動が原因です。プルリクエスト自体に問題はありません。\",\"cause_runtime_not_importable\":\"レビュアーは起動しませんでした — このインストールは必要なエージェントランタイムを読み込めません。インストールを修復すると元に戻ります。\",\"cause_runtime_unavailable\":\"レビュアーは起動しませんでした — エージェントランタイムがこのホストで利用できません。\",\"cause_timeout\":\"レビューが制限時間を超過しました。\",\"cause_turn_failed\":\"レビューのターンが、何も記録する前に失敗しました。\",\"cause_unknown\":\"レビューは完了しませんでした。\",\"days_ago_other\":\"{{count}} 日前\",\"hours_ago_other\":\"{{count}} 時間前\",\"just_now\":\"たった今\",\"minutes_ago_other\":\"{{count}} 分前\",\"phase_cancelled\":\"キャンセル済み\",\"phase_done\":\"完了\",\"phase_failed\":\"失敗\",\"phase_pending\":\"保留中\",\"phase_queued\":\"待機中\",\"phase_reviewing\":\"レビュー中\"}},\"manifest\":{\"configuration_1\":\"ゲートウェイホストに gh CLI をインストールして認証し、リポジトリを追加してから、設定でレビューモデル、推論強度、同時実行数を選択します。\",\"description\":\"GitHub pull requestsの詳細確認を行い、実際に注目する価値のある変更を示します。各プルリクエストは独自の分離されたエージェントセッションで確認され、変更されたすべてのファイルが対象になり、持っているブラスト半径の量で加重され、優先度付きフォーカスレポートにロールアップされます。検出結果はアプリ内で読み、公開するか自動投稿を有効にした場合にのみドラフト GitHub レビューとしてステージングされ、確認者は出荷されたフィックスと過去のレビューコメントからリポジトリの真の標準を学び続けます。\",\"display_name\":\"Code Review Sage\",\"highlight_1\":\"フォーカスレポートはブラスト半径によって変更をランク付けするため、リスクの高いファイルが最初に読み取られます\",\"highlight_2\":\"プルリクエストごとに1つの分離されたエージェントセッションなので、検出結果がレビュー間で流出しません\",\"highlight_3\":\"保留中(ドラフト)の GitHub レビューとして投稿 — あなたが送信する1つです\",\"highlight_4\":\"配布されたフィックス、レビューコメント、設計ディスカッションからリポジトリごとに学習します\",\"highlight_5\":\"GitHub pull requestsを確認します; ゲートウェイホストで認証された`gh` CLIが必要です\",\"page_label\":\"Code Review Sage\",\"use_case_1\":\"1 件または複数の GitHub プルリクエストをリスク順にレビューし、重点的な指摘を確認して、公開する価値のあるコメントだけをステージします。\"},\"views\":{\"learningView\":{\"cancel\":\"キャンセル\",\"confirm_merge_other\":\"{{count}} 件の学習内容をルールセットにマージしますか？\",\"consolidate\":\"統合\",\"consolidate_pending_other\":\"{{namespace}} の保留中の学習内容 {{count}} 件を統合\",\"consolidating\":\"統合しています…\",\"learning\":\"学習\",\"loaded_during_reviews\":\"レビュー時に読み込まれます\",\"loading_learnings\":\"学習内容を読み込んでいます…\",\"merge_failed_ruleset_unchanged\":\"マージに失敗しました — ルールセットは変更されていません\",\"not_loaded\":\"読み込まれていません\",\"nothing_consolidated_yet_reviews_in_this_namespa\":\"まだ何も統合されていません — この名前空間のレビューは、現在どの学習パターンも読み込みません。\",\"nothing_staged_new_learnings_land_here_when_a_re\":\"ステージされたものはありません。レビューが出荷済みの修正や対応されたレビューコメントを分析すると、新しい学習内容がここに入ります。\",\"pattern_other\":\"{{count}} 件のパターン\",\"pending_consolidation\":\"統合待ち ·\",\"pick_a_namespace_in_the_sidebar_to_read_the_patt\":\"サイドバーで名前空間を選ぶと、レビューがそこから読み込むパターンを確認できます。\",\"reviews_read_the_consolidated_ruleset_below_neve\":\"レビューは下の統合済みルールセットを読み込み、保留中の候補は読み込みません。統合を実行すると、ステージされた内容がそこにマージされます — 実行するまでレビューが見る内容は変わりません。\",\"ruleset\":\"ルールセット ·\"},\"settingsView\":{\"default_agent_config\":\"デフォルト（エージェント設定）\",\"default_model_provider\":\"デフォルト（モデル / プロバイダー）\",\"higher_effort_finds_more_costs_more_and_takes_lo\":\"強度を上げるとより多くを検出できますが、コストが増え、プルリクエストあたりの時間も長くなります。デフォルトではモデルまたはプロバイダーが判断します。\",\"how_many_pull_requests_are_reviewed_in_parallel\":\"共有ワーカーランタイム上で並行してレビューするプルリクエストの数です。これがレビューのスループットの実質的な上限で、複数のレビュースレッドを同時に開いていても、すべてこの枠を共有します。\",\"loading_settings\":\"設定を読み込んでいます…\",\"model\":\"モデル\",\"reasoning_effort\":\"推論の強度\",\"review_model\":\"レビューモデル\",\"reviews_at_once\":\"同時レビュー数\",\"settings\":\"設定\",\"these_apply_to_every_review_started_from_here\":\"ここから開始するすべてのレビューに適用されます。\",\"which_model_performs_the_review_default_inherits\":\"レビューを実行するモデルです。デフォルトではエージェント設定を継承するため、デフォルトモデルを変更すると、これも変わります。\"}},\"workspace\":{\"drag_to_resize\":\"ドラッグしてサイズを変更\",\"resize_sidebar\":\"サイドバーのサイズを変更\",\"select_a_review_to_see_its_progress_and_report\":\"レビューを選択すると、その進捗とレポートが表示されます。\",\"start_a_new_one_several_can_run_at_once\":\"新しく開始してください — 複数を同時に実行できます。\"}},\"issueRadar\":{\"components\":{\"prDetail\":{\"labels\":\"ラベル\"}}}}"),
		components: { "resizeHandle": { "drag_to_resize": "ドラッグしてサイズを変更" } },
		lib: { "scriptLabel": {
			"cyrillic": "キリル文字",
			"greek": "ギリシャ文字",
			"latin": "ラテン文字",
			"other": "文字"
		} }
	},
	ko: {
		app: {
			"collapse_sidebar": "사이드바 접기",
			"expand_sidebar": "사이드바 펼치기"
		},
		apps: /* @__PURE__ */ JSON.parse("{\"codeReviewSage\":{\"codeReviewSagePage\":{\"open_pr_other\":\"열린 PR {{count}}개\",\"pattern_other\":\"패턴 {{count}}개\"},\"components\":{\"addReposModal\":{\"add\":\"추가\",\"add_one_by_url_above\":\"위에서 URL로 추가하세요.\",\"add_repo\":\"{{repo}} 추가\",\"add_repos\":\"저장소 추가\",\"added\":\"추가됨\",\"all_your_repos\":\"내 저장소 전체\",\"already_added\":\"{{repo}}은(는) 이미 추가되었습니다\",\"archived\":\"보관됨\",\"based_on_recent_github_activity\":\"최근 GitHub 활동을 기준으로 합니다\",\"close\":\"닫기\",\"close_add_repos_dialog\":\"저장소 추가 대화상자 닫기\",\"contributed_events_other\":\"{{age}} · 이벤트 {{count}}건\",\"filter_your_repos\":\"내 저장소 필터\",\"gh_auth_login\":\"gh auth login\",\"github_cli_not_ready\":\"GitHub CLI 준비 안 됨\",\"newest_100_by_push_date\":\"푸시 날짜 기준 최신 100개\",\"no_repos_for_account\":\"계정에서 저장소를 찾을 수 없습니다.\",\"no_repos_match_filter\":\"필터와 일치하는 저장소가 없습니다.\",\"owner_repo_a_repo_url_or_paste_a_pull_request_li\":\"owner/repo, 저장소 URL, 또는 풀 리퀘스트 링크 붙여넣기\",\"pick_from_the_repos_you_can_reach_or_type_one_in\":\"접근할 수 있는 저장소에서 고르거나 직접 입력하세요. 추가한 저장소는\\n 사이드바에 표시되며 거기에서 리뷰를 시작할 수 있습니다. 풀\\n 리퀘스트 링크를 붙여넣으면 해당 풀 리퀘스트가 바로 열립니다.\",\"pinned_to_the_sidebar\":\"사이드바에 고정됨\",\"private\":\"비공개\",\"pushed_age\":\"{{age}} 푸시\",\"re_read_your_repos_from_github\":\"GitHub에서 저장소 다시 읽기\",\"read_only\":\"읽기 전용\",\"read_only_access\":\"읽기 전용 권한\",\"reading_your_repos_from_github\":\"GitHub에서 저장소를 읽고 있습니다…\",\"recently_worked_on\":\"최근 작업한 항목\",\"refresh_your_repos\":\"저장소 새로 고침\",\"remove\":\"제거\",\"remove_repo\":\"{{repo}} 제거\",\"repository_or_pull_request_url_or_owner_repo\":\"저장소 또는 풀 리퀘스트 URL, 혹은 owner/repo\",\"setup_hint\":\"저장소 목록을 보려면 GitHub CLI를 설치하고 아래 명령으로 로그인하세요. 위에서 URL로 저장소를 추가할 수도 있습니다.\",\"these_lists_are_capped_so_a_repo_you_have_not_to\":\"이 목록에는 상한이 있어 최근에 다루지 않은 저장소는 빠져 있을 수\\n 있습니다. 보이지 않으면 위에서 URL로 추가하세요.\",\"your_repos\":\"내 저장소\"},\"bandChips\":{\"all\":\"전체\",\"clean\":\"문제 없음\",\"filter_by_band\":\"등급으로 필터\",\"needs_review\":\"리뷰 필요\",\"worth_a_glance\":\"살펴볼 만함\"},\"draftReviewActions\":{\"approve\":\"승인\",\"approve_is_unavailable_because_this_base_branch_\":\"이 풀 리퀘스트의 베이스 브랜치가 새 커밋이 푸시될 때 승인을 취소하지 않기 때문에(또는 여기에서 보호 설정을 읽을 수 없기 때문에) 승인할 수 없습니다. 그렇지 않으면 승인이 리뷰한 커밋보다 오래 남을 수 있습니다. 대신 GitHub에서 승인하세요.\",\"approve_is_unavailable_while_auto_merge_is_armed\":\"자동 병합이 설정된 동안에는 승인할 수 없습니다. 오래된 헤드 검사가 되돌리기 전에 승인이 이 풀 리퀘스트를 병합할 수 있습니다. 자동 병합을 해제하거나 GitHub에서 승인하세요.\",\"ask_agent_about_this_failure\":\"이 오류에 대해 에이전트에게 물어보기\",\"cancel\":\"취소\",\"confirm_approve\":\"이 풀 리퀘스트를 승인하시겠습니까?\",\"confirm_request_changes\":\"변경 요청 리뷰를 게시하시겠습니까?\",\"confirm_submit_as_comment\":\"이 리뷰를 댓글로 제출하시겠습니까?\",\"couldn_t_check_for_a_draft_review_on_this_pull_r\":\"이 풀 리퀘스트의 초안 리뷰를 확인할 수 없었습니다. 초안이 없어서가 아니라 대개 GitHub CLI 인증 문제입니다.\",\"draft_review\":\"초안 리뷰\",\"no_draft_review_on_this_pull_request\":\"이 풀 리퀘스트에는 초안 리뷰가 없습니다.\",\"pending_only_you_can_see_it_until_you_publish\":\"보류 중 — 게시하기 전까지는 본인만 볼 수 있습니다.\",\"publish_failed\":\"리뷰를 게시할 수 없습니다\",\"published_as\":\"게시 형식\",\"published_verdict_approved\":\"승인\",\"published_verdict_changes_requested\":\"변경 요청\",\"published_verdict_comment\":\"댓글\",\"publishing\":\"게시 중…\",\"publishing_is_blocked_a_later_review_replaced_th\":\"게시가 차단되었습니다. 이후 리뷰가 풀 리퀘스트의 이 초안을 대체해 더 이상 이 리뷰의 지적이 담겨 있지 않습니다. 최신 리뷰를 열어 게시하세요.\",\"publishing_is_blocked_this_draft_contains_conten\":\"게시가 차단되었습니다. 이 초안에는 가려야 할 내용이 있어 제출하면 원문이 그대로 올라갑니다. GitHub에서 초안을 수정하거나 폐기하세요.\",\"publishing_is_blocked_this_draft_was_written_aga\":\"게시가 차단되었습니다. 이 초안은 이전 커밋을 기준으로 작성되었고 그 뒤 풀 리퀘스트가 변경되었습니다. 먼저 현재 헤드를 다시 리뷰하세요.\",\"publishing_is_blocked_this_review_is_still_runni\":\"게시가 차단되었습니다. 이 리뷰가 아직 실행 중이어서 이 풀 리퀘스트의 초안은 이전 실행의 것입니다.\",\"publishing_is_irreversible_and_visible_to_everyo\":\"게시는 되돌릴 수 없으며 이 풀 리퀘스트의 모든 사람에게 표시됩니다.\",\"request_changes\":\"변경 요청\",\"submit_as_comment\":\"댓글로 제출\",\"this_draft_has_no_summary_body\":\"이 초안에는 요약 본문이 없습니다.\",\"try_again\":\"다시 시도\"},\"failureNotice\":{\"run_it_again\":\"다시 실행\",\"starting\":\"시작 중…\",\"this_review_failed\":\"이 리뷰가 실패했습니다\"},\"findingCard\":{\"cancel_dismiss\":\"취소\",\"confirm_dismiss\":\"발견 사항 무시\",\"consequence\":\"영향\",\"dismiss\":\"무시\",\"dismiss_failed\":\"무시를 저장하지 못했습니다. 다시 시도하세요.\",\"dismiss_reason_label\":\"이 발견 사항을 무시하는 이유는 무엇인가요?\",\"dismiss_reason_placeholder\":\"예: 오탐, 범위 밖\",\"dismissed_reason\":\"무시됨: {{reason}}\",\"evidence\":\"근거\",\"observation\":\"관찰\",\"post_finding\":\"이 지적을 리뷰 댓글 초안으로 작성\",\"post_finding_on\":\"이 지적을 {{target}}에 리뷰 댓글 초안으로 작성\",\"post_this_comment\":\"이 지적 초안 작성\",\"posted_to_the_pull_request\":\"초안 작성됨 — 아래에서 게시하세요\",\"posting\":\"초안 작성 중…\",\"select_to_draft_together\":\"일괄 초안용으로 선택\",\"select_to_post\":\"초안으로 작성할 {{label}} 선택\",\"severity_must_fix\":\"필수\",\"severity_should_fix\":\"권장\",\"suggestion\":\"제안\",\"this_finding\":\"이 지적\",\"undo_dismiss\":\"실행 취소\",\"undo_dismiss_failed\":\"실행 취소하지 못했습니다. 이 항목은 계속 무시됩니다.\"},\"learningRail\":{\"add_namespace\":\"네임스페이스 추가\",\"confirm_delete\":\"‘{{name}}’과(와) 그 학습 내용을 모두 삭제하시겠습니까? 되돌릴 수 없습니다.\",\"delete_2\":\"삭제\",\"delete_namespace\":\"네임스페이스 {{name}} 삭제\",\"invalid_namespace_name\":\"네임스페이스 이름은 폴더 이름이 되므로 소문자 라틴 문자(a–z), 숫자(0–9), 마침표, 하이픈, 밑줄만 사용할 수 있습니다. 이름은 문자나 숫자로 시작하고 끝나야 하며 2자 이상 64자 이하여야 합니다.\",\"invalid_namespace_name_char\":\"‘{{char}}’은(는) 네임스페이스 이름에 사용할 수 없습니다. 소문자 a–z, 0–9, .\xA0-⁠\xA0_ 문자만 사용하세요.\",\"invalid_namespace_name_letter\":\"‘{{char}}’({{script}}, {{code}})은(는) 네임스페이스 이름에 사용할 수 없습니다. 소문자 a–z, 0–9, .\xA0-⁠\xA0_ 문자만 사용하세요.\",\"keep_it\":\"유지\",\"load_namespace_during_reviews\":\"리뷰 중 네임스페이스 {{name}} 불러오기\",\"loading\":\"불러오는 중…\",\"namespace_active\":\"활성 — 리뷰 중 불러옵니다 (체크를 해제하면 비활성화)\",\"namespace_inactive\":\"비활성 — 체크하면 리뷰 중 불러옵니다\",\"namespaces\":\"네임스페이스\",\"new_namespace\":\"새 네임스페이스\",\"new_namespace_2\":\"new-namespace\",\"new_namespace_name\":\"새 네임스페이스 이름\",\"pattern_other\":\"패턴 {{count}}개\",\"pending_count_other\":\"{{count}}개 보류 중\",\"read_namespace\":\"네임스페이스 {{name}} 읽기\"},\"leftRail\":{\"code_review_sage\":\"Code Review Sage\",\"learning\":\"학습\",\"reviews\":\"리뷰\",\"sections\":\"섹션\",\"settings\":\"설정\",\"version\":\"v{{version}}\"},\"listSkeleton\":{\"loading_reviews\":\"리뷰를 불러오고 있습니다…\"},\"middleColumn\":{\"all_repos\":\"저장소 전체\",\"just_this_repo\":\"{{repo}}만\",\"lists_label\":\"풀 리퀘스트 또는 리뷰\",\"no_reviews_for_repo\":\"{{repo}}의 리뷰가 없습니다\",\"no_reviews_yet\":\"아직 리뷰가 없습니다\",\"pick_a_repo_then_a_pr\":\"저장소를 고른 다음 풀 리퀘스트를 고르세요.\",\"pull_requests\":\"풀 리퀘스트\",\"repo_lists_label\":\"{{repo}}: 풀 리퀘스트 또는 리뷰\",\"repo_reviews_appear_here\":\"이 저장소에서 시작한 리뷰가 여기에 표시됩니다.\",\"reviews\":\"리뷰\",\"show_all_count\":\"모두 표시 ({{count}})\",\"this_repo_only\":\"{{repo}}만\"},\"postCommentsButton\":{\"cancel\":\"취소\",\"confirm_post_other\":\"댓글 {{count}}개를 보류 중 리뷰 초안으로 작성할까요?\",\"drafted_publish_on_pr_page_other\":\"댓글 {{count}}개를 초안으로 작성했습니다 — 여기에서 풀 리퀘스트를 열어 게시하세요\",\"post_action\":\"초안 작성\",\"post_count_other\":\"댓글 {{count}}개 초안 작성\",\"post_failed\":\"리뷰 초안을 작성할 수 없습니다\",\"posted_age\":\"{{age}} 초안 작성\",\"posted_comments_other\":\"댓글 {{count}}개 초안 작성됨 — 아래에서 게시하세요\",\"posting\":\"초안 작성 중…\",\"publish_these_findings_as_a_review_on_the_pull_r\":\"이 지적을 리뷰 초안으로 작성합니다 — 게시하기 전까지는 본인만 볼 수 있습니다\"},\"prPickList\":{\"a_review_of_this_pull_request_is_running\":\"이 풀 리퀘스트의 리뷰가 실행 중입니다\",\"add_a_repo\":\"저장소 추가\",\"already_reviewed\":\"이미 리뷰됨\",\"cancel\":\"취소\",\"confirm_review_all\":\"풀 리퀘스트 {{count}}개를 모두 리뷰할까요?\",\"draft\":\"초안\",\"filter_pull_requests\":\"풀 리퀘스트 필터\",\"new\":\"신규\",\"no_open_prs_here\":\"열린 풀 리퀘스트가 없습니다.\",\"no_prs_match_filter\":\"필터와 일치하는 풀 리퀘스트가 없습니다.\",\"one_or_more_github_pr_links\":\"하나 이상의 GitHub PR 링크\",\"open_pr\":\"풀 리퀘스트 #{{number}} 열기: {{title}}\",\"paste_pr_links\":\"PR 링크 붙여넣기\",\"paste_pr_links_instead\":\"대신 PR 링크 붙여넣기\",\"pick_a_repo_to_see_its_pull_requests\":\"저장소를 고르면 해당 풀 리퀘스트가 표시됩니다.\",\"pr_already_being_reviewed\":\"풀 리퀘스트 #{{number}}은(는) 이미 리뷰 중입니다\",\"re_read_open_prs_from_github\":\"GitHub에서 열린 PR 다시 읽기\",\"refresh_pull_requests\":\"풀 리퀘스트 새로 고침\",\"repos_live_in_the_sidebar\":\"저장소는 사이드바에 있습니다.\",\"review_all_count\":\"{{count}}개 모두 리뷰\",\"review_every_open_pr_not_yet_reviewed_at_its_cur\":\"현재 헤드에서 아직 리뷰되지 않은 열린 PR을 모두 리뷰\",\"review_pr\":\"풀 리퀘스트 #{{number}} 리뷰: {{title}}\",\"review_selected_count_other\":\"선택한 {{count}}개 리뷰\",\"review_these\":\"이 항목 리뷰\",\"reviewed\":\"리뷰됨\",\"reviewed_age\":\"{{age}} 리뷰\",\"reviewed_before_the_head_commit_has_moved_since\":\"이전에 리뷰됨 — 그 뒤 헤드 커밋이 변경되었습니다\",\"reviewing\":\"리뷰 중\",\"updated\":\"업데이트\"},\"prReviewDetail\":{\"author\":\"작성자\",\"cancelled_before_finishing\":\"이 리뷰가 끝나기 전에 취소되었습니다.\",\"did_not_complete_for_this_change\":\"이 변경에 대한 리뷰가 완료되지 않았습니다.\",\"draft\":\"초안 PR\",\"findings_appear_here_as_soon_as_the_review_finis\":\"리뷰가 끝나는 대로 지적이 여기에 표시됩니다. 페이지를 떠나도\\n 됩니다 — 완료되면 알림으로 알려 드립니다.\",\"head\":\"헤드\",\"loading_pull_request_details\":\"풀 리퀘스트 상세를 불러오고 있습니다…\",\"loading_review\":\"리뷰를 불러오고 있습니다…\",\"nothing_flagged_on_this_pull_request\":\"이 풀 리퀘스트에서 지적된 내용이 없습니다.\",\"open_on_github\":\"GitHub에서 열기\",\"pull_request\":\"풀 리퀘스트\",\"pull_request_detail\":\"풀 리퀘스트 상세\",\"retry_review\":\"리뷰 재시도\",\"review\":\"리뷰\",\"review_again\":\"다시 리뷰\",\"review_again_at_current_head\":\"이 풀 리퀘스트를 현재 헤드에서 다시 리뷰\",\"review_already_running\":\"이 풀 리퀘스트의 리뷰가 이미 실행 중입니다\",\"review_completed_with_no_findings\":\"리뷰가 완료되었고 살펴볼 만한 지적은 없었습니다.\",\"review_this_pull_request\":\"이 풀 리퀘스트 리뷰\",\"reviewing\":\"리뷰 중…\",\"running\":\"실행 중\",\"sage_review\":\"Sage 리뷰\",\"see_the_reason_above\":\"위의 사유를 참고하세요.\",\"start_a_review_and_its_findings_appear_here_you\":\"리뷰를 시작하면 그 지적이 여기에 표시됩니다 — 페이지를 떠나도 되며,\\n 완료되면 알림으로 알려 드립니다.\",\"that_review_produced_no_report_for_this_pull_req\":\"그 리뷰는 이 풀 리퀘스트에 대한 보고서를 생성하지 않았습니다.\",\"this_pull_request_has_not_been_reviewed_yet\":\"이 풀 리퀘스트는 아직 리뷰되지 않았습니다.\",\"updated\":\"업데이트\"},\"prSourcePanel\":{\"load_failed\":\"풀 리퀘스트 상세를 불러올 수 없습니다: {{reason}}\",\"partial_sections\":\"일부 섹션이 불완전합니다 ({{sections}}) — 제공자 요청이 실패했거나 페이지 상한에 도달했습니다.\"},\"prStatusChips\":{\"all_checks_passed_other\":\"검사 {{count}}개 모두 통과\",\"checks_failing_other\":\"검사 {{count}}개 중 {{failed}}개 실패\",\"checks_running_other\":\"검사 {{count}}개 중 {{pending}}개 실행 중\",\"closed\":\"닫힘\",\"conflicts\":\"충돌\",\"failing_count_other\":\"{{count}}개 실패\",\"merge_blocked\":\"병합 차단\",\"merged\":\"병합됨\",\"open\":\"열림\",\"passed_count_other\":\"{{count}}개 통과\",\"running_count_other\":\"{{count}}개 실행 중\"},\"repoSwitcher\":{\"add_a_repo\":\"저장소 추가\",\"all_repos\":\"저장소 전체\",\"filter_repos\":\"저장소 필터\",\"filter_repositories\":\"저장소 필터\",\"loading\":\"불러오는 중…\",\"no_repo_matches_that\":\"일치하는 저장소가 없습니다.\",\"no_repos_yet_add_one_to_pick_from_the_repos_you\":\"아직 저장소가 없습니다 — 추가하면 작업 중인 저장소에서 고를 수 있습니다.\",\"pick_a_repo\":\"저장소 선택\",\"pick_a_repository\":\"저장소 선택\",\"recent\":\"최근\",\"repositories\":\"저장소\",\"repository_named\":\"저장소: {{name}}\"},\"reportView\":{\"blast_radius\":\"영향 범위: {{scope}}\",\"blocking_count_other\":\"차단 {{count}}개\",\"changes_reviewed_other\":\"변경 {{count}}건 리뷰됨\",\"clear\":\"지우기\",\"design_gate\":\"설계 게이트 ·\",\"design_risk\":\"설계 위험: {{level}}\",\"draft_selected_other\":\"선택한 지적 {{count}}건 초안 작성\",\"finding_dimension_in_file\":\"{{file}}의 {{dimension}}\",\"generated\":\"· 생성\",\"moved_to\":\"지금은 {{band}}예요. 필터를 바꾸기 전까지 자리는 그대로예요.\",\"no_changes_in_this_band\":\"이 등급에 해당하는 변경이 없습니다.\",\"nothing_flagged_in_this_review\":\"이 리뷰에서 지적된 내용이 없습니다.\",\"open_shared_copy\":\"공유본 열기\",\"open_the_pull_request\":\"풀 리퀘스트 열기\",\"share\":\"공유\",\"sharing\":\"공유 중…\",\"should_fix_count_other\":\"수정 권장 {{count}}개\",\"step_problem\":\"문제\",\"step_solution_fit\":\"해결책 적합성\",\"step_why_it_matters\":\"왜 중요한가\"},\"reviewChat\":{\"continue_hint\":\"이 리붰어와의 대화는 채팅 탭에서 이어집니다.\",\"continue_session\":\"후속 세션 이어가기\",\"earlier_questions\":\"이전 질문\",\"error_generic\":\"후속 세션을 열지 못했습니다. 다시 시도하세요.\",\"error_run_deleted\":\"이 리뷰가 삭제되어 대화가 종료되었습니다.\",\"loading\":\"받아오는 중…\",\"new_session_unavailable\":\"이 앱에서는 아직 새 후속 세션을 열 수 없습니다. 앱이 이름이 지정된 채팅 세션을 열 수 있는 Kiro Crew가 필요합니다. 이미 연 후속 세션은 계속 이어갈 수 있습니다.\",\"not_recorded_notice\":\"이 리뷰는 리붰어 세션을 보관하지 않았으묀로 다시 여는 것이 없습니다. 이 풀 리퀘스트를 다시 리뷰하면 질문할 수 있습니다.\",\"open_session\":\"후속 세션 열기\",\"opening\":\"여는 중…\",\"ran_tools\":\"확인한 것: {{tools}}\",\"reasoning\":\"추론 과정\",\"refused_notice\":\"완전히 답하려면 도구 실행이 필요했지만 허용되지 않아 이 답변은 제한적입니다. YOLO를 켜면 실행할 수 있습니다.\",\"resume_hint\":\"리붰어를 다시 불러오는 채팅을 엽니다. 지적 사항의 근거가 된 추로가 그대로 남아 있습니다.\",\"role_reviewer\":\"리뷰어\",\"role_you\":\"나\",\"run_live_notice\":\"이 리뷰는 아직 진행 중입니다. 끝나기 전에는 지적 사항이 바뀔 수 있어 질문할 내용이 아직 없습니다.\",\"title\":\"리뷰어에게 질문하기\",\"transcript_gone_notice\":\"리붰어의 세션이 디스킬에 다시 여는 것이 없습니다. 이 풀 리퀘스트를 다시 리뷰하면 질문할 수 있습니다.\"},\"reviewQueue\":{\"empty\":\"리뷰를 기다리는 풀 리퀘스트가 없습니다.\",\"filter_by_repo\":\"저장소 또는 제목으로 필터링\",\"setup_required\":\"리뷰 요청을 보려면 GitHub CLI를 설정하세요\",\"starts_review\":\"선택한 PR마다 Sage 리뷰가 실행됩니다. 결과는 리뷰에 표시되며 직접 선택하지 않으면 GitHub에 게시되지 않습니다.\",\"starts_review_truncated\":\"최신 요청 100개만 표시됩니다. 선택한 PR마다 Sage 리뷰가 실행됩니다. 결과는 리뷰에 표시되며 직접 선택하지 않으면 GitHub에 게시되지 않습니다.\",\"tab\":\"요청\"},\"runCard\":{\"cancel\":\"취소\",\"clean\":\"문제 없음\",\"delete\":\"삭제\",\"delete_review_of\":\"{{label}}의 리뷰 삭제\",\"delete_this_review\":\"이 리뷰 삭제\",\"delete_this_review_2\":\"이 리뷰를 삭제하시겠습니까?\",\"more_count_other\":\"외 +{{count}}개\",\"needs_review_count_other\":\"{{count}}건 리뷰 필요\",\"pull_requests\":\"개 풀 리퀘스트\",\"review\":\"리뷰\",\"review_of\":\"{{label}}의 리뷰\",\"review_of_with_more_other\":\"{{label}} 외 {{count}}건의 리뷰\",\"worth_a_glance_count_other\":\"{{count}}건 살펴볼 만함\"},\"runDetail\":{\"cancelled_before_any_finished\":\"어떤 풀 리퀘스트도 끝나기 전에 취소되었습니다.\",\"finished\":\"완료\",\"loading_report\":\"보고서를 불러오고 있습니다…\",\"more_count_other\":\"외 +{{count}}개\",\"nothing_to_report\":\"리뷰를 완료한 풀 리퀘스트가 없어 보고할 내용이 없었습니다.\",\"pull_request_other\":\"풀 리퀘스트 {{count}}개\",\"report_appears_when_the_review_finishes\":\"리뷰가 끝나는 대로 보고서가 여기에 표시됩니다.\",\"skipped_inflight_other\":\"다른 리뷰가 이미 처리하고 있어 풀 리퀘스트 {{count}}개는 건너뛰었습니다.\",\"started\":\"시작\",\"this_review_produced_no_report\":\"이 리뷰는 보고서를 생성하지 않았습니다.\",\"you_can_leave_this_page_a_notification_will_tell\":\"이 페이지를 떠나도 됩니다 — 완료되면 알림으로 알려 드립니다.\"},\"runList\":{\"new_review\":\"새 리뷰\"},\"runProgress\":{\"cancel_review\":\"리뷰 취소\",\"cancelled_count_other\":\"{{count}}개 취소됨\",\"cancelling\":\"취소 중…\",\"elapsed_time\":\"경과 시간\",\"failed_count_other\":\"{{count}}개 실패\",\"median_of_past_runs_of_this_size\":\"비슷한 규모의 과거 실행 중앙값\",\"review_progress\":\"리뷰 진행 상황\",\"reviewed_of_other\":\"{{done}} / {{count}} 리뷰됨\",\"reviewers_busy\":\"리뷰어 {{max}}명 중 {{busy}}명 작업 중\",\"step\":\"· 단계\",\"stops_queued_prs_one_already_being_reviewed_will\":\"대기 중인 PR을 중단합니다. 이미 리뷰 중인 것은 끝까지 진행됩니다.\",\"usually\":\"보통 약\",\"working\":\"처리 중\"},\"runStatusPill\":{\"cancelled\":\"취소됨\",\"cancelling\":\"취소 중\",\"done\":\"완료\",\"error\":\"오류\",\"interrupted\":\"중단됨\",\"running\":\"실행 중\"},\"shipSummaryCard\":{\"post_the_ship_readiness_summary\":\"출시 준비 상태 요약 초안 작성\",\"post_this_comment\":\"이 댓글 초안 작성\",\"posted_as_a_top_level_comment\":\"최상위 댓글 초안으로 작성됨\",\"posted_to_the_pull_request\":\"초안 작성됨 — 아래에서 게시하세요\",\"posting\":\"초안 작성 중…\",\"select_the_ship_readiness_summary_to_post\":\"초안으로 작성할 출시 준비 상태 요약 선택\",\"ship_readiness_summary\":\"출시 준비 상태 요약\"}},\"lib\":{\"format\":{\"cause_no_agent_cli\":\"리뷰어가 시작되지 못했습니다 — 이 호스트에서 kiro-cli 실행 파일을 찾지 못했습니다. 설치하거나 PATH에 추가하세요.\",\"cause_no_record\":\"리뷰어가 끝났지만 지적을 기록하지 않았습니다.\",\"cause_record_incomplete\":\"리뷰어가 지적 기록은 남겼지만 리뷰를 마치기 전에 멈췄습니다.\",\"cause_runtime_died\":\"리뷰어 프로세스가 리뷰 도중 중지되었습니다 — 대개 게이트웨이 재시작 때문입니다. 풀 리퀘스트 자체에는 문제가 없습니다.\",\"cause_runtime_not_importable\":\"리뷰어가 시작되지 못했습니다 — 이 설치는 필요한 에이전트 런타임을 불러올 수 없습니다. 설치를 복구하면 다시 돌아옵니다.\",\"cause_runtime_unavailable\":\"리뷰어가 시작되지 못했습니다 — 에이전트 런타임을 이 호스트에서 사용할 수 없습니다.\",\"cause_timeout\":\"리뷰가 제한 시간을 넘겼습니다.\",\"cause_turn_failed\":\"리뷰 턴이 아무것도 기록하기 전에 실패했습니다.\",\"cause_unknown\":\"리뷰가 완료되지 않았습니다.\",\"days_ago_other\":\"{{count}}일 전\",\"hours_ago_other\":\"{{count}}시간 전\",\"just_now\":\"방금\",\"minutes_ago_other\":\"{{count}}분 전\",\"phase_cancelled\":\"취소됨\",\"phase_done\":\"완료\",\"phase_failed\":\"실패\",\"phase_pending\":\"보류 중\",\"phase_queued\":\"대기 중\",\"phase_reviewing\":\"리뷰 중\"}},\"manifest\":{\"configuration_1\":\"게이트웨이 호스트에 gh CLI를 설치하고 인증한 뒤 저장소를 추가하세요. 이후 설정에서 리뷰 모델, 추론 수준, 동시 실행 수를 선택하세요.\",\"description\":\"GitHub pull request를 심층 리뷰하고 실제로 주의를 기울일 가치가 있는 변경 사항을 알려 줍니다. 각 풀 리퀘스트는 변경된 모든 파일을 다루는 격리된 에이전트 세션에서 리뷰되고, 영향 범위에 따라 가중치가 매겨져 우선순위가 정해진 포커스 리포트로 정리됩니다. 발견 사항은 앱에서 읽으며, 사용자가 게시하거나 자동 게시를 켤 때만 초안 GitHub 리뷰로 준비되고, 리뷰어는 반영된 수정과 과거 리뷰 댓글에서 저장소의 실제 기준을 계속 학습합니다.\",\"display_name\":\"Code Review Sage\",\"highlight_1\":\"포커스 리포트가 영향 범위에 따라 변경 사항의 순위를 매겨 위험한 파일부터 읽게 합니다\",\"highlight_2\":\"풀 리퀘스트마다 격리된 에이전트 세션 하나씩 — 발견 사항이 리뷰 간에 섞이지 않습니다\",\"highlight_3\":\"리뷰는 앱 안에서 읽습니다 — 요청하지 않는 한 풀 리퀘스트에는 아무것도 게시되지 않습니다\",\"highlight_4\":\"반영된 수정·리뷰 댓글·설계 논의에서 저장소별로 학습합니다\",\"highlight_5\":\"GitHub pull request를 리뷰합니다. 게이트웨이 호스트에 인증된 `gh` CLI가 필요합니다\",\"page_label\":\"Code Review Sage\",\"use_case_1\":\"하나 이상의 GitHub 풀 리퀘스트를 위험도에 따라 검토하고, 집중할 결과를 확인하며, 게시할 가치가 있는 댓글만 준비합니다.\"},\"views\":{\"learningView\":{\"cancel\":\"취소\",\"confirm_merge_other\":\"학습 내용 {{count}}건을 룰셋에 병합할까요?\",\"consolidate\":\"통합\",\"consolidate_pending_other\":\"{{namespace}}의 보류 중인 학습 내용 {{count}}건 통합\",\"consolidating\":\"통합 중…\",\"learning\":\"학습\",\"loaded_during_reviews\":\"리뷰 중 불러옴\",\"loading_learnings\":\"학습 내용을 불러오고 있습니다…\",\"merge_failed_ruleset_unchanged\":\"병합 실패 — 룰셋은 변경되지 않았습니다\",\"not_loaded\":\"불러오지 않음\",\"nothing_consolidated_yet_reviews_in_this_namespa\":\"아직 통합된 내용이 없습니다 — 이 네임스페이스의 리뷰는 현재 학습된\\n 패턴을 하나도 불러오지 않습니다.\",\"nothing_staged_new_learnings_land_here_when_a_re\":\"준비된 내용이 없습니다. 리뷰가 출시된 수정이나 조치된 리뷰 댓글을\\n 분석하면 새 학습 내용이 여기에 쌓입니다.\",\"pattern_other\":\"패턴 {{count}}개\",\"pending_consolidation\":\"통합 대기 ·\",\"pick_a_namespace_in_the_sidebar_to_read_the_patt\":\"사이드바에서 네임스페이스를 고르면 리뷰가 거기에서 불러오는 패턴을 볼 수 있습니다.\",\"reviews_read_the_consolidated_ruleset_below_neve\":\"리뷰는 아래의 통합된 룰셋을 읽으며, 보류 중인 후보는 읽지 않습니다.\\n 통합은 준비된 내용을 거기에 병합합니다 — 직접 실행하는 일회성 AI\\n 병합이므로, 실행하기 전에는 리뷰가 보는 내용이 바뀌지 않습니다.\",\"ruleset\":\"룰셋 ·\"},\"settingsView\":{\"default_agent_config\":\"기본값 (에이전트 설정)\",\"default_model_provider\":\"기본값 (모델 / 제공자)\",\"higher_effort_finds_more_costs_more_and_takes_lo\":\"강도를 높이면 더 많이 찾아내지만 비용이 늘고 풀 리퀘스트당 시간도\\n 길어집니다. 기본값은 모델 또는 제공자가 결정합니다.\",\"how_many_pull_requests_are_reviewed_in_parallel\":\"공유 워커 런타임에서 동시에 리뷰할 풀 리퀘스트 수입니다. 이것이\\n 리뷰 처리량의 실질적인 상한입니다 — 여러 리뷰 스레드를 동시에\\n 열어 둘 수 있지만, 모두 이\\n 한도에서 함께 가져다 씁니다.\",\"loading_settings\":\"설정을 불러오고 있습니다…\",\"model\":\"모델\",\"reasoning_effort\":\"추론 강도\",\"review_model\":\"리뷰 모델\",\"reviews_at_once\":\"동시 리뷰 수\",\"settings\":\"설정\",\"these_apply_to_every_review_started_from_here\":\"여기에서 시작하는 모든 리뷰에 적용됩니다.\",\"which_model_performs_the_review_default_inherits\":\"리뷰를 수행할 모델입니다. 기본값은 에이전트 설정을 상속하므로, 기본\\n 모델을 바꾸면 이 값도 함께 바뀝니다.\"}},\"workspace\":{\"drag_to_resize\":\"끌어서 크기 조절\",\"resize_sidebar\":\"사이드바 크기 조절\",\"select_a_review_to_see_its_progress_and_report\":\"리뷰를 선택하면 진행 상황과 보고서가 표시됩니다.\",\"start_a_new_one_several_can_run_at_once\":\"새로 시작하세요 — 여러 개를 동시에 실행할 수 있습니다.\"}},\"issueRadar\":{\"components\":{\"prDetail\":{\"labels\":\"레이블\"}}}}"),
		components: { "resizeHandle": { "drag_to_resize": "끌어서 크기 조절" } },
		lib: { "scriptLabel": {
			"cyrillic": "키릴 문자",
			"greek": "그리스 문자",
			"latin": "라틴 문자",
			"other": "문자"
		} }
	},
	pt: {
		app: {
			"collapse_sidebar": "Recolher barra lateral",
			"expand_sidebar": "Expandir barra lateral"
		},
		apps: /* @__PURE__ */ JSON.parse("{\"codeReviewSage\":{\"codeReviewSagePage\":{\"open_pr_many\":\"{{count}} PRs abertos\",\"open_pr_one\":\"{{count}} PR aberto\",\"open_pr_other\":\"{{count}} PRs abertos\",\"pattern_many\":\"{{count}} padrões\",\"pattern_one\":\"{{count}} padrão\",\"pattern_other\":\"{{count}} padrões\"},\"components\":{\"addReposModal\":{\"add\":\"Adicionar\",\"add_one_by_url_above\":\"Adicione um por URL acima.\",\"add_repo\":\"Adicionar {{repo}}\",\"add_repos\":\"Adicionar repos\",\"added\":\"adicionado\",\"all_your_repos\":\"Todos os seus repos\",\"already_added\":\"{{repo}} já foi adicionado\",\"archived\":\"arquivado\",\"based_on_recent_github_activity\":\"Com base na sua atividade recente no GitHub\",\"close\":\"Fechar\",\"close_add_repos_dialog\":\"Fechar a caixa de diálogo de adicionar repos\",\"contributed_events_many\":\"{{age}} · {{count}} eventos\",\"contributed_events_one\":\"{{age}} · {{count}} evento\",\"contributed_events_other\":\"{{age}} · {{count}} eventos\",\"filter_your_repos\":\"Filtre seus repos\",\"gh_auth_login\":\"gh auth login\",\"github_cli_not_ready\":\"A GitHub CLI não está pronta\",\"newest_100_by_push_date\":\"os 100 mais recentes por data de envio\",\"no_repos_for_account\":\"Nenhum repo encontrado para a sua conta.\",\"no_repos_match_filter\":\"Nenhum repo corresponde ao seu filtro.\",\"owner_repo_a_repo_url_or_paste_a_pull_request_li\":\"owner/repo, uma URL de repo, ou cole um link de pull request\",\"pick_from_the_repos_you_can_reach_or_type_one_in\":\"Escolha entre os repos que você alcança, ou digite um. Os repos adicionados aparecem na barra lateral para você iniciar uma revisão a partir deles. Cole um link de pull request e essa pull request abre direto.\",\"pinned_to_the_sidebar\":\"fixado na barra lateral\",\"private\":\"Privado\",\"pushed_age\":\"enviado {{age}}\",\"re_read_your_repos_from_github\":\"Reler seus repos do GitHub\",\"read_only\":\"somente leitura\",\"read_only_access\":\"Acesso somente leitura\",\"reading_your_repos_from_github\":\"Lendo seus repos do GitHub…\",\"recently_worked_on\":\"Trabalhados recentemente\",\"refresh_your_repos\":\"Atualizar seus repos\",\"remove\":\"Remover\",\"remove_repo\":\"Remover {{repo}}\",\"repository_or_pull_request_url_or_owner_repo\":\"URL do repositório ou da pull request, ou owner/repo\",\"setup_hint\":\"Instale a GitHub CLI e entre com o comando abaixo para listar seus repos. Você ainda pode adicionar qualquer repo por URL acima.\",\"these_lists_are_capped_so_a_repo_you_have_not_to\":\"Estas listas têm um limite, então um repo que você não mexeu ultimamente pode ficar de fora. Adicione por URL acima se não estiver vendo.\",\"your_repos\":\"Seus repos\"},\"bandChips\":{\"all\":\"Todas\",\"clean\":\"Sem apontamentos\",\"filter_by_band\":\"Filtrar por categoria\",\"needs_review\":\"Requer revisão\",\"worth_a_glance\":\"Vale uma olhada\"},\"draftReviewActions\":{\"approve\":\"Aprovar\",\"approve_is_unavailable_because_this_base_branch_\":\"Aprovar não está disponível porque o branch base deste pull request não descarta aprovações quando novos commits são enviados (ou sua proteção não é legível aqui). Sem isso, uma aprovação poderia sobreviver ao commit que revisou. Aprove no GitHub.\",\"approve_is_unavailable_while_auto_merge_is_armed\":\"Aprovar não está disponível enquanto o merge automático está armado: uma aprovação poderia mesclar este pull request antes que uma verificação do head pudesse retirá-la. Desative o merge automático ou aprove no GitHub.\",\"ask_agent_about_this_failure\":\"Perguntar ao agente sobre esta falha\",\"cancel\":\"Cancelar\",\"confirm_approve\":\"Aprovar este pull request?\",\"confirm_request_changes\":\"Publicar esta revisão solicitando alterações?\",\"confirm_submit_as_comment\":\"Enviar esta revisão como comentário?\",\"couldn_t_check_for_a_draft_review_on_this_pull_r\":\"Não foi possível verificar se há uma revisão em rascunho neste pull request. Normalmente é um problema de autenticação da CLI do GitHub, e não um rascunho ausente.\",\"draft_review\":\"Revisão em rascunho\",\"no_draft_review_on_this_pull_request\":\"Nenhuma revisão em rascunho neste pull request.\",\"pending_only_you_can_see_it_until_you_publish\":\"Pendente — apenas você pode vê-la até publicá-la.\",\"publish_failed\":\"Não foi possível publicar a revisão\",\"published_as\":\"Publicada como\",\"published_verdict_approved\":\"aprovada\",\"published_verdict_changes_requested\":\"alterações solicitadas\",\"published_verdict_comment\":\"um comentário\",\"publishing\":\"Publicando…\",\"publishing_is_blocked_a_later_review_replaced_th\":\"Publicação bloqueada: uma revisão posterior substituiu este rascunho no pull request, portanto ele já não contém as constatações desta revisão. Abra a revisão mais recente para publicá-la.\",\"publishing_is_blocked_this_draft_contains_conten\":\"A publicação está bloqueada: este rascunho contém conteúdo que precisa ser ocultado, e enviá-lo publicaria o texto original. Edite ou descarte o rascunho no GitHub.\",\"publishing_is_blocked_this_draft_was_written_aga\":\"A publicação está bloqueada: este rascunho foi escrito sobre um commit anterior e o pull request mudou desde então. Revise primeiro o head atual.\",\"publishing_is_blocked_this_review_is_still_runni\":\"A publicação está bloqueada: esta revisão ainda está em execução, portanto o rascunho nesta pull request é de uma execução anterior.\",\"publishing_is_irreversible_and_visible_to_everyo\":\"A publicação é irreversível e visível para todos no pull request.\",\"request_changes\":\"Solicitar alterações\",\"submit_as_comment\":\"Enviar como comentário\",\"this_draft_has_no_summary_body\":\"Este rascunho não tem texto de resumo.\",\"try_again\":\"Tentar novamente\"},\"failureNotice\":{\"run_it_again\":\"Rodar de novo\",\"starting\":\"Iniciando…\",\"this_review_failed\":\"Esta revisão falhou\"},\"findingCard\":{\"cancel_dismiss\":\"Cancelar\",\"confirm_dismiss\":\"Descartar constatação\",\"consequence\":\"Consequência\",\"dismiss\":\"Descartar\",\"dismiss_failed\":\"Não foi possível salvar o descarte. Tente novamente.\",\"dismiss_reason_label\":\"Por que descartar esta constatação?\",\"dismiss_reason_placeholder\":\"Por exemplo: falso positivo, fora do escopo\",\"dismissed_reason\":\"Descartado: {{reason}}\",\"evidence\":\"Evidência\",\"observation\":\"Observação\",\"post_finding\":\"Publicar este achado na pull request\",\"post_finding_on\":\"Publicar este achado em {{target}}\",\"post_this_comment\":\"Publicar este comentário\",\"posted_to_the_pull_request\":\"Publicado na pull request\",\"posting\":\"Publicando…\",\"select_to_draft_together\":\"Selecionar para rascunho em lote\",\"select_to_post\":\"Selecionar {{label}} para publicar\",\"severity_must_fix\":\"Obrigatório\",\"severity_should_fix\":\"Recomendado\",\"suggestion\":\"Sugestão\",\"this_finding\":\"este achado\",\"undo_dismiss\":\"Desfazer\",\"undo_dismiss_failed\":\"Não foi possível desfazer. O achado continua descartado.\"},\"learningRail\":{\"add_namespace\":\"Adicionar namespace\",\"confirm_delete\":\"Excluir “{{name}}” e tudo que ele aprendeu? Isso não pode ser desfeito.\",\"delete_2\":\"Excluir\",\"delete_namespace\":\"Excluir o namespace {{name}}\",\"invalid_namespace_name\":\"Os nomes dos namespaces viram nomes de pasta, então só podem conter letras latinas minúsculas (a–z), dígitos (0–9), pontos, hifens e sublinhados, precisam começar e terminar com uma letra ou um dígito e ter de 2 a 64 caracteres.\",\"invalid_namespace_name_char\":\"“{{char}}” não pode ser usado no nome de um namespace. Use letras minúsculas a–z, 0–9, .\xA0-⁠\xA0_\",\"invalid_namespace_name_letter\":\"“{{char}}” ({{script}}, {{code}}) não pode ser usado no nome de um namespace. Use letras minúsculas a–z, 0–9, .\xA0-⁠\xA0_\",\"keep_it\":\"Manter\",\"load_namespace_during_reviews\":\"Carregar o namespace {{name}} durante as revisões\",\"loading\":\"Carregando…\",\"namespace_active\":\"Ativo — carregado durante as revisões (desmarque para desativar)\",\"namespace_inactive\":\"Inativo — marque para carregar durante as revisões\",\"namespaces\":\"Namespaces\",\"new_namespace\":\"Novo namespace\",\"new_namespace_2\":\"new-namespace\",\"new_namespace_name\":\"Nome do novo namespace\",\"pattern_many\":\"{{count}} padrões\",\"pattern_one\":\"{{count}} padrão\",\"pattern_other\":\"{{count}} padrões\",\"pending_count_many\":\"{{count}} pendentes\",\"pending_count_one\":\"{{count}} pendente\",\"pending_count_other\":\"{{count}} pendentes\",\"read_namespace\":\"Ler o namespace {{name}}\"},\"leftRail\":{\"code_review_sage\":\"Code Review Sage\",\"learning\":\"Aprendizado\",\"reviews\":\"Revisões\",\"sections\":\"Seções\",\"settings\":\"Configurações\",\"version\":\"v{{version}}\"},\"listSkeleton\":{\"loading_reviews\":\"Carregando revisões…\"},\"middleColumn\":{\"all_repos\":\"Todos os repos\",\"just_this_repo\":\"Só {{repo}}\",\"lists_label\":\"Pull requests ou revisões\",\"no_reviews_for_repo\":\"Nenhuma revisão para {{repo}}\",\"no_reviews_yet\":\"Ainda não há revisões\",\"pick_a_repo_then_a_pr\":\"Escolha um repo e depois uma pull request.\",\"pull_requests\":\"Pull requests\",\"repo_lists_label\":\"{{repo}}: pull requests ou revisões\",\"repo_reviews_appear_here\":\"As revisões que você inicia para este repo aparecem aqui.\",\"reviews\":\"Revisões\",\"show_all_count\":\"Mostrar todas ({{count}})\",\"this_repo_only\":\"só {{repo}}\"},\"postCommentsButton\":{\"cancel\":\"Cancelar\",\"confirm_post_many\":\"Publicar {{count}} comentários na pull request?\",\"confirm_post_one\":\"Publicar {{count}} comentário na pull request?\",\"confirm_post_other\":\"Publicar {{count}} comentários na pull request?\",\"drafted_publish_on_pr_page_many\":\"{{count}} comentários rascunhados — abra aqui o pull request para publicar\",\"drafted_publish_on_pr_page_one\":\"{{count}} comentário rascunhado — abra aqui o pull request para publicar\",\"drafted_publish_on_pr_page_other\":\"{{count}} comentários rascunhados — abra aqui o pull request para publicar\",\"post_action\":\"Publicar\",\"post_count_many\":\"Publicar {{count}} comentários\",\"post_count_one\":\"Publicar {{count}} comentário\",\"post_count_other\":\"Publicar {{count}} comentários\",\"post_failed\":\"Falha ao publicar\",\"posted_age\":\"Publicado {{age}}\",\"posted_comments_many\":\"{{count}} comentários publicados\",\"posted_comments_one\":\"{{count}} comentário publicado\",\"posted_comments_other\":\"{{count}} comentários publicados\",\"posting\":\"Publicando…\",\"publish_these_findings_as_a_review_on_the_pull_r\":\"Publicar estes achados como uma revisão na pull request\"},\"prPickList\":{\"a_review_of_this_pull_request_is_running\":\"Uma revisão desta pull request está rodando\",\"add_a_repo\":\"Adicionar um repo\",\"already_reviewed\":\"Já revisada\",\"cancel\":\"Cancelar\",\"confirm_review_all\":\"Revisar todas as {{count}} pull requests?\",\"draft\":\"rascunho\",\"filter_pull_requests\":\"Filtrar pull requests\",\"new\":\"nova\",\"no_open_prs_here\":\"Não há pull requests abertas aqui.\",\"no_prs_match_filter\":\"Nenhuma pull request corresponde ao seu filtro.\",\"one_or_more_github_pr_links\":\"Um ou mais links de PR do GitHub\",\"open_pr\":\"Abrir a pull request #{{number}}: {{title}}\",\"paste_pr_links\":\"Colar links de PR\",\"paste_pr_links_instead\":\"Colar links de PR em vez disso\",\"pick_a_repo_to_see_its_pull_requests\":\"Escolha um repo para ver suas pull requests.\",\"pr_already_being_reviewed\":\"A pull request #{{number}} já está sendo revisada\",\"re_read_open_prs_from_github\":\"Reler as PRs abertas do GitHub\",\"refresh_pull_requests\":\"Atualizar as pull requests\",\"repos_live_in_the_sidebar\":\"Os repos ficam na barra lateral.\",\"review_all_count\":\"Revisar todas as {{count}}\",\"review_every_open_pr_not_yet_reviewed_at_its_cur\":\"Revisar toda PR aberta que ainda não foi revisada no head atual\",\"review_pr\":\"Revisar a pull request #{{number}}: {{title}}\",\"review_selected_count_many\":\"Revisar {{count}} selecionados\",\"review_selected_count_one\":\"Revisar {{count}} selecionado\",\"review_selected_count_other\":\"Revisar {{count}} selecionados\",\"review_these\":\"Revisar estas\",\"reviewed\":\"revisada\",\"reviewed_age\":\"Revisada {{age}}\",\"reviewed_before_the_head_commit_has_moved_since\":\"Já revisada — o commit head mudou desde então\",\"reviewing\":\"revisando\",\"updated\":\"atualizada\"},\"prReviewDetail\":{\"author\":\"Autor\",\"cancelled_before_finishing\":\"Ela foi cancelada antes desta terminar.\",\"did_not_complete_for_this_change\":\"A revisão não terminou para esta mudança.\",\"draft\":\"rascunho\",\"findings_appear_here_as_soon_as_the_review_finis\":\"Os achados aparecem aqui assim que a revisão termina. Você pode sair da página — uma notificação vai avisar quando ela chegar.\",\"head\":\"head\",\"loading_pull_request_details\":\"Carregando os detalhes da pull request…\",\"loading_review\":\"Carregando a revisão…\",\"nothing_flagged_on_this_pull_request\":\"Nada foi sinalizado nesta pull request.\",\"open_on_github\":\"Abrir no GitHub\",\"pull_request\":\"Pull request\",\"pull_request_detail\":\"Detalhe da pull request\",\"retry_review\":\"Tentar a revisão de novo\",\"review\":\"Revisar\",\"review_again\":\"Revisar de novo\",\"review_again_at_current_head\":\"Revisar esta pull request de novo no head atual\",\"review_already_running\":\"Uma revisão desta pull request já está rodando\",\"review_completed_with_no_findings\":\"A revisão terminou e não trouxe achados que valham o seu tempo.\",\"review_this_pull_request\":\"Revisar esta pull request\",\"reviewing\":\"Revisando…\",\"running\":\"rodando\",\"sage_review\":\"Revisão do Sage\",\"see_the_reason_above\":\"Veja o motivo acima.\",\"start_a_review_and_its_findings_appear_here_you\":\"Inicie uma revisão e os achados dela aparecem aqui — você pode sair da página, uma notificação vai avisar quando ela chegar.\",\"that_review_produced_no_report_for_this_pull_req\":\"Aquela revisão não gerou nenhum relatório para esta pull request.\",\"this_pull_request_has_not_been_reviewed_yet\":\"Esta pull request ainda não foi revisada.\",\"updated\":\"atualizada\"},\"prSourcePanel\":{\"load_failed\":\"Não foi possível carregar os detalhes da pull request: {{reason}}\",\"partial_sections\":\"Algumas seções estão incompletas ({{sections}}) — a requisição ao provedor falhou ou atingiu um limite de página.\"},\"prStatusChips\":{\"all_checks_passed_many\":\"todas as {{count}} verificações passaram\",\"all_checks_passed_one\":\"{{count}} verificação passou\",\"all_checks_passed_other\":\"todas as {{count}} verificações passaram\",\"checks_failing_many\":\"{{failed}} de {{count}} verificações falhando\",\"checks_failing_one\":\"{{failed}} de {{count}} verificação falhando\",\"checks_failing_other\":\"{{failed}} de {{count}} verificações falhando\",\"checks_running_many\":\"{{pending}} de {{count}} verificações ainda rodando\",\"checks_running_one\":\"{{pending}} de {{count}} verificação ainda rodando\",\"checks_running_other\":\"{{pending}} de {{count}} verificações ainda rodando\",\"closed\":\"fechada\",\"conflicts\":\"conflitos\",\"failing_count_many\":\"{{count}} falhando\",\"failing_count_one\":\"{{count}} falhando\",\"failing_count_other\":\"{{count}} falhando\",\"merge_blocked\":\"merge bloqueado\",\"merged\":\"merged\",\"open\":\"aberta\",\"passed_count_many\":\"{{count}} passaram\",\"passed_count_one\":\"{{count}} passou\",\"passed_count_other\":\"{{count}} passaram\",\"running_count_many\":\"{{count}} em execução\",\"running_count_one\":\"{{count}} em execução\",\"running_count_other\":\"{{count}} em execução\"},\"repoSwitcher\":{\"add_a_repo\":\"Adicionar um repo\",\"all_repos\":\"Todos os repos\",\"filter_repos\":\"Filtrar repos\",\"filter_repositories\":\"Filtrar repositórios\",\"loading\":\"Carregando…\",\"no_repo_matches_that\":\"Nenhum repo corresponde a isso.\",\"no_repos_yet_add_one_to_pick_from_the_repos_you\":\"Ainda não há repos — adicione um para escolher entre os repos em que você trabalha.\",\"pick_a_repo\":\"Escolha um repo\",\"pick_a_repository\":\"Escolha um repositório\",\"recent\":\"Recentes\",\"repositories\":\"Repositórios\",\"repository_named\":\"Repositório: {{name}}\"},\"reportView\":{\"blast_radius\":\"Alcance do impacto: {{scope}}\",\"blocking_count_many\":\"{{count}} bloqueantes\",\"blocking_count_one\":\"{{count}} bloqueante\",\"blocking_count_other\":\"{{count}} bloqueantes\",\"changes_reviewed_many\":\"{{count}} mudanças revisadas\",\"changes_reviewed_one\":\"{{count}} mudança revisada\",\"changes_reviewed_other\":\"{{count}} mudanças revisadas\",\"clear\":\"Limpar\",\"design_gate\":\"Portão de design ·\",\"design_risk\":\"Risco de design: {{level}}\",\"draft_selected_many\":\"Rascunhar {{count}} constatações selecionadas\",\"draft_selected_one\":\"Rascunhar {{count}} constatação selecionada\",\"draft_selected_other\":\"Rascunhar {{count}} constatações selecionadas\",\"finding_dimension_in_file\":\"{{dimension}} em {{file}}\",\"generated\":\"· gerado\",\"moved_to\":\"Agora em {{band}}. Mantido no lugar até você mudar o filtro.\",\"no_changes_in_this_band\":\"Nenhuma mudança nesta categoria.\",\"nothing_flagged_in_this_review\":\"Nada foi sinalizado nesta revisão.\",\"open_shared_copy\":\"Abrir a cópia compartilhada\",\"open_the_pull_request\":\"Abrir a pull request\",\"share\":\"Compartilhar\",\"sharing\":\"Compartilhando…\",\"should_fix_count_many\":\"{{count}} devem ser corrigidos\",\"should_fix_count_one\":\"{{count}} deve ser corrigido\",\"should_fix_count_other\":\"{{count}} devem ser corrigidos\",\"step_problem\":\"Problema\",\"step_solution_fit\":\"Adequação da solução\",\"step_why_it_matters\":\"Por que isso importa\"},\"reviewChat\":{\"continue_hint\":\"A conversa com este revisor continua na aba de chat.\",\"continue_session\":\"Continuar a sessão de acompanhamento\",\"earlier_questions\":\"Perguntas anteriores\",\"error_generic\":\"Não foi possível abrir a sessão de acompanhamento. Tente novamente.\",\"error_run_deleted\":\"Esta revisão foi excluída, então a conversa terminou.\",\"loading\":\"Carregando…\",\"new_session_unavailable\":\"Este app ainda não consegue abrir uma nova sessão de acompanhamento: é preciso um Kiro Crew que permita a um app abrir uma sessão de chat com nome. Uma sessão de acompanhamento que você já abriu ainda pode continuar.\",\"not_recorded_notice\":\"Esta revisão não guardou uma sessão do revisor, portanto não há nada para reabrir. Revise este pull request novamente para perguntar.\",\"open_session\":\"Abrir uma sessão de acompanhamento\",\"opening\":\"Abrindo…\",\"ran_tools\":\"Consultou: {{tools}}\",\"reasoning\":\"Raciocínio\",\"refused_notice\":\"Ele precisava executar uma ferramenta para responder por completo e não teve permissão, então esta resposta é limitada. Ative o YOLO para permitir.\",\"resume_hint\":\"Abre um chat que retoma o revisor, mantendo o raciocínio por trás das constatações.\",\"role_reviewer\":\"Revisor\",\"role_you\":\"Você\",\"run_live_notice\":\"Esta revisão ainda está em andamento. As constatações podem mudar até ela terminar, portanto ainda não há o que perguntar.\",\"title\":\"Perguntar ao revisor\",\"transcript_gone_notice\":\"A sessão do revisor não está mais no disco, portanto não há nada para reabrir. Revise este pull request novamente para perguntar.\"},\"reviewQueue\":{\"empty\":\"Nenhum pull request aguarda sua revisão.\",\"filter_by_repo\":\"Filtrar por repositório ou título\",\"setup_required\":\"Configure a CLI do GitHub para ver os pedidos de revisão\",\"starts_review\":\"Cada escolha executa uma revisão do Sage. Os resultados aparecem em Revisões e só são publicados no GitHub se você decidir.\",\"starts_review_truncated\":\"Só as 100 solicitações mais recentes aparecem. Cada escolha executa uma revisão do Sage. Os resultados aparecem em Revisões e só são publicados no GitHub se você decidir.\",\"tab\":\"Pedidos\"},\"runCard\":{\"cancel\":\"Cancelar\",\"clean\":\"Limpa\",\"delete\":\"Excluir\",\"delete_review_of\":\"Excluir a revisão de {{label}}\",\"delete_this_review\":\"Excluir esta revisão\",\"delete_this_review_2\":\"Excluir esta revisão?\",\"more_count_many\":\"+{{count}} mais\",\"more_count_one\":\"+{{count}} mais\",\"more_count_other\":\"+{{count}} mais\",\"needs_review_count_many\":\"{{count}} precisam de revisão\",\"needs_review_count_one\":\"{{count}} precisa de revisão\",\"needs_review_count_other\":\"{{count}} precisam de revisão\",\"pull_requests\":\"pull requests\",\"review\":\"Revisão\",\"review_of\":\"Revisão de {{label}}\",\"review_of_with_more_many\":\"Revisão de {{label}} e mais {{count}}\",\"review_of_with_more_one\":\"Revisão de {{label}} e mais {{count}}\",\"review_of_with_more_other\":\"Revisão de {{label}} e mais {{count}}\",\"worth_a_glance_count_many\":\"{{count}} valem uma olhada\",\"worth_a_glance_count_one\":\"{{count}} vale uma olhada\",\"worth_a_glance_count_other\":\"{{count}} valem uma olhada\"},\"runDetail\":{\"cancelled_before_any_finished\":\"Ela foi cancelada antes de qualquer pull request terminar.\",\"finished\":\"terminou\",\"loading_report\":\"Carregando o relatório…\",\"more_count_many\":\"+{{count}} mais\",\"more_count_one\":\"+{{count}} mais\",\"more_count_other\":\"+{{count}} mais\",\"nothing_to_report\":\"Nenhuma pull request completou uma revisão, então não havia nada a relatar.\",\"pull_request_many\":\"{{count}} pull requests\",\"pull_request_one\":\"{{count}} pull request\",\"pull_request_other\":\"{{count}} pull requests\",\"report_appears_when_the_review_finishes\":\"O relatório aparece aqui assim que a revisão termina.\",\"skipped_inflight_many\":\"{{count}} pull requests foram ignoradas porque outra revisão já as tinha.\",\"skipped_inflight_one\":\"{{count}} pull request foi ignorada porque outra revisão já a tinha.\",\"skipped_inflight_other\":\"{{count}} pull requests foram ignoradas porque outra revisão já as tinha.\",\"started\":\"começou\",\"this_review_produced_no_report\":\"Esta revisão não gerou nenhum relatório.\",\"you_can_leave_this_page_a_notification_will_tell\":\"Você pode sair desta página — uma notificação vai avisar quando ela chegar.\"},\"runList\":{\"new_review\":\"Nova revisão\"},\"runProgress\":{\"cancel_review\":\"Cancelar a revisão\",\"cancelled_count_many\":\"{{count}} canceladas\",\"cancelled_count_one\":\"{{count}} cancelada\",\"cancelled_count_other\":\"{{count}} canceladas\",\"cancelling\":\"Cancelando…\",\"elapsed_time\":\"Tempo decorrido\",\"failed_count_many\":\"{{count}} falharam\",\"failed_count_one\":\"{{count}} falhou\",\"failed_count_other\":\"{{count}} falharam\",\"median_of_past_runs_of_this_size\":\"Mediana das execuções anteriores deste tamanho\",\"review_progress\":\"Progresso da revisão\",\"reviewed_of_many\":\"{{done}} / {{count}} revisadas\",\"reviewed_of_one\":\"{{done}} / {{count}} revisada\",\"reviewed_of_other\":\"{{done}} / {{count}} revisadas\",\"reviewers_busy\":\"{{busy}} de {{max}} revisores ocupados\",\"step\":\"· passo\",\"stops_queued_prs_one_already_being_reviewed_will\":\"Interrompe as PRs na fila; a que já está sendo revisada vai terminar.\",\"usually\":\"normalmente ~\",\"working\":\"Trabalhando\"},\"runStatusPill\":{\"cancelled\":\"Cancelado\",\"cancelling\":\"Cancelando\",\"done\":\"Concluído\",\"error\":\"Erro\",\"interrupted\":\"Interrompido\",\"running\":\"Em execução\"},\"shipSummaryCard\":{\"post_the_ship_readiness_summary\":\"Publicar o resumo de prontidão para lançar\",\"post_this_comment\":\"Publicar este comentário\",\"posted_as_a_top_level_comment\":\"publicado como comentário de nível superior\",\"posted_to_the_pull_request\":\"Publicado na pull request\",\"posting\":\"Publicando…\",\"select_the_ship_readiness_summary_to_post\":\"Selecionar o resumo de prontidão para lançar e publicá-lo\",\"ship_readiness_summary\":\"Resumo de prontidão para lançar\"}},\"lib\":{\"format\":{\"cause_no_agent_cli\":\"O revisor nunca iniciou — nenhum executável kiro-cli foi encontrado neste host. Instale-o, ou adicione-o ao PATH.\",\"cause_no_record\":\"O revisor terminou mas não registrou nenhum achado.\",\"cause_record_incomplete\":\"O revisor escreveu um registro de achados mas parou antes de concluir a revisão.\",\"cause_runtime_died\":\"O processo do revisor parou no meio da revisão — normalmente porque o gateway reiniciou. Não havia nada de errado com a pull request.\",\"cause_runtime_not_importable\":\"O revisor nunca iniciou — esta instalação não consegue carregar o runtime de agente de que precisa. Repare a instalação para restaurá-lo.\",\"cause_runtime_unavailable\":\"O revisor nunca iniciou — o runtime de agente dele não está disponível neste host.\",\"cause_timeout\":\"A revisão passou do limite de tempo.\",\"cause_turn_failed\":\"O turno de revisão falhou antes de registrar qualquer coisa.\",\"cause_unknown\":\"A revisão não foi concluída.\",\"days_ago_many\":\"há {{count}} d\",\"days_ago_one\":\"há {{count}} d\",\"days_ago_other\":\"há {{count}} d\",\"hours_ago_many\":\"há {{count}} h\",\"hours_ago_one\":\"há {{count}} h\",\"hours_ago_other\":\"há {{count}} h\",\"just_now\":\"agora mesmo\",\"minutes_ago_many\":\"há {{count}} min\",\"minutes_ago_one\":\"há {{count}} min\",\"minutes_ago_other\":\"há {{count}} min\",\"phase_cancelled\":\"Cancelada\",\"phase_done\":\"Concluída\",\"phase_failed\":\"Falhou\",\"phase_pending\":\"Pendente\",\"phase_queued\":\"Na fila\",\"phase_reviewing\":\"Revisando\"}},\"manifest\":{\"configuration_1\":\"Instale e autentique a CLI gh no host do gateway, adicione um repositório e escolha em Configurações o modelo de revisão, o nível de raciocínio e a concorrência.\",\"description\":\"Faz uma revisão profunda de pull requests do GitHub e diz quais alterações realmente merecem a sua atenção. Cada pull request é revisado em uma sessão de agente isolada que cobre todos os arquivos alterados, ponderados pelo raio de impacto que carrega, e tudo é consolidado em um Focus Report priorizado. As descobertas são lidas no app e só são preparadas como uma revisão rascunho no GitHub quando você as publica ou ativa a publicação automática, e o revisor continua aprendendo os padrões reais do seu repositório a partir de correções já entregues e de comentários de revisões anteriores.\",\"display_name\":\"Code Review Sage\",\"highlight_1\":\"O Focus Report classifica as alterações por raio de impacto, para os arquivos arriscados serem lidos primeiro\",\"highlight_2\":\"Uma sessão de agente isolada por pull request, para que as descobertas nunca vazem entre revisões\",\"highlight_3\":\"As revisões são lidas no app — nada é publicado no seu pull request a menos que você peça\",\"highlight_4\":\"Aprende por repositório com correções entregues, comentários de revisão e discussões de design\",\"highlight_5\":\"Revisa pull requests do GitHub; precisa de uma CLI `gh` autenticada no host do gateway\",\"page_label\":\"Code Review Sage\",\"use_case_1\":\"Revise uma ou várias pull requests do GitHub por risco, examine descobertas específicas e prepare apenas os comentários que valem a pena publicar.\"},\"views\":{\"learningView\":{\"cancel\":\"Cancelar\",\"confirm_merge_many\":\"Mesclar {{count}} aprendizados no conjunto de regras?\",\"confirm_merge_one\":\"Mesclar {{count}} aprendizado no conjunto de regras?\",\"confirm_merge_other\":\"Mesclar {{count}} aprendizados no conjunto de regras?\",\"consolidate\":\"Consolidar\",\"consolidate_pending_many\":\"Consolidar {{count}} aprendizados pendentes em {{namespace}}\",\"consolidate_pending_one\":\"Consolidar {{count}} aprendizado pendente em {{namespace}}\",\"consolidate_pending_other\":\"Consolidar {{count}} aprendizados pendentes em {{namespace}}\",\"consolidating\":\"Consolidando…\",\"learning\":\"Aprendizado\",\"loaded_during_reviews\":\"carregado durante as revisões\",\"loading_learnings\":\"Carregando os aprendizados…\",\"merge_failed_ruleset_unchanged\":\"A mesclagem falhou — conjunto de regras inalterado\",\"not_loaded\":\"não carregado\",\"nothing_consolidated_yet_reviews_in_this_namespa\":\"Nada consolidado ainda — as revisões neste namespace hoje não carregam nenhum padrão aprendido.\",\"nothing_staged_new_learnings_land_here_when_a_re\":\"Nada preparado. Novos aprendizados chegam aqui quando uma revisão analisa uma correção lançada ou um comentário de revisão que foi atendido.\",\"pattern_many\":\"{{count}} padrões\",\"pattern_one\":\"{{count}} padrão\",\"pattern_other\":\"{{count}} padrões\",\"pending_consolidation\":\"Consolidação pendente ·\",\"pick_a_namespace_in_the_sidebar_to_read_the_patt\":\"Escolha um namespace na barra lateral para ler os padrões que as revisões carregam dele.\",\"reviews_read_the_consolidated_ruleset_below_neve\":\"As revisões leem o conjunto de regras consolidado abaixo, nunca os candidatos pendentes. Consolidar mescla nele o que está preparado — uma mesclagem por IA de uma vez só, disparada por você, então nada muda o que as revisões veem até você executar.\",\"ruleset\":\"Conjunto de regras ·\"},\"settingsView\":{\"default_agent_config\":\"Padrão (configuração do agente)\",\"default_model_provider\":\"Padrão (modelo / provedor)\",\"higher_effort_finds_more_costs_more_and_takes_lo\":\"Mais esforço acha mais, custa mais e leva mais tempo por pull request. No padrão, o modelo ou o provedor decide.\",\"how_many_pull_requests_are_reviewed_in_parallel\":\"Quantas pull requests são revisadas em paralelo no runtime de workers compartilhado. Esse é o limite real da vazão de revisões — várias linhas de revisão podem estar abertas ao mesmo tempo, mas todas tiram deste orçamento.\",\"loading_settings\":\"Carregando as configurações…\",\"model\":\"Modelo\",\"reasoning_effort\":\"Esforço de raciocínio\",\"review_model\":\"Modelo de revisão\",\"reviews_at_once\":\"Revisões ao mesmo tempo\",\"settings\":\"Configurações\",\"these_apply_to_every_review_started_from_here\":\"Isso vale para toda revisão iniciada por aqui.\",\"which_model_performs_the_review_default_inherits\":\"Qual modelo faz a revisão. O padrão herda a configuração do agente, então mudar seu modelo padrão muda isso também.\"}},\"workspace\":{\"drag_to_resize\":\"Arraste para redimensionar\",\"resize_sidebar\":\"Redimensionar a barra lateral\",\"select_a_review_to_see_its_progress_and_report\":\"Escolha uma revisão para ver o progresso e o relatório dela.\",\"start_a_new_one_several_can_run_at_once\":\"Inicie uma nova — várias podem rodar ao mesmo tempo.\"}},\"issueRadar\":{\"components\":{\"prDetail\":{\"labels\":\"Etiquetas\"}}}}"),
		components: { "resizeHandle": { "drag_to_resize": "Arraste para redimensionar" } },
		lib: { "scriptLabel": {
			"cyrillic": "letra cirílica",
			"greek": "letra grega",
			"latin": "letra latina",
			"other": "caractere"
		} }
	},
	ru: {
		app: {
			"collapse_sidebar": "Свернуть боковую панель",
			"expand_sidebar": "Развернуть боковую панель"
		},
		apps: /* @__PURE__ */ JSON.parse("{\"codeReviewSage\":{\"codeReviewSagePage\":{\"open_pr_few\":\"{{count}} открытых PR\",\"open_pr_many\":\"{{count}} открытых PR\",\"open_pr_one\":\"{{count}} открытый PR\",\"open_pr_other\":\"{{count}} открытого PR\",\"pattern_few\":\"{{count}} шаблона\",\"pattern_many\":\"{{count}} шаблонов\",\"pattern_one\":\"{{count}} шаблон\",\"pattern_other\":\"{{count}} шаблона\"},\"components\":{\"addReposModal\":{\"add\":\"Добавить\",\"add_one_by_url_above\":\"Добавь его по URL выше.\",\"add_repo\":\"Добавить {{repo}}\",\"add_repos\":\"Добавить репозитории\",\"added\":\"добавлен\",\"all_your_repos\":\"Все твои репозитории\",\"already_added\":\"{{repo}} уже добавлен\",\"archived\":\"архивный\",\"based_on_recent_github_activity\":\"По твоей недавней активности в GitHub\",\"close\":\"Закрыть\",\"close_add_repos_dialog\":\"Закрыть диалог добавления репозиториев\",\"contributed_events_few\":\"{{age}} · {{count}} событий\",\"contributed_events_many\":\"{{age}} · {{count}} событий\",\"contributed_events_one\":\"{{age}} · {{count}} событие\",\"contributed_events_other\":\"{{age}} · {{count}} событий\",\"filter_your_repos\":\"Отфильтруй свои репозитории\",\"gh_auth_login\":\"gh auth login\",\"github_cli_not_ready\":\"GitHub CLI не готов\",\"newest_100_by_push_date\":\"100 последних по дате отправки\",\"no_repos_for_account\":\"Для твоей учётной записи репозитории не найдены.\",\"no_repos_match_filter\":\"Ни один репозиторий не подходит под твой фильтр.\",\"owner_repo_a_repo_url_or_paste_a_pull_request_li\":\"owner/repo, URL репозитория или вставь ссылку на pull request\",\"pick_from_the_repos_you_can_reach_or_type_one_in\":\"Выбери из доступных тебе репозиториев или введи название вручную. Добавленные репозитории появляются на боковой панели, чтобы ты мог запустить ревью из них. Вставь ссылку на pull request — и он откроется сразу.\",\"pinned_to_the_sidebar\":\"закреплён на боковой панели\",\"private\":\"Приватный\",\"pushed_age\":\"отправлено {{age}}\",\"re_read_your_repos_from_github\":\"Перечитать твои репозитории из GitHub\",\"read_only\":\"только чтение\",\"read_only_access\":\"Доступ только для чтения\",\"reading_your_repos_from_github\":\"Читаю твои репозитории из GitHub…\",\"recently_worked_on\":\"Недавно в работе\",\"refresh_your_repos\":\"Обновить твои репозитории\",\"remove\":\"Убрать\",\"remove_repo\":\"Убрать {{repo}}\",\"repository_or_pull_request_url_or_owner_repo\":\"URL репозитория или pull request, либо owner/repo\",\"setup_hint\":\"Установи GitHub CLI и войди командой ниже, чтобы получить список твоих репозиториев. Любой репозиторий по-прежнему можно добавить по URL выше.\",\"these_lists_are_capped_so_a_repo_you_have_not_to\":\"Эти списки ограничены, поэтому репозиторий, которого ты давно не касался, может отсутствовать. Добавь его по URL выше, если не видишь.\",\"your_repos\":\"Твои репозитории\"},\"bandChips\":{\"all\":\"Все\",\"clean\":\"Без замечаний\",\"filter_by_band\":\"Фильтровать по категории\",\"needs_review\":\"Нужен разбор\",\"worth_a_glance\":\"Стоит взглянуть\"},\"draftReviewActions\":{\"approve\":\"Одобрить\",\"approve_is_unavailable_because_this_base_branch_\":\"Одобрение недоступно: базовая ветка этого пул-реквеста не отзывает одобрения при новых коммитах (или её защита отсюда не читается). Иначе одобрение может пережить проверенный коммит. Одобрите на GitHub.\",\"approve_is_unavailable_while_auto_merge_is_armed\":\"Одобрение недоступно, пока включено автослияние: одобрение может влить этот пул-реквест до того, как проверка head успеет его отозвать. Отключите автослияние или одобрите на GitHub.\",\"ask_agent_about_this_failure\":\"Спросить агента об этой ошибке\",\"cancel\":\"Отмена\",\"confirm_approve\":\"Одобрить этот пул-реквест?\",\"confirm_request_changes\":\"Опубликовать эту проверку с запросом изменений?\",\"confirm_submit_as_comment\":\"Отправить эту проверку как комментарий?\",\"couldn_t_check_for_a_draft_review_on_this_pull_r\":\"Не удалось проверить наличие черновика проверки в этом пул-реквесте. Обычно это проблема аутентификации GitHub CLI, а не отсутствие черновика.\",\"draft_review\":\"Черновик проверки\",\"no_draft_review_on_this_pull_request\":\"В этом пул-реквесте нет черновика проверки.\",\"pending_only_you_can_see_it_until_you_publish\":\"Ожидает — до публикации его видите только вы.\",\"publish_failed\":\"Не удалось опубликовать проверку\",\"published_as\":\"Опубликовано как\",\"published_verdict_approved\":\"одобрено\",\"published_verdict_changes_requested\":\"запрошены изменения\",\"published_verdict_comment\":\"комментарий\",\"publishing\":\"Публикация…\",\"publishing_is_blocked_a_later_review_replaced_th\":\"Публикация заблокирована: более поздняя проверка заменила этот черновик в пул-реквесте, поэтому он больше не содержит результатов этой проверки. Откройте последнюю проверку, чтобы опубликовать её.\",\"publishing_is_blocked_this_draft_contains_conten\":\"Публикация заблокирована: черновик содержит данные, которые нужно скрыть, а отправка опубликует исходный текст. Отредактируйте или удалите черновик на GitHub.\",\"publishing_is_blocked_this_draft_was_written_aga\":\"Публикация заблокирована: черновик написан для более раннего коммита, а пул-реквест с тех пор изменился. Сначала проверьте текущий head.\",\"publishing_is_blocked_this_review_is_still_runni\":\"Публикация заблокирована: эта проверка ещё выполняется, поэтому черновик в этом пул-реквесте относится к предыдущему запуску.\",\"publishing_is_irreversible_and_visible_to_everyo\":\"Публикация необратима и видна всем участникам пул-реквеста.\",\"request_changes\":\"Запросить изменения\",\"submit_as_comment\":\"Отправить как комментарий\",\"this_draft_has_no_summary_body\":\"У этого черновика нет текста сводки.\",\"try_again\":\"Повторить попытку\"},\"failureNotice\":{\"run_it_again\":\"Запустить снова\",\"starting\":\"Запускаю…\",\"this_review_failed\":\"Это ревью завершилось ошибкой\"},\"findingCard\":{\"cancel_dismiss\":\"Отмена\",\"confirm_dismiss\":\"Отклонить замечание\",\"consequence\":\"Последствие\",\"dismiss\":\"Отклонить\",\"dismiss_failed\":\"Не удалось сохранить отклонение. Попробуй ещё раз.\",\"dismiss_reason_label\":\"Почему ты отклоняешь это замечание?\",\"dismiss_reason_placeholder\":\"Например: ложное срабатывание, вне рамок\",\"dismissed_reason\":\"Отклонено: {{reason}}\",\"evidence\":\"Подтверждение\",\"observation\":\"Наблюдение\",\"post_finding\":\"Опубликовать эту находку в pull request\",\"post_finding_on\":\"Опубликовать эту находку в {{target}}\",\"post_this_comment\":\"Опубликовать этот комментарий\",\"posted_to_the_pull_request\":\"Опубликовано в pull request\",\"posting\":\"Публикую…\",\"select_to_draft_together\":\"Выбрать для пакетного черновика\",\"select_to_post\":\"Выбрать {{label}} для публикации\",\"severity_must_fix\":\"Обязательно\",\"severity_should_fix\":\"Желательно\",\"suggestion\":\"Предложение\",\"this_finding\":\"эту находку\",\"undo_dismiss\":\"Отменить\",\"undo_dismiss_failed\":\"Не удалось отменить. Замечание по-прежнему отклонено.\"},\"learningRail\":{\"add_namespace\":\"Добавить namespace\",\"confirm_delete\":\"Удалить «{{name}}» и всё, что он выучил? Это нельзя отменить.\",\"delete_2\":\"Удалить\",\"delete_namespace\":\"Удалить namespace {{name}}\",\"invalid_namespace_name\":\"Имена namespace становятся именами папок, поэтому в них можно использовать только строчные латинские буквы (a–z), цифры (0–9), точки, дефисы и подчёркивания. Имя должно начинаться и заканчиваться буквой или цифрой и содержать от 2 до 64 символов.\",\"invalid_namespace_name_char\":\"«{{char}}» нельзя использовать в имени namespace. Используй строчные буквы a–z, 0–9, .\xA0-⁠\xA0_\",\"invalid_namespace_name_letter\":\"«{{char}}» ({{script}}, {{code}}) нельзя использовать в имени namespace. Используй строчные буквы a–z, 0–9, .\xA0-⁠\xA0_\",\"keep_it\":\"Оставить\",\"load_namespace_during_reviews\":\"Загружать namespace {{name}} во время ревью\",\"loading\":\"Загрузка…\",\"namespace_active\":\"Активен — загружается во время ревью (сними отметку, чтобы отключить)\",\"namespace_inactive\":\"Неактивен — отметь, чтобы загружать во время ревью\",\"namespaces\":\"Namespace’ы\",\"new_namespace\":\"Новый namespace\",\"new_namespace_2\":\"new-namespace\",\"new_namespace_name\":\"Имя нового namespace\",\"pattern_few\":\"{{count}} шаблона\",\"pattern_many\":\"{{count}} шаблонов\",\"pattern_one\":\"{{count}} шаблон\",\"pattern_other\":\"{{count}} шаблона\",\"pending_count_few\":\"{{count}} в ожидании\",\"pending_count_many\":\"{{count}} в ожидании\",\"pending_count_one\":\"{{count}} в ожидании\",\"pending_count_other\":\"{{count}} в ожидании\",\"read_namespace\":\"Прочитать namespace {{name}}\"},\"leftRail\":{\"code_review_sage\":\"Code Review Sage\",\"learning\":\"Обучение\",\"reviews\":\"Ревью\",\"sections\":\"Разделы\",\"settings\":\"Настройки\",\"version\":\"v{{version}}\"},\"listSkeleton\":{\"loading_reviews\":\"Загружаю ревью…\"},\"middleColumn\":{\"all_repos\":\"Все репозитории\",\"just_this_repo\":\"Только {{repo}}\",\"lists_label\":\"Pull request’ы или ревью\",\"no_reviews_for_repo\":\"Нет ревью для {{repo}}\",\"no_reviews_yet\":\"Ревью пока нет\",\"pick_a_repo_then_a_pr\":\"Выбери репозиторий, а затем pull request.\",\"pull_requests\":\"Pull request’ы\",\"repo_lists_label\":\"{{repo}}: pull request’ы или ревью\",\"repo_reviews_appear_here\":\"Ревью, которые ты запускаешь для этого репозитория, появляются здесь.\",\"reviews\":\"Ревью\",\"show_all_count\":\"Показать все ({{count}})\",\"this_repo_only\":\"только {{repo}}\"},\"postCommentsButton\":{\"cancel\":\"Отмена\",\"confirm_post_few\":\"Опубликовать {{count}} комментария в pull request?\",\"confirm_post_many\":\"Опубликовать {{count}} комментариев в pull request?\",\"confirm_post_one\":\"Опубликовать {{count}} комментарий в pull request?\",\"confirm_post_other\":\"Опубликовать {{count}} комментария в pull request?\",\"drafted_publish_on_pr_page_few\":\"Черновик из {{count}} комментариев — откройте пул-реквест здесь, чтобы опубликовать\",\"drafted_publish_on_pr_page_many\":\"Черновик из {{count}} комментариев — откройте пул-реквест здесь, чтобы опубликовать\",\"drafted_publish_on_pr_page_one\":\"Черновик из {{count}} комментария — откройте пул-реквест здесь, чтобы опубликовать\",\"drafted_publish_on_pr_page_other\":\"Черновик из {{count}} комментариев — откройте пул-реквест здесь, чтобы опубликовать\",\"post_action\":\"Опубликовать\",\"post_count_few\":\"Опубликовать {{count}} комментария\",\"post_count_many\":\"Опубликовать {{count}} комментариев\",\"post_count_one\":\"Опубликовать {{count}} комментарий\",\"post_count_other\":\"Опубликовать {{count}} комментария\",\"post_failed\":\"Не удалось опубликовать\",\"posted_age\":\"Опубликовано {{age}}\",\"posted_comments_few\":\"Опубликовано {{count}} комментария\",\"posted_comments_many\":\"Опубликовано {{count}} комментариев\",\"posted_comments_one\":\"Опубликован {{count}} комментарий\",\"posted_comments_other\":\"Опубликовано {{count}} комментария\",\"posting\":\"Публикую…\",\"publish_these_findings_as_a_review_on_the_pull_r\":\"Опубликовать эти находки как ревью в pull request\"},\"prPickList\":{\"a_review_of_this_pull_request_is_running\":\"Ревью этого pull request уже идёт\",\"add_a_repo\":\"Добавить репозиторий\",\"already_reviewed\":\"Уже отревьюен\",\"cancel\":\"Отмена\",\"confirm_review_all\":\"Проверить все {{count}} пул-реквеста?\",\"draft\":\"черновик\",\"filter_pull_requests\":\"Фильтровать pull request’ы\",\"new\":\"новый\",\"no_open_prs_here\":\"Здесь нет открытых pull request’ов.\",\"no_prs_match_filter\":\"Ни один pull request не подходит под твой фильтр.\",\"one_or_more_github_pr_links\":\"Одна или несколько ссылок на PR в GitHub\",\"open_pr\":\"Открыть pull request #{{number}}: {{title}}\",\"paste_pr_links\":\"Вставить ссылки на PR\",\"paste_pr_links_instead\":\"Вместо этого вставить ссылки на PR\",\"pick_a_repo_to_see_its_pull_requests\":\"Выбери репозиторий, чтобы увидеть его pull request’ы.\",\"pr_already_being_reviewed\":\"Pull request #{{number}} уже на ревью\",\"re_read_open_prs_from_github\":\"Перечитать открытые PR из GitHub\",\"refresh_pull_requests\":\"Обновить pull request’ы\",\"repos_live_in_the_sidebar\":\"Репозитории находятся на боковой панели.\",\"review_all_count\":\"Проверить все {{count}}\",\"review_every_open_pr_not_yet_reviewed_at_its_cur\":\"Отревьюить каждый открытый PR, который ещё не проверен на текущем head\",\"review_pr\":\"Отревьюить pull request #{{number}}: {{title}}\",\"review_selected_count_few\":\"Проверить {{count}} выбранных\",\"review_selected_count_many\":\"Проверить {{count}} выбранных\",\"review_selected_count_one\":\"Проверить {{count}} выбранный\",\"review_selected_count_other\":\"Проверить {{count}} выбранных\",\"review_these\":\"Отревьюить эти\",\"reviewed\":\"отревьюен\",\"reviewed_age\":\"Отревьюен {{age}}\",\"reviewed_before_the_head_commit_has_moved_since\":\"Ревью уже было — с тех пор head-коммит изменился\",\"reviewing\":\"на ревью\",\"updated\":\"обновлён\"},\"prReviewDetail\":{\"author\":\"Автор\",\"cancelled_before_finishing\":\"Оно было отменено до того, как это успело закончиться.\",\"did_not_complete_for_this_change\":\"Ревью не завершилось для этого изменения.\",\"draft\":\"черновик\",\"findings_appear_here_as_soon_as_the_review_finis\":\"Находки появятся здесь, как только ревью закончится. Можешь уйти со страницы — уведомление сообщит, когда всё будет готово.\",\"head\":\"head\",\"loading_pull_request_details\":\"Загружаю детали pull request…\",\"loading_review\":\"Загружаю ревью…\",\"nothing_flagged_on_this_pull_request\":\"В этом pull request ничего не отмечено.\",\"open_on_github\":\"Открыть в GitHub\",\"pull_request\":\"Пул-реквест\",\"pull_request_detail\":\"Детали pull request\",\"retry_review\":\"Повторить ревью\",\"review\":\"Отревьюить\",\"review_again\":\"Отревьюить снова\",\"review_again_at_current_head\":\"Отревьюить этот pull request снова на текущем head\",\"review_already_running\":\"Ревью этого pull request уже идёт\",\"review_completed_with_no_findings\":\"Ревью завершилось и не нашло ничего, что стоило бы твоего времени.\",\"review_this_pull_request\":\"Отревьюить этот pull request\",\"reviewing\":\"Ревью идёт…\",\"running\":\"выполняется\",\"sage_review\":\"Ревью Sage\",\"see_the_reason_above\":\"Причина указана выше.\",\"start_a_review_and_its_findings_appear_here_you\":\"Запусти ревью — его находки появятся здесь. Можешь уйти со страницы, уведомление сообщит, когда всё будет готово.\",\"that_review_produced_no_report_for_this_pull_req\":\"То ревью не создало отчёта для этого pull request.\",\"this_pull_request_has_not_been_reviewed_yet\":\"Этот pull request ещё не отревьюен.\",\"updated\":\"обновлён\"},\"prSourcePanel\":{\"load_failed\":\"Не удалось загрузить детали pull request: {{reason}}\",\"partial_sections\":\"Некоторые разделы неполные ({{sections}}) — запрос к провайдеру завершился ошибкой или достиг лимита страниц.\"},\"prStatusChips\":{\"all_checks_passed_few\":\"все {{count}} проверки прошли\",\"all_checks_passed_many\":\"все {{count}} проверок прошли\",\"all_checks_passed_one\":\"{{count}} проверка прошла\",\"all_checks_passed_other\":\"все {{count}} проверки прошли\",\"checks_failing_few\":\"{{failed}} из {{count}} проверок падают\",\"checks_failing_many\":\"{{failed}} из {{count}} проверок падают\",\"checks_failing_one\":\"{{failed}} из {{count}} проверки падает\",\"checks_failing_other\":\"{{failed}} из {{count}} проверок падают\",\"checks_running_few\":\"{{pending}} из {{count}} проверок ещё выполняются\",\"checks_running_many\":\"{{pending}} из {{count}} проверок ещё выполняются\",\"checks_running_one\":\"{{pending}} из {{count}} проверки ещё выполняется\",\"checks_running_other\":\"{{pending}} из {{count}} проверок ещё выполняются\",\"closed\":\"закрыт\",\"conflicts\":\"конфликты\",\"failing_count_few\":\"{{count}} падают\",\"failing_count_many\":\"{{count}} падают\",\"failing_count_one\":\"{{count}} падает\",\"failing_count_other\":\"{{count}} падают\",\"merge_blocked\":\"merge заблокирован\",\"merged\":\"смерджен\",\"open\":\"открыт\",\"passed_count_few\":\"{{count}} прошли\",\"passed_count_many\":\"{{count}} прошли\",\"passed_count_one\":\"{{count}} прошла\",\"passed_count_other\":\"{{count}} прошли\",\"running_count_few\":\"{{count}} выполняются\",\"running_count_many\":\"{{count}} выполняются\",\"running_count_one\":\"{{count}} выполняется\",\"running_count_other\":\"{{count}} выполняются\"},\"repoSwitcher\":{\"add_a_repo\":\"Добавить репозиторий\",\"all_repos\":\"Все репозитории\",\"filter_repos\":\"Фильтровать репозитории\",\"filter_repositories\":\"Фильтровать репозитории\",\"loading\":\"Загрузка…\",\"no_repo_matches_that\":\"Под это ничего не подходит.\",\"no_repos_yet_add_one_to_pick_from_the_repos_you\":\"Репозиториев пока нет — добавь один, чтобы выбирать из тех, с которыми ты работаешь.\",\"pick_a_repo\":\"Выбери репозиторий\",\"pick_a_repository\":\"Выбери репозиторий\",\"recent\":\"Недавние\",\"repositories\":\"Репозитории\",\"repository_named\":\"Репозиторий: {{name}}\"},\"reportView\":{\"blast_radius\":\"Область влияния: {{scope}}\",\"blocking_count_few\":\"{{count}} блокирующих\",\"blocking_count_many\":\"{{count}} блокирующих\",\"blocking_count_one\":\"{{count}} блокирующий\",\"blocking_count_other\":\"{{count}} блокирующих\",\"changes_reviewed_few\":\"{{count}} изменения отревьюено\",\"changes_reviewed_many\":\"{{count}} изменений отревьюено\",\"changes_reviewed_one\":\"{{count}} изменение отревьюено\",\"changes_reviewed_other\":\"{{count}} изменения отревьюено\",\"clear\":\"Сбросить\",\"design_gate\":\"Проверка проектирования ·\",\"design_risk\":\"Риск проектирования: {{level}}\",\"draft_selected_few\":\"Составить черновик для {{count}} выбранных замечаний\",\"draft_selected_many\":\"Составить черновик для {{count}} выбранных замечаний\",\"draft_selected_one\":\"Составить черновик для {{count}} выбранного замечания\",\"draft_selected_other\":\"Составить черновик для {{count}} выбранных замечаний\",\"finding_dimension_in_file\":\"{{dimension}} в {{file}}\",\"generated\":\"· создан\",\"moved_to\":\"Теперь в {{band}}. Остаётся на месте, пока ты не сменишь фильтр.\",\"no_changes_in_this_band\":\"В этой категории изменений нет.\",\"nothing_flagged_in_this_review\":\"В этом ревью ничего не отмечено.\",\"open_shared_copy\":\"Открыть общую копию\",\"open_the_pull_request\":\"Открыть pull request\",\"share\":\"Поделиться\",\"sharing\":\"Делюсь…\",\"should_fix_count_few\":\"стоит исправить: {{count}}\",\"should_fix_count_many\":\"стоит исправить: {{count}}\",\"should_fix_count_one\":\"стоит исправить: {{count}}\",\"should_fix_count_other\":\"стоит исправить: {{count}}\",\"step_problem\":\"Проблема\",\"step_solution_fit\":\"Соответствие решения\",\"step_why_it_matters\":\"Почему это важно\"},\"reviewChat\":{\"continue_hint\":\"Разговор с этим проверяющим продолжается на вкладке чата.\",\"continue_session\":\"Продолжить сеанс\",\"earlier_questions\":\"Предыдущие вопросы\",\"error_generic\":\"Не удалось открыть сеанс для уточнений. Попробуйте снова.\",\"error_run_deleted\":\"Эта проверка удалена, поэтому разговор завершён.\",\"loading\":\"Загрузка…\",\"new_session_unavailable\":\"Это приложение пока не может открыть новый сеанс уточнений: для этого нужен Kiro Crew, который позволяет приложению открыть именованный сеанс чата. Уже открытый сеанс уточнений можно продолжить.\",\"not_recorded_notice\":\"В этой проверке сеанс проверяющего не сохранён, поэтому открывать нечего. Проверьте этот пул-реквест снова, чтобы задать вопросы.\",\"open_session\":\"Открыть сеанс для уточнений\",\"opening\":\"Открытие…\",\"ran_tools\":\"Просмотрено: {{tools}}\",\"reasoning\":\"Обоснование\",\"refused_notice\":\"Для полного ответа требовался запуск инструмента, но это не было разрешено, поэтому ответ ограничен. Включите YOLO, чтобы разрешить.\",\"resume_hint\":\"Открывает чат, возобновляющий проверяющего, так что в нём сохраняются рассуждения, приведшие к замечаниям.\",\"role_reviewer\":\"Проверяющий\",\"role_you\":\"Вы\",\"run_live_notice\":\"Эта проверка ещё идёт. До её завершения замечания могут измениться, поэтому спрашивать пока не о чем.\",\"title\":\"Спросить проверяющего\",\"transcript_gone_notice\":\"Сеанс проверяющего больше не хранится на диске, поэтому открывать нечего. Проверьте этот пул-реквест снова, чтобы задать вопросы.\"},\"reviewQueue\":{\"empty\":\"Нет pull request, ждущих твоего ревью.\",\"filter_by_repo\":\"Фильтр по репозиторию или названию\",\"setup_required\":\"Настрой GitHub CLI, чтобы видеть запросы на ревью\",\"starts_review\":\"Для каждого выбранного PR запускается ревью Sage. Результаты появляются в Ревью и публикуются в GitHub, только если ты сам решишь.\",\"starts_review_truncated\":\"Показаны только 100 самых новых запросов. Для каждого выбранного PR запускается ревью Sage. Результаты появляются в Ревью и публикуются в GitHub, только если ты сам решишь.\",\"tab\":\"Запросы\"},\"runCard\":{\"cancel\":\"Отмена\",\"clean\":\"Чисто\",\"delete\":\"Удалить\",\"delete_review_of\":\"Удалить ревью {{label}}\",\"delete_this_review\":\"Удалить это ревью\",\"delete_this_review_2\":\"Удалить это ревью?\",\"more_count_few\":\"ещё +{{count}}\",\"more_count_many\":\"ещё +{{count}}\",\"more_count_one\":\"ещё +{{count}}\",\"more_count_other\":\"ещё +{{count}}\",\"needs_review_count_few\":\"{{count}} требуют ревью\",\"needs_review_count_many\":\"{{count}} требуют ревью\",\"needs_review_count_one\":\"{{count}} требует ревью\",\"needs_review_count_other\":\"{{count}} требуют ревью\",\"pull_requests\":\"pull request’ов\",\"review\":\"Ревью\",\"review_of\":\"Ревью {{label}}\",\"review_of_with_more_few\":\"Ревью {{label}} и ещё {{count}}\",\"review_of_with_more_many\":\"Ревью {{label}} и ещё {{count}}\",\"review_of_with_more_one\":\"Ревью {{label}} и ещё {{count}}\",\"review_of_with_more_other\":\"Ревью {{label}} и ещё {{count}}\",\"worth_a_glance_count_few\":\"на {{count}} стоит взглянуть\",\"worth_a_glance_count_many\":\"на {{count}} стоит взглянуть\",\"worth_a_glance_count_one\":\"на {{count}} стоит взглянуть\",\"worth_a_glance_count_other\":\"на {{count}} стоит взглянуть\"},\"runDetail\":{\"cancelled_before_any_finished\":\"Оно было отменено до того, как хоть один pull request успел закончиться.\",\"finished\":\"завершено\",\"loading_report\":\"Загружаю отчёт…\",\"more_count_few\":\"ещё +{{count}}\",\"more_count_many\":\"ещё +{{count}}\",\"more_count_one\":\"ещё +{{count}}\",\"more_count_other\":\"ещё +{{count}}\",\"nothing_to_report\":\"Ни один pull request не завершил ревью, поэтому сообщать было нечего.\",\"pull_request_few\":\"{{count}} pull request’а\",\"pull_request_many\":\"{{count}} pull request’ов\",\"pull_request_one\":\"{{count}} pull request\",\"pull_request_other\":\"{{count}} pull request’а\",\"report_appears_when_the_review_finishes\":\"Отчёт появится здесь, как только ревью закончится.\",\"skipped_inflight_few\":\"{{count}} pull request’а пропущено, потому что они уже были в другом ревью.\",\"skipped_inflight_many\":\"{{count}} pull request’ов пропущено, потому что они уже были в другом ревью.\",\"skipped_inflight_one\":\"{{count}} pull request пропущен, потому что он уже был в другом ревью.\",\"skipped_inflight_other\":\"{{count}} pull request’а пропущено, потому что они уже были в другом ревью.\",\"started\":\"начато\",\"this_review_produced_no_report\":\"Это ревью не создало отчёта.\",\"you_can_leave_this_page_a_notification_will_tell\":\"Можешь уйти с этой страницы — уведомление сообщит, когда всё будет готово.\"},\"runList\":{\"new_review\":\"Новое ревью\"},\"runProgress\":{\"cancel_review\":\"Отменить ревью\",\"cancelled_count_few\":\"отменено: {{count}}\",\"cancelled_count_many\":\"отменено: {{count}}\",\"cancelled_count_one\":\"отменено: {{count}}\",\"cancelled_count_other\":\"отменено: {{count}}\",\"cancelling\":\"Отменяю…\",\"elapsed_time\":\"Прошло времени\",\"failed_count_few\":\"{{count}} с ошибками\",\"failed_count_many\":\"{{count}} с ошибками\",\"failed_count_one\":\"{{count}} с ошибкой\",\"failed_count_other\":\"{{count}} с ошибками\",\"median_of_past_runs_of_this_size\":\"Медиана прошлых запусков такого размера\",\"review_progress\":\"Прогресс ревью\",\"reviewed_of_few\":\"отревьюено: {{done}} / {{count}}\",\"reviewed_of_many\":\"отревьюено: {{done}} / {{count}}\",\"reviewed_of_one\":\"отревьюено: {{done}} / {{count}}\",\"reviewed_of_other\":\"отревьюено: {{done}} / {{count}}\",\"reviewers_busy\":\"{{busy}} из {{max}} ревьюеров заняты\",\"step\":\"· шаг\",\"stops_queued_prs_one_already_being_reviewed_will\":\"Останавливает PR в очереди; тот, что уже на ревью, будет доведён до конца.\",\"usually\":\"обычно ~\",\"working\":\"Работаю\"},\"runStatusPill\":{\"cancelled\":\"Отменено\",\"cancelling\":\"Отменяется\",\"done\":\"Готово\",\"error\":\"Ошибка\",\"interrupted\":\"Прервано\",\"running\":\"Выполняется\"},\"shipSummaryCard\":{\"post_the_ship_readiness_summary\":\"Опубликовать сводку готовности к выпуску\",\"post_this_comment\":\"Опубликовать этот комментарий\",\"posted_as_a_top_level_comment\":\"опубликовано как комментарий верхнего уровня\",\"posted_to_the_pull_request\":\"Опубликовано в pull request\",\"posting\":\"Публикую…\",\"select_the_ship_readiness_summary_to_post\":\"Выбрать сводку готовности к выпуску для публикации\",\"ship_readiness_summary\":\"Сводка готовности к выпуску\"}},\"lib\":{\"format\":{\"cause_no_agent_cli\":\"Ревьюер так и не запустился — на этом хосте не найден исполняемый файл kiro-cli. Установи его или добавь в PATH.\",\"cause_no_record\":\"Ревьюер закончил, но ничего не записал.\",\"cause_record_incomplete\":\"Ревьюер записал файл с замечаниями, но остановился, не завершив ревью.\",\"cause_runtime_died\":\"Процесс ревьюера остановился посреди ревью — обычно из-за перезапуска gateway. С pull request всё было в порядке.\",\"cause_runtime_not_importable\":\"Ревьюер так и не запустился — эта установка не может загрузить нужную ей среду выполнения агента. Восстанови установку, чтобы её вернуть.\",\"cause_runtime_unavailable\":\"Ревьюер так и не запустился — среда выполнения его агента недоступна на этом хосте.\",\"cause_timeout\":\"Ревью вышло за отведённое время.\",\"cause_turn_failed\":\"Ход ревью завершился ошибкой, не записав ничего.\",\"cause_unknown\":\"Ревью не завершилось.\",\"days_ago_few\":\"{{count}} д назад\",\"days_ago_many\":\"{{count}} д назад\",\"days_ago_one\":\"{{count}} д назад\",\"days_ago_other\":\"{{count}} д назад\",\"hours_ago_few\":\"{{count}} ч назад\",\"hours_ago_many\":\"{{count}} ч назад\",\"hours_ago_one\":\"{{count}} ч назад\",\"hours_ago_other\":\"{{count}} ч назад\",\"just_now\":\"только что\",\"minutes_ago_few\":\"{{count}} мин назад\",\"minutes_ago_many\":\"{{count}} мин назад\",\"minutes_ago_one\":\"{{count}} мин назад\",\"minutes_ago_other\":\"{{count}} мин назад\",\"phase_cancelled\":\"Отменено\",\"phase_done\":\"Готово\",\"phase_failed\":\"Ошибка\",\"phase_pending\":\"Ожидает\",\"phase_queued\":\"В очереди\",\"phase_reviewing\":\"На ревью\"}},\"manifest\":{\"configuration_1\":\"Установите и авторизуйте gh CLI на хосте шлюза, добавьте репозиторий, затем выберите в настройках модель ревью, глубину рассуждений и число параллельных проверок.\",\"description\":\"Глубоко проверяет пул-реквесты GitHub и подсказывает, какие изменения действительно стоят внимания. Каждый pull request проверяется в отдельной изолированной сессии агента, которая охватывает все изменённые файлы, с учётом того, насколько велик его радиус влияния, а итог собирается в Отчёт по фокусу с расстановкой приоритетов. Замечания читаются в приложении и готовятся как черновой отзыв GitHub, только когда ты их публикуешь или включаешь автопубликацию, а проверяющий постепенно узнаёт реальные стандарты репозитория по уже принятым исправлениям и прошлым комментариям к ревью.\",\"display_name\":\"Code Review Sage\",\"highlight_1\":\"Отчёт по фокусу сортирует изменения по радиусу влияния, чтобы рискованные файлы читались первыми\",\"highlight_2\":\"Одна изолированная сессия агента на pull request, чтобы замечания не перетекали между ревью\",\"highlight_3\":\"Отзывы читаются в приложении — ничего не публикуется в вашем pull request, пока вы сами об этом не попросите\",\"highlight_4\":\"Учится по каждому репозиторию отдельно: на принятых исправлениях, комментариях к ревью и обсуждениях дизайна\",\"highlight_5\":\"Проверяет пул-реквесты GitHub; нужен аутентифицированный `gh` CLI на хосте шлюза\",\"page_label\":\"Code Review Sage\",\"use_case_1\":\"Проверяйте один или несколько pull request GitHub с учётом риска, изучайте точечные замечания и подготавливайте к публикации только полезные комментарии.\"},\"views\":{\"learningView\":{\"cancel\":\"Отмена\",\"confirm_merge_few\":\"Слить {{count}} выученных правила в набор правил?\",\"confirm_merge_many\":\"Слить {{count}} выученных правил в набор правил?\",\"confirm_merge_one\":\"Слить {{count}} выученное правило в набор правил?\",\"confirm_merge_other\":\"Слить {{count}} выученных правила в набор правил?\",\"consolidate\":\"Объединить\",\"consolidate_pending_few\":\"Объединить {{count}} ожидающих правила в {{namespace}}\",\"consolidate_pending_many\":\"Объединить {{count}} ожидающих правил в {{namespace}}\",\"consolidate_pending_one\":\"Объединить {{count}} ожидающее правило в {{namespace}}\",\"consolidate_pending_other\":\"Объединить {{count}} ожидающих правила в {{namespace}}\",\"consolidating\":\"Объединяю…\",\"learning\":\"Обучение\",\"loaded_during_reviews\":\"загружается во время ревью\",\"loading_learnings\":\"Загружаю выученное…\",\"merge_failed_ruleset_unchanged\":\"Слияние не удалось — набор правил не изменился\",\"not_loaded\":\"не загружается\",\"nothing_consolidated_yet_reviews_in_this_namespa\":\"Пока ничего не объединено — ревью в этом namespace сейчас не загружают выученных шаблонов.\",\"nothing_staged_new_learnings_land_here_when_a_re\":\"Ничего не подготовлено. Новое выученное появляется здесь, когда ревью разбирает выпущенное исправление или учтённый комментарий из ревью.\",\"pattern_few\":\"{{count}} шаблона\",\"pattern_many\":\"{{count}} шаблонов\",\"pattern_one\":\"{{count}} шаблон\",\"pattern_other\":\"{{count}} шаблона\",\"pending_consolidation\":\"Ожидает объединения ·\",\"pick_a_namespace_in_the_sidebar_to_read_the_patt\":\"Выбери namespace на боковой панели, чтобы прочитать шаблоны, которые ревью загружают из него.\",\"reviews_read_the_consolidated_ruleset_below_neve\":\"Ревью читают объединённый набор правил ниже, а не ожидающих кандидатов. Объединение сливает в него подготовленное — однократное слияние с ИИ, которое запускаешь ты, так что до запуска ничего из того, что видят ревью, не меняется.\",\"ruleset\":\"Набор правил ·\"},\"settingsView\":{\"default_agent_config\":\"По умолчанию (конфигурация агента)\",\"default_model_provider\":\"По умолчанию (модель / провайдер)\",\"higher_effort_finds_more_costs_more_and_takes_lo\":\"Больше усилий — больше находок, выше стоимость и дольше на каждый pull request. При значении по умолчанию решает модель или провайдер.\",\"how_many_pull_requests_are_reviewed_in_parallel\":\"Сколько pull request’ов ревьюится параллельно на общем runtime воркеров. Это настоящий предел пропускной способности ревью — открытых потоков ревью может быть несколько, но все они берут из этого бюджета.\",\"loading_settings\":\"Загружаю настройки…\",\"model\":\"Модель\",\"reasoning_effort\":\"Глубина рассуждений\",\"review_model\":\"Модель для ревью\",\"reviews_at_once\":\"Ревью одновременно\",\"settings\":\"Настройки\",\"these_apply_to_every_review_started_from_here\":\"Это применяется к каждому ревью, запущенному отсюда.\",\"which_model_performs_the_review_default_inherits\":\"Какая модель выполняет ревью. Значение по умолчанию наследует конфигурацию агента, поэтому смена твоей модели по умолчанию меняет и это.\"}},\"workspace\":{\"drag_to_resize\":\"Потяни, чтобы изменить размер\",\"resize_sidebar\":\"Изменить размер боковой панели\",\"select_a_review_to_see_its_progress_and_report\":\"Выбери ревью, чтобы увидеть его прогресс и отчёт.\",\"start_a_new_one_several_can_run_at_once\":\"Запусти новое — несколько могут идти одновременно.\"}},\"issueRadar\":{\"components\":{\"prDetail\":{\"labels\":\"Метки\"}}}}"),
		components: { "resizeHandle": { "drag_to_resize": "Потяните, чтобы изменить размер" } },
		lib: { "scriptLabel": {
			"cyrillic": "кириллическая буква",
			"greek": "греческая буква",
			"latin": "латинская буква",
			"other": "символ"
		} }
	},
	"zh-CN": {
		app: {
			"collapse_sidebar": "折叠侧边栏",
			"expand_sidebar": "展开侧边栏"
		},
		apps: /* @__PURE__ */ JSON.parse("{\"codeReviewSage\":{\"codeReviewSagePage\":{\"open_pr_other\":\"{{count}} 个待处理 PR\",\"pattern_other\":\"{{count}} 个模式\"},\"components\":{\"addReposModal\":{\"add\":\"添加\",\"add_one_by_url_above\":\"在上方用 URL 添加一个。\",\"add_repo\":\"添加 {{repo}}\",\"add_repos\":\"添加仓库\",\"added\":\"已添加\",\"all_your_repos\":\"你的全部仓库\",\"already_added\":\"{{repo}} 已经添加过了\",\"archived\":\"已归档\",\"based_on_recent_github_activity\":\"依据你最近的 GitHub 活动\",\"close\":\"关闭\",\"close_add_repos_dialog\":\"关闭添加仓库对话框\",\"contributed_events_other\":\"{{age}} · {{count}} 次活动\",\"filter_your_repos\":\"筛选你的仓库\",\"gh_auth_login\":\"gh auth login\",\"github_cli_not_ready\":\"GitHub CLI 尚未就绪\",\"newest_100_by_push_date\":\"按推送时间排列的最新 100 个\",\"no_repos_for_account\":\"没有找到你账号下的仓库。\",\"no_repos_match_filter\":\"没有仓库符合你的筛选条件。\",\"owner_repo_a_repo_url_or_paste_a_pull_request_li\":\"owner/repo、仓库 URL，或粘贴一个 pull request 链接\",\"pick_from_the_repos_you_can_reach_or_type_one_in\":\"从你能访问的仓库里挑一个，或者直接输入。添加过的仓库会出现在侧边栏，你可以从那里发起评审。粘贴 pull request 链接会直接打开那个 pull request。\",\"pinned_to_the_sidebar\":\"已置顶到侧边栏\",\"private\":\"私有\",\"pushed_age\":\"{{age}}推送\",\"re_read_your_repos_from_github\":\"从 GitHub 重新读取你的仓库\",\"read_only\":\"只读\",\"read_only_access\":\"只读访问\",\"reading_your_repos_from_github\":\"正在从 GitHub 读取你的仓库……\",\"recently_worked_on\":\"最近做过的\",\"refresh_your_repos\":\"刷新你的仓库\",\"remove\":\"移除\",\"remove_repo\":\"移除 {{repo}}\",\"repository_or_pull_request_url_or_owner_repo\":\"仓库或 pull request 的 URL，或 owner/repo\",\"setup_hint\":\"安装 GitHub CLI 并用下面的命令登录，就能列出你的仓库。你仍然可以在上方用 URL 添加任何仓库。\",\"these_lists_are_capped_so_a_repo_you_have_not_to\":\"这些列表有条数上限，所以你最近没碰过的仓库可能不在里面。看不到就在上方用 URL 添加。\",\"your_repos\":\"你的仓库\"},\"bandChips\":{\"all\":\"全部\",\"clean\":\"无问题\",\"filter_by_band\":\"按类别筛选\",\"needs_review\":\"需要审查\",\"worth_a_glance\":\"值得一看\"},\"draftReviewActions\":{\"approve\":\"批准\",\"approve_is_unavailable_because_this_base_branch_\":\"无法批准：此拉取请求的基础分支在推送新提交时不会撤销批准（或此处无法读取其保护设置）。否则批准可能比它审查的提交存续更久。请改在 GitHub 上批准。\",\"approve_is_unavailable_while_auto_merge_is_armed\":\"自动合并已启用时无法批准：批准可能在 head 检查撤回之前就合并此拉取请求。请先关闭自动合并，或在 GitHub 上批准。\",\"ask_agent_about_this_failure\":\"就这个失败询问 Agent\",\"cancel\":\"取消\",\"confirm_approve\":\"批准这个拉取请求？\",\"confirm_request_changes\":\"发布这次审查并要求修改？\",\"confirm_submit_as_comment\":\"以评论形式提交这次审查？\",\"couldn_t_check_for_a_draft_review_on_this_pull_r\":\"无法检查此拉取请求上是否有草稿审查。这通常是 GitHub CLI 的身份验证问题，而不是草稿丢失。\",\"draft_review\":\"评审草稿\",\"no_draft_review_on_this_pull_request\":\"此拉取请求没有评审草稿。\",\"pending_only_you_can_see_it_until_you_publish\":\"待发布 — 发布前只有你能看到。\",\"publish_failed\":\"无法发布这次审查\",\"published_as\":\"已发布为\",\"published_verdict_approved\":\"批准\",\"published_verdict_changes_requested\":\"请求修改\",\"published_verdict_comment\":\"评论\",\"publishing\":\"正在发布…\",\"publishing_is_blocked_a_later_review_replaced_th\":\"已阻止发布：拉取请求上这份草稿已被后一次审查替换，其中不再包含本次审查发现的问题。请打开最新审查后发布。\",\"publishing_is_blocked_this_draft_contains_conten\":\"已阻止发布：此草稿包含需要脱敏的内容，提交会公开原始文本。请在 GitHub 上编辑或丢弃该草稿。\",\"publishing_is_blocked_this_draft_was_written_aga\":\"已阻止发布：此草稿针对较早的提交撰写，之后拉取请求已变更。请先重新评审当前 head。\",\"publishing_is_blocked_this_review_is_still_runni\":\"已阻止发布：此评审仍在运行中，因此该拉取请求上的草稿来自上一次运行。\",\"publishing_is_irreversible_and_visible_to_everyo\":\"发布不可撤销，且拉取请求的所有人都能看到。\",\"request_changes\":\"请求修改\",\"submit_as_comment\":\"作为评论提交\",\"this_draft_has_no_summary_body\":\"此草稿没有摘要正文。\",\"try_again\":\"重试\"},\"failureNotice\":{\"run_it_again\":\"再跑一次\",\"starting\":\"正在启动……\",\"this_review_failed\":\"这次评审失败了\"},\"findingCard\":{\"cancel_dismiss\":\"取消\",\"confirm_dismiss\":\"忽略这条发现\",\"consequence\":\"后果\",\"dismiss\":\"忽略\",\"dismiss_failed\":\"无法保存忽略操作，请重试。\",\"dismiss_reason_label\":\"为什么忽略这条发现？\",\"dismiss_reason_placeholder\":\"例如：误报、超出范围\",\"dismissed_reason\":\"已忽略：{{reason}}\",\"evidence\":\"证据\",\"observation\":\"现象\",\"post_finding\":\"把这条发现发到 pull request 上\",\"post_finding_on\":\"把这条发现发到 {{target}}\",\"post_this_comment\":\"发布这条评论\",\"posted_to_the_pull_request\":\"已发到 pull request\",\"posting\":\"正在发布……\",\"select_to_draft_together\":\"选入批量草稿\",\"select_to_post\":\"选择 {{label}} 以发布\",\"severity_must_fix\":\"必须修\",\"severity_should_fix\":\"建议修\",\"suggestion\":\"建议\",\"this_finding\":\"这条发现\",\"undo_dismiss\":\"撤销\",\"undo_dismiss_failed\":\"无法撤销，该问题仍处于忽略状态。\"},\"learningRail\":{\"add_namespace\":\"添加 namespace\",\"confirm_delete\":\"删除“{{name}}”以及它学到的全部内容？此操作无法撤销。\",\"delete_2\":\"删除\",\"delete_namespace\":\"删除 namespace {{name}}\",\"invalid_namespace_name\":\"namespace 名称会用作文件夹名称，因此只能包含小写拉丁字母（a–z）、数字（0–9）、点、短横线或下划线，必须以字母或数字开头和结尾，长度为 2 到 64 个字符。\",\"invalid_namespace_name_char\":\"namespace 名称中不能使用“{{char}}”。只能使用小写 a–z、0–9、.\xA0-⁠\xA0_。\",\"invalid_namespace_name_letter\":\"namespace 名称中不能使用“{{char}}”（{{script}}，{{code}}）。只能使用小写 a–z、0–9、.\xA0-⁠\xA0_。\",\"keep_it\":\"保留\",\"load_namespace_during_reviews\":\"评审时加载 namespace {{name}}\",\"loading\":\"加载中……\",\"namespace_active\":\"已启用——评审时会加载（取消勾选即关闭）\",\"namespace_inactive\":\"未启用——勾选后评审时会加载\",\"namespaces\":\"Namespace\",\"new_namespace\":\"新建 namespace\",\"new_namespace_2\":\"new-namespace\",\"new_namespace_name\":\"新 namespace 的名称\",\"pattern_other\":\"{{count}} 条模式\",\"pending_count_other\":\"{{count}} 个待处理\",\"read_namespace\":\"查看 namespace {{name}}\"},\"leftRail\":{\"code_review_sage\":\"Code Review Sage\",\"learning\":\"学习\",\"reviews\":\"评审\",\"sections\":\"分区\",\"settings\":\"设置\",\"version\":\"v{{version}}\"},\"listSkeleton\":{\"loading_reviews\":\"正在加载评审……\"},\"middleColumn\":{\"all_repos\":\"全部仓库\",\"just_this_repo\":\"仅 {{repo}}\",\"lists_label\":\"Pull request 或评审\",\"no_reviews_for_repo\":\"{{repo}} 还没有评审\",\"no_reviews_yet\":\"还没有评审\",\"pick_a_repo_then_a_pr\":\"先选仓库，再选 pull request。\",\"pull_requests\":\"Pull request\",\"repo_lists_label\":\"{{repo}}：pull request 或评审\",\"repo_reviews_appear_here\":\"你为这个仓库发起的评审会出现在这里。\",\"reviews\":\"评审\",\"show_all_count\":\"显示全部（{{count}}）\",\"this_repo_only\":\"仅 {{repo}}\"},\"postCommentsButton\":{\"cancel\":\"取消\",\"confirm_post_other\":\"把 {{count}} 条评论发布到 pull request 上？\",\"drafted_publish_on_pr_page_other\":\"已起草 {{count}} 条评论 —— 在此打开该拉取请求即可发布\",\"post_action\":\"发布\",\"post_count_other\":\"发布 {{count}} 条评论\",\"post_failed\":\"无法起草这次审查\",\"posted_age\":\"发布于 {{age}}\",\"posted_comments_other\":\"已发布 {{count}} 条评论\",\"posting\":\"正在发布……\",\"publish_these_findings_as_a_review_on_the_pull_r\":\"把这些发现起草成一次审查 —— 发布前只有你能看到\"},\"prPickList\":{\"a_review_of_this_pull_request_is_running\":\"这个 pull request 的评审正在进行\",\"add_a_repo\":\"添加仓库\",\"already_reviewed\":\"已评审过\",\"cancel\":\"取消\",\"confirm_review_all\":\"审查全部 {{count}} 个拉取请求？\",\"draft\":\"草稿\",\"filter_pull_requests\":\"筛选 pull request\",\"new\":\"新\",\"no_open_prs_here\":\"这里没有开着的 pull request。\",\"no_prs_match_filter\":\"没有 pull request 符合你的筛选条件。\",\"one_or_more_github_pr_links\":\"一个或多个 GitHub PR 链接\",\"open_pr\":\"打开 pull request #{{number}}：{{title}}\",\"paste_pr_links\":\"粘贴 PR 链接\",\"paste_pr_links_instead\":\"改为粘贴 PR 链接\",\"pick_a_repo_to_see_its_pull_requests\":\"选一个仓库来查看它的 pull request。\",\"pr_already_being_reviewed\":\"Pull request #{{number}} 已经在评审中\",\"re_read_open_prs_from_github\":\"从 GitHub 重新读取开着的 PR\",\"refresh_pull_requests\":\"刷新 pull request\",\"repos_live_in_the_sidebar\":\"仓库在侧边栏里。\",\"review_all_count\":\"审查全部 {{count}} 个\",\"review_every_open_pr_not_yet_reviewed_at_its_cur\":\"评审每个尚未在当前 head 上评审过的开着的 PR\",\"review_pr\":\"评审 pull request #{{number}}：{{title}}\",\"review_selected_count_other\":\"审查已选中的 {{count}} 项\",\"review_these\":\"评审这些\",\"reviewed\":\"已评审\",\"reviewed_age\":\"评审于 {{age}}\",\"reviewed_before_the_head_commit_has_moved_since\":\"之前评审过——此后 head 提交已经变了\",\"reviewing\":\"评审中\",\"updated\":\"更新于\"},\"prReviewDetail\":{\"author\":\"作者\",\"cancelled_before_finishing\":\"它在这一项完成之前就被取消了。\",\"did_not_complete_for_this_change\":\"这次改动的评审没有完成。\",\"draft\":\"草稿\",\"findings_appear_here_as_soon_as_the_review_finis\":\"评审一结束，发现就会出现在这里。你可以离开这个页面——完成时会有通知告诉你。\",\"head\":\"head\",\"loading_pull_request_details\":\"正在加载 pull request 详情……\",\"loading_review\":\"正在加载评审……\",\"nothing_flagged_on_this_pull_request\":\"这个 pull request 上没有标记出任何问题。\",\"open_on_github\":\"在 GitHub 上打开\",\"pull_request\":\"拉取请求\",\"pull_request_detail\":\"Pull request 详情\",\"retry_review\":\"重试评审\",\"review\":\"评审\",\"review_again\":\"再评审一次\",\"review_again_at_current_head\":\"在当前 head 上再评审一次这个 pull request\",\"review_already_running\":\"这个 pull request 的评审已经在进行\",\"review_completed_with_no_findings\":\"评审已完成，没有发现值得你花时间的问题。\",\"review_this_pull_request\":\"评审这个 pull request\",\"reviewing\":\"评审中……\",\"running\":\"进行中\",\"sage_review\":\"Sage 评审\",\"see_the_reason_above\":\"原因见上方。\",\"start_a_review_and_its_findings_appear_here_you\":\"发起一次评审，它的发现就会出现在这里——你可以离开页面，完成时会有通知告诉你。\",\"that_review_produced_no_report_for_this_pull_req\":\"那次评审没有为这个 pull request 生成报告。\",\"this_pull_request_has_not_been_reviewed_yet\":\"这个 pull request 还没有评审过。\",\"updated\":\"更新于\"},\"prSourcePanel\":{\"load_failed\":\"无法加载 pull request 详情：{{reason}}\",\"partial_sections\":\"有些部分不完整（{{sections}}）——对提供方的请求失败了，或者达到了分页上限。\"},\"prStatusChips\":{\"all_checks_passed_other\":\"{{count}} 项检查全部通过\",\"checks_failing_other\":\"{{count}} 项检查中有 {{failed}} 项失败\",\"checks_running_other\":\"{{count}} 项检查中有 {{pending}} 项仍在进行\",\"closed\":\"已关闭\",\"conflicts\":\"有冲突\",\"failing_count_other\":\"{{count}} 个失败\",\"merge_blocked\":\"合并被阻止\",\"merged\":\"已合并\",\"open\":\"开着\",\"passed_count_other\":\"{{count}} 个通过\",\"running_count_other\":\"{{count}} 个进行中\"},\"repoSwitcher\":{\"add_a_repo\":\"添加仓库\",\"all_repos\":\"全部仓库\",\"filter_repos\":\"筛选仓库\",\"filter_repositories\":\"筛选仓库\",\"loading\":\"加载中……\",\"no_repo_matches_that\":\"没有仓库符合。\",\"no_repos_yet_add_one_to_pick_from_the_repos_you\":\"还没有仓库——添加一个，就能从你常用的仓库里挑选。\",\"pick_a_repo\":\"选一个仓库\",\"pick_a_repository\":\"选一个仓库\",\"recent\":\"最近\",\"repositories\":\"仓库\",\"repository_named\":\"仓库：{{name}}\"},\"reportView\":{\"blast_radius\":\"影响范围：{{scope}}\",\"blocking_count_other\":\"{{count}} 个阻塞项\",\"changes_reviewed_other\":\"已评审 {{count}} 处改动\",\"clear\":\"清除\",\"design_gate\":\"设计闸门 ·\",\"design_risk\":\"设计风险：{{level}}\",\"draft_selected_other\":\"起草已选中的 {{count}} 条发现\",\"finding_dimension_in_file\":\"{{file}} 中的 {{dimension}}\",\"generated\":\"· 生成于\",\"moved_to\":\"现在属于{{band}}。更改筛选前位置保持不变。\",\"no_changes_in_this_band\":\"这个类别里没有改动。\",\"nothing_flagged_in_this_review\":\"这次评审没有标记出任何问题。\",\"open_shared_copy\":\"打开共享副本\",\"open_the_pull_request\":\"打开这个 pull request\",\"share\":\"共享\",\"sharing\":\"正在共享……\",\"should_fix_count_other\":\"{{count}} 个建议修复\",\"step_problem\":\"问题\",\"step_solution_fit\":\"方案契合度\",\"step_why_it_matters\":\"为什么重要\"},\"reviewChat\":{\"continue_hint\":\"与这个审查者的对话在“对话”标签页中继续。\",\"continue_session\":\"继续追问会话\",\"earlier_questions\":\"早前的提问\",\"error_generic\":\"无法打开追问会话。请重试。\",\"error_run_deleted\":\"这次审查已被删除，对话随之结束。\",\"loading\":\"加载中…\",\"new_session_unavailable\":\"这个应用暂时还不能打开新的追问会话：需要一个允许应用打开指定名称聊天会话的 Kiro Crew。已经打开的追问会话仍可继续。\",\"not_recorded_notice\":\"这次审查没有保留审查者会话，因此没有可恢复的内容。重新审查这个拉取请求即可提问。\",\"open_session\":\"打开追问会话\",\"opening\":\"正在打开…\",\"ran_tools\":\"查看了：{{tools}}\",\"reasoning\":\"推理过程\",\"refused_notice\":\"它需要调用工具才能完整回答，但没有获得授权，所以这个回答有局限。开启 YOLO 即可放行。\",\"resume_hint\":\"打开一个会话并恢复审查者，因此它仍保留得出这些发现的推理过程。\",\"role_reviewer\":\"审查者\",\"role_you\":\"你\",\"run_live_notice\":\"这次审查还在运行。完成前发现可能仍会变化，因此现在还没有可提问的内容。\",\"title\":\"追问审查者\",\"transcript_gone_notice\":\"审查者的会话已不在磁盘上，因此没有可恢复的内容。重新审查这个拉取请求即可提问。\"},\"reviewQueue\":{\"empty\":\"没有等待你审查的拉取请求。\",\"filter_by_repo\":\"按仓库或标题筛选\",\"setup_required\":\"设置 GitHub CLI 以查看审查请求\",\"starts_review\":\"每个选中的 PR 都会运行一次 Sage 审查。结果显示在 评审 中，除非你选择发布，否则不会发布到 GitHub。\",\"starts_review_truncated\":\"仅显示最新的 100 个请求。每个选中的 PR 都会运行一次 Sage 审查。结果显示在 评审 中，除非你选择发布，否则不会发布到 GitHub。\",\"tab\":\"审查请求\"},\"runCard\":{\"cancel\":\"取消\",\"clean\":\"干净\",\"delete\":\"删除\",\"delete_review_of\":\"删除 {{label}} 的评审\",\"delete_this_review\":\"删除这次评审\",\"delete_this_review_2\":\"删除这次评审？\",\"more_count_other\":\"另外 +{{count}} 个\",\"needs_review_count_other\":\"{{count}} 项需要评审\",\"pull_requests\":\"pull request\",\"review\":\"评审\",\"review_of\":\"{{label}} 的评审\",\"review_of_with_more_other\":\"{{label}} 及另外 {{count}} 个的评审\",\"worth_a_glance_count_other\":\"{{count}} 项值得一看\"},\"runDetail\":{\"cancelled_before_any_finished\":\"它在任何 pull request 完成之前就被取消了。\",\"finished\":\"完成于\",\"loading_report\":\"正在加载报告……\",\"more_count_other\":\"另外 +{{count}} 个\",\"nothing_to_report\":\"没有任何 pull request 完成评审，所以没有可报告的内容。\",\"pull_request_other\":\"{{count}} 个 pull request\",\"report_appears_when_the_review_finishes\":\"评审一结束，报告就会出现在这里。\",\"skipped_inflight_other\":\"有 {{count}} 个 pull request 被跳过了，因为另一次评审已经在处理它们。\",\"started\":\"开始于\",\"this_review_produced_no_report\":\"这次评审没有生成报告。\",\"you_can_leave_this_page_a_notification_will_tell\":\"你可以离开这个页面——完成时会有通知告诉你。\"},\"runList\":{\"new_review\":\"新建评审\"},\"runProgress\":{\"cancel_review\":\"取消评审\",\"cancelled_count_other\":\"{{count}} 个已取消\",\"cancelling\":\"正在取消……\",\"elapsed_time\":\"已用时间\",\"failed_count_other\":\"{{count}} 个失败\",\"median_of_past_runs_of_this_size\":\"过往同等规模运行的中位数\",\"review_progress\":\"评审进度\",\"reviewed_of_other\":\"已评审 {{done}} / {{count}}\",\"reviewers_busy\":\"{{max}} 个评审器中有 {{busy}} 个在忙\",\"step\":\"· 第\",\"stops_queued_prs_one_already_being_reviewed_will\":\"会停下排队的 PR；已经在评审中的那个会跑完。\",\"usually\":\"通常约\",\"working\":\"工作中\"},\"runStatusPill\":{\"cancelled\":\"已取消\",\"cancelling\":\"正在取消\",\"done\":\"完成\",\"error\":\"错误\",\"interrupted\":\"已中断\",\"running\":\"进行中\"},\"shipSummaryCard\":{\"post_the_ship_readiness_summary\":\"发布发布就绪度总结\",\"post_this_comment\":\"发布这条评论\",\"posted_as_a_top_level_comment\":\"已作为顶层评论发布\",\"posted_to_the_pull_request\":\"已发到 pull request\",\"posting\":\"正在发布……\",\"select_the_ship_readiness_summary_to_post\":\"选择发布就绪度总结以发布\",\"ship_readiness_summary\":\"发布就绪度总结\"}},\"lib\":{\"format\":{\"cause_no_agent_cli\":\"评审器根本没启动——这台主机上没找到 kiro-cli 可执行文件。装上它，或者把它加进 PATH。\",\"cause_no_record\":\"评审器跑完了，但没有记录任何发现。\",\"cause_record_incomplete\":\"评审器写下了发现记录，但在评审完成前就停了。\",\"cause_runtime_died\":\"评审器进程在评审途中停了——通常是 gateway 重启导致的。这个 pull request 本身没有问题。\",\"cause_runtime_not_importable\":\"评审器根本没启动——这套安装加载不了它需要的 agent 运行时。修复安装即可恢复。\",\"cause_runtime_unavailable\":\"评审器根本没启动——它的 agent 运行时在这台主机上不可用。\",\"cause_timeout\":\"评审超过了时间上限。\",\"cause_turn_failed\":\"评审轮次在记录任何内容之前就失败了。\",\"cause_unknown\":\"评审没有完成。\",\"days_ago_other\":\"{{count}} 天前\",\"hours_ago_other\":\"{{count}} 小时前\",\"just_now\":\"刚刚\",\"minutes_ago_other\":\"{{count}} 分钟前\",\"phase_cancelled\":\"已取消\",\"phase_done\":\"已完成\",\"phase_failed\":\"失败\",\"phase_pending\":\"等待中\",\"phase_queued\":\"排队中\",\"phase_reviewing\":\"评审中\"}},\"manifest\":{\"configuration_1\":\"在网关主机上安装并认证 gh CLI，添加仓库，然后在设置中选择审查模型、推理强度和并发数。\",\"description\":\"深度审查 GitHub 拉取请求，告诉你哪些改动真正值得关注。每个拉取请求都在各自独立的代理会话里审查，覆盖所有改动过的文件，按影响范围加权，最后按优先级汇总成一份 Focus Report。发现在应用内阅读，只有在你发布或开启自动发布时才会暂存为 GitHub 草稿审查；审查者还会从已上线的修复和过往审查评论里，不断学习仓库真正的标准。\",\"display_name\":\"Code Review Sage\",\"highlight_1\":\"Focus Report 按影响范围给改动排序，风险高的文件先读\",\"highlight_2\":\"每个拉取请求一个独立的代理会话，发现不会在审查之间串扰\",\"highlight_3\":\"评审在应用内查看——除非你主动要求，否则不会向你的拉取请求发布任何内容\",\"highlight_4\":\"按仓库分别学习已上线的修复、审查评论和设计讨论\",\"highlight_5\":\"审查 GitHub 拉取请求；需要网关主机上有已认证的 `gh` CLI\",\"page_label\":\"Code Review Sage\",\"use_case_1\":\"按风险审查一个或多个 GitHub 拉取请求，查看重点发现，并只暂存值得发布的评论。\"},\"views\":{\"learningView\":{\"cancel\":\"取消\",\"confirm_merge_other\":\"把 {{count}} 条学到的内容合并进规则集？\",\"consolidate\":\"合并整理\",\"consolidate_pending_other\":\"把 {{namespace}} 中 {{count}} 条待处理的学习内容合并整理\",\"consolidating\":\"正在合并整理……\",\"learning\":\"学习\",\"loaded_during_reviews\":\"评审时会加载\",\"loading_learnings\":\"正在加载学到的内容……\",\"merge_failed_ruleset_unchanged\":\"合并失败——规则集未改动\",\"not_loaded\":\"不加载\",\"nothing_consolidated_yet_reviews_in_this_namespa\":\"还没有合并整理过任何内容——这个 namespace 下的评审目前不加载任何学到的模式。\",\"nothing_staged_new_learnings_land_here_when_a_re\":\"暂存区是空的。当评审分析一个已发布修复，或一条被采纳的评审意见时，新学到内容会出现在这里。\",\"pattern_other\":\"{{count}} 条模式\",\"pending_consolidation\":\"待合并整理 ·\",\"pick_a_namespace_in_the_sidebar_to_read_the_patt\":\"在侧边栏选一个 namespace，就能看到评审从它加载的模式。\",\"reviews_read_the_consolidated_ruleset_below_neve\":\"评审读取下面这份合并整理后的规则集，从不读取待处理候选项。合并整理会把暂存内容并入其中——这是一次由你触发的 AI 合并，所以在你执行之前，评审看到什么都不会变。\",\"ruleset\":\"规则集 ·\"},\"settingsView\":{\"default_agent_config\":\"默认（代理配置）\",\"default_model_provider\":\"默认（模型 / 提供方）\",\"higher_effort_finds_more_costs_more_and_takes_lo\":\"投入越多，发现越多，花费也越高，每个 pull request 耗时也更长。选默认时由模型或提供方决定。\",\"how_many_pull_requests_are_reviewed_in_parallel\":\"在共享的 worker 运行时上并行评审多少个 pull request。这是评审吞吐量的真正上限——可以同时开着多个评审话题，但它们都从这份预算里取。\",\"loading_settings\":\"正在加载设置……\",\"model\":\"模型\",\"reasoning_effort\":\"推理强度\",\"review_model\":\"评审模型\",\"reviews_at_once\":\"同时进行的评审数\",\"settings\":\"设置\",\"these_apply_to_every_review_started_from_here\":\"这些设置对从这里发起的每一次评审都生效。\",\"which_model_performs_the_review_default_inherits\":\"由哪个模型执行评审。默认会继承代理配置，所以改了你的默认模型，这里也会跟着变。\"}},\"workspace\":{\"drag_to_resize\":\"拖动以调整大小\",\"resize_sidebar\":\"调整侧边栏大小\",\"select_a_review_to_see_its_progress_and_report\":\"选一次评审，查看它的进度和报告。\",\"start_a_new_one_several_can_run_at_once\":\"发起一个新的——可以同时跑好几个。\"}},\"issueRadar\":{\"components\":{\"prDetail\":{\"labels\":\"标签\"}}}}"),
		components: { "resizeHandle": { "drag_to_resize": "拖动以调整大小" } },
		lib: { "scriptLabel": {
			"cyrillic": "西里尔字母",
			"greek": "希腊字母",
			"latin": "拉丁字母",
			"other": "字符"
		} }
	}
};
var own = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
function lookup(catalog, key) {
	let node = catalog;
	for (const part of key.split(".")) {
		if (node === void 0 || typeof node === "string" || !own(node, part)) return void 0;
		node = node[part];
	}
	return typeof node === "string" ? node : void 0;
}
/** The catalogs to try for `locale`, most specific first, always ending in English. */
function localeChain(locale) {
	const chain = [];
	const add = (candidate) => {
		if (own(CATALOGS, candidate) && !chain.includes(candidate)) chain.push(candidate);
	};
	add(locale);
	add(locale.split("-")[0]);
	add("en");
	return chain;
}
function currentLocale() {
	try {
		const locale = activeLocale();
		return typeof locale === "string" && locale ? locale : "en";
	} catch {
		return "en";
	}
}
var PLACEHOLDER = /\{\{\s*(\w+)\s*\}\}/g;
function pluralForm(locale, count) {
	try {
		return new Intl.PluralRules(locale).select(count);
	} catch {
		return count === 1 ? "one" : "other";
	}
}
function t(key, vars) {
	const count = vars && typeof vars.count === "number" ? vars.count : void 0;
	for (const locale of localeChain(currentLocale())) {
		const catalog = CATALOGS[locale];
		let text;
		if (count !== void 0) text = lookup(catalog, `${key}_${pluralForm(locale, count)}`) ?? lookup(catalog, `${key}_other`);
		text = text ?? lookup(catalog, key);
		if (text !== void 0) return text.replace(PLACEHOLDER, (whole, name) => vars && own(vars, name) ? String(vars[name]) : whole);
	}
	return key;
}
/** The dashboard's name for this helper, so the ported call sites read unchanged. */
var i18nT = t;
// src/host/ResizeHandle.tsx
/** Px moved per arrow press, and per Shift+arrow press. */
var STEP = 16;
var COARSE_STEP = 64;
/** The vertical drag grip on a resizable column's edge — one component so the
* Sessions sidebar, the Crew Members roster and the workspace-style surfaces
* (Issue Radar's rail and issue / PR lists, Task Runner's run rail, Projects)
* all look and behave identically, as do Spec Builder's and Code Review Sage's
* column splitters. Pair it with `useColumnResize` (or any `usePointerDrag`)
* for `handleProps`, and `onNudge` for the arrow keys.
*
* Visual contract: a 6px transparent hit strip carrying a 2px `rounded-full`
* bar that stays invisible at rest, turns accent on hover and keyboard focus,
* and accent-hover while dragging. `inset` trims the bar's ends — pass the
* card's corner radius (12px for `rounded-xl`) when the grip runs along a
* rounded card edge so the accent spans exactly the straight segment of the
* border instead of overshooting the rounded corners.
*
* It is the ARIA window-splitter pattern, not a decorative divider: focusable,
* arrow-key operable, and reporting its position. Pointer-only would leave
* keyboard users unable to resize at all — and on a collapsible column, unable
* to reach the layout the mouse can. `value`/`min`/`max` are optional so the
* caller can omit them for a splitter whose extent isn't meaningful, but pass
* them when you have them: without `aria-valuenow` a screen reader announces a
* splitter with no position. */
function ResizeHandle({ handleProps, label, onNudge, value, min, max, inset = 0, className, title }) {
	return /* @__PURE__ */ jsx("div", {
		...handleProps,
		role: "separator",
		"aria-orientation": "vertical",
		"aria-label": label,
		tabIndex: onNudge ? 0 : void 0,
		"aria-valuenow": value,
		"aria-valuemin": min,
		"aria-valuemax": max,
		onKeyDown: onNudge ? (e) => {
			if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
			e.preventDefault();
			const step = e.shiftKey ? COARSE_STEP : STEP;
			onNudge(e.key === "ArrowRight" ? step : -step);
		} : void 0,
		title: title ?? i18nT("components.resizeHandle.drag_to_resize"),
		"data-testid": "resize-handle",
		className: cn("group/drag relative flex w-1.5 shrink-0 items-center justify-center cursor-col-resize select-none focus-ring rounded-full", className),
		style: { touchAction: "none" },
		children: /* @__PURE__ */ jsx("div", {
			"aria-hidden": "true",
			"data-testid": "resize-handle-bar",
			className: "w-[2px] rounded-full bg-transparent transition-colors duration-200 resize-accent group-hover/drag:bg-accent group-focus-visible/drag:bg-accent group-active/drag:bg-accent-hover",
			style: { height: inset > 0 ? `calc(100% - ${inset * 2}px)` : "100%" }
		})
	});
}
// src/host/storage.ts
/**
* Best-effort `localStorage` writes, for the column widths and the rail state.
*
* The dashboard's own helper (`utils/safeStorage`) also reclaims its cache tiers
* on a quota error; those caches are the dashboard's, not this app's, so this
* copy only swallows a refused write: the layout then falls back to its default
* on the next visit, as it does on a first visit.
*/
function safeSetItem(key, value) {
	try {
		window.localStorage.setItem(key, value);
	} catch {}
}
// src/host/useIsMobile.ts
/**
* Whether the viewport is phone-narrow (below 768px), the dashboard's own
* breakpoint, re-read on every `matchMedia` change.
*
* The dashboard's `hooks/useIsMobile` also defers the switch into its layout
* transition and answers `false` inside an embed; neither is reachable from an
* app bundle, and an app page is never mounted in the dashboard's embed shell.
*/
var MOBILE_QUERY = `(max-width: 767px)`;
function mql() {
	return typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia(MOBILE_QUERY) : null;
}
function subscribe(cb) {
	const list = mql();
	list?.addEventListener?.("change", cb);
	window.addEventListener("resize", cb);
	return () => {
		list?.removeEventListener?.("change", cb);
		window.removeEventListener("resize", cb);
	};
}
function useIsMobile() {
	return useSyncExternalStore(subscribe, () => mql()?.matches ?? false, () => false);
}
// src/host/usePointerDrag.ts
/**
* Attach the returned handlers to a drag handle:
*   const drag = usePointerDrag({ onMove: ({ dx }) => setWidth(w0 - dx), threshold: 10 })
*   <div {...drag} />
*/
function usePointerDrag(opts) {
	const st = useRef({
		startX: 0,
		startY: 0,
		lastX: 0,
		lastY: 0,
		active: false,
		committed: false
	});
	const optsRef = useRef(opts);
	optsRef.current = opts;
	const fallback = useRef(null);
	const disarmFallback = useCallback(() => {
		fallback.current?.dispose();
		fallback.current = null;
	}, []);
	const endRef = useRef(() => {});
	const onPointerDown = useCallback((e) => {
		if (e.pointerType === "mouse" && e.button !== 0) return;
		const el = e.currentTarget;
		disarmFallback();
		let captured = true;
		try {
			el.setPointerCapture(e.pointerId);
		} catch {
			captured = false;
		}
		const s = st.current;
		s.startX = e.clientX;
		s.startY = e.clientY;
		s.lastX = e.clientX;
		s.lastY = e.clientY;
		s.active = true;
		s.committed = (optsRef.current.threshold ?? 10) <= 0;
		if (!captured) {
			const pointerId = e.pointerId;
			const onWindowEnd = (ev) => {
				if (ev.pointerId !== pointerId) return;
				endRef.current(ev);
			};
			window.addEventListener("pointerup", onWindowEnd);
			window.addEventListener("pointercancel", onWindowEnd);
			fallback.current = {
				pointerId,
				dispose: () => {
					window.removeEventListener("pointerup", onWindowEnd);
					window.removeEventListener("pointercancel", onWindowEnd);
				}
			};
		}
		optsRef.current.onStart?.(e);
		if (s.committed) optsRef.current.onMove({
			dx: 0,
			dy: 0,
			x: e.clientX,
			y: e.clientY,
			first: true
		});
		e.preventDefault();
	}, [disarmFallback]);
	const onPointerMove = useCallback((e) => {
		const s = st.current;
		if (!s.active) return;
		s.lastX = e.clientX;
		s.lastY = e.clientY;
		const dx = e.clientX - s.startX;
		const dy = e.clientY - s.startY;
		const threshold = optsRef.current.threshold ?? 10;
		if (!s.committed) {
			if (Math.hypot(dx, dy) < threshold) return;
			s.committed = true;
		}
		optsRef.current.onMove({
			dx,
			dy,
			x: e.clientX,
			y: e.clientY,
			first: false
		});
	}, []);
	const end = useCallback((e) => {
		const s = st.current;
		if (!s.active) return;
		s.active = false;
		disarmFallback();
		const target = "currentTarget" in e ? e.currentTarget : null;
		try {
			target?.releasePointerCapture(e.pointerId);
		} catch {}
		if (e.type === "pointerup") {
			s.lastX = e.clientX;
			s.lastY = e.clientY;
		}
		optsRef.current.onEnd?.({
			dx: s.lastX - s.startX,
			dy: s.lastY - s.startY,
			x: s.lastX,
			y: s.lastY,
			first: false,
			committed: s.committed
		});
		s.committed = false;
	}, [disarmFallback]);
	endRef.current = end;
	useEffect(() => disarmFallback, [disarmFallback]);
	return {
		onPointerDown,
		onPointerMove,
		onPointerUp: end,
		onPointerCancel: end,
		onLostPointerCapture: end
	};
}
// src/host/useColumnResize.ts
var DEFAULT_SLOP = 48;
function useColumnResize(storageKey, load, min, max, collapse, loadCollapsed, edge = "right") {
	const sign = edge === "left" ? -1 : 1;
	const [openWidth, setOpenWidth] = useState(load);
	const [collapsed, setCollapsed] = useState(() => !!collapse && !!loadCollapsed?.());
	const [dragging, setDragging] = useState(false);
	const isMobile = useIsMobile();
	const [openedWhileNarrow, setOpenedWhileNarrow] = useState(false);
	const narrowMode = isMobile && !!collapse?.whenNarrow;
	const collapsedEffective = !!collapse && (narrowMode ? !openedWhileNarrow : collapsed);
	const width = collapse && collapsedEffective ? collapse.width : openWidth;
	useEffect(() => {
		if (!narrowMode) setOpenedWhileNarrow(false);
	}, [narrowMode]);
	const startWRef = useRef(0);
	const startCollapsedRef = useRef(false);
	const startOpenRef = useRef(0);
	const draggingRef = useRef(false);
	const liveRef = useRef({
		width,
		collapsed: collapsedEffective,
		openWidth
	});
	liveRef.current = {
		width,
		collapsed: collapsedEffective,
		openWidth
	};
	/** Where the column lands for a drag delta of `dx`, as the OPEN width plus the
	*  collapsed flag. Pure in (dx, drag start), so onMove and onEnd can never
	*  disagree about the result. */
	const resolve = useCallback((dx) => {
		const raw = startWRef.current + dx;
		const clamp = (v) => Math.min(max, Math.max(min, v));
		if (!collapse) return {
			openWidth: clamp(raw),
			collapsed: false
		};
		const slop = collapse.slop ?? DEFAULT_SLOP;
		if (startCollapsedRef.current) {
			const overshoot = raw - (collapse.width + slop);
			return overshoot < 0 ? {
				openWidth: startOpenRef.current,
				collapsed: true
			} : {
				openWidth: clamp(startOpenRef.current + overshoot),
				collapsed: false
			};
		}
		return raw <= min - slop ? {
			openWidth: startOpenRef.current,
			collapsed: true
		} : {
			openWidth: clamp(raw),
			collapsed: false
		};
	}, [
		min,
		max,
		collapse
	]);
	const apply = useCallback((dx) => {
		const next = resolve(dx);
		setOpenWidth(next.openWidth);
		if (narrowMode) setOpenedWhileNarrow(!next.collapsed);
		else setCollapsed(next.collapsed);
		return next;
	}, [resolve, narrowMode]);
	const persist = useCallback((next) => {
		safeSetItem(storageKey, String(next.openWidth));
		if (collapse && !narrowMode) safeSetItem(collapse.storageKey, next.collapsed ? "1" : "0");
	}, [
		storageKey,
		collapse,
		narrowMode
	]);
	const handleProps = usePointerDrag({
		threshold: 0,
		onStart: () => {
			startWRef.current = liveRef.current.width;
			startCollapsedRef.current = liveRef.current.collapsed;
			startOpenRef.current = liveRef.current.openWidth;
			draggingRef.current = true;
			setDragging(true);
			document.body.style.cursor = "col-resize";
			document.body.style.userSelect = "none";
		},
		onMove: ({ dx }) => {
			apply(sign * dx);
		},
		onEnd: ({ dx }) => {
			draggingRef.current = false;
			setDragging(false);
			persist(apply(sign * dx));
			document.body.style.cursor = "";
			document.body.style.userSelect = "";
		}
	});
	useEffect(() => () => {
		if (draggingRef.current) {
			draggingRef.current = false;
			document.body.style.cursor = "";
			document.body.style.userSelect = "";
		}
	}, []);
	const expand = useCallback(() => {
		if (narrowMode) setOpenedWhileNarrow(true);
		else setCollapsed(false);
		persist({
			openWidth: liveRef.current.openWidth,
			collapsed: false
		});
	}, [persist, narrowMode]);
	/** Collapse to the icon strip, keeping the remembered open width.
	*
	*  Symmetric with `expand`, for consumers that need to collapse for a reason
	*  other than a drag — a narrow viewport, where a fixed-width rail beside a
	*  detail pane would leave the pane too narrow to use. Named apart from the
	*  `collapse` CONFIG parameter above, which it reads.  */
	const collapseColumn = useCallback(() => {
		if (!collapse) return;
		if (narrowMode) setOpenedWhileNarrow(false);
		else setCollapsed(true);
		persist({
			openWidth: liveRef.current.openWidth,
			collapsed: true
		});
	}, [
		persist,
		collapse,
		narrowMode
	]);
	return {
		width,
		collapsed: collapsedEffective,
		dragging,
		expand,
		nudge: useCallback((dx) => {
			const d = sign * dx;
			const live = liveRef.current;
			const clamp = (v) => Math.min(max, Math.max(min, v));
			if (collapse && live.collapsed) {
				if (d <= 0) return;
				const next = {
					openWidth: clamp(live.openWidth),
					collapsed: false
				};
				if (narrowMode) setOpenedWhileNarrow(true);
				else setCollapsed(false);
				setOpenWidth(next.openWidth);
				persist(next);
				return;
			}
			const raw = live.openWidth + d;
			const next = collapse && raw < min ? {
				openWidth: live.openWidth,
				collapsed: true
			} : {
				openWidth: clamp(raw),
				collapsed: false
			};
			if (narrowMode) setOpenedWhileNarrow(!next.collapsed);
			else setCollapsed(next.collapsed);
			setOpenWidth(next.openWidth);
			persist(next);
		}, [
			min,
			max,
			collapse,
			persist,
			narrowMode,
			sign
		]),
		collapse: collapseColumn,
		handleProps
	};
}
// src/components/EmptyState.tsx
function EmptyState({ icon: Icon, title, hint, children }) {
	return /* @__PURE__ */ jsxs("div", {
		className: "flex-1 min-h-0 flex flex-col items-center justify-center gap-2.5 text-center px-6",
		children: [
			/* @__PURE__ */ jsx(Icon, {
				size: 26,
				className: "text-muted opacity-50",
				strokeWidth: 1.5,
				"aria-hidden": "true"
			}),
			/* @__PURE__ */ jsx("div", {
				className: "text-[13px] text-text",
				children: title
			}),
			hint && /* @__PURE__ */ jsx("div", {
				className: "text-[11.5px] text-muted opacity-70",
				children: hint
			}),
			children && /* @__PURE__ */ jsx("div", {
				className: "mt-1",
				children
			})
		]
	});
}
// src/lib/format.ts
/** Compact "just now / 5m ago / 3h ago / 2d ago" from an ISO timestamp. Returns
* '' for a falsy / unparseable input (e.g. a run that has no finished_at yet).
* A future timestamp (clock skew) reads as "just now" rather than a negative. */
function relativeAge(iso) {
	if (!iso) return "";
	const then = new Date(iso);
	if (isNaN(then.getTime())) return "";
	const secs = Math.floor((Date.now() - then.getTime()) / 1e3);
	if (secs < 60) return i18nT("apps.codeReviewSage.lib.format.just_now");
	const mins = Math.floor(secs / 60);
	if (mins < 60) return i18nT("apps.codeReviewSage.lib.format.minutes_ago", { count: mins });
	const hrs = Math.floor(mins / 60);
	if (hrs < 24) return i18nT("apps.codeReviewSage.lib.format.hours_ago", { count: hrs });
	return i18nT("apps.codeReviewSage.lib.format.days_ago", { count: Math.floor(hrs / 24) });
}
/** A running clock label from an elapsed millisecond span: "0:07", "3:42", or
* "1:02:59" once it crosses an hour. Negative spans clamp to zero. */
function formatElapsed(ms) {
	const total = Math.max(0, Math.floor(ms / 1e3));
	const h = Math.floor(total / 3600);
	const m = Math.floor(total % 3600 / 60);
	const s = total % 60;
	const ss = String(s).padStart(2, "0");
	if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${ss}`;
	return `${m}:${ss}`;
}
/** Elapsed span (ms) for a run: start → finish, or start → now while it is still
* running. `nowMs` is injectable so a ticking component drives re-renders and
* tests stay deterministic. */
function runElapsedMs(startedAt, finishedAt, nowMs) {
	const start = new Date(startedAt).getTime();
	if (isNaN(start)) return 0;
	const end = finishedAt ? new Date(finishedAt).getTime() : nowMs;
	if (isNaN(end)) return 0;
	return end - start;
}
/** The per-change phases the driver reports as terminal — a change in one of
* these will not advance further, so it counts toward run completion. */
var TERMINAL_PHASES = /* @__PURE__ */ new Set([
	"done",
	"failed",
	"cancelled"
]);
/** Human label for a per-change phase. Unknown phases (the type allows an open
* string) are title-cased rather than dropped. */
function phaseLabel(phase) {
	switch (phase) {
		case "queued": return i18nT("apps.codeReviewSage.lib.format.phase_queued");
		case "reviewing": return i18nT("apps.codeReviewSage.lib.format.phase_reviewing");
		case "done": return i18nT("apps.codeReviewSage.lib.format.phase_done");
		case "failed": return i18nT("apps.codeReviewSage.lib.format.phase_failed");
		case "cancelled": return i18nT("apps.codeReviewSage.lib.format.phase_cancelled");
		default: return phase ? phase.charAt(0).toUpperCase() + phase.slice(1) : i18nT("apps.codeReviewSage.lib.format.phase_pending");
	}
}
/** Parse a compact "owner/repo#123" identity out of a change string. Handles
* GitHub pull URLs (…/owner/repo/pull/123) and GitLab MR URLs
* (…/owner/repo/-/merge_requests/123). Falls back to the URL path, then to the
* raw string, so a picked link or a pasted id always renders as SOMETHING. */
function prLabelFromChange(change) {
	if (!change) return "";
	const m = change.match(/([^/]+)\/([^/]+)\/(?:-\/)?(?:pull|merge_requests)\/(\d+)/);
	if (m) return `${m[1]}/${m[2]}#${m[3]}`;
	try {
		const path = new URL(change).pathname.replace(/^\/+|\/+$/g, "");
		if (path) return path;
	} catch {}
	return change;
}
/** The run-list identity line: a repo-wide run shows "owner/name"; a PR run
* shows the first change's parsed label plus a "+N more" tail when several PRs
* are under review together. */
function runIdentity(repo, changes) {
	if (repo) return {
		label: repo,
		more: 0
	};
	return {
		label: prLabelFromChange(changes[0] ?? ""),
		more: Math.max(0, changes.length - 1)
	};
}
/** Build a PrRef from a run's change URL + the driver's change id.
*
* A run records only the URL, so opening a review from the thread list has to
* reconstruct enough of a PR to render the pane; the title/author/checks all
* come from the provider fetch keyed on this URL. */
function prRefFromChange(url, changeId) {
	const m = /\/(?:pull|merge_requests)\/(\d+)/.exec(url);
	return {
		url,
		number: m ? Number(m[1]) : 0,
		change_id: changeId
	};
}
/** The ``owner/repo`` a run belongs to, lowercased for comparison.
*
* Repo-wide runs carry it directly. Runs started from picked or pasted PR links
* do not, so it is recovered from the first change URL — that is what lets the
* middle column show only the selected repo's reviews. Returns null when the
* link is not a shape we recognise (a run we cannot attribute is only ever
* hidden from a repo-scoped list, never from the rail's full list). */
function repoOfRun(run) {
	if (run.repo && run.repo.includes("/")) return run.repo.toLowerCase();
	const first = run.changes?.[0];
	if (!first) return null;
	const m = /(?:github\.com|gitlab\.com)\/([^/\s]+)\/([^/\s]+)/i.exec(first);
	return m ? `${m[1]}/${m[2]}`.toLowerCase() : null;
}
/** The lossless identity of a change, for matching a PR against a run.
*
* `change_id` is NOT safe to match on. The backend derives it with
* `change_id_for`, which is also an on-disk filename and so is lossily
* sanitized (`[^A-Za-z0-9._-]+` collapses to `_`). Two different repositories
* therefore share one id: `acme/service-api#5` and `acme/service_api#5` both
* become the same stem. The backend already hit this — it is why the durable
* reviewed-index uses `reviewed_key_for` instead — but the UI kept matching on
* the lossy id, so a collision selected the wrong run, scoped the PR pane to a
* stranger's review, and posted comments to the other pull request.
*
* The PR URL is the identity that does not collapse, and `run.changes` holds
* exactly those URLs. Normalized only for case and a trailing slash, since the
* same PR can arrive from the picker and from a pasted link.
*/
function changeKey(url) {
	return String(url ?? "").trim().replace(/\/+$/, "").toLowerCase();
}
/** Whether `run` covers the change at `url`. */
function runCoversChange(run, url) {
	const want = changeKey(url);
	if (!want) return false;
	return (run.changes ?? []).some((c) => changeKey(c) === want);
}
/** The status to SHOW for a run, which is not always the one stored on it.
*
* ``run_review`` reports ok for any run with at least one change, so a run whose
* every change failed was recorded as "done". The backend now writes "error" for
* that case, but runs recorded BEFORE it did keep their misleading status on
* disk, and a green "Done" beside "0 / 1 reviewed · 1 failed" is exactly the
* contradiction this resolves. Derived from the per-change phases, which are the
* ground truth about what actually happened.
*
* Only ever demotes a claimed success — a run the backend already calls error,
* cancelled or running is passed through untouched. */
function effectiveRunStatus(run) {
	if (run.status !== "done") return run.status;
	let done = 0;
	let failed = 0;
	run.changes.forEach((change, i) => {
		const cid = run.change_ids?.[i] ?? change;
		const phase = run.progress?.[cid]?.phase;
		if (phase === "done") done += 1;
		else if (phase === "failed") failed += 1;
	});
	return done === 0 && failed > 0 ? "error" : "done";
}
/** Median wall-clock duration of past SUCCESSFUL runs of the same size, in ms,
* or null when there is not enough history to say.
*
* A single-PR review is one opaque worker turn, so there is no percentage to
* show — but "usually about 7 min" turns an indefinite wait into a bounded one.
* Median rather than mean because one timed-out run would otherwise dominate,
* and only runs of the same change count, since duration scales with them. */
function typicalRunMs(runs, changeCount) {
	const spans = [];
	for (const r of runs) {
		if (r.status !== "done" || !r.finished_at) continue;
		if (r.changes.length !== changeCount) continue;
		const ms = Date.parse(r.finished_at) - Date.parse(r.started_at);
		if (Number.isFinite(ms) && ms > 0) spans.push(ms);
	}
	if (spans.length < 2) return null;
	spans.sort((a, b) => a - b);
	const mid = Math.floor(spans.length / 2);
	return spans.length % 2 === 0 ? (spans[mid - 1] + spans[mid]) / 2 : spans[mid];
}
/** Why a run failed, in words a reader can act on.
*
* The driver records causes in its own vocabulary ("Runtime process died during
* prompt", "no_review_recorded"). Those are accurate but say nothing about what
* happened or what to do, so the known ones are translated and anything
* unrecognised is passed through verbatim rather than flattened into a generic
* message. Returns null when the run did not fail. */
function failureReason(run, changeId) {
	if (effectiveRunStatus(run) !== "error" && run.status !== "interrupted") return null;
	let raw = "";
	let token = "";
	if (changeId) {
		raw = (run.progress?.[changeId]?.error || "").trim();
		token = (run.progress?.[changeId]?.reason || "").trim();
	}
	if (!raw) raw = (run.error || "").trim();
	if (!token) token = (run.reason || "").trim();
	if (!raw) for (const change of run.changes) {
		const cid = run.change_ids?.[run.changes.indexOf(change)] ?? change;
		const e = (run.progress?.[cid]?.error || "").trim();
		if (e) {
			raw = e;
			if (!token) token = (run.progress?.[cid]?.reason || "").trim();
			break;
		}
	}
	if (!raw) return {
		text: i18nT("apps.codeReviewSage.lib.format.cause_unknown"),
		raw: ""
	};
	const lower = raw.toLowerCase();
	if (/runtime process died|runtime is dead/.test(lower)) return {
		text: i18nT("apps.codeReviewSage.lib.format.cause_runtime_died"),
		raw
	};
	if (/no kiro-cli executable/.test(lower)) return {
		text: i18nT("apps.codeReviewSage.lib.format.cause_no_agent_cli"),
		raw
	};
	if (/is not importable/.test(lower)) return {
		text: i18nT("apps.codeReviewSage.lib.format.cause_runtime_not_importable"),
		raw
	};
	if (/runtime_unavailable|agent runtime is unavailable/.test(lower)) return {
		text: i18nT("apps.codeReviewSage.lib.format.cause_runtime_unavailable"),
		raw
	};
	if (/no result record|no_review_recorded/.test(lower)) return {
		text: i18nT("apps.codeReviewSage.lib.format.cause_no_record"),
		raw
	};
	if (/never completed the review|review_record_incomplete/.test(lower)) return {
		text: i18nT("apps.codeReviewSage.lib.format.cause_record_incomplete"),
		raw
	};
	if (/timed out|timeout/.test(lower)) return {
		text: i18nT("apps.codeReviewSage.lib.format.cause_timeout"),
		raw
	};
	if (/review_failed/.test(lower)) return {
		text: i18nT("apps.codeReviewSage.lib.format.cause_turn_failed"),
		raw
	};
	const key = {
		runtime_unavailable: "apps.codeReviewSage.lib.format.cause_runtime_unavailable",
		no_review_recorded: "apps.codeReviewSage.lib.format.cause_no_record",
		review_record_incomplete: "apps.codeReviewSage.lib.format.cause_record_incomplete"
	}[token];
	if (key) return {
		text: i18nT(key),
		raw
	};
	return {
		text: raw,
		raw
	};
}
// src/lib/layout.ts
var RAIL_WIDTH_KEY = "kc:code-review-sage:rail-width";
var RAIL_COLLAPSED_KEY = "kc:code-review-sage:rail-collapsed";
function loadWidth(key, min, max, fallback) {
	try {
		const raw = localStorage.getItem(key);
		if (!raw) return fallback;
		const n = Number(raw);
		if (!Number.isFinite(n)) return fallback;
		return Math.min(max, Math.max(min, n));
	} catch {
		return fallback;
	}
}
function loadRailWidth() {
	return loadWidth(RAIL_WIDTH_KEY, 280, 560, 360);
}
/** The DESKTOP collapsed preference. The narrow-viewport strip is a session-only
* override inside the resize hook and deliberately never reaches storage, so one
* phone visit cannot leave the desktop rail collapsed. */
function loadRailCollapsed() {
	try {
		return localStorage.getItem(RAIL_COLLAPSED_KEY) === "1";
	} catch {
		return false;
	}
}
/** Poll cadence while at least one run is live. Reviews advance on the order of
* seconds per phase, so this is frequent enough to feel live without being
* chatty; everything falls back to {@link IDLE_POLL_MS} once nothing is running. */
var LIVE_POLL_MS = 3e3;
/** Idle cadence: a run can still be started from another tab or a cron. */
var IDLE_POLL_MS = 3e4;
// src/lib/persist.ts
var PREFIX = "kc:code-review-sage";
var UI_STATE_KEY = `${PREFIX}:ui-state`;
var CACHE_PREFIX = `${PREFIX}:cache:`;
/** Bump when a persisted shape changes incompatibly — old entries are dropped
* rather than fed to code that no longer understands them. */
var SCHEMA = 1;
/** How long a snapshot is worth replaying. Past this it is likely to mislead
* more than it helps (runs evicted, PRs merged), so we take the skeleton. */
var MAX_AGE_MS = 864e5;
/** Per-entry cap. PR lists for a busy repo are the large ones; a payload past
* this is skipped rather than risking the 5MB origin-wide storage budget that
* the rest of the dashboard also draws on. */
var MAX_BYTES = 262144;
var RECENT_KEY = `${PREFIX}:recent-repos`;
/** How many recently-picked repos to keep. Enough to cover what you are actually
*  working on this week without turning the section into a second full list. */
var MAX_RECENT = 5;
/** The repos you picked most recently, newest first.
*
* Separate from the pinned list, which is server-side and ordered by when each
* repo was added — useless for finding the two or three you keep returning to. */
function loadRecentRepos() {
	try {
		const raw = localStorage.getItem(RECENT_KEY);
		if (!raw) return [];
		const parsed = JSON.parse(raw);
		if (!parsed || parsed.v !== SCHEMA || !Array.isArray(parsed.repos)) return [];
		return parsed.repos.filter((r) => !!r && typeof r.owner === "string" && typeof r.repo === "string").slice(0, MAX_RECENT);
	} catch {
		return [];
	}
}
/** Record a pick, moving it to the front. */
function rememberRecentRepo(repo) {
	const next = [{
		owner: repo.owner,
		repo: repo.repo
	}, ...loadRecentRepos().filter((r) => !(r.owner === repo.owner && r.repo === repo.repo))].slice(0, MAX_RECENT);
	try {
		localStorage.setItem(RECENT_KEY, JSON.stringify({
			v: SCHEMA,
			repos: next
		}));
	} catch {}
	return next;
}
var MAIN_VIEWS = [
	"reviews",
	"learning",
	"settings"
];
var LIST_TABS$1 = [
	"pulls",
	"reviews",
	"queue"
];
/** Coerce a persisted view back to one that still exists. A view removed since
* the value was written must not survive a reload, or the main area renders
* blank with nothing selected in the rail. */
function coerceMainView(value) {
	return MAIN_VIEWS.includes(value) ? value : "reviews";
}
function coerceListTab(value) {
	return LIST_TABS$1.includes(value) ? value : "pulls";
}
function loadUiState() {
	try {
		const raw = localStorage.getItem(UI_STATE_KEY);
		if (!raw) return {};
		const parsed = JSON.parse(raw);
		if (!parsed || typeof parsed !== "object") return {};
		if (parsed.v !== SCHEMA) return {};
		const s = parsed.state;
		return s && typeof s === "object" ? s : {};
	} catch {
		return {};
	}
}
function saveUiState(state) {
	try {
		localStorage.setItem(UI_STATE_KEY, JSON.stringify({
			v: SCHEMA,
			state
		}));
	} catch {}
}
function readSnapshot(key) {
	try {
		const raw = localStorage.getItem(CACHE_PREFIX + key);
		if (!raw) return void 0;
		const parsed = JSON.parse(raw);
		if (!parsed || parsed.v !== SCHEMA || typeof parsed.at !== "number") return;
		if (Date.now() - parsed.at > MAX_AGE_MS) {
			localStorage.removeItem(CACHE_PREFIX + key);
			return;
		}
		return {
			data: parsed.data,
			at: parsed.at
		};
	} catch {
		return;
	}
}
function writeSnapshot(key, data) {
	try {
		const body = JSON.stringify({
			v: SCHEMA,
			at: Date.now(),
			data
		});
		if (body.length > MAX_BYTES) return;
		localStorage.setItem(CACHE_PREFIX + key, body);
	} catch {}
}
// src/context.tsx
function repoUrl(r) {
	return `https://github.com/${r.owner}/${r.repo}`;
}
function repoSlug(r) {
	return `${r.owner}/${r.repo}`;
}
var Ctx = createContext(null);
function useSage() {
	const v = useContext(Ctx);
	if (!v) throw new Error("useSage must be used within <SageProvider>");
	return v;
}
var RUNS_KEY = ["code-review-sage", "runs"];
function SageProvider({ children, initialRunId }) {
	const qc = useQueryClient();
	const [restored] = useState(loadUiState);
	const [selectedRunId, setSelectedRunId] = useState(initialRunId ?? restored.selectedRunId ?? null);
	const [mainView, setMainView] = useState(() => coerceMainView(restored.mainView));
	const [selectedNamespace, selectNamespace] = useState("default");
	const [listTab, setListTab] = useState(() => coerceListTab(restored.listTab));
	const [expanded, setExpanded] = useState("reviews");
	const [composing, setComposing] = useState(false);
	const [addingRepos, setAddingRepos] = useState(false);
	const [activeRepo, setActiveRepo] = useState(restored.activeRepo ?? null);
	const [selectedPr, setSelectedPr] = useState(initialRunId ? null : restored.selectedPr ?? null);
	const [discoveryEnabled, setDiscoveryEnabled] = useState(false);
	const prsRef = useRef([]);
	const runsSnapshot = useMemo(() => readSnapshot("runs"), []);
	const runsQuery = useQuery({
		queryKey: RUNS_KEY,
		queryFn: () => sageApi.runs(),
		initialData: runsSnapshot?.data,
		initialDataUpdatedAt: runsSnapshot?.at,
		refetchInterval: (q) => (q.state.data?.runs ?? []).some((r) => r.status === "running") ? LIVE_POLL_MS : IDLE_POLL_MS
	});
	const runs = useMemo(() => runsQuery.data?.runs ?? [], [runsQuery.data]);
	const anyRunning = runs.some((r) => r.status === "running");
	const repoRuns = useMemo(() => {
		if (!activeRepo) return [];
		const want = repoSlug(activeRepo).toLowerCase();
		return runs.filter((r) => repoOfRun(r) === want);
	}, [runs, activeRepo]);
	const reviewingChangeUrls = useMemo(() => {
		const urls = /* @__PURE__ */ new Set();
		for (const r of runs) {
			if (r.status !== "running") continue;
			for (const c of r.changes ?? []) urls.add(changeKey(c));
		}
		return urls;
	}, [runs]);
	const activeRun = useMemo(() => runs.find((r) => r.run_id === selectedRunId) ?? null, [runs, selectedRunId]);
	const prRun = useMemo(() => {
		if (!selectedPr || !activeRun) return null;
		return runCoversChange(activeRun, selectedPr.url) ? activeRun : null;
	}, [activeRun, selectedPr]);
	const selectPr = useCallback((pr) => {
		setSelectedPr(pr);
		setComposing(false);
		setAddingRepos(false);
		if (!pr) return;
		const run = runs.find((r) => runCoversChange(r, pr.url));
		setSelectedRunId(run?.run_id ?? null);
	}, [runs]);
	const reportSnapshot = useMemo(() => selectedRunId ? readSnapshot(`report:${selectedRunId}`) : void 0, [selectedRunId]);
	const reportQuery = useQuery({
		queryKey: [
			"code-review-sage",
			"report",
			selectedRunId
		],
		queryFn: () => sageApi.runReport(selectedRunId),
		enabled: !!selectedRunId,
		initialData: reportSnapshot?.data,
		initialDataUpdatedAt: reportSnapshot?.at,
		refetchInterval: () => activeRun?.status === "running" ? LIVE_POLL_MS : false
	});
	useEffect(() => {
		if (runsQuery.data && runsQuery.isSuccess && !runsQuery.isPlaceholderData) writeSnapshot("runs", runsQuery.data);
	}, [
		runsQuery.data,
		runsQuery.isSuccess,
		runsQuery.isPlaceholderData
	]);
	useEffect(() => {
		if (selectedRunId && reportQuery.data?.ready && reportQuery.isSuccess) writeSnapshot(`report:${selectedRunId}`, reportQuery.data);
	}, [
		selectedRunId,
		reportQuery.data,
		reportQuery.isSuccess
	]);
	const invalidateRuns = useCallback(() => {
		qc.invalidateQueries({ queryKey: RUNS_KEY });
	}, [qc]);
	const selectRun = useCallback((runId) => {
		setSelectedRunId(runId);
		if (!runId) return;
		setComposing(false);
		setAddingRepos(false);
		const run = runs.find((r) => r.run_id === runId);
		const changes = run?.changes ?? [];
		if (run && changes.length === 1) {
			const cid = run.change_ids?.[0] ?? changes[0];
			const want = changeKey(changes[0]);
			const known = prsRef.current.find((p) => changeKey(p.url) === want);
			setSelectedPr(known ?? prRefFromChange(changes[0], cid));
		} else setSelectedPr(null);
	}, [runs]);
	const cancelMut = useMutation({
		mutationFn: (runId) => sageApi.cancelRun(runId),
		onSuccess: invalidateRuns
	});
	const deleteMut = useMutation({
		mutationFn: (runId) => sageApi.deleteRun(runId),
		onSuccess: (_d, runId) => {
			setSelectedRunId((cur) => cur === runId ? null : cur);
			invalidateRuns();
		}
	});
	const postMut = useMutation({
		mutationFn: ({ runId, select }) => sageApi.postComments(runId, select),
		onSuccess: invalidateRuns
	});
	const postGroupsMut = useMutation({
		mutationFn: ({ runId, groups }) => sageApi.postCommentGroups(runId, groups),
		onSuccess: invalidateRuns
	});
	const dismissMut = useMutation({
		mutationFn: ({ runId, changeId, key, reason }) => sageApi.dismissFinding(runId, changeId, key, reason),
		onSuccess: (_d, { runId }) => {
			invalidateRuns();
			qc.invalidateQueries({ queryKey: [
				"code-review-sage",
				"report",
				runId
			] });
		}
	});
	const archiveMut = useMutation({
		mutationFn: (runId) => sageApi.archiveRun(runId),
		onSuccess: (_d, runId) => {
			invalidateRuns();
			qc.invalidateQueries({ queryKey: [
				"code-review-sage",
				"report",
				runId
			] });
		}
	});
	const onStarted = useCallback((runId) => {
		invalidateRuns();
		if (runId) {
			setComposing(false);
			setAddingRepos(false);
			setMainView("reviews");
			setExpanded("reviews");
			setListTab("reviews");
			setSelectedRunId(runId);
		}
	}, [invalidateRuns]);
	const startReview = useMutation({
		mutationFn: (changes) => sageApi.review(changes),
		onSuccess: (d) => onStarted(d.run_id)
	});
	const startReviewLinks = useMutation({
		mutationFn: (links) => sageApi.reviewLinks(links),
		onSuccess: (d) => onStarted(d.run_id)
	});
	const startRepoReview = useMutation({
		mutationFn: ({ repo, force }) => sageApi.reviewRepo(repo, force),
		onSuccess: (d) => onStarted(d.run_id)
	});
	const pinnedSnapshot = useMemo(() => readSnapshot("repos"), []);
	const pinnedQuery = useQuery({
		queryKey: ["code-review-sage", "repos"],
		queryFn: () => sageApi.pinnedRepos(),
		initialData: pinnedSnapshot?.data,
		initialDataUpdatedAt: pinnedSnapshot?.at
	});
	const recentQuery = useQuery({
		queryKey: ["code-review-sage", "recent-repos"],
		queryFn: () => sageApi.recentRepos(),
		enabled: discoveryEnabled,
		staleTime: 3e5
	});
	const mineQuery = useQuery({
		queryKey: ["code-review-sage", "my-repos"],
		queryFn: () => sageApi.myRepos(),
		enabled: discoveryEnabled,
		staleTime: 3e5
	});
	useEffect(() => {
		if (pinnedQuery.data && pinnedQuery.isSuccess) writeSnapshot("repos", pinnedQuery.data);
	}, [pinnedQuery.data, pinnedQuery.isSuccess]);
	const invalidateRepos = useCallback(() => {
		qc.invalidateQueries({ queryKey: ["code-review-sage", "repos"] });
		qc.invalidateQueries({ queryKey: ["code-review-sage", "recent-repos"] });
		qc.invalidateQueries({ queryKey: ["code-review-sage", "my-repos"] });
	}, [qc]);
	const pinMut = useMutation({
		mutationFn: ({ owner, repo }) => sageApi.pinRepo(owner, repo),
		onSuccess: (_d, v) => {
			invalidateRepos();
			setActiveRepo(v);
		}
	});
	const pinUrlMut = useMutation({
		mutationFn: (url) => sageApi.pinRepoUrl(url),
		onSuccess: (d) => {
			invalidateRepos();
			const added = d.added ?? d.repos?.[0];
			if (added) setActiveRepo({
				owner: added.owner,
				repo: added.repo
			});
			if (d.pull_request) {
				setMainView("reviews");
				setListTab("pulls");
				setAddingRepos(false);
				selectPr({
					url: d.pull_request.url,
					change_id: d.pull_request.change_id,
					number: d.pull_request.number
				});
			}
		}
	});
	const unpinMut = useMutation({
		mutationFn: ({ owner, repo }) => sageApi.unpinRepo(owner, repo),
		onSuccess: (_d, v) => {
			invalidateRepos();
			setActiveRepo((cur) => cur && cur.owner === v.owner && cur.repo === v.repo ? null : cur);
		}
	});
	const prsKey = activeRepo ? `prs:${repoSlug(activeRepo).toLowerCase()}` : "";
	const prsSnapshot = prsKey ? readSnapshot(prsKey) : void 0;
	const prsQuery = useQuery({
		queryKey: [
			"code-review-sage",
			"repo-prs",
			activeRepo ? repoSlug(activeRepo) : ""
		],
		queryFn: () => sageApi.repoPrs(repoUrl(activeRepo)),
		enabled: !!activeRepo,
		initialData: prsSnapshot?.data,
		initialDataUpdatedAt: prsSnapshot?.at,
		staleTime: 6e4
	});
	useEffect(() => {
		if (prsKey && prsQuery.data && prsQuery.isSuccess) writeSnapshot(prsKey, prsQuery.data);
	}, [
		prsKey,
		prsQuery.data,
		prsQuery.isSuccess
	]);
	useEffect(() => {
		const list = pinnedQuery.data?.repos;
		if (!activeRepo || !list) return;
		if (!list.some((r) => r.owner === activeRepo.owner && r.repo === activeRepo.repo)) setActiveRepo(null);
	}, [pinnedQuery.data, activeRepo]);
	useEffect(() => {
		if (!selectedRunId || !runsQuery.isSuccess || runsQuery.isFetching) return;
		if (!runs.some((r) => r.run_id === selectedRunId)) {
			setSelectedRunId(null);
			setSelectedPr(null);
		}
	}, [
		runs,
		runsQuery.isSuccess,
		runsQuery.isFetching,
		selectedRunId
	]);
	useEffect(() => {
		saveUiState({
			mainView,
			listTab,
			activeRepo: activeRepo ? {
				owner: activeRepo.owner,
				repo: activeRepo.repo
			} : null,
			selectedRunId,
			selectedPr,
			detailTab: null
		});
	}, [
		mainView,
		listTab,
		activeRepo,
		selectedRunId,
		selectedPr
	]);
	prsRef.current = prsQuery.data?.prs ?? [];
	const value = {
		runs,
		runsLoading: runsQuery.isLoading,
		runsError: runsQuery.error ?? null,
		pool: runsQuery.data?.pool ?? null,
		reviewer: runsQuery.data?.reviewer ?? null,
		anyRunning,
		repoRuns,
		reviewingChangeUrls,
		selectedRunId,
		selectRun,
		activeRun,
		report: reportQuery.data ?? null,
		reportLoading: reportQuery.isLoading,
		reportError: reportQuery.error ?? null,
		cancelRun: (runId) => cancelMut.mutate(runId),
		cancelling: cancelMut.isPending,
		deleteRun: (runId) => deleteMut.mutate(runId),
		deleting: deleteMut.isPending,
		archiveRun: (runId) => archiveMut.mutate(runId),
		archiving: archiveMut.isPending,
		archiveError: archiveMut.error ?? null,
		postComments: (runId, select) => postMut.mutate({
			runId,
			select
		}),
		postCommentGroups: async (runId, groups) => {
			await postGroupsMut.mutateAsync({
				runId,
				groups
			});
		},
		dismissFinding: async (runId, changeId, key, reason) => {
			await dismissMut.mutateAsync({
				runId,
				changeId,
				key,
				reason
			});
		},
		posting: postMut.isPending || postGroupsMut.isPending,
		postingSelection: postMut.isPending ? postMut.variables?.select ?? null : void 0,
		postError: postMut.error ?? postGroupsMut.error ?? null,
		startReview,
		startReviewLinks,
		startRepoReview,
		pinnedRepos: pinnedQuery.data?.repos ?? [],
		pinnedLoading: pinnedQuery.isLoading,
		recent: recentQuery.data ?? null,
		recentLoading: recentQuery.isLoading,
		recentError: recentQuery.error ?? null,
		discoveryEnabled,
		enableDiscovery: () => setDiscoveryEnabled(true),
		mine: mineQuery.data ?? null,
		mineLoading: discoveryEnabled && mineQuery.isLoading,
		mineError: mineQuery.error ?? null,
		refreshMine: () => {
			mineQuery.refetch();
			recentQuery.refetch();
		},
		pinRepo: (owner, repo) => pinMut.mutate({
			owner,
			repo
		}),
		pinRepoUrl: (url) => pinUrlMut.mutate(url),
		unpinRepo: (owner, repo) => unpinMut.mutate({
			owner,
			repo
		}),
		pinError: pinMut.error ?? pinUrlMut.error ?? unpinMut.error ?? null,
		activeRepo,
		setActiveRepo,
		selectedPr,
		selectPr,
		prRun,
		prs: prsQuery.data?.prs ?? [],
		prsLoading: prsQuery.isLoading,
		prsError: prsQuery.error ?? null,
		refreshPrs: () => {
			prsQuery.refetch();
		},
		mainView,
		setMainView,
		selectedNamespace,
		selectNamespace,
		listTab,
		setListTab,
		expanded,
		setExpanded,
		composing,
		openComposer: () => {
			setComposing(true);
			setAddingRepos(false);
			setSelectedRunId(null);
		},
		closeComposer: () => setComposing(false),
		addingRepos,
		openAddRepos: () => {
			setDiscoveryEnabled(true);
			setAddingRepos(true);
		},
		closeAddRepos: () => setAddingRepos(false)
	};
	return /* @__PURE__ */ jsx(Ctx.Provider, {
		value,
		children
	});
}
// src/components/ShimmerLine.tsx
/** A single skeleton bar: a soft GRAY base with only a FAINT teal/purple tint
* drifting across it (a restrained "content is coming" cue). Reuses the shared
* `animate-shimmer` utility (background-position sweep); `delay` offsets each
* bar so a group of them flows as a gentle wave. No new keyframes. */
function ShimmerLine({ w, delay = 0 }) {
	return /* @__PURE__ */ jsx("div", {
		className: "relative h-3 rounded overflow-hidden",
		style: {
			width: w,
			backgroundColor: "color-mix(in srgb, var(--muted) 18%, transparent)"
		},
		children: /* @__PURE__ */ jsx("div", {
			className: "absolute inset-0 animate-shimmer motion-reduce:animate-none",
			style: {
				backgroundImage: "linear-gradient(90deg, transparent, color-mix(in srgb, var(--accent) 18%, transparent), color-mix(in srgb, var(--aim) 18%, transparent), transparent)",
				backgroundSize: "200% 100%",
				animationDelay: `${delay}s`
			}
		})
	});
}
// src/components/ListSkeleton.tsx
/** Widths for the identity line of each placeholder card, cycled so the stack
* looks like text of varying length rather than a suspiciously uniform grid. */
var IDENTITY_WIDTHS = [
	"58%",
	"44%",
	"66%",
	"38%",
	"52%"
];
function ListSkeleton({ count = 5 }) {
	return /* @__PURE__ */ jsxs(Fragment, { children: [/* @__PURE__ */ jsx("span", {
		className: "sr-only",
		role: "status",
		children: i18nT("apps.codeReviewSage.components.listSkeleton.loading_reviews")
	}), /* @__PURE__ */ jsx("div", {
		"aria-hidden": "true",
		className: "flex flex-col gap-2",
		children: Array.from({ length: count }, (_, i) => /* @__PURE__ */ jsxs("div", {
			className: "w-full rounded-lg border border-border bg-card p-2.5",
			children: [/* @__PURE__ */ jsxs("div", {
				className: "flex items-center justify-between gap-2 mb-2",
				children: [/* @__PURE__ */ jsx(ShimmerLine, {
					w: IDENTITY_WIDTHS[i % IDENTITY_WIDTHS.length],
					delay: i * .06
				}), /* @__PURE__ */ jsx(ShimmerLine, {
					w: "52px",
					delay: i * .06 + .08
				})]
			}), /* @__PURE__ */ jsxs("div", {
				className: "flex items-center justify-between gap-2",
				children: [/* @__PURE__ */ jsx(ShimmerLine, {
					w: "46px",
					delay: i * .06 + .12
				}), /* @__PURE__ */ jsxs("div", {
					className: "flex items-center gap-1.5",
					children: [/* @__PURE__ */ jsx(ShimmerLine, {
						w: "22px",
						delay: i * .06 + .16
					}), /* @__PURE__ */ jsx(ShimmerLine, {
						w: "22px",
						delay: i * .06 + .2
					})]
				})]
			})]
		}, i))
	})] });
}
// src/host/useDialogFocusTrap.ts
/**
* Modal focus handling: focus moves into the dialog when it opens and back to
* what had it when it closes, Tab wraps inside the dialog, and Escape asks it to
* close (not while an IME composition is open, whose Escape cancels the
* composition). The dashboard's `hooks/useDialogFocusTrap`, without its
* coordination with the dashboard's own overlays (stacked traps, the crew
* overlay), which an app page has no access to.
*/
var FOCUSABLE = "a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex=\"-1\"])";
function useDialogFocusTrap(containerRef, onEscape) {
	useEffect(() => {
		const restoreTo = document.activeElement;
		(Array.from(containerRef.current?.querySelectorAll("a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex=\"-1\"])") ?? []).find((el) => el.tabIndex >= 0) ?? containerRef.current)?.focus({ preventScroll: true });
		return () => restoreTo?.focus?.({ preventScroll: true });
	}, [containerRef]);
	useEffect(() => {
		const onKey = (e) => {
			if (e.key === "Escape") {
				if (e.isComposing) return;
				onEscape();
				return;
			}
			const container = containerRef.current;
			if (e.key !== "Tab" || !container) return;
			const items = Array.from(container.querySelectorAll(FOCUSABLE)).filter((el) => el.tabIndex >= 0);
			if (!items.length) return;
			const firstEl = items[0];
			const lastEl = items[items.length - 1];
			const active = document.activeElement;
			const wrapsForward = !e.shiftKey && active === lastEl;
			const wrapsBackward = e.shiftKey && (active === firstEl || active === container);
			const refocuses = !wrapsForward && !wrapsBackward && !container.contains(active);
			if (!wrapsForward && !wrapsBackward && !refocuses) return;
			e.preventDefault();
			(wrapsBackward ? lastEl : firstEl).focus();
		};
		window.addEventListener("keydown", onKey, true);
		return () => window.removeEventListener("keydown", onKey, true);
	}, [containerRef, onEscape]);
}
// src/components/AddReposModal.tsx
/** One selectable repo row, shared by both lists. */
function RepoRow({ fullName, meta, pinned, onPin, badges }) {
	return /* @__PURE__ */ jsx("li", { children: /* @__PURE__ */ jsxs("button", {
		type: "button",
		onClick: onPin,
		disabled: pinned,
		"aria-label": pinned ? i18nT("apps.codeReviewSage.components.addReposModal.already_added", { repo: fullName }) : i18nT("apps.codeReviewSage.components.addReposModal.add_repo", { repo: fullName }),
		className: `w-full flex items-center gap-2 rounded-lg border px-2.5 py-2 text-left transition-colors ${pinned ? "border-border bg-bg-elevated cursor-default" : "border-border bg-card hover:bg-bg-hover hover:border-accent cursor-pointer"}`,
		children: [
			/* @__PURE__ */ jsx(FolderGit2, {
				size: 14,
				className: `flex-shrink-0 ${pinned ? "text-muted" : "text-accent"}`,
				"aria-hidden": "true"
			}),
			/* @__PURE__ */ jsxs("span", {
				className: "flex-1 min-w-0",
				children: [/* @__PURE__ */ jsx("span", {
					className: "block text-[13.5px] text-text truncate",
					children: fullName
				}), meta && /* @__PURE__ */ jsx("span", {
					className: "block text-[11.5px] text-muted mt-0.5",
					children: meta
				})]
			}),
			badges,
			pinned ? /* @__PURE__ */ jsxs("span", {
				className: "flex-shrink-0 inline-flex items-center gap-1 text-[11px] text-ok",
				children: [
					/* @__PURE__ */ jsx(Check, {
						size: 12,
						"aria-hidden": "true"
					}),
					" ",
					i18nT("apps.codeReviewSage.components.addReposModal.added")
				]
			}) : /* @__PURE__ */ jsx(Plus, {
				size: 13,
				className: "flex-shrink-0 text-muted",
				"aria-hidden": "true"
			})
		]
	}) });
}
function SectionHead({ title, hint }) {
	return /* @__PURE__ */ jsxs("div", {
		className: "flex items-baseline gap-2 mt-1",
		children: [/* @__PURE__ */ jsx("h2", {
			className: "text-[11px] uppercase tracking-wider text-muted font-medium",
			children: title
		}), hint && /* @__PURE__ */ jsx("span", {
			className: "text-[11.5px] text-muted opacity-70",
			children: hint
		})]
	});
}
/** `gh` isn't installed or signed in — a normal first-run state, not an error. */
/** `bare` drops the add-by-URL hint for surfaces that have no URL field. */
function GhNotice({ message, bare }) {
	return /* @__PURE__ */ jsxs("div", {
		className: "rounded-lg border border-border bg-bg-elevated px-3 py-2.5 text-[12.5px] leading-[1.6]",
		children: [
			/* @__PURE__ */ jsxs("span", {
				className: "inline-flex items-center gap-1.5 text-warn font-medium",
				children: [
					/* @__PURE__ */ jsx(AlertCircle, {
						size: 13,
						"aria-hidden": "true"
					}),
					" ",
					i18nT("apps.codeReviewSage.components.addReposModal.github_cli_not_ready")
				]
			}),
			/* @__PURE__ */ jsxs("div", {
				className: "text-muted mt-1",
				children: [!bare && i18nT("apps.codeReviewSage.components.addReposModal.setup_hint"), /* @__PURE__ */ jsx("div", {
					className: "mt-1",
					children: /* @__PURE__ */ jsx("code", {
						className: "font-mono",
						children: i18nT("apps.codeReviewSage.components.addReposModal.gh_auth_login")
					})
				})]
			}),
			message && /* @__PURE__ */ jsx("div", {
				className: "text-muted opacity-70 mt-1 break-words",
				children: message
			})
		]
	});
}
function AddReposModal({ onClose }) {
	const ime = useImeGuard();
	const { pinnedRepos, pinRepo, pinRepoUrl, pinError, unpinRepo, recent, recentLoading, recentError, mine, mineLoading, mineError, refreshMine } = useSage();
	const [query, setQuery] = useState("");
	const [manual, setManual] = useState("");
	const dialogRef = useRef(null);
	const requestClose = useCallback(() => onClose(), [onClose]);
	useDialogFocusTrap(dialogRef, requestClose);
	const pinnedKeys = useMemo(() => new Set(pinnedRepos.map((r) => `${r.owner}/${r.repo}`.toLowerCase())), [pinnedRepos]);
	const isPinned = (fullName) => pinnedKeys.has(fullName.toLowerCase());
	const q = query.trim().toLowerCase();
	const match = (fullName) => !q || fullName.toLowerCase().includes(q);
	const recentRows = (recent?.repos ?? []).filter((r) => match(r.full_name));
	const recentKeys = new Set((recent?.repos ?? []).map((r) => r.full_name.toLowerCase()));
	const mineRows = (mine?.repos ?? []).filter((r) => match(r.full_name) && !recentKeys.has(r.full_name.toLowerCase()));
	const setupRequired = recent?.setup_required || mine?.setup_required;
	const loading = recentLoading || mineLoading;
	const err = recentError ?? mineError ?? pinError;
	const submitManual = () => {
		const v = manual.trim();
		if (!v) return;
		pinRepoUrl(v.includes("://") ? v : `https://github.com/${v.replace(/^\/+|\/+$/g, "")}`);
		setManual("");
	};
	return /* @__PURE__ */ jsx(Fragment, { children: /* @__PURE__ */ jsxs("div", {
		className: "absolute inset-0 z-50 flex items-center justify-center p-4",
		children: [/* @__PURE__ */ jsx(Clickable, {
			className: "absolute inset-0 bg-bg/50 backdrop-blur-xs",
			onClick: requestClose,
			"aria-label": i18nT("apps.codeReviewSage.components.addReposModal.close_add_repos_dialog")
		}), /* @__PURE__ */ jsxs("div", {
			ref: dialogRef,
			role: "dialog",
			"aria-modal": "true",
			"aria-label": i18nT("apps.codeReviewSage.components.addReposModal.add_repos"),
			tabIndex: -1,
			className: "relative w-[680px] max-w-full h-[620px] max-h-full border border-border rounded-[14px] bg-card flex flex-col shadow-2xl outline-hidden overflow-hidden",
			onKeyDown: (e) => e.stopPropagation(),
			children: [
				/* @__PURE__ */ jsxs("header", {
					className: "px-4 md:px-6 pt-5 pb-4 border-b border-border flex-shrink-0",
					children: [
						/* @__PURE__ */ jsx("h1", {
							className: "text-[19px] font-bold leading-tight text-text-strong pr-8",
							children: i18nT("apps.codeReviewSage.components.addReposModal.add_repos")
						}),
						/* @__PURE__ */ jsx("p", {
							className: "text-[12.5px] text-muted mt-1.5 leading-[1.5]",
							children: i18nT("apps.codeReviewSage.components.addReposModal.pick_from_the_repos_you_can_reach_or_type_one_in")
						}),
						/* @__PURE__ */ jsx("button", {
							onClick: requestClose,
							"aria-label": i18nT("apps.codeReviewSage.components.addReposModal.close"),
							className: "absolute top-3 right-3 p-1.5 rounded-md text-muted hover:text-text hover:bg-bg-hover cursor-pointer bg-transparent border-0",
							children: /* @__PURE__ */ jsx(X, { size: 16 })
						})
					]
				}),
				/* @__PURE__ */ jsxs("div", {
					className: "px-4 md:px-6 pt-4 pb-3 flex flex-col gap-2.5 flex-shrink-0",
					children: [/* @__PURE__ */ jsxs("div", {
						className: "flex items-center gap-2",
						children: [/* @__PURE__ */ jsxs("div", {
							className: "flex items-center gap-1.5 rounded-lg border border-border bg-bg-elevated px-2.5 flex-1 min-w-0 transition-colors focus-within:border-accent",
							children: [/* @__PURE__ */ jsx(GitBranch, {
								size: 13,
								className: "text-muted flex-shrink-0",
								"aria-hidden": "true"
							}), /* @__PURE__ */ jsx("input", {
								value: manual,
								onChange: (e) => setManual(e.target.value),
								...ime.bindEnter({ onEnter: submitManual }),
								"aria-label": i18nT("apps.codeReviewSage.components.addReposModal.repository_or_pull_request_url_or_owner_repo"),
								placeholder: i18nT("apps.codeReviewSage.components.addReposModal.owner_repo_a_repo_url_or_paste_a_pull_request_li"),
								className: "flex-1 min-w-0 bg-transparent border-0 py-2 text-[13px] font-mono text-text outline-hidden"
							})]
						}), /* @__PURE__ */ jsxs("button", {
							type: "button",
							onClick: submitManual,
							disabled: !manual.trim(),
							className: "inline-flex items-center gap-1.5 rounded-md bg-accent text-accent-fg px-3 py-2 text-[12.5px] font-medium border-none cursor-pointer hover:bg-accent-hover disabled:opacity-40 disabled:cursor-default transition-colors",
							children: [
								/* @__PURE__ */ jsx(Plus, {
									size: 13,
									"aria-hidden": "true"
								}),
								" ",
								i18nT("apps.codeReviewSage.components.addReposModal.add")
							]
						})]
					}), /* @__PURE__ */ jsxs("div", {
						className: "flex items-center gap-2",
						children: [/* @__PURE__ */ jsxs("div", {
							className: "flex items-center gap-1.5 rounded-lg border border-border bg-bg-elevated px-2.5 flex-1 min-w-0 transition-colors focus-within:border-accent",
							children: [/* @__PURE__ */ jsx(Search, {
								size: 13,
								className: "text-muted flex-shrink-0",
								"aria-hidden": "true"
							}), /* @__PURE__ */ jsx("input", {
								value: query,
								onChange: (e) => setQuery(e.target.value),
								"aria-label": i18nT("apps.codeReviewSage.components.addReposModal.filter_your_repos"),
								placeholder: i18nT("apps.codeReviewSage.components.addReposModal.filter_your_repos"),
								className: "flex-1 min-w-0 bg-transparent border-0 py-1.5 text-[13px] text-text outline-hidden"
							})]
						}), /* @__PURE__ */ jsx("button", {
							type: "button",
							onClick: refreshMine,
							disabled: loading,
							title: i18nT("apps.codeReviewSage.components.addReposModal.re_read_your_repos_from_github"),
							"aria-label": i18nT("apps.codeReviewSage.components.addReposModal.refresh_your_repos"),
							className: "inline-flex items-center p-1.5 bg-transparent text-muted hover:text-text disabled:opacity-40 cursor-pointer",
							children: /* @__PURE__ */ jsx(RefreshCw, {
								size: 14,
								className: loading ? "animate-spin motion-reduce:animate-none" : ""
							})
						})]
					})]
				}),
				/* @__PURE__ */ jsxs("div", {
					className: "flex-1 min-h-0 overflow-y-auto scrollbar-none px-4 md:px-6 pb-5 flex flex-col gap-2.5",
					children: [
						setupRequired && /* @__PURE__ */ jsx(GhNotice, { message: recent?.error ?? mine?.error }),
						err && !setupRequired && /* @__PURE__ */ jsx(ErrorNotice, {
							message: err.message,
							variant: "inline"
						}),
						loading && !setupRequired && /* @__PURE__ */ jsxs(Fragment, { children: [/* @__PURE__ */ jsxs("div", {
							className: "inline-flex items-center gap-1.5 text-[12.5px] text-muted",
							children: [/* @__PURE__ */ jsx(Loader2, {
								size: 13,
								className: "animate-spin motion-reduce:animate-none"
							}), i18nT("apps.codeReviewSage.components.addReposModal.reading_your_repos_from_github")]
						}), /* @__PURE__ */ jsx(ListSkeleton, { count: 5 })] }),
						pinnedRepos.length > 0 && /* @__PURE__ */ jsxs(Fragment, { children: [/* @__PURE__ */ jsx(SectionHead, {
							title: i18nT("apps.codeReviewSage.components.addReposModal.your_repos"),
							hint: i18nT("apps.codeReviewSage.components.addReposModal.pinned_to_the_sidebar")
						}), /* @__PURE__ */ jsx("ul", {
							className: "flex flex-col gap-1.5 list-none p-0 m-0",
							children: pinnedRepos.map((r) => /* @__PURE__ */ jsxs("li", {
								className: "flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2",
								children: [/* @__PURE__ */ jsxs("span", {
									className: "flex-1 min-w-0 truncate text-[13px] text-text",
									children: [
										r.owner,
										"/",
										/* @__PURE__ */ jsx("span", {
											className: "font-medium",
											children: r.repo
										})
									]
								}), /* @__PURE__ */ jsxs("button", {
									type: "button",
									onClick: () => unpinRepo(r.owner, r.repo),
									"aria-label": i18nT("apps.codeReviewSage.components.addReposModal.remove_repo", { repo: `${r.owner}/${r.repo}` }),
									className: "flex-shrink-0 inline-flex items-center gap-1 rounded-md px-1.5 py-1 bg-transparent text-[12px] text-muted hover:text-danger cursor-pointer",
									children: [/* @__PURE__ */ jsx(Trash2, {
										size: 12,
										"aria-hidden": "true"
									}), i18nT("apps.codeReviewSage.components.addReposModal.remove")]
								})]
							}, `${r.owner}/${r.repo}`))
						})] }),
						!loading && !setupRequired && /* @__PURE__ */ jsxs(Fragment, { children: [
							recentRows.length > 0 && /* @__PURE__ */ jsxs(Fragment, { children: [/* @__PURE__ */ jsx(SectionHead, {
								title: i18nT("apps.codeReviewSage.components.addReposModal.recently_worked_on"),
								hint: i18nT("apps.codeReviewSage.components.addReposModal.based_on_recent_github_activity")
							}), /* @__PURE__ */ jsx("ul", {
								className: "flex flex-col gap-1.5 list-none p-0 m-0",
								children: recentRows.map((r) => /* @__PURE__ */ jsx(RepoRow, {
									fullName: r.full_name,
									meta: i18nT("apps.codeReviewSage.components.addReposModal.contributed_events", {
										age: relativeAge(r.last_contributed_at),
										count: r.contribution_count
									}),
									pinned: isPinned(r.full_name),
									onPin: () => pinRepo(r.owner, r.repo)
								}, r.full_name))
							})] }),
							mineRows.length > 0 && /* @__PURE__ */ jsxs(Fragment, { children: [/* @__PURE__ */ jsx(SectionHead, {
								title: i18nT("apps.codeReviewSage.components.addReposModal.all_your_repos"),
								hint: mine?.truncated ? i18nT("apps.codeReviewSage.components.addReposModal.newest_100_by_push_date") : void 0
							}), /* @__PURE__ */ jsx("ul", {
								className: "flex flex-col gap-1.5 list-none p-0 m-0",
								children: mineRows.map((r) => /* @__PURE__ */ jsx(RepoRow, {
									fullName: r.full_name,
									meta: r.pushed_at ? i18nT("apps.codeReviewSage.components.addReposModal.pushed_age", { age: relativeAge(r.pushed_at) }) : void 0,
									pinned: isPinned(r.full_name),
									onPin: () => pinRepo(r.owner, r.repo),
									badges: /* @__PURE__ */ jsxs("span", {
										className: "flex-shrink-0 inline-flex items-center gap-1.5",
										children: [
											r.private && /* @__PURE__ */ jsxs("span", {
												title: i18nT("apps.codeReviewSage.components.addReposModal.private"),
												className: "inline-flex items-center text-muted",
												children: [/* @__PURE__ */ jsx(Lock, {
													size: 11,
													"aria-hidden": "true"
												}), /* @__PURE__ */ jsx("span", {
													className: "sr-only",
													children: i18nT("apps.codeReviewSage.components.addReposModal.private")
												})]
											}),
											r.archived && /* @__PURE__ */ jsx("span", {
												className: "text-[10.5px] px-1.5 py-0.5 rounded-full bg-bg-elevated border border-border text-muted",
												children: i18nT("apps.codeReviewSage.components.addReposModal.archived")
											}),
											!r.can_push && /* @__PURE__ */ jsx("span", {
												title: i18nT("apps.codeReviewSage.components.addReposModal.read_only_access"),
												className: "text-[10.5px] px-1.5 py-0.5 rounded-full bg-bg-elevated border border-border text-muted",
												children: i18nT("apps.codeReviewSage.components.addReposModal.read_only")
											})
										]
									})
								}, r.full_name))
							})] }),
							recentRows.length === 0 && mineRows.length === 0 && /* @__PURE__ */ jsx(EmptyState, {
								icon: Star,
								title: q ? i18nT("apps.codeReviewSage.components.addReposModal.no_repos_match_filter") : i18nT("apps.codeReviewSage.components.addReposModal.no_repos_for_account"),
								hint: i18nT("apps.codeReviewSage.components.addReposModal.add_one_by_url_above")
							}),
							(mine?.truncated || recent?.truncated) && /* @__PURE__ */ jsx("div", {
								className: "text-[11.5px] text-muted opacity-80 leading-[1.5] mt-1",
								children: i18nT("apps.codeReviewSage.components.addReposModal.these_lists_are_capped_so_a_repo_you_have_not_to")
							})
						] })
					]
				})
			]
		})]
	}) });
}
// src/host/useRovingTabs.ts
/**
* The keyboard half of a tablist, for a rail that draws its own tabs: arrows move
* the selection (and focus) to the next enabled tab, Home/End to the first and
* last, and only the selected tab is in the tab order. The dashboard's
* `components/Tablist.useRovingTabs`, without the animated indicator that
* component draws (which this app never used).
*/
function nextEnabledIndex(tabs, from, dir) {
	const n = tabs.length;
	for (let step = 1; step <= n; step += 1) {
		const i = (from + dir * step + n * (step + 1)) % n;
		if (!tabs[i]?.disabled) return i;
	}
	return from;
}
function edgeEnabledIndex(tabs, edge) {
	const order = edge === "first" ? tabs.map((_, i) => i) : tabs.map((_, i) => tabs.length - 1 - i);
	for (const i of order) if (!tabs[i]?.disabled) return i;
	return 0;
}
function useRovingTabs(tabs, value, onChange, orientation = "horizontal") {
	const refs = useRef([]);
	const vertical = orientation === "vertical";
	const move = (to) => {
		const tab = tabs[to];
		if (!tab || tab.disabled) return;
		if (tab.key !== value) onChange(tab.key);
		refs.current[to]?.focus();
	};
	return (i) => ({
		ref: (el) => {
			refs.current[i] = el;
		},
		tabIndex: tabs[i]?.key === value ? 0 : -1,
		onKeyDown: (e) => {
			const forward = vertical ? e.key === "ArrowDown" : e.key === "ArrowRight";
			const back = vertical ? e.key === "ArrowUp" : e.key === "ArrowLeft";
			const to = forward ? nextEnabledIndex(tabs, i, 1) : back ? nextEnabledIndex(tabs, i, -1) : e.key === "Home" ? edgeEnabledIndex(tabs, "first") : e.key === "End" ? edgeEnabledIndex(tabs, "last") : null;
			if (to === null) return;
			e.preventDefault();
			move(to);
		}
	});
}
// src/host/DropdownMenu.tsx
/**
* A small menu with the dashboard's `components/ui/dropdown-menu` API and classes.
*
* The dashboard's menu is Radix, which the host does not hand to an app bundle,
* and a bundle that carried its own copy would ship a second React-coupled
* library. This is the part of it the page uses: a trigger (`asChild`), content
* aligned to the trigger's start or end edge, items with `onSelect` (an item whose
* handler calls `event.preventDefault()` keeps the menu open, as Radix does),
* labels and separators. The menu opens on a press, Enter, Space or ArrowDown, moves
* between items with the arrow keys and Home/End, and closes on Escape, a press
* outside it or a selection, returning focus to the trigger.
*/
var MenuContext = createContext(null);
function useMenu() {
	const menu = useContext(MenuContext);
	if (!menu) throw new Error("DropdownMenu parts must sit inside <DropdownMenu>");
	return menu;
}
function DropdownMenu({ children }) {
	const [open, setOpenState] = useState(false);
	const triggerRef = useRef(null);
	const contentId = useId();
	const setOpen = useCallback((next) => {
		setOpenState(next);
		if (!next) triggerRef.current?.focus({ preventScroll: true });
	}, []);
	return /* @__PURE__ */ jsx(MenuContext.Provider, {
		value: {
			open,
			setOpen,
			triggerRef,
			contentId
		},
		children
	});
}
function DropdownMenuTrigger({ children }) {
	const { open, setOpen, triggerRef, contentId } = useMenu();
	const child = Children.only(children);
	if (!isValidElement(child)) return null;
	const element = child;
	return cloneElement(element, {
		ref: (el) => {
			triggerRef.current = el;
		},
		"aria-haspopup": "menu",
		"aria-expanded": open,
		"aria-controls": open ? contentId : void 0,
		"data-state": open ? "open" : "closed",
		onPointerDown: (e) => {
			element.props.onPointerDown?.(e);
			if (e.defaultPrevented || element.props.disabled) return;
			if (e.button !== 0 || e.ctrlKey) return;
			if (!open) e.preventDefault();
			setOpen(!open);
		},
		onKeyDown: (e) => {
			element.props.onKeyDown?.(e);
			if (e.defaultPrevented || element.props.disabled) return;
			if (e.key === "Enter" || e.key === " ") {
				e.preventDefault();
				setOpen(!open);
			} else if (e.key === "ArrowDown") {
				e.preventDefault();
				setOpen(true);
			}
		}
	});
}
var ITEM_SELECTOR = "[role=\"menuitem\"]:not([aria-disabled=\"true\"])";
function DropdownMenuContent({ children, align = "start", sideOffset = 4, className }) {
	const { open, setOpen, triggerRef, contentId } = useMenu();
	const contentRef = useRef(null);
	const [style, setStyle] = useState({
		position: "fixed",
		visibility: "hidden"
	});
	useLayoutEffect(() => {
		if (!open) return;
		const place = () => {
			const rect = triggerRef.current?.getBoundingClientRect();
			if (!rect) return;
			const top = rect.bottom + sideOffset;
			setStyle({
				position: "fixed",
				top,
				maxHeight: Math.max(120, window.innerHeight - top - 8),
				...align === "end" ? { right: Math.max(8, window.innerWidth - rect.right) } : { left: Math.max(8, rect.left) }
			});
		};
		place();
		window.addEventListener("resize", place);
		window.addEventListener("scroll", place, true);
		return () => {
			window.removeEventListener("resize", place);
			window.removeEventListener("scroll", place, true);
		};
	}, [
		open,
		align,
		sideOffset,
		triggerRef
	]);
	useEffect(() => {
		if (!open) return;
		contentRef.current?.querySelector(ITEM_SELECTOR)?.focus({ preventScroll: true });
		const onPointerDown = (e) => {
			const target = e.target;
			if (contentRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
			setOpen(false);
		};
		document.addEventListener("pointerdown", onPointerDown, true);
		return () => document.removeEventListener("pointerdown", onPointerDown, true);
	}, [
		open,
		setOpen,
		triggerRef
	]);
	if (!open) return null;
	const onKeyDown = (e) => {
		if (e.key === "Escape") {
			e.preventDefault();
			e.stopPropagation();
			setOpen(false);
			return;
		}
		if (e.key === "Tab") {
			setOpen(false);
			return;
		}
		const items = Array.from(contentRef.current?.querySelectorAll(ITEM_SELECTOR) ?? []);
		if (!items.length) return;
		const at = items.indexOf(document.activeElement);
		const to = e.key === "ArrowDown" ? (at + 1) % items.length : e.key === "ArrowUp" ? at <= 0 ? items.length - 1 : at - 1 : e.key === "Home" ? 0 : e.key === "End" ? items.length - 1 : null;
		if (to === null) return;
		e.preventDefault();
		items[to].focus();
	};
	return createPortal(/* @__PURE__ */ jsx("div", {
		ref: contentRef,
		id: contentId,
		role: "menu",
		tabIndex: -1,
		"data-state": "open",
		onKeyDown,
		style,
		className: cn("z-[9999] min-w-[8rem] overflow-y-auto overscroll-contain rounded-lg border border-border bg-bg-elevated p-1 text-text shadow-lg", className),
		children
	}), document.body);
}
function DropdownMenuItem({ children, onSelect, disabled = false, className }) {
	const { setOpen } = useMenu();
	const select = () => {
		if (disabled) return;
		const event = {
			defaultPrevented: false,
			preventDefault() {
				this.defaultPrevented = true;
			}
		};
		onSelect?.(event);
		if (!event.defaultPrevented) setOpen(false);
	};
	return /* @__PURE__ */ jsx("div", {
		role: "menuitem",
		tabIndex: -1,
		"aria-disabled": disabled || void 0,
		"data-disabled": disabled ? "" : void 0,
		onClick: select,
		onKeyDown: (e) => {
			if (e.key === "Enter" || e.key === " ") {
				e.preventDefault();
				select();
			}
		},
		className: cn("relative flex cursor-pointer select-none items-center gap-2 rounded-md px-3 py-1.5 text-[13px] outline-hidden transition-colors", "hover:bg-bg-hover focus:bg-bg-hover data-[disabled]:pointer-events-none data-[disabled]:opacity-50", className),
		children
	});
}
function DropdownMenuLabel({ children, className }) {
	return /* @__PURE__ */ jsx("div", {
		className: cn("px-3 py-1.5 text-[12px] font-semibold text-muted", className),
		children
	});
}
function DropdownMenuSeparator({ className }) {
	return /* @__PURE__ */ jsx("div", {
		role: "separator",
		className: cn("mx-1 my-1 h-px bg-border", className)
	});
}
// src/components/PrPickList.tsx
/** Reviewing / reviewed / stale / new, as a single honest chip. `reviewing`
*  outranks the rest: it is what is happening to this PR right now. */
function PrStateChip({ pr, reviewing, queued }) {
	if (reviewing) return /* @__PURE__ */ jsxs("span", {
		title: i18nT("apps.codeReviewSage.components.prPickList.a_review_of_this_pull_request_is_running"),
		className: "inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-accent-subtle text-accent whitespace-nowrap",
		children: [/* @__PURE__ */ jsx(Loader2, {
			size: 9,
			className: "animate-spin motion-reduce:animate-none",
			"aria-hidden": "true"
		}), i18nT("apps.codeReviewSage.components.prPickList.reviewing")]
	});
	if (pr.reviewed) return /* @__PURE__ */ jsx("span", {
		title: pr.reviewed_at ? i18nT("apps.codeReviewSage.components.prPickList.reviewed_age", { age: relativeAge(pr.reviewed_at) }) : i18nT("apps.codeReviewSage.components.prPickList.already_reviewed"),
		className: "inline-flex items-center text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-ok-subtle text-ok-text whitespace-nowrap",
		children: i18nT("apps.codeReviewSage.components.prPickList.reviewed")
	});
	if (queued) return null;
	if (pr.reviewed_stale) return /* @__PURE__ */ jsx("span", {
		title: i18nT("apps.codeReviewSage.components.prPickList.reviewed_before_the_head_commit_has_moved_since"),
		className: "inline-flex items-center text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-bg-elevated text-warn border border-border whitespace-nowrap",
		children: i18nT("apps.codeReviewSage.components.prPickList.updated")
	});
	return /* @__PURE__ */ jsx("span", {
		className: "inline-flex items-center text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-accent-subtle text-accent whitespace-nowrap",
		children: i18nT("apps.codeReviewSage.components.prPickList.new")
	});
}
/** The pasted-links escape hatch: a PR you were sent isn't necessarily in a repo
*  you have added. Collapsed by default so it doesn't compete with the list. */
function PasteLinks() {
	const { startReviewLinks } = useSage();
	const [open, setOpen] = useState(false);
	const [text, setText] = useState("");
	const busy = startReviewLinks.isPending;
	if (!open) return /* @__PURE__ */ jsxs("button", {
		onClick: () => setOpen(true),
		className: "inline-flex items-center gap-1.5 text-[11.5px] text-muted bg-transparent hover:text-accent cursor-pointer self-start",
		children: [
			/* @__PURE__ */ jsx(ClipboardPaste, { size: 12 }),
			" ",
			i18nT("apps.codeReviewSage.components.prPickList.paste_pr_links_instead")
		]
	});
	return /* @__PURE__ */ jsxs("div", {
		className: "flex flex-col gap-1.5",
		children: [
			/* @__PURE__ */ jsxs("label", {
				htmlFor: "sage-paste-links",
				className: "text-[11.5px] font-semibold text-muted",
				children: [i18nT("apps.codeReviewSage.components.prPickList.paste_pr_links"), /* @__PURE__ */ jsx("textarea", {
					id: "sage-paste-links",
					rows: 3,
					value: text,
					onChange: (e) => setText(e.target.value),
					"aria-label": i18nT("apps.codeReviewSage.components.prPickList.paste_pr_links"),
					placeholder: i18nT("apps.codeReviewSage.components.prPickList.one_or_more_github_pr_links"),
					className: "mt-1 w-full rounded-lg border border-border bg-bg-elevated px-2 py-1.5 text-[12px] font-mono font-normal text-text outline-hidden focus-visible:border-accent resize-y block"
				})]
			}),
			/* @__PURE__ */ jsxs("div", {
				className: "flex items-center gap-2",
				children: [/* @__PURE__ */ jsxs("button", {
					onClick: () => startReviewLinks.mutate(text.trim()),
					disabled: busy || !text.trim(),
					className: "inline-flex items-center gap-1.5 rounded-md bg-accent text-accent-fg px-2.5 py-1 text-[12px] font-medium border-none cursor-pointer hover:bg-accent-hover disabled:opacity-40 disabled:cursor-default transition-colors",
					children: [busy ? /* @__PURE__ */ jsx(Loader2, {
						size: 12,
						className: "animate-spin motion-reduce:animate-none"
					}) : /* @__PURE__ */ jsx(Link2, { size: 12 }), i18nT("apps.codeReviewSage.components.prPickList.review_these")]
				}), /* @__PURE__ */ jsx("button", {
					onClick: () => {
						setOpen(false);
						setText("");
					},
					className: "text-[11.5px] text-muted bg-transparent hover:text-text cursor-pointer",
					children: i18nT("apps.codeReviewSage.components.prPickList.cancel")
				})]
			}),
			startReviewLinks.error && /* @__PURE__ */ jsx(ErrorNotice, {
				message: startReviewLinks.error.message,
				variant: "inline"
			})
		]
	});
}
function PrPickList({ source }) {
	const sage = useSage();
	const { startReview, startRepoReview, openAddRepos, selectedPr, selectPr, reviewingChangeUrls } = sage;
	const activeRepo = source ? null : sage.activeRepo;
	const { prs, loading: prsLoading, error: prsError, refresh: refreshPrs } = source ?? {
		prs: sage.prs,
		loading: sage.prsLoading,
		error: sage.prsError,
		refresh: sage.refreshPrs
	};
	const [picked, setPicked] = useState(/* @__PURE__ */ new Set());
	const [query, setQuery] = useState("");
	const [labelFilter, setLabelFilter] = useState(/* @__PURE__ */ new Set());
	const textMatched = useMemo(() => {
		const q = query.trim().toLowerCase();
		if (!q) return prs;
		return prs.filter((p) => p.title.toLowerCase().includes(q) || String(p.number).includes(q) || (p.author ?? "").toLowerCase().includes(q) || (p.repo ?? "").toLowerCase().includes(q));
	}, [prs, query]);
	const labelUniverse = useMemo(() => {
		const counts = /* @__PURE__ */ new Map();
		for (const p of prs) for (const l of p.labels ?? []) counts.set(l, 0);
		for (const p of textMatched) for (const l of p.labels ?? []) counts.set(l, (counts.get(l) ?? 0) + 1);
		return [...counts.entries()].map(([name, count]) => ({
			name,
			count
		})).sort((a, b) => {
			const sa = labelFilter.has(a.name) ? 0 : 1;
			const sb = labelFilter.has(b.name) ? 0 : 1;
			if (sa !== sb) return sa - sb;
			return compareText(a.name, b.name);
		});
	}, [
		prs,
		textMatched,
		labelFilter
	]);
	const activeLabels = useMemo(() => {
		const present = new Set(labelUniverse.map((l) => l.name));
		return new Set([...labelFilter].filter((l) => present.has(l)));
	}, [labelFilter, labelUniverse]);
	const filtered = useMemo(() => {
		if (activeLabels.size === 0) return textMatched;
		return textMatched.filter((p) => (p.labels ?? []).some((l) => activeLabels.has(l)));
	}, [textMatched, activeLabels]);
	const toggleLabel = (name) => setLabelFilter((cur) => {
		const next = new Set(cur);
		if (next.has(name)) next.delete(name);
		else next.add(name);
		return next;
	});
	const unreviewed = prs.filter((p) => !p.reviewed && !reviewingChangeUrls.has(changeKey(p.url))).length;
	const busy = startReview.isPending || startRepoReview.isPending;
	const repoKey = activeRepo ? repoSlug(activeRepo) : "";
	const [lastRepoKey, setLastRepoKey] = useState(repoKey);
	const [confirmingAll, setConfirmingAll] = useState(false);
	if (repoKey !== lastRepoKey) {
		setLastRepoKey(repoKey);
		if (picked.size) setPicked(/* @__PURE__ */ new Set());
		if (labelFilter.size) setLabelFilter(/* @__PURE__ */ new Set());
		if (confirmingAll) setConfirmingAll(false);
	}
	const toggle = (url) => setPicked((cur) => {
		const next = new Set(cur);
		if (next.has(url)) next.delete(url);
		else next.add(url);
		return next;
	});
	if (!activeRepo && !source) return /* @__PURE__ */ jsx("div", {
		className: "flex flex-col min-h-0 h-full",
		children: /* @__PURE__ */ jsx(EmptyState, {
			icon: GitPullRequest,
			title: i18nT("apps.codeReviewSage.components.prPickList.pick_a_repo_to_see_its_pull_requests"),
			hint: i18nT("apps.codeReviewSage.components.prPickList.repos_live_in_the_sidebar"),
			children: /* @__PURE__ */ jsx("button", {
				type: "button",
				onClick: openAddRepos,
				className: "inline-flex items-center gap-1.5 rounded-lg border border-accent bg-accent-subtle px-3 py-1.5 text-[12px] font-medium text-accent cursor-pointer transition-colors",
				children: i18nT("apps.codeReviewSage.components.prPickList.add_a_repo")
			})
		})
	});
	return /* @__PURE__ */ jsxs("div", {
		className: "flex flex-col min-h-0 h-full",
		children: [/* @__PURE__ */ jsxs("div", {
			className: "px-2 pt-2 pb-1.5 flex-shrink-0 flex flex-col gap-2",
			children: [
				/* @__PURE__ */ jsxs("div", {
					className: "flex items-center gap-1.5",
					children: [
						/* @__PURE__ */ jsxs("div", {
							className: "flex items-center gap-1.5 rounded-lg border border-border bg-card px-2 flex-1 min-w-0 transition-colors focus-within:border-accent",
							children: [/* @__PURE__ */ jsx(Search, {
								size: 13,
								className: "text-muted flex-shrink-0",
								"aria-hidden": "true"
							}), /* @__PURE__ */ jsx("input", {
								value: query,
								onChange: (e) => setQuery(e.target.value),
								"aria-label": i18nT("apps.codeReviewSage.components.prPickList.filter_pull_requests"),
								placeholder: source ? i18nT("apps.codeReviewSage.components.reviewQueue.filter_by_repo") : i18nT("apps.codeReviewSage.components.prPickList.filter_pull_requests"),
								className: "flex-1 min-w-0 bg-transparent border-0 py-1.5 text-[12.5px] text-text outline-hidden"
							})]
						}),
						labelUniverse.length > 0 && /* @__PURE__ */ jsxs(DropdownMenu, { children: [/* @__PURE__ */ jsx(DropdownMenuTrigger, {
							asChild: true,
							children: /* @__PURE__ */ jsxs("button", {
								type: "button",
								"aria-label": i18nT("apps.issueRadar.components.prDetail.labels"),
								className: "inline-flex items-center gap-1 rounded-lg border px-2 py-1.5 text-[12px] font-medium cursor-pointer transition-colors flex-shrink-0 max-w-[45%] focus:outline-hidden focus-visible:border-accent " + (activeLabels.size > 0 ? "bg-accent-subtle text-accent border-accent" : "bg-card text-muted border-border hover:text-text"),
								children: [
									/* @__PURE__ */ jsx(Tag, {
										size: 12,
										className: "flex-shrink-0",
										"aria-hidden": "true"
									}),
									/* @__PURE__ */ jsx("span", {
										className: "truncate",
										title: [...activeLabels].join(", "),
										children: activeLabels.size > 0 ? [...activeLabels].join(", ") : i18nT("apps.issueRadar.components.prDetail.labels")
									}),
									/* @__PURE__ */ jsx(ChevronDown, {
										size: 13,
										className: "flex-shrink-0 opacity-70"
									})
								]
							})
						}), /* @__PURE__ */ jsx(DropdownMenuContent, {
							align: "end",
							side: "bottom",
							sideOffset: 6,
							className: "w-[260px]",
							children: labelUniverse.map(({ name, count }) => /* @__PURE__ */ jsxs(DropdownMenuItem, {
								onSelect: (e) => {
									e.preventDefault();
									toggleLabel(name);
								},
								children: [
									/* @__PURE__ */ jsx("span", {
										className: "flex-1 min-w-0 truncate",
										title: name,
										children: name
									}),
									/* @__PURE__ */ jsx("span", {
										className: "tabular-nums text-muted flex-shrink-0",
										children: count
									}),
									labelFilter.has(name) && /* @__PURE__ */ jsx(Check, {
										size: 13,
										className: "text-accent flex-shrink-0"
									})
								]
							}, name))
						})] }),
						/* @__PURE__ */ jsx("button", {
							onClick: refreshPrs,
							disabled: prsLoading,
							title: i18nT("apps.codeReviewSage.components.prPickList.re_read_open_prs_from_github"),
							"aria-label": i18nT("apps.codeReviewSage.components.prPickList.refresh_pull_requests"),
							className: "inline-flex items-center p-1.5 bg-transparent text-muted hover:text-text disabled:opacity-40 cursor-pointer flex-shrink-0",
							children: /* @__PURE__ */ jsx(RefreshCw, {
								size: 13,
								className: prsLoading ? "animate-spin motion-reduce:animate-none" : ""
							})
						})
					]
				}),
				/* @__PURE__ */ jsxs("div", {
					className: "flex items-center gap-1.5",
					children: [/* @__PURE__ */ jsxs("button", {
						onClick: () => startReview.mutate([...picked]),
						disabled: busy || picked.size === 0,
						className: "flex-1 inline-flex items-center justify-center gap-1.5 rounded-md bg-accent text-accent-fg px-2 py-1.5 text-[12px] font-medium border-none cursor-pointer hover:bg-accent-hover disabled:opacity-40 disabled:cursor-default transition-colors",
						children: [busy ? /* @__PURE__ */ jsx(Loader2, {
							size: 12,
							className: "animate-spin motion-reduce:animate-none"
						}) : /* @__PURE__ */ jsx(ScanSearch, { size: 12 }), i18nT("apps.codeReviewSage.components.prPickList.review_selected_count", { count: picked.size })]
					}), source ? null : confirmingAll ? /* @__PURE__ */ jsxs(Fragment, { children: [
						/* @__PURE__ */ jsx("span", {
							className: "text-[12px] text-muted",
							children: i18nT("apps.codeReviewSage.components.prPickList.confirm_review_all", { count: unreviewed })
						}),
						/* @__PURE__ */ jsx("button", {
							type: "button",
							onClick: () => {
								setConfirmingAll(false);
								startRepoReview.mutate({
									repo: repoUrl(activeRepo),
									force: false
								});
							},
							className: "inline-flex items-center gap-1 rounded-md border border-accent bg-accent-subtle px-2 py-1.5 text-[12px] font-medium text-accent cursor-pointer hover:bg-accent/20 transition-colors flex-shrink-0",
							children: i18nT("apps.codeReviewSage.components.prPickList.review_these")
						}),
						/* @__PURE__ */ jsx("button", {
							type: "button",
							onClick: () => setConfirmingAll(false),
							className: "rounded-md bg-transparent px-1.5 py-1.5 text-[12px] text-muted hover:text-text cursor-pointer border-none flex-shrink-0",
							children: i18nT("apps.codeReviewSage.components.prPickList.cancel")
						})
					] }) : /* @__PURE__ */ jsx("button", {
						onClick: () => setConfirmingAll(true),
						disabled: busy || unreviewed === 0,
						title: i18nT("apps.codeReviewSage.components.prPickList.review_every_open_pr_not_yet_reviewed_at_its_cur"),
						className: "inline-flex items-center gap-1 rounded-md border border-border bg-transparent px-2 py-1.5 text-[12px] text-text cursor-pointer hover:bg-bg-hover disabled:opacity-40 disabled:cursor-default transition-colors flex-shrink-0",
						children: i18nT("apps.codeReviewSage.components.prPickList.review_all_count", { count: unreviewed })
					})]
				}),
				source ? /* @__PURE__ */ jsx("div", {
					className: "text-[11.5px] text-muted",
					children: source.note
				}) : /* @__PURE__ */ jsx(PasteLinks, {}),
				startRepoReview.data?.status === "noop" && /* @__PURE__ */ jsx("div", {
					className: "text-[11.5px] text-muted",
					children: startRepoReview.data?.message
				}),
				startReview.error && /* @__PURE__ */ jsx(ErrorNotice, {
					message: startReview.error.message,
					variant: "inline",
					askAgent: true
				}),
				startRepoReview.error && /* @__PURE__ */ jsx(ErrorNotice, {
					message: startRepoReview.error.message,
					variant: "inline",
					askAgent: true
				}),
				prsError && /* @__PURE__ */ jsx(ErrorNotice, {
					message: prsError.message,
					variant: "inline",
					askAgent: true
				})
			]
		}), /* @__PURE__ */ jsx("div", {
			className: "relative flex-1 min-h-0",
			children: /* @__PURE__ */ jsxs("div", {
				className: "absolute inset-0 overflow-y-auto scrollbar-none px-2 pb-2 flex flex-col gap-1.5",
				style: { scrollbarWidth: "none" },
				children: [
					prsLoading && /* @__PURE__ */ jsx(ListSkeleton, { count: 5 }),
					!prsLoading && filtered.length === 0 && !(source && prsError) && /* @__PURE__ */ jsx(EmptyState, {
						icon: GitPullRequest,
						title: query.trim() ? i18nT("apps.codeReviewSage.components.prPickList.no_prs_match_filter") : source?.emptyTitle ?? i18nT("apps.codeReviewSage.components.prPickList.no_open_prs_here")
					}),
					!prsLoading && filtered.map((pr) => {
						const reviewing = reviewingChangeUrls.has(changeKey(pr.url));
						const on = picked.has(pr.url) && !reviewing;
						const isOpen = selectedPr?.url === pr.url;
						const inputId = `sage-pr-${pr.number}`;
						return /* @__PURE__ */ jsxs("div", {
							className: `flex items-start gap-2 rounded-lg border px-2.5 py-2 transition-colors ${isOpen ? "border-accent bg-accent-subtle" : on ? "border-accent/50 bg-card" : "border-border bg-card hover:bg-bg-hover"}`,
							children: [/* @__PURE__ */ jsx("input", {
								id: inputId,
								type: "checkbox",
								checked: on,
								disabled: reviewing,
								onChange: () => toggle(pr.url),
								"aria-label": reviewing ? i18nT("apps.codeReviewSage.components.prPickList.pr_already_being_reviewed", { number: pr.number }) : i18nT("apps.codeReviewSage.components.prPickList.review_pr", {
									number: pr.number,
									title: pr.title
								}),
								className: `mt-1 flex-shrink-0 ${reviewing ? "cursor-not-allowed opacity-40" : "cursor-pointer"}`,
								style: { accentColor: "var(--accent)" }
							}), /* @__PURE__ */ jsxs("button", {
								type: "button",
								onClick: () => selectPr(pr),
								"aria-current": isOpen ? "true" : void 0,
								"aria-label": i18nT("apps.codeReviewSage.components.prPickList.open_pr", {
									number: pr.number,
									title: pr.title
								}),
								className: "flex-1 min-w-0 text-left bg-transparent cursor-pointer",
								children: [
									/* @__PURE__ */ jsxs("span", {
										className: "flex items-center gap-1.5 text-[11.5px] text-muted",
										children: [
											pr.repo && /* @__PURE__ */ jsx("span", {
												className: "truncate",
												children: pr.repo
											}),
											/* @__PURE__ */ jsxs("span", {
												className: "font-bold text-accent",
												children: ["#", pr.number]
											}),
											pr.author && /* @__PURE__ */ jsxs("span", {
												className: "truncate",
												children: ["· ", pr.author]
											}),
											pr.draft && /* @__PURE__ */ jsx("span", {
												className: "px-1 py-0.5 rounded-full bg-bg-elevated border border-border text-[10px]",
												children: i18nT("apps.codeReviewSage.components.prPickList.draft")
											}),
											/* @__PURE__ */ jsx("span", {
												className: "ml-auto flex-shrink-0",
												children: relativeAge(pr.updated_at)
											})
										]
									}),
									/* @__PURE__ */ jsx("span", {
										className: "block text-[13px] leading-snug text-text mt-0.5 line-clamp-2",
										children: pr.title
									}),
									/* @__PURE__ */ jsx("span", {
										className: "block mt-1",
										children: /* @__PURE__ */ jsx(PrStateChip, {
											pr,
											reviewing,
											queued: !!source
										})
									})
								]
							})]
						}, pr.url);
					})
				]
			})
		})]
	});
}
// src/components/RunStatusPill.tsx
/** Per-status pill metadata. Class strings are static (not interpolated) so
* Tailwind's content scan keeps them.
*
* The label is held as a KEY, not a translated string: this table is
* module-level, so it evaluates once at import time — before any language
* switch — and a resolved string here would freeze the first locale for the
* process. The key is resolved per render instead. */
/** Label keys as full literals in one indexable map, so the key-resolution
*  gate can verify each one exists. Indexed at the call site, not read off a
*  local — that indirection is what made these sites unverifiable. */
var STATUS_LABEL_KEY = {
	running: "apps.codeReviewSage.components.runStatusPill.running",
	done: "apps.codeReviewSage.components.runStatusPill.done",
	error: "apps.codeReviewSage.components.runStatusPill.error",
	cancelled: "apps.codeReviewSage.components.runStatusPill.cancelled",
	interrupted: "apps.codeReviewSage.components.runStatusPill.interrupted",
	cancelling: "apps.codeReviewSage.components.runStatusPill.cancelling"
};
var STATUS_META = {
	running: {
		cls: "bg-accent-subtle text-accent border-accent",
		dot: "bg-accent",
		pulse: true
	},
	done: {
		cls: "bg-ok-subtle text-ok-text border-ok",
		dot: "bg-ok"
	},
	error: {
		cls: "bg-danger-subtle text-danger-text border-danger",
		dot: "bg-danger"
	},
	cancelled: {
		cls: "bg-card text-muted border-border",
		dot: "bg-muted"
	},
	interrupted: {
		cls: "bg-warn-subtle text-warn-text border-warn",
		dot: "bg-warn"
	}
};
/** The muted "Cancelling" treatment shown when a running run has a cancel
* pending — deliberately NOT accent, so it reads as winding down. */
var CANCELLING_META = {
	cls: "bg-warn-subtle text-warn-text border-warn",
	dot: "bg-warn"
};
function RunStatusPill({ status, cancelRequested = false }) {
	const cancelling = cancelRequested && status === "running";
	const meta = cancelling ? CANCELLING_META : STATUS_META[status];
	const pulse = !cancelling && "pulse" in meta && meta.pulse;
	return /* @__PURE__ */ jsxs("span", {
		className: `inline-flex flex-shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium ${meta.cls}`,
		children: [/* @__PURE__ */ jsx("span", {
			className: `h-1.5 w-1.5 flex-shrink-0 rounded-full ${meta.dot} ` + (pulse ? "animate-pulse motion-reduce:animate-none" : ""),
			"aria-hidden": "true"
		}), cancelling ? i18nT(STATUS_LABEL_KEY.cancelling) : i18nT(STATUS_LABEL_KEY[status])]
	});
}
// src/components/RunCard.tsx
/** Selected-state card shell, matching PrList: accent border when selected,
* else the resting border. */
function cardClass(selected) {
	return "w-full text-left rounded-lg border p-2.5 cursor-pointer bg-card hover:bg-bg-hover transition-colors focus-ring-accent " + (selected ? "border-accent" : "border-border");
}
/** The red / yellow counts a finished run folded into its summary. Zero-count
* bands are omitted so a clean run stays quiet; nothing renders when the summary
* has no report yet. */
function BandCounts({ run }) {
	const bands = run.summary?.report?.bands;
	if (!bands) return null;
	const { red, yellow } = bands;
	if (!red && !yellow) return /* @__PURE__ */ jsx("span", {
		className: "text-[11px] text-ok",
		children: i18nT("apps.codeReviewSage.components.runCard.clean")
	});
	return /* @__PURE__ */ jsxs("span", {
		className: "inline-flex items-center gap-2 text-[11px] tabular-nums transition-[padding] group-hover:pr-6",
		children: [red > 0 && /* @__PURE__ */ jsxs("span", {
			className: "inline-flex items-center gap-1 text-danger",
			title: i18nT("apps.codeReviewSage.components.runCard.needs_review_count", { count: red }),
			children: [/* @__PURE__ */ jsx("span", {
				className: "h-1.5 w-1.5 rounded-full bg-danger",
				"aria-hidden": "true"
			}), red]
		}), yellow > 0 && /* @__PURE__ */ jsxs("span", {
			className: "inline-flex items-center gap-1 text-warn",
			title: i18nT("apps.codeReviewSage.components.runCard.worth_a_glance_count", { count: yellow }),
			children: [/* @__PURE__ */ jsx("span", {
				className: "h-1.5 w-1.5 rounded-full bg-warn",
				"aria-hidden": "true"
			}), yellow]
		})]
	});
}
function RunCard({ run, selected, onSelect, onDelete, deleting = false }) {
	const { label, more } = runIdentity(run.repo, run.changes);
	const finished = Boolean(run.finished_at);
	const age = relativeAge(run.finished_at || run.started_at);
	const failure = failureReason(run);
	const [confirming, setConfirming] = useState(false);
	return /* @__PURE__ */ jsxs("div", {
		className: "group relative",
		children: [
			/* @__PURE__ */ jsxs("button", {
				type: "button",
				onClick: onSelect,
				"aria-current": selected,
				"aria-label": more > 0 ? i18nT("apps.codeReviewSage.components.runCard.review_of_with_more", {
					label: label || i18nT("apps.codeReviewSage.components.runCard.pull_requests"),
					count: more
				}) : i18nT("apps.codeReviewSage.components.runCard.review_of", { label: label || i18nT("apps.codeReviewSage.components.runCard.pull_requests") }),
				className: cardClass(selected) + (onDelete ? " [@media(hover:none)]:pb-7" : ""),
				children: [
					/* @__PURE__ */ jsxs("div", {
						className: "flex items-center justify-between gap-2 mb-1",
						children: [/* @__PURE__ */ jsxs("span", {
							className: "inline-flex min-w-0 items-center gap-1.5 text-[13px] font-medium text-text",
							children: [
								/* @__PURE__ */ jsx(GitPullRequest, {
									size: 13,
									className: "flex-shrink-0 text-muted",
									"aria-hidden": "true"
								}),
								/* @__PURE__ */ jsx("span", {
									className: "truncate",
									children: label || i18nT("apps.codeReviewSage.components.runCard.review")
								}),
								more > 0 && /* @__PURE__ */ jsx("span", {
									className: "flex-shrink-0 text-muted",
									children: i18nT("apps.codeReviewSage.components.runCard.more_count", { count: more })
								})
							]
						}), /* @__PURE__ */ jsx(RunStatusPill, {
							status: effectiveRunStatus(run),
							cancelRequested: Boolean(run.cancel_requested_at)
						})]
					}),
					/* @__PURE__ */ jsxs("div", {
						className: "flex items-center justify-between gap-2 text-[12px] text-muted",
						children: [/* @__PURE__ */ jsx("span", {
							className: "tabular-nums",
							children: age
						}), finished && /* @__PURE__ */ jsx(BandCounts, { run })]
					}),
					failure && /* @__PURE__ */ jsx("div", {
						className: "mt-1 text-[11.5px] text-danger leading-[1.4] line-clamp-2",
						title: failure.raw || failure.text,
						children: failure.text
					})
				]
			}),
			onDelete && !confirming && /* @__PURE__ */ jsx("button", {
				type: "button",
				onClick: () => setConfirming(true),
				"aria-label": i18nT("apps.codeReviewSage.components.runCard.delete_review_of", { label: label || i18nT("apps.codeReviewSage.components.runCard.pull_requests") }),
				title: i18nT("apps.codeReviewSage.components.runCard.delete_this_review"),
				className: "absolute bottom-1.5 right-1.5 rounded-md bg-card/90 p-1 text-muted opacity-0 transition-opacity group-hover:opacity-100 [@media(hover:none)]:opacity-100 focus-visible:opacity-100 hover:text-danger cursor-pointer",
				children: /* @__PURE__ */ jsx(Trash2, { size: 12 })
			}),
			onDelete && confirming && /* @__PURE__ */ jsxs("div", {
				className: "absolute inset-x-1.5 bottom-1.5 flex items-center gap-1.5 rounded-md border border-danger bg-bg-elevated px-2 py-1 text-[11.5px]",
				children: [
					/* @__PURE__ */ jsx("span", {
						className: "flex-1 text-text",
						children: i18nT("apps.codeReviewSage.components.runCard.delete_this_review_2")
					}),
					/* @__PURE__ */ jsx("button", {
						type: "button",
						onClick: () => {
							setConfirming(false);
							onDelete();
						},
						disabled: deleting,
						className: "rounded bg-transparent px-1 text-danger font-medium hover:underline disabled:opacity-50 cursor-pointer",
						children: i18nT("apps.codeReviewSage.components.runCard.delete")
					}),
					/* @__PURE__ */ jsx("button", {
						type: "button",
						onClick: () => setConfirming(false),
						className: "rounded bg-transparent px-1 text-muted hover:text-text cursor-pointer",
						children: i18nT("apps.codeReviewSage.components.runCard.cancel")
					})
				]
			})
		]
	});
}
// src/components/RunList.tsx
function RunList({ runs, loading, error, selectedRunId, onSelect, onNewReview, onDelete, deleting = false, emptyTitle = "No reviews yet", emptyHint = "Pick a pull request to review." }) {
	const showEmpty = !loading && !error && runs.length === 0;
	return /* @__PURE__ */ jsxs("section", {
		className: "flex flex-col min-h-0 h-full",
		children: [onNewReview && /* @__PURE__ */ jsx("div", {
			className: "px-2 pt-2 pb-1.5 flex-shrink-0",
			children: /* @__PURE__ */ jsxs("button", {
				type: "button",
				onClick: onNewReview,
				className: "inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-[13px] font-medium text-text transition-colors hover:bg-bg-hover focus-ring-accent cursor-pointer",
				children: [/* @__PURE__ */ jsx(Plus, {
					size: 14,
					"aria-hidden": "true"
				}), i18nT("apps.codeReviewSage.components.runList.new_review")]
			})
		}), /* @__PURE__ */ jsx("div", {
			className: "relative flex-1 min-h-0",
			children: /* @__PURE__ */ jsxs("div", {
				className: "absolute inset-0 overflow-y-auto scrollbar-none px-2 pb-2 flex flex-col gap-2",
				style: { scrollbarWidth: "none" },
				children: [
					loading && /* @__PURE__ */ jsx(ListSkeleton, {}),
					error && /* @__PURE__ */ jsx(ErrorNotice, {
						message: error,
						askAgent: true,
						className: "mx-1 my-2"
					}),
					showEmpty && /* @__PURE__ */ jsx(EmptyState, {
						icon: ClipboardList,
						title: emptyTitle,
						hint: emptyHint
					}),
					!loading && !error && runs.map((run) => /* @__PURE__ */ jsx(RunCard, {
						run,
						selected: run.run_id === selectedRunId,
						onSelect: () => onSelect(run.run_id),
						onDelete: onDelete ? () => onDelete(run.run_id) : void 0,
						deleting
					}, run.run_id))
				]
			})
		})]
	});
}
// src/components/MiddleColumn.tsx
var LIST_TABS = [
	{ key: "pulls" },
	{ key: "reviews" },
	{ key: "queue" }
];
function Tab({ label, icon: Icon, active, badge, onClick, roving }) {
	return /* @__PURE__ */ jsxs("button", {
		type: "button",
		onClick,
		role: "tab",
		...roving,
		"aria-selected": active,
		className: `flex-auto min-w-0 whitespace-nowrap inline-flex items-center justify-center gap-1.5 px-2 py-1.5 text-[12px] font-medium rounded-md transition-colors cursor-pointer focus-ring-accent ${active ? "bg-bg-elevated text-text border border-border" : "bg-transparent text-muted border border-transparent hover:text-text"}`,
		children: [
			/* @__PURE__ */ jsx(Icon, {
				size: 13,
				"aria-hidden": "true",
				className: "flex-shrink-0"
			}),
			/* @__PURE__ */ jsx("span", {
				className: "min-w-0 truncate",
				title: label,
				children: label
			}),
			badge ? /* @__PURE__ */ jsxs("span", {
				className: "inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-accent-subtle text-accent",
				children: [/* @__PURE__ */ jsx("span", {
					"aria-hidden": "true",
					className: "w-1.5 h-1.5 rounded-full bg-accent animate-pulse motion-reduce:animate-none"
				}), badge]
			}) : null
		]
	});
}
/** Open PRs anywhere that request your review, fed into the same pick list.
*  Fetched on open and on refresh only: nothing polls. */
function ReviewQueue() {
	const q = useQuery({
		queryKey: ["code-review-sage", "review-queue"],
		queryFn: sageApi.reviewQueue,
		staleTime: Infinity,
		refetchOnMount: "always"
	});
	const setup = !q.error && !!q.data?.setup_required;
	return /* @__PURE__ */ jsxs("div", {
		className: "flex flex-col min-h-0 h-full",
		children: [setup && /* @__PURE__ */ jsx("div", {
			className: "px-2 pt-2 flex-shrink-0",
			children: /* @__PURE__ */ jsx(GhNotice, { bare: true })
		}), /* @__PURE__ */ jsx(PrPickList, { source: {
			prs: q.data?.prs ?? [],
			loading: q.isLoading,
			error: q.error,
			refresh: () => void q.refetch(),
			note: q.data?.truncated ? i18nT("apps.codeReviewSage.components.reviewQueue.starts_review_truncated") : i18nT("apps.codeReviewSage.components.reviewQueue.starts_review"),
			emptyTitle: setup ? i18nT("apps.codeReviewSage.components.reviewQueue.setup_required") : i18nT("apps.codeReviewSage.components.reviewQueue.empty")
		} })]
	});
}
function MiddleColumn() {
	const { runs, repoRuns, runsLoading, runsError, selectedRunId, selectRun, listTab, setListTab, activeRepo, setMainView, deleteRun, deleting } = useSage();
	const slug = activeRepo ? repoSlug(activeRepo) : null;
	const [allRepos, setAllRepos] = useState(false);
	const [lastSlug, setLastSlug] = useState(slug);
	if (slug !== lastSlug) {
		setLastSlug(slug);
		if (allRepos) setAllRepos(false);
	}
	const scoped = !!activeRepo && !allRepos;
	const shown = scoped ? repoRuns : runs;
	const hiddenByScope = scoped ? runs.length - repoRuns.length : 0;
	const live = runs.filter((r) => r.status === "running").length;
	const roving = useRovingTabs(LIST_TABS, listTab, setListTab);
	const open = (runId) => {
		setMainView("reviews");
		selectRun(runId);
	};
	return /* @__PURE__ */ jsxs("div", {
		className: "flex flex-col min-h-0 h-full",
		children: [/* @__PURE__ */ jsxs("div", {
			role: "tablist",
			"aria-label": slug ? i18nT("apps.codeReviewSage.components.middleColumn.repo_lists_label", { repo: slug }) : i18nT("apps.codeReviewSage.components.middleColumn.lists_label"),
			className: "flex items-center gap-1 px-2 pt-2 flex-shrink-0",
			children: [
				/* @__PURE__ */ jsx(Tab, {
					label: i18nT("apps.codeReviewSage.components.middleColumn.pull_requests"),
					icon: GitPullRequest,
					active: listTab === "pulls",
					onClick: () => setListTab("pulls"),
					roving: roving(0)
				}),
				/* @__PURE__ */ jsx(Tab, {
					label: i18nT("apps.codeReviewSage.components.middleColumn.reviews"),
					icon: ListChecks,
					active: listTab === "reviews",
					badge: live,
					onClick: () => setListTab("reviews"),
					roving: roving(1)
				}),
				/* @__PURE__ */ jsx(Tab, {
					label: i18nT("apps.codeReviewSage.components.reviewQueue.tab"),
					icon: Inbox,
					active: listTab === "queue",
					onClick: () => setListTab("queue"),
					roving: roving(2)
				})
			]
		}), /* @__PURE__ */ jsx("div", {
			className: "flex-1 min-h-0",
			children: listTab === "pulls" ? /* @__PURE__ */ jsx(PrPickList, {}) : listTab === "queue" ? /* @__PURE__ */ jsx(ReviewQueue, {}) : /* @__PURE__ */ jsxs("div", {
				className: "flex flex-col min-h-0 h-full",
				children: [(hiddenByScope > 0 || allRepos) && /* @__PURE__ */ jsxs("div", {
					className: "px-3 pt-2 flex items-center gap-1.5 text-[11px] text-muted flex-shrink-0",
					children: [/* @__PURE__ */ jsx("span", {
						className: "truncate",
						children: scoped ? i18nT("apps.codeReviewSage.components.middleColumn.this_repo_only", { repo: slug }) : i18nT("apps.codeReviewSage.components.middleColumn.all_repos")
					}), /* @__PURE__ */ jsx("button", {
						type: "button",
						onClick: () => setAllRepos((v) => !v),
						className: "ml-auto flex-shrink-0 bg-transparent text-accent hover:underline cursor-pointer p-0",
						children: scoped ? i18nT("apps.codeReviewSage.components.middleColumn.show_all_count", { count: runs.length }) : i18nT("apps.codeReviewSage.components.middleColumn.just_this_repo", { repo: slug })
					})]
				}), /* @__PURE__ */ jsx("div", {
					className: "flex-1 min-h-0",
					children: /* @__PURE__ */ jsx(RunList, {
						runs: shown,
						loading: runsLoading,
						error: runsError?.message ?? null,
						selectedRunId,
						onSelect: open,
						onDelete: deleteRun,
						deleting,
						onNewReview: () => setListTab("pulls"),
						emptyTitle: scoped ? i18nT("apps.codeReviewSage.components.middleColumn.no_reviews_for_repo", { repo: slug }) : i18nT("apps.codeReviewSage.components.middleColumn.no_reviews_yet"),
						emptyHint: scoped ? i18nT("apps.codeReviewSage.components.middleColumn.repo_reviews_appear_here") : i18nT("apps.codeReviewSage.components.middleColumn.pick_a_repo_then_a_pr")
					})
				})]
			})
		})]
	});
}
// src/host/scriptLabel.ts
/**
* Name a single refused letter so it cannot pass for an allowed one.
*
* A Cyrillic or Greek capital renders exactly like the Latin capital a slug rule
* allows, so a message that shows only the glyph shows a character that looks fine.
* The refusal copy therefore puts the letter's script and code point beside it:
* `“О” (Cyrillic letter, U+041E)`.
*
* The script labels are a small catalog-backed set: Latin, Greek and Cyrillic, the
* scripts whose capitals are drawn alike. A letter from any other script is labelled
* a plain "character", and its code point still sets it apart.
*/
var SCRIPT_LABELS = [
	[/^\p{Script=Latin}$/u, () => i18nT("lib.scriptLabel.latin")],
	[/^\p{Script=Greek}$/u, () => i18nT("lib.scriptLabel.greek")],
	[/^\p{Script=Cyrillic}$/u, () => i18nT("lib.scriptLabel.cyrillic")]
];
/** The code point of a single character as Unicode writes it: `U+041E`, `U+1D400`. */
function codePointLabel(char) {
	return `U+${(char.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, "0")}`;
}
/** The app-language label for the script of one letter, e.g. "Cyrillic letter". */
function scriptLabel(char) {
	for (const [pattern, label] of SCRIPT_LABELS) if (pattern.test(char)) return label();
	return i18nT("lib.scriptLabel.other");
}
/** The interpolation values a `*_letter` refusal key takes beside `char`. */
function refusedLetterParams(char) {
	return {
		char,
		script: scriptLabel(char),
		code: codePointLabel(char)
	};
}
// src/NativeSelect.tsx
/**
* The fallback for `Select` on a host that does not export one: a plain native
* `<select>` with the same props, so the call sites do not branch.
*/
function NativeSelect({ options, optionLabels, value, onChange, clearLabel, disabled, "aria-label": ariaLabel, title, className }) {
	const emptyRow = clearLabel !== void 0 || !options.includes(value);
	return /* @__PURE__ */ jsxs("select", {
		value,
		onChange: (e) => onChange(e.target.value),
		disabled,
		"aria-label": ariaLabel,
		title,
		className: "text-sm px-2 py-1 rounded-md bg-[var(--bg-elevated)] border border-[var(--border)] text-[var(--text)]" + (className ? ` ${className}` : ""),
		children: [emptyRow && /* @__PURE__ */ jsx("option", {
			value: "",
			children: clearLabel ?? ""
		}), options.map((option, index) => /* @__PURE__ */ jsx("option", {
			value: option,
			children: optionLabels?.[index] ?? option
		}, option))]
	});
}
// src/hostSdk.ts
/**
* Host names added at App Kit level 1, feature-detected.
*
* A named import of an export the host's module does not have fails the whole
* bundle at link time, so a host older than these seams would show a broken page
* instead of a slightly plainer one. These names are therefore read off namespace
* imports, each through an `in` check, and each has a local fallback. Names every
* supported host has are named-imported where they are used.
*/
/** The host's inline dropdown, or a native `<select>` on a host without one. */
var Select = ("Select" in ui ? ui.Select : void 0) ?? NativeSelect;
/** The host guide's caution marker, spread onto a control that removes something,
*  or no marker on a host without it (the control works the same; the guide just
*  does not pause on it). */
var guideCaution = ("guideCaution" in ui ? ui.guideCaution : void 0) ?? {};
// src/components/LearningRail.tsx
/** A refused namespace name is explained in the app's language; the backend's
*  English is for logs. The name is the namespace's folder, so it stays a
*  lowercase Latin slug on purpose, and `char` names what stopped it. A refused
*  letter is shown with its script and code point, because a Cyrillic or Greek
*  capital renders exactly like the Latin one the rule allows. Read off the
*  error's fields rather than `instanceof SageApiError`, so the copy does not
*  depend on which module instance threw. */
function errorText(err) {
	const { code, char } = err;
	if (code !== "invalid_namespace_name") return err.message;
	if (typeof char !== "string" || !char) return i18nT("apps.codeReviewSage.components.learningRail.invalid_namespace_name");
	return /^\p{L}$/u.test(char) ? i18nT("apps.codeReviewSage.components.learningRail.invalid_namespace_name_letter", refusedLetterParams(char)) : i18nT("apps.codeReviewSage.components.learningRail.invalid_namespace_name_char", { char });
}
function LearningRail() {
	const ime = useImeGuard();
	const { selectedNamespace, selectNamespace } = useSage();
	const qc = useQueryClient();
	const [confirmDelete, setConfirmDelete] = useState(null);
	const [newName, setNewName] = useState("");
	const [adding, setAdding] = useState(false);
	const nsQuery = useQuery({
		queryKey: ["code-review-sage", "namespaces"],
		queryFn: () => sageApi.namespaces()
	});
	const settingsQuery = useQuery({
		queryKey: ["code-review-sage", "settings"],
		queryFn: () => sageApi.settings(),
		staleTime: 3e4
	});
	const invalidate = () => {
		qc.invalidateQueries({ queryKey: ["code-review-sage", "namespaces"] });
		qc.invalidateQueries({ queryKey: ["code-review-sage", "settings"] });
	};
	const saveMut = useMutation({
		mutationFn: (active) => sageApi.putSettings({ active_namespaces: active }),
		onSuccess: invalidate
	});
	const createMut = useMutation({
		mutationFn: (name) => sageApi.createNamespace(name),
		onSuccess: () => {
			invalidate();
			setNewName("");
			setAdding(false);
		}
	});
	const deleteMut = useMutation({
		mutationFn: (name) => sageApi.deleteNamespace(name),
		onSuccess: (_d, name) => {
			invalidate();
			setConfirmDelete(null);
			if (selectedNamespace === name) selectNamespace(null);
		}
	});
	const active = useMemo(() => new Set(settingsQuery.data?.settings.active_namespaces ?? nsQuery.data?.active ?? []), [settingsQuery.data, nsQuery.data]);
	const toggle = (name, on) => {
		const next = new Set(active);
		if (on) next.add(name);
		else next.delete(name);
		saveMut.mutate(next.size ? [...next] : ["default"]);
	};
	const err = createMut.error ?? deleteMut.error ?? saveMut.error;
	return /* @__PURE__ */ jsxs("div", {
		className: "flex flex-col gap-1 min-h-0 h-full",
		children: [/* @__PURE__ */ jsxs("div", {
			className: "flex items-center gap-1.5 px-3 pt-1 pb-1 text-[12px] font-semibold text-muted uppercase tracking-[.05em] flex-shrink-0",
			children: [/* @__PURE__ */ jsx("span", {
				className: "flex-1",
				children: i18nT("apps.codeReviewSage.components.learningRail.namespaces")
			}), /* @__PURE__ */ jsx("button", {
				type: "button",
				onClick: () => setAdding(true),
				title: i18nT("apps.codeReviewSage.components.learningRail.new_namespace"),
				"aria-label": i18nT("apps.codeReviewSage.components.learningRail.new_namespace"),
				className: "inline-flex items-center p-0.5 bg-transparent text-muted hover:text-accent cursor-pointer normal-case",
				children: /* @__PURE__ */ jsx(Plus, { size: 14 })
			})]
		}), /* @__PURE__ */ jsxs("div", {
			className: "flex-1 min-h-0 overflow-y-auto scrollbar-none px-2 pb-2 flex flex-col gap-1",
			children: [
				nsQuery.isLoading && /* @__PURE__ */ jsx("div", {
					className: "px-1 py-1 text-[12px] text-muted",
					children: i18nT("apps.codeReviewSage.components.learningRail.loading")
				}),
				nsQuery.error && /* @__PURE__ */ jsx(ErrorNotice, {
					message: nsQuery.error.message,
					variant: "inline",
					askAgent: true,
					className: "px-1 py-1"
				}),
				nsQuery.data?.namespaces.map((ns) => {
					const isActive = active.has(ns.name);
					const isSelected = selectedNamespace === ns.name;
					const pending = confirmDelete === ns.name;
					return /* @__PURE__ */ jsxs("div", {
						className: "flex flex-col",
						children: [/* @__PURE__ */ jsxs("div", {
							className: `group flex items-center gap-2 rounded-lg border px-2 py-1.5 ${isSelected ? "border-accent bg-accent-subtle" : "border-transparent hover:bg-bg-hover"}`,
							children: [
								/* @__PURE__ */ jsx("input", {
									type: "checkbox",
									checked: isActive,
									"aria-label": i18nT("apps.codeReviewSage.components.learningRail.load_namespace_during_reviews", { name: ns.name }),
									title: isActive ? i18nT("apps.codeReviewSage.components.learningRail.namespace_active") : i18nT("apps.codeReviewSage.components.learningRail.namespace_inactive"),
									onChange: (e) => toggle(ns.name, e.target.checked),
									className: "cursor-pointer flex-shrink-0",
									style: { accentColor: "var(--accent)" }
								}),
								/* @__PURE__ */ jsxs("button", {
									type: "button",
									onClick: () => selectNamespace(ns.name),
									"aria-current": isSelected ? "true" : void 0,
									"aria-label": i18nT("apps.codeReviewSage.components.learningRail.read_namespace", { name: ns.name }),
									className: "flex-1 min-w-0 text-left bg-transparent cursor-pointer",
									children: [/* @__PURE__ */ jsx("span", {
										className: `block truncate font-mono text-[12.5px] ${isActive ? "text-accent font-medium" : "text-text"}`,
										children: ns.name
									}), /* @__PURE__ */ jsxs("span", {
										className: "block text-[11px] text-muted",
										children: [i18nT("apps.codeReviewSage.components.learningRail.pattern", { count: ns.patterns }), ns.candidate > 0 && /* @__PURE__ */ jsxs("span", {
											className: "text-warn",
											children: [" · ", i18nT("apps.codeReviewSage.components.learningRail.pending_count", { count: ns.candidate })]
										})]
									})]
								}),
								ns.name !== "default" && !pending && /* @__PURE__ */ jsx("button", {
									type: "button",
									onClick: () => setConfirmDelete(ns.name),
									"aria-label": i18nT("apps.codeReviewSage.components.learningRail.delete_namespace", { name: ns.name }),
									...guideCaution,
									className: "flex-shrink-0 p-0.5 bg-transparent text-muted opacity-0 group-hover:opacity-100 [@media(hover:none)]:opacity-100 focus-visible:opacity-100 hover:text-danger cursor-pointer",
									children: /* @__PURE__ */ jsx(Trash2, { size: 12 })
								}),
								isSelected && /* @__PURE__ */ jsx(ChevronRight, {
									size: 12,
									className: "flex-shrink-0 text-accent",
									"aria-hidden": "true"
								})
							]
						}), pending && /* @__PURE__ */ jsxs("div", {
							className: "mt-1 mx-1 rounded-md border border-danger bg-bg-elevated px-2 py-1.5 text-[11.5px]",
							children: [/* @__PURE__ */ jsx("div", {
								className: "text-danger leading-[1.4]",
								children: i18nT("apps.codeReviewSage.components.learningRail.confirm_delete", { name: ns.name })
							}), /* @__PURE__ */ jsxs("div", {
								className: "mt-1 flex items-center gap-2",
								children: [/* @__PURE__ */ jsxs("button", {
									type: "button",
									onClick: () => deleteMut.mutate(ns.name),
									disabled: deleteMut.isPending,
									className: "inline-flex items-center gap-1 bg-transparent px-1 font-medium text-danger hover:underline disabled:opacity-40 cursor-pointer",
									children: [deleteMut.isPending && /* @__PURE__ */ jsx(Loader2, {
										size: 11,
										className: "animate-spin motion-reduce:animate-none"
									}), i18nT("apps.codeReviewSage.components.learningRail.delete_2")]
								}), /* @__PURE__ */ jsxs("button", {
									type: "button",
									onClick: () => setConfirmDelete(null),
									className: "inline-flex items-center gap-1 bg-transparent px-1 text-muted hover:text-text cursor-pointer",
									children: [
										/* @__PURE__ */ jsx(X, { size: 11 }),
										" ",
										i18nT("apps.codeReviewSage.components.learningRail.keep_it")
									]
								})]
							})]
						})]
					}, ns.name);
				}),
				adding && /* @__PURE__ */ jsxs("div", {
					className: "flex items-center gap-1.5 px-1 pt-1",
					children: [/* @__PURE__ */ jsx("input", {
						value: newName,
						autoFocus: true,
						onChange: (e) => setNewName(e.target.value),
						...ime.bindEnter({
							onEnter: () => {
								if (newName.trim()) createMut.mutate(newName.trim());
							},
							onEscape: () => {
								setAdding(false);
								setNewName("");
							}
						}),
						"aria-label": i18nT("apps.codeReviewSage.components.learningRail.new_namespace_name"),
						placeholder: i18nT("apps.codeReviewSage.components.learningRail.new_namespace_2"),
						className: "flex-1 min-w-0 rounded-md border border-border bg-bg-elevated px-2 py-1 font-mono text-[12px] text-text outline-hidden focus-visible:border-accent"
					}), /* @__PURE__ */ jsx("button", {
						type: "button",
						onClick: () => newName.trim() && createMut.mutate(newName.trim()),
						disabled: !newName.trim() || createMut.isPending,
						className: "flex-shrink-0 bg-transparent p-0.5 text-muted hover:text-accent disabled:opacity-30 cursor-pointer",
						"aria-label": i18nT("apps.codeReviewSage.components.learningRail.add_namespace"),
						children: /* @__PURE__ */ jsx(Plus, { size: 13 })
					})]
				}),
				err && /* @__PURE__ */ jsx(ErrorNotice, {
					message: errorText(err),
					variant: "inline",
					className: "px-1"
				})
			]
		})]
	});
}
// src/components/RailHeader.tsx
var APP_VERSION = "2.0";
/** The three section destinations, in bar order.
*
* One table rather than three near-identical call sites, because the mapping is
* read from TWO places: this nav, and the shell's back-to-list control (which
* names the section it returns to and is not offered for a section whose rail
* holds no list). Spelling it twice let the two drift the moment a section is
* added or renamed.
*
* `labelKey` holds the FULL literal catalog key, not a fragment assembled at the
* call site: the key-resolution gate can only verify a literal, and resolving it
* here at module scope would freeze the first locale for the process — so the
* label is resolved per render by {@link sectionLabel}. */
var SECTIONS = [
	{
		view: "reviews",
		labelKey: "apps.codeReviewSage.components.leftRail.reviews",
		icon: ListChecks,
		hasList: true
	},
	{
		view: "learning",
		labelKey: "apps.codeReviewSage.components.leftRail.learning",
		icon: Brain,
		hasList: true
	},
	{
		view: "settings",
		labelKey: "apps.codeReviewSage.components.leftRail.settings",
		icon: Settings,
		hasList: false
	}
];
/** This section's name, resolved at call time so a language switch reaches it. */
function sectionLabel(view) {
	const entry = SECTIONS.find((s) => s.view === view);
	return entry ? i18nT(entry.labelKey) : "";
}
/** Whether this section's rail holds a list, i.e. whether "back to the list" is
*  a real destination in it. */
function sectionHasList(view) {
	return SECTIONS.find((s) => s.view === view)?.hasList ?? false;
}
/** One section destination, icon-only.
*
* Labelled for assistive tech and on hover but not in print. Two separate reasons,
* because the desktop rail and the phone bar do not share one:
*
*  - On the WIDE rail, the sections and the lists below them both had a "Reviews",
*    stacked one above the other, which read as a repeated control. A list of
*    reviews has the stronger claim on the word, so the section keeps the glyph.
*    That argument is about the list being visible directly below, so it says
*    nothing about the bar, where the list is hidden.
*  - On the BAR it is a width decision, measured rather than assumed: at a 390px
*    viewport the row has 374px, and a labelled three-section nav beside the
*    labelled back control measures 452-654px in 5 of 6 locales sampled (only
*    zh-CN fits, with zero slack). Labels would have to wrap to a second line,
*    permanently doubling the bar's height above the report. The maintainer's
*    ruling on that trade is to keep the nav icon-only and let a tap teach what a
*    glyph does — so the effort went into making a tap teach: no control-shaped
*    thing on the bar is dead (see `onReselect`), and no glyph is duplicated by
*    the decorative app mark (see the reviews entry's icon).
*
* `touch` is the narrow-viewport form. The desktop rail's 27px hit area clears
* WCAG 2.2 SC 2.5.8's 24px floor but is not what a touch target is built to;
* 44px is what Apple's HIG, Fluent and Primer all recommend, and on the bar these
* three ARE the app's navigation rather than a corner of a wide rail. */
function NavRow({ label, icon: Icon, active, touch, onClick }) {
	return /* @__PURE__ */ jsx("button", {
		type: "button",
		onClick,
		"aria-current": active ? "page" : void 0,
		"aria-label": label,
		title: label,
		className: `inline-flex items-center justify-center rounded-md cursor-pointer transition-colors focus-ring-accent ${touch ? "min-h-11 min-w-11" : "p-1.5"} ${active ? "bg-accent-subtle text-accent" : "bg-transparent text-muted hover:text-text hover:bg-bg-hover"}`,
		children: /* @__PURE__ */ jsx(Icon, {
			size: 15,
			className: "flex-shrink-0",
			"aria-hidden": "true"
		})
	});
}
function RailHeader({ leading, narrow = false, onReselect }) {
	const { mainView, setMainView } = useSage();
	const appName = i18nT("apps.codeReviewSage.components.leftRail.code_review_sage");
	return /* @__PURE__ */ jsxs("div", {
		className: `flex items-center gap-2 flex-shrink-0 min-w-0 ${narrow ? "w-full px-1" : "px-3 pt-1 pb-1.5"}`,
		children: [
			leading,
			/* @__PURE__ */ jsx(ScanSearch, {
				size: 16,
				className: "text-accent flex-shrink-0",
				"aria-hidden": "true"
			}),
			/* @__PURE__ */ jsx("span", {
				className: "min-w-0 truncate text-[14px] font-medium text-text",
				title: appName,
				children: appName
			}),
			!narrow && /* @__PURE__ */ jsx("span", {
				className: "flex-shrink-0 text-[12px] text-muted opacity-70",
				children: i18nT("apps.codeReviewSage.components.leftRail.version", { version: APP_VERSION })
			}),
			/* @__PURE__ */ jsx("nav", {
				className: "ml-auto flex items-center gap-0.5 flex-shrink-0",
				"aria-label": i18nT("apps.codeReviewSage.components.leftRail.sections"),
				children: SECTIONS.map((s) => /* @__PURE__ */ jsx(NavRow, {
					label: i18nT(s.labelKey),
					icon: s.icon,
					active: mainView === s.view,
					touch: narrow,
					onClick: () => mainView === s.view ? onReselect?.() : setMainView(s.view)
				}, s.view))
			})
		]
	});
}
// src/host/GithubLogo.tsx
/** The GitHub Invertocat mark (the dashboard's `components/icons/GithubLogo`),
*  drawn inline in the current text colour. */
function GithubLogo({ size = 13, className = "" }) {
	return /* @__PURE__ */ jsx("svg", {
		"aria-hidden": "true",
		className: `inline-block ${className}`,
		"data-provider-mark": "github",
		width: size,
		height: size,
		viewBox: "0 0 98 96",
		fill: "currentColor",
		children: /* @__PURE__ */ jsx("path", {
			fillRule: "evenodd",
			clipRule: "evenodd",
			d: "M48.854 0C21.839 0 0 22 0 49.217c0 21.756 13.993 40.172 33.405 46.69 2.427.49 3.316-1.059 3.316-2.362 0-1.141-.08-5.052-.08-9.127-13.59 2.934-16.42-5.867-16.42-5.867-2.184-5.704-5.42-7.17-5.42-7.17-4.448-3.015.324-3.015.324-3.015 4.934.326 7.523 5.052 7.523 5.052 4.367 7.496 11.404 5.378 14.235 4.074.404-3.178 1.699-5.378 3.074-6.6-10.839-1.141-22.243-5.378-22.243-24.283 0-5.378 1.94-9.778 5.014-13.2-.485-1.222-2.184-6.275.486-13.038 0 0 4.125-1.304 13.426 5.052a46.97 46.97 0 0 1 12.214-1.63c4.125 0 8.33.571 12.213 1.63 9.302-6.356 13.427-5.052 13.427-5.052 2.67 6.763.97 11.816.485 13.038 3.155 3.422 5.015 7.822 5.015 13.2 0 18.905-11.404 23.06-22.324 24.283 1.78 1.548 3.316 4.481 3.316 9.126 0 6.6-.08 11.897-.08 13.526 0 1.304.89 2.853 3.316 2.364 19.412-6.52 33.405-24.935 33.405-46.691C97.707 22 75.788 0 48.854 0z"
		})
	});
}
// src/components/RepoSwitcher.tsx
function RepoSwitcher() {
	const { pinnedRepos, pinnedLoading, activeRepo, setActiveRepo, openAddRepos, pinError, setListTab, setMainView } = useSage();
	const [query, setQuery] = useState("");
	const [recent, setRecent] = useState(loadRecentRepos);
	const filtered = useMemo(() => {
		const q = query.trim().toLowerCase();
		if (!q) return pinnedRepos;
		return pinnedRepos.filter((r) => `${r.owner}/${r.repo}`.toLowerCase().includes(q));
	}, [pinnedRepos, query]);
	const recentRows = useMemo(() => {
		if (query.trim()) return [];
		return recent.filter((r) => pinnedRepos.some((p) => p.owner === r.owner && p.repo === r.repo));
	}, [
		recent,
		pinnedRepos,
		query
	]);
	const rest = useMemo(() => {
		if (recentRows.length < 2) return filtered;
		return filtered.filter((r) => !recentRows.some((x) => x.owner === r.owner && x.repo === r.repo));
	}, [filtered, recentRows]);
	const pick = (r) => {
		setRecent(rememberRecentRepo(r));
		setActiveRepo(r);
		setMainView("reviews");
		setListTab("pulls");
	};
	const label = activeRepo ? repoSlug(activeRepo) : i18nT("apps.codeReviewSage.components.repoSwitcher.pick_a_repo");
	return /* @__PURE__ */ jsxs("div", {
		className: "px-2",
		children: [/* @__PURE__ */ jsxs(DropdownMenu, { children: [/* @__PURE__ */ jsx(DropdownMenuTrigger, {
			asChild: true,
			children: /* @__PURE__ */ jsxs("button", {
				"aria-label": activeRepo ? i18nT("apps.codeReviewSage.components.repoSwitcher.repository_named", { name: label }) : i18nT("apps.codeReviewSage.components.repoSwitcher.pick_a_repository"),
				className: "w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl border border-border-strong bg-bg-elevated shadow-sm hover:border-accent hover:bg-bg-hover cursor-pointer transition-colors",
				children: [
					activeRepo ? /* @__PURE__ */ jsx(GithubLogo, {
						size: 18,
						className: "flex-shrink-0"
					}) : /* @__PURE__ */ jsx(FolderGit2, {
						size: 17,
						className: "flex-shrink-0 text-muted",
						"aria-hidden": "true"
					}),
					/* @__PURE__ */ jsx("span", {
						className: "flex-1 min-w-0 truncate text-[14px] font-semibold text-left leading-5 " + (activeRepo ? "text-text" : "text-muted"),
						title: activeRepo ? label : void 0,
						children: label
					}),
					/* @__PURE__ */ jsx(ChevronDown, {
						size: 15,
						className: "text-muted flex-shrink-0"
					})
				]
			})
		}), /* @__PURE__ */ jsxs(DropdownMenuContent, {
			align: "start",
			side: "bottom",
			sideOffset: 6,
			className: "w-[320px]",
			children: [
				/* @__PURE__ */ jsx(DropdownMenuLabel, {
					className: "text-[12px] uppercase tracking-[.04em]",
					children: recentRows.length >= 2 ? i18nT("apps.codeReviewSage.components.repoSwitcher.recent") : i18nT("apps.codeReviewSage.components.repoSwitcher.repositories")
				}),
				pinnedRepos.length > 6 && /* @__PURE__ */ jsx("div", {
					className: "px-2 pb-1.5",
					children: /* @__PURE__ */ jsx("input", {
						value: query,
						onChange: (e) => setQuery(e.target.value),
						onKeyDown: (e) => e.stopPropagation(),
						placeholder: i18nT("apps.codeReviewSage.components.repoSwitcher.filter_repos"),
						"aria-label": i18nT("apps.codeReviewSage.components.repoSwitcher.filter_repositories"),
						className: "w-full rounded-lg border border-border bg-card px-2.5 py-1.5 text-[13px] text-text placeholder:text-muted outline-hidden focus-visible:border-accent"
					})
				}),
				pinnedLoading && /* @__PURE__ */ jsx("div", {
					className: "px-3 py-2 text-[12.5px] text-muted",
					children: i18nT("apps.codeReviewSage.components.repoSwitcher.loading")
				}),
				!pinnedLoading && pinnedRepos.length === 0 && /* @__PURE__ */ jsx("div", {
					className: "px-3 py-2 text-[12.5px] text-muted leading-[1.5]",
					children: i18nT("apps.codeReviewSage.components.repoSwitcher.no_repos_yet_add_one_to_pick_from_the_repos_you")
				}),
				!pinnedLoading && pinnedRepos.length > 0 && filtered.length === 0 && /* @__PURE__ */ jsx("div", {
					className: "px-3 py-2 text-[12.5px] text-muted",
					children: i18nT("apps.codeReviewSage.components.repoSwitcher.no_repo_matches_that")
				}),
				recentRows.length >= 2 && /* @__PURE__ */ jsxs(Fragment, { children: [
					recentRows.map((r) => {
						const isActive = !!activeRepo && activeRepo.owner === r.owner && activeRepo.repo === r.repo;
						return /* @__PURE__ */ jsxs(DropdownMenuItem, {
							onSelect: () => pick({
								owner: r.owner,
								repo: r.repo
							}),
							children: [
								/* @__PURE__ */ jsx(Clock, {
									size: 12,
									className: "flex-shrink-0 text-muted",
									"aria-hidden": "true"
								}),
								/* @__PURE__ */ jsxs("span", {
									className: "flex-1 min-w-0 truncate",
									title: `${r.owner}/${r.repo}`,
									children: [
										r.owner,
										"/",
										/* @__PURE__ */ jsx("span", {
											className: "font-medium",
											children: r.repo
										})
									]
								}),
								isActive && /* @__PURE__ */ jsx(Check, {
									size: 13,
									className: "text-accent flex-shrink-0"
								})
							]
						}, `recent-${r.owner}/${r.repo}`);
					}),
					/* @__PURE__ */ jsx(DropdownMenuSeparator, {}),
					/* @__PURE__ */ jsx(DropdownMenuLabel, {
						className: "text-[12px] uppercase tracking-[.04em]",
						children: i18nT("apps.codeReviewSage.components.repoSwitcher.all_repos")
					})
				] }),
				rest.map((r) => {
					const isActive = !!activeRepo && activeRepo.owner === r.owner && activeRepo.repo === r.repo;
					return /* @__PURE__ */ jsxs(DropdownMenuItem, {
						onSelect: () => pick({
							owner: r.owner,
							repo: r.repo
						}),
						children: [
							/* @__PURE__ */ jsx(GithubLogo, {
								size: 13,
								className: "flex-shrink-0"
							}),
							/* @__PURE__ */ jsxs("span", {
								className: "flex-1 min-w-0 truncate",
								title: `${r.owner}/${r.repo}`,
								children: [
									r.owner,
									"/",
									/* @__PURE__ */ jsx("span", {
										className: "font-medium",
										children: r.repo
									})
								]
							}),
							isActive && /* @__PURE__ */ jsx(Check, {
								size: 13,
								className: "text-accent flex-shrink-0"
							})
						]
					}, `${r.owner}/${r.repo}`);
				}),
				/* @__PURE__ */ jsx(DropdownMenuSeparator, {}),
				/* @__PURE__ */ jsxs(DropdownMenuItem, {
					onSelect: () => openAddRepos(),
					children: [/* @__PURE__ */ jsx(Plus, {
						size: 13,
						className: "flex-shrink-0"
					}), /* @__PURE__ */ jsx("span", {
						className: "flex-1",
						children: i18nT("apps.codeReviewSage.components.repoSwitcher.add_a_repo")
					})]
				})
			]
		})] }), pinError && /* @__PURE__ */ jsx(ErrorNotice, {
			message: pinError.message,
			variant: "inline",
			askAgent: true,
			className: "px-1 pt-1"
		})]
	});
}
// src/components/LeftRail.tsx
function LeftRail({ narrow = false, onCollapse }) {
	const { mainView } = useSage();
	return /* @__PURE__ */ jsxs("aside", {
		className: "flex-1 min-w-0 flex flex-col min-h-0 py-2 gap-2",
		children: [/* @__PURE__ */ jsx(RailHeader, {
			narrow,
			leading: narrow && onCollapse ? /* @__PURE__ */ jsx(IconButton, {
				"aria-label": i18nT("app.collapse_sidebar"),
				onClick: onCollapse,
				className: "min-h-11 min-w-11 inline-flex items-center justify-center",
				children: /* @__PURE__ */ jsx(PanelLeftClose, { size: 16 })
			}) : void 0
		}), mainView === "learning" ? /* @__PURE__ */ jsx("div", {
			className: "flex-1 min-h-0 mx-2 overflow-hidden rounded-xl border border-border bg-bg-elevated shadow-sm flex flex-col",
			children: /* @__PURE__ */ jsx(LearningRail, {})
		}) : mainView === "settings" ? /* @__PURE__ */ jsx("div", { className: "flex-1 min-h-0" }) : /* @__PURE__ */ jsxs(Fragment, { children: [/* @__PURE__ */ jsx(RepoSwitcher, {}), /* @__PURE__ */ jsx("div", {
			className: "flex-1 min-h-0 mx-2 overflow-hidden rounded-xl border border-border bg-bg-elevated shadow-sm flex flex-col",
			children: /* @__PURE__ */ jsx(MiddleColumn, {})
		})] })]
	});
}
// src/components/PrSourcePanel.tsx
/** The provider payload for one pull request: never fetched here (see above). */
function usePrSource(url) {
	return useQuery({
		queryKey: ["pull-request-source", url],
		queryFn: () => Promise.reject(/* @__PURE__ */ new Error("no pull request payload for an app")),
		enabled: false
	});
}
// src/host/safeUrl.ts
/**
* Validate that a URL is a safe HTTP(S) link — reject javascript:, data:, etc.
* Returns the original URL if valid, null otherwise.
*
* Also reject URLs carrying HTTP Basic-auth userinfo
* (https://user:pass@host) — an LLM-controlled URL could otherwise smuggle
* credentials that get transmitted to the host when the link is opened.
*/
function safeHttpUrl(url) {
	try {
		const u = new URL(url);
		if (u.protocol !== "http:" && u.protocol !== "https:") return null;
		if (u.username || u.password) return null;
		return url;
	} catch {
		return null;
	}
}
// src/components/FindingCard.tsx
/** Severity → visual treatment. Red is a blocking finding, yellow a should-fix.
* Anything unset defaults to yellow (the softer of the two). Static class
* strings so Tailwind keeps them. */
function severityVisual(severity) {
	if (severity === "red") return {
		text: "text-danger",
		border: "border-l-danger",
		word: i18nT("apps.codeReviewSage.components.findingCard.severity_must_fix")
	};
	return {
		text: "text-warn",
		border: "border-l-warn",
		word: i18nT("apps.codeReviewSage.components.findingCard.severity_should_fix")
	};
}
/** A finding's text field as a trimmed string, or `''` when it is anything else.
*
* These records are written by the review worker and read back from disk, so the
* `string` in `Finding` is a claim and not a runtime guarantee. `?? ''` covers a
* missing field but not a wrongly-typed one: a numeric value survives it and
* throws on `.trim()`, and a planted object reaches React as an unrenderable
* child. Both take the entire report view down, so every text field the card
* renders passes through here and a malformed record loses one row instead. */
function asText(value) {
	return typeof value === "string" ? value.trim() : "";
}
/** A finding's CODE field, type-checked but byte-exact — never trimmed.
*
* Same runtime-type guard as `asText`, deliberately without the trim: the
* snippet is rendered in a `whitespace-pre-wrap` <pre>, so its leading
* indentation is data. Trimming it would show the reviewed line at a nesting
* depth it does not have, which is a quieter failure than a crash and a worse
* one -- the evidence would look right while misrepresenting the code. */
function asCode(value) {
	return typeof value === "string" ? value : "";
}
/** One label+value row. Rendered only when it has something to say, so a finding
* missing a field collapses the row instead of leaving a labelled blank. */
function DetailRow({ label, value, accent = false, children }) {
	const text = asText(value);
	if (!text && !children) return null;
	return /* @__PURE__ */ jsxs("div", {
		className: "flex gap-3 border-t border-border px-3.5 py-2.5",
		children: [/* @__PURE__ */ jsx("div", {
			className: `w-[84px] flex-shrink-0 pt-0.5 text-[10px] font-semibold uppercase tracking-wider ${accent ? "text-accent" : "text-muted"}`,
			children: label
		}), /* @__PURE__ */ jsxs("div", {
			className: "min-w-0 flex-1 text-[12.5px] leading-relaxed text-text",
			children: [text && /* @__PURE__ */ jsx(MarkdownRenderer, { content: text }), children]
		})]
	});
}
function FindingCard({ finding, onPost, posted = false, posting = false, selectable = false, selected = false, onToggle, label = "", dismissed = null, onDismiss }) {
	const [asking, setAsking] = useState(false);
	const [reason, setReason] = useState("");
	const [saving, setSaving] = useState(false);
	const [failed, setFailed] = useState(false);
	const save = (value) => {
		if (!onDismiss) return;
		setSaving(true);
		setFailed(false);
		onDismiss(value).then(() => {
			setAsking(false);
			setReason("");
		}).catch(() => setFailed(true)).finally(() => setSaving(false));
	};
	const { text, border, word } = severityVisual(finding.severity);
	const location = [finding.file, finding.line != null && finding.line !== "" ? String(finding.line) : null].filter(Boolean).join(":");
	const headline = asText(finding.headline);
	const snippet = asCode(finding.snippet);
	const dimension = asText(finding.dimension);
	const eyebrow = dimension ? `${word} · ${dimension}` : word;
	const isDismissed = Boolean(dismissed) && !posted;
	const canDismiss = Boolean(onDismiss) && !posted;
	const showActions = posted || Boolean(onPost) || selectable && !posted || canDismiss;
	return /* @__PURE__ */ jsxs("div", {
		className: `rounded-lg border border-border bg-bg-elevated overflow-hidden border-l-[3px] ${isDismissed ? "border-l-border" : border} my-2`,
		children: [
			/* @__PURE__ */ jsxs("div", {
				className: "px-3.5 pb-2 pt-2.5",
				children: [
					/* @__PURE__ */ jsx("div", {
						className: `text-[10px] font-semibold uppercase tracking-wider ${isDismissed ? "text-muted line-through" : text}`,
						children: eyebrow
					}),
					headline && /* @__PURE__ */ jsx("div", {
						className: "mt-1 text-[13.5px] font-semibold leading-snug text-text-strong",
						children: /* @__PURE__ */ jsx(MarkdownRenderer, { content: headline })
					}),
					location && /* @__PURE__ */ jsx("div", {
						className: "mt-0.5 truncate font-mono text-[10.5px] text-muted",
						title: location,
						children: location
					})
				]
			}),
			/* @__PURE__ */ jsx(DetailRow, {
				label: i18nT("apps.codeReviewSage.components.findingCard.observation"),
				value: finding.observation,
				children: snippet.trim() && /* @__PURE__ */ jsxs("div", {
					className: "mt-1.5 flex items-baseline gap-2 overflow-auto rounded border border-border bg-bg px-2 py-1",
					children: [/* @__PURE__ */ jsx("span", {
						className: "flex-shrink-0 font-mono text-[10.5px] text-muted",
						children: i18nT("apps.codeReviewSage.components.findingCard.evidence")
					}), /* @__PURE__ */ jsx("pre", {
						className: "min-w-0 whitespace-pre-wrap font-mono text-[10.5px] leading-relaxed",
						children: snippet
					})]
				})
			}),
			/* @__PURE__ */ jsx(DetailRow, {
				label: i18nT("apps.codeReviewSage.components.findingCard.consequence"),
				value: finding.consequence
			}),
			/* @__PURE__ */ jsx(DetailRow, {
				label: i18nT("apps.codeReviewSage.components.findingCard.suggestion"),
				value: finding.suggestion,
				accent: true
			}),
			showActions && isDismissed && /* @__PURE__ */ jsxs("div", {
				className: "flex items-start gap-2 border-t border-border-strong bg-bg-elevated px-3.5 py-2",
				children: [
					/* @__PURE__ */ jsx(EyeOff, {
						size: 12,
						className: "mt-0.5 flex-shrink-0 text-muted",
						"aria-hidden": "true"
					}),
					/* @__PURE__ */ jsxs("div", {
						className: "min-w-0 flex-1 flex flex-col gap-1 text-[11.5px] text-muted break-words",
						children: [i18nT("apps.codeReviewSage.components.findingCard.dismissed_reason", { reason: asText(dismissed?.reason) }), /* @__PURE__ */ jsx(ErrorNotice, {
							message: failed ? i18nT("apps.codeReviewSage.components.findingCard.undo_dismiss_failed") : null,
							askAgent: true,
							variant: "inline"
						})]
					}),
					onDismiss && /* @__PURE__ */ jsx("button", {
						type: "button",
						disabled: saving,
						onClick: () => save(null),
						className: "flex-shrink-0 rounded-md bg-transparent px-1.5 py-0.5 text-[11.5px] text-accent hover:underline disabled:opacity-50 cursor-pointer disabled:cursor-default",
						children: i18nT("apps.codeReviewSage.components.findingCard.undo_dismiss")
					})
				]
			}),
			showActions && !isDismissed && asking && /* @__PURE__ */ jsxs("form", {
				className: "flex flex-col gap-2 border-t border-border-strong bg-bg-elevated px-3.5 py-2",
				onSubmit: (e) => {
					e.preventDefault();
					if (reason.trim()) save(reason.trim());
				},
				children: [
					/* @__PURE__ */ jsxs("label", {
						className: "flex flex-col gap-1 text-[11.5px] text-muted",
						children: [i18nT("apps.codeReviewSage.components.findingCard.dismiss_reason_label"), /* @__PURE__ */ jsx("textarea", {
							"aria-label": i18nT("apps.codeReviewSage.components.findingCard.dismiss_reason_label"),
							value: reason,
							onChange: (e) => setReason(e.target.value),
							disabled: saving,
							maxLength: 500,
							rows: 2,
							autoFocus: true,
							placeholder: i18nT("apps.codeReviewSage.components.findingCard.dismiss_reason_placeholder"),
							className: "rounded-md border border-border bg-card px-2 py-1 text-[12px] text-text"
						})]
					}),
					/* @__PURE__ */ jsx(ErrorNotice, {
						message: failed ? i18nT("apps.codeReviewSage.components.findingCard.dismiss_failed") : null,
						askAgent: false,
						variant: "inline"
					}),
					/* @__PURE__ */ jsxs("div", {
						className: "flex items-center justify-end gap-2",
						children: [/* @__PURE__ */ jsx("button", {
							type: "button",
							disabled: saving,
							onClick: () => {
								setAsking(false);
								setReason("");
								setFailed(false);
							},
							className: "rounded-md bg-transparent px-1.5 py-1 text-[11.5px] text-muted hover:text-text disabled:opacity-50 cursor-pointer disabled:cursor-default",
							children: i18nT("apps.codeReviewSage.components.findingCard.cancel_dismiss")
						}), /* @__PURE__ */ jsxs("button", {
							type: "submit",
							disabled: saving || !reason.trim(),
							className: "inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2 py-1 text-[11.5px] text-text hover:text-accent hover:border-accent disabled:opacity-50 cursor-pointer disabled:cursor-default",
							children: [saving && /* @__PURE__ */ jsx(Loader2, {
								size: 11,
								className: "animate-spin motion-reduce:animate-none",
								"aria-hidden": "true"
							}), i18nT("apps.codeReviewSage.components.findingCard.confirm_dismiss")]
						})]
					})
				]
			}),
			showActions && !isDismissed && !asking && /* @__PURE__ */ jsxs("div", {
				className: "flex items-center gap-2 border-t border-border-strong bg-bg-elevated px-3.5 py-2",
				children: [
					selectable && !posted && /* @__PURE__ */ jsxs("label", {
						className: "flex items-center gap-2 text-[11.5px] text-muted cursor-pointer",
						children: [/* @__PURE__ */ jsx("input", {
							type: "checkbox",
							checked: selected,
							onChange: onToggle,
							"aria-label": i18nT("apps.codeReviewSage.components.findingCard.select_to_post", { label: label || i18nT("apps.codeReviewSage.components.findingCard.this_finding") }),
							className: "flex-shrink-0 accent-accent cursor-pointer"
						}), i18nT("apps.codeReviewSage.components.findingCard.select_to_draft_together")]
					}),
					/* @__PURE__ */ jsx("span", { className: "flex-1" }),
					canDismiss && !posting && /* @__PURE__ */ jsxs("button", {
						type: "button",
						onClick: () => setAsking(true),
						className: "inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2 py-1 text-[11.5px] text-muted hover:text-text hover:border-border-strong cursor-pointer",
						children: [/* @__PURE__ */ jsx(EyeOff, {
							size: 11,
							"aria-hidden": "true"
						}), i18nT("apps.codeReviewSage.components.findingCard.dismiss")]
					}),
					posted ? /* @__PURE__ */ jsxs("span", {
						className: "inline-flex items-center gap-1.5 text-[11.5px] text-ok",
						children: [
							/* @__PURE__ */ jsx(Check, {
								size: 11,
								"aria-hidden": "true"
							}),
							" ",
							i18nT("apps.codeReviewSage.components.findingCard.posted_to_the_pull_request")
						]
					}) : posting ? /* @__PURE__ */ jsxs("span", {
						className: "inline-flex items-center gap-1.5 text-[11.5px] text-muted",
						children: [/* @__PURE__ */ jsx(Loader2, {
							size: 11,
							className: "animate-spin motion-reduce:animate-none",
							"aria-hidden": "true"
						}), i18nT("apps.codeReviewSage.components.findingCard.posting")]
					}) : onPost ? /* @__PURE__ */ jsxs("button", {
						type: "button",
						onClick: onPost,
						"aria-label": finding.file ? i18nT("apps.codeReviewSage.components.findingCard.post_finding_on", { target: finding.file }) : i18nT("apps.codeReviewSage.components.findingCard.post_finding"),
						className: "inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2 py-1 text-[11.5px] text-text hover:text-accent hover:border-accent cursor-pointer",
						children: [/* @__PURE__ */ jsx(MessageSquarePlus, {
							size: 11,
							"aria-hidden": "true"
						}), i18nT("apps.codeReviewSage.components.findingCard.post_this_comment")]
					}) : null
				]
			})
		]
	});
}
function ShipSummaryCard({ body, onPost, posted = false, posting = false, selectable = false, selected = false, onToggle }) {
	if (!body.trim()) return null;
	return /* @__PURE__ */ jsxs("div", {
		className: "rounded-lg border border-border bg-bg-elevated overflow-hidden border-l-[3px] border-l-accent my-2",
		children: [
			/* @__PURE__ */ jsxs("div", {
				className: "flex items-center gap-1.5 px-3.5 py-2 border-b border-border text-[12.5px]",
				children: [
					/* @__PURE__ */ jsx(ShipWheel, {
						size: 13,
						className: "flex-shrink-0 text-accent",
						"aria-hidden": "true"
					}),
					/* @__PURE__ */ jsx("span", {
						className: "font-semibold text-accent",
						children: i18nT("apps.codeReviewSage.components.shipSummaryCard.ship_readiness_summary")
					}),
					/* @__PURE__ */ jsx("span", {
						className: "ml-auto text-[11px] text-muted",
						children: i18nT("apps.codeReviewSage.components.shipSummaryCard.posted_as_a_top_level_comment")
					})
				]
			}),
			/* @__PURE__ */ jsx("div", {
				className: "px-3.5 py-2.5 text-[12.5px] leading-[1.65]",
				children: /* @__PURE__ */ jsx(MarkdownRenderer, { content: body })
			}),
			(posted || onPost || selectable && !posted) && /* @__PURE__ */ jsxs("div", {
				className: "flex items-center gap-2 border-t border-border-strong bg-bg-elevated px-3.5 py-2",
				children: [
					selectable && !posted && /* @__PURE__ */ jsxs("label", {
						className: "flex items-center gap-2 text-[11.5px] text-muted cursor-pointer",
						children: [/* @__PURE__ */ jsx("input", {
							type: "checkbox",
							checked: selected,
							onChange: onToggle,
							"aria-label": i18nT("apps.codeReviewSage.components.shipSummaryCard.select_the_ship_readiness_summary_to_post"),
							className: "flex-shrink-0 accent-accent cursor-pointer"
						}), i18nT("apps.codeReviewSage.components.findingCard.select_to_draft_together")]
					}),
					/* @__PURE__ */ jsx("span", { className: "flex-1" }),
					/* @__PURE__ */ jsx("div", { children: posted ? /* @__PURE__ */ jsxs("span", {
						className: "inline-flex items-center gap-1.5 text-[11.5px] text-ok",
						children: [
							/* @__PURE__ */ jsx(Check, {
								size: 11,
								"aria-hidden": "true"
							}),
							" ",
							i18nT("apps.codeReviewSage.components.shipSummaryCard.posted_to_the_pull_request")
						]
					}) : posting ? /* @__PURE__ */ jsxs("span", {
						className: "inline-flex items-center gap-1.5 text-[11.5px] text-muted",
						children: [/* @__PURE__ */ jsx(Loader2, {
							size: 11,
							className: "animate-spin motion-reduce:animate-none",
							"aria-hidden": "true"
						}), i18nT("apps.codeReviewSage.components.shipSummaryCard.posting")]
					}) : /* @__PURE__ */ jsxs("button", {
						type: "button",
						onClick: onPost,
						"aria-label": i18nT("apps.codeReviewSage.components.shipSummaryCard.post_the_ship_readiness_summary"),
						className: "inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2 py-1 text-[11.5px] text-text hover:text-accent hover:border-accent cursor-pointer",
						children: [/* @__PURE__ */ jsx(MessageSquarePlus, {
							size: 11,
							"aria-hidden": "true"
						}), i18nT("apps.codeReviewSage.components.shipSummaryCard.post_this_comment")]
					}) })
				]
			})
		]
	});
}
// src/components/BandChips.tsx
/** Per-band chip metadata. Class strings are static (not interpolated) so
* Tailwind's content scan keeps them. `on` = selected treatment, `off` = the
* quiet resting treatment.
*
* The label is held as a KEY, not a translated string: this table is
* module-level, so it evaluates once at import time — before any language
* switch — and a resolved string here would freeze the first locale for the
* process. The key is resolved per render instead. */
/** Label keys as full literals in one indexable map, so the key-resolution
*  gate can verify each one exists. Indexed at the call site, not read off a
*  local — that indirection is what made these sites unverifiable. */
var BAND_LABEL_KEY = {
	red: "apps.codeReviewSage.components.bandChips.needs_review",
	yellow: "apps.codeReviewSage.components.bandChips.worth_a_glance",
	green: "apps.codeReviewSage.components.bandChips.clean"
};
var BAND_META = {
	red: {
		dot: "text-danger",
		on: "bg-danger-subtle text-danger-text border-danger",
		off: "bg-card text-muted border-border hover:text-text"
	},
	yellow: {
		dot: "text-warn",
		on: "bg-warn-subtle text-warn-text border-warn",
		off: "bg-card text-muted border-border hover:text-text"
	},
	green: {
		dot: "text-ok",
		on: "bg-ok-subtle text-ok-text border-ok",
		off: "bg-card text-muted border-border hover:text-text"
	}
};
var BAND_ORDER = [
	"red",
	"yellow",
	"green"
];
/** A filter chip. The button is the interactive surface; `aria-pressed` carries
* the selected state for screen readers. */
function Chip({ label, count, dot, selected, on, off, onClick }) {
	return /* @__PURE__ */ jsxs("button", {
		type: "button",
		"aria-pressed": selected,
		onClick,
		className: "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[12px] font-medium cursor-pointer transition-colors focus-ring-accent " + (selected ? on : off),
		children: [
			dot && /* @__PURE__ */ jsx(Circle, {
				size: 8,
				className: `${dot} fill-current`,
				"aria-hidden": "true"
			}),
			/* @__PURE__ */ jsx("span", { children: label }),
			/* @__PURE__ */ jsx("span", {
				className: "tabular-nums opacity-70",
				children: count
			})
		]
	});
}
/** The band filter row. `active` defaults to 'all' (no narrowing). */
function BandChips({ bands, active = "all", onSelect }) {
	const total = bands.red + bands.yellow + bands.green;
	const select = (b) => onSelect?.(b);
	return /* @__PURE__ */ jsxs("div", {
		className: "flex flex-wrap items-center gap-2",
		role: "group",
		"aria-label": i18nT("apps.codeReviewSage.components.bandChips.filter_by_band"),
		children: [/* @__PURE__ */ jsx(Chip, {
			label: i18nT("apps.codeReviewSage.components.bandChips.all"),
			count: total,
			selected: active === "all",
			on: "bg-accent-subtle text-accent border-accent",
			off: "bg-card text-muted border-border hover:text-text",
			onClick: () => select("all")
		}), BAND_ORDER.map((band) => {
			const meta = BAND_META[band];
			return /* @__PURE__ */ jsx(Chip, {
				label: i18nT(BAND_LABEL_KEY[band]),
				count: bands[band],
				dot: meta.dot,
				selected: active === band,
				on: meta.on,
				off: meta.off,
				onClick: () => select(band)
			}, band);
		})]
	});
}
// src/components/ReportView.tsx
/** Sort order for the three bands — the report leads with what needs review. */
var BAND_RANK = {
	red: 0,
	yellow: 1,
	green: 2
};
/** Per-band dot colour for the row marker. */
var BAND_DOT = {
	red: "text-danger",
	yellow: "text-warn",
	green: "text-ok"
};
/** A neutral, uppercase, tracked section label with a bottom divider — the
* treatment lifted from Issue Radar's PrDetail `Section`. */
function SectionLabel({ children }) {
	return /* @__PURE__ */ jsx("div", {
		className: "text-[10.5px] font-semibold uppercase tracking-wider text-muted mb-1",
		children
	});
}
/** A small neutral pill (design risk / blast radius). */
function Pill({ children }) {
	return /* @__PURE__ */ jsx("span", {
		className: "inline-flex items-center rounded-full bg-bg-elevated text-muted border border-border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap",
		children
	});
}
/** Derive the `#<number>` label for a PR/MR from its URL, falling back to the
* change_id when no numeric segment is present (pasted/odd links). */
function prLabel(row) {
	try {
		const segments = new URL(row.url).pathname.split("/").filter((s) => /^\d+$/.test(s));
		if (segments.length) return `#${segments[segments.length - 1]}`;
	} catch {}
	return row.change_id || "#?";
}
/** Split a design-section value into scannable lines — mirrors report.py
* `_design_facets`. The reviewer emits `solution_assessment` as short labeled
* facets on SEPARATE LINES (see `review_driver.build_review_task`), but this view
* used to hand the whole value to the markdown renderer, which collapsed them
* into one dense paragraph — the archived HTML report split them and the app did
* not. A record predating the structured prompt is one long prose blob, so that
* case falls back to splitting on sentences rather than rendering a wall.
*
* `labeled` reports WHICH of those two splits produced the lines, because only a
* real facet line may have a `Label:` prefix pulled out: prose with an early colon
* ("The API returns 404: …") is a sentence, not a label, and treating it as one
* crams the clause into the narrow label column.
*
* The sentence split deliberately avoids a lookbehind (`(?<=[.!?])`). WebKit only
* shipped lookbehind in Safari 16.4, and an unsupported group is a SyntaxError at
* MODULE EVALUATION — so it would take the whole app down on an older browser,
* not just degrade this view. */
function designFacets(value) {
	const s = value.trim();
	const lines = s.split("\n").map((l) => l.replace(/^[\s\-•]+/, "").trim()).filter(Boolean);
	if (lines.length <= 1 && s.length > 160) return {
		lines: (s.match(/(?:[^.!?]|[.!?](?=\S))+[.!?]*/g) ?? []).map((seg) => seg.trim()).filter(Boolean),
		labeled: false
	};
	return {
		lines: lines.length ? lines : s ? [s] : [],
		labeled: true
	};
}
/** One facet line. On a real facet line a leading `Label:` prefix is pulled into
* its own column so the facets read as a labeled list instead of running together
* — mirrors `_facet_html`. Sentence-fallback lines are left whole. */
function Facet({ line, labeled }) {
	const m = labeled ? /^([A-Z][\w /&'+-]{1,40}):\s+(.*)$/.exec(line) : null;
	if (!m) return /* @__PURE__ */ jsx("div", {
		className: "text-[12.5px] leading-relaxed",
		children: line
	});
	return /* @__PURE__ */ jsxs("div", {
		className: "flex gap-2.5 text-[12.5px] leading-relaxed",
		children: [/* @__PURE__ */ jsx("span", {
			className: "w-[96px] flex-shrink-0 font-semibold text-muted",
			children: m[1]
		}), /* @__PURE__ */ jsx("span", {
			className: "min-w-0 flex-1",
			children: m[2]
		})]
	});
}
/** The design narrative as a scannable chain — mirrors report.py `_design_html`:
* the headline, then Problem / Why it matters / Solution fit, falling back to the
* freeform rationale for records predating the structured fields. */
function DesignChain({ row }) {
	const present = [
		[i18nT("apps.codeReviewSage.components.reportView.step_problem"), row.problem],
		[i18nT("apps.codeReviewSage.components.reportView.step_why_it_matters"), row.why_it_matters],
		[i18nT("apps.codeReviewSage.components.reportView.step_solution_fit"), row.solution_assessment]
	].filter(([, v]) => v && v.trim());
	const hasHeadline = Boolean(row.design_headline && row.design_headline.trim());
	if (!hasHeadline && present.length === 0) {
		if (!row.rationale || !row.rationale.trim()) return null;
		return /* @__PURE__ */ jsx(MarkdownRenderer, { content: row.rationale });
	}
	return /* @__PURE__ */ jsxs("div", {
		className: "space-y-3",
		children: [hasHeadline && /* @__PURE__ */ jsx("div", {
			className: "text-[13px] font-semibold leading-snug text-text-strong",
			children: /* @__PURE__ */ jsx(MarkdownRenderer, { content: row.design_headline })
		}), present.map(([label, value]) => {
			const { lines: facets, labeled } = designFacets(value);
			return /* @__PURE__ */ jsxs("div", { children: [/* @__PURE__ */ jsx(SectionLabel, { children: label }), facets.length > 1 ? /* @__PURE__ */ jsx("div", {
				className: "space-y-1",
				children: facets.map((line, i) => /* @__PURE__ */ jsx(Facet, {
					line,
					labeled
				}, i))
			}) : /* @__PURE__ */ jsx(MarkdownRenderer, { content: value })] }, label);
		})]
	});
}
/** A row's blocking / should-fix counts with its dismissed findings taken out.
*  A dismissed finding no longer asks for action, so the header chips must not
*  count it. Severity is read the way FindingCard reads it: only `red` blocks. */
function liveSeverityCounts(row, dismissed) {
	let red = row.red;
	let yellow = row.yellow;
	(row.findings ?? []).forEach((f, i) => {
		if (!dismissed?.[`finding:${i}`]) return;
		if (f.severity === "red") red -= 1;
		else yellow -= 1;
	});
	return {
		red: Math.max(0, red),
		yellow: Math.max(0, yellow)
	};
}
/** One report row: a summary header (expand button + PR link + badges + the
* band rationale) over a collapsible detail area (design chain + findings). */
function ReportRowCard({ row, postedKeys, isPosting, onPostFinding, selected, onToggleKey, dismissed, onDismissFinding, moved = false }) {
	const [open, setOpen] = useState(false);
	const findings = row.findings ?? [];
	const live = liveSeverityCounts(row, dismissed);
	const hasDetail = Boolean(row.design_headline || row.problem || row.why_it_matters || row.solution_assessment || row.rationale || findings.length);
	const href = safeHttpUrl(row.url);
	return /* @__PURE__ */ jsxs("div", {
		className: "rounded-lg border border-border bg-card overflow-hidden",
		children: [/* @__PURE__ */ jsxs("div", {
			className: "flex items-start gap-2 px-3.5 py-3",
			children: [href ? /* @__PURE__ */ jsx("a", {
				href,
				target: "_blank",
				rel: "noreferrer",
				className: "font-mono text-[12.5px] text-accent hover:underline flex-shrink-0 pt-0.5",
				title: i18nT("apps.codeReviewSage.components.reportView.open_the_pull_request"),
				children: prLabel(row)
			}) : /* @__PURE__ */ jsx("span", {
				className: "font-mono text-[12.5px] text-muted flex-shrink-0 pt-0.5",
				children: prLabel(row)
			}), /* @__PURE__ */ jsxs("button", {
				type: "button",
				"aria-expanded": open,
				disabled: !hasDetail,
				onClick: () => setOpen((v) => !v),
				className: "group flex-1 min-w-0 text-left flex items-start gap-2 cursor-pointer disabled:cursor-default bg-transparent",
				children: [
					/* @__PURE__ */ jsx("span", {
						className: `${BAND_DOT[row.band]} mt-1 flex-shrink-0`,
						"aria-hidden": "true",
						children: /* @__PURE__ */ jsx("span", { className: "inline-block w-2 h-2 rounded-full bg-current" })
					}),
					/* @__PURE__ */ jsxs("span", {
						className: "flex-1 min-w-0",
						children: [/* @__PURE__ */ jsx("span", {
							className: "block text-[13.5px] font-semibold text-text-strong leading-snug break-words",
							children: /* @__PURE__ */ jsx(MarkdownRenderer, { content: row.title })
						}), /* @__PURE__ */ jsxs("span", {
							className: "mt-1.5 flex flex-wrap items-center gap-1.5",
							children: [
								/* @__PURE__ */ jsx(Pill, { children: i18nT("apps.codeReviewSage.components.reportView.design_risk", { level: row.design_risk }) }),
								/* @__PURE__ */ jsx(Pill, { children: i18nT("apps.codeReviewSage.components.reportView.blast_radius", { scope: row.blast }) }),
								live.red > 0 && /* @__PURE__ */ jsx("span", {
									className: "inline-flex items-center rounded-full bg-danger-subtle text-danger-text px-2 py-0.5 text-[11px] font-medium whitespace-nowrap",
									children: i18nT("apps.codeReviewSage.components.reportView.blocking_count", { count: live.red })
								}),
								live.yellow > 0 && /* @__PURE__ */ jsx("span", {
									className: "inline-flex items-center rounded-full bg-warn-subtle text-warn-text px-2 py-0.5 text-[11px] font-medium whitespace-nowrap",
									children: i18nT("apps.codeReviewSage.components.reportView.should_fix_count", { count: live.yellow })
								}),
								moved && /* @__PURE__ */ jsx("span", {
									className: "text-[11px] text-muted",
									children: i18nT("apps.codeReviewSage.components.reportView.moved_to", { band: i18nT(BAND_LABEL_KEY[row.band]) })
								})
							]
						})]
					}),
					hasDetail && /* @__PURE__ */ jsx(ChevronRight, {
						size: 16,
						className: `text-muted flex-shrink-0 mt-0.5 transition-transform ${open ? "rotate-90" : ""}`,
						"aria-hidden": "true"
					})
				]
			})]
		}), open && hasDetail && /* @__PURE__ */ jsxs("div", {
			className: "px-3.5 pb-3.5 pt-1 border-t border-border",
			children: [
				/* @__PURE__ */ jsxs("div", {
					className: "rounded-lg border border-border bg-bg-elevated px-3.5 py-3 mb-2",
					children: [/* @__PURE__ */ jsxs("div", {
						className: "flex items-center gap-1.5 mb-2",
						children: [/* @__PURE__ */ jsx(ShieldCheck, {
							size: 12,
							className: "text-muted",
							"aria-hidden": "true"
						}), /* @__PURE__ */ jsxs(SectionLabel, { children: [
							i18nT("apps.codeReviewSage.components.reportView.design_gate"),
							" ",
							row.gate_verdict
						] })]
					}), /* @__PURE__ */ jsx(DesignChain, { row })]
				}),
				/* @__PURE__ */ jsx(ShipSummaryCard, {
					body: row.ship_comment ?? "",
					posted: postedKeys?.includes("design") ?? false,
					posting: !(postedKeys?.includes("design") ?? false) && Boolean(isPosting?.("design")),
					selectable: Boolean(onToggleKey),
					selected: selected?.has("design") ?? false,
					onToggle: onToggleKey ? () => onToggleKey(row.change_id, "design") : void 0,
					onPost: !(postedKeys?.includes("design") ?? false) && onPostFinding ? () => onPostFinding(row.change_id, "design") : void 0
				}),
				findings.map((f, i) => {
					const key = `finding:${i}`;
					const sent = postedKeys?.includes(key) ?? false;
					return /* @__PURE__ */ jsx(FindingCard, {
						finding: f,
						posted: sent,
						posting: !sent && Boolean(isPosting?.(key)),
						selectable: Boolean(onToggleKey),
						selected: selected?.has(key) ?? false,
						onToggle: onToggleKey ? () => onToggleKey(row.change_id, key) : void 0,
						label: f.file ? i18nT("apps.codeReviewSage.components.reportView.finding_dimension_in_file", {
							dimension: f.dimension,
							file: f.file
						}) : f.dimension,
						onPost: !sent && !dismissed?.[key] && onPostFinding ? () => onPostFinding(row.change_id, key) : void 0,
						dismissed: dismissed?.[key] ?? null,
						onDismiss: onDismissFinding ? (reason) => onDismissFinding(row.change_id, key, reason) : void 0
					}, i);
				})
			]
		})]
	});
}
function ReportView({ report, onArchive, archiving = false, archiveError = null, actions = null, postedKeys, isPosting, onPostFinding, onPostSelection, dismissed, onDismissFinding }) {
	const [active, setActive] = useState("all");
	const [selected, setSelected] = useState(/* @__PURE__ */ new Map());
	const toggleKey = useCallback((changeId, key) => {
		setSelected((cur) => {
			const next = new Map(cur);
			const keys = new Set(next.get(changeId) ?? []);
			if (keys.has(key)) keys.delete(key);
			else keys.add(key);
			if (keys.size === 0) next.delete(changeId);
			else next.set(changeId, keys);
			return next;
		});
	}, []);
	const dismissFinding = useMemo(() => onDismissFinding ? async (changeId, key, reason) => {
		await onDismissFinding(changeId, key, reason);
		if (reason === null) return;
		setSelected((cur) => {
			const keys = cur.get(changeId);
			if (!keys?.has(key)) return cur;
			const next = new Map(cur);
			const rest = new Set(keys);
			rest.delete(key);
			if (rest.size === 0) next.delete(changeId);
			else next.set(changeId, rest);
			return next;
		});
	} : void 0, [onDismissFinding]);
	const selectedCount = useMemo(() => [...selected.values()].reduce((n, s) => n + s.size, 0), [selected]);
	const seen = useRef(/* @__PURE__ */ new Map());
	const held = useRef(/* @__PURE__ */ new Map());
	const heldIn = useRef({
		active,
		run: report.run_id
	});
	const { rows, moved } = useMemo(() => {
		if (heldIn.current.run !== report.run_id) {
			seen.current = /* @__PURE__ */ new Map();
			held.current = /* @__PURE__ */ new Map();
			heldIn.current = {
				active,
				run: report.run_id
			};
		} else if (heldIn.current.active !== active) {
			held.current = /* @__PURE__ */ new Map();
			heldIn.current = {
				active,
				run: report.run_id
			};
		}
		const next = /* @__PURE__ */ new Map();
		for (const r of report.rows) {
			const was = seen.current.get(r.change_id);
			if (active !== "all" && was && was.band !== r.band && !held.current.has(r.change_id)) held.current.set(r.change_id, was);
			next.set(r.change_id, {
				band: r.band,
				score: r.score
			});
		}
		seen.current = next;
		const place = (r) => held.current.get(r.change_id) ?? r;
		const sorted = [...report.rows].sort((a, b) => {
			const pa = place(a);
			const pb = place(b);
			return BAND_RANK[pa.band] - BAND_RANK[pb.band] || pb.score - pa.score;
		});
		const shown = active === "all" ? sorted : sorted.filter((r) => place(r).band === active);
		return {
			rows: shown,
			moved: new Set(shown.filter((r) => place(r).band !== r.band).map((r) => r.change_id))
		};
	}, [
		report.rows,
		report.run_id,
		active
	]);
	const generatedLabel = report.generated_at ? fmtDateTime(report.generated_at) : "";
	return /* @__PURE__ */ jsxs("div", {
		className: "flex flex-col gap-3",
		children: [
			/* @__PURE__ */ jsxs("div", {
				className: "flex items-center justify-between gap-3 flex-wrap",
				children: [/* @__PURE__ */ jsxs("div", {
					className: "text-[12.5px] text-muted",
					children: [i18nT("apps.codeReviewSage.components.reportView.changes_reviewed", { count: report.total }), generatedLabel && /* @__PURE__ */ jsxs("span", { children: [
						" ",
						i18nT("apps.codeReviewSage.components.reportView.generated"),
						" ",
						generatedLabel
					] })]
				}), /* @__PURE__ */ jsxs("div", {
					className: "flex items-center gap-3 flex-wrap",
					children: [selectedCount > 0 && onPostSelection ? /* @__PURE__ */ jsxs("span", {
						className: "inline-flex items-center gap-2",
						children: [/* @__PURE__ */ jsxs("button", {
							type: "button",
							onClick: () => {
								Promise.resolve(onPostSelection([...selected.entries()].map(([changeId, keys]) => ({
									changeId,
									keys: [...keys]
								})))).then(() => setSelected(/* @__PURE__ */ new Map())).catch(() => {});
							},
							className: "inline-flex items-center gap-1.5 rounded-md border border-accent bg-accent-subtle px-2.5 py-1 text-[12.5px] font-medium text-accent hover:bg-accent/20 cursor-pointer",
							children: [/* @__PURE__ */ jsx(MessageSquarePlus, {
								size: 13,
								"aria-hidden": "true"
							}), i18nT("apps.codeReviewSage.components.reportView.draft_selected", { count: selectedCount })]
						}), /* @__PURE__ */ jsx("button", {
							type: "button",
							onClick: () => setSelected(/* @__PURE__ */ new Map()),
							className: "rounded-md bg-transparent px-1.5 py-1 text-[12.5px] text-muted hover:text-text cursor-pointer",
							children: i18nT("apps.codeReviewSage.components.reportView.clear")
						})]
					}) : actions, report.report_slug ? /* @__PURE__ */ jsxs("a", {
						href: `/artifacts/${report.report_slug}`,
						className: "inline-flex items-center gap-1.5 text-[12.5px] text-accent hover:underline",
						children: [
							/* @__PURE__ */ jsx(ExternalLink, {
								size: 13,
								"aria-hidden": "true"
							}),
							" ",
							i18nT("apps.codeReviewSage.components.reportView.open_shared_copy")
						]
					}) : onArchive ? /* @__PURE__ */ jsxs("button", {
						type: "button",
						onClick: onArchive,
						disabled: archiving,
						className: "inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1 text-[12.5px] text-text hover:text-accent hover:border-accent disabled:opacity-50 cursor-pointer disabled:cursor-default",
						children: [archiving ? /* @__PURE__ */ jsx(Loader2, {
							size: 13,
							className: "animate-spin",
							"aria-hidden": "true"
						}) : /* @__PURE__ */ jsx(Share2, {
							size: 13,
							"aria-hidden": "true"
						}), archiving ? i18nT("apps.codeReviewSage.components.reportView.sharing") : i18nT("apps.codeReviewSage.components.reportView.share")]
					}) : null]
				})]
			}),
			archiveError && /* @__PURE__ */ jsx(ErrorNotice, {
				message: archiveError,
				variant: "inline",
				askAgent: true
			}),
			/* @__PURE__ */ jsx(BandChips, {
				bands: report.bands,
				active,
				onSelect: setActive
			}),
			report.rows.length === 0 ? /* @__PURE__ */ jsxs("div", {
				className: "flex flex-col items-center justify-center gap-2 py-16 text-center text-muted",
				children: [/* @__PURE__ */ jsx(ClipboardCheck, {
					size: 28,
					"aria-hidden": "true"
				}), /* @__PURE__ */ jsx("div", {
					className: "text-[13px]",
					children: i18nT("apps.codeReviewSage.components.reportView.nothing_flagged_in_this_review")
				})]
			}) : rows.length === 0 ? /* @__PURE__ */ jsx("div", {
				className: "py-8 text-center text-[12.5px] text-muted",
				children: i18nT("apps.codeReviewSage.components.reportView.no_changes_in_this_band")
			}) : /* @__PURE__ */ jsx("div", {
				className: "flex flex-col gap-2",
				children: rows.map((row) => /* @__PURE__ */ jsx(ReportRowCard, {
					row,
					postedKeys: postedKeys?.[row.change_id],
					isPosting,
					onPostFinding,
					selected: selected.get(row.change_id),
					onToggleKey: onPostSelection ? toggleKey : void 0,
					dismissed: dismissed?.[row.change_id],
					onDismissFinding: dismissFinding,
					moved: moved.has(row.change_id)
				}, row.change_id || row.url))
			})
		]
	});
}
// src/components/DraftReviewActions.tsx
function DraftReviewActions({ url, draftDelivered }) {
	const href = safeHttpUrl(url);
	if (!draftDelivered || !href) return null;
	return /* @__PURE__ */ jsxs("section", {
		className: "rounded-md border border-border px-3 py-2.5 flex flex-col gap-1.5",
		children: [
			/* @__PURE__ */ jsx("div", {
				className: "text-[12.5px] font-medium text-text",
				children: i18nT("apps.codeReviewSage.components.draftReviewActions.draft_review")
			}),
			/* @__PURE__ */ jsx("div", {
				className: "text-[12px] leading-[1.6] text-muted",
				children: i18nT("apps.codeReviewSage.components.draftReviewActions.pending_only_you_can_see_it_until_you_publish")
			}),
			/* @__PURE__ */ jsxs("a", {
				href,
				target: "_blank",
				rel: "noreferrer",
				className: "inline-flex w-fit items-center gap-1 text-[12.5px] text-accent hover:underline",
				children: [i18nT("apps.codeReviewSage.components.prReviewDetail.open_on_github"), /* @__PURE__ */ jsx(ExternalLink, {
					size: 11,
					"aria-hidden": "true"
				})]
			})
		]
	});
}
// src/components/FailureNotice.tsx
function FailureNotice({ run, changeId, onRetry, retrying = false }) {
	const reason = failureReason(run, changeId);
	if (!reason) return null;
	const message = reason.raw && reason.raw !== reason.text ? `${reason.text}\n${reason.raw}` : reason.text;
	return /* @__PURE__ */ jsxs("div", {
		className: "flex flex-col items-start gap-2",
		children: [/* @__PURE__ */ jsx(ErrorNotice, {
			title: i18nT("apps.codeReviewSage.components.failureNotice.this_review_failed"),
			message,
			askAgent: true,
			className: "w-full"
		}), onRetry && /* @__PURE__ */ jsxs("button", {
			type: "button",
			onClick: onRetry,
			disabled: retrying,
			className: "inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1 text-[12px] text-text hover:text-accent hover:border-accent disabled:opacity-50 cursor-pointer disabled:cursor-default",
			children: [retrying ? /* @__PURE__ */ jsx(Loader2, {
				size: 12,
				className: "animate-spin motion-reduce:animate-none",
				"aria-hidden": "true"
			}) : /* @__PURE__ */ jsx(RotateCcw, {
				size: 12,
				"aria-hidden": "true"
			}), retrying ? i18nT("apps.codeReviewSage.components.failureNotice.starting") : i18nT("apps.codeReviewSage.components.failureNotice.run_it_again")]
		})]
	});
}
// src/components/PrStatusChips.tsx
/** Chip treatments are static class strings so Tailwind's content scan keeps them. */
var CHIP = "inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded-full border";
/** Open / merged / closed / draft. A draft is still "open" to the provider, so it
*  is reported separately rather than replacing the state. */
function StateChip({ src }) {
	if (src.mergedAt) return /* @__PURE__ */ jsxs("span", {
		className: `${CHIP} border-accent text-accent bg-accent-subtle`,
		children: [
			/* @__PURE__ */ jsx(GitMerge, {
				size: 10,
				"aria-hidden": "true"
			}),
			" ",
			i18nT("apps.codeReviewSage.components.prStatusChips.merged")
		]
	});
	if ((src.state || "").toLowerCase() === "closed") return /* @__PURE__ */ jsxs("span", {
		className: `${CHIP} border-danger text-danger`,
		children: [
			/* @__PURE__ */ jsx(XCircle, {
				size: 10,
				"aria-hidden": "true"
			}),
			" ",
			i18nT("apps.codeReviewSage.components.prStatusChips.closed")
		]
	});
	return /* @__PURE__ */ jsxs("span", {
		className: `${CHIP} border-ok text-ok-text bg-ok-subtle`,
		children: [
			/* @__PURE__ */ jsx(GitPullRequest, {
				size: 10,
				"aria-hidden": "true"
			}),
			" ",
			i18nT("apps.codeReviewSage.components.prStatusChips.open")
		]
	});
}
/** Only shown when it is actionable. "Mergeable" on an open PR is the expected
*  case and saying so on every one would be noise; a conflict is not. */
function MergeChip({ src }) {
	if (src.mergedAt) return null;
	if ((src.mergeable || "").toLowerCase() === "conflicting") return /* @__PURE__ */ jsxs("span", {
		className: `${CHIP} border-danger text-danger`,
		children: [
			/* @__PURE__ */ jsx(AlertTriangle, {
				size: 10,
				"aria-hidden": "true"
			}),
			" ",
			i18nT("apps.codeReviewSage.components.prStatusChips.conflicts")
		]
	});
	if ((src.mergeStateStatus || "").toUpperCase() === "BLOCKED") return /* @__PURE__ */ jsxs("span", {
		className: `${CHIP} border-warn text-warn`,
		children: [
			/* @__PURE__ */ jsx(AlertTriangle, {
				size: 10,
				"aria-hidden": "true"
			}),
			" ",
			i18nT("apps.codeReviewSage.components.prStatusChips.merge_blocked")
		]
	});
	return null;
}
/** The check rollup, worst-first. Failing counts beat pending counts because a
*  failure is the thing that stops the PR. */
function ChecksChip({ src }) {
	const checks = src.checks ?? [];
	if (!checks.length) return null;
	const failed = checks.filter((c) => c.bucket === "failed").length;
	const pending = checks.filter((c) => c.bucket === "pending").length;
	if (failed > 0) return /* @__PURE__ */ jsxs("span", {
		className: `${CHIP} border-danger text-danger`,
		title: i18nT("apps.codeReviewSage.components.prStatusChips.checks_failing", {
			failed,
			count: checks.length
		}),
		children: [/* @__PURE__ */ jsx(XCircle, {
			size: 10,
			"aria-hidden": "true"
		}), /* @__PURE__ */ jsx("span", {
			className: "tabular-nums",
			children: i18nT("apps.codeReviewSage.components.prStatusChips.failing_count", { count: failed })
		})]
	});
	if (pending > 0) return /* @__PURE__ */ jsxs("span", {
		className: `${CHIP} border-border text-muted`,
		title: i18nT("apps.codeReviewSage.components.prStatusChips.checks_running", {
			pending,
			count: checks.length
		}),
		children: [/* @__PURE__ */ jsx(Clock, {
			size: 10,
			"aria-hidden": "true"
		}), /* @__PURE__ */ jsx("span", {
			className: "tabular-nums",
			children: i18nT("apps.codeReviewSage.components.prStatusChips.running_count", { count: pending })
		})]
	});
	return /* @__PURE__ */ jsxs("span", {
		className: `${CHIP} border-ok text-ok`,
		title: i18nT("apps.codeReviewSage.components.prStatusChips.all_checks_passed", { count: checks.length }),
		children: [/* @__PURE__ */ jsx(CheckCircle2, {
			size: 10,
			"aria-hidden": "true"
		}), /* @__PURE__ */ jsx("span", {
			className: "tabular-nums",
			children: i18nT("apps.codeReviewSage.components.prStatusChips.passed_count", { count: checks.length })
		})]
	});
}
function PrStatusChips({ src }) {
	if (!src) return null;
	return /* @__PURE__ */ jsxs(Fragment, { children: [
		/* @__PURE__ */ jsx(StateChip, { src }),
		/* @__PURE__ */ jsx(MergeChip, { src }),
		/* @__PURE__ */ jsx(ChecksChip, { src })
	] });
}
// src/components/ReviewChat.tsx
/** Codes the backend can return, mapped to localized copy. An unmapped code falls
*  back to a generic string rather than showing the server's English prose inside
*  a translated page. */
var REASON_KEY = {
	followup_not_recorded: "apps.codeReviewSage.components.reviewChat.not_recorded_notice",
	followup_transcript_gone: "apps.codeReviewSage.components.reviewChat.transcript_gone_notice",
	followup_run_live: "apps.codeReviewSage.components.reviewChat.run_live_notice",
	chat_run_deleted: "apps.codeReviewSage.components.reviewChat.error_run_deleted"
};
function reasonText(code) {
	const key = REASON_KEY[code];
	return key ? i18nT(key) : i18nT("apps.codeReviewSage.components.reviewChat.error_generic");
}
function Reasoning({ text }) {
	const [open, setOpen] = useState(false);
	if (!text.trim()) return null;
	return /* @__PURE__ */ jsxs("div", {
		className: "mt-1",
		children: [/* @__PURE__ */ jsxs("button", {
			type: "button",
			onClick: () => setOpen((v) => !v),
			"aria-expanded": open,
			className: "inline-flex items-center gap-1 text-[11px] text-muted hover:text-text cursor-pointer",
			children: [open ? /* @__PURE__ */ jsx(ChevronDown, { size: 11 }) : /* @__PURE__ */ jsx(ChevronRight, { size: 11 }), i18nT("apps.codeReviewSage.components.reviewChat.reasoning")]
		}), open && /* @__PURE__ */ jsx("div", {
			className: "mt-1 whitespace-pre-wrap border-l border-border pl-2 text-[11.5px] leading-[1.6] text-muted",
			children: text
		})]
	});
}
function Turn({ turn }) {
	const mine = turn.role === "user";
	return /* @__PURE__ */ jsxs("div", {
		className: "flex flex-col gap-0.5",
		children: [
			/* @__PURE__ */ jsx("div", {
				className: "text-[10px] font-medium uppercase tracking-wide text-muted",
				children: mine ? i18nT("apps.codeReviewSage.components.reviewChat.role_you") : i18nT("apps.codeReviewSage.components.reviewChat.role_reviewer")
			}),
			/* @__PURE__ */ jsx("div", {
				className: "text-[12.5px] leading-[1.65] text-text",
				children: mine ? /* @__PURE__ */ jsx("div", {
					className: "whitespace-pre-wrap",
					children: turn.text
				}) : /* @__PURE__ */ jsx(MarkdownRenderer, { content: turn.text })
			}),
			!mine && /* @__PURE__ */ jsx(Reasoning, { text: turn.thinking }),
			!mine && turn.tools.length > 0 && /* @__PURE__ */ jsx("div", {
				className: "mt-0.5 text-[11px] text-muted",
				children: i18nT("apps.codeReviewSage.components.reviewChat.ran_tools", { tools: turn.tools.join(", ") })
			}),
			!mine && turn.refusals.length > 0 && /* @__PURE__ */ jsxs("div", {
				className: "mt-1 inline-flex items-start gap-1.5 text-[11.5px] text-danger",
				children: [/* @__PURE__ */ jsx(TriangleAlert, {
					size: 12,
					className: "mt-0.5 flex-shrink-0"
				}), /* @__PURE__ */ jsx("span", { children: i18nT("apps.codeReviewSage.components.reviewChat.refused_notice") })]
			})
		]
	});
}
function ReviewChat({ runId, changeId }) {
	const [open, setOpen] = useState(false);
	const [error, setError] = useState("");
	const { openChat } = useChatLauncher();
	const stateQ = useQuery({
		queryKey: [
			"sage",
			"chat",
			runId,
			changeId
		],
		queryFn: () => sageApi.chatState(runId, changeId),
		enabled: open && Boolean(runId) && Boolean(changeId)
	});
	const state = stateQ.data;
	const turns = state?.turns ?? [];
	const resumable = Boolean(state?.resumable);
	const alreadyOpen = Boolean(state?.followup_open);
	const start = useMutation({
		mutationFn: async () => {
			return (await sageApi.followupStart(runId, changeId)).slot_key;
		},
		onSuccess: (slotKey) => {
			setError("");
			openChat({ slotKey });
		},
		onError: (e) => {
			const raw = e instanceof SageApiError ? e.code : "";
			setError(reasonText(raw.split(":", 1)[0].trim()));
			stateQ.refetch();
		}
	});
	return /* @__PURE__ */ jsxs("div", {
		className: "rounded-md border border-border",
		children: [/* @__PURE__ */ jsxs("button", {
			type: "button",
			onClick: () => setOpen((v) => !v),
			"aria-expanded": open,
			className: "flex w-full items-center gap-2 px-2.5 py-2 text-[12.5px] text-text hover:bg-bg-elevated cursor-pointer",
			children: [
				open ? /* @__PURE__ */ jsx(ChevronDown, {
					size: 13,
					className: "flex-shrink-0 text-muted"
				}) : /* @__PURE__ */ jsx(ChevronRight, {
					size: 13,
					className: "flex-shrink-0 text-muted"
				}),
				/* @__PURE__ */ jsx(MessageCircle, {
					size: 13,
					className: "flex-shrink-0 text-muted"
				}),
				/* @__PURE__ */ jsx("span", {
					className: "min-w-0 flex-1 truncate text-left",
					children: i18nT("apps.codeReviewSage.components.reviewChat.title")
				}),
				turns.length > 0 && /* @__PURE__ */ jsx("span", {
					className: "flex-shrink-0 tabular-nums text-[11px] text-muted",
					children: turns.length
				})
			]
		}), open && /* @__PURE__ */ jsxs("div", {
			className: "flex flex-col gap-3 border-t border-border px-2.5 py-2.5",
			children: [
				stateQ.isLoading && /* @__PURE__ */ jsx("div", {
					className: "text-[12px] leading-[1.6] text-muted",
					children: i18nT("apps.codeReviewSage.components.reviewChat.loading")
				}),
				turns.length > 0 && /* @__PURE__ */ jsxs("div", {
					className: "flex flex-col gap-3",
					children: [/* @__PURE__ */ jsx("div", {
						className: "text-[10px] font-medium uppercase tracking-wide text-muted",
						children: i18nT("apps.codeReviewSage.components.reviewChat.earlier_questions")
					}), turns.map((t, i) => /* @__PURE__ */ jsx(Turn, { turn: t }, `${t.ts}-${i}`))]
				}),
				!stateQ.isLoading && /* @__PURE__ */ jsx("div", {
					className: turns.length > 0 ? "flex flex-col gap-2 border-t border-border pt-2.5" : "flex flex-col gap-2",
					children: resumable && !alreadyOpen ? /* @__PURE__ */ jsx("div", {
						className: "text-[12px] leading-[1.6] text-muted",
						children: i18nT("apps.codeReviewSage.components.reviewChat.new_session_unavailable")
					}) : resumable ? /* @__PURE__ */ jsxs(Fragment, { children: [/* @__PURE__ */ jsx("div", {
						className: "text-[12px] leading-[1.6] text-muted",
						children: alreadyOpen ? i18nT("apps.codeReviewSage.components.reviewChat.continue_hint") : i18nT("apps.codeReviewSage.components.reviewChat.resume_hint")
					}), /* @__PURE__ */ jsxs("button", {
						type: "button",
						onClick: () => start.mutate(),
						disabled: start.isPending,
						className: "inline-flex w-fit items-center gap-1.5 rounded-md border border-accent bg-accent-subtle px-2.5 py-1 text-[12.5px] font-medium text-accent hover:bg-accent/20 disabled:opacity-50 cursor-pointer",
						children: [/* @__PURE__ */ jsx(MessageCircle, { size: 12 }), start.isPending ? i18nT("apps.codeReviewSage.components.reviewChat.opening") : alreadyOpen ? i18nT("apps.codeReviewSage.components.reviewChat.continue_session") : i18nT("apps.codeReviewSage.components.reviewChat.open_session")]
					})] }) : /* @__PURE__ */ jsx("div", {
						className: "text-[12px] leading-[1.6] text-muted",
						children: reasonText(state?.reason || "")
					})
				}),
				error && /* @__PURE__ */ jsx(ErrorNotice, {
					message: error,
					variant: "inline",
					askAgent: true
				})
			]
		})]
	});
}
// src/components/RunProgress.tsx
/** Icon + colour for a per-change phase. Static class strings so Tailwind keeps
* them; the reviewing spinner respects motion-reduce. */
function phaseVisual(phase) {
	switch (phase) {
		case "reviewing": return {
			Icon: Loader2,
			color: "text-accent",
			spin: true
		};
		case "done": return {
			Icon: CheckCircle2,
			color: "text-ok"
		};
		case "failed": return {
			Icon: XCircle,
			color: "text-danger"
		};
		case "cancelled": return {
			Icon: CircleSlash,
			color: "text-muted"
		};
		default: return {
			Icon: Clock,
			color: "text-muted"
		};
	}
}
/** One change's live row: its parsed identity, a phase icon, and the phase
* label. */
function ChangeRow({ change, entry }) {
	const phase = entry?.phase ?? "queued";
	const { Icon, color, spin } = phaseVisual(phase);
	return /* @__PURE__ */ jsxs("li", {
		className: "flex items-center justify-between gap-2 py-1 text-[12px]",
		children: [/* @__PURE__ */ jsx("span", {
			className: "min-w-0 truncate text-text",
			children: prLabelFromChange(change) || change
		}), /* @__PURE__ */ jsxs("span", {
			className: `inline-flex flex-shrink-0 items-center gap-1.5 ${color}`,
			children: [/* @__PURE__ */ jsx(Icon, {
				size: 13,
				className: spin ? "animate-spin motion-reduce:animate-none" : "",
				"aria-hidden": "true"
			}), phaseLabel(phase)]
		})]
	});
}
function RunProgress({ run, pool, onCancel, cancelling = false, typicalMs = null }) {
	const running = run.status === "running";
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		if (!running) return;
		const id = setInterval(() => setNow(Date.now()), 1e3);
		return () => clearInterval(id);
	}, [running]);
	const total = run.changes.length;
	const tally = run.changes.reduce((acc, change, i) => {
		const cid = run.change_ids?.[i] ?? change;
		const phase = run.progress?.[cid]?.phase;
		if (!phase || !TERMINAL_PHASES.has(phase)) return acc;
		if (phase === "done") return {
			...acc,
			done: acc.done + 1,
			terminal: acc.terminal + 1
		};
		if (phase === "failed") return {
			...acc,
			failed: acc.failed + 1,
			terminal: acc.terminal + 1
		};
		return {
			...acc,
			cancelled: acc.cancelled + 1,
			terminal: acc.terminal + 1
		};
	}, {
		done: 0,
		failed: 0,
		cancelled: 0,
		terminal: 0
	});
	const pct = total > 0 ? Math.round(tally.terminal / total * 100) : 0;
	const barFill = !running && tally.failed > 0 && tally.done === 0 ? "bg-danger" : "bg-accent";
	const activity = run.changes.reduce((best, change, i) => {
		const cid = run.change_ids?.[i] ?? change;
		const entry = run.progress?.[cid];
		if (entry?.phase !== "reviewing" || !entry.activity) return best;
		return !best || entry.activity.step > best.step ? entry.activity : best;
	}, null);
	const elapsed = formatElapsed(runElapsedMs(run.started_at, run.finished_at, now));
	const cancelRequested = Boolean(run.cancel_requested_at) || cancelling;
	return /* @__PURE__ */ jsxs("div", {
		className: "flex flex-col gap-3",
		children: [
			/* @__PURE__ */ jsxs("div", {
				className: "flex items-center justify-between gap-2 text-[12px] text-muted",
				children: [/* @__PURE__ */ jsxs("span", {
					className: "tabular-nums",
					children: [
						i18nT("apps.codeReviewSage.components.runProgress.reviewed_of", {
							done: tally.done,
							count: total
						}),
						tally.failed > 0 && /* @__PURE__ */ jsxs("span", {
							className: "text-danger",
							children: [" · ", i18nT("apps.codeReviewSage.components.runProgress.failed_count", { count: tally.failed })]
						}),
						tally.cancelled > 0 && /* @__PURE__ */ jsxs("span", { children: [" · ", i18nT("apps.codeReviewSage.components.runProgress.cancelled_count", { count: tally.cancelled })] })
					]
				}), /* @__PURE__ */ jsxs("span", {
					className: "inline-flex items-center gap-1.5 tabular-nums",
					title: i18nT("apps.codeReviewSage.components.runProgress.elapsed_time"),
					children: [/* @__PURE__ */ jsx(Clock, {
						size: 12,
						"aria-hidden": "true"
					}), elapsed]
				})]
			}),
			/* @__PURE__ */ jsx("div", {
				role: "progressbar",
				"aria-valuenow": pct,
				"aria-valuemin": 0,
				"aria-valuemax": 100,
				"aria-label": i18nT("apps.codeReviewSage.components.runProgress.review_progress"),
				className: "h-1.5 w-full overflow-hidden rounded-full bg-bg-elevated",
				children: running && pct === 0 ? /* @__PURE__ */ jsx("div", { className: "h-full w-1/3 rounded-full bg-accent/70 animate-sage-sweep motion-reduce:animate-none motion-reduce:w-full motion-reduce:bg-accent/40" }) : /* @__PURE__ */ jsx("div", {
					className: `h-full rounded-full ${barFill} transition-[width] duration-500 motion-reduce:transition-none`,
					style: { width: `${pct}%` }
				})
			}),
			running && (activity || typicalMs) && /* @__PURE__ */ jsxs("div", {
				className: "flex items-center justify-between gap-2 text-[11px] text-muted",
				children: [/* @__PURE__ */ jsx("span", {
					className: "inline-flex items-center gap-1.5 min-w-0",
					children: activity && /* @__PURE__ */ jsxs(Fragment, { children: [/* @__PURE__ */ jsx(Loader2, {
						size: 11,
						className: "flex-shrink-0 animate-spin motion-reduce:animate-none",
						"aria-hidden": "true"
					}), /* @__PURE__ */ jsxs("span", {
						className: "truncate",
						children: [activity.tool || i18nT("apps.codeReviewSage.components.runProgress.working"), /* @__PURE__ */ jsxs("span", {
							className: "tabular-nums",
							children: [
								" ",
								i18nT("apps.codeReviewSage.components.runProgress.step"),
								" ",
								activity.step
							]
						})]
					})] })
				}), typicalMs && /* @__PURE__ */ jsxs("span", {
					className: "flex-shrink-0 tabular-nums",
					title: i18nT("apps.codeReviewSage.components.runProgress.median_of_past_runs_of_this_size"),
					children: [i18nT("apps.codeReviewSage.components.runProgress.usually"), formatElapsed(typicalMs)]
				})]
			}),
			pool && typeof pool.busy === "number" && typeof pool.max === "number" && (total > 1 || pool.busy > 1) && /* @__PURE__ */ jsx("div", {
				className: "text-[11px] text-muted",
				children: i18nT("apps.codeReviewSage.components.runProgress.reviewers_busy", {
					busy: pool.busy,
					max: pool.max
				})
			}),
			total > 1 && /* @__PURE__ */ jsx("ul", {
				className: "flex flex-col divide-y divide-border",
				children: run.changes.map((change, i) => {
					const cid = run.change_ids?.[i] ?? change;
					return /* @__PURE__ */ jsx(ChangeRow, {
						change,
						entry: run.progress?.[cid]
					}, cid);
				})
			}),
			running && onCancel && /* @__PURE__ */ jsxs("div", {
				className: "flex flex-col gap-1",
				children: [/* @__PURE__ */ jsxs("button", {
					type: "button",
					onClick: onCancel,
					disabled: cancelRequested,
					className: "inline-flex items-center justify-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-[12px] font-medium text-text transition-colors hover:bg-bg-hover disabled:cursor-not-allowed disabled:opacity-50 focus-ring-accent cursor-pointer",
					children: [/* @__PURE__ */ jsx(XOctagon, {
						size: 13,
						"aria-hidden": "true"
					}), cancelRequested ? i18nT("apps.codeReviewSage.components.runProgress.cancelling") : i18nT("apps.codeReviewSage.components.runProgress.cancel_review")]
				}), /* @__PURE__ */ jsx("span", {
					className: "text-[11px] text-muted",
					children: i18nT("apps.codeReviewSage.components.runProgress.stops_queued_prs_one_already_being_reviewed_will")
				})]
			})
		]
	});
}
// src/components/PostCommentsButton.tsx
/** How many comments a post would publish.
*
* Mirrors the backend's ``posting_expected``: every must-fix and should-fix
* finding becomes an
* inline comment, plus one always-on ship-readiness comment per reviewed change.
* Derived from the report the pane already has, so labelling the button honestly
* costs no extra request — the endpoint recounts from the records before sending
* and refuses a no-op, so this is a label, never the authority.
*
* Comments already on the pull request are subtracted. Findings can be posted
* one at a time, and counting the whole report regardless made the confirm for
* an external write overstate itself — offering to "post 6 comments" when four
* were already sent and only two remained. Dismissed findings are subtracted
* too: the backend never posts them. */
function pendingCommentCount(report, postedKeys, dismissed) {
	if (!report?.rows?.length) return 0;
	return report.rows.reduce((n, row) => {
		const possible = (row.red ?? 0) + (row.yellow ?? 0) + 1;
		const sentKeys = postedKeys?.[row.change_id] ?? [];
		const skipped = Object.keys(dismissed?.[row.change_id] ?? {}).filter((k) => !sentKeys.includes(k)).length;
		return n + Math.max(0, possible - sentKeys.length - skipped);
	}, 0);
}
function PostCommentsButton({ run, report, onPost, posting = false, error = null, postedKeys, publishBarBelow = false }) {
	const [confirming, setConfirming] = useState(false);
	const pending = pendingCommentCount(report, postedKeys, run.dismissed);
	useEffect(() => setConfirming(false), [run.run_id]);
	if (run.status === "running") return null;
	if (run.posted_at) return /* @__PURE__ */ jsxs("span", {
		className: "inline-flex items-center gap-1.5 text-[12.5px] text-ok",
		title: i18nT("apps.codeReviewSage.components.postCommentsButton.posted_age", { age: relativeAge(run.posted_at) }),
		children: [/* @__PURE__ */ jsx(Check, {
			size: 13,
			"aria-hidden": "true"
		}), i18nT(publishBarBelow ? "apps.codeReviewSage.components.postCommentsButton.posted_comments" : "apps.codeReviewSage.components.postCommentsButton.drafted_publish_on_pr_page", { count: run.posted_comments ?? 0 })]
	});
	if (posting) return /* @__PURE__ */ jsxs("span", {
		className: "inline-flex items-center gap-1.5 text-[12.5px] text-muted",
		children: [/* @__PURE__ */ jsx(Loader2, {
			size: 13,
			className: "animate-spin motion-reduce:animate-none",
			"aria-hidden": "true"
		}), i18nT("apps.codeReviewSage.components.postCommentsButton.posting")]
	});
	if (pending === 0) return null;
	if (confirming) return /* @__PURE__ */ jsxs("span", {
		className: "inline-flex items-center gap-2 text-[12.5px]",
		children: [
			/* @__PURE__ */ jsx("span", {
				className: "text-muted",
				children: i18nT("apps.codeReviewSage.components.postCommentsButton.confirm_post", { count: pending })
			}),
			/* @__PURE__ */ jsx("button", {
				type: "button",
				onClick: () => {
					setConfirming(false);
					onPost();
				},
				className: "inline-flex items-center gap-1.5 rounded-md border border-accent bg-accent-subtle px-2.5 py-1 text-[12.5px] font-medium text-accent hover:bg-accent/20 cursor-pointer",
				children: i18nT("apps.codeReviewSage.components.postCommentsButton.post_action")
			}),
			/* @__PURE__ */ jsx("button", {
				type: "button",
				onClick: () => setConfirming(false),
				className: "rounded-md bg-transparent px-1.5 py-1 text-[12.5px] text-muted hover:text-text cursor-pointer",
				children: i18nT("apps.codeReviewSage.components.postCommentsButton.cancel")
			})
		]
	});
	return /* @__PURE__ */ jsxs("span", {
		className: "inline-flex flex-col items-end gap-1",
		children: [/* @__PURE__ */ jsx("span", {
			className: "inline-flex items-center gap-2",
			children: /* @__PURE__ */ jsxs("button", {
				type: "button",
				onClick: () => setConfirming(true),
				title: i18nT("apps.codeReviewSage.components.postCommentsButton.publish_these_findings_as_a_review_on_the_pull_r"),
				className: "inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1 text-[12.5px] text-text hover:text-accent hover:border-accent cursor-pointer",
				children: [/* @__PURE__ */ jsx(MessageSquarePlus, {
					size: 13,
					"aria-hidden": "true"
				}), i18nT("apps.codeReviewSage.components.postCommentsButton.post_count", { count: pending })]
			})
		}), error && /* @__PURE__ */ jsxs("span", {
			className: "inline-flex items-start gap-1 max-w-[42ch] text-[12px] text-danger text-right",
			children: [/* @__PURE__ */ jsx(AlertTriangle, {
				size: 12,
				"aria-hidden": "true",
				className: "mt-[2px] flex-shrink-0"
			}), /* @__PURE__ */ jsxs("span", {
				className: "flex flex-col gap-0.5",
				children: [/* @__PURE__ */ jsx("span", { children: i18nT("apps.codeReviewSage.components.postCommentsButton.post_failed") }), /* @__PURE__ */ jsx("span", {
					className: "break-words font-normal opacity-90",
					children: error
				})]
			})]
		})]
	});
}
// src/components/PrReviewDetail.tsx
/** http(s) only: the URL is provider-derived and lands in an href. */
function safeHref(url) {
	try {
		return ["http:", "https:"].includes(new URL(url).protocol) ? url : "#";
	} catch {
		return "#";
	}
}
function ReportSkeleton$1() {
	return /* @__PURE__ */ jsxs(Fragment, { children: [/* @__PURE__ */ jsx("span", {
		className: "sr-only",
		role: "status",
		children: i18nT("apps.codeReviewSage.components.prReviewDetail.loading_review")
	}), /* @__PURE__ */ jsx("div", {
		"aria-hidden": "true",
		className: "flex flex-col gap-3",
		children: [0, 1].map((i) => /* @__PURE__ */ jsxs("div", {
			className: "rounded-lg border border-border bg-card p-3 flex flex-col gap-2",
			children: [/* @__PURE__ */ jsx(ShimmerLine, {
				w: "46%",
				delay: i * .08
			}), /* @__PURE__ */ jsx(ShimmerLine, {
				w: "80%",
				delay: i * .08 + .05
			})]
		}, i))
	})] });
}
function Meta({ label, value }) {
	return /* @__PURE__ */ jsxs("span", {
		className: "inline-flex items-baseline gap-1.5",
		children: [/* @__PURE__ */ jsx("span", {
			className: "text-[11px] uppercase tracking-wider text-muted",
			children: label
		}), /* @__PURE__ */ jsx("span", {
			className: "text-[12.5px] text-text",
			children: value
		})]
	});
}
function PrReviewDetail({ pr }) {
	const { prRun, report, reportLoading, reportError, startReview, cancelRun, cancelling, pool, archiveRun, archiving, archiveError, runs, postComments, postCommentGroups, dismissFinding, posting, postError, postingSelection } = useSage();
	const source = usePrSource(pr.url);
	const running = prRun?.status === "running";
	const changeEntry = prRun?.progress?.[pr.change_id];
	const changeError = changeEntry?.phase === "failed" ? (changeEntry.error || "").trim() || null : null;
	const busy = startReview.isPending;
	const localKeys = postingSelection === void 0 ? [] : postingSelection?.keys ?? null;
	const isPosting = (key) => {
		if (localKeys === null) return true;
		if (localKeys.length > 0) return localKeys.includes(key);
		return Boolean(prRun?.posting);
	};
	const scoped = useMemo(() => {
		if (!report?.ready) return null;
		const want = changeKey(pr.url);
		const rows = report.rows.filter((r) => changeKey(r.url) === want);
		const bands = {
			red: 0,
			yellow: 0,
			green: 0
		};
		for (const r of rows) bands[r.band] += 1;
		return {
			...report,
			rows,
			bands,
			total: rows.length
		};
	}, [report, pr.url]);
	const src = source.data;
	const title = pr.title || src?.title || scoped?.rows[0]?.title || `#${pr.number}`;
	const author = pr.author || src?.author || "";
	const updatedAt = pr.updated_at || src?.updatedAt || "";
	const headSha = pr.head_sha || src?.headSha || "";
	const failed = !!prRun && effectiveRunStatus(prRun) === "error";
	const isDraft = pr.draft ?? src?.draft ?? false;
	const reviewBody = /* @__PURE__ */ jsxs(Fragment, { children: [
		prRun && /* @__PURE__ */ jsx(FailureNotice, {
			run: prRun,
			changeId: pr.change_id,
			onRetry: () => startReview.mutate([pr.url]),
			retrying: startReview.isPending
		}),
		prRun && /* @__PURE__ */ jsx(RunProgress, {
			run: prRun,
			pool,
			typicalMs: typicalRunMs(runs, prRun.changes.length),
			onCancel: () => cancelRun(prRun.run_id),
			cancelling: cancelling || Boolean(prRun.cancel_requested_at)
		}),
		!prRun ? /* @__PURE__ */ jsx(EmptyState, {
			icon: ScanSearch,
			title: i18nT("apps.codeReviewSage.components.prReviewDetail.this_pull_request_has_not_been_reviewed_yet"),
			hint: i18nT("apps.codeReviewSage.components.prReviewDetail.start_a_review_and_its_findings_appear_here_you")
		}) : reportError ? /* @__PURE__ */ jsx(ErrorNotice, {
			message: reportError.message,
			askAgent: true
		}) : reportLoading ? /* @__PURE__ */ jsx(ReportSkeleton$1, {}) : scoped && scoped.rows.length > 0 ? /* @__PURE__ */ jsx(ReportView, {
			report: scoped,
			actions: /* @__PURE__ */ jsx(PostCommentsButton, {
				run: prRun,
				report: scoped,
				publishBarBelow: true,
				onPost: () => postComments(prRun.run_id, { changeId: pr.change_id }),
				posting: posting || Boolean(prRun.posting),
				error: prRun.post_error ?? postError?.message ?? null,
				postedKeys: prRun.posted_keys
			}),
			postedKeys: prRun.posted_keys,
			isPosting,
			onPostFinding: (changeId, key) => postComments(prRun.run_id, {
				changeId,
				keys: [key]
			}),
			onPostSelection: (groups) => postCommentGroups(prRun.run_id, groups),
			dismissed: prRun.dismissed,
			onDismissFinding: (changeId, key, reason) => dismissFinding(prRun.run_id, changeId, key, reason),
			onArchive: () => archiveRun(prRun.run_id),
			archiving,
			archiveError: archiveError?.message ?? null
		}) : running ? /* @__PURE__ */ jsx("div", {
			className: "text-[12.5px] text-muted leading-[1.6]",
			children: i18nT("apps.codeReviewSage.components.prReviewDetail.findings_appear_here_as_soon_as_the_review_finis")
		}) : report?.ready ? /* @__PURE__ */ jsx(EmptyState, {
			icon: GitPullRequest,
			title: i18nT("apps.codeReviewSage.components.prReviewDetail.nothing_flagged_on_this_pull_request"),
			hint: i18nT("apps.codeReviewSage.components.prReviewDetail.review_completed_with_no_findings")
		}) : /* @__PURE__ */ jsx(EmptyState, {
			icon: GitPullRequest,
			title: i18nT("apps.codeReviewSage.components.prReviewDetail.that_review_produced_no_report_for_this_pull_req"),
			hint: prRun.status === "cancelled" ? i18nT("apps.codeReviewSage.components.prReviewDetail.cancelled_before_finishing") : changeError ? i18nT("apps.codeReviewSage.components.prReviewDetail.see_the_reason_above") : i18nT("apps.codeReviewSage.components.prReviewDetail.did_not_complete_for_this_change")
		}),
		prRun && /* @__PURE__ */ jsx(ReviewChat, {
			runId: prRun.run_id,
			changeId: pr.change_id
		}),
		prRun && /* @__PURE__ */ jsx(DraftReviewActions, {
			url: pr.url,
			draftDelivered: (prRun.posted_keys?.[pr.change_id]?.length ?? 0) > 0,
			expectedReviewId: prRun.posted_review_ids?.[pr.change_id] ?? ""
		})
	] });
	return /* @__PURE__ */ jsxs("article", {
		className: "h-full flex flex-col min-h-0",
		children: [/* @__PURE__ */ jsxs("header", {
			className: "px-4 md:px-6 pt-5 pb-3 border-b border-border flex-shrink-0",
			children: [/* @__PURE__ */ jsxs("div", {
				className: "flex items-start gap-3",
				children: [/* @__PURE__ */ jsxs("div", {
					className: "flex-1 min-w-0",
					children: [/* @__PURE__ */ jsx("h1", {
						className: "text-[21px] font-bold leading-tight text-text-strong break-words",
						children: title
					}), /* @__PURE__ */ jsxs("div", {
						className: "flex items-center gap-2.5 mt-2 flex-wrap text-[12.5px] text-muted",
						children: [
							/* @__PURE__ */ jsxs("a", {
								href: safeHref(pr.url),
								target: "_blank",
								rel: "noreferrer",
								title: i18nT("apps.codeReviewSage.components.prReviewDetail.open_on_github"),
								className: "inline-flex items-center gap-1 font-mono text-muted hover:text-accent hover:underline",
								children: [
									"#",
									pr.number,
									" ",
									/* @__PURE__ */ jsx(ExternalLink, {
										size: 11,
										"aria-hidden": "true"
									})
								]
							}),
							author && /* @__PURE__ */ jsx(Meta, {
								label: i18nT("apps.codeReviewSage.components.prReviewDetail.author"),
								value: author
							}),
							updatedAt && /* @__PURE__ */ jsx(Meta, {
								label: i18nT("apps.codeReviewSage.components.prReviewDetail.updated"),
								value: relativeAge(updatedAt)
							}),
							headSha && /* @__PURE__ */ jsx(Meta, {
								label: i18nT("apps.codeReviewSage.components.prReviewDetail.head"),
								value: headSha.slice(0, 7)
							}),
							isDraft && /* @__PURE__ */ jsx("span", {
								className: "text-[10.5px] px-1.5 py-0.5 rounded-full bg-bg-elevated border border-border",
								children: i18nT("apps.codeReviewSage.components.prReviewDetail.draft")
							}),
							/* @__PURE__ */ jsx(PrStatusChips, { src }),
							prRun && prRun.status !== "running" && /* @__PURE__ */ jsx(RunStatusPill, {
								status: effectiveRunStatus(prRun),
								cancelRequested: Boolean(prRun.cancel_requested_at)
							})
						]
					})]
				}), /* @__PURE__ */ jsxs("button", {
					type: "button",
					onClick: () => startReview.mutate([pr.url]),
					disabled: busy || running,
					title: running ? i18nT("apps.codeReviewSage.components.prReviewDetail.review_already_running") : pr.reviewed ? i18nT("apps.codeReviewSage.components.prReviewDetail.review_again_at_current_head") : i18nT("apps.codeReviewSage.components.prReviewDetail.review_this_pull_request"),
					className: "flex-shrink-0 inline-flex items-center gap-1.5 rounded-md bg-accent text-accent-fg px-3 py-1.5 text-[12.5px] font-medium border-none cursor-pointer hover:bg-accent-hover disabled:opacity-40 disabled:cursor-default transition-colors",
					children: [busy ? /* @__PURE__ */ jsx(Loader2, {
						size: 13,
						className: "animate-spin motion-reduce:animate-none"
					}) : /* @__PURE__ */ jsx(ScanSearch, { size: 13 }), running ? i18nT("apps.codeReviewSage.components.prReviewDetail.reviewing") : failed ? i18nT("apps.codeReviewSage.components.prReviewDetail.retry_review") : pr.reviewed || pr.reviewed_stale ? i18nT("apps.codeReviewSage.components.prReviewDetail.review_again") : i18nT("apps.codeReviewSage.components.prReviewDetail.review")]
				})]
			}), startReview.error && /* @__PURE__ */ jsx(ErrorNotice, {
				message: startReview.error.message,
				variant: "inline",
				askAgent: true,
				className: "mt-2"
			})]
		}), /* @__PURE__ */ jsx("div", {
			className: "flex-1 min-h-0 overflow-y-auto scrollbar-none px-4 md:px-6 py-5 flex flex-col gap-5",
			children: reviewBody
		})]
	});
}
// src/components/RunDetail.tsx
/** The report area's loading state: placeholder rows in the report's own shape. */
function ReportSkeleton() {
	return /* @__PURE__ */ jsxs(Fragment, { children: [/* @__PURE__ */ jsx("span", {
		className: "sr-only",
		role: "status",
		children: i18nT("apps.codeReviewSage.components.runDetail.loading_report")
	}), /* @__PURE__ */ jsx("div", {
		"aria-hidden": "true",
		className: "flex flex-col gap-3",
		children: [
			0,
			1,
			2
		].map((i) => /* @__PURE__ */ jsxs("div", {
			className: "rounded-lg border border-border bg-card p-3 flex flex-col gap-2",
			children: [
				/* @__PURE__ */ jsx(ShimmerLine, {
					w: "48%",
					delay: i * .08
				}),
				/* @__PURE__ */ jsx(ShimmerLine, {
					w: "82%",
					delay: i * .08 + .05
				}),
				/* @__PURE__ */ jsx(ShimmerLine, {
					w: "34%",
					delay: i * .08 + .1
				})
			]
		}, i))
	})] });
}
function DetailHeader({ run }) {
	const { startReview } = useSage();
	const { label, more } = runIdentity(run.repo, run.changes);
	return /* @__PURE__ */ jsxs("header", {
		className: "px-4 md:px-6 pt-5 pb-4 border-b border-border flex-shrink-0",
		children: [
			/* @__PURE__ */ jsx("div", {
				className: "flex items-start gap-3",
				children: /* @__PURE__ */ jsxs("div", {
					className: "flex-1 min-w-0",
					children: [/* @__PURE__ */ jsxs("h1", {
						className: "text-[22px] font-bold leading-tight text-text-strong break-words",
						children: [label, more > 0 && /* @__PURE__ */ jsxs("span", {
							className: "text-muted font-medium",
							children: [" ", i18nT("apps.codeReviewSage.components.runDetail.more_count", { count: more })]
						})]
					}), /* @__PURE__ */ jsxs("div", {
						className: "flex items-center gap-2 mt-2 flex-wrap text-[12.5px] text-muted",
						children: [
							/* @__PURE__ */ jsx(RunStatusPill, {
								status: effectiveRunStatus(run),
								cancelRequested: !!run.cancel_requested_at
							}),
							/* @__PURE__ */ jsx("span", { children: i18nT("apps.codeReviewSage.components.runDetail.pull_request", { count: run.changes.length }) }),
							/* @__PURE__ */ jsx("span", {
								"aria-hidden": "true",
								children: "·"
							}),
							/* @__PURE__ */ jsxs("span", {
								title: run.started_at,
								children: [
									i18nT("apps.codeReviewSage.components.runDetail.started"),
									" ",
									relativeAge(run.started_at)
								]
							}),
							run.finished_at && /* @__PURE__ */ jsxs(Fragment, { children: [/* @__PURE__ */ jsx("span", {
								"aria-hidden": "true",
								children: "·"
							}), /* @__PURE__ */ jsxs("span", {
								title: run.finished_at,
								children: [
									i18nT("apps.codeReviewSage.components.runDetail.finished"),
									" ",
									relativeAge(run.finished_at)
								]
							})] })
						]
					})]
				})
			}),
			/* @__PURE__ */ jsx("div", {
				className: "mt-3",
				children: /* @__PURE__ */ jsx(FailureNotice, {
					run,
					onRetry: () => startReview.mutate(run.changes),
					retrying: startReview.isPending
				})
			}),
			!!run.skipped_inflight && /* @__PURE__ */ jsx("div", {
				className: "mt-3 text-[12px] text-muted leading-[1.5]",
				children: i18nT("apps.codeReviewSage.components.runDetail.skipped_inflight", { count: run.skipped_inflight })
			})
		]
	});
}
function RunDetail({ run }) {
	const { pool, cancelRun, cancelling, report, reportLoading, reportError, archiveRun, archiving, archiveError, runs, postComments, postCommentGroups, posting, postError, dismissFinding, postingSelection } = useSage();
	const running = run.status === "running";
	const localKeys = postingSelection === void 0 ? [] : postingSelection?.keys ?? null;
	const isPosting = (key) => {
		if (localKeys === null) return true;
		if (localKeys.length > 0) return localKeys.includes(key);
		return Boolean(run.posting);
	};
	return /* @__PURE__ */ jsxs("article", {
		className: "h-full flex flex-col min-h-0",
		children: [/* @__PURE__ */ jsx(DetailHeader, { run }), /* @__PURE__ */ jsxs("div", {
			className: "flex-1 min-h-0 overflow-y-auto scrollbar-none px-4 md:px-6 py-5 flex flex-col gap-5",
			children: [/* @__PURE__ */ jsx(RunProgress, {
				run,
				pool,
				typicalMs: typicalRunMs(runs, run.changes.length),
				onCancel: () => cancelRun(run.run_id),
				cancelling: cancelling || !!run.cancel_requested_at
			}), reportError ? /* @__PURE__ */ jsx(ErrorNotice, {
				message: reportError.message,
				askAgent: true
			}) : reportLoading ? /* @__PURE__ */ jsx(ReportSkeleton, {}) : report?.ready ? /* @__PURE__ */ jsx(ReportView, {
				report,
				actions: /* @__PURE__ */ jsx(PostCommentsButton, {
					run,
					report,
					onPost: () => postComments(run.run_id),
					posting: posting || Boolean(run.posting),
					error: run.post_error ?? postError?.message ?? null,
					postedKeys: run.posted_keys
				}),
				postedKeys: run.posted_keys,
				isPosting,
				onPostFinding: (changeId, key) => postComments(run.run_id, {
					changeId,
					keys: [key]
				}),
				onPostSelection: (groups) => postCommentGroups(run.run_id, groups),
				dismissed: run.dismissed,
				onDismissFinding: (changeId, key, reason) => dismissFinding(run.run_id, changeId, key, reason),
				onArchive: () => archiveRun(run.run_id),
				archiving,
				archiveError: archiveError?.message ?? null
			}) : running ? /* @__PURE__ */ jsx(EmptyState, {
				icon: ScanSearch,
				title: i18nT("apps.codeReviewSage.components.runDetail.report_appears_when_the_review_finishes"),
				hint: i18nT("apps.codeReviewSage.components.runDetail.you_can_leave_this_page_a_notification_will_tell")
			}) : /* @__PURE__ */ jsx(EmptyState, {
				icon: AlertTriangle,
				title: i18nT("apps.codeReviewSage.components.runDetail.this_review_produced_no_report"),
				hint: run.status === "cancelled" ? i18nT("apps.codeReviewSage.components.runDetail.cancelled_before_any_finished") : i18nT("apps.codeReviewSage.components.runDetail.nothing_to_report")
			})]
		})]
	});
}
// src/views/LearningView.tsx
function ImpactTag({ impact }) {
	return /* @__PURE__ */ jsx("span", {
		className: `inline-block px-1.5 py-0.5 rounded text-[10px] mr-1.5 ${impact === "high" ? "text-danger border border-danger" : "text-muted border border-border"}`,
		children: impact
	});
}
function PatternRow({ p }) {
	return /* @__PURE__ */ jsxs("li", {
		className: "rounded-lg border border-border bg-card px-3.5 py-2.5",
		children: [/* @__PURE__ */ jsxs("div", {
			className: "text-[13px]",
			children: [/* @__PURE__ */ jsx(ImpactTag, { impact: p.impact }), /* @__PURE__ */ jsx("strong", {
				className: "text-text",
				children: p.title
			})]
		}), /* @__PURE__ */ jsx("div", {
			className: "mt-1 text-[12.5px] text-muted leading-[1.6]",
			children: p.guidance
		})]
	});
}
/** Run the one-shot merge that turns staged candidates into the live ruleset.
*
* Two clicks: consolidating REPLACES the ruleset and clears the candidate, and
* neither the old file nor the staged list is recoverable from here. The merge
* itself is a worker turn, so it takes a while and reports its own outcome —
* a failed merge leaves the ruleset untouched and says so. */
function ConsolidateControl({ namespace, count, running, error }) {
	const qc = useQueryClient();
	const [confirming, setConfirming] = useState(false);
	useEffect(() => {
		setConfirming(false);
	}, [namespace]);
	const mut = useMutation({
		mutationFn: () => sageApi.consolidateLearnings(namespace),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: [
				"code-review-sage",
				"learnings",
				namespace
			] });
			qc.invalidateQueries({ queryKey: ["code-review-sage", "namespaces"] });
		}
	});
	const busy = running || mut.isPending;
	return /* @__PURE__ */ jsxs("span", {
		className: "ml-auto inline-flex flex-col items-end gap-1",
		children: [
			/* @__PURE__ */ jsx("span", {
				className: "inline-flex items-center gap-2",
				children: busy ? /* @__PURE__ */ jsxs("span", {
					className: "inline-flex items-center gap-1.5 text-[11.5px] text-muted",
					children: [/* @__PURE__ */ jsx(Loader2, {
						size: 11,
						className: "animate-spin motion-reduce:animate-none"
					}), i18nT("apps.codeReviewSage.views.learningView.consolidating")]
				}) : confirming ? /* @__PURE__ */ jsxs(Fragment, { children: [
					/* @__PURE__ */ jsx("span", {
						className: "text-[11.5px] text-muted",
						children: i18nT("apps.codeReviewSage.views.learningView.confirm_merge", { count })
					}),
					/* @__PURE__ */ jsx("button", {
						type: "button",
						onClick: () => {
							setConfirming(false);
							mut.mutate();
						},
						className: "rounded bg-transparent px-1 text-[11.5px] font-medium text-accent hover:underline cursor-pointer",
						children: i18nT("apps.codeReviewSage.views.learningView.consolidate")
					}),
					/* @__PURE__ */ jsx("button", {
						type: "button",
						onClick: () => setConfirming(false),
						className: "rounded bg-transparent px-1 text-[11.5px] text-muted hover:text-text cursor-pointer",
						children: i18nT("apps.codeReviewSage.views.learningView.cancel")
					})
				] }) : /* @__PURE__ */ jsxs("button", {
					type: "button",
					onClick: () => setConfirming(true),
					"aria-label": i18nT("apps.codeReviewSage.views.learningView.consolidate_pending", {
						count,
						namespace
					}),
					className: "inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2 py-0.5 text-[11.5px] text-text hover:text-accent hover:border-accent cursor-pointer",
					children: [/* @__PURE__ */ jsx(Wand2, {
						size: 11,
						"aria-hidden": "true"
					}), i18nT("apps.codeReviewSage.views.learningView.consolidate")]
				})
			}),
			error && !busy && /* @__PURE__ */ jsx(ErrorNotice, {
				title: i18nT("apps.codeReviewSage.views.learningView.merge_failed_ruleset_unchanged"),
				message: error,
				variant: "inline",
				askAgent: true,
				className: "max-w-[38ch]"
			}),
			mut.error && /* @__PURE__ */ jsx(ErrorNotice, {
				message: mut.error.message,
				variant: "inline",
				askAgent: true
			})
		]
	});
}
function LearningView() {
	const { selectedNamespace } = useSage();
	const ns = selectedNamespace;
	const learningsQuery = useQuery({
		queryKey: [
			"code-review-sage",
			"learnings",
			ns
		],
		queryFn: () => sageApi.learnings(ns),
		enabled: !!ns,
		refetchInterval: (q) => q.state.data?.consolidating ? LIVE_POLL_MS : false
	});
	const activeList = useQuery({
		queryKey: ["code-review-sage", "settings"],
		queryFn: () => sageApi.settings()
	}).data?.settings.active_namespaces ?? [];
	const isActive = !!ns && activeList.includes(ns);
	const patterns = learningsQuery.data?.patterns ?? [];
	const candidate = learningsQuery.data?.candidate ?? [];
	if (!ns) return /* @__PURE__ */ jsxs("div", {
		className: "h-full overflow-y-auto scrollbar-none px-4 md:px-6 py-6",
		children: [/* @__PURE__ */ jsxs("h1", {
			className: "text-[22px] font-bold leading-tight text-text-strong flex items-center gap-2",
			children: [
				/* @__PURE__ */ jsx(Brain, {
					size: 18,
					className: "text-accent",
					"aria-hidden": "true"
				}),
				" ",
				i18nT("apps.codeReviewSage.views.learningView.learning")
			]
		}), /* @__PURE__ */ jsx("p", {
			className: "text-[13px] text-muted mt-1.5 leading-[1.5] max-w-[620px]",
			children: i18nT("apps.codeReviewSage.views.learningView.pick_a_namespace_in_the_sidebar_to_read_the_patt")
		})]
	});
	return /* @__PURE__ */ jsx("div", {
		className: "h-full overflow-y-auto scrollbar-none px-4 md:px-6 py-6",
		children: /* @__PURE__ */ jsxs("div", {
			className: "max-w-[820px]",
			children: [
				/* @__PURE__ */ jsxs("h1", {
					className: "text-[22px] font-bold leading-tight text-text-strong flex items-center gap-2",
					children: [
						/* @__PURE__ */ jsx(Brain, {
							size: 18,
							className: "text-accent",
							"aria-hidden": "true"
						}),
						/* @__PURE__ */ jsx("span", {
							className: "font-mono",
							children: ns
						}),
						/* @__PURE__ */ jsx("span", {
							className: `text-[11px] px-2 py-0.5 rounded-full border ${isActive ? "border-accent text-accent bg-accent-subtle" : "border-border text-muted"}`,
							children: isActive ? i18nT("apps.codeReviewSage.views.learningView.loaded_during_reviews") : i18nT("apps.codeReviewSage.views.learningView.not_loaded")
						})
					]
				}),
				/* @__PURE__ */ jsx("p", {
					className: "text-[13px] text-muted mt-1.5 leading-[1.5] max-w-[620px]",
					children: i18nT("apps.codeReviewSage.views.learningView.reviews_read_the_consolidated_ruleset_below_neve")
				}),
				learningsQuery.isLoading && /* @__PURE__ */ jsxs("div", {
					className: "mt-6 inline-flex items-center gap-2 text-[13px] text-muted",
					children: [/* @__PURE__ */ jsx(Loader2, {
						size: 14,
						className: "animate-spin motion-reduce:animate-none"
					}), i18nT("apps.codeReviewSage.views.learningView.loading_learnings")]
				}),
				learningsQuery.error && /* @__PURE__ */ jsx(ErrorNotice, {
					message: learningsQuery.error.message,
					askAgent: true,
					className: "mt-6"
				}),
				!learningsQuery.isLoading && /* @__PURE__ */ jsxs(Fragment, { children: [
					/* @__PURE__ */ jsx("div", {
						className: "mt-6 flex items-center gap-2",
						children: /* @__PURE__ */ jsxs("h2", {
							className: "text-[11px] font-semibold uppercase tracking-wider text-muted",
							children: [
								i18nT("apps.codeReviewSage.views.learningView.ruleset"),
								" ",
								i18nT("apps.codeReviewSage.views.learningView.pattern", { count: patterns.length })
							]
						})
					}),
					patterns.length === 0 ? /* @__PURE__ */ jsx("div", {
						className: "mt-2 text-[12.5px] text-muted italic leading-[1.5]",
						children: i18nT("apps.codeReviewSage.views.learningView.nothing_consolidated_yet_reviews_in_this_namespa")
					}) : /* @__PURE__ */ jsx("ul", {
						className: "list-none p-0 mt-2 flex flex-col gap-2",
						children: patterns.map((p) => /* @__PURE__ */ jsx(PatternRow, { p }, p.id))
					}),
					/* @__PURE__ */ jsxs("div", {
						className: "mt-7 flex items-center gap-2",
						children: [/* @__PURE__ */ jsxs("h2", {
							className: "text-[11px] font-semibold uppercase tracking-wider text-warn",
							children: [
								i18nT("apps.codeReviewSage.views.learningView.pending_consolidation"),
								" ",
								candidate.length
							]
						}), candidate.length > 0 && /* @__PURE__ */ jsx(ConsolidateControl, {
							namespace: ns,
							count: candidate.length,
							running: Boolean(learningsQuery.data?.consolidating),
							error: learningsQuery.data?.consolidate_error ?? null
						})]
					}),
					candidate.length === 0 ? /* @__PURE__ */ jsx("div", {
						className: "mt-2 text-[12.5px] text-muted italic leading-[1.5]",
						children: i18nT("apps.codeReviewSage.views.learningView.nothing_staged_new_learnings_land_here_when_a_re")
					}) : /* @__PURE__ */ jsx("ul", {
						className: "list-none p-0 mt-2 flex flex-col gap-2",
						children: candidate.map((c) => /* @__PURE__ */ jsxs("li", {
							className: "rounded-lg border border-warn/40 bg-card px-3.5 py-2.5",
							children: [/* @__PURE__ */ jsxs("div", {
								className: "text-[13px]",
								children: [/* @__PURE__ */ jsx(ImpactTag, { impact: c.impact }), /* @__PURE__ */ jsx("strong", {
									className: "text-text",
									children: c.title
								})]
							}), /* @__PURE__ */ jsx("div", {
								className: "mt-1 text-[12.5px] text-muted leading-[1.6]",
								children: c.guidance
							})]
						}, c.id))
					})
				] })
			]
		})
	});
}
// src/views/SettingsView.tsx
function Field({ label, hint, children }) {
	return /* @__PURE__ */ jsxs("div", {
		className: "pb-4 mb-4 border-b border-border last:border-b-0 last:mb-0 last:pb-0",
		children: [/* @__PURE__ */ jsxs("div", {
			className: "flex items-center justify-between gap-4 flex-wrap",
			children: [/* @__PURE__ */ jsx("span", {
				className: "text-[13px] font-semibold text-text",
				children: label
			}), children]
		}), /* @__PURE__ */ jsx("div", {
			className: "text-[12px] text-muted mt-1.5 leading-[1.5] max-w-[560px]",
			children: hint
		})]
	});
}
var SELECT_CLASS = "text-[12.5px] px-2 py-1 rounded-md bg-bg-elevated text-text border border-border outline-hidden focus:border-accent cursor-pointer";
function SettingsView() {
	const qc = useQueryClient();
	const settingsQuery = useQuery({
		queryKey: ["code-review-sage", "settings"],
		queryFn: () => sageApi.settings()
	});
	const saveMut = useMutation({
		mutationFn: (patch) => sageApi.putSettings(patch),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: ["code-review-sage", "settings"] });
			qc.invalidateQueries({ queryKey: ["code-review-sage", "runs"] });
		}
	});
	const data = settingsQuery.data;
	const s = data?.settings;
	return /* @__PURE__ */ jsx("div", {
		className: "h-full overflow-y-auto scrollbar-none px-4 md:px-6 py-6",
		children: /* @__PURE__ */ jsxs("div", {
			className: "max-w-[720px]",
			children: [
				/* @__PURE__ */ jsxs("h1", {
					className: "text-[22px] font-bold leading-tight text-text-strong flex items-center gap-2",
					children: [
						/* @__PURE__ */ jsx(Settings, {
							size: 18,
							className: "text-accent",
							"aria-hidden": "true"
						}),
						" ",
						i18nT("apps.codeReviewSage.views.settingsView.settings")
					]
				}),
				/* @__PURE__ */ jsx("p", {
					className: "text-[13px] text-muted mt-1.5 leading-[1.5]",
					children: i18nT("apps.codeReviewSage.views.settingsView.these_apply_to_every_review_started_from_here")
				}),
				settingsQuery.isLoading && /* @__PURE__ */ jsxs("div", {
					className: "mt-6 inline-flex items-center gap-2 text-[13px] text-muted",
					children: [/* @__PURE__ */ jsx(Loader2, {
						size: 14,
						className: "animate-spin motion-reduce:animate-none"
					}), i18nT("apps.codeReviewSage.views.settingsView.loading_settings")]
				}),
				settingsQuery.error && /* @__PURE__ */ jsx(ErrorNotice, {
					message: settingsQuery.error.message,
					askAgent: true,
					className: "mt-6"
				}),
				data && s && /* @__PURE__ */ jsxs("div", {
					className: "mt-6 rounded-xl border border-border bg-card px-4 py-4",
					children: [
						/* @__PURE__ */ jsx(Field, {
							label: i18nT("apps.codeReviewSage.views.settingsView.model"),
							hint: i18nT("apps.codeReviewSage.views.settingsView.which_model_performs_the_review_default_inherits"),
							children: /* @__PURE__ */ jsx(Select, {
								"aria-label": i18nT("apps.codeReviewSage.views.settingsView.review_model"),
								options: data.models ?? [],
								value: s.model ?? "",
								onChange: (v) => saveMut.mutate({ model: v || null }),
								clearLabel: i18nT("apps.codeReviewSage.views.settingsView.default_agent_config"),
								className: SELECT_CLASS
							})
						}),
						/* @__PURE__ */ jsx(Field, {
							label: i18nT("apps.codeReviewSage.views.settingsView.reasoning_effort"),
							hint: i18nT("apps.codeReviewSage.views.settingsView.higher_effort_finds_more_costs_more_and_takes_lo"),
							children: /* @__PURE__ */ jsx(Select, {
								"aria-label": i18nT("apps.codeReviewSage.views.settingsView.reasoning_effort"),
								options: data.efforts ?? [],
								value: s.effort ?? "",
								onChange: (v) => saveMut.mutate({ effort: v }),
								clearLabel: i18nT("apps.codeReviewSage.views.settingsView.default_model_provider"),
								className: SELECT_CLASS
							})
						}),
						/* @__PURE__ */ jsx(Field, {
							label: i18nT("apps.codeReviewSage.views.settingsView.reviews_at_once"),
							hint: i18nT("apps.codeReviewSage.views.settingsView.how_many_pull_requests_are_reviewed_in_parallel"),
							children: /* @__PURE__ */ jsx(Select, {
								"aria-label": i18nT("apps.codeReviewSage.views.settingsView.reviews_at_once"),
								options: Array.from({ length: data.max_concurrent_max ?? 30 }, (_, i) => String(i + 1)),
								value: String(s.max_concurrent ?? 5),
								onChange: (v) => saveMut.mutate({ max_concurrent: Number(v) }),
								className: SELECT_CLASS
							})
						})
					]
				}),
				saveMut.error && /* @__PURE__ */ jsx(ErrorNotice, {
					message: saveMut.error.message,
					askAgent: true,
					className: "mt-3"
				})
			]
		})
	});
}
// src/Workspace.tsx
var RAIL_COLLAPSE = {
	width: 44,
	storageKey: RAIL_COLLAPSED_KEY,
	whenNarrow: true
};
/** The name of the pane the rail will show for `view`.
*
* Deliberately NOT the section's own name. A control reading "Reviews" that opens
* the Pull requests tab, or "Learning" that opens a panel headed "Namespaces",
* names something the user cannot see — the defect class this shell exists to
* remove, so it must not reappear in the control pointing AT the rail. Each
* section therefore answers with its rail's own heading: reviews from the active
* list tab, learning from the namespaces panel. A section whose rail has no pane
* of its own falls back to the section name (and `sectionHasList` withholds the
* control there anyway).
*
* A function rather than a field on RailHeader's section table, because the
* reviews answer depends on runtime state (`listTab`) and a static key cannot
* express it. Resolved per call so a language switch reaches it.
*/
function railPaneLabel(view, listTab) {
	if (view === "reviews") {
		if (listTab === "queue") return i18nT("apps.codeReviewSage.components.reviewQueue.tab");
		return i18nT(listTab === "reviews" ? "apps.codeReviewSage.components.middleColumn.reviews" : "apps.codeReviewSage.components.middleColumn.pull_requests");
	}
	if (view === "learning") return i18nT("apps.codeReviewSage.components.learningRail.namespaces");
	return sectionLabel(view);
}
function Workspace() {
	const { mainView, activeRun, selectedPr, listTab } = useSage();
	const rail = useColumnResize(RAIL_WIDTH_KEY, loadRailWidth, 280, 560, RAIL_COLLAPSE, loadRailCollapsed);
	const isMobile = useIsMobile();
	const mobileRailOpen = isMobile && !rail.collapsed;
	const railBar = isMobile && rail.collapsed;
	useEffect(() => {
		if (isMobile) rail.collapse();
	}, [
		selectedPr,
		activeRun,
		mainView,
		isMobile
	]);
	const mainClass = `flex-1 min-w-0 min-h-0 flex-col ${mobileRailOpen ? "hidden" : "flex"}`;
	const canOpenList = railBar && sectionHasList(mainView);
	const listLabel = railPaneLabel(mainView, listTab);
	const backToList = canOpenList ? /* @__PURE__ */ jsx(ListDetailBack, {
		label: listLabel,
		onBack: rail.expand
	}) : void 0;
	return /* @__PURE__ */ jsxs("div", {
		className: `flex h-full overflow-hidden bg-bg text-text ${railBar ? "flex-col" : ""}`,
		children: [
			/* @__PURE__ */ jsx("div", {
				style: { width: railBar ? void 0 : mobileRailOpen ? "100%" : rail.width },
				className: `flex-shrink-0 min-h-0 flex ${railBar ? "w-full" : ""}`,
				children: rail.collapsed ? railBar ? /* @__PURE__ */ jsx("div", {
					className: "w-full flex flex-row items-center border-b border-border px-2 py-1.5 bg-bg-accent",
					children: /* @__PURE__ */ jsx(RailHeader, {
						narrow: true,
						leading: backToList,
						onReselect: canOpenList ? rail.expand : void 0
					})
				}) : /* @__PURE__ */ jsx("div", {
					className: "w-full flex flex-col items-center border-r border-border pt-2 bg-bg-accent",
					children: /* @__PURE__ */ jsx(IconButton, {
						"aria-label": i18nT("app.expand_sidebar"),
						onClick: rail.expand,
						children: /* @__PURE__ */ jsx(ScanSearch, {
							size: 16,
							className: "text-accent"
						})
					})
				}) : /* @__PURE__ */ jsx(LeftRail, {
					narrow: mobileRailOpen,
					onCollapse: rail.collapse
				})
			}),
			!isMobile && /* @__PURE__ */ jsx(ResizeHandle, {
				handleProps: rail.handleProps,
				label: i18nT("apps.codeReviewSage.workspace.resize_sidebar"),
				title: i18nT("apps.codeReviewSage.workspace.drag_to_resize"),
				onNudge: rail.nudge,
				value: rail.width,
				min: 280,
				max: 560
			}),
			mainView === "reviews" ? /* @__PURE__ */ jsx(Fragment, { children: /* @__PURE__ */ jsx("main", {
				className: mainClass,
				children: selectedPr ? /* @__PURE__ */ jsx(PrReviewDetail, { pr: selectedPr }) : activeRun ? /* @__PURE__ */ jsx(RunDetail, { run: activeRun }) : /* @__PURE__ */ jsx(EmptyState, {
					icon: ScanSearch,
					title: i18nT("apps.codeReviewSage.workspace.select_a_review_to_see_its_progress_and_report"),
					hint: i18nT("apps.codeReviewSage.workspace.start_a_new_one_several_can_run_at_once"),
					children: backToList
				})
			}) }) : mainView === "learning" ? /* @__PURE__ */ jsx("main", {
				className: mainClass,
				children: /* @__PURE__ */ jsx(LearningView, {})
			}) : /* @__PURE__ */ jsx("main", {
				className: mainClass,
				children: /* @__PURE__ */ jsx(SettingsView, {})
			})
		]
	});
}
// src/CodeReviewSagePage.tsx
function CodeReviewSagePage() {
	const [initialRunId] = useState(() => new URLSearchParams(window.location.search).get("run"));
	return /* @__PURE__ */ jsx("div", {
		className: "relative h-full",
		children: /* @__PURE__ */ jsxs(SageProvider, {
			initialRunId,
			children: [/* @__PURE__ */ jsx(Workspace, {}), /* @__PURE__ */ jsx(AddReposLayer, {})]
		})
	});
}
/** Mounts the add-repos dialog when the rail asks for it. Separate component so
*  it can read the provider it sits inside. */
function AddReposLayer() {
	const { addingRepos, closeAddRepos } = useSage();
	return addingRepos ? /* @__PURE__ */ jsx(AddReposModal, { onClose: closeAddRepos }) : null;
}
// src/index.tsx
/**
* The bundle's entry: AppHost lazy-imports this module and renders its default
* export as the app's page.
*
* Two things happen here once, for the whole page. The host's permission-scoped
* API client becomes the transport every Code Review Sage call goes through
* (`setTransport`), and the host's language generation is subscribed to, which
* repaints the page on a language switch: `i18nT` reads the active locale at
* call time, and this component's re-render reaches every child.
*/
function CodeReviewSageApp() {
	useLanguageGeneration();
	setTransport(useAppApi());
	return /* @__PURE__ */ jsx(CodeReviewSagePage, {});
}
export { CodeReviewSageApp as default };
