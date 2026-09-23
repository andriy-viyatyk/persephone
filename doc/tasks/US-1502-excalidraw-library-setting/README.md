# US-1502 — Excalidraw's library path becomes a board setting

Linked epic: [EPIC-111 — Board settings](../../epics/EPIC-111.md)  
Status: Planned

The dashboard entry and epic task table already link US-1502. They are intentionally unchanged:
this task request explicitly forbids editing `doc/active-work.md` and `doc/epics/EPIC-111.md`.

## Goal

Move Excalidraw's user-configurable library folder from Persephone's app-settings UI into the
bundled Excalidraw board's declared `library-path` setting, while preserving the existing library
file in place. Migrate an explicitly configured legacy path once, keep the unset case as a true
no-op, and remove the app-owned key/UI/catalog ownership without changing `drawLibrary.ts`.

## Background

### Epic decisions and current API

EPIC-111 S5 defines a board setting as a typed declaration plus an optional display format. The
required declaration is `string` + `folderPath`, with a string default and user-facing label and
description. `normalizeBoardSettings()` in
[`src/renderer/editors/board/board-manifest.ts`](../../../src/renderer/editors/board/board-manifest.ts)
already validates the declaration, requires stable `author` + `name`, and preserves `format` in
the normalized declaration. It does not need a new type or normalization change for this task.

EPIC-111 S6 removes `drawing.library-path` as an app setting and makes the board read
`library-path` through the already-landed `persephone.settings.get()` surface. The current board
settings bridge is renderer-owned and namespaced by `resolveBoardNamespace()`. A missing stored
value returns the manifest default without writing that default to `board-settings.json`;
`BoardSettingsSectionView` already binds a `string` + `folderPath` declaration to the renderer-only
get/set/unset bridge.

The bundled manifest already has the required stable identity:

```json
"name": "Excalidraw",
"author": "Persephone"
```

Therefore its settings namespace is `Persephone/Excalidraw` under the current
`resolveBoardNamespace()` implementation. The board settings declaration should be:

```json
{
  "id": "library-path",
  "type": "string",
  "format": "folderPath",
  "label": "Library folder",
  "description": "Folder for Excalidraw library items (reusable shapes)",
  "default": ""
}
```

The empty declaration default is deliberate. The board's existing `resolveLibraryPath()` falls
back to `<userData>/data/excalidraw-lib`; the default must remain an empty board-setting value so
the board, rather than Persephone, owns that Excalidraw-specific fallback.

### Current board read and persistence behavior

[`assets/boards/excalidraw/index.html`](../../../assets/boards/excalidraw/index.html) currently
reads the app setting in `resolveLibraryPath()` and appends
`library.excalidrawlib`. `loadLibrary()` reads the JSON and returns its `libraryItems`; the save
path writes the complete `{ libraryItems }` wrapper. The path resolver itself does not move or
rewrite a library file.

Before → after for the board read:

```js
// Before: the board reaches into the renderer's application Settings catalog.
const configuredDir = await persephone.call("settings.get", {
    args: ["drawing.library-path"],
});
if (typeof configuredDir === "string" && configuredDir.trim() !== "") {
    return libraryFilePath(configuredDir);
}

// After: the board reads its own declared setting; the existing fallback is unchanged.
const configuredDir = await persephone.settings.get("library-path");
if (typeof configuredDir === "string" && configuredDir.trim() !== "") {
    return libraryFilePath(configuredDir);
}
```

The fallback remains:

```js
const userData = await persephone.call("fs.commonFolder", { args: ["userData"] });
return libraryFilePath(`${userData}/data/excalidraw-lib`);
```

`src/board-shim.ts` already exposes `persephone.settings.get()` and the current bridge version
already includes the EPIC-111 settings surface. No new board transport, declaration, or shim
work is needed here.

### Legacy app setting and the required migration

`src/renderer/api/settings.ts` currently merges persisted JSON5 content over its defaults, exposes
a generic `get(key: string)` overload, and saves the whole in-memory settings object. Removing
`drawing.library-path` from `AppSettingsKey`, `settingsComments`, and the default state means an
old persisted value remains readable through the generic overload, while an actually absent key
returns `undefined`. The migration can therefore read the old value without restoring it as an
app-setting declaration.

The migration belongs in the renderer-side board-settings bridge, immediately before the effective
Excalidraw `library-path` read or renderer-only mutation. It must be narrowly identified by the
resolved namespace `Persephone/Excalidraw` and id `library-path`, and serialized/idempotent:

1. If the board setting already has an explicit stored value, do nothing; a user reset or choice
   must never be overwritten by a later legacy read.
2. Await `settings.wait()` and read the legacy value with the existing generic settings API.
3. If the legacy value is a non-empty string, persist that exact string once as the board setting.
   Do not move, copy, parse, normalize, or rewrite `library.excalidrawlib`.
4. If the legacy value is absent or empty, do not write `board-settings.json`; the declaration
   default continues to select `<userData>/data/excalidraw-lib`.
5. Leave the old persisted app value in place during this task. This is required because
   `src/renderer/editors/draw/drawLibrary.ts` still reads and writes `drawing.library-path` until
   EPIC-110 removes `editors/draw`. The old key is removed from current typed/default/UI/catalog
   ownership, but its legacy persisted value is not deleted while an unchanged consumer remains.

The migration is one-time in behavior: a successfully copied non-empty value is present in the
board store, so later renderer starts skip the legacy copy. An absent/empty legacy value causes no
write; repeating that harmless read on a later start cannot alter the board setting or library.

The three required cases are explicit:

| Legacy `drawing.library-path` state | Board-setting migration | Resolved library and file effect |
|---|---|---|
| Unset — the measured state of this user | Do not create `library-path` in `board-settings.json`; do not write `appSettings.json`. | The board's empty default resolves to `<userData>/data/excalidraw-lib`; nothing moves and `library.excalidrawlib` is not rewritten. |
| Explicitly set to `<userData>/data/excalidraw-lib` | Store that exact path as the board setting once. | The board resolves the same folder before and after; no library file is moved or rewritten. The legacy value remains available to unchanged `drawLibrary.ts`. |
| Explicitly set to another custom folder | Store that exact custom path as the board setting once. | The board continues reading the existing custom-folder library; no file is moved, copied, deleted, or rewritten. |

For an old explicit empty-string reset, treat it like the unset/default case: leave the board key
absent and use the board declaration default. Do not turn an empty legacy value into a stored
empty string, because absence is what keeps the board default live for future manifest changes.

### Built-in Drawing editor between this task and EPIC-110

`src/renderer/editors/draw/drawLibrary.ts` is deliberately left alone. It currently calls
`settings.get("drawing.library-path")` and `settings.set("drawing.library-path", dir)`:

- Removing the app key's typed declaration, description, and default does not remove the generic
  runtime `settings.get/set(string, ...)` behavior. With no old persisted value, the unchanged
  `initDefaultLibraryPath()` still creates the existing default directory and writes the legacy
  path value, then `createLibraryAdapter()` reads that value as before.
- If a user had a custom legacy path, the migration copies it to the board setting but deliberately
  leaves the legacy persisted value available, so the unchanged built-in editor keeps using that
  custom folder until EPIC-110 removes `editors/draw`.
- The Drawing Library app Settings section disappears, so changing the path is owned by the
  Excalidraw board Settings panel. The built-in editor continues using its compatibility value;
  there is no library-data break before EPIC-110, but the old app key can be repopulated by the
  unchanged built-in initializer during this transition.

Because `drawLibrary.ts` is not changed, removing `drawing.library-path` from the typed key union
would otherwise make its inferred generic `settings.get()` result `unknown` at `fpJoin()`. Keep
that existing consumer compiling by changing only the arbitrary-string overload's default generic
from `unknown` to `any`, matching the public `ISettings` declaration; this does not re-add the
legacy key to `AppSettingsKey`, its default, its description, or any catalog.

## Implementation Plan

### 1. Declare the Excalidraw board setting

Edit `assets/boards/excalidraw/board-manifest.json` and add a top-level `settings` array using the
S5 declaration above. Keep the existing `author`, `name`, capabilities, file mask, content-host
editor declaration, and generated `lib/` untouched. The declaration's `default` stays `""`; it is
not the absolute fallback path.

Before → after:

```json
// Before: no settings declaration.
"author": "Persephone",
"permissions": ["capabilities"],

// After: one board-owned, folder-rendered declaration.
"author": "Persephone",
"settings": [
  {
    "id": "library-path",
    "type": "string",
    "format": "folderPath",
    "label": "Library folder",
    "description": "Folder for Excalidraw library items (reusable shapes)",
    "default": ""
  }
],
"permissions": ["capabilities"],
```

No `minBridgeVersion` change is needed: this board consumes the already-present settings bridge.

### 2. Read the board setting and retain the fallback

In `assets/boards/excalidraw/index.html`, change only `resolveLibraryPath()`'s setting read from
`persephone.call("settings.get", { args: ["drawing.library-path"] })` to
`persephone.settings.get("library-path")`. Keep the existing non-empty-string check, the
`fs.commonFolder` call, the user-data validation, `libraryFilePath()`, `loadLibrary()`, and
`saveLibrary()` behavior unchanged.

Do not regenerate or edit `assets/boards/excalidraw/lib/**`; it is generated and committed, and
this change is in the board entry point rather than the vendor bundle.

### 3. Add a narrow, one-time legacy migration to the existing bridge

Update `src/renderer/api/board-settings/board-settings-bridge.ts`:

- Import the existing renderer `settings` object.
- Add a serialized/idempotent migration helper scoped to namespace
  `Persephone/Excalidraw` and declaration id `library-path`.
- Run it after `resolveDeclaration()` has validated the board and before
  `readEffectiveBoardSetting()` reads the stored value. Also run it before renderer-only
  `setBoardSetting()`/`unsetBoardSetting()` operations so a fast Settings-page action cannot
  race an unobserved legacy value.
- Check `boardSettings.get(namespace, "library-path")` first. An explicit stored value, including
  an explicit empty string created by a future user action, wins over legacy data.
- Await `settings.wait()`, read `settings.get<string | undefined>("drawing.library-path")`, and
  only call `boardSettings.set()` for a non-empty string. Never call `settings.set()` from the
  migration, so the unset case is a genuine no-op and the legacy value remains available to
  `drawLibrary.ts`.
- Serialize concurrent calls through one migration promise and let the existing board-settings
  request/store queues provide persistence ordering. A failed migration must surface through the
  existing `errMessage` error path and must not cause a library-file operation.

Before → after:

```ts
// Before: effective reads only consult the board-settings namespace.
const stored = await boardSettings.get(namespace, declaration.id);
return stored === undefined ? declaration.default : stored;

// After: Excalidraw gets one guarded legacy seed, then the same default-aware read.
await migrateLegacyExcalidrawLibraryPath(namespace, declaration);
const stored = await boardSettings.get(namespace, declaration.id);
return stored === undefined ? declaration.default : stored;
```

The helper must not be generalized into app-setting migration infrastructure: this is the one
Excalidraw compatibility case, and the board settings store must remain the source of truth after
the first successful seed.

### 4. Remove app-setting ownership and its built-in Settings surface

Make the following exact removals:

- `src/renderer/api/settings.ts`: remove `"drawing.library-path"` from `AppSettingsKey`, remove
  its `settingsComments` description, and remove its `defaultAppSettingsState` entry. Change only
  the arbitrary-string `get<T = unknown>` overload to `get<T = any>` so unchanged `drawLibrary.ts`
  continues to type-check when it reads the now-untyped legacy key.
- `src/renderer/editors/settings/sections/SettingsSections.ts`: delete
  `DrawingLibrarySectionView`, including its old app-setting read/subscribe/browse/reset callbacks,
  and remove its export alias. Keep `LibraryPathSectionView` itself because
  `BoardSettingsSectionView` uses it for the board's `string` + `folderPath` declaration.
- `src/renderer/editors/settings/SettingsView.ts`: remove the `DrawingLibrarySectionView` import
  and the `"drawing-library"` entry from `SECTION_VIEW_FACTORIES`; otherwise the catalog would
  name a view that no longer exists.
- `src/renderer/editors/settings/settings-catalog.ts`: remove the entire `drawing-library`
  section, including its `drawing.library-path` row. The section cannot remain after its view is
  removed.

The app-side surface changes from an app-owned row to the runtime board panel:

```ts
// Before: static app catalog entry.
{ key: "drawing.library-path", label: "Drawing library path", purpose: "..." }

// After: no static app row; the Excalidraw manifest supplies the dynamic row.
// BoardSettingsSectionView reads the normalized "library-path" declaration.
```

`src/renderer/scripting/ai-vision/namespaces/settings.ts` has no literal
`drawing.library-path` row in the current source. Its `SETTINGS_ELEMENTS` is derived from
`SETTINGS_CATALOG`, so removing the catalog section removes the AI-vision element transitively;
do not add a duplicate manual edit to that namespace.

### 5. Keep the already-landed board settings renderer/API unchanged

Use the current US-1497–US-1501 API as-is:

- `src/renderer/editors/settings/sections/BoardSettingsSection.ts` already uses
  `getBoardSetting`, `setBoardSetting`, `unsetBoardSetting`, and
  `subscribeBoardSettings`; its `string` + `folderPath` branch already provides browse/reset.
- `src/renderer/api/board-settings/BoardSettingsStore.ts` already persists typed scalar values in
  renderer-owned `board-settings.json`, keeps defaults out of the file, and emits changes.
- `src/renderer/editors/board/board-manifest.ts` already normalizes `format: "folderPath"` and
  enforces stable identity.
- `src/board-shim.ts` already exposes the board-facing `settings.get()` RPC and current bridge
  version.

The Excalidraw panel will therefore appear under the existing dynamic board placement for the
`Editors` group because its manifest has `fileMasks`/editor association. No static app catalog row
or board-specific Settings component is needed.

### 6. Verify the migration without touching the user's library

Before implementation verification, record the current library file read-only:

- path: `<userData>/data/excalidraw-lib/library.excalidrawlib`;
- parsed `libraryItems.length`: **31**;
- byte size: **352534**.

After implementation, open the Excalidraw board and Settings panel without importing, editing,
saving, deleting, or rewriting any library item. Read the same file again and require exactly 31
items and exactly 352534 bytes. The verification must not use a cleanup step that deletes or
rewrites the user's `library.excalidrawlib`.

Also verify, read-only where possible:

- with the measured unset app setting, no `library-path` key is materialized in
  `board-settings.json`, no app-settings write is caused by migration, and the board resolves the
  same fallback folder;
- with an explicit legacy default path, the board setting stores the same path and both before/after
  resolutions point to the same folder;
- with an explicit custom legacy path, the board setting stores the same custom path and the board
  reads that existing folder;
- repeated board loads do not copy the legacy value a second time or alter the library file;
- `drawLibrary.ts` remains unmodified and the built-in editor still reads/writes its compatibility
  app key until EPIC-110 removes it.

No unit test, harness, generated-board rebuild, or commit is part of this task.

## Concerns / Resolved constraints

1. **Data-loss boundary:** the migration only changes the setting location. It never moves,
   copies, deletes, parses-and-reserializes, or saves `library.excalidrawlib`. Before/after item
   count and byte-size checks are mandatory.
2. **Unset must remain unset:** after removing the app default, an absent legacy key reads as
   `undefined`. Do not persist an empty board value or a computed default path for this case; the
   board's own empty default must continue resolving the current user-data fallback.
3. **Explicit default versus custom:** both are copied as exact non-empty strings. The default-path
   case may create an explicit board-setting record, but it does not change the resolved folder or
   library bytes.
4. **Why the legacy app value stays:** `drawLibrary.ts` is explicitly out of scope and still
   depends on `settings.get/set("drawing.library-path")`. Deleting the persisted value now would
   make an existing custom library invisible to the built-in editor before EPIC-110. Source-level
   app ownership is removed; compatibility data remains until that consumer dies.
5. **Type-checking the unchanged consumer:** once the literal leaves `AppSettingsKey`, the current
   concrete settings overload would infer `unknown` for `drawLibrary.ts`'s `getDir()` result. The
   arbitrary-string overload's default generic is the smallest compatible adjustment and does not
   reintroduce the key as a declared setting.
6. **AI-vision catalog location:** the current namespace has no direct drawing row; it expands the
   static `SETTINGS_CATALOG`. The catalog section removal is therefore the only required removal
   for that surface.
7. **Board defaults and persistence:** the existing bridge returns declaration defaults at read
   time and the existing board section resets by unsetting. Do not write a default merely because
   the panel was opened.
8. **Scope constraints:** do not edit `doc/active-work.md` or `doc/epics/EPIC-111.md`, do not
   regenerate `assets/boards/excalidraw/lib/**`, do not add tests/harnesses, and do not commit.

## Acceptance Criteria

- [x] `assets/boards/excalidraw/board-manifest.json` declares exactly one `library-path` setting
      with `type: "string"`, `format: "folderPath"`, the specified label/description, and
      `default: ""`; existing `author: "Persephone"` and `name: "Excalidraw"` remain present.
- [x] `assets/boards/excalidraw/index.html` reads `await persephone.settings.get("library-path")`
      instead of `persephone.call("settings.get", ["drawing.library-path"])`, while its
      `<userData>/data/excalidraw-lib` fallback and library load/save behavior remain intact.
- [x] `drawing.library-path` is absent from `AppSettingsKey`, `settingsComments`, and
      `defaultAppSettingsState`; the arbitrary-string settings getter still type-checks the
      unchanged `drawLibrary.ts` consumer.
- [x] `DrawingLibrarySectionView`, its SettingsView factory/import, and the complete static
      `drawing-library` catalog section are removed. The dynamic Excalidraw board panel remains
      reachable through the existing `BoardSettingsSectionView` folder-path branch.
- [x] The current AI-vision settings namespace contains no `drawing.library-path` element. This is
      achieved transitively from `SETTINGS_CATALOG`; no duplicate manual row is introduced.
- [x] On first Excalidraw board-setting access, a non-empty legacy value is copied once to the
      `Persephone/Excalidraw` namespace's `library-path` key, but an existing board value is never
      overwritten and the legacy app value remains available to `drawLibrary.ts`.
- [ ] For an unset legacy value (the measured current user), migration performs no write, the board
      setting remains absent, the board resolves `<userData>/data/excalidraw-lib`, and no library or
      app-settings file is rewritten by migration.
- [ ] An explicit legacy default path is copied without moving or rewriting the library; an
      explicit custom path is copied exactly and continues resolving the existing custom folder.
- [ ] The user's library is verified read-only before and after: `libraryItems.length` remains 31
      and byte size remains 352534. Verification does not delete, rewrite, import into, or save the
      user's `library.excalidrawlib`.
- [ ] `src/renderer/editors/draw/drawLibrary.ts`,
      `src/renderer/editors/settings/sections/BoardSettingsSection.ts`,
      `src/board-shim.ts`, the board-settings store/types, manifest normalization, and generated
      Excalidraw `lib/` remain unchanged.
- [x] No unit tests or harnesses are added, no generated board bundle is regenerated, no commit is
      created, and neither `doc/active-work.md` nor `doc/epics/EPIC-111.md` is edited.

## Files that need no changes

- `src/renderer/editors/draw/drawLibrary.ts` — compatibility consumer; it remains until EPIC-110.
- `src/renderer/editors/settings/sections/BoardSettingsSection.ts` — already renders this
  declaration type/format through the existing bridge.
- `src/renderer/api/board-settings/BoardSettingsStore.ts` — existing store semantics are sufficient.
- `src/renderer/api/board-settings/types.ts` and `src/renderer/api/board-settings/index.ts` — no
  new value, declaration, or export type is required.
- `src/renderer/editors/board/board-manifest.ts` — existing S5 normalization is sufficient.
- `src/board-shim.ts` — `persephone.settings.get()` already exists.
- `src/renderer/scripting/ai-vision/namespaces/settings.ts` — no direct drawing row exists; it
  derives elements from the static catalog.
- `assets/boards/excalidraw/lib/**` — generated and committed; do not regenerate.
- `doc/active-work.md` and `doc/epics/EPIC-111.md` — explicitly excluded and already linked.
- Unit-test files, harnesses, and release/generated copies — explicitly out of scope.

## Files Changed Summary

| File | Planned implementation change |
|---|---|
| `assets/boards/excalidraw/board-manifest.json` | Declare Excalidraw's `library-path` string/folderPath setting with label, description, and empty default. |
| `assets/boards/excalidraw/index.html` | Read `persephone.settings.get("library-path")`; preserve the existing user-data fallback and file persistence. |
| `src/renderer/api/board-settings/board-settings-bridge.ts` | Add the namespace/id-scoped, serialized one-time legacy seed before effective reads/mutations; leave defaults read-time and preserve the legacy app value for `drawLibrary.ts`. |
| `src/renderer/api/settings.ts` | Remove the legacy key, description, and default; widen only the arbitrary-string getter's default generic so the unchanged legacy consumer compiles. |
| `src/renderer/editors/settings/sections/SettingsSections.ts` | Remove `DrawingLibrarySectionView` and its export while retaining the reusable `LibraryPathSectionView`. |
| `src/renderer/editors/settings/SettingsView.ts` | Remove the deleted Drawing Library view import and static factory entry. |
| `src/renderer/editors/settings/settings-catalog.ts` | Remove the static Drawing Library section/row; the board declaration supplies the dynamic panel. |
| `src/renderer/editors/draw/drawLibrary.ts` | **No change:** remains the temporary compatibility consumer until EPIC-110. |
| `src/renderer/editors/settings/sections/BoardSettingsSection.ts` | **No change:** existing board `folderPath` renderer is reused. |
| `src/renderer/scripting/ai-vision/namespaces/settings.ts` | **No change:** its catalog-derived element disappears when the static catalog section is removed. |
| `src/board-shim.ts` | **No change:** `persephone.settings.get()` is already implemented. |
| `src/renderer/api/board-settings/BoardSettingsStore.ts`, `types.ts`, `index.ts` | **No change:** existing store contracts are sufficient. |
| `src/renderer/editors/board/board-manifest.ts` | **No change:** existing identity and setting normalization are sufficient. |
| `assets/boards/excalidraw/lib/**` | **No change:** generated committed board bundle; do not regenerate. |
| `doc/active-work.md` | **No change:** explicitly excluded; already links US-1502. |
| `doc/epics/EPIC-111.md` | **No change:** explicitly excluded; already links US-1502 and contains S5/S6. |
| Unit-test files and harnesses | **No change:** explicitly excluded. |
