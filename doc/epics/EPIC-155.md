# EPIC-155: Refactoring Phase 5.5 — settings schema, settings effects, theme startup and the startup phase table

## Status

**Status:** Completed 2026-11-13
**Created:** 2026-11-12

## Overview

This is the fifteenth epic of the [refactoring roadmap](../refactoring-roadmap.md) and the fifth part of Phase 5 (pages,
settings, startup and app conventions). It covers roadmap item 5.5 and findings **CORE-7**, **CORE-8**, **CORE-9**
(`doc/reviews/refactoring-2026-11/04-api-core.md`), **EDT-3** (`08-editors-tools.md`), **PLAT-6**
(`03-api-platform.md`) and **BND-14** (`02-boundary.md`), plus decision **D12** (the settings storage rule).

The code was checked on 2026-11-12, after EPIC-154. Phase 0 already fixed part of what the findings describe, so the
current state is restated here.

**The problems.**

- **One setting, four to six places (CORE-7 step 1, EDT-3).** `api/settings.ts` (562 lines) declares each key in the
  `AppSettingsKey` union (36-86), `settingsComments` (126-178), `defaultAppSettingsState` (185-238), the `set` if-chain
  (410-415) and the `loadSettings` normalisation block (475-490), with defaults such as `"Alt+V"` repeated in three of
  them. A key added to the union without a default compiles, because `get` falls back to the generic overload. The
  Settings views restate the same rules: the auto-stop option lists, the default shortcuts used by the Reset buttons
  and the clipboard 1..1000 rule (`editors/settings/sections/SettingsSections.ts`, `ClipboardSectionModel.ts`). The
  notch range disagreement EDT-3 reported is already fixed (`MICROPHONE_NOTCH_FREQUENCY_RANGE`, 20..7999).
- **Feature logic inside the store (CORE-7).** Microphone validation, the microphone publish over a raw
  `require("electron").ipcRenderer` (370-375, 420, 502), the `ui/speech` type import (15), theme application on every
  load (499), the editor-category normalisation and the `pinned-editors`/`draw-view` migration (296-350, 485-497), and
  the `voice-assistant.*` key deletion (483).
- **Two places actuate settings (CORE-7 step 3, PLAT-6 step 2).** `App.initEvents` (`api/app.ts:298-394`) pushes
  `main.scripting.enabled`, `capabilities.preferredProviders` and `browser-windows-sso` at startup, starts MCP, Mneme and
  the clipboard tracker 1.5 s later, and then repeats each block in an `onChanged` subscriber (362-393). `settings.ts`
  itself publishes the microphone settings and applies the theme. The `loadSettings` comment still points at
  `App.initServices`.
- **Every consumer filters keys by hand.** 38 `settings.onChanged.subscribe(({ key }) => { if (key === …) })` sites in
  about 28 files, with an untyped `value: unknown`.
- **UI state split across two stores (CORE-7 step 4, D12).** `editor-categories-popover-size` is window geometry kept
  in `appSettings.json`; sidebar widths and other geometry live in `uiPreferences` (`api/ui-preferences.ts`, IPC-backed,
  scalar values only).
- **Theme startup (CORE-9).** The profile data-folder bug is already fixed: main passes `--persephone-data-dir=`
  (`main/open-window.ts:129`) and `core/utils/startup-data-path.ts` reads it. What remains:
  - `appSettings.json` is parsed twice at first paint, two ways: `theme/themes/index.ts:110-127` strips `//` lines and
    calls `JSON.parse` (a trailing comma falls back to the default theme); `i18n/startup.ts:47-56` uses `parseJSON5`
    and probes a `settings.language` wrapper that does not exist.
  - Custom-theme loading is implemented twice: `readCustomThemesSync` (`themes/index.ts:31-63`) and
    `custom-theme-storage.loadAll` (`api/custom-theme-storage.ts:37-75`), each with its own safe-id regex and sort.
  - Theme application flows both ways: `settings.loadSettings` applies the theme, `themes.apply` applies it and then
    writes the setting, and `api/cycle-app-theme.ts` exists only to break the resulting import cycle.
  - `themes/index.ts:202-204` installs CSS variables and applies a theme as an import side effect.
- **Startup is spread out (CORE-8, PLAT-6, BND-14).** `app-service-registry.ts` is a typed table for the 16 `app.*`
  services, but `App` starts about 14 more modules by hand, each with its own error handling: `ui-preferences`,
  `module-service-status`, custom-theme storage, published boards, the install registry and registered tools in
  `_loadServices`; renderer RPC (`initRendererRpc` is called in both `initPages` (206) and `initEvents` (296)); site
  extension trust, navigation return, the alert feed, the four link-pipeline registrations and the pipe resource
  server in `initEvents`; Mneme status, Mneme connection and autoload scripts in a 1.5 s `setTimeout`.
  `src/renderer.ts` sequences `settings.wait()`, `boardRegistry.load()`, the editor-categories import,
  `customEditorRegistry.ensureInitialized()` and the board-window launch (encode link → `openRawLink` →
  `markLockedBoardPage`) itself, none of which is in the documented bootstrap (`doc/architecture/overview.md:185-215`).
  `_pages` is typed `undefined as unknown as PagesModel`. Constructor side effects subscribe to settings in
  `BoardEnvStore` and `LibraryService`; `dispose()` methods on `module-service`, `autoload-service` and
  `library-service` are never called.

## Goals

- **One table per setting.** `api/settings-schema.ts` defines each key once: default, file comment, optional
  `normalize`, and the option list or range a view needs. `AppSettingsKey` and the value types derive from it, so a key
  without a default does not compile. `set` and `load` normalise through the same entry. Feature normalisers live next
  to their feature and are referenced from the table. Views read `settingDefault`, `settingOptions` and `settingRange`
  instead of hard-coding.
- **Typed per-key subscriptions.** `settings.watch(key, (value) => …)` with the key's value type; every hand-filtered
  `onChanged` subscriber that watches named keys moves to it. `onChanged` stays for "any key".
- **One effects table.** `api/settings-effects.ts`: `{ keys, apply(values, { initial }) }` rows for MCP, Mneme, the
  clipboard tracker, main scripting, Windows SSO, capability preferences and the microphone publish. It runs once at
  startup and on each change, replacing both copies in `app.ts` and the side effects inside `Settings`.
- **One storage rule (D12), written down.** User-meaningful configuration goes in `appSettings.json`; window/UI
  geometry goes in `uiPreferences`. `editor-categories-popover-size` moves with a one-time migration.
- **Theme startup has one reader and one direction.** A startup environment parses `appSettings.json` once with
  `parseJSON5`; theme and i18n startup both read it. One `CustomThemeCatalog` with `loadSync()` and `load()`. A
  `ThemeService` applies the theme from `settings.watch("theme")`; `themes.apply` and both theme cycles only write the
  setting. `applyThemePreservingPreview` leaves `settings.ts`; `cycle-app-theme.ts` is deleted; the import side effect
  becomes an explicit `installThemeAtStartup()` called from `renderer.ts`.
- **One startup phase table.** `api/app-startup.ts` lists every internal start-up entry with its phase, in today's
  order, with a one-line reason for each ordering constraint. `App.init*` runs its phase with uniform failure
  reporting. `renderer.ts` reads "load NLS → bootstrap app → mount". The overview's bootstrap section matches the
  table.

## Decisions this epic acts on

- **The settings file does not change shape.** Same keys (except the D12 move), same order, same header and per-key
  comments, same JSON5 tolerance on read. For an unchanged settings object, the text `saveSettings` writes is
  byte-identical before and after US-1887; the plan says how this was checked (a one-off comparison during
  implementation, not a committed test).
- **Key order comes from the table.** Today the file's key order is the declaration order of
  `defaultAppSettingsState.settings`; the schema keeps that order.
- **Normalisers stay pure and next to their feature.** Microphone validation moves out of `api/settings.ts` (to the
  microphone settings module or `shared/`), but `api/settings.ts` must not import `ui/` after this epic: the
  `MicrophoneNotch` type and `MICROPHONE_TUNING` are imported from wherever the plan finds the lowest layer they can
  live in. If that needs a move out of `ui/speech/`, the move is part of US-1887.
- **Migrations are table rows, not inline code.** The `voice-assistant.*` deletion and the `pinned-editors`/`draw-view`
  migration become `migrate` entries in the schema (or a small ordered `SETTINGS_MIGRATIONS` list in the same file;
  the plan picks one), with the "rewrite the file if a migration changed something" rule kept.
- **The initial load does not emit.** `watch` callbacks fire on changes only. The effects table runs its rows once with
  `{ initial: true }` at the point `App.initEvents` runs them today (after `settings.wait()`, with MCP, Mneme and the
  clipboard tracker still deferred by 1.5 s), and on each later change. Success and failure toasts stay as they are
  (MCP and Mneme failures toast on start; Mneme success toasts only on a user change).
- **Watch semantics.** `watch(key, cb)` returns the same unsubscribe shape `onChanged.subscribe` returns, so the
  existing `own(...)`/disposal patterns keep working. A watcher of several keys uses one call per key or a
  `watch([keys], cb)` overload; the plan picks one and applies it everywhere.
- **D12, applied narrowly.** Only `editor-categories-popover-size` moves: it is pure window geometry, and
  `uiPreferences` holds scalars, so it becomes two number keys (width, height) or one string, the plan picks. The
  one-time migration reads the old key, writes `uiPreferences`, and drops the key from the settings file.
  `tab-recent-languages`, `browser-search-engine` and `browser-private-search-engine` stay in `appSettings.json`:
  they are lists and choices that users and agents read and edit as settings (the ai-vision settings namespace
  documents `tab-recent-languages`), and widening `uiPreferences` to arrays for one list is not worth a second storage
  shape. The rule and this reasoning go in the developer docs.
- **Theme owner.** `ThemeService` (in `api/`, the plan names the file) owns "the setting changed → apply, unless a
  preview is active". `theme/themes/index.ts` keeps the in-memory registry, apply and preview, and no longer reads
  files. `CustomThemeCatalog` owns reading, validation, safe-id and sort, sync and async; both the startup path and
  `custom-theme-storage` use it.
- **First paint stays synchronous.** The startup environment and `CustomThemeCatalog.loadSync()` keep synchronous
  reads; the correct theme must be on screen before the shell mounts, as today.
- **The startup table copies today's order exactly first.** Ordering constraints become array order within a phase,
  each with a one-line comment (for example, "renderer RPC before page restore: a restored board calls the bridge";
  "link-pipeline handlers in registration order: LIFO, so the opener registers first"; "board trust and the board
  registry before page restore"). Renderer RPC is initialised once. The board-window launch becomes a named entry.
  Background entries (published boards, install registry, registered tools, Mneme, autoload) keep fire-and-forget
  behaviour and report failures through one helper.
- **Constructor side effects.** `BoardEnvStore` and `LibraryService` subscribe through `settings.watch` in an explicit
  `start()` called from the table, if the plan confirms nothing reads them before that phase; otherwise the plan
  records why they stay. The never-called `dispose()` methods are deleted unless a caller exists.
- **No new protocol code** (guardrail 1). The effects table calls the existing `api.*` endpoints and the existing audio
  channel; no new IPC message.
- **God files only shrink** (guardrail 3). `api/settings.ts` (562), `api/app.ts` (406), `theme/themes/index.ts` (205),
  `i18n/startup.ts` (154) and `api/custom-theme-storage.ts` (183) each end smaller or equal. `renderer.ts` (51) ends
  smaller.
- **No `await import()` to dodge a cycle** (guardrail 5). The settings ↔ themes cycle is removed by direction (themes
  stop being imported by settings), not by a lazy import.
- **No `window.persephone` change**, so no `BOARD_BRIDGE_VERSION` bump. The board settings bridge
  (`editors/board/frame/settings-and-vars-bridge.ts`) may move to `watch` but its board-facing messages do not change.

## Linked Tasks

| Task | Title | Status |
|------|-------|--------|
| US-1887 | Settings schema table, view accessors and the D12 storage move (CORE-7 steps 1 and 4, EDT-3) | Done |
| US-1888 | `settings.watch` and the settings effects table (CORE-7 steps 2–3, PLAT-6 step 2) | Done |
| US-1889 | Startup environment, `CustomThemeCatalog` and `ThemeService` (CORE-9) | Done |
| US-1890 | The renderer startup phase table (CORE-8, PLAT-6 steps 1, 3, 4, BND-14) | Done |

**Order.** Strictly sequential. US-1887 gives the table that `watch` types against. US-1888 adds `watch`, which
`ThemeService` subscribes to, and moves the actuation into the effects table, which US-1890 then schedules as a phase
entry. US-1890 goes last because it reorders the code the other three touch.

### Task notes for the planners

- **US-1887.**
  - Map every key: union, comment, default, normaliser, migration, and every view that restates a rule (grep the
    option lists, `"Alt+V"`, `"Alt+Shift+V"`, `1000`, `MICROPHONE_TUNING`, `MICROPHONE_NOTCH_FREQUENCY_RANGE` under
    `editors/settings/`). List each restatement and what replaces it.
  - Keep `get`'s typed and escape-hatch overloads and `ISettings` (`api/types/settings.d.ts`) script-facing behaviour.
    Check `editors/settings/settings-catalog.ts` and the ai-vision settings namespace
    (`scripting/ai-vision/namespaces/settings.ts`) for key lists that should derive from the table; they keep their
    agent-facing text.
  - Profile-dependent defaults (`mcp.port`, `mneme.port`, `tor.socks-port`, `video-stream.port`,
    `main.scripting.enabled`) stay computed at module load as today.
  - Byte-identical save output: describe the check.
  - D12: the popover size move, its migration, the two places that read/write it, and the ai-vision namespace line
    that documents it.
- **US-1888.**
  - List all 38 `onChanged` subscribers and say which become `watch` and which stay `onChanged` (any-key consumers,
    such as the Settings page re-render or the board settings bridge, if they need every key).
  - The effects table: one row per actuation, with the startup and change behaviour of each written side by side
    before and after (port fallback, toast text and when it shows, the 1.5 s deferral).
  - `settings.ts` loses the microphone publish and the theme application; the microphone publish row uses the
    existing `AUDIO_SETTINGS_UPDATE` channel (through whatever IPC access the plan finds is allowed for that channel)
    and runs at startup exactly when it runs today (after the initial load).
  - The theme application moves out only in US-1889; US-1888 leaves `applyThemePreservingPreview` where it is.
- **US-1889.**
  - The startup environment's home and name (`core/startup-environment.ts` or `api/startup-environment.ts`); it
    exposes the data folder and the parsed startup settings, and is the only synchronous reader of
    `appSettings.json`. Delete the `settings.language` wrapper probe.
  - `CustomThemeCatalog`: one validation path, one safe-id rule, one sort; `custom-theme-storage` keeps its write,
    rename, delete and watcher jobs and uses the catalog for reading.
  - `ThemeService`: who applies on startup, on a file edit, on `themes.apply`, on the keyboard cycle
    (`KeyboardService`) and on the board cycle (`board:cycleTheme`). Preview semantics (`previewTheme`,
    `endPreview`, `applyThemePreservingPreview`) stay identical; record each flow before and after.
  - Check that nothing else relies on the `themes/index.ts` import side effect (CSS variables installed before first
    use), and where `installThemeAtStartup()` must be called in `renderer.ts` so the first paint is unchanged.
- **US-1890.**
  - Write today's full startup order (renderer.ts plus the four `App` methods) as a numbered list first, then the
    table, and show they match.
  - `_pages` gets a real type (no `undefined as unknown as`).
  - Decide whether the `app.*` service descriptors (16 after earlier epics) join the table or stay in `app-service-registry.ts` (keep its
    compile-time completeness either way).
  - Update `doc/architecture/overview.md`'s bootstrap section in the same task.

## Out of scope

- The Settings editor rework (field kit, `SettingsStore` adapters, layout model): roadmap 6.5 (EDT-1, EDT-2, EDT-4).
  US-1887 only makes the views read the schema accessors where they restate a rule.
- `MainSnapshotMirror` work (PLAT-7) and capability pipeline changes.
- Main conventions (5.6) and the Layer 2 typed `action` (5.7).
- Any change to the settings file's keys beyond the D12 move, the `app.settings` script API, or the ai-vision messages
  beyond the popover-size line.
- US-1873 (board docs) stays in Planned until the refactoring work is done.

## Notes

### 2026-11-12
- Epic created after EPIC-154. Current state re-checked against the code: the profile data-folder bug (CORE-9) and the
  notch range disagreement (EDT-3) are already fixed; 38 `onChanged` subscribers by a raw grep (37 runtime consumers once doc examples are excluded and the `BoardRegistry.attach` use is counted); `initRendererRpc` is called twice.

### 2026-11-13 — implementation and close
- All four tasks implemented and staged; typecheck, lint and build-prod pass after each, and a cold `npm start` reaches
  the settings effects (clipboard tracker and Mneme start) after each. The Persephone MCP connection was down for this
  run, so no window snapshot was taken.
- **Sizes (wc -l).** `api/settings.ts` 562 -> 247 (`settings-schema.ts` 170 new); `api/app.ts` 406 -> 185
  (`app-startup.ts` 328 new); `theme/themes/index.ts` 205 -> 117; `i18n/startup.ts` 154 -> 145;
  `api/custom-theme-storage.ts` 183 -> 169; `renderer.ts` 51 -> 35.
- **Decision refinements.**
  - US-1887: microphone tuning types and the notch normaliser moved to `src/shared/microphone-cleaning-types.ts`;
    `options`/`range` are view metadata only, so `set` and load normalise exactly the keys they did before.
    `editor-categories` is normalised on load only, as before. The popover size became two `uiPreferences` numbers
    (`editor-categories-popover-width`/`-height`); `uiPreferences.load()` is shared so the migration can run inside the
    settings load. The save output was compared once, byte for byte, outside the repo.
  - US-1888: `watch` is internal (not on the script-facing `ISettings`). The microphone publish moved from the end of
    the settings load to the effects start in `initEvents`; the audio window reads the stored snapshot, so this is
    safe. All 37 runtime subscribers moved to `watch`; nothing internal needs `onChanged`.
  - US-1889: `ThemeService` starts in the services phase right after `settings.wait()` (not with the effects table),
    so a theme write during page restore still applies. `select`/`cycle` clear the preview and write the setting; the
    watcher always applies with the preview-preserving helper, which replaces a mode flag. The catalog lives in
    `theme/custom-theme-catalog.ts` with an injected async reader, so `renderer.ts` does not pull `api/fs` in before
    Monaco NLS.
  - US-1890: the services phase starts only after the renderer-index import, as before. Renderer RPC is initialised
    once before page restore. `BoardEnvStore` starts its watch from the table; `LibraryService` keeps its
    constructor watch because Monaco IntelliSense uses it during `initSetup`. Three uncalled `dispose()` methods were
    deleted.
- **Review.** `/review` replaced the definite-assignment `_pages!` with an optional field and a throwing getter
  (accepted: reading `app.pages` before page restore was already broken, now it says so). `/document` updated four
  architecture docs and `key-files.md` and recorded the D12 rule; `/userdoc` needed no changes. No English catalog
  messages changed.
- **Deliberate behaviour changes.** The popover size no longer appears in `appSettings.json` or as an `app.settings`
  key; the microphone settings publish happens later in startup; a settings-file edit that does not touch the three
  microphone keys no longer re-sends an identical microphone snapshot.
