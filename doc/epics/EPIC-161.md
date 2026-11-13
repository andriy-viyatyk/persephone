# EPIC-161: Refactoring Phase 6.2 — automation and facades: `operations.ts` split, narrow targets, `AutomationSurface`, `EditorFacadeBase`, model-owned rules and one log-entry normalizer

## Status

**Status:** Completed 2026-11-13
**Created:** 2026-11-13

## Overview

This is the twenty-first epic of the [refactoring roadmap](../refactoring-roadmap.md) and covers roadmap item **6.2,
Automation and facades**, in full: findings BRW-3 and BRW-8 in
`doc/reviews/refactoring-2026-11/06-browser.md`, and SHL-9, SHL-10 and SHL-12 in
`doc/reviews/refactoring-2026-11/10-shell-scripting.md`. Item 6.1 closed with [EPIC-160](EPIC-160.md).

The code was checked on 2026-11-13, after EPIC-160. Line numbers in the reports have drifted; the current state:

- `src/renderer/automation/operations.ts` is 1,269 lines: locator types and resolution, actionable points, snapshot,
  the activity lease, dialogs/console/errors, `installAutomationActivity` (prototype patching by method-name lists),
  navigation waits, mouse, keyboard, forms, queries, `waitFor`, screenshot, viewport and network, plus the board-only
  `boardDialogs`/`answerBoardDialog`. The in-page "visible" predicate, the ancestor-frame-offset loop and the selector
  resolution are pasted as string snippets in several places; mouse dispatch is written more than once.
  `automation/input.ts` (465) still carries the legacy `{ synthetic: true }` typing stack.
- `automation/types.ts` has one wide `IBrowserTarget` (identity, CDP, synthetic input, navigation, tabs,
  `ensureReady`). `AppTargetModel` throws for 7 members and `BoardTargetModel` for 5–6; the same `mapPoint` reducer is
  copied into all three targets.
- The automation members (`BROWSER_AUTOMATION_MEMBERS` in `scripting/ai-vision/browser-automation-members.ts`) are
  implemented three times: `BrowserEditorFacade.ts` (835), `BoardEditorFacade.ts` (508) and `api/window-screen.ts`
  (224), each with its own `waitFor` option parsing, help paragraphs and `installAutomationActivity` method list; the
  browser facade adds a per-method tip-collector wrapper.
- `PageWrapper.ts` (408) imports every editor and facade, keeps an `EditorFacade` union and a `FACADE_FOR_EDITOR` map
  with `as`/`as unknown as` casts. About 22 facades repeat the same `aiVision` skeleton (`createElements(...,
  { scopeSelector: pageScopeSelector(pageId), beforeHighlight: ... })` + `withEditorGuideHelp`), the `id`/`name`
  member rows and `isAttached`/`requireAttached`. `board-editor:<id>` → `board-view` resolution is special-cased in
  `PageWrapper.ts`, `editor-guide-help.ts` and `ui/app/RenderEditorView.ts`.
- Facades re-implement model rules: the MCP Inspector panel list and direct `model.state` writes
  (`McpInspectorFacade.ts`, 467), the board catalog install state and a hand-written manifest projection
  (`BoardInfoEditorFacade.ts`, 350), and the video play/pause/seek on the exposed `HTMLMediaElement`
  (`VideoEditorFacade.ts`, 175).
- `ui` (`UiFacade.ts`, 162) and `pages.logView` (`LogViewEditorFacade.ts`, 186) normalise Log View entries
  differently (`normalizeUiPushEntry` in `api/mcp/ui-push-validation.ts` vs hand-written button normalisation), and the
  entry handles `Markdown.ts`, `Mermaid.ts`, `Text.ts`, `Grid.ts`, `Progress.ts` are copies of one pattern.

## Goals

- **`operations.ts` is split** into modules with one job each under `src/renderer/automation/` (locator, mouse,
  keyboard, forms, queries, page events, screenshot/viewport/network, synthetic input); the board dialog helpers live in
  `editors/board/`; dead aliases are gone. Callers import from the owning module; no re-export barrel.
- **One in-page snippet per rule** (`page-scripts.ts`: visible predicate, frame offsets, a parameterised selector
  resolver that keeps each caller's current strictness), one mouse dispatch, one modifier-bits table.
- **Narrow targets.** `IAutomationTarget { id; cdp; inputCdp; ensureReady? }`, `ISyntheticInputHost`,
  `INavigableTarget`, `ITabbedTarget`; each operation takes the narrowest; `AppTargetModel` and `BoardTargetModel` no
  longer implement members only to throw; one shared `mapPoint`/input-session helper.
- **One `AutomationSurface`** implements every `BROWSER_AUTOMATION_MEMBERS` method once (including `waitFor` parsing),
  runs each operation through one `run(...)` that does readiness, the activity lease and tip recording, and replaces
  `installAutomationActivity`. The browser facade, board facade and `window.screen` compose it; one `AUTOMATION_HELP`
  constant with host-specific paragraphs appended.
- **`EditorFacadeBase`** owns `id`/`name`, `pageId`, `requireAttached` and the `aiVision` skeleton; an
  **editor facade registry** replaces `PageWrapper`'s imports, union and casts; `editorRegistry` resolves family ids
  (`board-editor:*` → `board-view`) and the three local special cases are deleted.
- **Facades call model rules**: `McpInspectorEditorModel.availablePanels` + setters, `BoardInfoEditorModel.installStateOf`,
  `BoardInfoEditorFacade.properties` built on `projectBoardManifest`, `VideoEditor.play/pause/seek`.
- **One Log View entry normaliser** for `ui.*` and `pages.logView.push` (lenient vs strict modes kept), and one generic
  `LogEntryHandle<TEntry>` replacing the five copied handle classes.

## Decisions this epic acts on

- **Scope.** All of roadmap item 6.2 in six tasks; nothing of 6.2 remains after this epic if all six land.
- **Order.** `operations.ts` split, pure move (US-1916) → snippets, mouse and narrow target interfaces (US-1917) →
  `AutomationSurface` (US-1918, uses the narrow types) → `EditorFacadeBase` + registry + family ids (US-1919; the
  browser and board facades adopt the base after they compose the surface) → facades call model rules (US-1920) → one
  log-entry normaliser + `LogEntryHandle` (US-1921). US-1920 and US-1921 are independent of the automation work.
- **Pure move first.** US-1916 moves code without changing bodies (dead-code deletion and the board-dialog move are the
  only non-move edits, and are listed).
- **Query semantics are kept.** BRW-8 offers either unifying query methods (`getText`, `getValue`, `getAttribute`,
  `getHtml`, `exists`, `waitFor`) onto the strict shared resolver or documenting first-match. Unifying changes MCP
  `call` and script results (a selector that matches two elements would start failing), which §8 says must not change.
  **Decision: keep first-match for queries**; the parameterised resolver reproduces each caller's current strictness,
  and the plan lists every caller's mode. A `text=` locator passed to a query keeps today's result. Recorded so a later
  epic can revisit it with a guide change.
- **The synthetic input path stays** (it is a documented option); it moves to `synthetic.ts` with `ISyntheticInputHost`
  as its only target type. Deleting it is out of scope.
- **Contracts that must not change** (roadmap §8): the script API — `app`, `page`, `io`, every facade member name,
  signature and return shape, the `.d.ts` typings in `src/renderer/api/types/` and `assets/editor-types/`; MCP `call`
  behaviour, including `$help` text (help text may be de-duplicated, but the assembled text an agent reads for each host
  must stay the same in substance and member list); AiVision paths and agent-facing messages; the `data-name` contract;
  error messages scripts can observe (for example "Navigation is not supported…" now comes from the surface or facade
  instead of the target, and must read the same).
- **No new protocol code** (guardrail 1). Nothing here crosses a process boundary; CDP calls keep using `CdpSession`
  and the EPIC-156/160 contracts. **`window.persephone` is not touched**, so no `BOARD_BRIDGE_VERSION` bump.
- **Owners.** Automation modules in `src/renderer/automation/`; board dialog helpers in `src/renderer/editors/board/`;
  `AutomationSurface` and `AUTOMATION_HELP` in `src/renderer/scripting/api-wrapper/` next to the facades (the surface is
  a script-API concern; `automation/` stays target-neutral and import-free of `scripting/`); `EditorFacadeBase` and
  `editor-facade-registry.ts` in `scripting/api-wrapper/`; family-id resolution in `editors/base/editorRegistry.ts`;
  model rules in the owning editor models; the normaliser stays in `api/mcp/ui-push-validation.ts` (its existing
  owner) and `LogEntryHandle` in `scripting/api-wrapper/`.
- **Imports.** No `await import()` to dodge a cycle (guardrail 5). The facade registry must not create a cycle with
  `PageWrapper` — the plan shows where registration runs and why every facade is registered before the first lookup.
  Editor code stays dynamically imported where it is today (critical pattern 1); a registry that forces a static import
  of an editor module that is dynamic today is sent back.
- **God files only shrink** (guardrail 3): `operations.ts` (1,269) is split; `BrowserEditorFacade.ts` (835),
  `BoardEditorFacade.ts` (508), `window-screen.ts` (224), `PageWrapper.ts` (408), `McpInspectorFacade.ts` (467),
  `BoardInfoEditorFacade.ts` (350) must end smaller; the editor models that gain a method may grow by that method only.

## Linked Tasks

| Task | Title | Status |
|------|-------|--------|
| US-1916 | Split `automation/operations.ts` into owning modules (pure move) | Done |
| US-1917 | Shared page snippets, one mouse dispatch, narrow target interfaces | Done |
| US-1918 | One `AutomationSurface` for browser, board and `window.screen` | Done |
| US-1919 | `EditorFacadeBase`, editor facade registry, family editor ids | Done |
| US-1920 | Facades call model rules (MCP Inspector, Board Info, Video) | Done |
| US-1921 | One Log View entry normaliser and `LogEntryHandle` | Done |

### Task notes for the planners

- **All tasks.** Name the owner of every moved rule and the helper reused. List line counts before/after for the files
  named under "God files only shrink". For every exported symbol that moves, list its importers and update them (no
  re-export shims). Script-facing names and `.d.ts` files do not change.
- **US-1916.** Moves and import rewrites only, plus: delete `focusElementByClick` (alias) and any helper with no caller
  (prove with grep); move `boardDialogs`/`answerBoardDialog` to `editors/board/`. Verify by comparing moved bodies.
- **US-1917.** List every pasted copy of the visible predicate, the frame-offset loop and each selector-resolution
  variant with its strictness (strict/first-match, visible-only, `nth`, `text=`), and show the parameterised builder
  reproduces each exactly. List each operation's parameter type after the split and every `throw` removed from the
  app/board targets, with where that error now comes from (same message).
- **US-1918.** Table of every `BROWSER_AUTOMATION_MEMBERS` member × host (browser/board/app) today: readiness,
  passive-read exemption, activity lease, tip recording, `tabId` source, host-specific errors. Keep the passive-read
  exemptions and the `dialogs({ policy })` special case exactly. Show the assembled `$help` for each host before and
  after. Members a host does not support today keep failing with today's message.
- **US-1919.** List every facade, which base features it adopts, and any facade that cannot (and why). Show the
  registry's registration point and import graph. Show `editorRegistry.getById` family resolution and the three call
  sites deleted. `aiVision` element lists and help strings stay identical.
- **US-1920.** Each model addition, its view caller and facade caller; setters keep any side effect the direct state
  write had (or lacked). `properties` output must be key-for-key identical for a sample manifest (show the key list).
- **US-1921.** Map every `ui.show.*`/`ui.dialog.*` entry and `push` input through the normaliser (lenient vs strict);
  show that every input accepted today on each path is still accepted and produces the same entry. Public handle
  property names unchanged.

## Remainder

Nothing of roadmap item 6.2 remains as planned work. Deliberately not done, recorded for a later epic:

- **Query selector semantics** (BRW-8 step 2): query methods stay first-match; unifying them onto the strict resolver
  would change script and MCP results and needs a guide change.
- **Shared automation help text** (BRW-3 step 3): the hosts word the shared guidance differently, so one constant
  would change `$help`. Unifying the wording is a documentation decision, not a refactor.
- **Pre-existing defect found on the way:** browser pages restored at startup fail every automation call with
  "WebContents not found or destroyed" (see Notes). Not caused by this epic; needs its own investigation.

## Out of scope

- Changing query-method selector semantics (see decisions); deleting the synthetic input path.
- The AiVision folder layout (BRW-13), the `browser-editor.md` rewrite (BRW-14) beyond what `/document` updates.
- Log-entry type registry and `JsonlLogDocument` (EDT-*, roadmap 6.6); editor framework changes (6.4).
- Any change to `window.persephone`, MCP `call` behaviour, persisted page descriptors or the `data-name` contract.
- US-1873 (board docs) stays in Planned until the refactoring work is done.

## Notes

### 2026-11-13
- Epic created after EPIC-160. Current state re-checked against the code (see Overview).
- US-1916 live check found a **pre-existing** defect, reproduced on the EPIC-160 commit with this epic's changes
  reverted: after a cold restart, a *restored* browser page (one with two tabs) fails every automation call with
  "WebContents not found or destroyed" (main's page-events route finds no guest for the key); a freshly opened browser
  page works. Not caused by this epic and not fixed here; recorded for a follow-up.
- US-1917: the moved `resolveCandidatesSource` template is a `String.raw` literal; the implementation had written
  `/\\s+/` where the original had `/\s+/`, which in page code matches a literal backslash and broke `text=` whitespace
  normalisation. Fixed at review; `text="Learn   more"` matches again.
- The restored-page defect above is not limited to two-tab pages: any browser page restored at startup fails
  automation the same way; a page opened in the session works.
- US-1918: no help paragraph is byte-identical across the three hosts (each host words the shared guidance
  differently), so a shared `AUTOMATION_HELP` constant would have changed the `$help` agents read. Byte-identical
  `$help` won; the empty constant the implementation added was removed at review and help stays host-owned. Browser
  `dialogs({ policy })` turned out to be passive (no activity lease) in the old installer, and stays so.
- US-1919: `editorRegistry.getById` stays exact; a named `resolveDefinition(id)` resolves families and is used only by
  the three former special cases (making `getById` family-aware would have needed two new compensating special cases).
  The board-editor id rule moved to `src/shared/board/board-editor-id.ts` (guardrail 2); `src/main/capability-registry.ts`
  now uses it instead of a template literal. At review, the base's attachment fields became ES `#private` so script
  `Object.keys(page.editor)` stays `id,name,editor`, and the per-registration `as never` casts were replaced by a
  generic `registerEditorFacade<TEditor>` with one documented boundary cast.

### 2026-11-13 — implementation and close
- All six tasks implemented and staged in one unattended run; plans by Codex (Luna, the policy pick while the weekly
  window was tight), reviewed against the source and the roadmap guardrails; Codex Luna implemented. Typecheck, lint and
  build-prod passed after each task, and every task was checked live on a cold `npm start` through the MCP HTTP
  endpoint: browser `editor.*` navigate/snapshot/getText/exists/getAttribute/getHtml/evaluate/waitFor/hover/pressKey/
  keyDown/keyUp/dialogs (incl. policy)/consoleMessages/pageErrors/screenshot (strict and `nth`)/networkRequests/
  setViewport/clearViewport/waitForSelector, a CDP click with `waitForURL` armed and `back`, `text=` exact/substring/
  whitespace forms; `window.screen` snapshot and evaluate (and its incognito refusal); board snapshot/tabs/evaluate/
  dialogs; `$help` for the browser, board and `window.screen` hosts and for text, grid, markdown and Log View facades
  compared byte for byte with a pre-epic baseline (identical); `page.editor` on a text and a grid page (`addRows`);
  `ui.show.*` handle shapes and setters, a `ui.dialog.buttons` answered in the Log View, `pages.logView.push` accept and
  reject paths; MCP Inspector setters, URL credential rejection and the connected panel list (view and facade agree);
  Board Info `properties` key order; a board-family page rendering after the `resolveDefinition` change. Not exercised
  live: the Video facade (no fixture; diff checked), drag, `setInputFiles`, `fillForm`, file-chooser and OOPIF paths.
- **Sizes (wc -l), epic start → end.** `operations.ts` 1,269 → deleted (split into `locator` 209, `page-events` 102,
  `navigation` 72, `mouse` 189, `keyboard` 54, `forms` 240, `queries` 216, `page-state` 110, `synthetic` 213,
  `page-scripts` 52, `input-session` 13); `input.ts` 465 → 255; `BrowserEditorFacade.ts` 835 → 618;
  `BoardEditorFacade.ts` 508 → 382; `window-screen.ts` 224 → 66; `PageWrapper.ts` 408 → 310; `McpInspectorFacade.ts`
  467 → 429; `BoardInfoEditorFacade.ts` 350 → 301; `UiFacade.ts` 162 → 153; five handle classes (284) →
  `LogEntryHandle.ts` 271. New: `AutomationSurface.ts` 180, `EditorFacadeBase.ts` 87, `editor-facade-registry.ts` 61,
  `register-editor-facades.ts` 90, `board-editor-id.ts` 17.
- **Decision refinements (plan review).** US-1916: `ensureTargetReady` lives with the activity lease in
  `page-events.ts`. US-1917: the existing mode-parameterised resolver moved to `page-scripts.ts`; `setInputFiles` (CDP
  `DOM.querySelectorAll`) and the legacy synthetic focus/fill selection were left out of the shared resolver.
  US-1920: Board Info `properties` uses an extracted `projectBoardManifestFields` instead of a cast round trip through
  `projectBoardManifest`; key order unchanged. US-1921: one `normalizeUiPushEntry` with `source: "push" | "script"`
  (the script source skips unknown-type rejection, dialog field checks and passes native grid `data`); no second write
  path; handle accessors stay on prototypes.
- **Review.** `/review` removed three non-null assertions (`synthetic.ts`, `LogEntryHandle.ts`); `/document` updated
  `overview.md`, `folder-structure.md`, `browser-editor.md`, `scripting.md`, `editors.md` and `key-files.md`;
  `/userdoc` needed no changes. No English catalog messages changed; `npm run i18n:check` reports every pack complete.
- **Deliberate behaviour changes.** None intended. Script `Object.keys()` order of a Log View output handle's private
  slots changed (`_text,_title,entryId,vm` instead of `entryId,vm,_text,_title`); names and accessors are unchanged.
