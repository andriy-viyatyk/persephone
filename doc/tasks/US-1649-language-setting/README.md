# US-1649: `language` setting, Settings picker, reload on switch, startup locale

**Epic:** [EPIC-124 — Localization foundation](../../epics/EPIC-124.md)  
**Roadmap:** [Localization roadmap](../../localization-roadmap.md)  
**Status:** In Progress

## Goal

Let users choose the application language in Settings, persist that choice, and apply it consistently by reloading every Persephone window. Expose the setting to scripts and ai-vision, show the effective system-language choice, and keep main-process UI in step with the locale reported by renderer startup.

## Background

US-1647 has already added a process-neutral translation runtime and pack validator under `src/shared/i18n/`, renderer startup in `src/renderer/i18n/startup.ts`, main locale setup in `src/main/i18n-locale.ts`, and the `language` key in `src/renderer/api/settings.ts`. Renderer startup synchronously reads the persisted setting and packs, calls `resolveLocale()`, initializes the active locale and packs, then calls `api.setActiveLocale(activeLocale)`. `src/ipc/main/core-handlers.ts` handles that endpoint with `setMainLocale()`, which loads main-process packs, updates main's active locale, and rebuilds the tray. This existing report runs again after a renderer reload, so the language reload flow can use it without a second settings read in main.

The internal `AppSettingsKey`, disk comment, and default (`"auto"`) already contain `language`. The disk comment currently says changes take effect after restarting; update it to describe the window reload prompt. The public script API type at `src/renderer/api/types/settings.d.ts` currently has only `theme` as a direct setting property, while generic `get()` and `set()` accept arbitrary keys. The `ISettings` runtime object in `src/renderer/api/settings.ts` likewise has a `theme` getter but no `language` getter/setter. Add a writable direct `language` property so `app.settings.language = "uk"` persists through the normal settings setter.

Settings sections are described in `src/renderer/editors/settings/settings-catalog.ts`, registered in `SECTION_VIEW_FACTORIES` in `src/renderer/editors/settings/SettingsView.ts`, and implemented as `VanillaView` classes under `src/renderer/editors/settings/sections/`. `ThemeSectionView` uses `createSectionRoot()`, `panel()`, `text()`, and UIKit views; `SelectView` is the existing controlled select primitive. Add a Language section under General and use these patterns and theme tokens. Keep user-visible strings as separate English literals in this task so US-1652 can replace each with a catalog key without disentangling concatenated copy. Catalog `label` and `purpose` are also consumed by `src/renderer/scripting/ai-vision/namespaces/settings.ts`, so those values remain English agent-facing text under D3.

The renderer's pack scan in `src/renderer/i18n/startup.ts` is private and runs once when the module loads. It already passes candidate files through `loadLanguagePacks()`, which uses `validateLanguagePack()` and excludes D15-blocked packs. Reuse that path through a small exported listing/refresh helper, but rescan the built-in and user language directories when the Language section mounts. A directory scan and JSON5 parsing already happen synchronously at startup and are small; rescanning on opening Settings lets a user-added pack appear without restarting. Do not add a watcher. Count completeness by distinct valid translated message keys over all English catalog keys, merging built-in and user-pack keys for a language code because user packs layer over built-ins.

No app-window reload-all mechanism exists. `src/main/open-windows.ts` owns live and closed window entries and can broadcast existing events, but has no reload method. The existing `openWindows.send()` broadcast is sufficient for this action. The current `eBeforeQuit` handler in `src/renderer/api/internal/RendererEventsService.ts` stops or cancels window recording, calls `model.saveState()` for every page, then calls `pagesModel.saveState()` before signaling readiness to quit. Reuse that exact sequence for reload: extract it into `saveWindowStateForShutdown()` in `src/renderer/api/internal/save-window-state.ts`, call it from both quit and reload handlers, then have each renderer call `window.location.reload()` itself. `window.location.reload()` is the renderer's own document reload; this preserves the shutdown save order without sending main-process reload calls into individual `webContents`. The `webContents.reloadIgnoringCache()` found in `src/main/browser-service.ts` is for embedded browser content, not Persephone windows. Add a dedicated IPC endpoint that broadcasts a new `EventEndpoint.eReloadForLanguage` to each live Persephone window. Each renderer saves and reloads itself; no acknowledgement protocol is needed, and closed window entries remain closed until next opened. Do not expose app-window reload to ai-vision or scripts.

Main locale is process-wide. `setMainLocale()` runs whenever any renderer reports startup, and the most recently reported resolved code wins. A normal reload-all reads the same persisted value in every reloaded renderer and converges main and all windows on it. If windows temporarily disagree, the latest renderer report is authoritative for main until a later report. The main tray strings are in `src/main/tray-setup.ts`; the browser page's unsaved-navigation confirmation is in `src/main/browser-service.ts`. Both currently use English literals and need to use shared catalog messages through `t()` after `setMainLocale()` has installed the reported locale. The validator currently accepts only `common.*` message keys, so it must recognize the new main-process catalog area as well.

The ai-vision Settings namespace builds its setting rows from `SETTINGS_CATALOG` in `src/renderer/scripting/ai-vision/namespaces/settings.ts`; adding the Language row exposes it in that namespace with the catalog's English purpose text. A separate read-only language-list API is not needed: the Settings view can use the startup adapter's pack metadata, while a public `app.languages` API belongs to the phase-4 Language Editor.

## Implementation Plan

1. [x] **Add the Settings section and its metadata.** In `src/renderer/editors/settings/settings-catalog.ts`, add a General section descriptor with stable `id`, `elementName`, `panelName`, `where`, and a `language` row whose label and purpose stay English for ai-vision. In `src/renderer/editors/settings/SettingsView.ts`, import `LanguageSectionView` from `./sections/LanguageSection` and register its factory under the section id. Implement `src/renderer/editors/settings/sections/LanguageSection.ts` as a `VanillaView` following `ThemeSectionView`: create the section root with `createSectionRoot()`, compose with `panel()` / `text()`, and use `SelectView` plus other UIKit primitives for interaction. Do not add raw color values or custom one-off CSS colors.

   The picker has an initial Automatic option whose full label is `Automatic (system language) — <native name of its resolved locale>` (for example, `Automatic (system language) — English`), followed by English and every available pack. The English entry is always listed and is 100% complete even when there are no pack files, because the TypeScript English catalog is the source. Show each language's native `name`, `englishName`, and completeness percentage. Use `name` and `englishName` from validated pack metadata; synthesize the source English entry because English has no `en.lang.json`. Add generated `en-XA` only when `import.meta.env.DEV` is true, matching the guard on the US-1647 debug hook. A stored `"en-XA"` still works in a packaged build because US-1647's `resolveLocale()` honors that explicit request, but the picker never offers it outside development. Never list invalid or D15-blocked packs. When multiple packs share a code, merge their message keys for completeness, matching the runtime's user-over-built-in layering.

   The Automatic label can never resolve to `en-XA`: `resolveLocale("auto", ...)` matches only the available loaded-pack map plus English, while the generated pseudo-locale is not in that map. A system preference of `en-XA` therefore falls back by base tag to `en`.

2. [x] **Expose current pack metadata without adding a public languages API.** Refactor `src/renderer/i18n/startup.ts` so its existing directory scan can be reused by an exported helper that returns freshly validated built-in and user packs. Have `LanguageSectionView` call the helper on mount; it should re-read `getAssetPath`'s startup argument directory and the user `data/languages` directory using the existing `readDirectory()`/`loadLanguagePacks()` path, rather than trusting the module-initialization snapshot. Keep `loadLanguagePacks()` and `validateLanguagePack()` as the source of D15 and malformed-pack filtering. Calculate completeness as `100 * translatedKeys / totalEnglishKeys`, rounded to an integer, where translated keys are distinct valid message keys across the built-in and user pack of that code. Derive the denominator from the typed English catalog, not from a hardcoded count. Refresh the option list when the section mounts; do not install a directory watcher or add `app.languages`.

3. [x] **Persist first, then offer reload.** In `src/renderer/api/settings.ts`, retain the existing `language` key/default and revise its disk comment from “restarting Persephone” to “reload windows” semantics. Add a `language` getter and setter to `Settings`, and export `flushSettingsSave(): Promise<void>`; it cancels the pending 300 ms debounce and awaits the save path, which must await `fs.saveDataFile()`. In `src/renderer/editors/settings/sections/LanguageSection.ts`, define module-local stable ids `RELOAD_NOW_ID` and `LATER_ID`. Use `showConfirmationDialog()` from `src/renderer/ui/dialogs/ConfirmationDialog.ts` with button definitions `{ id: RELOAD_NOW_ID, label: "Reload now" }` and `{ id: LATER_ID, label: "Later" }`, then branch on `choice === RELOAD_NOW_ID`. This follows the US-1648 id/label split; do not compare against the displayed label. “Later” leaves the stored value and running locale alone. “Reload now” calls the new reload-all IPC route. Selecting the already-stored value is a no-op.

   A change from `appSettings.json`, `settings.set("language", ...)`, `app.settings.language = ...`, or MCP `settings.set()` must not trigger an automatic reload or prompt. Subscribe to `settings.onChanged` and refresh the section state; show `Applies after reload` whenever resolving the stored setting against the startup-preferred language list and currently loaded packs yields a locale different from `getActiveLocale()`. This handles an external setting change and avoids implying that a still-running window already switched language.

   **Before → after (picker action):**

   ```ts
   // Before: language is stored, but Settings has no selection or apply flow.
   settings.set("language", "uk");

   // After: persist before asking, then reload all windows only on the user's choice.
   settings.set("language", "uk");
   await flushSettingsSave();
   const choice = await showConfirmationDialog({
       title: "Reload Persephone",
       message: "The language changes after reloading windows.",
       buttons: [
           { id: RELOAD_NOW_ID, label: "Reload now" },
           { id: LATER_ID, label: "Later" },
       ],
   });
   if (choice === RELOAD_NOW_ID) await api.reloadAllWindows();
   ```

4. [x] **Broadcast a reload after each renderer saves its window state.** Add an `Endpoint` and matching `Api` signature for `reloadAllWindows` in `src/ipc/api-types.ts`, a renderer wrapper in `src/ipc/renderer/api.ts`, and a `Controller` handler plus `bindEndpoint()` registration in `src/ipc/main/core-handlers.ts`. The handler calls the existing `openWindows.send(EventEndpoint.eReloadForLanguage, undefined)` broadcast. Add `eReloadForLanguage` to `EventEndpoint` and `EventApi` in `src/ipc/api-types.ts`, and instantiate its renderer event in `src/ipc/renderer/renderer-events.ts`. In `src/renderer/api/internal/RendererEventsService.ts`, subscribe to that event; its async handler awaits `saveWindowStateForShutdown()` then calls `window.location.reload()`. The existing quit handler also awaits that exported function before `signalReadyToQuit()`. Implement `saveWindowStateForShutdown()` in new file `src/renderer/api/internal/save-window-state.ts` with the current recording stop/cancel, all-page `model.saveState()`, and `pagesModel.saveState()` sequence. A failed save must be logged and must prevent the reload handler from calling `location.reload()`. No per-window acknowledgement is needed: each window performs the save before its own reload. Reloading reruns `src/renderer/i18n/startup.ts`, which reads the persisted language synchronously before importing UI and reports it using the existing `setActiveLocale` endpoint.

5. [x] **Keep main-process UI on the reported locale.** Add English messages for the tray menu labels and the unsaved-navigation confirmation in a main-process area under `src/shared/i18n/en/`, and merge that area in `src/shared/i18n/en/index.ts`. Extend `src/shared/i18n/validate-pack.ts` to validate known keys from every English catalog area (not just `common.*`), preserving unknown-key and placeholder checks. Replace the literals in `src/main/tray-setup.ts` and `src/main/browser-service.ts` with `t()` calls for those catalog keys. `src/main/i18n-locale.ts` already sets the active locale and locale packs before rebuilding the tray; keep the current renderer-report route and let each report rebuild main UI. The unsaved-navigation box in `src/main/browser-service.ts` chooses by result index (`choice === 0` for `Leave`); its response mapping does not compare translated button labels, so translating those labels preserves its behavior. Under `en-XA`, these catalog messages should pseudo-localize with the rest of the runtime.

6. [x] **Expose the setting to scripts and ai-vision.** In `src/renderer/api/types/settings.d.ts`, add documented writable `language: string` for `app.settings.language`, stating that the value is `"auto"` or a BCP-47 code and that changes apply after window reload. The runtime getter/setter in `Settings` must persist direct assignments through `Settings.set()`. The Settings catalog row added in step 1 is the ai-vision namespace entry: `createSettingsElements()` in `src/renderer/scripting/ai-vision/namespaces/settings.ts` derives its English purpose and selector from the catalog. Do not add a new ai-vision member or translate the agent-facing description. Do not add a public available-languages API; the phase-4 `app.languages` surface can own that if needed.

7. [ ] **Verify live through Persephone MCP.** Add no unit tests or harnesses. Claude verifies with MCP-visible Settings navigation and script/settings inspection:
   - The Language section is in Settings under General and ai-vision lists the `language` setting in English.
   - The picker begins with `Automatic (system language)` and shows the resolved language; it includes every built-in and valid user pack with native/English names and completeness.
   - Choosing a language writes `language` to `appSettings.json` before the prompt appears; `Later` keeps the running locale, and `Reload now` reloads every open Persephone window and applies the choice from first paint.
   - With `import.meta.env.DEV` true, `en-XA` appears in the picker and displays after reload. With `import.meta.env.DEV` false, it is never offered; setting stored `"en-XA"` explicitly still resolves to `en-XA` after reload, as US-1647 specifies.
   - A valid `ru` / `ru-*` pack never appears. A malformed pack is also absent. D15 filtering uses the shared validator; do not test this with a Russian-named pack only by its filename.
   - The Automatic label includes the resolved locale's native name (for example, `Automatic (system language) — English`); English remains listed at 100% with no packs. `auto` resolves to English when the system's preferred languages have no available pack and never resolves to `en-XA`.
   - Editing the stored language externally or setting it through the script/MCP surface does not reload windows; the section reports `Applies after reload` when the effective requested locale differs from the running locale.
   - Main tray labels and the unsaved-navigation confirmation follow the latest renderer-reported locale; a normal reload-all makes every window report the same resolved locale. The browser confirmation still chooses `Leave` by button index after translation.
   - In two open windows, edit an untitled page less than one second before choosing `Reload now`; confirm the edit survives in the initiating window and in the second window after both reload.

## Follow-up (2026-10-10, user decision)

The `Reload now` / `Later` prompt was removed after implementation: choosing a language in the
picker saves it and calls `api.reloadAllWindows()` at once. Each window still saves its pages
through `saveWindowStateForShutdown()` before reloading, and main keeps running. Changes made outside
the picker still do not reload and show `Applies after reload`.

## Concerns

- **Pack list refresh:** renderer startup has already loaded packs once, but `src/renderer/i18n/startup.ts` currently keeps its directory reader private. Export a small refresh/list helper so the Settings picker reuses exactly the same JSON5 parsing, warning, validation, and D15/D16 filtering rules. Do not duplicate pack validation in the view.
- **Saving before reload prompt:** settings writes are debounced for 300 ms and `saveSettings()` currently does not await `fs.saveDataFile()`. Add a narrow flush method and make its save path await the file write so reload cannot race the persisted selection.
- **Window state before reload:** the shared `saveWindowStateForShutdown()` sequence explicitly stops/cancels recording, awaits every page's `model.saveState()`, then awaits `pagesModel.saveState()` before either quit readiness or `window.location.reload()`. Every renderer handles the broadcast independently, so no main-process acknowledgement protocol is needed. Keep the sub-second untitled-page edit check in live acceptance to catch regressions against the `saveStateDebounced` window.
- **One main locale for multiple renderers:** `setMainLocale()` is process-global and each startup report replaces it. The most recent report wins. Reload-all converges the reports because each renderer reads the same persisted value; one manually reloaded stale renderer can temporarily become authoritative until another report arrives.
- **Catalog addition changes pack schema surface:** adding `main.*` English keys requires the shared validator to accept those keys. The completeness numerator and denominator must include the new English messages so translated coverage remains meaningful.
- **D12 behavior:** the Settings picker exposes `en-XA` only in development. US-1647 currently honors `en-XA` when explicitly selected in the startup setting; this task's visibility rule applies to the picker and does not add a public pseudo-language API.

## Acceptance Criteria

- Settings shows a Language section under General with an `Automatic (system language)` choice displaying the startup-resolved language, plus English and all valid built-in/user languages by native and English names and integer translation completeness.
- The language list is refreshed from the language folders when the Settings editor mounts, passes through the US-1647 loader/validator, excludes every D15-blocked pack, and shows `en-XA` only when `import.meta.env.DEV` is true. Explicitly stored `en-XA` still works in packaged builds but is never offered there.
- English is present at 100% even when no packs are installed. The Automatic label includes the native name of its resolution; because `resolveLocale("auto", ...)` does not include generated `en-XA` among available packs, that label cannot resolve to `en-XA`.
- Selecting a different value saves `language` before offering `Reload now` / `Later` using stable button ids. Later does not reload; Reload now broadcasts to every live renderer, each renderer runs `saveWindowStateForShutdown()` and calls `window.location.reload()`, and the startup locale is active before the Settings view's first paint.
- An edit made in an untitled page less than one second before Reload now survives in both the initiating and second window.
- Changes made outside the picker do not reload automatically. The section shows `Applies after reload` when the effective requested locale differs from the running active locale.
- Renderer startup reports its resolved locale through existing `setActiveLocale` IPC after every reload. Main adopts the latest report, updates tray and unsaved-navigation copy, and uses that locale until a later renderer report.
- `app.settings.language` is a documented writable script property that persists through the normal settings path; ai-vision's Settings namespace lists the `language` row in English.
- No read-only language-list API, unit tests, or test harness is added. Acceptance is performed live through Persephone MCP.

## Files that need no changes

- `doc/active-work.md` and `doc/epics/EPIC-124.md` — they already link to this task; the task explicitly leaves both untouched.
- `src/shared/i18n/load-packs.ts`, `src/shared/i18n/resolve-locale.ts`, `src/shared/i18n/active-locale.ts`, and `src/shared/i18n/t.ts` — US-1647 already supplies pack loading, D6 resolution, active locale state, and translation runtime.
- `src/main/i18n-locale.ts` and the existing `setActiveLocale` endpoint implementation — these already load main packs and update the main active locale after every renderer startup report.
- `src/renderer/uikit/Select/SelectView.ts`, `src/renderer/editors/settings/sections/settings-native.ts`, and `src/renderer/editors/settings/sections/ThemeSection.ts` — interaction and visual patterns to reuse; no UIKit primitive is required.
- `assets/languages/README.md` and `assets/languages/` — pack format and asset folder are already present; no asset or build-copy change is needed.
- `src/renderer/api/fs.ts` directory and file operations — existing APIs are sufficient for a startup-adapter directory rescan; no new filesystem API is needed.
- `src/main/open-window.ts` — each Persephone window already uses a `BrowserWindow` with renderer startup arguments; add the reload operation in the manager/IPC route, not a second startup locale mechanism here.
- `src/renderer/scripting/ai-vision/namespaces/settings.ts` — its generated setting entries already come from `SETTINGS_CATALOG`; the new row is sufficient and remains English.
- Test directories and harness configuration — do not add unit tests or harnesses; Claude verifies acceptance through Persephone MCP.

## Files Changed

| File | Planned change |
|---|---|
| `doc/tasks/US-1649-language-setting/README.md` | This implementation-ready plan and source-verified findings. |
| `src/renderer/editors/settings/settings-catalog.ts` | Add General / Language section and the English ai-vision `language` row. |
| `src/renderer/editors/settings/SettingsView.ts` | Register the Language section factory. |
| `src/renderer/editors/settings/sections/LanguageSection.ts` | Add picker, native/English names, completeness, resolved Automatic label, pending-reload state, persistence-before-prompt behavior, and reload action. |
| `src/renderer/i18n/startup.ts` | Export a helper that refreshes and returns validated built-in/user pack metadata for the picker. |
| `src/renderer/api/settings.ts` | Add a direct `language` getter/setter, revise the setting comment, and export `flushSettingsSave()` for the picker. |
| `src/renderer/api/types/settings.d.ts` | Type and document `app.settings.language`. |
| `src/ipc/api-types.ts` | Declare the reload-all-windows IPC endpoint, `eReloadForLanguage` event, and event type. |
| `src/ipc/renderer/api.ts` | Add the renderer wrapper for reload-all-windows. |
| `src/ipc/main/core-handlers.ts` | Handle and bind reload-all-windows by broadcasting `eReloadForLanguage` through existing `openWindows.send()`. |
| `src/ipc/renderer/renderer-events.ts` | Register the renderer-side `eReloadForLanguage` event. |
| `src/renderer/api/internal/save-window-state.ts` | Extract the recording stop/cancel and page state save sequence into `saveWindowStateForShutdown()`. |
| `src/renderer/api/internal/RendererEventsService.ts` | Reuse the extracted save function for quit and subscribe to language reload events to save then call `window.location.reload()`. |
| `src/shared/i18n/en/main.ts` | Add typed English catalog messages for tray and unsaved-navigation UI. |
| `src/shared/i18n/en/index.ts` | Merge the main-process catalog area into the typed English catalog. |
| `src/shared/i18n/validate-pack.ts` | Accept keys from all English catalog areas, including `main.*`. |
| `src/main/tray-setup.ts` | Render tray labels through the active shared locale. |
| `src/main/browser-service.ts` | Render the unsaved-navigation confirmation through the active shared locale. |
