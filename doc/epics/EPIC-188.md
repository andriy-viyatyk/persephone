# EPIC-188: UI test coverage, phase 5b — clipboard, MCP inspector, Folder View, agent tools, Git, Mneme

## Status

**Status:** Completed 2026-11-18
**Created:** 2026-11-18

## Overview

Second half of Phase 5 of the [UI test coverage roadmap](../reviews/ui-test-roadmap.md). EPIC-187 (5a) covered the
Grid editor, the Settings page, the Tools & Editors hub and the guides. This epic covers the rest of the phase:
clipboard history, the MCP Inspector, the category pages (Folder View, editor `category-view`), the toolset editor
with agent tools, and the two optional features, Git Tree (`requires: ["git"]`) and Mneme (`requires: ["mneme"]`).
It also fixes the runner leftover from EPIC-187: a stray "Unsaved Changes" dialog failed every later test in its
module.

The deliverable is the tests plus the bugs they find. New tests use the `app` object style
(`ctx.app.pages[id].editor.…`), with `ctx.call` only where the stand-in cannot express the call (call options such as
`{ dialog: true }`).

## Goals

- Each module below has tests for every behavior on its checklist that `call` can reach. Whatever `call` cannot reach
  is listed as uncovered, with the reason.
- Runner cleanup answers a leftover "Unsaved Changes" dialog, so one stray dialog cannot fail the rest of a module.
- Claude fixes each app bug the tests find and adds a `whats-new.md` line for it.
- Every difficulty Codex has working out how to drive the app is recorded in
  [ai-vision-feedback.md](../reviews/ai-vision-feedback.md).

## Non-goals

- The grid sort/filter row-insertion decision (EPIC-187 open item 1). It belongs to the user; its test stays failing.
- Anything that needs the internet, a git remote or a real OS clipboard read-back that `call` cannot reach.
- Folder View behavior already covered by `sidebar/explorer` (the plan lists what is already covered and skips it).

## Working model

Same as EPIC-187 (unattended overnight run):

- **Codex cannot run the suite at all** (the product test host is an Electron utility process its sandbox cannot
  start, even with `--attach`). Codex writes tests from the guides, `$help` text in the source, the API type files and
  the editor source, and checks syntax with `node --check`. **Claude runs the tests and triages** every failure: a test
  bug goes back to Codex or is a one-line fix; an app bug is Claude's.
- **Two Codex sessions per task, both Luna/high:** session A investigates and writes a short task document (deleted
  when the epic closes) listing each test with its exact call paths and the source line that proves the path exists;
  Claude reviews it; session B writes the tests (or the runner fix) from the corrected document.
- Codex never uses the persephone MCP tool or port 7865, never runs `npm start`, `build-prod` or Electron, and never
  commits or stages.
- Every Codex brief asks for an `AI-VISION FEEDBACK` section; Claude appends each case to
  [ai-vision-feedback.md](../reviews/ai-vision-feedback.md), plus every failure caused by a wrong guess about the API.
- Every test works only inside its own folder under `ctx.fixture(...)` and closes what it opens. The suite has no
  expected-failure marker, so a known app failure that cannot be fixed tonight stays failing and is listed under Open
  items.

## Area checklists

### US-2069: Runner cleanup answers a stray "Unsaved Changes" dialog — `src/test-host/`

- Per-test cleanup (`closePagesOpenedSince` in `src/test-host/browser-helpers.ts`) closes test-owned pages with
  `pages.closePage`. A modified page returns a pending "Unsaved Changes" dialog; the next test's first call then fails
  with "returned unexpected attention" (`src/test-host/client.ts`).
- Fix: cleanup closes test-owned pages with the dialog allowed and answers "Unsaved Changes" with **Don't Save**, and
  a dialog left open by the test body itself is answered (or dismissed) before the next test starts, so the next
  test starts clean. A dialog cleanup had to answer is logged; the test that left it is not silently passed if the
  dialog came from its own body (decision in the task document).
- Proof: a launched run of a module where one test deliberately leaves a modified page open shows the next test
  passing (verified by Claude ad hoc, not as a committed test that is meant to fail).

#### Results

- `closePagesOpenedSince` (`src/test-host/browser-helpers.ts`) closes owned pages with the dialog allowed and answers
  their "Unsaved Changes" with Don't Save; a sweep before the page snapshot and after the closes cancels any other
  renderer dialog and closes a stray popup menu. A dialog or menu the test left open fails that test (cleanup step
  `per-test cleanup`); the next test starts clean. Native OS dialogs stay out of scope.
- Found while running the new tests: cleanup's page list dropped editorless workspace pages, so they leaked. Fixed.
- Verified with a throwaway probe module (a modified page left open, a pending close dialog, then a clean test):
  pass, fail by policy, pass. The probe was not committed.

### US-2070: Clipboard history — `tests/tools/clipboard/`

- The sidebar Clipboard panel (`explorer-clipboard`) in its disabled state shows the notification and Open Settings.
- With `clipboard.enabled`, text written to the clipboard appears at the top of the history list; the `clipboard`
  call-tree node lists it; clear empties it.
- Opening or re-copying an entry, as far as `call` reaches it without reading the OS clipboard back.

#### Results

- 5 tests in `clipboard.test.mjs`: disabled panel and Open Settings, capture order in the panel and the `clipboard`
  node, Copy captures a new top entry, row open and `remove`, `clear` and the node hidden when disabled. Tests save
  and restore the OS clipboard text. All passed on the first run.

### US-2071: MCP Inspector — `tests/tools/mcp-inspector/`

- Opens as a page; disconnected state; connects to the test app's own MCP endpoint (loopback, no network).
- Server info and capabilities after connect; tools list, call a tool with arguments and read its result; resources
  list and read; prompts if the server offers any; request history; disconnect.
- Connection error state against a closed loopback port.

#### Results

- 3 tests in `mcp-inspector.test.mjs`: opens disconnected with a prefilled URL; connects to the test app's own MCP
  endpoint, calls `call` with a `path` argument, reads a guide resource, checks history, disconnects; a closed loopback
  port reports the error state. The app's server offers no prompts, so prompts are not applicable.

### US-2072: Folder View (category pages) — `tests/editors/folder/`

- Opening a fixture folder shows Folder View with its items; breadcrumb; list and tile modes; navigation into a
  subfolder, back and forward.
- File operations the guide lists for local folders, as far as `call` reaches them (create, rename, delete), and the
  read-only archive folder.

#### Results

- 4 tests in `folder-view.test.mjs`: listing, breadcrumb, Back and Forward; list/tile modes with per-folder memory and
  inheritance; create, rename, delete, copy and move through the row menus; a read-only archive category.
- Guide fix: `folder.md` now says a subfolder without its own layout uses its nearest parent's.

### US-2073: Agent tools and the toolset editor — `tests/tools/agent-tools/`

- A fixture toolset (manifest plus a small local tool script) registered through `tools.*` with the trust dialog
  answered; `tools.search` finds it; `tools.execute` runs it and returns its result contract.
- The per-toolset editor page: layout for a valid manifest, an invalid manifest, the execution log.
- Unregister removes it; the profile's registry is left as it was.

#### Results

- 3 tests in `agent-tools.test.mjs`: a fixture Node toolset registered through the consent dialog, found by
  `tools.search`, `tools.execute` success and failure contracts; the toolset editor's valid state and execution log;
  an invalid manifest's error state. All passed on the first run.

### US-2074: Git Tree — `tests/tools/git/` (`requires: ["git"]`)

- A fixture repository created by the test inside its own folder (no remote); opening its `.git` folder shows Git
  Tree with the commit history; selecting a commit shows its info and diff; working changes list; the editor switch
  to Folder View and back.
- Pull and Push need a remote and are uncovered.

#### Results

- 3 tests in `git-tree.test.mjs` (`requires: ["git"]`): history, commit info and diff; the unstaged change and File
  Diff; the Folder View switch and back. Uncovered: Pull and Push (need a remote), remembered layout (not exposed by
  the facade).

### US-2075: Mneme — `tests/tools/mneme/` (`requires: ["mneme"]`)

- Mneme Config page: stopped state, enabling the service on the profile's port 17700, running state, roots.
- Mneme Root page over a fixture `.mneme` folder: browse, search, open a document.
- What needs a downloaded embedding model is uncovered.

#### Results

- 2 tests in `mneme.test.mjs` (`requires: ["mneme"]`): Config stopped → running on port 17700 → stopped; a fixture
  root added through the Config page's MCP Inspector (`add_root`; the Add root button opens a native picker), text
  search, tree browse and document open, root removal. The dev checkout's `mneme/target/release/mneme.exe` must exist.
- App bug fixed: stopping Mneme while the Mneme page was loading its status showed "Mneme status failed: Connection
  closed"; the cut-off request is no longer reported (`MnemeConfigEditorModel.refreshStatus`).
- Uncovered: vector and hybrid search, model download (need the embedding model).

## Linked Tasks

| Task | Title | Status |
|------|-------|--------|
| US-2069 | Runner cleanup answers a stray "Unsaved Changes" dialog | Done |
| US-2070 | Tests: Clipboard history | Done |
| US-2071 | Tests: MCP Inspector | Done |
| US-2072 | Tests: Folder View | Done |
| US-2073 | Tests: Agent tools and toolset editor | Done |
| US-2074 | Tests: Git Tree | Done |
| US-2075 | Tests: Mneme | Done |

## Concerns

1. **Size.** Seven tasks is more than EPIC-187's four, but four of the surfaces are small and two are opt-in. If the
   night runs short, Git and Mneme move to a phase 5c and the roadmap records it.
2. **Mneme needs its service.** The test profile has `mneme.enabled: false` on port 17700. If the service cannot start
   in the test profile (binary missing in the dev checkout), the Mneme tests stay `requires: ["mneme"]` and are listed
   as not run.
3. **Clipboard.** Writing the clipboard from `ctx.script` (`navigator.clipboard.writeText`) worked in EPIC-187; the
   tests save and restore it so the user's clipboard is left as it was.
4. **MCP Inspector against the app itself.** Connecting the inspector to the test app's own MCP endpoint is a loopback
   self-call; if that deadlocks, the tests use a small fixture MCP server or list the gap.

## Open items

1. **Carried over from EPIC-187:** the grid row-insertion decision (`Ctrl+Insert adds an unsorted row and is blocked
   while sorted or filtered` stays failing until the user decides) and the EPIC-185 env-vars test (`Settings opens the
   Environment Variables editor…`), which still fails in launched runs.
2. **Uncovered:** Git Pull and Push (need a remote), Git Tree remembered layout (not exposed by the facade), Mneme vector
   and hybrid search and model download (need the embedding model), Mneme's Add root button (native folder picker).
3. **API gaps recorded for the ai-vision review** (see [ai-vision-feedback.md](../reviews/ai-vision-feedback.md)):
   the `app` stand-in still cannot pass call options (`{ dialog: true }`, `maxLength`); tree rows have no item-name
   accessible label; the MCP Inspector's argument fields and the Mneme Config page's Add root have no call path.

## Notes

### 2026-11-18
- Created from the roadmap's Phase 5, second half. All of 5b stays in this epic; the runner fix is the leftover from
  EPIC-187's open item 2.
- Each task: Codex Luna planned (session A), Claude reviewed and folded corrections into the implementation brief,
  Codex Luna wrote the tests (session B). Planning ran for all seven tasks in parallel. Clipboard and Agent Tools
  passed on their first run; the other modules needed test fixes, two rounds sent back to Codex (Git, Folder View) and
  the rest fixed by Claude while triaging. 24 ai-vision feedback entries.
- App bug fixed: the Mneme status toast on stop (whats-new line). Runner fixes: dialog and popup-menu cleanup, and
  editorless workspace pages now count as owned pages (whats-new line).
- Completion skills on Codex (Luna): review found nothing; document made no changes; userdoc reflowed the Folder View
  paragraph. `guides:check`, typecheck and lint pass. Task folders deleted at close.
- Full launched run (`--with git,mneme`): 241 tests, **238 passed, 2 failed (open item 1), 1 skipped** (Tor); 20 new
  tests. Same failures as EPIC-187's final run.
