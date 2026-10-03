# US-1601: Migrate the user's registered custom boards to declared permissions

**Epic:** [EPIC-119](../../epics/EPIC-119.md)

## Goal

Give every custom board the user has registered an object-form `permissions` block and a
`minBridgeVersion`. Each set is the smallest one the board's code needs. Once this is done, none
of the boards the user runs stays unrestricted, and none shows the US-1608 deprecation warning.

## Background

- A manifest without an object-form `permissions` block is "legacy": everything is allowed except
  `service` (see US-1593). US-1608 warns on every open, and US-1609 removes the fallback on
  2027-01-03.
- The permission model and the review checklist are in `assets/guides/agents/boards.md` and
  `assets/guides/agents/board-review.md`.
- Re-trust: when an already-trusted board's manifest changes from legacy to object form,
  Persephone shows the change dialog once on the next open or reload (US-1598). This is expected.
  The user accepts it after checking the list.

## Scope (registered boards on 2026-10-03, from `app.boards.list()`)

**Migrated, one Codex run per board, with the board folder as its working root (`-C`):**

| Board | Folder | Under git |
|---|---|---|
| Color Palette | `C:\data\js-notepad-notes\temp\format-test\color-palette-board` | no (backed up) |
| AVGridBoard | `C:\projects\av-grid\test-boards\AVGridBoard` | yes |
| AVGrid — customization | `C:\projects\av-grid\test-boards\CustomizationBoard` | yes |
| GridCompareBoard | `C:\projects\av-grid\test-boards\GridCompareBoard` | ignored (backed up) |
| RenderGridTest | `C:\projects\av-grid\test-boards\RenderGridTest` | yes |
| Azure Tasks, Dev Dashboard, Events, Genesys Tasks, Grid Benchmark, Local Env, Postgres Viewer, Scripts, Tasks | `C:\projects\EverGreen\.persephone\boards\<name>` | no (backed up) |
| Content Open Test, Range Provider Test | `C:\projects\persephone-boards\_test\…` | yes |
| Demo, Persephone | `C:\projects\persephone\.persephone\boards\<name>` | ignored (backed up) |
| AiVision Probe, Dashboard Mask Test | `C:\projects\test-boards\<name>` | no (backed up) |

Backups of every folder not tracked by git are in
`C:\Users\AndriiViatyk\persephone-board-backups\2026-10-03\`.

**Excluded:**
- **Installed catalog boards** (`%APPDATA%\persephone\data\boards\*`). These are updated from the
  catalog after US-1600 is published.
- **`persephone-boards\boards\aivision-explorer`**: the catalog's development copy, migrated by
  US-1600.
- **`C:\Temp\persephone-surface-qa\drawio-viewer`**: a QA copy of a catalog board, not trusted.
- **PermTest**: the EPIC-119 test board, already in object form.
- **Throwaway scratchpad boards from other sessions** (`avgrid-example-check`, `US1534Demo`): left
  for the user to unregister.

## Procedure

1. Back up every folder that is not tracked by git (done).
2. For each board, run Codex with `-C <board folder>` and `-s workspace-write`, so a run can only
   write inside the board it migrates. The run:
   - reads the permission model in the Persephone agent guides;
   - finds every bridge call the board's own code makes;
   - writes the minimal object-form `permissions` block (all 11 flags explicit) and
     `minBridgeVersion` (at least `"1.30.0"`);
   - changes nothing else;
   - reports the calls it found, the flags it set, and anything unclear. An unclear need is
     reported, not guessed.
3. Review each report and the manifest diff against the board's calls. Fix anything over- or
   under-granted.
4. The user re-trusts each board once, through the change dialog, on its next open.

## Results

All 20 runs completed on 2026-10-03, and every manifest uses `minBridgeVersion: "1.30.0"`. I
checked the diffs: only `board-manifest.json` changed in each folder. `app.boards.list()` no longer
reports a deprecation note for any of them.

| Board | Enabled permissions | Notes |
|---|---|---|
| Color Palette | `fileSystem: "board"` | Writes only to the path the user picks in its save dialog. |
| AVGridBoard, GridCompareBoard, RenderGridTest, Grid Benchmark, AiVision Probe | none | No gated calls. `persephone.notify` is an in-app toast and needs no flag. |
| AVGrid — customization | `clipboardRead` | The grid's paste reads the system clipboard. |
| Azure Tasks, Events, Genesys Tasks, Tasks, Persephone | `execute` | Their Node scripts read and write outside the board and reach the network through `execute`, which the bridge flags do not restrict. |
| Dev Dashboard | `execute`, `fileSystem: "full"` | `readFile` on dashboard items in neighbouring folders. Codex also set `notifications`, which I removed because `notify` is an in-app toast. |
| Local Env, Postgres Viewer, Scripts | `execute`, `fileSystem: "board"` | Codex set `network` (`full`, `full`, `internet`). I removed it: the network traffic comes from scripts run through `execute`, and the page code makes no `persephone.fetch` or remote-content calls. |
| Demo | `execute`, `fileSystem: "board"`, `appScripting` | Uses `P.call("page.*")` and file dialogs. |
| Content Open Test | `service`, `fileSystem: "board"` | Opening another board's registered scheme requires `service` (`BoardEditorModel.ts:717`). |
| Range Provider Test | `service`, `fileSystem: "full"` | Its service reads any absolute path passed in a `file=` URL parameter. This is test-fixture behaviour. |
| Dashboard Mask Test | `fileSystem: "full"` | Reads its document with `readFile(getFilePath())`, which may be outside the board folder. |

**For the user:** each board shows the permission-change dialog once on its next open. Boards
using `execute` still have full OS access through the scripts they run, and the dialog marks them
**Full access**.

## Acceptance criteria

- Every in-scope board has an object-form `permissions` block and a `minBridgeVersion`.
- No board is granted a flag its code does not use. Flags needed only in unclear cases are listed
  for the user.
- No board files other than `board-manifest.json` are changed.
