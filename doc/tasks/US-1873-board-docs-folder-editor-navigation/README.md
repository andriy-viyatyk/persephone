# US-1873: Board docs — re-verify, then fix folder-editor and in-page navigation gaps

## Status

**Status:** Planned
**Priority:** Medium
**Started:** —
**Completed:** —

## Goal

An agent building a board **without Persephone's source code** can find, through the MCP `call`
tool alone, how to (1) make a board the editor for a folder and (2) open a file in the board's own
hosting page. Each gap below is first **re-verified against the current code** — a large
refactoring (EPIC-176, EPIC-177) landed after the report — and then fixed in docs or code only if
it still reproduces.

## Background

The original report came from an agent building a calendar board that claims a folder and opens a
clicked item in place. It needed Persephone's source to finish. The report bundled several
different problems; one of them (the guide is too large to read) is now its own task, **US-2000**.

### Findings to re-verify (each one: reproduce → still true? → decide)

| # | Finding as reported | Where to check now |
|---|---|---|
| F1 | Folder claims are not in the agent guide: `folderEditorMasks` / `folderEditorPriority` / "Direct-folder boards" exist only in the user guide `assets/guides/boards.md` (Custom editors section). `guides.search("folderMasks")` and `helpSearch(...)` give no usable hit. | `assets/guides/agents/boards/` after US-2000 (was one 138 KB page, cut off before the manifest reference); `guides.search`; user guide Custom editors section |
| F2 | No documented way for a board to navigate **its own page** to a file. `persephone.openRawLink()` always opens a new tab; `persephone.source.navigate(href)` only accepts items of the initial source context (for a folder-editor board that is the clicked folder's **siblings**). The working route is `appScripting: true` + `persephone.call("page.id")` + `persephone.call("pages.navigatePageTo", { args: [id, file] })`. | `BoardEditorModel.navigateSource()`; bridge in `src/board-shim/`; `pages.navigatePageTo` in `src/renderer/api/pages/`; `BOARD_BRIDGE_VERSION` |
| F3 | Stale Explorer after a (re)trust of a folder board: the Explorer resolves each folder's `target` when it lists the directory, so after a manifest change plus a trust toggle an already-open Explorer keeps opening Folder View until the folder is listed again. No refresh control. | `FileTreeProvider` (target resolution), `custom-editor-registry.ts` (`resolveEditorIdForFolder`), the Explorer panel; trust change events in `boardRegistry` |
| F4 | `panels.explorer.openItem(item)` silently falls back to Folder View when the item has no `target` (an agent passing `{ href, isDirectory: true }` gets no hint why). | the `panels.explorer` ai-vision namespace (`src/renderer/scripting/ai-vision/namespaces/`) |

Do not trust the line numbers or code paths in the original report; the file layout moved in the
refactoring. Start each finding with a fresh search for the symbol.

### Existing patterns to follow

- A bridge change bumps `BOARD_BRIDGE_VERSION` and adds a history line (refactoring guardrail 6 in
  `doc/agents-common.md`; this has been missed in delegated plans before — check it explicitly).
- Board rules live in `src/shared/board/` and the board registries (guardrail 2); do not add a
  `kind === "legacy"` or manifest-reader branch elsewhere.
- Reuse existing extension points (open interceptors, switch strategies, traits) for the Explorer
  behaviour rather than a call-site special case (guardrail 4).

## Implementation plan

### Step 1 — re-verify (Claude, live)

- [ ] Using the running Persephone and a throw-away folder board (a manifest with
      `folderEditorMasks`), reproduce F1–F4 and record for each: still reproduces / fixed by the
      refactoring / different now. Keep the notes in this document's *Findings* section below.
- [ ] Decide per finding the smallest fix: docs only, a small API addition, or no action. Update
      this plan with the exact files before implementing. Wait for user review if any code change is
      proposed beyond docs.

### Step 2 — docs (the guide split is done)

- [ ] `assets/guides/agents/boards/folder-editor.md` (the placeholder created by US-2000) with:
      `folderEditorMasks` (suffix glob semantics such as `*/my-folder`), `folderEditorPriority`
      (Folder View is `0`, git/mneme folders `20`), `persephone.getFolderPath()`, the Explorer icon
      and editor-switch behaviour, and that a manifest change needs a trust toggle **and** a fresh
      Explorer listing (unless F3 is fixed in code).
- [ ] A recipe "open a file in this board's own page" in the same page or `bridge.md`: the
      `appScripting` + `pages.navigatePageTo` route, with the permission it needs; or the new bridge
      option if Step 1 chooses one (for example `openRawLink(href, { inPlace: true })`, or allowing
      `source.navigate` for files under `folderPath`) with its docs and a `BOARD_BRIDGE_VERSION` bump.
- [ ] The hub's "Read next" table and the page `summary` mention "folder", "claim a folder",
      "navigate own page" so `guides.search` finds them. Verify with
      `guides.search("folderEditorMasks")`, `guides.search("claim folder")`,
      `guides.search("navigate page")`.
- [ ] Link the agent page to the user page `boards/custom-editors.md` (US-2000 phase 2) and keep
      the two consistent.

### Step 3 — optional code fixes (only for findings still reproducing)

- [ ] F3: re-resolve folder targets when board trust or a board manifest changes (or an Explorer
      refresh action). Owner: the code that resolves `target` today; name it in this plan first.
- [ ] F4: make `openItem` resolve `target` itself when it is missing, or return a clear
      error/hint.

## Findings (filled in during Step 1)

*(empty — to be recorded)*

## Concerns / Open questions

- Step 1 may show a finding no longer applies; then its acceptance item below is closed as
  "verified, no change".
- If F2 needs a bridge API, it is a board-facing change: version bump, `board-shim` typings
  guide prose (boards are agent-authored — prose guides, not IntelliSense typings), and the manifest
  permission story must be stated in the new docs.
- Depends on the doc layout from US-2000; do not write into the old single-file
  `agents/boards.md`.

## Acceptance criteria

- [ ] Each of F1–F4 has a recorded outcome (fixed in docs, fixed in code, or verified no-op).
- [ ] The agent boards guide has a findable folder-editor page covering the items in Step 2.
- [ ] A documented recipe or API for opening a file in the board's own page.
- [ ] `guides.search` finds the folder-claim docs for `folder`, `folderEditorMasks`, `claim folder`,
      `navigate page`.
- [ ] Any bridge change bumps `BOARD_BRIDGE_VERSION` with a history line.
- [ ] `npm run guides:check` passes; no regressions.

## Files Changed (expected)

| File | Change |
|---|---|
| `assets/guides/agents/boards/folder-editor.md`, hub, `bridge.md` | content |
| `assets/guides/boards/custom-editors.md` | cross-link only if needed |
| Explorer / `FileTreeProvider` / `panels.explorer` namespace | only if F3/F4 reproduce |
| `src/board-shim/*`, `BoardEditorModel`, `BOARD_BRIDGE_VERSION` | only if an in-place open option is added |

No changes needed: `src/shared/guides/*` and the ai-vision package (US-2000 covers structure).
