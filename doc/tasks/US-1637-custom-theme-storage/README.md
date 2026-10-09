# US-1637: Saved custom themes — storage, startup, Settings, cycling

Epic: [EPIC-123: Custom themes](../../epics/EPIC-123.md)

## Progress

- [x] Read the canonical project guidelines and reviewed task plan.
- [x] Confirm the US-1636 validation and build APIs and existing app filesystem/watch patterns.
- [x] Implement async custom-theme storage, CRUD, and cross-window reload watcher.
- [x] Load validated custom themes synchronously for startup and pre-paint.
- [x] Add custom theme grouping and same-id revision notifications to consumers.
- [x] Initialize storage before pages and update the theme setting description.
- [x] Run typecheck, lint, and production build; fix reported issues.
- [x] Record remaining live-renderer verification limitations.
- [x] Claude live verification (below), with two fixes.

### Live verification (Claude, 2026-10-09)

A throwaway `custom-claude-test.theme.json` was written straight to the themes folder, so every
change below arrived through the directory watcher. Removed afterwards.

- **Watcher add:** the new file appeared as the 12th Settings card, under a **Custom** heading.
- **Select from Settings:** clicking it applied background, accent, derived selection and dark
  scheme, and persisted `theme`.
- **Same-id edit:** rewriting `base.background` re-applied the active theme within the debounce.
- **External delete of the active theme:** the window showed `persephone`, and `theme` stayed
  `custom-claude-test` (not persisted). **Restoring the file** brought the custom theme back.
- **Cold start:** `#startup-background` held the custom background before the bundle loaded, and
  the custom theme was active at once.
- **Second window:** opened on the custom theme, and a file edit made from window 1 reached it.
- Not checked live: Monaco and board palettes on a same-id edit (no editor or board was on screen);
  the subscription changes are the one-line selector updates in the plan.

Fixes made during verification:

- **Settings theme cards could not be clicked — any theme, built-in included.** `renderThemes`
  appended the inner panel to the grid while the click listener sits on its wrapper, which was never
  attached. `ThemeOption` now carries the wrapper as `element`, and the grid appends that.
- **A reload resolved the theme on screen, not the saved setting** (review correction 2).
  `replaceCustomThemes(customThemes, selectedId?)` now takes the persisted id from
  `reloadRegistry` (`settings.theme`) and falls back to `persephone` in memory only — which is what
  makes a restored file return.

Found, not changed: `app.settings.set("theme", id)` persists the id but does not apply it in the
calling window (pre-existing; other windows apply it through the settings watcher). US-1638's
`app.themes.apply` should apply and persist.

### Verification

- `npm run typecheck` — passed.
- `npm run lint` — passed.
- `npm run build-prod` — passed; existing Vite ineffective-dynamic-import and chunk-size warnings remain.
- No unit tests or test harness were added. Live renderer checks for first paint, CRUD, Settings, cycling, and cross-window updates were not run in this environment.

## Goal

Persist validated custom-theme files under `%APPDATA%\\persephone\\data\\themes`, register them with the built-in themes before first paint, and make create, replace, rename and delete available to the Settings theme picker and cycling. Theme definitions are always built through US-1636's `validateCustomThemeFile` and `buildCustomTheme` APIs.

## Background

`src/renderer/theme/themes/index.ts` owns an in-memory static `ThemeDefinition[]`, startup application, lookup, CSS application and cycling. It currently synchronously reads `appSettings.json` with `require("fs").readFileSync` before `app.fs` initializes. `doc/standards/coding-style.md` explicitly lists this file as an allowed direct-fs startup exception. Keep the synchronous custom-theme file reads in this existing exception; do not add a new direct-fs exception or move them into a new storage module. Use `app.fs` for later asynchronous CRUD and reloads.

US-1636 supplies `src/renderer/theme/custom-theme-types.ts` (`CustomThemeFile`, `CustomThemeBase`) and `src/renderer/theme/custom-theme.ts` (`validateCustomThemeFile`, `buildCustomTheme`). The validator returns `{ value?, warnings }`; `buildCustomTheme` owns derivation and override routing. The storage/registry must pass validated file values directly to `buildCustomTheme`, not recreate palette derivation or route overrides itself.

The agreed directory is `%APPDATA%\\persephone\\data\\themes\\<id>.theme.json`. The shared `app.fs` path should be resolved as `fs.resolveDataPath("themes")` after `fs.wait()`. Its `mkdir`, `listDir`, `read`, `write`, `rename`, and `delete` methods cover CRUD without direct `require("fs")`; `fs.resolveDataPath` maps to the app data directory initialized from the shared user-data folder.

`src/renderer/api/settings.ts` constructs a `FileWatcher` for the shared `appSettings.json` during `Settings.init()`. Each window's `fileChanged()` calls `loadSettings(true)`, which applies the current theme and emits changed setting keys; local `settings.set()` emits immediately and debounces persistence through `saveSettingsDebounced()`. This is how a selected theme id reaches other windows. It does not watch the separate custom-theme files or reload the in-memory registry.

Built-ins are read-only. A custom id is assigned once at creation as `custom-` plus a normalized slug of the name and a de-duplicating suffix; it remains stable when the name changes. Invalid files are skipped with a warning and cannot make startup fail. Missing active themes fall back to `persephone` in memory; only the window whose explicit delete removes the selected theme persists that fallback. Custom themes appear with built-ins in Settings and Ctrl+Alt+[ / ] cycling.

## Implementation Plan

1. Add `src/renderer/api/custom-theme-storage.ts` as the CRUD layer. Resolve the shared theme directory through `fs.resolveDataPath("themes")` after `fs.wait()`; create it with `fs.mkdir`. `loadAll()` calls `fs.listDirWithTypes`, keeps regular files ending in `.theme.json` (the filesystem extension filter only handles the final `.json` suffix), reads each with `fs.read`, parses JSON without throwing across the whole load, passes parsed values through `validateCustomThemeFile`, logs each invalid-file/override warning, and returns each accepted value through `buildCustomTheme`. Require the filename stem to equal the validated id and require the safe slug form `^custom-[a-z0-9]+(?:-[a-z0-9]+)*$`; US-1636's validator only requires an id to start with `custom-`, so storage must enforce safe path segments itself. Never allow a file to replace a built-in. Give create a draft input type with an optional `id` (or no id); generate and de-duplicate the final id once before validation because US-1636's persisted `CustomThemeFile.id` is required. Sort loaded definitions by `name` case-insensitively, then by id.
2. In that storage layer implement `save`, `rename` and `delete`. Save-create derives `custom-<slug>` from the trimmed name (Unicode normalize, lowercase, remove diacritics, collapse non-alphanumeric runs to `-`, trim separators; use `theme` if empty), then de-duplicates against existing custom IDs with `-2`, `-3`, etc. Keep that generated id stable for the theme's lifetime. Save-replace is permitted only for an existing safe custom id, can update the name, validates before writing, and atomically replaces `<id>.theme.json` through the sibling temp path `<id>.theme.json.tmp`; the temp name does not end in `.theme.json`, so `loadAll()` cannot treat it as a theme. `src/renderer/api/fs.ts:346-353` shows `app.fs.rename()` delegates to `nodefs.renameSync`; Node's Windows libuv backend uses `MoveFileExW(..., MOVEFILE_REPLACE_EXISTING)` in `fs__rename` ([libuv Windows fs implementation](https://github.com/libuv/libuv/blob/v1.x/src/win/fs.c)), so replacing an existing destination is supported and no delete-then-rename fallback is needed. If rename fails for a separate I/O reason, propagate the error and leave the existing destination intact. Return the canonical validated file/definition. Rename rewrites only `file.name` in place at the same id/path using the same temp-and-rename replacement; it does not change the id or `appSettings.json`. Delete rejects built-in ids and removes only the corresponding custom file. For each successful local mutation, refresh the in-window registry after persistence succeeds.
3. Extend `src/renderer/theme/themes/index.ts` to load custom definitions synchronously at module initialization alongside the built-in array, before `readStartupThemeId()` validates the stored id and before `applyTheme()` runs. Use the already documented local `require("fs")` exception to synchronously enumerate/read `<data>/themes/*.theme.json`; call only `validateCustomThemeFile` and `buildCustomTheme` for parsing/definition creation. Isolate malformed files with per-file catches and `console.warn`; leave the built-ins and startup on `persephone` if a read or validation fails. Keep built-in definitions first and sort custom definitions by name case-insensitively, then id.
4. Extend `readStartupThemeId()` in `src/renderer/theme/themes/index.ts` to accept ids present in the combined registry. Keep fallback to `persephone`. `index.html`'s inline pre-paint script must retain its built-in id-to-background map and, for an id matching `^custom-[a-z0-9]+(?:-[a-z0-9]+)*$`, read `<data>/themes/<id>.theme.json`. Before using it, require `schemaVersion === 1`, exact id match, non-empty name, object-shaped base/overrides, supported `background`/`text`/`accent` colors, and a supported candidate background; this prevents a file the renderer later rejects from briefly painting as valid. Use `overrides["--color-bg-default"]` first when it is a supported color, otherwise fall back to supported `base.background`. Keep all failures contained in the existing try/catch. `vite.renderer.config.ts` already recomputes inline script CSP hashes through `inlineScriptHashesPlugin`, so no manual hash should be added.
5. Add registry operations in `src/renderer/theme/themes/index.ts` for replacing the custom portion of the theme list and removing a custom definition. Replacing/reloading must retain built-ins, sort customs by name case-insensitively and then id, and reject built-in ids. Every registry reload (from a watcher or local mutation) advances the theme-definition revision and re-resolves the theme to show from the current `settings.theme`: call `applyTheme(settings.theme)` when that id exists in the refreshed registry, otherwise call `applyTheme("persephone")` in memory only. This lets a restored theme file become active again if the setting still names it. The watcher/reload path must never call `settings.set`. Only an explicit successful `delete(id)` persists `settings.set("theme", "persephone")`, and only when that delete was performed in this window and `settings.theme === id` before deletion. Keep this persistence in `src/renderer/api/custom-theme-storage.ts` (do not make `themes/index.ts` import `settings.ts`, which already imports the theme registry).
6. Make same-id definition changes observable. Add a monotonically increasing `revision` (or equivalent definition-change counter) to `ThemeState` in `src/renderer/theme/theme-state.ts`; publish the new revision after active CSS is current, and publish it for inactive registry changes as well. `src/renderer/api/setup/configure-monaco.ts` subscribes without an id selector and re-reads `getThemeById(themeState.get().id)`, so it already reapplies Monaco on each state notification. Update `src/renderer/editors/board/board-theme.ts`'s selector to include the revision: its current `{id,isDark}` selector suppresses same-id/same-polarity palette changes and would otherwise leave board palettes stale. Update `src/renderer/editors/settings/sections/ThemeSection.ts` to rebuild its grids/previews when the definition revision changes; its current mount-time theme snapshots do not update when a custom theme is added, removed or replaced. Update `src/renderer/theme/global-styles.ts`'s selector to include revision because it embeds a resolved text color in the generated scrollbar data URI; its current id-only selector would preserve that old encoded value. Other `isDark`-only subscriptions (Mermaid rendering and shell appearance) need no notification for a color-only change because their observed property did not change; CSS vars are applied directly.
7. Watch the themes directory in each renderer using `DirectoryWatcher` from `src/renderer/core/utils/file-watcher.ts`. Initialize the directory before constructing the watcher. On a debounced event call `loadAll()`, replace the registry, then re-resolve `settings.theme` as specified in step 5; the watcher itself never writes settings. This handles transiently missing files and externally restored files without permanently replacing the user's selected id. `DirectoryWatcher` already owns the documented `fs.watch` exception and degrades to a no-op when watching fails. Mutations refresh their own registry immediately after a successful write; the watcher is the cross-window and external-file-edit path. Dispose the watcher with the storage service lifecycle if one is added; otherwise make it a single renderer-lifetime subscription, matching existing app-level watchers.
8. In `src/renderer/api/settings.ts`, update the `"theme"` setting description to include custom theme ids and say that custom choices are stored in the themes folder. Keep the existing load/watch behavior: each renderer watches the shared `appSettings.json`, watcher reload calls `applyTheme(newSettings["theme"])`, and settings `set` persists via that file. This is the selected-theme propagation mechanism; it does not refresh theme definitions and is not used as the custom-file change signal.
9. Update `src/renderer/editors/settings/sections/ThemeSection.ts` to present custom themes as a distinct `Custom` group (partition by `id.startsWith("custom-")`) in addition to Dark and Light built-in groups. Sort the Custom group by name case-insensitively, then id, matching the registry/cycling order. Keep preview swatches based on the definition's `--color-bg-default`, `--color-bg-dark`, `--color-text-default`, and `--color-misc-blue`; selection continues to call `applyTheme` and `settings.set("theme", id)`. Update `src/renderer/api/cycle-app-theme.ts` only if needed to preserve the current behavior: `cycleTheme` already cycles the complete `getAvailableThemes()` list and `cycleAppTheme` persists the selected id.
10. Initialize the async loader and directory watcher from `src/renderer/api/app.ts` after service loading and before pages are initialized. `App._loadServices()` loads `settings` and `fs` before it returns; await both `settings.wait()` and `fs.wait()`, then call the storage module's initializer. This avoids importing the async storage/watcher into the synchronous theme bootstrap path and ensures Settings mounts with the watcher active.

### Startup registry before → after

```ts
// Before: startup selection only sees the hard-coded built-ins.
const themes: ThemeDefinition[] = [defaultDark, persephone, /* ... */ quietLight];
applyTheme(readStartupThemeId());

// After: synchronously load validated custom definitions before resolving the saved id.
const themes: ThemeDefinition[] = [
    ...builtInThemes,
    ...readCustomThemesSync(), // validateCustomThemeFile() then buildCustomTheme()
];
applyTheme(readStartupThemeId());
```

### Theme-definition change before → after

Before: replacing a custom definition with the same `id` applies CSS, but consumers selecting only `{id, isDark}` do not see a changed state, and Settings holds a stale preview object.

After: registry replacement advances a `themeState.revision`; `applyTheme(id)` reapplies CSS then publishes the new revision. Monaco re-reads the registry on every publication, while board-theme, generated global styles, and ThemeSection subscribe to the revision.

```ts
// Before: selected board subscription suppresses same-id/same-polarity edits.
(state) => ({ id: state.id, isDark: state.isDark })

// After: a definition replacement changes revision even when id and isDark stay equal.
(state) => ({ id: state.id, isDark: state.isDark, revision: state.revision })
```

```ts
// Before: global styles only rebuild when the active theme id changes.
(state) => state.id

// After: embedded, resolved theme colors refresh after an in-place custom-theme edit.
(state) => ({ id: state.id, revision: state.revision })
```

### Cross-window change propagation recommendation

Use a watch on the shared themes directory, backed by the existing `DirectoryWatcher`, and reload accepted files in each window. This handles create, replace, rename, delete, and external edits without adding IPC channels. The existing settings watcher only watches `appSettings.json`; it propagates the selected id but does not notice theme-file edits. A synthetic settings key would couple custom-theme storage to unrelated settings persistence and still require each window to reload definitions. IPC broadcast adds a second notification path while the files remain the source of truth.

## Concerns

- **Synchronous startup is intentionally narrow.** `src/renderer/theme/themes/index.ts` already reads settings synchronously before `app.fs` initialization and is explicitly named in `doc/standards/coding-style.md`'s allowed exceptions. Keep startup custom-theme reads in this same file/exception; do not add direct fs usage to the storage module or broaden the documented exception. All post-start CRUD uses `app.fs`.
- **Saving a new file needs an id before validation.** Generate and de-duplicate the id once from the name before calling `validateCustomThemeFile`; `CustomThemeFile.id` is required by US-1636. The id is stable identity thereafter: save-replace and rename may change the name without changing id or selected setting.
- **Atomic replacement and watcher coalescing.** Write `<id>.theme.json.tmp` (which does not match the `.theme.json` suffix filter) then rename it over the destination, and debounce directory notifications. In this repo `app.fs.rename()` delegates to Node's `fs.renameSync` (`src/renderer/api/fs.ts:346-353`); the Windows implementation in libuv's `src/win/fs.c` calls `MoveFileExW` with `MOVEFILE_REPLACE_EXISTING`, so existing-file replacement works. If an independent I/O error occurs, propagate it and preserve the old file. A rename may produce more than one event; reload is idempotent and reads the directory as the source of truth.
- **Observed missing-file fallback is temporary.** Any registry reload resolves `settings.theme` against the refreshed registry and applies `persephone` only in memory when the id is absent. Only the explicit delete operation in the window that performs it persists `persephone` when it deleted the selected id. This avoids a second window overwriting settings while its file watcher and settings watcher receive events in different orders, and lets an externally restored file reapply the stored selection.
- **Live renderer verification is required.** Codex cannot run Persephone here. Claude should verify first-paint background for built-in and custom themes, invalid/missing custom files, active delete fallback, Settings grouping and cycling, same-id active edits updating CSS/Monaco/board palette/Settings swatch, and create/replace/rename/delete propagation with two open windows. Also verify an external file edit reaches both windows and inspect warnings for invalid files. No unit tests or test harness exist; do not add one for this task.

## Acceptance Criteria

- Custom theme files live at `%APPDATA%\\persephone\\data\\themes\\<id>.theme.json`; built-ins are never writable/deletable and an id is generated once at creation as `custom-` plus normalized name slug with collision de-duplication. Rename and save may change the name while retaining the id.
- Storage supports loading all valid files, create with a new generated ID, replacement by existing custom ID (including name changes), rename in place without changing id, and deletion.
- All persisted values are validated by `validateCustomThemeFile`; every accepted definition is created by `buildCustomTheme`. No derivation or override routing is duplicated in the storage or registry code.
- Invalid custom files are skipped with a warning and cannot crash startup or prevent valid themes from loading.
- Custom files are synchronously loaded before `readStartupThemeId()` and initial `applyTheme()`; the selected custom id applies without a startup flash. For custom startup backgrounds, the inline script uses `--color-bg-default` override before `base.background`, and its CSP hash remains generated by `inlineScriptHashesPlugin`.
- Saving, renaming or deleting a custom theme updates the current window and every other open window through the themes-directory watcher. Every reload re-applies `settings.theme` if available, otherwise falls back to `persephone` in memory. Only the window performing a successful delete persists `persephone`, and only if it deleted its selected theme. An active custom definition changed without changing its id reapplies CSS and updates theme consumers; an externally restored file can become active again from the unchanged setting.
- Custom themes are sorted by name case-insensitively, then id, in both the combined registry (and thus cycling) and the Settings Custom group.
- Monaco and board consumers re-read the active definition on same-id color changes; Settings refreshes its custom preview definitions.
- Settings has a visible Custom theme group alongside Dark and Light; the theme setting description includes custom IDs. Ctrl+Alt+[ / ] cycles through all available themes and persists the chosen id.
- No preview, scripting/MCP API, or board bridge is implemented here; US-1638 owns preview and `app.themes`, US-1639 owns the board bridge, and US-1640 owns the Theme Editor board.
- No unit tests or test harness are added. Claude performs live multi-window verification and records results in review notes; Codex does not claim to have run Persephone.

## Files Changed Summary

| File | Planned change |
|---|---|
| `doc/tasks/US-1637-custom-theme-storage/README.md` | This implementation-ready task plan and verified architecture findings. |
| `doc/active-work.md` | Link the US-1637 dashboard entry to this task document. |
| `doc/epics/EPIC-123.md` | Link the US-1637 task-table entry to this task document. |
| `src/renderer/api/custom-theme-storage.ts` | **Implementation:** async CRUD/load layer, id generation/de-duplication, validation/build calls, directory watch and registry refresh orchestration. |
| `src/renderer/api/app.ts` | **Implementation:** initialize custom-theme storage and its watcher after services load and before pages mount. |
| `src/renderer/theme/themes/index.ts` | **Implementation:** synchronous custom-file startup load in the existing documented exception; combined registry, reload/replace/remove behavior and active fallback. |
| `src/renderer/theme/theme-state.ts` | **Implementation:** publish a definition revision so same-id custom color changes notify relevant consumers. |
| `index.html` | **Implementation:** pre-paint custom background lookup, override-first then base value. |
| `src/renderer/api/settings.ts` | **Implementation:** update persisted theme description for custom choices. |
| `src/renderer/editors/settings/sections/ThemeSection.ts` | **Implementation:** Custom group and revision-driven preview refresh. |
| `src/renderer/editors/board/board-theme.ts` | **Implementation:** subscribe to definition revision so boards receive same-id palette updates. |
| `src/renderer/theme/global-styles.ts` | **Implementation:** rebuild generated styles when the active definition revision changes. |
| `src/renderer/api/setup/configure-monaco.ts` | Read-only verification: existing unfiltered `themeState` listener re-reads current definition; no changes planned. |
| `src/renderer/api/cycle-app-theme.ts` | Read-only verification: current wrapper cycles and persists via the registry; no changes expected. |
| `doc/standards/coding-style.md` | Read-only verification: the existing `themes/index.ts` synchronous startup exception covers this implementation; no new exception or standards edit planned. |
| `src/renderer/api/fs.ts`, `src/renderer/core/utils/file-watcher.ts`, `src/renderer/core/utils/file-path.ts`, `vite.renderer.config.ts` | Read-only helpers: `app.fs` CRUD/path APIs, existing directory watcher and startup inline-script hash plugin; no changes planned. |
| `src/renderer/theme/custom-theme.ts`, `src/renderer/theme/custom-theme-types.ts` | Read-only US-1636 API; call `validateCustomThemeFile` and `buildCustomTheme` without changes. |
| `src/board-shim.ts` | Read-only theme callback contract; existing board palette delivery remains in place. |
| `src/renderer/api/types/themes.d.ts`, `src/renderer/api/mcp/`, `src/renderer/scripting/` | **No changes:** US-1638 owns `app.themes`, MCP surface, and preview. |
| `src/shared/board-manifest-utils.ts`, `src/renderer/editors/board/BoardWebview.ts`, `src/shared/board-bridge-version.ts`, `assets/board-template/board-manifest.json`, `assets/board-template/index.html` | **No changes:** US-1639 owns the `themes` permission and bridge. |
| `persephone-boards` Theme Editor board files | **No changes:** US-1640 owns the separate editing UI. |
| Test directories / test harness | **No changes:** this feature has no unit test harness; Claude verifies in the live renderer. |
