# EPIC-158: Refactoring Phase 6.1 part 1 — browser editor: module shape, shared rules, and the `BrowserWebviewModel` split

## Status

**Status:** Completed 2026-11-13
**Created:** 2026-11-13

## Overview

This is the eighteenth epic of the [refactoring roadmap](../refactoring-roadmap.md) and the first of Phase 6 (feature
areas). Roadmap item 6.1 (Browser) covers eleven findings (BRW-1, 2, 4, 5, 6, 7, 9, 10, 11, 12 in
`doc/reviews/refactoring-2026-11/06-browser.md`, plus MAIN-7 in `01-main.md`) — far more than one epic. This epic is
**6.1 part 1**: the renderer-side model work centred on `BrowserWebviewModel`. The view split, tab state, guest
protocol, bookmarks, page creation and the main-process side are parts 2 and 3 (see [Remainder](#remainder)).

The code was checked on 2026-11-13, after EPIC-157. Line numbers in the report have drifted; the current state:

- `BrowserWebviewModel.ts` is 1,453 lines. It holds the webview registry (`webviewRefs`/`webviewReady`, public and
  mutated from `BrowserView`, `BrowserTargetModel`, the facade and `BrowserTranslationController`), the guest event
  router, a ~600-line site-extension runtime (documents, injection, trust prompts, the page→main fetch proxy, actions
  with timeouts and choice tokens), page-authored AiVision probing, a per-tab translation-controller registry wired
  back to the toolbar workflow through `setTranslationLifecycle`, find-in-page commands, the page menu and "Show
  Resources", and a second Ctrl+F keyboard handler.
- Page-authored AiVision (`pages[i].editor.app`) is spread over `BrowserEditor` (registration store),
  `BrowserWebviewModel` (probe/signals), `BrowserEditorFacade` (CDP transport, revalidation, WebMCP routing,
  refusals), `BrowserTabsModel` (invalidation on close) and `BrowserView` (indicator, `aiVisionIndicatorRevision`).
- `BrowserEditorModel.ts` (369 lines) is a state/constants module that ends with
  `export { BrowserEditor as BrowserEditorModel }`; 18 files use the alias, and the re-export closes a value-level
  import cycle through `BrowserWebviewModel`.
- Small rules are copied at call sites: zoom bounds (renderer and `src/main/browser-service.ts`), `isIncognito ||
  isTor`, the site-extension trust-grant match, trust-prompt construction, active-prompt selection, tab teardown (three
  copies in the tabs model plus one in the view, with different cleanup subsets) and the facade's privacy guard.
- The cross-area note about `PageWrapper` reporting a stale `state.url` is already fixed (it reads `currentUrl`).

## Goals

- **`BrowserWebviewModel` owns guests and one event router.** What stays: the registry (private, behind
  `attach`/`detach`/`get`/`isReady`), readiness, load/back/forward/reload, zoom, devtools, and one router method that
  fans out to the collaborators in the same order as today. Target: under ~550 lines.
- **One owner per feature**, each composed by `BrowserEditor` and exposed as an editor member:
  - `editor.siteExtensions` — `BrowserSiteExtensionController` (the whole site-extension runtime, trust-prompt state,
    a `SiteActionDocument` class replacing the anonymous 11-field record, one `resolveFetch` evaluate);
  - `editor.pageRemote` — `BrowserPageRemote` (registration store, probe/signals/late probe, `request`, `revalidate`,
    WebMCP routing, tab hooks, a `changed` subscription replacing `aiVisionIndicatorRevision`, every privacy check of
    the feature); the facade keeps only agent presentation (proxy caching, `createRemoteProxy`, labels, refusal
    wording);
  - `editor.find` — `BrowserFindModel` (state + open/close/next/prev/found, the find reset now in the tabs model);
  - `editor.translation` — `BrowserTranslationController` as the single translation owner (per-tab page pumps moved
    in, `setTranslationLifecycle` deleted, one `tabView(tabId)` + one subscription, one detection-sample path).
- **One copy of each small rule:** `src/shared/browser-zoom.ts` (renderer and main), `isPrivateBrowserSession`,
  `siteExtensionTrust.isGranted`, `SiteExtensionTrustPrompt.from`, `siteExtensions.activePrompt()`, one
  `BrowserEditor.releaseTab(tabId)` fanning out to `onTabReleased`, one `requireAgentAccess()` in the facade, one
  module of page-global names (`__aiVision`, `__persephoneWebMcpRemote`) shared by preload, probe and transport.
- **Module shape:** `BrowserEditorModel.ts` becomes `browser-state.ts` + `search-engines.ts`; the alias, the
  compatibility delegates on `BrowserEditor` and the `BrowserView` re-export are gone; the facade declares
  `implements IAiVisible, IBrowserEditor`. One keyboard shortcut table on `BrowserEditor`; the page menu and
  "Show Resources" live in `browser-page-menu.ts` beside `webview-context-menu.ts`.

## Decisions this epic acts on

- **Scope split.** Part 1 = BRW-12, BRW-11, BRW-1, BRW-2, BRW-7: they all carve the same file (`BrowserWebviewModel`)
  and the report asks for BRW-11 before BRW-1 and BRW-1 together with BRW-2. The view split (BRW-5) waits for part 2
  because it is easier once the models it should bind to exist; tab state (BRW-4) changes navigation semantics and
  deserves its own epic slot with the link-interception retest.
- **Pure move first.** US-1898 (module shape) is mechanical renames and import rewrites, done first so the later tasks
  start from the final file names (report: "run it first or last").
- **The router order is load-bearing.** `did-navigate`, `did-start-loading`, in-page navigation and tab close keep
  their exact order of effects (the `siteDocuments` bump before re-injection, the registration cleared before the
  probe, …). The router method stays the one place that order is visible; collaborators expose `onX(tabId)` hooks it
  calls. Each plan lists the order before and after.
- **No behaviour change** to: site extensions (injection, trust prompts, fetch proxy limits, actions, choice tokens),
  page-authored AiVision (registration, revalidation, refusals and their wording, WebMCP), find-in-page, translation,
  zoom (the clamp/validity rule becomes one — if the copies differ today, the plan names the surviving rule and why),
  the `data-name` contract, the script facade member names, MCP `call` behaviour and AiVision paths/messages.
- **No new protocol code** (guardrail 1). Guest↔host messages keep their current channels in this epic (the typed
  `GuestMessage` union is part 2, BRW-6); main-side calls use the EPIC-156 IPC contracts. `window.persephone` is not
  touched, so no `BOARD_BRIDGE_VERSION` bump.
- **Imports.** No `await import()` to break a cycle (guardrail 5). The new collaborators are statically imported by
  `BrowserEditor`; the facade imports types only where it already did.
- **God files only shrink** (guardrail 3): `BrowserWebviewModel.ts` (1,453), `BrowserEditor.ts` (774),
  `BrowserView.ts` (1,290), `BrowserEditorFacade.ts` (992) and `BrowserTabsModel.ts` (363) must not grow.

## Linked Tasks

| Task | Title | Status |
|------|-------|--------|
| US-1898 | Browser module shape: `browser-state.ts` + `search-engines.ts`, no alias, no compatibility delegates (BRW-12) | Done |
| US-1899 | One copy of the small browser rules: zoom, private session, trust grant/prompt, `releaseTab`, facade access guard (BRW-11) | Done |
| US-1900 | `BrowserSiteExtensionController` and `SiteActionDocument` (BRW-1 step 1) | Done |
| US-1901 | `BrowserPageRemote`: page-authored AiVision in one owner (BRW-2) | Done |
| US-1902 | `BrowserFindModel`, `browser-page-menu.ts`, one shortcut table, private webview registry (BRW-1 steps 2–5) | Done |
| US-1903 | One translation owner (BRW-7) | Done |

**Order.** As listed. US-1898 is the pure move; US-1899 gives the extracted controllers their shared helpers; US-1900
and US-1901 carve the two large features out of `BrowserWebviewModel`; US-1902 finishes the carve-out and makes the
registry private; US-1903 then makes translation one owner with the router calling it directly.

### Task notes for the planners

- **All tasks.** Name the owner of every moved rule and the helper reused. List line counts before/after for the god
  files above. Keep `data-name` values and facade member names unchanged.
- **US-1898.** Every importer of `BrowserEditorModel` (18 files) moves to `import type { BrowserEditor }` or the
  new module names; delegates removed only after every caller uses `editor.tabs.*`/`editor.tor.*`; keep members that
  form the documented editor API (`doc/architecture/browser-editor.md`). Decide where `partition` goes (BrowserEditor
  or a small `BrowserSession`) and why. Confirm the value-level cycle is gone.
- **US-1899.** For zoom, list every copy (renderer and main) and the rule each applies today. For tab teardown, list
  the cleanup each copy does today and confirm the single `releaseTab` does the union without double-disposing.
  Drop the dead `via` parameter of `privateBrowserRefusal`.
- **US-1900.** The controller's public API per the report (`onDocumentReady`, `onNavigation`, `onTabReleased`,
  `onActiveTabChanged`, `refreshTrust`, `trustPrompt`, `dismissPrompt`, `reload`, `actions`, `runAction`,
  `chooseResult`, `activePrompt`, `dispose`); trust-prompt state writers move from `BrowserEditor`;
  `site-extensions-agent.ts` and the facade call the controller.
- **US-1901.** All privacy checks of the feature (`agentMayAccessBrowserPage`) move into `BrowserPageRemote`; the
  facade's remaining checks call the same predicate. The page-global names module must be importable by the webview
  preload (check the preload's build entry and import zones). Refusal message wording unchanged.
- **US-1902.** The two Ctrl+F handlers: show both today and the one table after; same keys, same effect.
  `attach`/`detach` keep the identity check `BrowserView` does today.
- **US-1903.** Pick one detection-sample path (agent sample or `executeJavaScript`) and say why; delete the other.

## Remainder

Not in this epic; recorded in the roadmap for the next agent:

- **6.1 part 2 (renderer):** tab state without mirrors and explicit navigation (BRW-4); split `BrowserView.ts` and add
  `BrowserSitePermissionsModel`, favicon/guest-registration out of the view, one permission-labels table, named toolbar
  controls (BRW-5); typed `GuestMessage` protocol, `BrowserGuestChannel`, dead title/favicon/find events removed, preload
  split (BRW-6); `BrowserBookmarksModel` + `resolveBrowserProfile` with the Tor bookmark read/write fix (BRW-9);
  `BrowserEditor.createNew` with disposal on refusal (BRW-10).
- **6.1 part 3 (main):** `BrowserGuest` + `BrowserGuestRegistry`, `HostFullscreenController` (breaks the
  `open-windows` cycle), `browser-dom-snapshot.ts`, `CdpTarget` with feature modules and one `resolveTarget` (MAIN-7).

## Out of scope

- Automation and facades (6.2: `AutomationSurface`, `operations.ts`, `EditorFacadeBase`).
- The AiVision folder (BRW-13) and `browser-editor.md` rewrite (BRW-14) beyond what `/document` updates.
- Any change to `window.persephone`, MCP `call` behaviour, persisted browser page descriptors or the `data-name`
  contract.
- US-1873 (board docs) stays in Planned until the refactoring work is done.

## Notes

### 2026-11-13
- Epic created after EPIC-157. Current state re-checked against the code (see Overview). Scoped as 6.1 part 1; the
  remainder is listed above and in the roadmap.

### 2026-11-13 — implementation and close
- All six tasks implemented and staged in one unattended run; typecheck, lint and build-prod pass after each. After each
  task the app was checked through the MCP HTTP endpoint (a browser page opened and closed). After US-1903 a cold
  `npm start` ran the browser flows: example.com loaded, find-in-page found and closed, a guest link click navigated to
  iana.org, a hash change was an in-page navigation, and the translation tab view answered. No site extension applies to
  those pages, so the extension flow was exercised only as "no prompt, no actions". Tor/proxy refusal and live
  translation were not exercised (no network login or provider use in an unattended run).
- **Sizes (wc -l), epic start → end.** `BrowserWebviewModel.ts` 1,453 → 376, `BrowserEditor.ts` 774 → 616,
  `BrowserView.ts` 1,290 → 1,171, `BrowserEditorFacade.ts` 992 → 847, `BrowserTabsModel.ts` 363 → 351. New owners:
  `BrowserSiteExtensionController` (569) + `SiteActionDocument` (102), `BrowserPageRemote` (587), `BrowserFindModel` (72),
  `BrowserShortcutTable` (99), `browser-page-menu.ts` (92), `BrowserSiteActionsView` (125),
  `BrowserTranslationPopoverContentView` (57), `browser-state.ts` (230), `search-engines.ts` (122),
  `site-extension-trust-prompt.ts` (27), `src/shared/browser-page-globals.ts` (3).
- **Decision refinements (plan review).**
  - US-1899: `releaseTab` runs only on tab removal. A view detach while the tab lives keeps exactly today's effects
    (site-extension clear, translation end) — running the full union there would drop an agent's `.app` binding on a
    mere unmount. Zoom helpers keep the `PAGE_ZOOM_*` names (`clampPageZoom`, `isValidPageZoom`, `PAGE_ZOOM_DEFAULT`).
  - US-1900: no feature-specific facade base class (roadmap 6.2 introduces `EditorFacadeBase`); the six site-extension
    facade members stay on `BrowserEditorFacade` as thin delegations. The toolbar site-action button moved to
    `BrowserSiteActionsView` as a pure UI move (a small slice of BRW-5).
  - US-1901: no forwarding seams on `BrowserEditor`; `BrowserTabsModel.switchTab` calls `pageRemote.invalidateBinding()`
    directly. `aiVisionIndicatorRevision` is gone; the toolbar re-syncs on `pageRemote.changed`. The page-global names
    live in `src/shared/` (the cross-process home), imported by the webview preload, the probe and the transport.
  - US-1902: the find reset stays a `find.reset()` call at `switchTab`'s old spot, so closing or adding a tab still does
    not reset find. The shortcut table lives in `BrowserShortcutTable`, owned and dispatched by `BrowserEditor`.
  - US-1903: the agent's detection-sample pipeline was already gone; the controller's `executeJavaScript` read is the one
    path. `BrowserWebviewModel.dispose()` was removed because it only disposed the moved translation map.
- **Review.** `/review` found no guardrail or architecture findings (two EOF blank lines were trimmed); `/document`
  updated seven architecture docs; `/userdoc` needed no changes. No English catalog messages changed;
  `npm run i18n:check` reports every pack complete.
- **Deliberate behaviour change.** Closing a tab whose view is not mounted now also stops its page translation.
