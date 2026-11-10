# EPIC-144: Refactoring Phase 3.2, 3.3 and 3.5 — the renderer board registry, board lifecycle and the board editor factory

## Status

**Status:** Completed 2026-11-11
**Created:** 2026-11-10
**Completed:** 2026-11-11

## Overview

The fourth epic of the [refactoring roadmap](../refactoring-roadmap.md). EPIC-143 made main the single owner of board
identity, trust and file access, and gave the trust snapshot subscribers. This epic gives the renderer one board
owner to match:

- **3.2:** one `MainSnapshotMirror` base class for main-owned state in the renderer, and a renderer `BoardRegistry`
  on it, fed by one full snapshot that main broadcasts. The five parallel maps in `BoardTrust`, its N+1 pulls,
  `board-access.ts` and the renderer bundled-board registry fold into it (PLAT-1, PLAT-7, PLAT-10).
- **3.3:** one `BoardLifecycle` for the seven "stop using a board" entry points, and an `EditorCategoriesModel` in
  `api/` that prunes board pins when trust goes, so no caller unpins by hand (PLAT-2, BRD-10 flows, SHL-5).
- **3.5:** `customEditorRegistry.findByRoot`, one board-editor factory for the five construction sites, the editor
  kind decided once, and a stream-host subclass (BRD-3).

Phase 3.4 (one capability pipeline, L) is the next epic. It also takes the RPC cancellation and capability open that
US-1827 deferred.

## Goals

- The renderer has one answer to "which boards exist, where from, with what identity and grant": `BoardRegistry`.
  No consumer merges trust paths, bundled boards and install entries itself, and no `isBoardPermitted` copy remains
  outside it.
- Main pushes one full board snapshot (entries with origin, grant, manifest grant, uses and file-access grants). The
  renderer makes no per-board pull after a trust change, and nothing diffs grants with `JSON.stringify`.
- `BoardTrust`, `SiteExtensionTrust`, `PublishedBoards`, `ModuleServiceStatus` and the capability index share one
  mirror base with one stale-snapshot guard. Both `-sync.ts` modules are gone. `BoardInfoEditorModel` and the toolbar
  contributions subscribe through the mirrors, not to raw IPC events.
- Every way to stop using a board goes through `BoardLifecycle` and gets the same steps in the same order. `api/` has
  no import of `ui/sidebar/` or `ui/dialogs/`, static or dynamic.
- Removing trust drops a board's category membership in one place. The six manual `removePin` calls are gone.
- `customEditorRegistry` has no linear scan by root outside itself. Board editors are built by one factory, and a live
  model's editor kind never changes after construction.

## Decisions this epic acts on (roadmap §6, accepted 2026-11-10)

- **D6:** boards never nest, so the registry keys every entry by exact `BoardRoot.key`.
- **D7:** the board domain lives in `api/boards/` plus `shared/board/`. `BoardRegistry` stays off `app` (the
  "not exposed on `app`" invariant).
- **D2 (partly):** the capability index moves onto the mirror base here; routing every invoke through main is 3.4.

## Linked Tasks

Task documents are written per task when it is picked up. The finding IDs point at the area reports in
[`doc/reviews/refactoring-2026-11/`](../reviews/refactoring-2026-11/).

| Task | Title | Scope (roadmap) | Status |
|------|-------|-----------------|--------|
| US-1832 | [`MainSnapshotMirror` and four mirrors on it](../tasks/US-1832-main-snapshot-mirror/README.md) | 3.2, part 1: PLAT-7 steps 1–3 | Done |
| US-1833 | [Main's full board snapshot broadcast](../tasks/US-1833-board-snapshot-broadcast/README.md) | 3.2, part 2: PLAT-1 step 2 (main half) | Done |
| US-1834 | [The renderer `BoardRegistry`](../tasks/US-1834-board-registry/README.md) | 3.2, part 3: PLAT-1 steps 2–3 | Done |
| US-1835 | [Board consumers read the registry; `app.boards` cleanup](../tasks/US-1835-board-consumers/README.md) | 3.2, part 4: PLAT-1 step 4, PLAT-10 | Done |
| US-1836 | [`EditorCategoriesModel` in `api/`](../tasks/US-1836-editor-categories/README.md) | 3.3, part 1: SHL-5 | Done |
| US-1837 | [`BoardLifecycle`](../tasks/US-1837-board-lifecycle/README.md) | 3.3, part 2: PLAT-2, BRD-10 (the remove and install-version flows) | Done |
| US-1838 | [`findByRoot`, the board editor factory and the stream-host subclass](../tasks/US-1838-board-editor-factory/README.md) | 3.5: BRD-3 | Done |

### Task scopes

**US-1832: `MainSnapshotMirror` and four mirrors on it (3.2, part 1).**
- An abstract `MainSnapshotMirror<T>` (the plan picks `core/state/` or `api/`, by what it imports): `fetch()`, the
  broadcast it owns, `load()`, `get()`, `subscribe()`, and one revision-guarded `apply(snapshot)` so a slow pull never
  overwrites a newer broadcast.
- Port `SiteExtensionTrust` (delete `site-extension-trust-sync.ts`), `PublishedBoards` (no subscribing inside
  `load()`), `ModuleServiceStatus` (gains `subscribe(root, listener)`; `module-service.ts` stops subscribing to the
  raw status event) and the capability index in `capabilities.ts` (its `latestRevision` loop).
- `BoardInfoEditorModel` stops subscribing to raw `eModuleServiceStatusChanged`. Its `eBoardTrustChanged`
  subscription moves in US-1835, with the other board consumers.
- `BoardTrust` moves to the base in US-1834, not here.
- Out of scope: moving tools trust to main (PLAT-7 step 4). The plan only fixes the stale header in `tools-trust.ts`.

**US-1833: Main's full board snapshot broadcast (3.2, part 2).**
- Main sends the full snapshot that `BoardTrustService` builds, as one entry per board: the root and key, the origin
  (`trusted`/`bundled`), `bundledId`, the grant and the manifest grant, uses and manifest uses, `manifestChanged`, the
  file-access grants and compatibility. It goes out on one event and through one pull method. Both are typed in
  `src/ipc/`.
- Main publishes it through an `onSnapshot` subscriber in `board-trust-subscribers.ts`, not from inside the trust
  service. The file-access grants come from `BoardFileAccessService`, and a grant change also publishes.
- `eBoardTrustChanged` with a bare `string[]` goes, or stays only until US-1834 lands; the plan says which. The
  per-board `getBoardFileAccessGrants` pull loop is not called after this epic.
- The entry carries what the renderer needs, not main internals. The plan lists every field and the renderer reader
  that needs it.

**US-1834: The renderer `BoardRegistry` (3.2, part 3).**
- `api/boards/board-registry.ts` on `MainSnapshotMirror`, with entries keyed by `BoardRoot.key`: `get(root)`,
  `list()`, `isPermitted(root)`, `permissionOrigin(root)`, `grant(root)`, `permissionSnapshot(root)`,
  `fileAccess(root)` and `subscribe()`. `trust()`, `untrust()` and `revokeFileAccessGrant()` stay thin requests to main.
- Fold in `BoardTrust`'s five maps, `board-access.ts` and the renderer side of `bundled-board-registry.ts`. Main's
  snapshot already filters disabled bundled boards, so the renderer does not filter them again. Pushing the
  `disabled-bundled-boards` setting to main stays, owned by the registry or by a settings effect that the plan names.
- Delete `board-trust-sync.ts`. Delete `boardTrust` or keep it as a thin alias; if it stays, the plan says why. The
  sync `isBoardPermitted` callers (board editor, webview, secondary view, capability bus, host RPC) keep sync reads.
- Installed-but-untrusted boards come from `board-install-registry.ts`. The registry may join them as an `installed`
  origin, or `boards.ts` may join them; the plan decides once and says why.

**US-1835: Board consumers read the registry; `app.boards` cleanup (3.2, part 4).**
- Port the merges to the registry: the `boards.ts` listing, `custom-editor-registry.refresh` (no re-merge of
  trusted, bundled and installed roots), the renderer guide mounts, `board-service-settings`, `board-namespace`,
  `BoardInfoEditorModel`, and the transcript and translate toolbar contributions (their raw `eBoardTrustChanged`
  subscriptions).
- PLAT-1's identity note: the board namespace and main's `callerId` become one function with an explicit origin, in
  `shared/board/`. Local boards keep their current namespace, because changing it would migrate stored settings. The
  plan shows that every key is byte-identical.
- PLAT-10:
  - make the imports static except the genuinely heavy editor ones, and delete `cachedTrustPaths`,
    `cachedInstalledEntries`, `readPaths` and `readInstalled`;
  - add one local `assertBoardFolder(root)`;
  - move the call-timeout knob to `api/ai-vision-call-timeout.ts`. `boards.callTimeoutMs` stays as a public alias.

**US-1836: `EditorCategoriesModel` in `api/` (3.3, part 1).**
- `api/editor-categories.ts`: an `EditorCategoriesModel` class, singleton `editorCategories`, owning the
  `editor-categories` setting (`create`, `rename`, `remove`, `move`, `assign`, `unassign`, `categoryOf`,
  `encodeRef`/`decodeRef`). `ui/sidebar/pinned-items.ts` goes. The views call the model.
- The model subscribes to `BoardRegistry` and drops the membership of a board that is no longer permitted, so
  bundled boards keep their pins. Delete the six manual `removePin` calls.
- Rename carries membership over through a hook that US-1837's `BoardLifecycle.rename` calls. In this task, the plan
  puts it where the rename body lives today.
- Move `tools-editors-registry.ts` to `api/creatable-items.ts`, with the icon as a factory instead of a shared node.
  Delete the dead pin API (`addPin`, `insertPin`, `movePin`, `isPinned`, `PinnedDragData`) if it still exists.
- The setting key and format do not change.

**US-1837: `BoardLifecycle` (3.3, part 2).**
- `api/boards/board-lifecycle.ts` owns `unregister(root)`, `delete(root)`, `uninstall(catalogId)`,
  `rename(root, newName)`, `installVersion(...)` and `ensureIdle(root, action)`. Each runs these steps in one fixed
  order: stop the service, release the pages, change the disk, update trust and the install registry, invalidate the
  display text.
- `uninstallCatalogBoard`, `ensureBoardIdle`, `runBoardVersionInstall` and the `renameBoard` body move in. Board
  Info's `uninstall`/`unregister`/`installBoardVersion`, `request-board-trust.removeBoard`, `BoardsSecondaryView`'s
  delete, `EditorsTreeView`'s remove and `app.boards` call it.
- `api.boards.installPublished` opens Board Info through `openBoardInfoPage` and no longer constructs the model.
- One board-page query: keep `pagesModel.query.findPagesByBoardRoot` or `board-idle.ts`'s `boardPagesForRoot`, not
  both. `api/` does not import `BoardEditorModel` for it.
- Confirmation dialogs stay in the UI callers or come in as a `confirm` callback; the lifecycle imports no dialog.
- The intended behaviour change: every path now stops the service and invalidates the display text. Windows folder
  deletion still releases pages first (US-1407).

**US-1838: `findByRoot`, the board editor factory and the stream-host subclass (3.5).**
- `customEditorRegistry.findByRoot(root)` and `canonicalRoot(root)` on a key map built in `refresh()`. Replace the
  scans across `PagesLifecycleModel`, `PagesPersistenceModel`, `editor-switch.ts`, `BoardEditorModel`,
  `BoardInfoEditorModel` and `PageWrapper`.
- One `createBoardEditor(spec)` in `editors/board/index.ts`, with `plain`, `file`, `folder` and `restore` specs. It
  resolves the association once and passes the resolved editor kind into the model. The kind is stored and never
  re-read from the live registry. `PagesLifecycleModel`, `PagesPersistenceModel` and `editor-switch.ts` stop importing
  `BoardContentEditorModel` and `getDefaultBoardEditorState`.
- `BoardStreamEditorModel` next to `BoardContentEditorModel` takes `resolveStreamPipe` and `pipeUrlEnabled`.
- The `draw-view` → Excalidraw migration moves into the factory's restore path and calls `selectBoard()`.
- Spell the kind union as `BoardEditorKind` everywhere, including `api/types/*.d.ts` if a script-facing type names it.
  Changing the spelling in a `.d.ts` changes no member, so it needs no bridge bump.
- Restore ordering is delicate, so the plan converts one call site at a time. The persisted editor ids and page
  descriptors do not change.

### Order

1. **US-1832 first.** US-1834 builds on the base.
2. **US-1833, then US-1834, then US-1835.** The registry needs the snapshot, and the consumers need the registry.
3. **US-1836 after US-1834.** Pruning subscribes to the registry.
4. **US-1837 after US-1836.** The lifecycle's rename calls the categories hook.
5. **US-1838 is independent.** It runs last so it does not collide with US-1837 in `BoardInfoEditorModel`.

## Rules for every task in this epic

- **The roadmap guardrails apply** ([§7](../refactoring-roadmap.md#7-guardrails-against-the-drift-coming-back), also
  in `doc/agents-common.md`). Every plan names the module that owns each rule it touches and the existing helper it
  reuses: `BoardRoot`, `BoardGrant`, the typed RPC, `PendingRequests`, `isPathInside`, and from this epic
  `MainSnapshotMirror` and `BoardRegistry`.
- **Each copy is replaced, not wrapped.** A task is done when the old copies are gone. A thin alias that stays says
  why in the plan.
- **No dynamic `import()` to reach a higher layer.** The `await import("../ui/sidebar/pinned-items")` calls are what
  US-1836 removes. A plan that adds one is sent back.
- **Main stays the authority on trust.** The renderer requests and the user grants. No renderer change decides trust
  or widens a permission check; a plan that changes an authorization check says so and why it is safe.
- **Pure moves first.** When a task moves files and changes logic (US-1836, US-1838), the move lands and is verified
  first.
- **Contracts that must not change** ([roadmap §8](../refactoring-roadmap.md#8-execution-notes)): `trustedBoards.json`,
  the board storage keys and `board://` host, the settings and vars namespaces, the `editor-categories` setting, page
  descriptors and the persisted editor ids (`board-info` included), `window.persephone.*`, the script API
  (`app.boards.*`, `boards.callTimeoutMs` included), AiVision paths and messages, and MCP `call` behaviour. The private
  wire between main and the renderer may change, since both ship together.
- **Verification:** `npm run typecheck`, `npm run lint`, `npm run build-prod`, `npm run i18n:check` and
  `npm run check:contracts` after every task, plus the live flows each task names. No unit tests.
- **Completion:** the deferred review model. `/review`, `/document` and `/userdoc` run once at epic close.

## Live checks the user runs at close

- Trust a board, change its grants, untrust it: the sidebar, Board Info and an open board page update in every window
  without a reload (US-1833 to US-1835).
- Disable and re-enable a bundled board in Settings: it leaves and returns to the board list and the editor menu
  (US-1834).
- Pin a trusted board to a category, then untrust it: the pin goes. Pin a bundled board: it stays (US-1836).
- Remove a board from Board Info, the Boards panel and the sidebar tree, and uninstall a catalog board with its page
  open: each stops the service, closes the page and leaves no pin (US-1837).
- Rename a pinned board: it keeps its category (US-1836, US-1837).
- Restart with a plain board, a content-host board on a file, a stream-host board and an old `draw-view` page open:
  each restores with the same editor (US-1838).
- Board-service status in Board Info and a provider-backed page follow a service restart (US-1832).

## Notes

### 2026-11-10
- Created after EPIC-143 closed. Phase 2.1 (the move into `api/boards/`) was done in EPIC-142 (US-1824), so 3.2 builds
  directly on it.
- Checked against the code on 2026-11-10:
  - `BoardTrust` still holds five maps, with one `getBoardFileAccessGrants` pull per board and a `JSON.stringify` diff;
  - `eBoardTrustChanged` still carries only paths, and `board-access.ts` still merges trust and bundled discovery;
  - the four other mirrors each have their own revision guard (`latestRevision`, `statusEventRevisions`,
    `revision`);
  - the manual `removePin` / `removeCategoryMembership` calls remain at six sites, four of them through
    `await import("../ui/sidebar/pinned-items")`;
  - 14 `customEditorRegistry.entries` scans remain in 7 files;
  - `BoardEditorModel.editorKind` still re-reads the registry.
- Out of scope, recorded for later: moving tools trust to main (PLAT-7 step 4); Board Info's internal split and view
  binding (BRD-10 beyond the two flows); the shell's board name and glyph service (SHL-6, roadmap 6.8).
- Codex weekly budget: 5% left on 2026-11-10, resetting 2026-11-11 at 14:00. Implementation starts after the reset.

### 2026-11-11
- All seven tasks implemented (Sonnet plans reviewed by Claude, Codex Luna implementation). Codex weekly budget held
  out; no task needed the Sonnet fallback.
- Review corrections applied before implementation:
  - US-1834: `trust`/`untrust`/revoke pull afresh after main replies (a coalesced `reload()` could return pre-change
    state); `BoardWebview` matches the exact board key; guide mounts skip disabled bundled boards, as main does.
  - US-1836: a pin is pruned only in the window that requested the untrust (`BoardRegistryChange.removedHere`), not by
    every window after a settle delay.
- Scope found during planning:
  - US-1833: the snapshot also carries `disabledBundled`; file-access changes publish with `change: "file-access"` so
    the capability index and the supervisor do not re-run.
  - US-1835: `compatible` left the wire again (one shared `boardManifestCompatibility`); `eBoardTrustChanged`,
    `getBoardTrustPaths` and `onTrustChanged` are gone.
  - US-1837: the fixed order releases pages before stopping the service, so a cancelled prompt never leaves a stopped
    service under a live page. Two new messages (`api.boardBusyRemoving`, `api.boardOpenRemoving`), translated into
    every pack.
  - US-1838: a host-less stream-host page restores into `BoardStreamEditorModel` by reading the registry once; a
    board page's kind is now fixed by its class.
- Intended behaviour changes to check live: a disabled bundled board is no longer permitted in the renderer (its open
  page shows the untrusted placeholder); every removal path stops the service and refreshes the display text; rename
  stops the service and keeps the pin's position; `boards.list()` prunes stale installed entries.
