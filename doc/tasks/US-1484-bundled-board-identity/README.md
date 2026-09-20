# US-1484 — Stable identity for bundled boards across install paths

**Status:** Planned · **Epic:** [EPIC-109: Bundled boards and the Excalidraw board](../../epics/EPIC-109.md) · **Depends on:** [US-1483: Bundled board registry and discovery](../US-1483-bundled-board-registry/README.md)

## Goal

Make a bundled board's persisted editor, page, board-storage, and board-vars identity survive
moving from a development tree to a packaged install or reinstalling to a different directory.
The stable identity is the immediate folder name under `assets/boards/`; editor ids remain
`board-editor:<absolute root>` at runtime.

This document is investigation and planning only. It does not implement the alias, change the
editor-id format, add a manifest `id`, add tests, or add a bundled-board asset.

## Background

### Current US-1483 implementation

US-1483 is present in the source even though its older task document still says Planned. The live
`src/renderer/editors/board/bundled-board-registry.ts` exposes `BundledBoard` records with:

```typescript
interface BundledBoard {
    id: string;                         // immediate child folder under assets/boards
    root: string;                       // current absolute root
    manifest: BoardManifest;
    origin: "bundled";
}
```

`refresh()` scans only immediate directories, reads each manifest, assigns `entry.name` to `id`,
sorts by id, and replaces the in-memory list. `list()`, `isBundled(root)`, `ensureInitialized()`,
and `subscribe()` are already available. `BoardManifest` in
`src/renderer/editors/board/board-manifest.ts:58-98` still has no id field; `name` is display
metadata and must not become identity.

`src/renderer/editors/board/custom-editor-registry.ts:54-68` deliberately keeps
`boardEditorId(root)` as `board-editor:<root>` and parses the remainder verbatim. The registry
adds bundled matches with the current real root at `:296-309`. The 25 callers outside that file
that parse or compare the root therefore must not be made to understand a synthetic id.

### Restore sequencing and the actual persisted shape

The named D5 seam at `src/renderer/api/pages/PagesLifecycleModel.ts:133-174` is the runtime
construction branch: it parses a dynamic `board-editor:<root>` before the ordinary editor fallback.
It is not the whole session-restore path.

Current persistence is split as follows:

- `BoardEditorModel.getRestoreData()` (`src/renderer/editors/board/BoardEditorModel.ts:645-679`)
  forces the persisted `editorId` to `board-view` and stores `boardRoot` in the editor state,
  beside independent `filePath` and `folderPath` values.
- `BoardContentEditorModel.editorId` (`src/renderer/editors/board/BoardContentEditorModel.ts:58-66`)
  is dynamically `board-editor:<root>` at runtime, but its restore data still uses the base
  board-view persistence shape.
- `PagesPersistenceModel.restorePage()` (`src/renderer/api/pages/PagesPersistenceModel.ts:88-252`)
  applies the descriptor, then constructs board-view/content-host editors and calls `restore()`.
  A folder board separately validates `boardRoot` plus `folderPath` against the current custom
  editor registry.
- `BoardEditorModel.restore()` and `refreshBoards()` (`:705-748`) already turn a missing
  `board-manifest.json` into `selectedBoard === undefined`, which drives `BoardNotFoundView`.

The alias therefore belongs in descriptor normalization before `PagesPersistenceModel.restorePage()`
constructs an editor, plus the dynamic-id branch in `PagesLifecycleModel` for runtime/cross-window
construction. The rewrite must update every bundled-root occurrence that is durable in the page
descriptor, not just an editor id.

### Main-side storage

`src/main/board-storage.ts:112-133` normalizes the supplied root, hashes it with
`boardRootKey()`, and uses the resulting 64-character key under
`<getDataFolder()>/board-storage/`. `boardRootKey()` in `src/main/board-root-key.ts:10-28` is the
SHA-256 of the normalized absolute path. `ensureMetadata()` (`board-storage.ts:186-221`) creates a
`board.json` sidecar containing `boardRoot`, manifest `name`, and `createdAt`; the sidecar is not
used to choose the storage directory.

`src/main/utils.ts:28-36` already resolves `getAssetPath("boards")` to the app's `assets/boards`
directory in both dev and packaged builds. That is sufficient for main to identify a current
bundled root without asking the renderer: normalize the root, compute a boundary-safe
`path.relative(getAssetPath("boards"), root)`, and accept exactly one non-empty child segment.
That segment is the stable folder-name identity. No new IPC and no main-side copy of the renderer
registry are needed.

### Persistence audit

The audit found twelve relevant persistence/identity sites. The result is deliberately separated
from ordinary runtime uses of a root (protocol hosts, service records, icon/usage caches, and
capability registrations); those are rebuilt from the current root each session and do not orphan
durable user data.

| Site | What is stored or derived | Does a bundled install-path change break it? | US-1484 disposition |
|---|---|---|---|
| `src/renderer/editors/board/custom-editor-registry.ts:54-68` and `BoardContentEditorModel.editorId` | Runtime `board-editor:<absolute root>` identity | Yes when an old id is restored or reused | Alias the root to the current bundled record; retain the id format. |
| `src/renderer/editors/board/BoardEditorModel.ts:57-116,645-679` | `BoardEditorState.boardRoot`, plus the persisted board state | Yes; the board would otherwise point at the old install | Rewrite `boardRoot`; leave `filePath` and `folderPath` independent. |
| `src/renderer/api/pages/PagesPersistenceModel.ts:58-252` and `PageModel.getDescriptor()` at `src/renderer/api/pages/PageModel.ts:781-802` | `openFiles{windowIndex}.json` page/editor descriptors and `WindowState` | Yes; this is the actual restart/session restore boundary | Normalize before construction; rely on existing later persistence, with no restore-time save. |
| `src/shared/types.ts:12-25` and `src/shared/persistence.ts:12-36` | `IEditorState.editor`, `sourceLink`, `EditorDescriptor.state`, and `HostDescriptor.state` | The `editor` token can carry a legacy/dynamic board id; a persisted `persephone-board://` source link carries an encoded root | Rewrite only recognized bundled editor ids and board links; do not rewrite user file paths, pipe descriptors, or arbitrary board state. |
| `src/renderer/content/persephone-board-link.ts:16-29` | Board links encode `boardRoot` in base64 JSON | Only when such a link is retained in a persisted source link or back-navigation entry | Reuse its decode/encode helpers while repairing persisted links; do not change the link format. |
| `src/main/board-storage.ts:112-133,245-296` | Storage folder key is SHA-256 of normalized root | Yes; stored board state becomes invisible | Use a domain-separated SHA-256 of the bundled folder id; retain the old root hash for non-bundled boards. |
| `src/main/board-storage.ts:186-221` | `board.json` sidecar records the root used to create the store | Access does not break once the folder key is stable, but the metadata becomes stale | Refresh the sidecar's `boardRoot` to the current root when opening an existing stable store. |
| `src/renderer/api/board-install-registry.ts:16-151` | Catalog install record stores `id` and an install `root` | No; bundled boards never enter `installedBoards.json`, and catalog ids already own reinstallation moves | No change. Keep catalog installation semantics path-based. |
| `src/renderer/ui/sidebar/pinned-items.ts:10-44` | Trusted-board pins are `board:<absolute root>` in `pinned-editors` | No for bundled boards; bundled roots are excluded from the trusted Boards list and will be represented by the later Built-in item | No change; US-1485 owns bundled presentation/pinning behavior. |
| `src/renderer/api/board-trust.ts:4-29,80-127` | User trust roots in `trustedBoards.txt` | No; D2 says bundled boards are never written there | No change and no migration of trust data. |
| `src/renderer/api/board-vars/namespace.ts:8-23` and `BoardEnvStore`'s JSON namespace map | `author/name` when both fields exist, otherwise the absolute root is the namespace key | Yes for a bundled manifest without both display fields; variables become orphaned | Preserve the existing `author/name` path when present; use `bundled:<folder-name>` as the bundled fallback. |
| `src/renderer/editors/board-info/BoardInfoEditorModel.ts:98-119,749-785` | Properties pages can persist a `boardRoot` | Not for bundled boards: the Board Info surface is fed by catalog/trusted-board inventory and bundled boards are excluded | No special Board Info path; generic descriptor normalization may safely repair a matching bundled root. |

There is no separate workspace-file system: the project describes a workspace as a page whose
Explorer is rooted at a folder. Page/session state is therefore covered by the `openFiles` row
above. `NavEntry` back-navigation is also part of `PageDescriptor`; its `href` is normally a
document path, but recognized `persephone-board://` values will be repaired as links. Service
snapshots and board protocol hosts carry roots only in memory/IPC and are recreated from the
current bundled record.

## Implementation Plan

### 1. Add one renderer-side bundled identity resolver

Modify `src/renderer/editors/board/bundled-board-registry.ts` to expose a lookup by the stable
folder id and a resolver for a persisted root. The resolver must:

1. Ensure the registry is initialized before lookup.
2. First check whether the persisted root still resolves to a board on disk by using the existing
   manifest reader (a readable `board-manifest.json` at that exact path is the discriminator). If
   it does, leave the root exactly as persisted and do not alias it, even when its basename matches
   a current bundled board.
3. Only for a root with no readable `board-manifest.json`, take its basename as the candidate id and
   require its parent segment to be `boards` (case-insensitive on Windows) as a cheap pre-filter.
   Find the current record with that id and return its current `root`; return `undefined` when the
   board is absent, malformed, or removed in this app version.
4. Compare roots with the existing file-path normalization rules, but preserve the registry's
   current root spelling in the repaired state.

This means a real user board at `C:\work\boards\excalidraw` is never silently adopted by a
current bundled `excalidraw`: because the old path still has a readable manifest, restore keeps
that user root and its existing trust/not-found behavior. Only a stale, no-longer-readable old
path can be aliased, and only when the current bundled registry has the same stable folder id.

The identity boundary is:

```typescript
// Before: only the current root is available; a moved bundled root has no match.
const boardRoot = boardState.boardRoot;

// After: the stable immediate folder name can resolve the current install root.
const boardRoot = await bundledBoardRegistry.resolvePersistedRoot(boardState.boardRoot);
// undefined means “no current bundled board”; retain the old root for not-found handling.
```

Add a small `resolveBoardEditorId(editorId)` helper in
`src/renderer/editors/board/custom-editor-registry.ts` (or the board identity module it imports)
that parses the existing prefix, resolves the root through the bundled registry, and rebuilds
`board-editor:<current root>` only when a record is found. `parseBoardEditorId()` remains a pure
verbatim parser. Do not alter any of the 25 parsing call sites or create a synthetic editor id.

### 2. Normalize the real restore descriptor without a restore-time save

Modify `src/renderer/api/pages/PagesPersistenceModel.ts` at the start of `restorePage()`:

1. Clone the incoming page descriptor and inspect each editor descriptor before the existing
   `board-view`/host/folder branches run.
2. Resolve `state.boardRoot` through the bundled identity resolver. When it resolves, replace the
   state root with the current root and rewrite a dynamic `editorId`/legacy `state.editor` that
   embeds the old root. Current `BoardEditorModel.getRestoreData()` normally has `editorId:
   "board-view"`, so this explicitly covers both the live shape and older/dynamic descriptors.
3. Rewrite `sourceLink.href` and `sourceLink.url` when they decode as `persephone-board://` links
   for the stale root. Apply the same narrow rewrite to `PageDescriptor.navBack[].href`. Do not
   touch `filePath`, `folderPath`, ordinary document hrefs, pipe descriptors, or board-owned
   `sharedState` values.
4. Apply the same editor-id helper in `PagesLifecycleModel.buildEditorById()` before its existing
   `parseBoardEditorId()` branch. All later comparisons against `customEditorRegistry.entries`
   must use the current id/root.
5. Keep folder-board validation independent: the claimed `folderPath` is not derived from, or
   replaced by, the bundled installation root.

The current restore flow must remain non-throwing for a removed bundled board. If no current
record matches the stable folder name, leave the root unresolved and let the existing
`BoardEditorModel.refreshBoards()` path clear `selectedBoard`, producing `BoardNotFoundView` just
as it does for a deleted/uninstalled board. A stale descriptor must not be treated as a valid
current editor and must not crash the page restore; a folder claim continues to use the existing
Folder View fallback.

Keep the repair in memory for the restore. Do not add a restore-time `saveState()` or a repair
flag: the alias is an in-memory map lookup against an already initialized registry, so avoiding
that lookup on later launches is not a concrete benefit. A save during restore adds a session-
clobbering risk if the page set is incomplete, while the normal existing persistence lifecycle
(including later user-driven saves and the existing app-quit save) can serialize the current root
when appropriate. If the app exits before one of those normal saves, the alias simply runs again
on the next launch; it is idempotent and safe. Cross-window/page-transfer restore paths use the
same in-memory normalization and do not gain a new forced save.

### 3. Make main-side board storage stable without renderer IPC

Modify `src/main/board-root-key.ts` and `src/main/board-storage.ts`:

1. Add a domain-separated helper that hashes `bundled:<folder-id>` to the same 64-lowercase-hex
   shape as the existing key.
2. In `contextForRoot()`, use `getAssetPath("boards")` from `src/main/utils.ts` and a
   boundary-safe relative-path check. Only an immediate child is bundled; nested paths and paths
   outside the app-owned directory keep the existing `boardRootKey(normalizedRoot)` behavior.
3. Keep the storage folder layout and validation unchanged. The before/after key selection is:

```typescript
// Before: every board is keyed by its normalized absolute root.
const boardKey = boardRootKey(normalizedRoot);

// After: only current assets/boards/<id> roots use stable bundled identity.
const bundledId = bundledBoardId(normalizedRoot); // derived from getAssetPath("boards")
const boardKey = bundledId
    ? bundledBoardKey(bundledId)
    : boardRootKey(normalizedRoot);
```

4. Leave non-bundled hashes byte-for-byte compatible. Do not scan manifests, import renderer
   code, add an IPC endpoint, or attempt to migrate an old path-hash directory.
5. When `ensureMetadata()` finds an existing stable bundled store, update only its diagnostic
   `boardRoot` to the current root while preserving `name` and `createdAt`. A malformed sidecar
   must not prevent the normal store read/write path from working.

The main-side containment test is sufficient because US-1483 defines bundled records as immediate
children of `assets/boards/`, and the renderer passes the current discovered root after restore
aliasing. Main does not need to know the renderer registry's manifest object or make a round trip
over IPC.

### 4. Make the bundled board-vars fallback portable

Modify `src/renderer/api/board-vars/namespace.ts` so `resolveBoardNamespace()` keeps the existing
`author/name` namespace when both fields are present, but after bundled-registry initialization
returns `bundled:<BundledBoard.id>` for a bundled root without those fields. Preserve the existing
absolute-root fallback for ordinary user/catalog boards. Update the explanatory comments and the
hand-maintained public declaration copies in:

- `src/renderer/api/board-vars/types.ts`
- `src/renderer/api/board-vars/admin-api.ts`
- `src/renderer/api/types/board-vars.d.ts`
- `assets/editor-types/board-vars.d.ts`

No bundled board has shipped, so there is no existing bundled board-vars namespace to migrate. The
new namespace is forward-looking; existing user/catalog root namespaces remain unchanged.

### 5. Manual verification with a temporary bundled fixture

Because `assets/boards/` is currently absent and US-1486/US-1487 will provide the first real board,
create a throwaway fixture only during implementation under
`assets/boards/us1484-fixture/`:

- `board-manifest.json` with `schemaVersion: 1`, a minimal file mask/priority sufficient to make
  the custom-editor registry claim a temporary sample file, and no required `id` field.
- A trivial `index.html` that can call the existing board storage API for one known test key.

Use the normal dev runtime to verify the registry exposes `id: "us1484-fixture"`, the current
absolute root, and `origin: "bundled"`; open the sample file; write/read one storage value; and
write/read one board-vars value. Before touching any session file, close the running app. Copy the
exact current `openFiles{windowIndex}.json` file to a backup outside the app data directory,
record the source path, and edit only the original descriptor after the backup succeeds; the file
is the user's live session, not disposable. Change the fixture root and any board link to use a
different old install prefix while retaining the same `assets/boards/us1484-fixture` basename,
preserving every other page and field. Relaunch and verify:

- the page uses the current bundled root and current runtime editor id;
- the stored board value is read from the stable-id storage directory;
- after exercising the existing normal persistence/on-quit save, close the app again and read back
  the repaired descriptor to confirm it no longer contains the stale bundled root;
- a fixture with no matching current record produces the normal Board Not Found view; and
- ordinary trusted/catalog board storage still uses its old root-hash behavior.

Inspect the sidecar to confirm its `boardRoot` is current. With the app closed, restore the backed-
up session file byte-for-byte, then verify that the restored file is identical to the original
(for example by comparing its hash) before finishing. Remove the fixture files, temporary sample
file, temporary fixture board-storage directory, and fixture board-vars namespace/file created for
this verification; restore any temporary vars-file setting as well. Confirm that no
`assets/boards/` directory, fixture file, sample file, fixture storage directory, or fixture
board-vars namespace remains. The fixture is temporary and must not be committed.

No unit tests, test harnesses, packaging changes, or permanent assets are part of this task.

## Verification (2026-09-20)

Verified live over MCP against the running app, using a temporary fixture at
`assets/boards/us1484-fixture/` plus a deliberate **decoy user board** at
`…/scratchpad/userland/boards/us1484-fixture/`. Both were removed afterwards; the user's session
file was never read or written, and the app was never closed.

**Discovery:** the fixture was found with `id: "us1484-fixture"` — the folder name, *not* the
manifest's `name` of "US-1484 Fixture" — its current absolute root, and `origin: "bundled"`.

**The alias, including the C1 attack shape:**

| Persisted root | Result | Meaning |
|---|---|---|
| stale, absent, under a `boards` parent | current bundled root | alias works |
| decoy user board, same basename **and** `boards` parent, real manifest present | **its own path, unchanged** | C1 holds — a user's board is never adopted |
| same shape but an id no bundled board uses | `undefined` | unknown id is not aliased |
| matching basename whose parent segment is not `boards` | `undefined` | parent segment is required |

**Removed-board degradation:** after the fixture was deleted, the same stale root resolved to
`undefined` rather than fabricating a path, which is what preserves the existing Board Not Found
view.

**Main-side storage keying** (`bundledBoardId`, exercised directly over its six edge cases):
resolves correctly for both the `normalizeBoardRoot` form (lowercased, forward slashes) and the
native `getAssetPath` form (real case, backslashes) — `path.relative` on win32 reconciles them — and
returns `undefined` for a nested path, a path outside the tree, the boards root itself, and the
`assets/boards-extra/x` sibling-prefix trap that a naive `startsWith` check would wrongly accept.
Non-bundled roots keep `boardRootKey(normalizedRoot)` unchanged, so no existing board's storage
moves.

**Flat type copy:** `assets/editor-types/board-vars.d.ts` is identical to
`src/renderer/api/types/board-vars.d.ts`.

## Concerns / Open Questions

1. **Restore alias scope:** Folder basename alone is not enough evidence because a user board could
   share a name. The resolver first requires that the old path have no readable `board-manifest.json`,
   then uses the old root's immediate parent as a `boards` pre-filter and requires an actually
   discovered current bundled record. If the old path is still a real board, even one sharing the
   current bundled id, it is never aliased. A missing current record is not an alias.
2. **Persisted repair timing:** Do not force a save during restore. The in-memory lookup cost is
   negligible, while a save against a partial page set could clobber the user's session. Normal
   later persistence may write the repaired root; otherwise the safe alias repeats on the next
   launch.
3. **Removed boards:** The alias must never fabricate a root from the old path or throw because a
   manifest disappeared. Leaving the root unresolved is what preserves the existing
   `BoardNotFoundView` behavior.
4. **Storage migration:** No bundled board has ever shipped, so no user data can exist under the
   old bundled path-hash convention. Migrating arbitrary old hashes would require an unreliable
   identity map and is not justified. Non-bundled board keys must remain unchanged.
5. **Sidecar semantics:** `board.json` is diagnostic metadata, not an authority. Updating its root
   on stable-store access prevents misleading diagnostics without making it part of identity.
6. **Board-vars collision semantics:** Bundled boards are not in `boardTrust.listPaths()` and never
   enter the registration collision dialog. The `bundled:<id>` namespace is domain-separated from
   `author/name` and from ordinary absolute-root namespaces.
7. **No renderer/main identity split:** Renderer discovery owns manifest validity and the full
   record; main only needs the app-owned path boundary and immediate folder name for storage. This
   deliberately avoids a new IPC contract.

## Acceptance Criteria

- `bundled-board-registry.ts` remains the source of stable bundled ids: the immediate folder name
  under `assets/boards/`, not `manifest.name` and not a required manifest field.
- Runtime custom-editor ids remain exactly `board-editor:<absolute root>`; no synthetic id and no
  change to `parseBoardEditorId()`'s prefix/verbatim semantics is introduced.
- A persisted current-format page whose `BoardEditorState.boardRoot` points at an old
  `assets/boards/<id>` root restores against the current discovered root, including content-host
  and folder-board sequencing.
- A persisted dynamic `board-editor:<old root>` token is rewritten to the current runtime id at
  the restore/runtime construction seam without editing the 25 external parser call sites.
- Recognized persisted `persephone-board://` links and back-navigation links are repaired; file
  paths, folder claims, pipe descriptors, and arbitrary board state are not rewritten.
- A stale root is repaired in memory before page construction, without a new restore-time save;
  normal later persistence may write the current root, and the idempotent alias remains safe on
  every launch. A board removed from a later app version remains a non-crashing `BoardNotFoundView`,
  not a fabricated current board.
- If the old root still contains a readable `board-manifest.json`, it is never aliased, even when
  a current bundled board has the same basename; the existing real board remains selected.
- Main storage uses a stable hash of `bundled:<id>` for an immediate child of
  `getAssetPath("boards")`; non-bundled storage keeps the existing normalized-root hash.
- Existing stable bundled storage returns the same values after the root changes, and its
  `board.json` sidecar reports the current root.
- Bundled board-vars without both `author` and `name` resolve to `bundled:<id>` and retain their
  values after an install-path change; existing user/catalog namespaces are unchanged.
- `installedBoards.json`, `trustedBoards.txt`, `pinned-editors`, the Built-in/Disable UI, the
  manifest schema, packaging, capability routing, the Excalidraw board, and the build pipeline are
  not changed by this task.
- The temporary `assets/boards/us1484-fixture/` fixture and all data created specifically for its
  verification are removed before completion and no fixture is committed.
- No unit tests, test harnesses, or test files are added; verification uses the manual/runtime
  procedure above.

## Files that need no changes

- `src/main/utils.ts` — `getAssetPath("boards")` already resolves the correct dev/packaged path.
- `src/renderer/editors/board/board-manifest.ts` — reuse the existing manifest shape/parser; do
  not add a required `id`.
- `src/ipc/main/core-handlers.ts`, `src/ipc/renderer/api.ts`, and `src/ipc/api-types.ts` — no
  renderer round trip is needed for main storage identity.
- `src/renderer/editors/board/board-access.ts` — bundled permission is already exact-root based;
  identity aliasing is a restore concern, not a new permission origin.
- `src/renderer/api/board-install-registry.ts` — catalog install ids/roots are separate from the
  bundled source and keep their existing move/prune semantics.
- `src/renderer/ui/sidebar/pinned-items.ts` and `src/renderer/api/board-trust.ts` — bundled boards
  are not stored as trusted roots or trusted-board pins.
- `electron-builder.yml` and all `assets/boards/` board/build files — packaging and the real board
  belong to US-1486/US-1487.
- `src/renderer/api/boards.ts` `mergeBoardSources()` and listing paths — bundled boards remain out
  of the Registered Boards inventory.
- `src/renderer/editors/board/BoardInfoEditorView.ts` and its catalog UI — bundled presentation and
  Disable belong to US-1485; the generic Board Info root is not a bundled inventory path.
- `src/shared/types.ts` and `src/shared/persistence.ts` — their descriptor shapes already carry the
  fields needed; normalization happens at restore without a schema bump.
- `doc/active-work.md` and `doc/epics/EPIC-109.md` — the dashboard/epic entry already exists and
  the task request forbids changing them.

## Files Changed Summary

| File | Planned implementation change | Changed by this planning task |
|---|---|---|
| `src/renderer/editors/board/bundled-board-registry.ts` | Add stable-id lookup and stale-root-to-current-root resolution | No |
| `src/renderer/editors/board/custom-editor-registry.ts` | Add restore/runtime editor-id alias helper; preserve real-root id format | No |
| `src/renderer/api/pages/PagesPersistenceModel.ts` | Normalize bundled roots/links before restore; do not add a restore-time save | No |
| `src/renderer/api/pages/PagesLifecycleModel.ts` | Resolve a stale dynamic board editor id before the existing parse/build branch | No |
| `src/main/board-root-key.ts` | Add domain-separated stable bundled-id hashing; preserve existing root hashing | No |
| `src/main/board-storage.ts` | Detect immediate `assets/boards/<id>` roots, select stable keys, and refresh sidecar metadata | No |
| `src/renderer/api/board-vars/namespace.ts` | Use `bundled:<id>` for bundled path-fallback namespaces | No |
| `src/renderer/api/board-vars/types.ts` | Document the bundled namespace form | No |
| `src/renderer/api/board-vars/admin-api.ts` | Document the bundled namespace form in the admin API | No |
| `src/renderer/api/types/board-vars.d.ts` | Sync public namespace documentation | No |
| `assets/editor-types/board-vars.d.ts` | Sync the hand-maintained public type copy | No |
| `assets/boards/us1484-fixture/board-manifest.json`, `index.html` | Temporary manual verification fixture only | No; must be removed |
| `doc/tasks/US-1484-bundled-board-identity/README.md` | Investigation, audit, decisions, implementation plan, and acceptance criteria | Yes |
| `installedBoards.json`, `trustedBoards.txt`, `pinned-editors`, `electron-builder.yml`, `doc/active-work.md`, `doc/epics/EPIC-109.md` | Explicitly retained unchanged | No |
