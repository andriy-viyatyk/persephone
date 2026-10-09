# US-1647: i18n core

**Epic:** [EPIC-124 — Localization foundation](../../epics/EPIC-124.md)  
**Roadmap:** [Localization roadmap](../../localization-roadmap.md)  
**Status:** In Progress

## Goal

Build the process-neutral translation runtime, typed English seed catalog, validated language-pack model and loader, startup locale selection, D15/D16 filtering, and `en-XA`. This is infrastructure only; UI string extraction and user-facing language selection belong to later tasks.

## Background

There is no i18n layer today. D1–D16 in the localization roadmap are accepted. This task implements the US-1647 portion of EPIC-124: typed English keys, `t()`, placeholder and plural handling, pack validation and per-key layering, startup locale, D15 blocked-language validation, D16 filtering, and pseudo-language support. UI extraction, the Settings picker, formatting, lint/check tooling, and board localization belong to later tasks/phases.

### Verified shared-code boundary

`src/shared/` is imported by both processes today: `src/main/open-windows.ts` imports `../shared/utils` and `../shared/types`; renderer examples include `src/renderer/scripting/AutoloadRunner.ts` importing `../../shared/utils` and `src/renderer/content/open-handler.ts` importing `../../shared/link-data`. The shared tree has no Node, Electron, DOM, `window`, or `document` dependencies. Keep catalog, runtime, pack types/validation, locale resolution, filters, and hashing process-neutral; filesystem and Electron access stay in process-specific adapters.

### Startup settings and locale handoff

`src/renderer/theme/themes/index.ts:107-124` calls `readStartupThemeId()` during module evaluation and synchronously reads `%APPDATA%/persephone/data/appSettings.json` before first paint; its custom-theme reads at `:32-41` also use `require("fs")`. `doc/standards/coding-style.md` explicitly allows `themes/index.ts` as a direct-`fs` exception for this startup need. Add `src/renderer/i18n/startup.ts` to that exception list. It reads `language` and pack files synchronously using Node `fs`, with path operations through `src/renderer/core/utils/file-path.ts`. Use `parseJSON5()` from `src/renderer/core/utils/parse-utils.ts` consistently for settings and pack JSON5/comment handling; that module only imports JSON5 and defines pure parse helpers, so it is safe to import before renderer UI startup. Do not copy the theme reader's comment-removal regex.

Add the bare `language` setting type, comment, default (`"auto"`), and startup read here so locale resolution has a persisted value. Developers enable `en-XA` by directly setting `"language": "en-XA"` in `appSettings.json` and restarting; no picker or extra switch is needed. **US-1649 remains responsible for** the Settings picker and language list/completeness UI, apply/reload prompt and all-window reload behavior, script API/type and ai-vision exposure, and synchronization through the regular settings actuation path. It builds on the setting key added here.

Main must not read `appSettings.json`: `src/main/open-windows.ts:89-93` states that main never loads it and settings are resolved in the renderer. D5 also reloads windows without restarting main, so a main-side settings read would leave main UI stale. The renderer resolves locale first, then reports only its resolved locale code to main through the existing async IPC request/reply pattern (`executeOnce()` in `src/ipc/renderer/api.ts`, typed by `Endpoint`/`Api` in `src/ipc/api-types.ts` and bound through `bindEndpoint()` in `src/ipc/main/core-handlers.ts`). Add a `setActiveLocale(code)` endpoint. Main starts in English; on each report it loads built-in and user packs synchronously through the shared validator and D16 filter, sets its own active locale, then rebuilds localized main UI such as the tray menu. This report updates main after every renderer startup/reload without a main settings read or JSON5 dependency.

### Assets and filesystem paths

`src/main/utils.ts:getAssetPath()` resolves assets to `<project-root>/assets` in development and `process.resourcesPath/assets` in packaged builds. Main already uses it for `icon.png`; guides and bundled board assets are resolved from that root in `src/main/mcp/ai-vision/guide-source.ts` and `src/main/board-storage.ts`. `electron-builder.yml` copies `assets` to `resources/assets` through `extraResources`, so `assets/languages/` ships without a new copy rule. `vite.renderer.config.ts` builds renderer assets but does not need a language-specific copy rule.

The renderer has `nodeIntegration: true` and `contextIsolation: false` in `src/main/open-window.ts`. Electron's `WebPreferences.additionalArguments` documentation in the installed Electron 43 declarations (`node_modules/electron/electron.d.ts`, `WebPreferences.additionalArguments`) says these arguments are appended to renderer `process.argv`; use that verified behavior. Pass only `app.getPreferredSystemLanguages()` and `getAssetPath("languages")` through `webPreferences.additionalArguments`; `src/renderer/i18n/startup.ts` reads those arguments from `process.argv`. `app.getPreferredSystemLanguages()` is the ordered user preference list required by D6; `app.getLocale()` is Chromium's current application locale and is not a replacement.

User packs live under `<userData>/data/languages/`, the same location represented by `fs.resolveDataPath("languages")` and Windows `%APPDATA%/persephone/data/languages/`. Renderer startup reads synchronously from the data root using the existing renderer startup filesystem precedent. Main uses `getDataFolder()` and reads `<userData>/data/languages/` synchronously after receiving the locale report. No preload snapshot or new `window.electron`/`window.d.ts` fields are needed.

Keep `assets/languages/` in source with a short `assets/languages/README.md` describing the `<code>.lang.json` pack format. Do not add `assets/languages/en.lang.json`: D1 makes the typed TypeScript catalog the one English source, and a JSON copy would drift. A developer-created pack placed in this folder in development is used to live-check the built-in loader.

### Pack storage precedent and watcher decision

`src/renderer/api/custom-theme-storage.ts` demonstrates `fs.resolveDataPath("themes")`, directory creation/listing, per-file parse/validation with warnings, atomic sibling-temp writes, and `DirectoryWatcher`. US-1647 loads packs but has no save/import/editor operations. Under D5, a language change reloads windows and startup reloads packs; the Language Editor arrives in phase 4. Do not add a language-directory watcher here.

### Pack identity and rejection rules

Every built-in or user pack file must be named `<code>.lang.json`, with the filename code matching the pack's `code` case-insensitively. If it does not match, skip the file and warn. This filename check is separate from D15: D15 rejects a pack based on its metadata regardless of its file name.

**D15 blocked-language rule:** codes `ru`, `ru-*`; names `Russian`, `Русский`, `Руский`, trimmed, case-insensitive; rejected as a whole with a clear message; exported for reuse. Apply the same shared validator to built-in and user packs. Unsupported Russian system preferences resolve to English.

**D16 non-built-in filter:** Apply once when loading every pack that is not built in (user packs in this task; export the filter for board packs in phase 3). Never filter built-in packs. First apply D15 validation. Normalize words by lowercasing, mapping `ё` to `е`, and mapping Latin look-alikes `a/e/o/p/c/x/y` to Cyrillic `а/е/о/р/с/х/у`; tokenize as whole Unicode-letter words and compare each normalized word's FNV-1a hash against a deny-list stored as hashes only in source. The source list must not contain plain Russian words. At this seed-list size, a 32-bit FNV-1a collision is negligible and no collision-resolution table is needed; this is a filtering signature, not a security boundary.

Seed the list with these Russian-only UI words; the columns show their distinct Ukrainian and Belarusian equivalents, so they do not match those languages as whole words:

| Russian seed word (plain words are documentation only) | Ukrainian equivalent | Belarusian equivalent |
|---|---|---|
| открыть | відкрити | адкрыць |
| сохранить | зберегти | захаваць |
| удалить | видалити | выдаліць |
| закрыть | закрити | закрыць |
| настройки | налаштування | налады |
| поиск | пошук | пошук |
| отмена | скасувати | адмена |
| копировать | копіювати | капіяваць |
| вставить | вставити | уставіць |
| создать | створити | стварыць |

Also mark a pack if any message contains at least one of `ы э ё` and at least one of `и щ ъ` (either case). In a marked pack, replace every `ъ ы э ё` (either case) in every message with `▒`. Replace each deny-list word match with `▒` repeated to that word's Unicode character length. Run the word filter on the original message text first, then the letter rule, so a scrambled letter never hides a deny-list word. Filtering is performed on message text only, never on keys, metadata, placeholder names, or plural category keys.

### Plural rules and source hashes

Use `Intl.PluralRules(locale).select(count)` with `params.count` as the explicit plural selector. Plural messages support CLDR categories (`zero`, `one`, `two`, `few`, `many`, `other`), while an individual message may omit categories it does not need. The English seed uses only the English categories `one` and `other`. The relevant locale tags are `be`, `uk`, `pl`, `lt`, `lv`, `et`, `ro`, `sk`, `hu`, `de`, `fr`, `es`, `pt-BR`, `it`, `zh-CN`, `ja`, and `ko`. Electron 43 uses Chromium/V8 `Intl` backed by ICU, but this repository does not establish which ICU data is present in the installed Castlabs build; Claude must live-check all listed tags with `Intl.PluralRules` in the actual Electron renderer and main runtime during acceptance.

D7 `source` hashes need to be synchronous and identical in both processes. Add a small dependency-free 32-bit FNV-1a helper in `src/shared/i18n/hash.ts` that hashes the canonical English message representation (string as-is; plural object serialized in stable category order) as UTF-16 code units and emits eight lowercase hexadecimal digits. It is a change/staleness hint, not a security hash. Reuse it for D16 word hashes.

### Active-locale state

Keep the active locale as a process-local scalar in `src/shared/i18n/active-locale.ts`, initialized synchronously in the renderer and set in main after its locale report. Expose a getter for `t()` and later formatting/board integrations. Do not use `src/renderer/core/state/`: D5 makes language changes a window reload, so renderer subscriptions are unnecessary and would not serve main.

## Implementation Plan

1. [x] **Create the typed English source catalog** in `src/shared/i18n/en/common.ts` and `src/shared/i18n/en/index.ts`. Seed `common.ok`, `common.cancel`, `common.loading`, and `common.items`; define `common.items` as `{ one: "{count} item", other: "{count} items" }`. English uses only `one`/`other`. Include optional translator-note metadata in the catalog type, merge area catalogs, derive `MessageKey` from the merged catalog, and derive placeholder names from English messages. Do not extract existing UI call sites.

2. [x] **Implement the shared runtime** in `src/shared/i18n/t.ts`, `src/shared/i18n/active-locale.ts`, `src/shared/i18n/plurals.ts`, and `src/shared/i18n/hash.ts`. Export synchronous typed `t(key, params?)`; resolve each key user pack → built-in pack → English → key itself, substitute `{name}` placeholders, and select plural form with cached `Intl.PluralRules(activeLocale).select(params.count)` before falling back to `other`. Keep the runtime free of Node, Electron, and DOM imports.

   **Before → after use:**

   ```ts
   // Before: no translation runtime exists; callers embed text directly.
   const label = "Loading…";

   // After: later extraction tasks can use a typed shared key.
   const label = t("common.loading");
   ```

3. [x] **Add pack schema, validation, D15, D16, and layering** in `src/shared/i18n/pack.ts`, `src/shared/i18n/validate-pack.ts`, `src/shared/i18n/resolve-message.ts`, and a shared filter module under `src/shared/i18n/`. Model `<code>.lang.json` with `schemaVersion: 1`, `code`, `name`, `englishName`, optional `direction: "ltr"`, `messages`, and `source`. Reject malformed packs; drop unknown keys and entries whose placeholder set differs from English with warnings. Reject and skip an entire file if its name is not `<code>.lang.json` or its code does not match the filename case-insensitively. Implement D15 exactly as stated above, independent of the filename check. For accepted non-built-in packs, apply the D16 word-hash and letter filters once at load; do not filter built-ins. Export the D15 predicate and D16 filter for later save/import/bridge/board consumers. Never load Monaco's Russian NLS file or resolve `"auto"` to Russian.

4. [x] **Add pack loading and pseudo-language generation** in `src/shared/i18n/load-packs.ts` and process-specific startup adapters. Parse with JSON5 consistently, isolate malformed files with warnings, and resolve per-key user → built-in → English. Generate `en-XA` from English at runtime by accenting letters, wrapping with brackets, and padding approximately 35%; do not alter placeholder names inside `{…}` or plural category keys. Keep `en-XA` hidden from normal language listings and honor it when explicitly selected in `appSettings.json`.

5. [x] **Resolve renderer locale synchronously and report it to main.** Add `language` to the `AppSettingsKey` union, `settingsComments`, and `defaultAppSettingsState` in `src/renderer/api/settings.ts`; default it to `"auto"`. In `src/renderer/i18n/startup.ts`, synchronously read the setting and built-in/user packs with `require("fs")`, using `file-path` for paths and `parseJSON5()` for JSON5/comment handling. Resolve `"auto"` by walking preferred system languages in order and matching exact code → base code → English; fixed BCP-47 values match exact → base → English. Normalize code casing consistently with pack codes. `src/main/open-window.ts` passes only `app.getPreferredSystemLanguages()` and `getAssetPath("languages")` as `webPreferences.additionalArguments`; renderer startup reads them from `process.argv`, which Electron 43 appends arguments to with `nodeIntegration` enabled. Add `src/renderer/i18n/startup.ts` to the direct-`fs` exception list in `doc/standards/coding-style.md`. Import startup first from `src/renderer.ts`, before any UI module can produce translated strings. Initialize the renderer's shared active locale and pack state, then report the resolved code through the new async `setActiveLocale(code)` IPC endpoint.

6. [x] **Initialize main locale from the renderer report.** Main remains English until the first renderer report. Add the `setActiveLocale` endpoint to `Endpoint`/`Api` in `src/ipc/api-types.ts`, implement the request in `src/ipc/renderer/api.ts`, and handle it in `src/ipc/main/core-handlers.ts` using the existing `executeOnce()`/`bindEndpoint()` request/reply pattern. Add `src/main/i18n-locale.ts` to load packs synchronously from `getAssetPath("languages")` and `<userData>/data/languages/` through the shared validator and D16 filter, set main's active locale to the reported code, and rebuild localized main UI such as the tray. Initialize the default English tray before the first report, and rebuild it on every report/reload. Main does not read `appSettings.json` and does not use JSON5 for startup settings.

7. [x] **Keep and live-check the asset directory.** Add `assets/languages/README.md` with the pack format. Do not add an English JSON pack: TypeScript is the sole English source under D1. `electron-builder.yml` already copies the complete `assets` directory to `resources/assets`; no builder or Vite copy change is needed. In acceptance, put a developer-created valid pack under `assets/languages/` in development and confirm the built-in loader sees it in renderer and main.

8. [x] **Expose the actual renderer runtime for live inspection.** Do not import `src/shared/i18n/t.ts` by path from `script.execute`, which creates a second uninitialized module instance. In development only, `src/renderer/i18n/startup.ts` installs a frozen, read-only `globalThis.__persephoneI18nDebug` containing the actual runtime's `t`, active-locale getter, and plural-category probe. Claude uses that hook through Persephone MCP `script.execute`; no public `app.languages` API is added.

9. [ ] **Verify live without a test suite.** Do not add unit tests or a test harness. Place malformed and D15-blocked user packs under `<userData>/data/languages/`; use a `uk` user pack whose `common.items` forms name their category to exercise `t()` with counts `1, 2, 5, 11, 21, 22`. Also call `Intl.PluralRules(code).select(n)` directly for each of `uk`, `pl`, `lt`, and `lv` at those counts. Expected category sequences are `uk: one, few, many, many, one, few`; `pl: one, few, many, many, many, few`; `lt: one, few, few, other, one, few`; `lv: one, other, other, zero, one, other`. Check all listed plural locales live in actual Electron 43 renderer and main. Verify placeholder substitution, unknown-key fallback, layering, `en-XA`, source-hash parity, malformed-file isolation, and warnings.

## Concerns

- **First paint and main UI use separate startup paths.** Renderer reads settings and packs synchronously before UI imports; main starts English and adopts the renderer's resolved code over async IPC, then reloads its own pack data and rebuilds the tray. Main never reads `appSettings.json`.
- **D16 marker fixture must satisfy the exact pack rule.** `Открыть объект` contains `ъ` and `и`, but does not by itself contain `ы`, `э`, or `ё`; include a separate message containing both a letter from `ы э ё` and one from `и щ ъ` to mark the pack, then verify `ъ ы э ё` are scrambled in every message including `Открыть объект`.
- **ICU coverage is a live acceptance check.** The repository identifies Electron 43 and Castlabs ECS but does not establish the exact ICU data baked into the installed build. Verify requested locales in both renderer and main before acceptance.
- **No pack watcher is needed.** D5 reloads windows on a language change; pack edits are picked up on startup. The phase 4 editor and apply/reload flow own later editing behavior.
- **No unit tests are part of this project.** Verify acceptance live with Persephone MCP `script.execute` through the real renderer runtime hook.

## Acceptance Criteria

- `src/shared/i18n/` imports from both `src/main/` and `src/renderer/` and has no Node, Electron, or DOM API use.
- The TypeScript English catalog is the sole English source; `MessageKey` derives from it. `common.items` has English `one` and `other` forms and selection explicitly uses `params.count`. `t()` substitutes placeholders, selects CLDR plurals, and falls back per key user → built-in → English → key without throwing for missing keys or malformed external packs.
- The renderer resolves locale synchronously before UI strings are produced. The renderer reads `language` and packs synchronously using the direct-`fs` exception in `src/renderer/i18n/startup.ts`; JSON5/comment parsing uses `parseJSON5()`. Electron's `additionalArguments` supply only preferred languages and asset directory via `process.argv`; there are no preload snapshot fields or `window.d.ts` additions.
- Main never reads `appSettings.json`. It stays English until a renderer reports its resolved locale over `setActiveLocale`; it then loads built-in/user packs through the shared validator and D16 filter and rebuilds the tray. A window reload reports the locale again and updates main without restarting the app.
- A valid developer-created pack placed in `assets/languages/` in development is loaded by renderer and main; packaged builds place assets under `resources/assets/`. User packs load from `<userData>/data/languages/`. The source tree contains `assets/languages/README.md` and no `assets/languages/en.lang.json`.
- Each pack filename is `<code>.lang.json`, and its code matches the filename case-insensitively; otherwise it is skipped with a warning. This is independent of D15 rejection.
- D15 rejects a whole pack with a clear diagnostic when codes are `ru` or `ru-*`, or trimmed case-insensitive names are `Russian`, `Русский`, or `Руский`. The predicate is exported for reuse. A malformed user pack and user packs with Russian code/name in the data directory are rejected while the app remains usable.
- D16 source contains only hashes for its seed words. A user pack with another code/name containing a seed word shows that whole word scrambled. A marked pack containing `Открыть объект` and a separate message with both marker letter groups has every `ъ ы э ё` in every message replaced with `▒`. Six Ukrainian samples (`відкрити файл`, `зберегти зміни`, `видимий елемент`, `закрити вікно`, `налаштування пошуку`, `Що шукати?`) pass unchanged, including samples containing `и` and `щ`. Six Belarusian samples (`Адкрыць файл`, `Захаваць змены`, `Выдаліць элемент`, `Ёсць налады`, `Элемент у спісе`, `Ўключыць пошук`) pass unchanged, including samples containing `ы`, `э`, `ё`, and `ў`.
- `en-XA` is enabled by setting `language` to `en-XA` and restarting; it accents, brackets, and pads messages while preserving placeholders, placeholder names inside `{…}`, plural category keys, and plural selection. It stays out of normal language listings.
- A `uk` user pack with category-named `common.items` forms returns the right `t()` form for counts `1, 2, 5, 11, 21, 22`. Direct `Intl.PluralRules` probes for `uk`, `pl`, `lt`, and `lv` return the category sequences in implementation plan step 9 in both renderer and main; all listed locale tags are checked in actual Electron 43 runtime.
- The FNV-1a source hash is synchronous, stable across renderer and main, and eight lowercase hexadecimal digits. The same helper produces D16 word hashes.
- No UI strings are extracted; no Settings picker/reload prompt, public language API, formatting helper, localization lint/check script, DirectoryWatcher, unit test, or test harness is added. Acceptance is verified live by Claude through Persephone MCP `script.execute`.

## Files that need no changes

- `doc/active-work.md` and `doc/epics/EPIC-124.md` — dashboard and epic already link here; do not edit either.
- `src/renderer/api/custom-theme-storage.ts` and `src/renderer/core/utils/file-watcher.ts` — storage precedent only; a watcher is not needed under D5.
- `vite.renderer.config.ts` and `electron-builder.yml` — no language-specific copy change is needed; the existing builder rule ships all of `assets`.
- `src/preload.ts` and `src/renderer/types/window.d.ts` — Electron 43 appends `additionalArguments` to renderer `process.argv`; no preload snapshot or bridge/type additions are needed.
- `assets/languages/en.lang.json` — deliberately not created because the TypeScript catalog is the sole English source.
- `src/renderer/editors/settings/**`, `src/renderer/ui/dialogs/**`, and other UI call sites — extraction is US-1652/phase 2.
- `src/renderer/api/types/settings.d.ts`, settings picker UI, `src/renderer/core/utils/format.ts`, ESLint config, and package scripts — public setting exposure/picker is US-1649; formatting is US-1650; lint/check is US-1651.
- `assets/board-template/**`, `src/board-shim.ts`, `src/main/board-bridge.ts`, and board host code — board locale transport is phase 3; only the D16 filter is exported for reuse then.
- Test directories and harness configuration — this project does not use unit tests; acceptance is live through MCP.

## Files Changed

| File | Planned change |
|---|---|
| `doc/tasks/US-1647-i18n-core/README.md` | This implementation-ready task plan and source-verified findings. |
| `src/shared/i18n/en/common.ts` | Minimal typed `common.*` English seed strings, notes, and realistic English plural forms. |
| `src/shared/i18n/en/index.ts` | Merge area catalogs and derive English catalog/message key types. |
| `src/shared/i18n/t.ts` | Synchronous typed `t()` placeholder/plural/fallback runtime. |
| `src/shared/i18n/active-locale.ts` | Process-local active-locale scalar and getter/initializer. |
| `src/shared/i18n/plurals.ts` | CLDR category selection and `Intl.PluralRules` cache. |
| `src/shared/i18n/hash.ts` | Synchronous dependency-free FNV-1a source and D16 word hash. |
| `src/shared/i18n/pack.ts` | Language-pack and plural-message types. |
| `src/shared/i18n/validate-pack.ts` | Shape, filename/code, key, placeholder checks and exported D15 blocker. |
| `src/shared/i18n/filter-pack.ts` | D16 normalized-word hash list, marker detection, and message scrambling; exported for phase 3. |
| `src/shared/i18n/resolve-message.ts` | Per-key user → built-in → English resolution. |
| `src/shared/i18n/resolve-locale.ts` | D6 exact/base/English matching. |
| `src/shared/i18n/load-packs.ts` | Shared pack-ingestion orchestration over process-supplied file data. |
| `assets/languages/README.md` | Keep the empty built-in pack folder and describe the pack format; no English JSON copy. |
| `src/renderer/i18n/startup.ts` | Synchronous setting/pack reads, active locale initialization, IPC report, and development-only live debug hook. |
| `src/renderer.ts` | Import i18n startup before modules that may produce UI strings. |
| `src/renderer/api/settings.ts` | Add `language` key type/comment/default; leave picker/reload to US-1649. |
| `doc/standards/coding-style.md` | Add `src/renderer/i18n/startup.ts` to the documented direct-`fs` startup exception list. |
| `src/main/open-window.ts` | Pass preferred-language list and `getAssetPath("languages")` through `webPreferences.additionalArguments`. |
| `src/main/i18n-locale.ts` | Receive resolved locale, synchronously load main packs through shared validation/filtering, update active locale and tray strings. |
| `src/main/tray-setup.ts` | Rebuild localized tray labels when main receives a locale report. |
| `src/ipc/api-types.ts` | Type the `setActiveLocale` async endpoint. |
| `src/ipc/renderer/api.ts` | Report resolved locale through the existing `executeOnce()` request/reply pattern. |
| `src/ipc/main/core-handlers.ts` | Bind the `setActiveLocale` endpoint to the main i18n locale handler. |
