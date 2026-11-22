# EPIC-207: Page environment for web-app tests

## Status

**Status:** Completed 2026-11-22
**Created:** 2026-11-22

## Overview

Step 5 of the [web-app testing review](../reviews/web-app-testing-review.md) roadmap (section 3 F). A test cannot set
up a browser page **before the app's scripts run**, and cannot observe or shape what leaves the page: a temporary
extension is injected when the document is ready, after the app has already read its storage and captured `fetch`.
The pilot suite worked around this by patching `URL.createObjectURL`, `XMLHttpRequest.prototype.open`, dispatching
fake `copy` events and editing `localStorage` through `evaluate`, all after load. This epic adds init scripts at
document start, storage state save/apply, captured downloads, declarative request routing, a page-scoped clipboard,
storage helpers and a fake clock.

Steps 1a–4 ([EPIC-202](EPIC-202.md) … [EPIC-206](EPIC-206.md)) are done. [EPIC-204](EPIC-204.md) built the page
ownership the access rule below rests on (owned pages, `ctx.usePage` session pages, the test window); US-2144 built
the per-page popup/download/dialog gates in `src/main/browser/`.

Proposals covered: **F1, F2, F3, F4, F5, F6, F7**. Feedback items closed: 9, 19, 20 and the storage half of 3
(US-2138). Out of scope: input fidelity, guides and scaffolding (steps 6–7).

## Goals

- **F1** Init scripts registered with CDP `Page.addScriptToEvaluateOnNewDocument`, run before any page script on
  every load (`attachTestExtension({ …, runAt: "document-start" })` and/or `addInitScript`).
- **F2** `storageState()` (cookies, `localStorage`, `sessionStorage` for the origin) and `ctx.openBrowser(url,
  { storageState })` applying it at document start; state never appears in logs, reports or failure bundles.
- **F7** `storage.clear({ prefix })` / `storage.set(key, value)` helpers.
- **F4** `waitForDownload()` → `{ suggestedFilename, path, size }`, saved into the run folder with no Save dialog,
  attached to the report; hooked into the per-page download gate from US-2144.
- **F3** Declarative `route(urlOrRegex, { status, body, headers } | "abort" | { delayMs })` / `unroute` over the CDP
  `Fetch` domain.
- **F5** Page-scoped clipboard `readText()` / `writeText()`; never a general OS clipboard read.
- **F6** `clock.install({ now })` / `clock.fastForward(ms)`, built on F1.

## Linked Tasks

| Task | Title | Proposals | Status |
|------|-------|-----------|--------|
| [US-2165](../tasks/US-2165-init-scripts/README.md) | Init scripts at document start | F1 | Done |
| [US-2166](../tasks/US-2166-storage-state/README.md) | Storage state and storage helpers | F2, F7 | Done |
| [US-2167](../tasks/US-2167-captured-downloads/README.md) | Captured downloads | F4 | Done |
| [US-2168](../tasks/US-2168-request-routing/README.md) | Declarative request routing | F3 | Done |
| [US-2169](../tasks/US-2169-page-clipboard/README.md) | Page-scoped clipboard | F5 | Done |
| [US-2170](../tasks/US-2170-fake-clock/README.md) | Fake clock | F6 | Done |

Order follows the roadmap (F1, F2, F4, F3, F5, F7, F6) with one change: F7 is folded into US-2166, because both are
storage reads/writes on the same origin and share one owner. Every task depends on US-2165 (F1) or the access rule;
plans are written one at a time after the previous implementation, each implementation staged after review. If the
budget runs out, the epic stops at a task boundary and the rest becomes the next epic.

## Decisions (2026-11-22)

Taken by Claude at epic start; the user delegates these choices (review section 6 answers taken as recommended).

1. **One CDP domain, one collaborator.** Main-process CDP features live as feature modules under `src/main/cdp/`
   composed by `cdp-service.ts` (the existing pattern: `cdp-network-collector.ts`, `cdp-page-events.ts`,
   `cdp-waits.ts`). F1 gets its own module for `Page.addScriptToEvaluateOnNewDocument`, F3 its own for the `Fetch`
   domain. Renderer-facing members go into browser-facade collaborators, not into `BrowserWebviewModel.ts` or another
   roadmap §2.3 god file. `cdp-service.ts` may gain only the composition lines (attach/detach/clear) and the facade
   entries, as for the existing modules.
2. **No new protocol code.** Renderer → main calls go through the existing browser IPC/typed RPC used by the other
   CDP features (`src/ipc/browser-ipc.ts`); a routed request, a download completion or a clipboard copy is answered
   or awaited through existing primitives (`PendingRequests`, the `cdp-waits` pattern, the US-2144 download gate). A
   new correlator, ack window, event channel or error envelope is a review blocker.
3. **Access rule for test powers (F2 read, F3, F4, F5).** One predicate, next to `agentMayAccessBrowserPage` in
   `src/renderer/editors/browser/agent-access.ts` (dependency-free, same callers), decides whether a page may use
   test powers: the page was opened by the agent (`openedByAgent`, which `ctx.openBrowser` pages already carry
   because the runner opens them over MCP) **or** it was adopted by `ctx.usePage` in the current test run. Adoption
   is an ephemeral, never-persisted flag set through a runner-only member (the same family as
   `windows.createTestWindow`); it is refused on an incognito/Tor page the user opened (the existing privacy rule
   wins), and dropped when the page is restored or the run ends. The refusal message names the rule and the remedy
   (`ctx.openBrowser` or `ctx.usePage`). Recorded limit: any MCP client can call the runner member, exactly as any
   agent can already `evaluate` on a non-private user page; the gate keeps these powers from landing on a user's page
   by accident, it is not a sandbox. F1, F6 and F7 are `evaluate`-equivalent and follow the existing page access rule.
   `storageState()` reads `HttpOnly` cookies, which `evaluate` cannot, so it is a test power.
4. **Storage state is a secret.** Allowed (review §6 Q3). The runner never writes a storage state value, the
   arguments of the call that applies it, or the reply of `storageState()` into `tests.log`, `report.*`, step logs or
   failure bundles (redacted to a size/count summary). The guide says state files hold sign-in tokens and belong in a
   git-ignored folder. No `.gitignore` edit in the repo.
5. **Request routing is test-only (review §6 Q4).** Routes exist only on test-power pages, are scoped to the page
   (its `WebContents`/CDP target, never the session or profile), are cleared on unroute, navigation away from the
   run, page close and run end, and are planned against the request handling the session already does
   (`network-logger.ts` `webRequest` listeners, the network collector, the download gate) so two layers never answer
   the same request. Declarative only: JSON in, no handler function.
6. **Downloads stay in the run folder.** A captured download is written under the run's output folder with a
   sanitised file name (no path separators, no traversal, collision-safe), with no Save dialog, only while a
   `waitForDownload` is armed on a test-power page; everything else keeps the US-2144 behaviour. The runner attaches
   it to the report.
7. **Clipboard never reads the OS clipboard.** `readText()` returns only text the page under test itself produced by
   a copy (captured on the page side), never whatever the user copied elsewhere. `writeText()` affects only what the
   page under test reads on its next paste (scoped, not a general OS clipboard overwrite, if the plan finds that
   workable; otherwise the plan records why).
8. **Bridge version.** New browser-editor members reach boards through `window.persephone.call()`. The first task that
   adds a board-callable member bumps `BOARD_BRIDGE_VERSION` once for the epic (`1.60.0` → `1.61.0`) and writes the
   history line in `assets/guides/agents/boards/bridge-versions.md`; later tasks extend that line without another bump.
9. **Guardrails.** Strict folders stay strict (`npm run typecheck`). Implementation briefs forbid `build-prod` (it
   wipes the running dev build), `.gitignore` edits and changes to shipped demo boards.

## Notes

### 2026-11-22
- Epic created from roadmap step 5. Run autonomously; task investigation and implementation delegated to Codex per
  `persephone-codex-dev`, plan review, security review and live verification by Claude.
- **Plan review decisions.**
  - *US-2165*: separate `addInitScript` / `removeInitScript` / `clearInitScripts` members instead of
    `runAt: "document-start"` on `attachTestExtension` (the extension keeps its host-scoped `site.app` lifecycle). Source
    runs unchanged (no `window.top` wrapper) in the main frame and same-process child frames, like Playwright; OOPIFs
    are not covered. Board-observable through `persephone.call()`, so US-2165 did the epic's bridge bump (1.60.0 →
    1.61.0). The runner clears init scripts on `ctx.usePage` session pages at cleanup (they are never closed).
  - *US-2166*: the shared predicate `agentMayUseBrowserTestPower` (agent-opened, or adopted by `ctx.usePage` through
    hidden runner-only members) gates every test power. `Network.setCookies` writes the page's profile cookie jar, not
    the tab: the guide recommends `incognito: true` or a dedicated profile. Exact-value scrubbing ignores values under
    8 characters and plain literals. `storage.set` arguments are redacted too.
  - *US-2167*: the app saves captures only under its own temp root; the runner copies them into the run folder after
    `realpath` confinement and deletes the app copy; cancellation on committed navigation only (`did-navigate`), never
    on navigation start (a link download starts one); orphaned captures are swept at app start.
  - *US-2168*: request-stage `Fetch` patterns only, `handleAuthRequests: false`; fulfilled cross-origin responses still
    need CORS headers (guide); last registered route wins.
  - *US-2169*: page-side recorder only, never an OS clipboard read; a staged `writeText` answers the next Ctrl+V /
    Shift+Insert with a synthetic `paste` event and, if not cancelled, `execCommand("insertText")`.
  - *US-2170*: fake time keeps flowing with real time (Playwright `clock.install`), `fastForward` jumps.
  - Facades are request-scoped: per-tab state (clock / clipboard registrations) lives in module-level registries.
- **Fixes by Claude during verification.** US-2166: the sensitive-path classifiers (runner and app MCP request log)
  never matched a real `pages["id"].editor.storageState` path (they required a dot before `editor`) — fixed; the
  runner hid every error of a sensitive member, so a real failure read only "Sensitive browser storage operation
  failed" — now the app text is shown, scrubbed by the run redactor; `applyStorageStateForTestRun`, `storageState`
  and `addInitScript` on a just-created page failed with "WebContents not found" — they now `ensureReady` the tab; the
  shared refusal named only `storageState()` — made generic. US-2168: a fulfilled or aborted request never reaches the
  session's webRequest listeners, so routed outcomes were missing from `networkRequests()` and the failure bundle;
  `network-logger.ts` gained `recordRoutedRequest` (metadata only, negative ids), called by the route module after a
  fulfil or abort. Delay-only routes continue the real request and are logged once by the session as before.
- **Live verification (dev app, attached runner, scratch site on 127.0.0.1 with an HttpOnly cookie, Blob download,
  `fetch` API, copy button and a 1 s timer).** F1: init scripts run before the first page script, in registration
  order, after reload and cross-origin navigation; removal stops them; a throwing init script shows in `pageErrors()`.
  F2/F7: `storageState()` returns the HttpOnly cookie and current-origin local/session storage; a fresh incognito page
  opened with `{ storageState: ".state/auth.json" }` sees the values in its first page script; `storage.clear({ prefix })`
  keeps other keys; no state value, token or cookie appears in `tests.log`, `report.*` or the failure bundle (a
  deliberately failing test checked the bundle). F4: Blob + `<a download>` captured as `report.txt`, 20 bytes, no Save
  dialog, copied into the run folder and linked from `report.md`; the app-side capture folder is empty afterwards; a
  second download and a timeout behave. F3: fulfil (status/body/content type), abort, 1.5 s delay, `unroute`,
  `unrouteAll`, regex route with `times: 1`; routed outcomes appear once in `networkRequests()`, without bodies. F5:
  copy button and a trusted Ctrl+C are read back; a staged `writeText` is pasted by Ctrl+V into a textarea. F6: install
  before load, page sees the 2030 date, time keeps flowing, `fastForward(4 min)` fires 240 interval ticks, uninstall
  restores real time. Access rule: `storageState`, `waitForDownload`, `route` and `clipboard.readText` are refused on a
  page the user owns (a restored page); `adoptForTestRun` allows `storageState`, `releaseFromTestRun` refuses it again.
- **Not verified live:** the `ctx.usePage` adoption through the runner end-to-end (the members were exercised directly),
  DevTools detach/reattach restoring scripts and routes, OOPIFs/workers/service workers, Windows SSO headers on a
  continued request, Tor/proxy pages, the 32 MiB download cap, the app MCP request-log redaction (the classifier was
  tested in isolation).
- **Checks.** `npm run lint`, `npm run typecheck` (18 strict folders, 0 errors), `npm run guides:check` (137 pages),
  `npm run i18n:check` (no catalog changes, every pack complete). `npm run test:ui -- --area core` 36 passed.
  `--area browser` 105 passed, 9 failed: `browser/automation/input` (1, passed on rerun) and `browser/popups` (8,
  input and navigation inside popup windows). The 8 popup failures reproduce on `HEAD` with the epic's source changes
  stashed, so they are environmental or pre-existing (the machine's state since EPIC-206's run), not from this epic.
- **Completion skills by Codex (Luna).** `/review` moved the CDP test-power IPC methods out of `cdp-service.ts` into
  `src/main/cdp/cdp-browser-test-methods.ts` (the god file now shrinks by 25 lines); `/document` updated
  `browser-editor.md`, `folder-structure.md`, `key-files.md`, `scripting.md`; `/userdoc` fixed guide links, split the
  runner options into `web-app-tests/run-options.md`, said where state files belong, and added a What's New entry.
  The scratch suite passed again after the review refactor.
