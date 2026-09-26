# US-1527: Torrent board documentation

## Status

**Status:** Planned  
**Priority:** High  
**Epic:** [EPIC-114: The torrent board — a module contributes below the UI](../../epics/EPIC-114.md)  
**Scope:** Investigation and documentation plan only. No implementation, tests, harnesses, or commit.

## Goal

Correct the roadmap's §3.8 and Phase E descriptions against EPIC-114's corrected decisions and the
shipped source, then document the final board-provider and browser-download contracts. Update the
Persephone board guides and record the matching torrent-board guide work that belongs in
`C:/projects/persephone-boards`, without modifying that repository in this task.

## Background

### Documents and source inspected

- `doc/epics/EPIC-114.md`, including D1–D12 and all Notes entries. D8's measured metadata
  distribution is recorded, but acceptance item 8 (the D6 RSS measurement) remains outstanding.
- `doc/epics/EPIC-113.md`, including the Phase E decisions and acceptance results.
- `doc/tasks/US-1523-torrent-board-skeleton/README.md`,
  `doc/tasks/US-1524-torrent-content-provider/README.md`,
  `doc/tasks/US-1525-torrent-board-page/README.md`,
  `doc/tasks/US-1526-torrent-board-lifecycle/README.md`, and
  `doc/tasks/US-1478-browser-url-masks/README.md`.
- `doc/platform-roadmap.md`; this is the roadmap containing §3.8 and the Phase E section.
- There is no `doc/architecture/boards.md`. The current board-authoring documentation is
  `assets/guides/boards.md`; the agent-facing companion is `assets/guides/agents/boards.md`.
- The current implementation is in `src/shared/browser-url-masks.ts`,
  `src/renderer/editors/board/board-manifest.ts`,
  `src/renderer/editors/board/custom-editor-registry.ts`,
  `src/main/download-service.ts`, `src/main/browser-service.ts`,
  `src/ipc/api-param-types.ts`, `src/ipc/api-types.ts`,
  `src/ipc/renderer/api.ts`, `src/ipc/main/board-handlers.ts`, and
  `src/renderer/api/internal/RendererEventsService.ts`.

### Binding corrections

The documentation must use the following final contracts, not the original roadmap claims:

- D1/D4/D5/D9: the torrent board is a metadata-only viewer; Persephone owns the pipe; reads are
  bounded `readRange` pulls; and every new persisted link is self-contained:

  ```text
  torrent://<40-lowercase-hex-infohash>/<encodeURIComponent(normalized-file-path)>?magnet=<encodeURIComponent(magnet-uri)>
  ```

  The provider receives the complete href in `config.url`, not `{ infoHash, path }` fields.
- D8: metadata resolution keeps the board's 30-second deadline; provider `stat`, `readRange`, and
  `readBinary` are cancellation-released content operations with no platform deadline.
- D10/D11: the Browser's non-Chromium protocol handoff already exists, but a board claiming an
  opaque scheme needs the empty-effective-name routing fix and the non-materializing
  `persephone.getSourceUrl()` handoff. The torrent board may claim `magnet` only after those
  changes are present.
- D12: `browserUrlMasks` is a board manifest axis separate from `fileMasks`. It applies to matching
  Browser downloads only, cancels before the save dialog, and hands the source URL to `openRawLink`.
  It does not intercept ordinary navigation. Claims are limited to trusted and bundled boards;
  exact normalized collisions are first-registration-wins and are reported as registration issues.
- D2/D3/D7: the shipped board uses WebTorrent 3.0.21, a committed `lib/webtorrent.bundle.mjs`,
  `MemoryChunkStore`, and TCP-only optional-module behavior. `node_modules` is development-only.

The final epic record contains two explicit verification limits that must remain visible in the
documentation:

1. `browserUrlMasks` download interception has been source-inspected but not exercised end to end
   in the running app. Documentation may describe the contract as source-verified, not as a live
   acceptance result.
2. EPIC-114 acceptance item 8, the D6 peak RSS measurement while streaming at least 200 MB, has
   not been run. Do not state a measured memory result or claim the 512 MiB follow-up decision was
   settled.

### Roadmap claim inventory

There are **12 inventory rows** in the requested §3.8 and Phase E text. They are not all errors:
**nine are stale claims superseded by this epic's work, one is stale/incomplete because D12 added a
new entry path, one is a mechanism claim that never matched the shipped source, and R12 is a
conditional exit criterion that remains correct.** The corrections below preserve that distinction;
the roadmap should use historical “superseded by” wording for the first group and reserve “wrong”
for the source-mismatched mechanism.

| ID | Current roadmap claim (quoted) | What it must say instead |
|---|---|---|
| R1 | §3.8 step 1: “So step 1 is carried by the torrent board's own `registerScheme("magnet")` — it is not free, and nothing routes a magnet link today” | **Historically accurate when written; superseded by US-1525/D11 on 2026-09-26.** Preserve that it deliberately withheld `magnet` from US-1523. Then state that the Browser handoff was already present, while US-1525 added the board claim, opaque-link target fix, and source handoff that made the predicted work complete. |
| R2 | §3.8 step 2: “Layer 1: the torrent board's parser recognises `magnet:`; `.torrent` matches its `fileMasks`; the torrent board page opens” | **Stale/incomplete after US-1478/D12.** The local `.torrent` assertion remains true, but Browser attachment URLs use the separate `browserUrlMasks`/`will-download` path, while `magnet:` uses the registered scheme path. Document the three entry paths explicitly. |
| R3 | §3.8 step 4: `persephone.openRawLink("torrent://<infohash>/track.mp3")` | The board emits a self-contained, URL-encoded link with the canonical path and encoded magnet query. A bare infohash/path cannot restore a torrent because it carries no trackers or peers. |
| R4 | §3.8 step 5: “`{ provider: { type: "torrent", config: { infoHash, path } } }`” | The registered provider type is `torrent/viewer`, and the descriptor carries `config: { url: <full torrent href> }`. The provider parses the authority, encoded path, and embedded magnet from that href. |
| R5 | §3.8 step 7: “The protocol handler pulls each bounded range from the torrent service” | Persephone's board-pipe/module-service path requests bounded `readRange` operations from the board provider. Each reply is a `Uint8Array` of at most 1 MiB; the platform owns continuation and HTTP `Range` handling. The torrent board does not port av-player's HTTP protocol handler. |
| R6 | §3.8 step 9: “the torrent keeps downloading only if the torrent board says so” | Closing the content page cancels the active read and stops payload transfer. The service and torrent may remain resident for the board's explicit lifecycle policy, but metadata/listing residency is not continued downloading. |
| R7 | §3.8 restore: “The media-player page persists `{ provider: "torrent", … }`” and “if it was uninstalled, the page shows the *provider missing* placeholder” | Persist the `torrent/viewer` descriptor whose full URL contains the magnet, so the provider can start without a board page. Untrust, absent-folder, and catalog-uninstall behavior are distinct: board placeholders and empty-page behavior follow the existing lifecycle paths; a torrent content page gets a legible unavailable/recovery state when its provider is gone. |
| R8 | Phase E correction bullet: “Step 1 is already done and needs no work” | **Superseded by US-1525/D11 on 2026-09-26.** Keep the historical correction's accurate Browser finding, but say that the predicted board-target/source-handoff work was then completed; D12 separately added the Browser-download claim path. |
| R9 | Phase E setup: “with `webtorrent` vendored under its own `node_modules` for the service” | WebTorrent 3.0.21 and `memory-chunk-store` are bundled into the committed board-local `lib/webtorrent.bundle.mjs`; `node_modules` is build-time only and excluded from publishing. |
| R10 | Phase E step 1: “port of av-player's main-process code (`torrent-proxy.ts`, `streaming-server.ts`, about 500 lines)” | Port the client/metadata and provider-read substance only. Use the shipped WebTorrent 3.0.21 bundle and `MemoryChunkStore`; do not port av-player's streaming server or torrent HTTP protocol handler because Persephone's bounded provider contract owns that layer. |
| R11 | Phase E step 1: `type: "torrent", schemes: ["magnet", "torrent"]` and the bare `torrent://<infohash>/<path>` link | Use `type: "torrent/viewer"`, schemes `torrent` and `magnet`, `fileMasks: ["*.torrent"]`, and the independent browser URL masks where Browser downloads are intended. Links carry the encoded magnet query as shown in R3. |
| R12 | Phase E exit: “every row of the 3.8 table observed on a real magnet link, including the failure rows, with the `userData` watcher clean” | **Retain unchanged.** Its conditional exit criterion is correct. Separately record that D6 acceptance item 8 remains unverified and Browser URL-mask interception is source-verified only; neither may be presented as a live result. |

The already-correct Phase E text about dropping the audio-player board, making the torrent board a
viewer, and replacing “credit-based frames” with bounded pull should be retained, not rewritten as
new discoveries. The task must not reintroduce those superseded designs.

#### Roadmap wording categories

The implementation plan must apply the categories above consistently:

- **Superseded, historically valid:** R1, R3, R4, R6, R7, R8, R9, R10, and R11. These describe
  decisions or planned mechanisms that were valid at the time or were the then-current roadmap
  design, and were replaced by D3/D5/D10/D11 or US-1523–US-1526. Date the relevant correction and
  name the decision/task rather than calling the earlier analysis an error.
- **Superseded/incomplete:** R2. Its local-file half remains valid, but D12 added a distinct
  Browser-download entry path and the roadmap must describe it separately.
- **Wrong against shipped source:** R5. The final bounded pull is implemented through the board
  provider/module-service and Persephone's board-pipe continuation path; the torrent board did not
  port av-player's torrent HTTP protocol handler. This wording should be corrected directly rather
  than described as an historical design that shipped.
- **Retain unchanged:** R12. Its conditional exit criterion is correct because D6 acceptance item
  8 has not been measured. Record the unverified D6 and source-only Browser evidence separately;
  do not turn either into a claim that the epic failed or that the exit was already achieved.

## Implementation Plan

### 1. Correct `doc/platform-roadmap.md`

- Update the quoted §3.8 rows R1–R7 and the restore paragraph using the final wording above.
- Update the Phase E correction block and steps R8–R11. Keep the historical explanation, but make
  the current mechanism and verification status unambiguous; retain R12's exit criterion unchanged
  and add only the separate verification-status note.
- Replace the bare torrent examples with the exact self-contained href form. State that paths are
  normalized to `/` and encoded as one URL path value.
- Distinguish the three entry paths: local `.torrent` file association, registered `magnet` scheme,
  and Browser download interception through `browserUrlMasks`.
- Preserve the source-only qualification for Browser URL claims and the outstanding D6 RSS result.

Before → after for the most important link correction:

```markdown
<!-- Before: not restorable and not the shipped provider descriptor. -->
persephone.openRawLink("torrent://<infohash>/track.mp3")

<!-- After: the board creates this from the infohash, canonical file path, and magnet URI. -->
persephone.openRawLink(
  "torrent://<40-lowercase-infohash>/<encodeURIComponent(file-path)>?magnet=<encodeURIComponent(magnet-uri)>"
)
```

### 2. Extend the current board authoring guide (`assets/guides/boards.md`)

Add a dedicated `browserUrlMasks` subsection next to the manifest/file-mask and service-backed
provider sections. It must contain all of the following:

- `browserUrlMasks` is a declaration on `board-manifest.json`, independent of `fileMasks`.
  `fileMasks: ["*.torrent"]` associates a local file name; it does not opt a board into Browser
  download interception.
- Values are trimmed, lowercased, de-duplicated, and bounded by the shipped normalizer (64 masks,
  512 characters per mask). They are whole-URL globs, case-insensitive, and anchored at both ends.
- The worked declaration must include both forms:

  ```json
  {
    "fileMasks": ["*.torrent"],
    "browserUrlMasks": ["*://*/*.torrent", "*://*/*.torrent?*"]
  }
  ```

  Explain the anchoring trap explicitly: `*://*/*.torrent` matches
  `https://example.test/a.torrent` but misses `https://example.test/a.torrent?dl=1`; the query-form
  mask must be declared alongside it.
- The field matches Browser downloads only, before the save dialog. It never captures ordinary
  navigation because navigation is handled by the registered-scheme path, and broad navigation
  capture would let a board silently take over browsing. On a match, the source URL is sent to
  `openRawLink`, the download is cancelled, no save path/download entry is made, and the user is
  notified with the winning board name.
- Only trusted boards and enabled bundled boards contribute claims. Registration order is trusted
  roots followed by bundled boards; an exact normalized duplicate is refused and reported as a
  `browser-url-mask` registration issue. Distinct overlapping masks remain ordered and the first
  matching claim wins.
- Mark the runtime interception sentence **source-verified only** until the Browser download
  scenario has been exercised end to end. Do not write that the save dialog cancellation has been
  observed.

Also retain the current `readRange` contract, including the corrected statement that it is an
optional bounded byte-returning provider method, not a stream or the old unimplemented-seeking
placeholder. Add the torrent-specific self-contained-link example and state that WebTorrent piece
selection is the provider's responsibility.

Before → after for the manifest documentation:

```markdown
<!-- Before: file association is documented, but browser URL ownership is absent. -->
"fileMasks": ["*.torrent"]

<!-- After: the two claims are explicit and independent. -->
"fileMasks": ["*.torrent"],
"browserUrlMasks": ["*://*/*.torrent", "*://*/*.torrent?*"]
```

### 3. Keep agent-facing guide material consistent

Update these files with the same contract and terminology:

- `assets/guides/agents/boards.md`: manifest reference, provider/range section, trust/collision
  rules, source-only verification note, and the anchored two-mask example.
- `assets/guides/agents/board-review.md`: remove the stale review signal “Board-provider seeking is
  not available yet”; replace it with checks for `readRange`, bounded `Uint8Array` responses, and
  the separate `browserUrlMasks` claim. A reviewer must treat a broad URL mask as a download claim,
  not a navigation claim, and inspect the trusted board's service because trust grants code execution.

`assets/guides/editors/board.md` needs no change: it documents the generic Board editor shell and
does not make the stale provider or browser-claim assertions. `assets/guides/index.md` also needs no
change because the Boards guide path remains the same. Add a concise upcoming-release note to
`assets/guides/whats-new.md` for the shipped Torrent Viewer/provider and browser URL-mask contract;
that note must carry the same source-only caveat for the unexercised interception path.

### 4. Update developer architecture pointers

There is no `doc/architecture/boards.md` to edit. Update the existing indexes as follows:

- `doc/architecture/key-files.md`: add `src/shared/browser-url-masks.ts` as the shared anchored
  glob compiler/matcher; expand the `board-manifest.ts` and `custom-editor-registry.ts` rows to
  mention normalized browser-download claims; add the main `download-service.ts` ownership row and
  the renderer-to-main browser-URL snapshot channel (`src/ipc/api-param-types.ts`,
  `src/ipc/api-types.ts`, `src/ipc/renderer/api.ts`, `src/ipc/main/board-handlers.ts`). Mention that
  `src/main/browser-service.ts` supplies the registered Browser-webContents scope check.
- `doc/architecture/overview.md`: in the Board subsystem section, explain that
  `CustomEditorRegistry.refresh()` produces a generation-numbered accepted-claim snapshot, main
  consumes it synchronously in `download-service.ts` at `will-download`, and the renderer event
  sends the source URL to `openRawLink` with the winning board target. State that this is a
  download-only path and that ordinary scheme routing remains separate.

Before → after for the key-files index entry:

```markdown
<!-- Before: the shared URL-mask implementation is not indexed. -->

<!-- After: point authors to the single matcher used by both processes. -->
| Browser URL glob matcher | `/src/shared/browser-url-masks.ts` |
```

### 5. Record the external torrent-board guide handoff without editing it

`C:/projects/persephone-boards` is deliberately out of scope. The matching board-repository work
must update or add these named files in a later board-repository task:

- `C:/projects/persephone-boards/boards/torrent-viewer/board-manifest.json` — add
  `"guides": "guides"` so the board's documentation is mounted.
- `C:/projects/persephone-boards/boards/torrent-viewer/guides/index.md` — user guide for adding a
  magnet/local `.torrent`/claimed Browser download, metadata-only behavior, opening files, and the
  explicit Download-this-file action.
- `C:/projects/persephone-boards/boards/torrent-viewer/guides/editor.md` — the two-pane page,
  status states, file actions, self-contained links, and lifecycle behavior.
- `C:/projects/persephone-boards/boards/torrent-viewer/guides/agent.md` — service operations,
  `torrent/viewer`, D5 link parsing, provider ranges, trust/collision semantics, and the two
  verification caveats.
- `C:/projects/persephone-boards/boards/torrent-viewer/README.md`,
  `CLAUDE.md`, and `WHATS-NEW.md` — keep the board's developer/release notes aligned with the
  mounted guides, including the two browser URL masks and the source-only runtime qualification.

These files are named for the handoff only; this task must not change them.

## Concerns

- **Runtime evidence boundary:** `browserUrlMasks` is implemented in source, but no end-to-end
  Browser download interception has been run. The guide and roadmap must say source-verified only.
- **D6 evidence boundary:** the service RSS measurement for acceptance item 8 has not been run.
  The docs may explain the no-eviction `MemoryChunkStore` risk and the planned measurement, but may
  not report a result or imply that the 512 MiB threshold was evaluated.
- **Anchored glob example:** do not simplify the pair to one mask. The shipped matcher constructs a
  `^...$` expression, so the query-string form is required by the documented contract.
- **Trust is not a sandbox:** trust/bundled eligibility and collision ownership protect registry
  correctness and user disclosure; they are not a new permission gate for a trusted board.
- **Scope overlap:** the epic-close `/review`, `/document`, and `/userdoc` passes are separate. This
  task should cover roadmap corrections and the D12/D5 rationale that a broad completion pass would
  not infer reliably; it should not run those skills or broaden into implementation review.
- **Dirty worktree:** existing changes belong to the user. Only the new task document and the two
  task-link updates required by the task-document workflow should be touched here.

## Acceptance Criteria

- [ ] `doc/platform-roadmap.md` preserves R1/R8's historical accuracy while marking them
      superseded by US-1525/D11 on 2026-09-26; classifies the remaining rows as superseded,
      incomplete, source-wrong, or retained as specified above; and corrects the 11 rows that need
      wording changes without changing R12's conditional exit criterion.
- [ ] `assets/guides/boards.md` documents `browserUrlMasks` separately from `fileMasks`, download-
      only behavior, the reason navigation is not intercepted, trust/collision rules, anchored
      matching, and the paired `*.torrent`/`*.torrent?*` example.
- [ ] The same provider and browser-claim corrections are made in
      `assets/guides/agents/boards.md` and the stale seeking statement is corrected in
      `assets/guides/agents/board-review.md`.
- [ ] `assets/guides/whats-new.md` has a source-accurate feature note that labels Browser URL
      interception as unexercised; `assets/guides/editors/board.md` and
      `assets/guides/index.md` are left unchanged unless a concrete stale claim is found.
- [ ] `doc/architecture/key-files.md` points to `src/shared/browser-url-masks.ts` and the snapshot
      channel; `doc/architecture/overview.md` points to the snapshot/`will-download` ownership
      boundary. No nonexistent `doc/architecture/boards.md` is created.
- [ ] The task document names the external torrent-board guide files and explicitly records
      `C:/projects/persephone-boards` as out of scope; that repository is unchanged.
- [ ] No unit tests or test harnesses are added, no implementation is performed, and no commit is
      created by this task.

## Files needing NO changes

- `doc/architecture/boards.md` — does not exist; `assets/guides/boards.md` is the current board
  authoring guide.
- `assets/guides/editors/board.md` — generic Board editor layout/API description; no stale torrent
  or browser URL claim found.
- `assets/guides/index.md` — its Boards link remains valid.
- `src/shared/browser-url-masks.ts`, `src/renderer/editors/board/board-manifest.ts`,
  `src/renderer/editors/board/custom-editor-registry.ts`, `src/main/download-service.ts`,
  `src/main/browser-service.ts`, and the browser-mask IPC files — shipped implementation is the
  evidence for this documentation task, not an implementation target.
- `C:/projects/persephone-boards` in its entirety — explicitly out of scope here.
- Unit tests and test harnesses — prohibited by the task scope.

## Files Changed

| Repository | File | Planned change |
|---|---|---|
| `C:/projects/persephone` | `doc/platform-roadmap.md` | Correct the 12 stale §3.8/Phase E claims and preserve explicit source-only/unverified qualifications. |
| `C:/projects/persephone` | `assets/guides/boards.md` | Add the independent browser URL-mask contract, anchoring example, trust/collision rules, and D5/provider wording. |
| `C:/projects/persephone` | `assets/guides/agents/boards.md` | Mirror the manifest, provider, and browser-download authoring contract for agents. |
| `C:/projects/persephone` | `assets/guides/agents/board-review.md` | Replace the stale “seeking is not available” review check and add browser URL-claim review guidance. |
| `C:/projects/persephone` | `assets/guides/whats-new.md` | Add a current-release note for the shipped torrent/provider and browser-mask feature; retain verification caveats. |
| `C:/projects/persephone` | `doc/architecture/key-files.md` | Index the shared matcher, download owner, browser scope predicate, and browser-mask snapshot channel. |
| `C:/projects/persephone` | `doc/architecture/overview.md` | Add the Board subsystem pointer for renderer claim snapshots and main synchronous download matching. |
| `C:/projects/persephone` | `doc/active-work.md` | Link the existing EPIC-114 US-1527 row to this task document. |
| `C:/projects/persephone` | `doc/epics/EPIC-114.md` | Link the US-1527 row to this task document; no epic decision text is changed. |
| `C:/projects/persephone-boards` | `boards/torrent-viewer/board-manifest.json`, `guides/index.md`, `guides/editor.md`, `guides/agent.md`, `README.md`, `CLAUDE.md`, `WHATS-NEW.md` | **Out of scope / no changes in this task.** Named for the later board-repository guide handoff. |

## Related

- [EPIC-114](../../epics/EPIC-114.md)
- [EPIC-113](../../epics/EPIC-113.md)
- [US-1478: Browser URL masks](../US-1478-browser-url-masks/README.md)
- [US-1525: Torrent board page](../US-1525-torrent-board-page/README.md)
- [US-1526: Torrent board lifecycle](../US-1526-torrent-board-lifecycle/README.md)
