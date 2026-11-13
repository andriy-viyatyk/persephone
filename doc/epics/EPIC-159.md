# EPIC-159: Refactoring Phase 6.1 part 2 — browser renderer: view split, guest protocol, bookmarks, tab state and page creation

## Status

**Status:** Completed 2026-11-13
**Created:** 2026-11-13

## Overview

This is the nineteenth epic of the [refactoring roadmap](../refactoring-roadmap.md) and the second of three for roadmap
item 6.1 (Browser). Part 1 ([EPIC-158](EPIC-158.md)) carved `BrowserWebviewModel` into one owner per feature. This
epic is **6.1 part 2**, the rest of the renderer side: BRW-4, BRW-5, BRW-6, BRW-9 and BRW-10 in
`doc/reviews/refactoring-2026-11/06-browser.md`. Part 3 (main process, MAIN-7) remains.

The code was checked on 2026-11-13, after EPIC-158. Line numbers in the report have drifted; the current state:

- `BrowserView.ts` is 1,171 lines and still holds the webview item, tab page and blank-page links views, the site
  permissions popover, the zoom and translation popovers, the toolbar (~420 lines, with the site-permission and
  certificate workflow inside it), the prompt bars and the editor view. Controls are built in the constructor and
  rebuilt by index in `sync()`. The webview item view registers the guest with main, sends mute state, dispatches guest
  messages and handles favicons (cache write, bookmark scan, profile proxy).
- Guest→host messages are bare strings with cast payloads; main sends `page-title-updated`/`page-favicon-updated`
  events nobody handles; `show-find-bar`/`hide-find-bar` are declared on `BrowserEventType` but main never sends them.
  The `${editorId}/${tabId}` registration key is rebuilt in many places and raw `ipcRenderer` browser calls come from
  several renderer files. `src/preload-webview.ts` (442 lines) is one `if (process.isMainFrame)` block.
- Bookmarks are owned half by `BrowserTabsModel` (resource, preload timer, file path) and half by
  `BrowserBookmarksUIModel` (410 lines). The profile lookup is copied three times and a Tor page reads
  `tor.bookmarks-file` but writes a chosen file into the default profile setting (a bug).
- `BrowserEditorState` mirrors six active-tab fields at the top level; `state.url` goes stale after a link click;
  `tab.url` doubles as the requested URL and the view diffs it to call `loadURL`; `tabs.currentUrls` holds the
  committed URL; the new-tab literal and the active-tab lookup are written out many times.
- `browser-pages.ts` (215 lines) configures a new `BrowserEditor` by writing its state from outside, arms Tor a second
  time, and leaks the half-built editor on a Tor or proxy refusal.

## Goals

- **`BrowserView.ts` split into one file per view** (`BrowserWebviewItemView.ts` with the tab page and blank-page links
  views, `BrowserToolbarView.ts`, `SitePermissionsPopover.ts`, `PageZoomPopover.ts`, `BrowserPromptBars.ts`,
  `BrowserEditorView.ts`), the last only composing the others. The existing `BrowserTranslationPopoverContentView.ts` owns
  translation content; the remaining translation button/popover workflow stays in `BrowserToolbarView.ts`.
- **Views hold no model work.** `BrowserSitePermissionsModel` (`editor.sitePermissions`) owns site permissions and the
  certificate workflow; favicon handling is `BrowserTabsModel.onFavicon`; guest registration/mute/unregister are on the
  webview model's `attach`/`detach`; one `browser-permission-labels.ts` typed by `BrowserPermissionKey`; toolbar
  controls are named fields with one props builder each.
- **A typed guest boundary.** `src/ipc/browser-guest-messages.ts` holds a `GuestMessage` union and channel constants;
  the preload sends through one typed `sendToHost`; the renderer dispatches through one exhaustive
  `handleGuestMessage`. Dead title/favicon/find events are gone. A per-editor `BrowserGuestChannel` owns the
  registration key and is the only renderer path to browser IPC. The preload is split into installers.
- **One bookmarks owner.** `BrowserBookmarksModel` (`editor.bookmarks`) owns the resource and the UI state;
  `resolveBrowserProfile(state)` reads and writes symmetrically for normal, profile, incognito and Tor pages (fixes the
  Tor write).
- **Tab state without mirrors.** One `createBrowserTab`, `editor.activeTab`/`findTab`; navigation is an explicit
  command to the webview model; `tab.url` is the committed URL; `currentUrls` and the top-level mirrors are gone (the
  restore format keeps emitting `url`/`pageTitle`).
- **`BrowserEditor.createNew(options)`** configures, navigates, restores and arms in one place and disposes the editor
  on any refusal; `browser-pages.ts` keeps only page selection.

## Decisions this epic acts on

- **Scope.** All five remaining renderer findings, in six tasks. BRW-4 step 4 (separate `TComponentState` slices for
  URL bar, find and prompt state so views bind only what they render) is **deferred to the remainder**: removing the
  mirrors fixes the stale-URL bug and is the risky navigation change; slicing state is a render-cost refinement that is
  easier once the views are split and should not share a task with the navigation change.
- **Pure move first.** US-1904 splits `BrowserView.ts` without changing behaviour, so later tasks edit the final files.
- **Order.** Split (US-1904) → bookmarks (US-1905, small, touches the view's bookmark reads) → guest protocol and
  channel (US-1906, gives the view-model moves a typed dispatch and one IPC path) → view-model moves (US-1907) → tab
  state and navigation (US-1908, after the views it changes are final) → page creation (US-1909, built on the final
  `navigate()`).
- **No new protocol code** (guardrail 1). `GuestMessage` types the existing `sendToHost`/`ipc-message` channel; it adds
  no correlator, ack or error envelope. `BrowserGuestChannel` wraps the existing browser IPC (EPIC-156 contracts where
  they exist), it does not invent a new transport. Removing main's dead title/favicon sends is a cross-area touch of
  `src/main/browser-service.ts`, allowed here because it only deletes.
- **`window.persephone` is not touched**, so no `BOARD_BRIDGE_VERSION` bump. The webview preload is a page-side guest
  script, not the board bridge; WebMCP and `window.chrome` shim behaviour must stay identical (functions passed to
  `contextBridge.executeInMainWorld` stay self-contained).
- **No behaviour change** to: the `data-name` contract, the script facade member names, MCP `call` behaviour, AiVision
  paths/messages, persisted page descriptors (`getRestoreData` keeps `url`/`pageTitle`; the legacy no-tabs restore still
  works), site extensions, translation, find, link interception and the navigation-claim rollback, Tor/proxy
  fail-closed ("arm before `addPage`"). Deliberate exceptions: the Tor bookmark write fix (BRW-9) and disposal on
  refusal (BRW-10). Any other behaviour change a plan finds necessary is named in the plan and in the notes.
- **Imports.** No `await import()` to dodge a cycle (guardrail 5). Editor code is still reached through the existing
  dynamic editor import.
- **God files only shrink** (guardrail 3): `BrowserView.ts` (1,171, deleted or reduced to nothing by US-1904),
  `BrowserEditor.ts` (616), `BrowserEditorFacade.ts` (847), `BrowserTabsModel.ts` (351), `BrowserWebviewModel.ts` (376),
  `preload-webview.ts` (442) must not grow across the epic.

## Linked Tasks

| Task | Title | Status |
|------|-------|--------|
| US-1904 | Split `BrowserView.ts` into one file per view (BRW-5 step 1, pure move) | Done |
| US-1905 | `BrowserBookmarksModel` and `resolveBrowserProfile`, with the Tor bookmark fix (BRW-9) | Done |
| US-1906 | Typed `GuestMessage` protocol, `BrowserGuestChannel`, dead events removed, preload split (BRW-6) | Done |
| US-1907 | `BrowserSitePermissionsModel`, favicon and guest registration out of the view, permission labels, named toolbar controls (BRW-5 steps 2–5) | Done |
| US-1908 | Tab state without mirrors; navigation as an explicit command (BRW-4 steps 1–3) | Done |
| US-1909 | `BrowserEditor.createNew` with disposal on refusal (BRW-10) | Done |

### Task notes for the planners

- **All tasks.** Name the owner of every moved rule and the helper reused. List line counts before/after for the god
  files above. Keep `data-name` values and facade member names unchanged.
- **US-1904.** Moves and import rewrites only; no logic edits. List each class and its new file. Check nothing outside
  `editors/browser/` imports from `BrowserView` by a path that changes (or update it).
- **US-1905.** Show the three profile-lookup copies and the one rule after, per mode (default, named profile,
  incognito, Tor), for both read and write. Every `tabs.bookmarks`/`initBookmarks` reader moves to `editor.bookmarks`.
  The preload timer and dispose move with the resource.
- **US-1906.** List every guest→host channel and its payload today (preload and translation agent) and the union after.
  Decide the one title/favicon source (expected: the preload, since main's events are unhandled) and delete the other.
  List every place the registration key is built and every raw `ipcRenderer` browser call; all go through the channel
  afterwards. Check the preload's build entry can import the new `src/ipc` module. One `toMemberName()` in the WebMCP
  bridge; the serialized-function constraint respected.
- **US-1907.** Certificate flow: show today's steps (CDP read, origin re-check, capability probe, `certificate.view`
  vs `text.open` fallback, notifications) and confirm the model keeps each, with the facade's `getCertificate`
  delegating. Move the model's IPC listener mount out of the view if the plan finds it is a model lifecycle concern
  (report: "the model hears no browser events while unmounted") — say what changes if it does. Toolbar order and
  `data-name`s unchanged.
- **US-1908.** List every mirror writer and reader, every `currentUrls` use and every `tab.url` write, before and after.
  Show the navigation-claim rollback and the "already at this URL" check and how they work with `tab.url` = committed
  URL. The `PageWrapper` summary must report the active tab's committed URL. Legacy no-tabs restore maps into tab 0.
- **US-1909.** Keep "arm before `addPage`" exactly. List every resource alive after construction and confirm
  `dispose()` releases each on refusal. `matchesBrowser` becomes `editor.matches({ incognito, profileName,
  openedByAgent })`.

## Remainder

Not in this epic; recorded in the roadmap for the next agent:

- **6.1 part 3 (main):** `BrowserGuest` + `BrowserGuestRegistry`, `HostFullscreenController` (breaks the
  `open-windows` cycle), `browser-dom-snapshot.ts`, `CdpTarget` with feature modules and one `resolveTarget` (MAIN-7).
- **BRW-4 step 4 (deferred from this epic):** URL-bar, find and prompt state in their own `TComponentState` slices,
  owned by `BrowserUrlBarModel`, `BrowserFindModel` and the prompt owners, with views binding only the slice they render.

## Out of scope

- Automation and facades (6.2), the AiVision folder (BRW-13), the `browser-editor.md` rewrite (BRW-14) beyond what
  `/document` updates.
- Any change to `window.persephone`, MCP `call` behaviour, persisted browser page descriptors or the `data-name`
  contract.
- US-1873 (board docs) stays in Planned until the refactoring work is done.

## Notes

### 2026-11-13
- Epic created after EPIC-158. Current state re-checked against the code (see Overview). BRW-4 step 4 deferred (see
  Decisions).

### 2026-11-13 — implementation and close
- All six tasks implemented and staged in one unattended run; plans by Codex (Luna, the policy pick while the weekly
  window was tight), reviewed against the source and the roadmap guardrails; Codex Luna implemented. Typecheck, lint
  and build-prod passed after each task, and the app was checked through the MCP HTTP endpoint after each task. After
  US-1909 a cold `npm start` ran the browser flows: example.com loaded with title and favicon (typed guest messages), a
  hash change was an in-page navigation, a link click navigated to iana.org, `navigate()` loaded example.org, find opened,
  a second tab was added and switching tabs re-synced the URL bar, the site-permissions popover opened on the model's
  state, the bookmarks drawer opened, and an incognito page was created through `createNew`. Tor/proxy refusal, site
  extensions and live translation were not exercised (no Tor binary use or provider use in an unattended run).
- **Sizes (wc -l), epic start → end.** `BrowserView.ts` 1,171 → deleted; `BrowserEditor.ts` 616 → 536;
  `BrowserEditorFacade.ts` 847 → 835; `BrowserTabsModel.ts` 351 → 237; `BrowserWebviewModel.ts` 376 → 360;
  `preload-webview.ts` 442 → 14; `browser-pages.ts` 215 → 112. New files: `BrowserWebviewItemView.ts` (180),
  `BrowserToolbarView.ts` (354), `BrowserEditorView.ts` (217), `SitePermissionsPopover.ts` (158), `PageZoomPopover.ts`
  (64), `BrowserPromptBars.ts` (92), `BrowserSitePermissionsModel.ts` (150), `BrowserGuestChannel.ts` (56),
  `BrowserWebviewReadiness.ts` (29), `browser-permission-labels.ts` (17), `browser-profile.ts` (59),
  `BrowserBookmarksModel.ts` (487, the renamed UI model plus the resource lifecycle), `src/ipc/browser-guest-messages.ts`
  (63), `preload-webview/chrome-shim.ts` (46), `webmcp-bridge.ts` (199), `page-reporters.ts` (175).
- **Decision refinements (plan review).**
  - US-1904: a pure move of top-level declarations only. The plan first moved toolbar members into new popover wrapper
    classes; that was sent back as a restructuring. `TranslationPopover.ts` was not created: the content view already
    had its own file (EPIC-158) and the remaining wiring is toolbar code. The move was verified by comparing line
    multisets.
  - US-1905: the Tor bookmark read/write asymmetry the report describes was already fixed in source
    (`bookmark-profile.ts`); `resolveBrowserProfile` keeps that rule and adds the color and the write. No behaviour change.
  - US-1906: `src/renderer/automation/CdpSession.ts` and `operations.ts` stay on raw `BrowserChannel` calls keyed by
    `cdp.registrationKey` (roadmap 6.2 owns the automation surface); `BrowserTargetModel` builds the session from
    `editor.guest.key(tabId)`. Profile, proxy and Tor IPC have no editor tab and stay with their owners. Favicon handling
    moved once, to `BrowserTabsModel.onFavicon`. The preload is the single title/favicon source; main's unhandled
    `page-title-updated`/`page-favicon-updated` forwards and the dead `show-find-bar`/`hide-find-bar` event types are gone.
  - US-1907: the browser-event subscription now lives for the editor model's lifetime instead of the view's (the report's
    "the model hears no browser events while unmounted"). Readiness tracking moved to `BrowserWebviewReadiness`; a
    one-function context-menu wrapper module the implementation added for line count was folded back into
    `webview-context-menu.ts` at review.
  - US-1908: one lifecycle rule replaces the planned "blank guests + pending commands": while a tab has no guest,
    `tab.url` is the URL its guest will open (as restore hydration); once a guest exists only did-navigate /
    did-navigate-in-page write it, and `navigate()` calls `webview.load()` (ready guest: compare `getURL()`; attached but
    not ready: one pending URL consumed at dom-ready). The guest is still constructed with `src = tab.url`, so lazily
    materialized and restored tabs load as before.
  - US-1909: Tor arming keeps today's two attempts for a new page (the restore attempt, then one retry that refuses on
    failure) inside one `BrowserEditor` helper; a successful retry does not clear the restore attempt's error state,
    because `tor.init()` resets it right after `addPage` as before.
- **Review.** `/review` found one non-null assertion (replaced by a guard); `/document` updated `browser-editor.md`,
  `folder-structure.md` and `key-files.md`; `/userdoc` needed no changes. No English catalog messages changed;
  `npm run i18n:check` reports every pack complete.
- **Deliberate behaviour changes.** A refused new browser page (Tor or proxy) now disposes its half-built editor (BRW-10).
  The browser model hears its editor's browser events while the view is unmounted (BRW-5). `state.url` and the other
  top-level mirrors are gone, so the MCP/script page summary reports the active tab's committed URL (the stale-URL bug).
- **Seen in passing (pre-existing, not changed).** The first `did-navigate` of a new guest arrives before the guest is
  registered with main, so a tab's first URL keeps the requested spelling (`https://example.com` rather than
  `https://example.com/`) until the next navigation; a script-initiated link click (no user activation) leaves
  `canGoBack` false. Both behave the same at the epic's start.
