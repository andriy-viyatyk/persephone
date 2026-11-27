# US-2256: Test board and UI tests

## Goal

Add a focused UI integration suite for the EPIC-218 transfer exit criteria, using the tree-provider fixture and isolated temporary local folders. The suite exercises transfer behavior through Explorer context menus, conflicts and progress UI rather than calling `TreeTransfer` directly.

## Test list

`integration-test/tests/boards/trees/transfer.test.mjs` contains 15 tests:

1. Local file → writable board copy; asserts the target listing and unchanged local source.
2. Board file → local copy; asserts exact destination text and retained board source.
3. Board connection `a` → `b` copy; asserts the new target item and retained source.
4. Same-board copy from root into `/data`.
5. Board cut → local paste; asserts the target bytes and source removal after transfer.
6. Failed board cut → local paste; asserts the read-failing source remains and no target file appears.
7. Empty and 5 MiB+37-byte file copies; verifies empty length and SHA-256 equality for the large file.
8–10. Conflict overwrite, skip, and keep-both (`Readme (1).md`) choices with destination-byte assertions.
11. Apply-to-all overwrite on a folder conflict; asserts both nested existing files were replaced.
12. Cancel during a slow multi-chunk write; asserts the target file is absent and source remains.
13. Read-only connection `ro` offers Copy and Download to… and no Cut, Paste, Rename, Delete, New File or New Folder (US-2258).
14. Board item menu exposes Download to….

Nested board contents are checked with Explorer pages rooted at the target folder because `explorer.listItems()` lists only that page's root. Context-menu row snapshots are scoped to the owning `[data-name="page-slot"][data-page-id="…"]`, so retained inactive tree pages cannot make row references ambiguous. Test-created local folders live under the isolated `ctx.fixture()` work profile and are removed in `finally`.

## Fixture changes

`integration-test/fixtures/boards/trees/tree-board/scripts/service.mjs` adds deterministic `/_test/large.bin` bytes, `/_test/empty.bin`, a read-failing file, a nested two-file conflict folder, and drag source/target folders kept for manual checks. Chunk writes targeting `/_test/slow/` pause per chunk and honor abort so the UI can cancel a real in-flight transactional write. The independent `a`, `b`, and `ro` connection boundaries remain intact.

`src/renderer/scripting/ai-vision/dialogs/tree-transfer-conflict.ts` adapts the US-2253 conflict dialog so tests and agents can inspect its choices, set Apply to all, and answer it through `dialogs[0]`. The transfer result summary uses the existing `TextDialogAdapter`; no additional US-2253–US-2255 dialog adapter was needed.

## Not covered

- Download to… is checked only for menu presence. Its native folder picker cannot be answered by the current UI test API; the test standards describe renderer dialog handling but provide no native folder-dialog control.
- Drag-and-drop between trees (US-2253) is not UI-tested: `window.screen.dragTo` refuses HTML5 drag-and-drop in the app window by design ("use the panel's own commands"). Drops share `TreeTransfer`, the conflict dialog, progress and results with paste, which the suite covers; the drop routing itself still needs a manual check.
- The broader task wishlists (provider lease recovery, oversized fallback, unusual links/names, delete failures, source-page closure, clipboard races and other edge cases) remain outside this focused exit-criteria suite.
