# EPIC-157: Refactoring Phase 5.7 — content Layer 2 records a typed `action`; Layer 3 executes it

## Status

**Status:** Completed 2026-11-13
**Created:** 2026-11-13

## Overview

This is the seventeenth epic of the [refactoring roadmap](../refactoring-roadmap.md) and the last part of Phase 5
(pages, settings, startup and app conventions). It covers roadmap item 5.7 and finding **CORE-11**
(`doc/reviews/refactoring-2026-11/04-api-core.md`), including its step 4, which is also CORE-3 step 5.

The code was checked on 2026-11-13, after EPIC-156. The finding's line numbers have drifted; the current state is
restated here.

**The problems.**

- **Layer 2 carries out non-content actions itself.** The pipeline is "parsers set `url` → resolvers set
  `pipe`/`target` → the open handler opens". For content that holds. For everything else the resolver does the work:
  - `content/resolvers.ts` (file fallback) opens a browser for explicit browser intent and opens a folder page through
    `pages.lifecycle.addEmptyPageWithNavPanel` (via `await import("../api/pages")`);
  - `content/builtin-schemes.ts` `openLinkInBrowser` routes to a browser page by duck-typing
    `(editor as any).navigate/addTab`, opens browser tabs, and through `launchExternal`/`externalLaunchDecision`
    checks the board grant, appends to the board log over IPC and shows a confirmation dialog;
  - `resolveHttp` invokes the `http.request.open` capability and maps capability errors to toasts;
  - `resolveData` runs `image.edit` through `openImageForEdit`;
  - `resolveGuide` and the parse hooks (`parseFolderEditor`, `parseGuide`) show notifications.
- **The `phase` guards.** Because resolvers have side effects, the same hooks — also used for pure pipe reconstruction
  (`resolveRegisteredSourcePath`, used by `rebuild-pipe.ts`) — need `context.phase` branches: five in
  `builtin-schemes.ts` (`resolveVirtual`, `resolveData` twice, `resolveGuide`, `resolveHttp`) and one in
  `api/boards/custom-editor-registry.ts` (`createBoardSchemeHooks`). Notifications in parse hooks are not guarded at
  all, so a source-path rebuild of a malformed `folder-editor:`/`persephone-guide:` link can toast.
- **The hand-off is re-implemented.** The fallback handlers in `parsers.ts` (three) and `resolvers.ts` (two) each
  repeat `data.handled = false; await next.sendAsync(data); data.handled = true`, which `context.handoff()` already
  does for scheme hooks.
- **`content/` holds UI.** `content/tree-context-menus.ts` and `content/open-with-editor.ts` build context-menu items
  with icons and import `editors/`, `theme/` and `api/ui`.

## Goals

- **Resolvers classify; Layer 3 acts.** `ILinkData` gains an output-only, typed `action` (a discriminated union, at
  least: content, browser, folder page, capability; external launch either as its own kind or as the browser kind's
  `os-default` mode — the plan decides and says why). Parse and resolve hooks only set fields (`url`, `target`,
  `pipe`/`pipeDescriptor`, `action`) and hand off; no hook in `content/` or `api/boards/custom-editor-registry.ts`
  opens a page, a browser, a dialog, a toast, an IPC call or a capability.
- **One Layer 3 action table.** `content/open-actions/` holds one executor per non-content kind (browser incl. the
  board `openExternal` rule and the unattributed-popup confirmation, folder page, capability with its per-capability
  failure feedback, and notices if the plan adds them). It may depend on `api/pages`, the board registry, `api/shell`,
  the capability client and dialogs. `open-handler.ts` keeps the content exit (`openContent` → page) unchanged.
- **No `phase` branches in platform hooks.** The source-path rebuild runs the same hooks and simply never executes a
  non-content action. `context.phase` stays on `ISchemeHookContext` for scripts (public contract), but no platform
  code reads it.
- **One hand-off helper** for the five fallback handlers and the scheme hook context.
- **Menu builders leave `content/`.** `tree-context-menus.ts` and `open-with-editor.ts` move to a UI-side home (the
  plan picks it, respecting the import zones; `editors/shared/link-open-menu.ts` is the nearest existing neighbour).

## Decisions this epic acts on

- **Where non-content actions execute.** The roadmap sketch has `open-handler.ts` dispatch them. Routing them through
  the `openContent` channel would change what script subscribers of `openContent` see (they would receive events with
  no `pipe`), and §8 says scripts must still see the same events. Decision: **`openContent` keeps carrying content
  only**. The hook's hand-off is the one dispatch point: a content action hands off to `openContent` as today; any
  other recorded action is executed by the action table *after the hook returns*, in the open pipeline only (the
  registered-scheme dispatchers and the fallback handlers call one shared `runOpenAction`/hand-off helper). The
  source-path rebuild (`resolveRegisteredSourcePath`) never calls it — that is what removes the guards.
- **`action` is output-only and cannot be smuggled in.** Link data reaches the pipeline from boards, MCP, web pages
  and scripts. A pre-set `action` must never be executed: the dispatch point clears `data.action` before running a
  hook and executes only what the hook recorded. The plan lists the entry points it checked (board bridge, MCP,
  browser link clicks, `RendererEventsService`) and confirms none can bypass this. A board-originated external launch
  still goes through the board `openExternal` grant (guardrail 2: the grant lookup stays `boardRegistry.grant(...)`,
  no new trust check).
- **Script surface.** `action` is added to the script-facing `ILinkData` type (`api/types/io.link-data.d.ts`) as an
  additive, documented field so a script scheme can request a non-content open without a phase check; it is stripped
  by `cleanForStorage`. `ISchemeHookContext.phase`, `delegate()` and `handoff()` keep their names and behaviour.
  Events seen by `openRawLink`/`openLink`/`openContent` subscribers are unchanged. No `window.persephone` change, so
  no `BOARD_BRIDGE_VERSION` bump.
- **Behaviour is unchanged** for every open flow: browser routing incl. `browserPageId`/`browserTabMode`, the
  `link-open-behavior` setting, the board `openExternal` rule and its log lines, the unattributed-popup confirmation,
  `openedPageId` for folder pages, `image.edit` and `http.request.open` with their failure toasts, guide-not-found
  toasts, cURL/fetch parsing, PDF/board-editor fallbacks. The one intended change: a source-path rebuild no longer
  toasts for a malformed link.
- **The typed `navigate`/`addTab` call.** The duck-typed `(editor as any)` call goes away: the browser executor uses
  a typed check (an existing browser editor type guard or `instanceof`, whichever exists without a new cycle).
- **Imports.** The executors import their dependencies statically. A dynamic import stays only where the plan shows it
  keeps an editor out of the startup bundle (critical pattern 1); none dodges a cycle (guardrail 5).
- **God files only shrink** (guardrail 3). `builtin-schemes.ts` (399 lines) and `resolvers.ts` (71) end smaller.

## Linked Tasks

| Task | Title | Status |
|------|-------|--------|
| US-1896 | Move the context-menu builders out of `content/` (CORE-11 step 4, CORE-3 step 5) | Done |
| US-1897 | Typed `action` on `ILinkData`, the Layer 3 action table, no `phase` guards, one hand-off helper (CORE-11 steps 1–3) | Done |

**Order.** US-1896 first: it is a pure move (roadmap §8, "pure moves first") and it takes the UI imports out of
`content/` before US-1897 adds the executors there.

### Task notes for the planners

- **US-1896.**
  - Pick the destination from the import zones in `eslint.config.*` and the UIKit/components split; list every
    importer to update (`app-startup.ts`, `ui/sidebar/RecentFileListView.ts`, `tree-context-menus.ts` itself, anything
    else found).
  - Pure move: no logic change. Fix the documents that name the old paths (`key-files.md`, `folder-structure.md`,
    `content-pipeline.md`) only where they state the path.
- **US-1897.**
  - Inventory every side effect in `content/parsers.ts`, `content/resolvers.ts`, `content/builtin-schemes.ts` and
    `createBoardSchemeHooks`, with the action kind that replaces it.
  - The `action` union (exact TypeScript), where it is declared (the script-facing `.d.ts` plus whatever internal
    type), and its `cleanForStorage` handling.
  - The dispatch point: how `createHookContext`, `dispatchRegisteredSchemeParse`/`Resolve` and the fallback handlers
    clear, record and execute; show that `resolveRegisteredSourcePath` never executes. Show the ordering is the same
    as today (the action runs where the side effect ran, `handled` ends `true` as before).
  - `resolveGuide`: how it loses its phase branch (always build the descriptor; the not-found check and the title
    lookup either run in both phases without side effects, or become a notice action) — state the source-path result
    for a missing guide before and after.
  - The browser executor: the typed browser-editor check; `launchExternal` and `externalLaunchDecision` moved intact.
  - The capability executor: `image.edit` (`openImageForEdit`, `notifyEditCapabilityFailure`) and
    `http.request.open` (payload, `no-handler` mapping) — one executor with a per-id feedback table, or one per id;
    say which.
  - The entry-point audit for a pre-set `action` (see the decision above).
  - Docs: `doc/architecture/content-pipeline.md` (Layer 2/3 sections, the open-actions table),
    `assets/guides/scripting/api/io.md` and the `io.d.ts` comment if they describe resolvers performing actions.

## Out of scope

- The Phase 6 feature splits (browser `BrowserPageRemote`, automation, voice, editor framework).
- Moving `open-in-persephone.ts`/`open-with-default-app.ts` (they are actions, not menus; they stay in `content/`).
- Any change to `window.persephone`, MCP `call` behaviour, persisted descriptors or `sourceLink` shape.
- US-1873 (board docs) stays in Planned until the refactoring work is done.

## Notes

### 2026-11-13
- Epic created after EPIC-156. Current state re-checked against the code: six `context.phase` branches (five in
  `builtin-schemes.ts`, one in `custom-editor-registry.ts`); five hand-rolled hand-offs in `parsers.ts`/`resolvers.ts`;
  the two menu builders still in `content/`.

### 2026-11-13 — implementation and close
- Both tasks implemented and staged in one unattended run; typecheck, lint and build-prod pass after each. After
  US-1897 a cold `npm start` came up and, through the app's MCP HTTP endpoint (the session's Persephone MCP connection
  was down), `script.execute` drove the pipeline: a file opened with a `revealLine` hint, a folder opened as a page
  with `openedPageId` set, a missing guide showed "Guide not found", a valid guide opened titled, and a link with a
  seeded `action` (a notice) opened the file and showed no notice.
- **Sizes (wc -l).** `builtin-schemes.ts` 399 -> 266, `resolvers.ts` 71 -> 63, `parsers.ts` 69 -> 63; new
  `content/link-handoff.ts` (11) and `content/open-actions/` (`dispatch.ts`, `browser.ts`, `capability.ts`,
  `folder-page.ts`, `notice.ts`, 182 lines together).
- **Decision refinements.**
  - US-1896: the menu builders live in `src/renderer/ui/link-menus/` (app UI, not editor-owned and not UIKit
    primitives); `editors/shared/link-open-menu.ts` stays where it is. Pure move, import paths only.
  - US-1897, corrected at review: one wrapper, `runOpenStep` in `open-actions/dispatch.ts`, clears any incoming
    `action`, runs the step and executes only what the step recorded; it wraps every platform subscriber in
    `parsers.ts` and `resolvers.ts` (the scheme dispatchers and all fallbacks), so a seeded action never reaches an
    executor on any path. `scheme-registry.ts` stays action-free (it imports only the dependency-free
    `link-handoff.ts`), so `api/boards/custom-editor-registry.ts` gains no edge to pages or dialogs. External launch
    is the browser kind's `os-default` mode rather than its own kind, since the board `openExternal` rule already
    sits inside browser routing. Failures are a `notice` action, so the source-path rebuild is silent. `resolveGuide`
    sets the descriptor before its lookup and records a notice without creating a pipe when the guide is missing;
    source-path now performs that read-only lookup and returns the same descriptor pipe as before. `BrowserEditor` is
    the only dynamic import in the executors (code splitting); the typed `instanceof` replaces the `any` cast.
- **Review.** `/review` found that `createLinkData()` still typed `action` as a caller option; its options type now
  omits `action` (the runtime clearing was already in place). `/document` updated `agents-common.md`,
  `content-pipeline.md`, `key-files.md` and `folder-structure.md`; `/userdoc` stated in the scripting `io` guide that
  `action` is pipeline output. No English catalog messages changed.
- **Deliberate behaviour changes.** A source-path rebuild of a malformed `folder-editor:` or `persephone-guide:` link
  no longer shows a toast; an `action` set by a caller is ignored. Script subscribers of `openRawLink`, `openLink` and
  `openContent` see the same events; `ISchemeHookContext.phase` is kept for scripts.
