
# US-1469 — `persephone.storage`: per-board folder and key/value store

Linked epic: [EPIC-106 — Bridge contract and the module service process](../../epics/EPIC-106.md)  
Status: Planned

The Active Work Dashboard already contains the US-1469 link under EPIC-106; `doc/active-work.md`
and the reviewed epic are intentionally unchanged for this task.

## Goal

Give every trusted board a private, app-owned storage folder at
`<userData>/data/board-storage/<board-key>/` and expose a small JSON key/value API as
`persephone.storage`. The same store must be reachable by the board frame and its module service,
because EPIC-106 decision D6 makes them one module with one identity and one trust decision.

## Background

### Existing data and path ownership

Verified against the source tree on 2026-09-20:

- `src/main/utils.ts:39-45` defines `getDataFolder()` as `<userData>/data`, memoized for the
  main process. Existing app-global files are flat under that folder.
- `src/renderer/api/fs.ts:30-36,520-541` mirrors that location in the renderer and provides
  `dataFileName`, `getDataFile`, `saveDataFile`, `deleteDataFile`, and `prepareDataFile`. Those
  helpers join directly under `data/`; they do not define a per-board storage namespace.
- `src/renderer/api/boards.ts:75-80` uses `<userData>/data/boards/` as the default install
  container. That directory contains installed board code and is not the location for this
  feature. The new store must remain under the sibling `data/board-storage/` directory.
- There is no current per-board storage folder under `<userData>/data/`.

The store is main-owned, like `src/main/ui-preferences.ts:1-75`: load lazily, validate every
value read from JSON, memoize the parsed state, and persist the whole small object after a
mutation. The renderer half at `src/renderer/api/ui-preferences.ts:41-77` is a useful cache
pattern, but it is not a coherence mechanism: `load()` snapshots once and never receives another
window's write. IPC wiring for that model is `src/ipc/api-types.ts:26-31,165-173`,
`src/ipc/main/core-handlers.ts:46-55,366-372`, and `src/ipc/renderer/api.ts:74-79`.

This task deliberately does not create a renderer snapshot cache for board storage. Board calls
already use the per-board `MessagePort` RPC in `src/board-shim.ts:417-423`; every `get`, `set`,
`delete`, and `keys` request can consult the one main-process owner. Therefore the selected
coherence policy is **no broadcast, last writer wins**: a later operation sees the latest committed
main-process state, and simultaneous writes to the same key are serialized in arrival order. There
is no `openWindows.send()` event for storage. If a future API needs change subscriptions, it is new
work based on `src/main/open-windows.ts:27-31` and the broadcast call sites in
`src/main/clipboard-service.ts:161-171`; it is not inherited from `ui-preferences`.

### Existing board bridge and trust gate

The board frame runs the injected browser-only shim in `src/board-shim.ts`. It has no Node or
Electron access; `rpc()` posts a typed `{ kind: "rpc" }` message and resolves the matching
`rpc-result`. The public object is assembled at `src/board-shim.ts:866-930`, while file and job
RPC wrappers are at `:958-989` and `:1197-1220`.

The wire contract is in `src/ipc/board-bridge-channels.ts:143-217`. Main dispatch is deliberately
exhaustive: `src/main/board-bridge.ts:218-255` defines `BoardRpcHandler`, `boardRpcHandlers`, and
`runRpc`; `src/main/board-bridge.ts:377-387` sends the result or `errMessage` failure. A storage
operation belongs in this existing RPC path. The plan adds four explicit RPC methods rather than
one stringly-typed catch-all so the wire union and handler table remain exhaustive.

The trusted branch is already enforced before this port exists: `src/renderer/editors/board/BoardEditorView.ts:176-239` renders `UntrustedBoardView` instead of `BoardHostView`, and
`BoardWebview.registerBoard()` at `src/renderer/editors/board/BoardWebview.ts:153-171` registers
the `board://` host only for the live board view. The storage handler must use `entry.root`; it
must never accept a board root or board key from the board caller. The service-side entry point
must use the same trust gate owned by US-1467. No changes to `src/renderer/api/board-trust.ts` or
the `trustedBoards.txt` format are allowed.

### Board identity and the two existing variable stores

EPIC-106 D6 binds storage identity to the board root, not `manifest.name`. The manifest name is
author-controlled, optional, mutable, and can collide. `src/main/board-protocol-service.ts:51-61`
already proves the intended root identity shape for `board://`: resolve the root, lowercase it on
Windows, and hash it with SHA-256. For storage, use the same canonical root rules but retain the
full lowercase SHA-256 digest as the `<board-key>` (64 hexadecimal characters). The key is
therefore filesystem-safe, independent of manifest content, and deterministic across restarts.
Do not call `realpath`; symlink identity is the supplied board root, matching trust/listing identity.
A board moved to another folder gets a different digest and therefore loses access to its old
storage. That is accepted by D6 and must be recorded rather than silently migrated.

`src/renderer/api/board-vars/BoardEnvStore.ts:33-150` is a different feature: one renderer-global
`.env.json` selected by the `board-vars.file` setting, with namespaces resolved by
`src/renderer/api/board-vars/namespace.ts` and values kept as strings for environment secrets.
Its bridge in `src/renderer/api/board-vars/board-vars-bridge.ts:27-85` serializes access to that
single configured file and can prompt to create/unlock it. `persephone.storage` is instead an
automatic per-board folder owned by main, accepts JSON values, has no user-selected path or
encryption dialog, and is shared by the board frame and service. Both exist because board vars
are deliberately portable/configurable secret input, while storage is module-owned runtime state.

### Epic alignment

This plan takes D6 exactly: one root-derived store shared by frame and service, with no separate
service storage permission. It also takes D6's explicitly permitted “last-write-wins, no broadcast”
branch and records why that is safe for this request/reply API. Nothing found in the source
contradicts D6 or requires a manifest field. The roadmap's implication that `ui-preferences` is a
broadcast model is corrected by the verified source behavior above, as EPIC-106 itself requires.

## Implementation Plan

### 1. Add a shared root identity helper and main-owned store

- Add `src/main/board-root-key.ts` with two main-process helpers:
  - `normalizeBoardRoot(boardRoot)`: require an absolute root, apply `path.resolve`, use `/` as
    the canonical separator for hashing, and lowercase only on Windows. Do not use the manifest,
    filesystem `realpath`, or any board-provided storage path.
  - `boardRootKey(boardRoot)`: SHA-256 of the canonical string, returned as exactly 64 lowercase
    hexadecimal characters. The output is restricted to `[0-9a-f]{64}` and is the only value used
    as a child of `board-storage`.
- Add `src/main/board-storage.ts` as the sole disk owner. Store JSON at
  `<getDataFolder()>/board-storage/<boardRootKey>/store.json`; create the board folder lazily on
  the first successful write, never under `data/boards/`. On that first creation, also write a
  sibling `board.json` sidecar containing the absolute board root, the readable manifest `name`
  when available, and a creation timestamp. The sidecar is metadata for inspection and cleanup;
  it is never read to resolve identity.
- Export a JSON value type covering `null`, strings, booleans, finite numbers, arrays, and plain
  objects whose descendants are JSON values. Reject `undefined`, non-finite numbers, `bigint`,
  functions, class instances, cyclic values, and values exceeding the limits below.
- Load a board lazily into a per-key cache. Treat a missing file as `{}`. A malformed, oversized,
  or structurally invalid existing file must reject the operation with a readable error rather
  than silently discarding user state. Use `errMessage` whenever a caught value is converted to
  an error string; do not hand-roll `Error` narrowing.
- Define bounded limits in the module: key length 256 UTF-16 code units, maximum JSON depth 32,
  and maximum serialized `store.json` size 1 MiB measured as UTF-8 bytes. Validate the candidate
  whole store before replacing the cached state or writing it. This is the explicit answer to the
  unbounded-store hazard.
- Serialize mutations per board root with a main-owned queue/mutex. A `set` or `delete` must load
  the newest cached state, apply one mutation, validate the complete next JSON document, and write
  it asynchronously before resolving. Use `fs.promises` rather than a synchronous write: this is
  a board-callable API that may be looped, and even the 1 MiB cap must not block the main-process
  event loop. This is a deliberate divergence from the synchronous `ui-preferences` write.
  Different keys do not lose each other's updates; concurrent writes to the same key commit in
  queue order, with the later value winning. Keep all service calls on this same main-owned route
  so the frame and utility process never write the file independently.

Before → after for root placement and identity:

~~~ts
// Before: installed board code (src/renderer/api/boards.ts:75-80)
return fpJoin(await api.getCommonFolder("userData"), "data", "boards");

// After: board data (src/main/board-storage.ts)
const root = path.join(getDataFolder(), "board-storage", boardRootKey(boardRoot));
const file = path.join(root, "store.json");
~~~

### 2. Define the exact board storage API and wire the board RPC

- In `src/ipc/board-bridge-channels.ts:143-150`, extend `BoardRpcMethod` with
  `"storageGet" | "storageSet" | "storageDelete" | "storageKeys"`.
- Keep RPC arguments positional and private to the bridge: `storageGet([key])`,
  `storageSet([key, value])`, `storageDelete([key])`, and `storageKeys([])`. The handler derives
  the root from `BoardPortEntry.root`; the board never supplies a root, digest, filename, or
  folder segment.
- In `src/main/board-bridge.ts:221-248`, add only the four `boardRpcHandlers` entries. They call
  `board-storage.ts` with `entry.root` and validated arguments. Do not change the runner handlers,
  service lifecycle, port registration, or disposal logic. Existing `runRpc()` error transport
  will reject the board-side promise with the module's readable error.
- The public surface is intentionally only these four methods. `get` returns
  `JsonValue | undefined` for a missing key; `set` returns `Promise<void>` after persistence;
  `delete` returns `Promise<boolean>` (`true` only when a key existed); `keys` returns sorted
  `Promise<string[]>`. There is no `clear`, `has`, transaction, subscription, or whole-store
  read in this task: those would widen the capability and make quota/concurrency behavior harder
  to reason about.

Before → after for the exhaustive wire union:

~~~ts
// Before (src/ipc/board-bridge-channels.ts:144-150)
export type BoardRpcMethod =
    | "openFileDialog" | "saveFileDialog" | "openFolderDialog"
    | "readFile" | "writeFile" | "getJobs";

// After
export type BoardRpcMethod =
    | "openFileDialog" | "saveFileDialog" | "openFolderDialog"
    | "readFile" | "writeFile" | "getJobs"
    | "storageGet" | "storageSet" | "storageDelete" | "storageKeys";
~~~

### 3. Expose `persephone.storage` in the shim and declarations

- In `src/board-shim.ts:866-930`, add a `storage` object whose four methods call the four RPC
  names through the existing `rpc()` helper. Do not add a second transport, local snapshot, or
  board-root argument. Keep the shim browser-compatible and dependency-free apart from its current
  shared imports.
- In `src/renderer/editors/board/board-api.d.ts:227-309`, add a self-contained `PersephoneJsonValue`
  type and `PersephoneStorageApi` declaration, then add `readonly storage` to
  `PersephoneBoardApi`. Document missing-key, delete-result, JSON-value, quota, persistence-error,
  last-writer-wins, and trust behavior there.
- Do not edit `persephone.version`: US-1466 owns the shared `src/shared/board-bridge-version.ts`
  source of truth and the shipped `1.6.0` bridge version. `persephone.storage` is one of the
  members denoted by that version. Keep adding `storage` to the shim, but do not duplicate the
  version edit. Do not add a manifest field; `src/renderer/editors/board/board-manifest.ts` is
  owned by US-1466 and must remain unchanged.

Before → after for the board-facing contract:

~~~ts
// Before (src/renderer/editors/board/board-api.d.ts:227-309)
interface PersephoneBoardApi {
    readonly version: string;
    // ...existing members...
    readonly var: PersephoneVarApi;
}

// After
type PersephoneJsonValue = null | string | boolean | number
    | PersephoneJsonValue[] | { [key: string]: PersephoneJsonValue };
interface PersephoneStorageApi {
    get(key: string): Promise<PersephoneJsonValue | undefined>;
    set(key: string, value: PersephoneJsonValue): Promise<void>;
    delete(key: string): Promise<boolean>;
    keys(): Promise<string[]>;
}
interface PersephoneBoardApi {
    // ...existing members...
    readonly storage: PersephoneStorageApi;
}
~~~

`assets/editor-types/` is not part of this type change: `board-api.d.ts` is explicitly a legacy
board-page declaration outside `src/renderer/api/types/`, and it is not copied by the flat
editor-types mechanism. If implementation instead moves a public declaration into
`src/renderer/api/types/`, the matching flat copy and `assets/editor-types/_imports.txt` entry are
mandatory; the preferred plan avoids that unnecessary app-script surface.

### 4. Define the service contract for US-1468

- Define the service-side operation contract for US-1468: the service exposes the same four
  operations and result shapes, and its adapter routes requests to the main-owned
  `src/main/board-storage.ts` using the trusted service registration's board root.
- Preserve the D6 constraint that the service must never import a second file-writing
  implementation or write `store.json` directly from the utility process. Frame and service calls
  must converge on the same cache and per-board mutation queue once US-1468 wires the adapter.
- US-1469 does not edit the service supervisor or service transport. This repository has no
  US-1467 service protocol file yet; US-1468 owns the service-facing adapter and the end-to-end
  frame↔service observation. This task is unblocked because its deliverable is the main owner,
  frame RPC path, and stable operation contract.

### 5. Preserve trust boundaries and document impact

- Verify that an untrusted board still renders `UntrustedBoardView`, receives no `BoardWebview`,
  and therefore has no storage RPC port. The service host must reject storage for an untrusted
  root using the same trust/lifecycle decision as its other service requests.
- Keep storage isolated by the root digest. Never use `manifest.name`, `board-vars.file`, the
  installed code folder, or a caller-provided path. A crafted root containing `..`, separators, or
  a path that resembles `board-storage` must still produce only a digest child; assert the digest
  format before joining it to the storage root.
- The code/API contract affects `src/board-shim.ts`,
  `src/renderer/editors/board/board-api.d.ts`, and the developer-facing bridge type comments.
  User-facing board authoring prose remains US-1470's scope: `assets/guides/agents/boards.md`,
  `assets/guides/boards.md`, and `assets/board-template/CLAUDE.md` should be updated there, not in
  this task. No `assets/editor-types` or `_imports.txt` update is expected under the preferred
  declaration path.

### 6. Verify without adding tests

- Do not add unit tests, test harnesses, or test-only files; this project does not use them.
- Run `npm run typecheck`, `npm run lint`, and `npm run build-prod` after implementation.
- Perform live/manual verification of the frame path: first write creates exactly
  `<userData>/data/board-storage/<64-hex-board-key>/store.json` plus `board.json`; `keys` and
  `delete` have the documented results; invalid JSON values and quota violations reject; two
  concurrent frame writes are serialized; a moved root does not read the old folder; an untrusted
  board gets no bridge capability; and a reload/window change still observes main-owned state
  without any broadcast event. US-1468 verifies the end-to-end frame↔service observation.

## Concerns / Open Questions

- **Service protocol ownership:** US-1468 owns the service adapter and the end-to-end
  frame↔service check. Its adapter must be a main-routed operation into `board-storage.ts`; if
  the service design requires changes to `src/main/board-bridge.ts` beyond the four RPC entries,
  coordinate with US-1468 rather than editing the US-1467-owned runner or lifecycle sections here.
- **Duplicated root canonicalization:** `src/main/board-protocol-service.ts:51-61` already derives
  the `board://` host from a normalized root. This task intentionally adds its own
  `src/main/board-root-key.ts` and leaves the live protocol service untouched; unifying the two
  helpers is a safe standalone follow-up, not part of unattended storage work.
- **Path traversal:** a crafted board root must never become a storage path segment. Hash only the
  canonical absolute root, validate `[0-9a-f]{64}`, and optionally assert the resolved storage
  path remains under `<data>/board-storage/` before every access. The board key is not user input.
- **Unbounded data:** a JSON store can otherwise grow on every `set`, consume disk/memory, and
  make each rewrite expensive. Enforce the 1 MiB whole-file limit, depth/key limits, validate
  before mutating the cache, and use async fs so the bounded rewrite does not block main. The limit
  is a contract decision, not a best-effort warning.
- **Concurrent frame/service writes:** asynchronous handlers can interleave and lose updates if
  each reads the file independently. The single main owner and per-board mutation queue are
  required. Last-writer-wins is intentional for the same key; there is no compare-and-swap or
  transaction API.
- **No broadcast:** this is safe because the board shim has no renderer-side storage snapshot and
  every operation is a main RPC. It means callers do not receive `onChange` notifications and an
  already-returned value is not reactive. Adding `openWindows.send()` or a second cache would be
  new scope and would need an event/version contract.
- **Moved boards:** renaming/moving a board changes the root digest, so the old storage becomes
  orphaned and the new location starts empty. This is accepted by D6. Do not alter
  `src/renderer/api/boards.ts` to migrate it in this task.
- **Trust is not a storage encryption boundary:** trusted board code already has arbitrary code
  execution. The folder prevents accidental mixing and keeps state out of board code, but it does
  not protect secrets from the trusted board or from a user with access to `<userData>`.
- **Durable-write errors:** unlike non-critical UI preferences, a successful `storage.set()` must
  mean the main owner persisted the new JSON. Reject I/O, parse, and quota failures so boards can
  handle them; do not copy `ui-preferences`'s silent write swallow for this explicit data API.
- **Uninstall/orphan policy:** `src/renderer/api/board-install.ts:126-154` removes an installed
  board's code directory but does not remove per-board data. This task deliberately leaves storage
  in place so reinstalling the same root resumes its state. The `board.json` sidecar makes future
  cleanup tooling or an orphaned-data report possible; automatic deletion and cleanup UI are out
  of scope.

## Acceptance Criteria

- [ ] A trusted board's first successful `storage.set()` creates
      `<userData>/data/board-storage/<board-key>/store.json` and a sibling `board.json` containing
      the absolute root, readable manifest name when available, and creation timestamp; no file is
      placed under `<userData>/data/boards/`.
- [ ] `<board-key>` is the full lowercase SHA-256 digest of the canonical absolute board root
      (`path.resolve`, slash-normalized, lowercased on Windows), never a manifest name; it matches
      across restarts and changes when the board root moves.
- [ ] The public API is exactly `storage.get`, `storage.set`, `storage.delete`, and
      `storage.keys` with the result semantics specified above; no `clear`, subscription, or whole
      store read is added.
- [ ] Only JSON values pass validation; malformed/oversized persisted data and invalid writes
      reject without replacing a valid cached state. The total serialized store is capped at 1 MiB.
- [ ] The main store is the single owner used by the frame RPC path, with one per-board mutation
      queue; concurrent same-key writes are deterministic last-writer-wins. US-1468 owns wiring
      the service adapter to this owner and observing the frame↔service round trip.
- [ ] An untrusted board receives no storage capability, and service storage requests are rejected
      by the service trust gate; no trust record or `trustedBoards.txt` format changes.
- [ ] No cross-window storage broadcast is sent. A later request sees the latest committed state,
      and this deliberate last-writer-wins policy is documented in the API comments.
- [ ] US-1466 supplies the shared `1.6.0` bridge version; this task adds `storage` to the shim
      without editing the version source or adding a field to `board-manifest.ts`.
- [ ] Existing board file RPCs, runner behavior, service lifecycle, install-directory behavior,
      and `board-vars.file` behavior remain unchanged.
- [ ] Uninstalling an installed board leaves its storage intact; reinstalling the same root can
      reuse it, and no automatic cleanup is added.
- [ ] `src/renderer/editors/board/board-api.d.ts` is updated; `assets/editor-types/` and
      `_imports.txt` remain unchanged unless implementation moves the declaration into the app
      script type tree.
- [ ] No unit tests or test harnesses are added; `npm run typecheck`, `npm run lint`, and
      `npm run build-prod` pass, followed by the live checks in Implementation Plan step 6.

## Files Changed Summary

| File | Planned change |
|------|----------------|
| `src/main/board-root-key.ts` | New canonical root normalization and full SHA-256 board-key helper. |
| `src/main/board-storage.ts` | New main-owned lazy JSON store, validation, quotas, path construction, and serialized mutations. |
| `src/ipc/board-bridge-channels.ts` | Add the four typed storage RPC method names and shared JSON-value wire types if needed. |
| `src/main/board-bridge.ts` | Add only the four storage entries to `boardRpcHandlers`; no runner or lifecycle edits. |
| `src/board-shim.ts` | Add `persephone.storage` wrappers; bridge-version ownership remains with US-1466. |
| `src/renderer/editors/board/board-api.d.ts` | Add board-facing storage types and JSDoc contract. |
| US-1468-owned service host adapter | No change in US-1469; consume this task's main-store contract and wire the service route there. |
| `assets/guides/agents/boards.md`, `assets/guides/boards.md`, `assets/board-template/CLAUDE.md` | No changes here; board-facing prose is US-1470 scope. |
| `assets/editor-types/_imports.txt` and `assets/editor-types/*.d.ts` | No changes under the preferred board-only declaration path. |
| `src/renderer/editors/board/board-manifest.ts` | **No change** — US-1466 owns manifest fields; this task adds none. |
| `src/main/board-protocol-service.ts` | **No change** — preserve the live `board://` origin and routing implementation. |
| `src/renderer/api/board-trust.ts` and `trustedBoards.txt` | **No change** — preserve the existing trust model and format. |
| `src/renderer/api/boards.ts` | **No change** — `data/boards` remains the install/code directory; no storage migration on move. |
| `src/renderer/api/board-install.ts` | **No change** — uninstall removes code only; storage is intentionally retained. |
| `src/renderer/api/board-vars/**` | **No change** — the global configurable `.env.json` store remains separate. |
