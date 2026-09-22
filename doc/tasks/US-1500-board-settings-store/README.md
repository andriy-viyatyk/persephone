# US-1500 — The board settings store and its board-facing API

Linked epic: [EPIC-111 — Board settings](../../epics/EPIC-111.md)  
Status: Planned

The Active Work Dashboard and EPIC-111 are intentionally unchanged: the epic already links this
task, and the request explicitly excludes `doc/active-work.md` and `doc/epics/EPIC-111.md`.

## Goal

Add a renderer-owned, plaintext `board-settings.json` store in the app data folder and expose the
read-only board API `persephone.settings.get(id)` plus change notifications. Settings are scoped to
the calling board's namespace, available without configuration or unlock UI, and delivered to every
mounted frame of that board.

The renderer-side store may set and unset values for the future Settings page, but the board-facing
surface has no `set`, `delete`, `list`, `show`, profile, or dialog operation.

## Background

### Settled epic decisions and current identity code

EPIC-111 S1, S2, S3, S7, S10, and S11 are requirements for this task, not open design questions:

- Persephone owns settings values. A board declares and reads them; it never writes its own
  settings (S1).
- Settings are separate from board vars and do not share `.env.json` or its configuration,
  encryption, unlock, or UI (S2).
- The single file is plaintext `<userData>/data/board-settings.json`, shaped as
  `{ "<namespace>": { "<settingId>": value } }` (S3).
- A board without both non-empty trimmed `author` and `name` is not settings-eligible. Its
  `persephone.settings.get()` call rejects with an error naming the missing field (S7).
- There is no additional trust check in the settings bridge. An untrusted board is rendered as
  `UntrustedBoardView` and never receives a `BoardWebview` frame, so reaching this host-frame bridge
  is the permission proof (S10).
- Stored namespace objects are retained when a board is untrusted, deleted, or disabled. No prune
  or administrator surface is added; reinstalling the same board identity restores its values (S11).

US-1499 is already implemented. The current shared resolver is
`src/renderer/api/board-namespace.ts:25-39`; `findNamespaceCollision()` is beside it, and
`hasStableBoardIdentity()` is `src/renderer/editors/board/board-manifest.ts:223-230`. Read the
comment at the top of `board-namespace.ts` before changing anything: `resolveBoardNamespace()` is
deliberately uncached because it reads the manifest on every call and must notice an identity edit.
US-1500 must call that resolver and must not add a namespace cache or a second identity algorithm.

### Board vars is the template, not the settings store

`src/renderer/api/board-vars/BoardEnvStore.ts:33-150` and
`src/renderer/api/board-vars/board-vars-bridge.ts:25-85` provide the pattern for a renderer-side
file store and bridge orchestration, but the verified differences require a sibling implementation:

- `BoardEnvStore` reads the configurable `board-vars.file` setting, treats an empty/missing file as
  `not-configured`, decrypts encrypted content, and may open a create/unlock dialog. Settings have
  one fixed path, are plaintext, are unlocked, and must work immediately on first run.
- Vars are namespace → profile → key → `string` (`src/renderer/api/board-vars/types.ts:11-17`).
  Settings are namespace → setting id → typed JSON scalar, with no profile level. Forcing the two
  shapes into one store would make either the type contract or the security/lifecycle behavior
  misleading.
- `BoardEnvStore` has `get`, `list`, `getAll`, and `set`, but no delete/unset operation anywhere.
  Settings need exactly one internal unset operation so the Settings page can reset a value to its
  current manifest default.
- The settings store must compute a default on every read when no user value is stored. It must
  never materialize the default into `board-settings.json`; a later board version can therefore
  change the default without a migration.

Resolution: create a sibling `BoardSettingsStore` using the same lazy model/parse/write/watch
pattern where it genuinely applies. Do not extract or rewrite `BoardEnvStore` in US-1500. The
shared seam is the existing `resolveBoardNamespace()` and the existing renderer file API, not a
literal shared store class.

### The missing-file and first-write behavior is now verified

`src/renderer/api/fs.ts:451-457` resolves the app data path, and `src/renderer/api/fs.ts:208-214`
plus `:531-532` show that the renderer file API writes through `_writeFile()`. That method calls
`_ensureDir(path.dirname(filePath))` before writing, so `app.fs.write()` creates the data folder
and `board-settings.json` when the file is absent.

By contrast, `TextFileModel.saveFile()` eventually writes through an existing `FileProvider`
(`src/renderer/editors/text/TextFileIOModel.ts:121-149` and
`src/renderer/content/providers/FileProvider.ts:22-31`); it does not provide the missing-file
bootstrap contract. The settings store must therefore treat a missing file as an in-memory empty
store and bootstrap the first write with `app.fs.write()`. Once the file exists, the store may keep
the text-file model/pipe alive for its existing file-watch behavior. No direct `require("path")` or
`require("fs")` may be added; use `src/renderer/core/utils/file-path.ts` and `src/renderer/api/fs.ts`.

### Host-frame transport and the multiple-frame requirement

The `persephone.var.*` path is not the main-process port. The board shim posts `board:var` to
`window.parent` (`src/board-shim.ts:396-410`), `BoardWebview.handleMessage()` dispatches it at
`src/renderer/editors/board/BoardWebview.ts:543-553`, and the renderer replies directly to the
calling frame with `var:result` at `:984-1004`. The namespace is resolved in that renderer method
from `this.props.boardRoot` (`:995`), not accepted from board arguments. Settings must preserve
that exact property with a separate settings message/reply type.

The same host-frame channel already carries unsolicited renderer-to-board messages such as
`state:sync` (`BoardWebview.ts:407-414`), toolbar controls, and navigation returns. A settings
change is another host-frame push; no main-process port or new IPC channel is needed.

A board has more than one frame. The main view is created by `BoardHostView` in
`src/renderer/editors/board/BoardEditorView.ts:74-116`. Each declared secondary view creates a
separate `BoardWebview` in `src/renderer/editors/board/BoardSecondaryView.ts:135-149`. Each
`BoardWebview` has its own `iframe`, `tabId`, message listener, lifecycle, and
`startHostResources()` call; `BoardEditorModel.frames` stores the live elements keyed by `"main"`
and `board-secondary:<viewId>` (`BoardEditorModel.ts:193-197,242-263`). A subscription owned only
by the main view would be a defect. The implementation must attach the store-change subscription
inside every `BoardWebview` instance and post to that instance's current `iframe`, without an
`isMain` condition.

### Public bridge declarations and versioning

The runtime board object is assembled in `src/board-shim.ts:1251-1775`; its legacy authoring
declaration is `src/renderer/editors/board/board-api.d.ts:352-449`. The wire types for host-frame
messages are in `src/ipc/board-bridge-channels.ts:351-454,578-601`. The current bridge version is
`1.12.0` in `src/shared/board-bridge-version.ts:2`; adding `persephone.settings` bumps it to
`1.13.0` and the shim's version comment must describe the new API.

The board API declaration is a board-only legacy file, not a `src/renderer/api/types/*.d.ts` file,
so its change does not require an `assets/editor-types/` copy or `_imports.txt` entry. Verify this
boundary before adding any new script-facing declaration.

## Implementation Plan

### 1. Define the settings value and file contracts

- Add `src/renderer/api/board-settings/types.ts` with the typed scalar union used by persisted
  settings (`string | boolean | number`, with finite numbers only), the one-level
  `BoardSettingsFile` shape, change-event data, and the normalized board-setting declaration type
  that the bridge and the later Settings renderer share.
- Keep the persisted value contract JSON-safe. Do not add `null`, arrays, objects, profiles, or
  arbitrary values merely because JSON can carry them; the settled manifest types are
  `string`, `boolean`, `number`, and `enum` (where enum values are strings).
- Keep declaration normalization at one seam. US-1500 needs a bridge-readable declaration lookup
  for id/default/type validation; US-1501 will own the complete `normalizeBoardSettings()` path,
  including S5's `format` handling and S7 identity-first diagnostics. The US-1500 bridge must call
  that seam rather than parse settings independently in `BoardWebview`.

Before → after for the file shape:

```json
// Before: no board-settings.json exists

// After: one renderer-owned plaintext file
{
  "Persephone/Excalidraw": {
    "library-path": "C:/Libraries/excalidraw"
  }
}
```

### 2. Implement the renderer-owned store

- Add `src/renderer/api/board-settings/BoardSettingsStore.ts` and export one renderer-lifetime
  singleton through `src/renderer/api/board-settings/index.ts`.
- Resolve the fixed path only through `fs.resolveDataPath("board-settings.json")` after the file API
  is initialized. There is no setting controlling the path and no path-change reset listener.
- Load lazily. Missing file means `{}` and an `ok`/empty state; it must not report
  `not-configured`, open a dialog, or create the file merely because a board read occurred.
  Existing malformed JSON returns a readable store error and must not silently discard the file.
- On the first successful set/unset write, serialize the whole object as human-readable plaintext
  JSON and call `fs.write()`. This is the verified path that creates the missing file and its parent
  folder. Keep later writes on the same API path so directory creation remains safe.
- Maintain parsed state and a file watch using the existing text-file/content-pipe pattern only
  after the file exists. External edits must be re-read, validated, diffed against the previous
  parsed state, and emitted through the same change-event fan-out as renderer writes. Use
  `errMessage(error)` for caught values.
- Provide renderer-only operations equivalent to `get(namespace,id)`, `set(namespace,id,value)`,
  `unset(namespace,id)`, and `onChanged(callback)`. `unset` removes only the requested setting key;
  if that leaves an empty namespace object, remove that empty object. It must not prune other
  namespaces or scan for orphaned boards (S11).
- Serialize reads/mutations and external reload handling on one store queue so two Settings-page
  writes cannot overwrite each other's parsed state. Notify only after a successful persisted
  mutation/reload, and make reset emit the effective post-reset value after the bridge resolves the
  current default.
- Do not modify `BoardEnvStore.ts`, its `board-vars.file` behavior, encryption, profiles, or
  bridge request chain. The settings store is a sibling with a shallower typed shape.

Before → after for the missing-file branch:

```ts
// Before: BoardEnvStore treats a missing configured file as unavailable.
if (!(await fs.exists(path))) return { status: "not-configured" };

// After: board settings treat it as an empty store and create only on write.
if (!(await fs.exists(filePath))) {
    this.parsed = {};
    return;
}
// A first set/unset persists with fs.write(filePath, serialized), which creates the file.
```

### 3. Add the renderer settings bridge orchestration

- Add `src/renderer/api/board-settings/board-settings-bridge.ts` with a serialized
  `resolveBoardSettingsRequest(boardRoot, method, args)` entry point and a per-frame change
  subscription helper.
- Accept only the board-facing method `get`. Validate the setting id, read the current manifest
  declaration/default through the shared declaration seam, and resolve the namespace from the
  calling `boardRoot` in the renderer. Never accept a namespace or root from `args`.
- Before namespace resolution, call `readBoardManifest(boardRoot)` and
  `hasStableBoardIdentity(manifest)`. If `author` is missing/blank/non-string, reject with a
  message naming `author`; if `name` is missing/blank/non-string, reject with a message naming
  `name`; if both are absent, name both fields. Do not allow the resolver's root fallback to make
  an ineligible board appear settings-capable.
- For a known declared id, return the stored value when present; otherwise return that declaration's
  current `default` from the manifest. Do not write that default into the file. Unknown ids and
  malformed declaration values must reject with a readable error rather than being confused with an
  unset user value.
- Expose a renderer-only write path for the future Settings page: set a typed value or unset the
  stored key. It must validate against the declaration/type contract, persist through the store,
  and emit one change event. There is intentionally no corresponding board request method.
- Expose `subscribeBoardSettings(boardRoot, callback)` for `BoardWebview`. It filters store events
  to the board's namespace and declared ids, and resolves the current effective value (including a
  default after unset) before invoking the callback. Do not add a namespace cache to
  `board-namespace.ts`; the existing resolver remains deliberately uncached.

Before → after for the board/renderer capability split:

```ts
// Before: the vars bridge exposes a board write operation.
method: "get" | "set" | "list" | "show";

// After: renderer UI mutates the store; the board only reads.
method: "get";
// Renderer-only: boardSettings.set(...) / boardSettings.unset(...)
```

### 4. Add typed host-frame request/reply and push messages

- In `src/ipc/board-bridge-channels.ts`, add a `"board:settings"` member to `BoardToHostMsg`, a
  `settingsMethod: "get"` and `settingsArgs` payload, and a `BoardSettingsResultMsg` carrying
  `reqId`, `result`, and `error`. Add a separate `BoardSettingsChangedMsg` carrying the setting id
  and effective typed value, and include both new messages in `BoardHostFrameMsg`.
- Keep this renderer host-frame protocol separate from `MainToBoard`/`BoardRpcMethod`. Settings
  requests must not cross the main-process port.
- In `src/renderer/editors/board/BoardWebview.ts`, add the `board:settings` dispatch beside the
  existing `board:var` arm. Its resolver must use `this.props.boardRoot`, `errMessage` for caught
  values, the current frame generation/liveness checks, and `frame.contentWindow.postMessage()` to
  reply. Do not add `isBoardPermitted()` to this path; the existing branch/frame construction and
  host origin/source checks are S10's trust boundary.
- In every `BoardWebview.startHostResources()` instance, subscribe to the settings bridge and post
  `settings:changed` to that instance's iframe. Guard the callback with `live`, `host`, current
  generation, and `model.frames.get(this.tabId) === frame`. The callback must not be restricted to
  `isMain`; main plus every mounted `board-secondary:<viewId>` frame must receive the push.
- Dispose that subscription with the existing `onDispose()` lifecycle so a replaced secondary view
  cannot receive a later change. A new/reloaded frame reads its current values through `get()`.

Before → after for frame fan-out:

```ts
// Before: shared-state delivery is one BoardWebview instance → its own iframe.
const frame = this.iframe;
frame?.contentWindow?.postMessage(message, targetOrigin);

// After: the same per-instance delivery is installed in every BoardWebview.
// BoardEditorModel.frames contains "main" and board-secondary:<viewId>; no isMain filter.
for (const mountedFrame of everyBoardWebviewInstance) {
    mountedFrame.contentWindow?.postMessage(settingsChanged, targetOrigin);
}
```

The implementation should use the existing per-instance subscription rather than inventing a
second global frame registry; `BoardSecondaryView` already creates and disposes the instances that
own the frame map entries.

### 5. Expose `persephone.settings` in the board shim

- In `src/board-shim.ts`, add a pending-request map/counter and `settingsRpc()` that posts
  `{ __persephone: "board:settings", reqId, settingsMethod: "get", settingsArgs: [id] }` to
  `window.parent` using the existing `hostPostTarget`.
- Add an `onHostMessage` listener for `settings:result`; reject when `error` is present, exactly as
  the existing `var:result` handler does (`board-shim.ts:1076-1087`). This is how a missing S7
  identity field becomes a rejected Promise inside the board frame.
- Add an `onHostMessage` listener for `settings:changed`; validate its id/value shape and invoke
  registered callbacks. Catch callback failures with the existing board-shim error-reporting
  convention so one board listener cannot prevent later listeners.
- Expose only:

  ```ts
  persephone.settings.get(id: string): Promise<string | number | boolean>;
  persephone.settings.onChange(
      callback: (change: { id: string; value: string | number | boolean }) => void,
  ): () => void;
  ```

  `onChange` returns a disposer like `persephone.state.onChange`. The callback receives effective
  values, so unsetting a user value notifies the board with the declaration's current default.
  There is no board-side `set`, `unset`, `list`, `show`, or `profiles` member.
- Keep the board shim browser-only. No Node filesystem or path module is added.
- Update `src/renderer/editors/board/board-api.d.ts` with matching `PersephoneSettingValue`,
  `PersephoneSettingsChange`, `PersephoneSettingsApi`, and `readonly settings` declarations. Keep
  the JSDoc explicit that values are user-owned, defaults are read-time, calls are board-scoped,
  and a missing stable identity rejects naming `author`/`name`.

Before → after for the public board surface:

```ts
// Before (src/renderer/editors/board/board-api.d.ts)
readonly var: PersephoneVarApi;
readonly storage: PersephoneStorageApi;

// After
readonly var: PersephoneVarApi;
readonly settings: PersephoneSettingsApi;
readonly storage: PersephoneStorageApi;
```

### 6. Bump the bridge version and preserve compatibility checks

- Change `src/shared/board-bridge-version.ts:2` from `"1.12.0"` to `"1.13.0"`.
- Update the version-history comment in `src/board-shim.ts:1254-1265` and the matching board API
  declaration comment to identify `persephone.settings.get()` and `onChange()` as the 1.13.0
  addition.
- Boards using this API should declare `minBridgeVersion: "1.13.0"` when their manifest declaration
  is added by US-1501. Do not add or normalize the manifest `settings` field in US-1500; that
  declaration/rendering work belongs to US-1501, but the bridge version contract must be ready for
  it.
- Do not change `src/renderer/editors/board/custom-editor-registry.ts`'s compatibility algorithm;
  it already compares manifest `minBridgeVersion` with `BOARD_BRIDGE_VERSION` at the registry
  boundary (`:272-280,330-334`).

### 7. Keep the manifest and Settings-page handoff unambiguous

- The bridge must use one declaration lookup seam shared with US-1501. `normalizeBoardSettings()`
  will validate stable identity before the settings array, drop an ineligible declaration with a
  registration issue, and degrade an unknown `format` to the base control; US-1500 must not create
  a second parser in `BoardWebview`.
- The future Settings page will call the renderer-only store mutation methods. It must render
  declared settings, not every key found in `board-settings.json`; this is why US-1500 deliberately
  does not expose a board-facing `list()`.
- Defaults stay outside the file. The only persisted values are explicit user choices. `unset` is
  the reset-to-default operation and is not an uninstall/prune mechanism.

### 8. Guide update inventory (names and topics only)

The implementation follow-up must update these guides; this task document deliberately does not
write their prose:

- `assets/guides/boards.md` — user-facing board API and manifest compatibility reference:
  `persephone.settings`, read-time defaults, no board writes, stable identity errors, and bridge
  version 1.13.0.
- `assets/guides/agents/boards.md` — agent board-authoring/API reference and bridge version history,
  including the all-frame `onChange` behavior and `minBridgeVersion` guidance.
- `assets/board-template/CLAUDE.md` — copied board-authoring guide, with the same manifest and
  `persephone.settings` contract.

Do not update these guide files while creating this task document, and do not add guide prose to
this README beyond the inventory above.

### 9. Verify without tests, harnesses, or a commit

- Do not add unit tests, test harnesses, fixtures, or a test-only bridge.
- Inspect the fixed path and first-write behavior with a missing `<userData>/data/board-settings.json`:
  a read returns the manifest default without creating the file; a renderer/UI set creates exactly
  that one file; a reset removes the setting key and returns the current default.
- Inspect persistence across renderer restart and bundled-board reinstall/path change. Values under
  the same stable `<author>/<name>` or bundled namespace remain available; orphaned namespaces are
  retained and never listed by a board API.
- Exercise a board with missing `author`, missing `name`, and both missing. Each `get()` rejects in
  the board frame, and each message names the missing manifest field. Confirm no untrusted board
  reaches a `BoardWebview`.
- With a main frame and at least one declared secondary view mounted, change a setting through the
  renderer path and verify both frames receive one `settings:changed` push. Repeat with an external
  file edit to confirm it uses the same store fan-out.
- Confirm a board cannot supply another namespace, no main-process port is used, no dialog appears,
  and no settings `set` message is accepted from the board.
- Run the repository's ordinary type/lint/build verification appropriate to the implementation,
  but do not add a test harness and do not commit.

## Concerns

No product decisions remain open for US-1500. The following implementation hazards are resolved
constraints:

1. **Do not force a shared store abstraction.** The vars store has configuration, encryption,
   profiles, no delete, and no change event; settings have a fixed plaintext file, typed one-level
   values, unset, and fan-out. A sibling is cheaper and clearer. Shared only the proven patterns
   and existing identity/path utilities.
2. **Do not reintroduce the vars missing-file state.** Missing settings storage is a normal first
   launch. `fs.write()` is the verified first-write path; `TextFileModel.saveFile()` alone is not.
3. **Do not materialize defaults.** A stored key means the user chose a value. An absent key means
   resolve the current manifest default at read/push time, so a board update can change it.
4. **Do not add a namespace cache.** `resolveBoardNamespace()` is deliberately uncached in the
   already-landed US-1499 implementation. Per-call renderer binding is part of the board isolation
   property; a new cache would make identity edits stale.
5. **Do not fan out only from the main frame.** `BoardWebview` is one instance per main/secondary
   frame, and `BoardEditorModel.frames` is keyed by each view. Every live instance needs the same
   store subscription and stale-frame guards.
6. **Do not add a trust gate to the new request.** The host already checks board origin and source;
   untrusted boards have no frame. Adding a second, different gate would contradict S10. Disabled
   bundled-board display is a later Settings-page registry concern, not a bridge permission rule.
7. **Do not turn settings into vars.** No profiles, `set`, `show()` opening raw JSON, dialog-on-
   demand, or stored-key `list()` are copied. The renderer Settings page is the only mutation UI.
8. **Keep orphaned values.** Untrusting, disabling, deleting, or reinstalling a board does not
   prune its namespace. Stable identity is what makes reinstall restoration reliable.
9. **Preserve error hygiene.** All caught values become messages through `errMessage`; path work
   uses `file-path`, and file work uses `api/fs`. No new direct Node `path`/`fs` requires are allowed.

## Acceptance Criteria

- [ ] `board-settings.json` is one renderer-owned plaintext file under the app data folder with the
      exact namespace → setting-id → typed-value shape; it is not `settings.json`, `.env.json`, or
      per-board `board-storage` data.
- [ ] A missing file loads as an empty store and is not created by a read. The first successful
      renderer/UI set or unset uses `app.fs.write()` and creates the file and parent directory.
- [ ] Existing malformed JSON rejects with a readable error; caught values use `errMessage`; no
      direct `require("path")` or `require("fs")` is introduced.
- [ ] Renderer-only store operations support typed set and exactly one-key unset/reset. There is no
      store profile level, encryption, unlock state, configuration setting, prune operation, or
      administrator UI.
- [ ] Defaults are resolved at read/push time and never materialized into the file. Reset removes
      the explicit value and reports the current manifest default.
- [ ] `persephone.settings.get(id)` and `persephone.settings.onChange(callback)` are the complete
      board-facing settings surface. There is no board-facing `set`, `unset`, `list`, `show`, or
      profile API.
- [ ] Namespace resolution is renderer-side from the calling frame's `boardRoot` through the
      uncached `resolveBoardNamespace()` implementation. A board cannot supply or select a second
      namespace.
- [ ] A request from a board lacking stable `author` or `name` rejects inside that board frame, and
      the error names the missing field(s). No new trust gate is added; an untrusted board has no
      frame/bridge.
- [ ] `settings:changed` uses the existing host-frame `postMessage` channel and reaches the main
      frame plus every mounted secondary-view frame. Disposed/replaced frames receive no later push.
- [ ] External edits and renderer writes use the same store change fan-out; callbacks receive the
      effective typed value, including the default after reset.
- [ ] `src/shared/board-bridge-version.ts` is bumped from 1.12.0 to 1.13.0, with matching shim and
      declaration comments and `minBridgeVersion` guidance for consumers.
- [ ] The three guide files named in Implementation Plan step 8 are identified for later prose
      updates; no guide prose, `doc/active-work.md`, or `doc/epics/EPIC-111.md` is changed here.
- [ ] No unit tests, test harnesses, or commit are added by this task.

## Files Changed Summary

| File | Planned change |
|---|---|
| `src/renderer/api/board-settings/types.ts` | New typed setting value, declaration, file, and change-event contracts. |
| `src/renderer/api/board-settings/BoardSettingsStore.ts` | New fixed-path plaintext store with lazy empty-file behavior, set/unset, parse/write, watch, and change fan-out. |
| `src/renderer/api/board-settings/board-settings-bridge.ts` | New renderer-side board-root binding, stable-identity errors, read/default resolution, UI mutation seam, and subscriptions. |
| `src/renderer/api/board-settings/index.ts` | Export the settings store/bridge surface for renderer consumers. |
| `src/ipc/board-bridge-channels.ts` | Add typed settings request, reply, change-push, and host-frame union members. |
| `src/renderer/editors/board/BoardWebview.ts` | Dispatch settings reads and subscribe/post changes for every main/secondary frame instance. |
| `src/board-shim.ts` | Add `persephone.settings.get()` and `onChange()` over the host-frame channel. |
| `src/renderer/editors/board/board-api.d.ts` | Declare the board-facing settings value/change/API types. |
| `src/shared/board-bridge-version.ts` | Bump bridge version from 1.12.0 to 1.13.0. |
| `assets/guides/boards.md` | Guide prose required after implementation; not written in this task document. |
| `assets/guides/agents/boards.md` | Guide prose required after implementation; not written in this task document. |
| `assets/board-template/CLAUDE.md` | Copied authoring-guide prose required after implementation; not written in this task document. |
| `src/renderer/api/board-namespace.ts` | **No change:** current uncached US-1499 resolver is reused exactly. |
| `src/renderer/editors/board/board-manifest.ts` | **No change in US-1500:** settings declaration normalization/rendering is US-1501 scope. |
| `src/renderer/api/board-vars/BoardEnvStore.ts` | **No change:** configurable encrypted profile-based vars store remains separate. |
| `src/renderer/api/board-vars/board-vars-bridge.ts` | **No change:** vars transport remains independent and retains its own methods/dialog behavior. |
| `src/main/board-bridge.ts` and `src/ipc/board-bridge-channels.ts` main-port/RPC path | **No main-process settings RPC:** only the host-frame wire types in `board-bridge-channels.ts` change. |
| `assets/editor-types/*.d.ts` and `assets/editor-types/_imports.txt` | **No change:** the board declaration is outside the script type-copy pipeline. |
| `doc/active-work.md` | **No change:** explicitly excluded; US-1500 is already linked from EPIC-111. |
| `doc/epics/EPIC-111.md` | **No change:** explicitly excluded; S1/S2/S3/S7/S10/S11 are settled. |
| Unit-test files, harnesses, and generated release copies | **No change:** explicitly excluded. |
