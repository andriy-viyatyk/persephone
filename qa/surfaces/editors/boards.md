# Surface QA: boards — the board page, Board Info, and the `boards` node

Manual scenarios for the board surfaces. Run through `call` only; do not add or run automated
tests or a test harness for these surfaces. Leave pinned tabs untouched and close only pages the
scenario created. Create test boards in a scratch folder, never inside the repo.

Landed by EPIC-088 (US-1325, US-1326, US-1327).

## Test B.1: Finding a board without knowing a path

**Preparation:** none. This is the scenario the surface exists for — an agent that has never seen
this machine.

**Start:** The runner's first operation is `call` with no `path`; the agent must use the returned overview before choosing a branch.

**Call:** Read `boards`, then `boards.list()`.

**Overview route:** `PASS | PARTIAL | FAIL` — `overview → <paths in call order>`; wrong paths: `none` or `<every incorrect path, in order>`.

**Verify:** The member list distinguishes the **local** inventory from the **remote** catalog
(`searchPublished`). `list()` returns one record per board root, each carrying `trusted`, and the
`root` value is exactly what `openBoard()` takes. A board with no manifest name simply has **no
`name` key** — not `null`, not `""`. `installed` is present only on catalog-installed boards.

This is the test that fails if enumeration regresses: before EPIC-088 every `boards` member took a
root path and nothing could produce one.

## Test B.2: `list()` is local, offline, and side-effect free

**Preparation:** note which boards are trusted before you start.

**Start:** The runner's first operation is `call` with no `path`; the agent must use the returned overview before choosing a branch.

**Call:** `boards.list()` several times.

**Overview route:** `PASS | PARTIAL | FAIL` — `overview → <paths in call order>`; wrong paths: `none` or `<every incorrect path, in order>`.

**Verify:** No board is created, trusted, opened or modified. Nothing appears in the tab strip. The
answer does not depend on network availability — update availability comes from the in-memory
catalog, and when that catalog has not loaded `updateAvailable` is **absent** (unknown) rather than
`false`. "There is no update" and "I cannot tell yet" must stay distinguishable.

## Test B.3: A board page reports its own trust state

**Preparation:** a trusted board open as a page.

**Start:** The runner's first operation is `call` with no `path`; the agent must use the returned overview before choosing a branch.

**Call:** Read `pages[id].editor` on the board page.

**Overview route:** `PASS | PARTIAL | FAIL` — `overview → <paths in call order>`; wrong paths: `none` or `<every incorrect path, in order>`.

**Verify:** `renderState` is `"trusted"`, and `boardRoot`, `boardName`, `frameReady` and `busy` are
present. `busy` is a real `false` on an idle board, not absent.

Then, on a board the user has **not** trusted: `renderState` is `"untrusted"`, `restricted()`
returns text, and `$help` names the Trust-this-Board dialog and the `dialogs[0]` path that answers
it. On a board whose folder is gone, `renderState` is `"not-found"` and it is **not** restricted —
an empty board is not private content.

## Test B.4: Reload, and the honest answer when a board cannot reload

**Preparation:** an open, trusted board page.

**Start:** The runner's first operation is `call` with no `path`; the agent must use the returned overview before choosing a branch.

**Call:** `pages[id].editor.reload()`.

**Overview route:** `PASS | PARTIAL | FAIL` — `overview → <paths in call order>`; wrong paths: `none` or `<every incorrect path, in order>`.

**Verify:** Returns `{ refreshed: true, pageId, frameReady: true, renderState: "trusted" }`, and it
waits for the frame — a snapshot taken straight afterwards sees the reloaded board, not the stale
one. This is the `board_refresh` replacement path.

Then call `reload()` on an **untrusted** board. It must return **immediately** — no five-second
pause — with `frameReady: false` and the `renderState` that explains why. A reload that blocks and
then claims an unqualified success is the failure this shape exists to prevent.

## Test B.5: Board elements, and the page that must be active

**Preparation:** a trusted board page that is **not** active.

**Start:** The runner's first operation is `call` with no `path`; the agent must use the returned overview before choosing a branch.

**Call:** Read `elements` on its editor, then activate the page and read them again.

**Overview route:** `PASS | PARTIAL | FAIL` — `overview → <paths in call order>`; wrong paths: `none` or `<every incorrect path, in order>`.

**Verify:** All three are declared either way, but `visible` is honest: everything reads `false`
while the page is inactive, and the two addressable toolbar controls read `true` once it is active.
`board-trust` stays `false` on a trusted board — it lives in the untrusted placeholder. Then
`highlight("board-toolbar-more")` rings exactly one control and reports `found: true`.

The toolbar's text slot is a non-interactive label and is empty unless the board fills it; switch boards from the **Boards** panel or the Explorer
**Boards** panel.

## Test B.6: Board Info shows only what the board's situation offers

**Preparation:** open Board Info for a locally trusted, non-catalog board (the board toolbar's
**… → Board properties** menu item).

**Start:** The runner's first operation is `call` with no `path`; the agent must use the returned overview before choosing a branch.

**Call:** Read `pages[id].editor` and its `elements`.

**Overview route:** `PASS | PARTIAL | FAIL` — `overview → <paths in call order>`; wrong paths: `none` or `<every incorrect path, in order>`.

**Verify:** `mode` is `"properties"`. Only `board-info-open` and `board-info-unregister` report
`visible: true`; every catalog install control (`download`, `register`, `cancel`, `retry`,
`delete`, `uninstall`, `version-install`) is declared and reports `visible: false`. Declaring a
control that *can* appear here and reporting it honestly invisible is the established pattern;
declaring one that could never appear is not.

## Test B.7: The trust boundary holds

**Start:** The runner's first operation is `call` with no `path`; the agent must use the returned overview before choosing a branch.

**Call:** Look for any member on `boards`, the board facade or the Board Info facade that grants
trust, and try `boards.registerBoard(root)` on an untrusted board.

**Overview route:** `PASS | PARTIAL | FAIL` — `overview → <paths in call order>`; wrong paths: `none` or `<every incorrect path, in order>`.

**Verify:** No member trusts a board directly. `registerBoard` raises the user's trust dialog and
the result carries `attention` naming it. The agent cannot answer it on the user's behalf, and
nothing in `$help` suggests it should.

## Test B.8: Shortcuts and board-mode windows

**Preparation:** one trusted board, one untrusted board with a valid manifest, and a writable
scratch folder. Do not use a repository folder for shortcut destinations.

**Start:** Read the `boards` descriptor and help, then check the `app.boards` script typings/docs.

**Call:** Exercise `boards.createShortcut(root)` once and cancel the Save dialog. Then create a
shortcut with `boards.createShortcut(root, { linkPath })`, where `linkPath` is an absolute `.lnk`
inside the scratch folder. Try relative, non-`.lnk`, and missing-parent destinations; try the
existing destination once without `overwrite` and once with `overwrite: true`. Call both new methods
with the untrusted board. Call `boards.openBoardWindow(root)` twice for the trusted board, and
`boards.openBoard(root)` once.

**Overview route:** `PASS | PARTIAL | FAIL` â€” `overview â†’ <paths in call order>`; wrong paths:
`none` or `<every incorrect path, in order>`.

**Verify:** Cancellation returns `null`. Explicit valid destination creates the shortcut without
showing a dialog and returns its resolved absolute path. Invalid destinations fail with actionable
errors; an existing shortcut is refused unless `overwrite: true`. The untrusted board is rejected
before either a Save dialog or window opens, with guidance to call `boards.registerBoard(root)`;
the caller receives the failure without a toast. Repeated `openBoardWindow()` calls focus one
board-mode window for that root. A missing manifest is rejected before a window opens. The existing
`boards.openBoard()` still opens a regular tab. Verify the UI Create shortcut action remains
available for an untrusted open board and preserves its normal trust-dialog launch flow.
