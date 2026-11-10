# EPIC-141: Refactoring Phase 0 — quick wins and cleanup

## Status

**Status:** Completed 2026-11-10
**Created:** 2026-11-10
**Completed:** 2026-11-10

## Overview

This is the first epic of the [refactoring roadmap](../refactoring-roadmap.md) (Phase 0). The roadmap is the result
of a ten-area review of `src/` at `c798129d`. It found 137 findings and 21 bugs that came up in passing. This epic
does the cheap, independent work that every later phase benefits from:

- fix the 21 bugs ([roadmap §3](../refactoring-roadmap.md#3-bugs-found-in-passing));
- delete dead code, so later epics move and split less;
- give duplicated constants and small helpers a single source;
- bring the developer docs, guides and code comments back in line with the code.

Nothing here restructures a class or moves a module between layers. That starts with Phase 1.

## Goals

- All 21 roadmap §3 bugs fixed, each with the smallest change that fixes it at the source.
- The dead code in roadmap §0.2 removed, with no behaviour change.
- Each constant and helper in roadmap §0.3 defined once and imported everywhere else.
- `doc/architecture/*`, the agent guides, the board template and the code comments describe the code as it is.

## Decisions (roadmap §6, accepted by the user 2026-11-10)

The user accepted every recommendation in roadmap §6. The ones this epic acts on:

- **D1:** legacy grants are denied `computerAudio`. The renderer copy changes to main's rule (bug #1, US-1809).
- **D4:** delete `editors/board/board-api.d.ts` (US-1806). The prose guides are the board contract.
- **D5:** the board template's `CLAUDE.md` is generated from `assets/guides/agents/boards.md` instead of kept by
  hand (US-1814).
- **D6:** boards never nest. The code change (exact-root trust lookup) belongs to Phase 3.1 (MAIN-3). In this epic,
  US-1815 only corrects `overview.md`, which documents trust inheritance as a feature.

The ones later epics act on, recorded here so they are not re-asked:

- **D2:** retire the renderer's "legacy" capability bus path (Phase 3.4).
- **D3:** introduce `BoardGrant` **before** US-1609 (scheduled 2027-01-03). Phase 1.4 must land before that date, so
  US-1609 becomes one deletion.
- **D7:** the board domain lives in `api/boards/` plus `shared/board/`. No new top-level layer.
- **D8:** the voice capture-stack question waits for 6.3. The DSP classes move to `renderer/audio/dsp/` in Phase 2.
- **D9:** list navigation clamps everywhere, with an explicit `wrap` prop. Multi-selection menus follow the tree.
- **D10:** `strictNullChecks` per folder after Phase 2, starting with `shared/`, `core/` and `content/`.
- **D11:** delete `Tree`'s own lazy-load path (UIK-2 option A).
- **D12:** user-meaningful configuration goes in `appSettings.json`; geometry and MRU lists go in `uiPreferences`.

## Linked Tasks

Task documents are written per task when it is picked up. The finding IDs point at the area reports in
[`doc/reviews/refactoring-2026-11/`](../reviews/refactoring-2026-11/), which hold the evidence and target shape for
each item.

| Task | Title | Scope (roadmap) | Status |
|------|-------|-----------------|--------|
| US-1806 | [Dead-code sweep](../tasks/US-1806-dead-code-sweep/README.md) | §0.2, D4 | Done |
| US-1807 | [Single sources: protocol and board contracts](../tasks/US-1807-single-sources-contracts/README.md) | §0.3, part 1 | Done |
| US-1808 | [Single sources: renderer helpers](../tasks/US-1808-single-sources-renderer-helpers/README.md) | §0.3, part 2; bug #9 | Done |
| US-1809 | [Board platform bugs](../tasks/US-1809-board-platform-bugs/README.md) | bugs #1, #10, #11, #12, #19 | Done |
| US-1810 | [IPC typing holes](../tasks/US-1810-ipc-typing-holes/README.md) | bugs #13, #14 | Done |
| US-1811 | [Browser and automation bugs](../tasks/US-1811-browser-automation-bugs/README.md) | bugs #2, #3, #4, #5 | Done |
| US-1812 | [Core, shell and scripting bugs](../tasks/US-1812-core-shell-scripting-bugs/README.md) | bugs #6, #7, #8, #18 | Done |
| US-1813 | [Settings, tree and UI text bugs](../tasks/US-1813-settings-tree-ui-text-bugs/README.md) | bugs #15, #16, #17, #21 | Done |
| US-1814 | [Generate the board template `CLAUDE.md` from the guide](../tasks/US-1814-board-template-claude-md/README.md) | D5, bug #20 | Done |
| US-1815 | [Developer doc drift](../tasks/US-1815-developer-doc-drift/README.md) | §0.4 (docs), D6 (doc only) | Done |
| US-1816 | [Comment drift](../tasks/US-1816-comment-drift/README.md) | §0.4 (comments) | Done |

### Task scopes

**US-1806: Dead-code sweep.** Every item in roadmap §0.2 (MAIN-13, BND-8, BND-10, BRD-12, CORE-6, CORE-13, EDC-3,
EDC-5, EDC-16, EDT-13, UIK-10, SHL-13, BRW-7, BRW-8), plus `editors/board/board-api.d.ts` (D4) and its row in
`folder-structure.md`.
- Each deletion is re-verified first: no static importer, no `import()` string, no string-keyed lookup (the script
  API, the MCP `call` tree, the editor registry, `data-name` contracts).
- Anything reachable from the script API or `window.persephone` is **not** dead, even with no internal caller. List
  such items in the task document and leave them alone.

**US-1807: Single sources: protocol and board contracts.**
- `CAPABILITY_ERROR_CODES` and the platform capability ids, moved to one module in `shared/` (BND-10, MAIN-4,
  CORE-12). The second, 10-code set that reuses the same type name gets its own name.
- The audio-window channel names, moved to `ipc/audio-channels.ts` (BND-12).
- The host-service `boardId` prefixes, moved to `ipc/module-service-channels.ts` (BND-13, MAIN-12). The prefixes stay
  as they are; Phase 1.2 replaces them with a typed union.
- Page-state validation, site-extension id and host validation, the board network guard and the board host-text
  catalog (BRD-11, PLAT-8, BRW-11).

**US-1808: Single sources: renderer helpers.**
- The browser zoom bounds (BRW-11).
- `englishEntryCatalogs` and the i18n formatter (CORE-10).
- The text codec, shared by `api/fs.ts` and `content/encoding.ts` (CORE-12).
- `decodeFolderEditorLink` (EDC-13).
- The recording file-name pattern (EDT-10).
- Hand-written path normalizers replaced by `fpNormalizeForCompare`.
- Bug #9, moved here from US-1812: `languages.english()` uses the shared entry catalog, so the hand-kept 18-area
  list goes and the missing translator notes appear.

**US-1809: Board platform bugs.**
- #1: `boardTrust.allows` denies `computerAudio` for legacy grants (D1).
- #10: the MCP guide mounts ask the trust service instead of parsing `trustedBoards.json`, so a disabled bundled
  board no longer mounts its guides.
- #11: the shim's frame route passes capability error codes through, as the port route already does. This uses the
  single code list from US-1807. It changes what a board observes, so it needs a `BOARD_BRIDGE_VERSION` bump with a
  history note.
- #12: every gated board request that is refused gets a "not permitted" reply, not just four of them.
- #19: `board-dialog-service.ts` and `audio-service.ts` register through `ipc/main` with the sender guard, not with
  raw `ipcMain`.

**US-1810: IPC typing holes.**
- #13: the preload facade's channel union references the current event type, so it is no longer `any`.
- #14: the renderer `eBoardNotify` payload type gains `persistent`.

Fixing #13 will expose type errors that `any` has hidden. Fix those that are real mismatches. List the rest in the
task document; do not cast them away.

**US-1811: Browser and automation bugs.**
- #2: page summaries report the current browser URL after a link navigation.
- #3: a bookmarks file chosen on a Tor page is saved to the Tor profile.
- #4: when `showBrowserPage` refuses to open a page, the half-built editor is disposed.
- #5: the automation query methods resolve locators the same way the action methods do, so `text=` locators work as
  documented.

**US-1812: Core, shell and scripting bugs.**
- #6: a speech `describe` port is released by the router that does not claim it.
- #7: changing the Script Library folder transpiles `.js` files in the new folder without a restart.
- #8: `--profile` windows read their own data folder for theme, custom themes and UI language at first paint.
- #18: `options?.sourceLink` in `PagesLifecycleModel`.

**US-1813: Settings, tree and UI text bugs.**
- #15: the Settings field and the service use one microphone notch range.
- #16: the Theme section detects a missing theme editor without comparing two English strings.
- #17: tree repaint signatures include the name, and href comparisons use one case rule.
- #21: the mojibake in agent-facing text is fixed, and the listed UI strings go through `t()`. This adds catalog
  messages, so the epic close must translate them.

**US-1814: Generate the board template `CLAUDE.md` from the guide (D5).**
- The template copy is produced from `assets/guides/agents/boards.md` at build or scaffold time; the task document
  picks one and says why.
- The bridge version that the guide states comes from `BOARD_BRIDGE_VERSION`, or is checked against it, so bug #20
  cannot come back.
- Boards scaffolded before this change keep their `CLAUDE.md`. Nothing rewrites a user's board folder.

**US-1815: Developer doc drift.**
- `overview.md`:
  - the shim is no longer "small";
  - the bootstrap sequence;
  - "Dependency Rules" marked as the target rules until Phase 2 enforces them;
  - trust inheritance replaced by the exact-root rule (D6).
- `browser-editor.md` (React-era text), `pages-architecture.md`, `scripting.md`, `folder-structure.md`, `editors.md`
  and `model-view-pattern.md` (BND-11, BRW-14, CORE-16, EDC-16, SHL-13, UIK cross-area notes).
- Docs describe the code as it is after US-1806 to US-1814, so this task runs after them.

**US-1816: Comment drift.**
- About 100 planning-ID comments (`US-…`, `EPIC-…`, `C-…`) and "Walkthrough NN" tags. Each becomes a one-line
  *why*, or goes if it carries no reason.
- React-era comments that describe hooks, components or Emotion that no longer exist.
- Comments only. A comment that turns out to describe a real defect goes into the task document as a finding, and
  the code stays as it is.

### Order

1. **US-1806 first.** It removes files the other tasks would otherwise touch.
2. **US-1807 before US-1809.** Bug #11 uses the single capability error-code list.
3. US-1808 and US-1810 to US-1813 are independent of each other.
4. **US-1814, US-1815 and US-1816 last**, so the docs and comments describe the final code.

## Rules for every task in this epic

- **The roadmap guardrails apply** ([§7](../refactoring-roadmap.md#7-guardrails-against-the-drift-coming-back)).
  Every plan names the module that owns each rule it touches, and the existing helper it reuses.
- **Smallest fix at the source.** A bug fix that would need a class split or a layer move is recorded in the task
  document and left for the phase that owns it.
- **No behaviour change** outside the bug fixes. Deletions and single-source moves are behaviour-neutral.
- **Contracts that must not change** ([roadmap §8](../refactoring-roadmap.md#8-execution-notes)): persisted data
  formats and keys, `window.persephone.*`, the script API, AiVision paths and messages, the `data-name` contract,
  MCP `call` behaviour. The only planned exception is the observable error codes in US-1809 (#11), which gets a
  bridge version bump.
- **Verification:** `npm run typecheck`, `npm run lint`, `npm run build-prod` and `npm run i18n:check` after every
  task, plus a manual check of each fixed bug. No unit tests.
- **Completion:** the deferred review model. `/review`, `/document` and `/userdoc` run once at epic close.
  Translations are needed for the messages US-1813 adds.

## Notes

### 2026-11-10
- Created from the refactoring roadmap. The user accepted every §6 recommendation (D1 to D12).
- The roadmap suggests the next epic: Phase 1.1 to 1.4 together with 2.1 (the shared board core and the protocol
  primitives). D3 means Phase 1.4 has to land before US-1609 on 2027-01-03.
- Bug #9 moved from US-1812 to US-1808. The single `englishEntryCatalogs` source that US-1808 creates is the fix,
  so keeping the 18-area list alive until US-1812 would have meant code whose only job was to preserve the bug.
