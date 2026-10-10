# US-1676: `app.languages` read side

## Goal

Expose the current and available interface language packs, English source messages, pack audits, and validation through typed `app.languages` scripting methods and the ai-vision `languages.*` namespace. Keep the read API bounded and compatible with the write methods planned in US-1677.

## Background

### Pack model and lookup

`src/shared/i18n/pack.ts` defines `LanguagePack` as `{ schemaVersion: 1, code, name, englishName, direction?, messages, source? }`, where messages are partial `MessageKey` maps of strings or plural-category records. `src/shared/i18n/validate-pack.ts` exports `validateLanguagePack(input, filename)`, `parsePackMessage`, `messagePlaceholders`, and `hasSamePlaceholders`. Validation normalizes BCP-47-like codes, warns and omits unknown keys, malformed messages and placeholder mismatches, and returns a normalized pack plus warnings. `src/shared/i18n/load-packs.ts` applies this validator to a list of filename/value pairs and aggregates packs and warnings. Preserve these warning semantics for `validate(pack)`; do not make a second pack validator.

`src/shared/i18n/t.ts` resolves each key through `resolveMessage` using the user pack, built-in pack, then English fallback. `src/shared/i18n/hash.ts` provides `hashEnglishMessage` (FNV-1a hash over canonical plural forms). `src/shared/i18n/resolve-locale.ts` resolves explicit locales or `auto` against available packs and preferred OS language tags; English always resolves, and `en-XA` is special-cased. `src/shared/i18n/en/index.ts` exposes the keyed English messages, while each area module (for example `src/shared/i18n/en/common.ts`) retains `EnglishCatalogEntry { message, note? }`, plural forms, and translator notes. English source inspection must use the entry catalogs so it does not lose notes; hashes must come from `hashEnglishMessage`.

### Runtime state and completeness

`src/renderer/i18n/startup.ts` synchronously reads built-in packs from the startup asset directory and user packs from `%APPDATA%/persephone/data/languages`, validates both with `loadLanguagePacks`, chooses the active locale from the `language` setting and startup OS preferences, then installs the active user/built-in pack pair. It also exports `refreshLanguagePacks()`, which asynchronously obtains the same directories through the IPC API and re-reads them with the shared validator. Use this refresh function for live `list()`, `get()`, `missing()`, and `stale()` reads rather than duplicating filesystem path discovery. It is the same source used by the Settings language picker. `src/main/i18n-locale.ts` independently reads these same directories in main and uses the renderer-reported active locale to update main-process strings and the tray; it is not the renderer scripting API's source of pack metadata.

`src/renderer/editors/settings/sections/LanguageSection.ts` contains the exact current completeness calculation: count all English catalog keys, union the `messages` keys across built-in and user packs with the same code, then round `100 * translatedKeys / totalKeys`. Extract that calculation into a shared helper and call it from both the picker and `list()` so they cannot drift. The picker always includes `auto` and synthetic `en` at 100%; `en-XA` is listed only in development and also reports 100%. Return `en` as an always-available synthetic English entry even though it has no `.lang.json` pack. Include the pseudo locale only in development, matching Settings; do not present `auto` as a pack entry. For duplicate codes, show the user pack's metadata and set `overridesBuiltIn: true`; preserve whether built-in and user files are present separately.

`getActiveLocale()` in `src/shared/i18n/active-locale.ts` is the effective renderer locale. `current` should return `{ code: activeCode, requested: settings.get("language"), selection: "auto" | "setting" }`, so agents can distinguish a user-selected code from OS resolution without confusing `auto` with the effective code. The script API can read `settings.language`; resolve the effective value with the same locale state already set at startup.

### Board validation

`src/renderer/editors/board/board-i18n.ts` exports `loadBoardI18n(boardRoot, languages?)`. Its checks read `lang/<code>.json` through `app.fs`, parse JSON, require a `messages` object, validate non-empty keys, accept reserved `manifest.*` values only as plain strings without placeholders, parse string/plural messages, and for non-default packs reject non-manifest keys missing from the default table or with different placeholder sets. It loads requested, base-language and default tables and emits a warning if the default file is missing or unreadable. Extract the raw board-pack parsing and default-comparison checks into shared exported functions in this module (or a closely scoped shared board-i18n module), then have both `loadBoardI18n()` and `validateBoard()` call them. `src/renderer/editors/board/board-manifest.ts` exports `readNormalizedBoardManifest(root)`, which reads and normalizes the manifest including `languages`; `normalizeBoardLanguages()` supplies the default folder `lang` and default code `en`. Do not duplicate these checks in the API or change the bridge contract. `validateBoard(boardRoot, code)` should use this manifest path, validate the requested `lang/<code>.json` against that board's declared default, and return the same board-host warnings without changing the active app locale. If the board has no `languages` configuration, return a clear validation warning/result rather than inventing a board pack format.

### Shared missing/stale audit

`scripts/i18n-check-entry.ts` currently computes missing keys by comparing each validated pack's message keys against all English keys, and stale keys by comparing `pack.source[key]` with `hashEnglishMessage(currentEnglish)`. That logic is currently private to `reportPack()`. Move the reusable computation into a new shared helper such as `src/shared/i18n/audit-pack.ts` and use it from the API. US-1678 will then update `scripts/i18n-check-entry.ts` to reuse that helper for each individual built-in pack while preserving its report. The helper should accept one already validated pack and an optional area filter, and return missing keys/count, stale hash-mismatch keys/count, and `unverified` count for translated messages without a source hash. For `missing(code)` / `stale(code)`, audit the effective merged language pack (user keys take precedence, then built-in keys) so a partial user override does not make existing built-in translations appear missing. An absent hash is unverified, not stale; only a present hash differing from the current English hash is stale. `missing("en")` and `stale("en")` return empty results. An unknown code returns `{ code, keys: [], count: 0, warning: "No pack for <code>" }` (plus `unverified: 0` for stale), never all English keys.

### Script and MCP integration

`src/renderer/api/types/app.d.ts` is the public script contract. Each app service also has a public interface in `src/renderer/api/types/*.d.ts` and a service descriptor in `src/renderer/api/app-service-registry.ts`; `src/renderer/api/app.ts` loads those services, and `src/renderer/scripting/api-wrapper/AppWrapper.ts` exposes descriptor-backed services directly to scripts. Add `languages` to `IApp`, implement a small renderer API facade in `src/renderer/api/`, and register it in the service table. The service registration and wrapper's exhaustiveness checks will require the contract, registry and runtime service to agree. `vite.renderer.config.ts`'s `editorTypesPlugin` copies API declarations into `assets/editor-types/` and regenerates `_imports.txt` during dev/build; update only `src/renderer/api/types/*.d.ts`, never hand-edit the generated copy.

The MCP object model is the ai-vision tree in `src/renderer/scripting/ai-vision/`. `src/renderer/scripting/ai-vision/namespaces/themes.ts` and `settings.ts` show how to declare `IAiMember`s, return an `IAiVisionDescriptor`, supply custom member values, and author `$help`. Register the language facade with `registerAiVisionFor()` in `src/renderer/scripting/ai-vision/namespaces/index.ts`; add the root `languages` node in `src/renderer/scripting/ai-vision/root.ts` so it is discoverable alongside settings and themes. Keep all summaries, validation warnings, signatures, and `$help` in English per roadmap D3. This task adds no translated catalog messages because it adds no user-visible UI.

`src/renderer/scripting/ai-vision/call-limits.ts:5` documents that ai-vision `call` results default to `DEFAULT_MAX_LENGTH` (20,000 characters) and silently clip longer results; arrays and depth also have independent caps. `src/shared/i18n/en/settings.ts` is 14,407 bytes of source for 205 entries, and its serialized entries with full keys, placeholders, notes, and hashes exceed that limit. Therefore `english(area, options?)` requires an area and always pages results; `areas()` is the only area-directory call. Use `{ area, total, offset, entries, next? }`, with offset defaulting to 0, limit defaulting to 100, and limit capped at 200; `next` is the next offset when more entries remain and is omitted on the final page. Each entry is `{ key, message, placeholders, note?, sourceHash }`, where plural `message` stays a category object and placeholders are the sorted unique set across its forms. `areas()` entries are `{ area, count }`. `src/renderer/scripting/api-wrapper/AppWrapper.ts` makes direct script `app.call()` unbounded unless the caller supplies `maxLength`, but the same bounded method results must work over MCP. All disk-reading methods are asynchronous because `refreshLanguagePacks()` is async; `current`, `areas()`, `english()`, and `validate()` stay synchronous.

### Before → after API shape

```ts
// Before: no public language-pack namespace.
interface IApp { /* settings, themes, editors, ... */ }

// After (planned): bounded reads; write methods can later be added to this same object.
interface IApp { readonly languages: ILanguages; }
interface LanguagePageOptions { offset?: number; limit?: number; } // default limit 100; maximum 200
interface EnglishMessagePage {
  area: string; total: number; offset: number;
  entries: EnglishCatalogEntryView[]; next?: number;
}
interface ILanguages {
  list(): Promise<LanguageSummary[]>;
  readonly current: { code: string; requested: string; selection: "auto" | "setting" };
  get(code: string): Promise<LanguageMetadata | undefined>;
  get(code: string, area: string, options?: LanguagePageOptions): Promise<LanguageMessagePage | undefined>;
  areas(): LanguageAreaSummary[];
  english(area: string, options?: LanguagePageOptions): EnglishMessagePage;
  missing(code: string, area?: string): Promise<LanguageAudit>;
  stale(code: string, area?: string): Promise<StaleLanguageAudit>;
  validate(pack: unknown): PackValidationView;
  validateBoard(boardRoot: string, code: string): Promise<BoardValidationView>;
}
```

`list()` reports normalized code, native/English names, completeness, `builtIn`, `user`, and `overridesBuiltIn`. `get(code)` returns metadata only: `{ code, name, englishName, builtIn, user, overridesBuiltIn, counts: { user, builtIn, total } }`. `get(code, area, options?)` returns that area's translated messages only, with user values overriding built-in values; entries include `{ key, message, from: "user" | "builtIn" }` and use the same page envelope and limits as English. The `total` count is the distinct translated-key count after user precedence. Never include English fallback in `get`; `missing()` reports untranslated keys. `validate(pack)` returns `{ valid, pack?, warnings }`; derive the filename as `${input.code}.lang.json` from a string `code` on the input before calling `validateLanguagePack()`. If `code` is missing or not a string, return a clear warning that a string pack code is required; this prevents a valid pack from failing a fabricated filename/code mismatch. `missing` returns `{ code, area?, keys, count, warning? }`; `stale` returns `{ code, area?, keys, count, unverified, warning? }`. Do not embed full English or translated messages in audit results.

## Implementation Plan

1. [x] **Add shared i18n helpers.** Create `src/shared/i18n/language-completeness.ts` with the current count/union/round calculation and use it in both `src/renderer/editors/settings/sections/LanguageSection.ts` and the language facade. Preserve the picker behavior exactly: same percentage rounding, synthetic `en` at 100%, and DEV-only `en-XA` at 100%. Create `src/shared/i18n/audit-pack.ts` with common missing/stale computation, area filtering, and a serializable result. Return hash mismatches separately from `unverified`, the translated-key count with no `source` hash. Factor English key/hash lookup so missing and stale results use the same English source set. This is the shared source of missing/stale logic for the API and for US-1678, which will update `scripts/i18n-check-entry.ts` to call it while preserving the current console report and exit behavior and reporting those categories distinctly.
2. [x] **Extract board validation checks.** Refactor `src/renderer/editors/board/board-i18n.ts` so pack parsing/shape validation and requested-versus-default checks are reusable without calling `getActiveLocale()`. Keep `loadBoardI18n()`'s current requested/base/default resolution and warnings by composing those shared checks. Add a validation entry point that takes `boardRoot` and `code`, reads the normalized manifest through `readNormalizedBoardManifest()` in `src/renderer/editors/board/board-manifest.ts`, and returns `{ boardRoot, code, defaultCode, valid, warnings }`. Validate the requested pack against default; when `code === defaultCode`, validate the default pack's own shape without comparing it against itself. Explicitly warn if `lang/<code>.json` is missing. Preserve manifest-key exceptions and placeholder/plural behavior. Do not edit `src/ipc/board-bridge-channels.ts`, board shim APIs, or `BOARD_BRIDGE_VERSION`.
3. [x] **Implement the renderer read facade.** Add `src/renderer/api/languages.ts` (and its export) to provide `list`, `current`, `get`, `areas`, `english`, `missing`, `stale`, `validate`, and `validateBoard`. `list`, `get`, `missing`, and `stale` return `Promise`s because they read pack files through async `refreshLanguagePacks()`; `validateBoard` is async because it reads board files. `current`, `areas()`, paged `english()`, and `validate()` are synchronous. Use `refreshLanguagePacks()` for disk contents; use `englishCatalog` plus area entry catalogs for English messages/notes and `hashEnglishMessage` for source hashes; use `validateLanguagePack()` for validation; use the shared completeness and audit helpers for list/audit results; use the shared board validator for `validateBoard`. Return defensive plain-data copies.
4. [x] **Define the script contract and expose the app service.** Add `src/renderer/api/types/languages.d.ts` with public result interfaces, `LanguagePageOptions`, paged result envelopes, and the exact async/sync `ILanguages` signatures above; add `readonly languages: ILanguages` in `src/renderer/api/types/app.d.ts`, export/register the runtime facade through `src/renderer/api/app-service-registry.ts` and `src/renderer/api/app.ts`, and rely on `vite.renderer.config.ts` to copy the declarations to `assets/editor-types/` and update `_imports.txt`.
5. [x] **Add the ai-vision namespace.** Add `src/renderer/scripting/ai-vision/namespaces/languages.ts` following `themes.ts`/`settings.ts`, with accurate read-only `IAiMember` definitions and `$help` that explains chunked area reads, merged pack provenance, missing/stale meanings, and validation warnings. Register it in `src/renderer/scripting/ai-vision/namespaces/index.ts`; expose `languages` from `AiRoot` in `src/renderer/scripting/ai-vision/root.ts`. Keep both the node summaries and results bounded for MCP's default result shaping.
6. [x] **Keep the future write API additive.** Define `ILanguages` and runtime `languages` as one namespace facade so US-1677 can add `save`, `delete`, and `apply` members there without changing the read method contracts. Do not add or document those methods in this task.

## Concerns

- **English result size:** every `english(area, options?)` response is paged (`limit` defaults to 100 and is capped at 200); `area` is required and `areas()` is the only directory operation. The `settings` area is known to exceed the default 20,000-character call result when returned whole.
- **Merged audit semantics:** audits use the winning user/built-in message set, so a partial user pack with a built-in code only reports keys still absent from both packs. `stale` lists only source-hash mismatches in `keys`; translated messages lacking hashes increment `unverified` instead. `missing("en")` returns `{ code: "en", keys: [], count: 0 }`; `stale("en")` returns `{ code: "en", keys: [], count: 0, unverified: 0 }`. An unknown code returns `{ code, keys: [], count: 0, warning: "No pack for <code>" }` (and `unverified: 0` for stale), never every catalog key. The shared helper remains pack-oriented so US-1678 can audit a single built-in file independently and distinguish mismatches from unverified keys.
- **Board manifests:** use the existing board manifest validation/normalization path to obtain `languages`; do not accept caller-provided rules that differ from what the board host loads. Return `{ boardRoot, code, defaultCode, valid, warnings }`, with `defaultCode: null` if no usable language declaration exists and `valid` derived from whether warnings are empty. Validate the default pack's own shape when `code === defaultCode`, and explicitly warn when `lang/<code>.json` is missing.
- **MCP output size:** `english(area, options?)` and `get(code, area, options?)` use the fixed page envelope and 100 default / 200 maximum entry limit, so no whole-catalog or whole-language translation result is silently clipped.
- **Text and UI:** this is agent-facing API text, so it stays English (D3). No UI catalog entries are needed. The existing Settings picker remains the behavior source for names and completeness.

## Acceptance Criteria

- `app.languages` is available to scripts with public declarations in `src/renderer/api/types/`; generated `assets/editor-types/` declarations are refreshed through the Vite plugin.
- MCP exposes `languages.*` and `$help`, and the node is discoverable from the ai-vision root.
- `list()` includes synthetic English, follows the Settings picker's completeness calculation, reports built-in/user presence and override status, and handles development-only `en-XA` consistently with Settings.
- `current` identifies both the effective locale and whether it came from `auto` or an explicit setting.
- `get(code)` returns only pack metadata and translated-key counts; `get(code, area, options?)` returns one page of user/built-in translated messages with per-entry origin. It excludes English fallback.
- `areas()` lists area/count pairs. `english(area, options?)` requires an area and returns `{ area, total, offset, entries, next? }` pages (default 100 entries, maximum 200); entries include key, string/plural message, sorted placeholders, translator note, and English source hash.
- `missing` and `stale` are asynchronous, support optional area filtering, and use the shared audit logic on effective merged messages; stale hash mismatches and missing hashes are reported separately. US-1678 reuses that helper from `scripts/i18n-check-entry.ts` for individual packs.
- `validate(pack)` returns loader warnings for a hand-written pack with a wrong placeholder and does not write anything.
- `validateBoard(boardRoot, code)` returns `{ boardRoot, code, defaultCode, valid, warnings }`, validates default-pack shape when the requested code is the default, and warns explicitly when the selected `lang/<code>.json` is missing. It uses the same checks as `loadBoardI18n` without switching locale; the board bridge and `BOARD_BRIDGE_VERSION` are unchanged.
- Agent-facing summaries, warnings, signatures, and `$help` remain English, and no UI messages are added.
- The shared `languages` object can accept US-1677's write methods later; this task adds no `save`, `delete`, or `apply` behavior.

## Files Changed Summary

| File | Planned change |
|---|---|
| `src/shared/i18n/audit-pack.ts` | **New:** shared missing/stale audit logic for the API and check script. |
| `src/shared/i18n/language-completeness.ts` | **New:** shared picker/API completeness calculation. |
| `src/renderer/editors/settings/sections/LanguageSection.ts` | Reuse the shared completeness helper. |
| `scripts/i18n-check-entry.ts` | **No change in US-1676:** US-1678 will switch the report to the shared audit helper. |
| `src/renderer/editors/board/board-i18n.ts` | Extract and reuse board pack validation checks; add locale-independent validation entry point. |
| `src/renderer/api/languages.ts` | **New:** renderer `app.languages` read facade. |
| `src/renderer/api/app-service-registry.ts` | Register the `languages` service. |
| `src/renderer/api/app.ts` | Export/load the language facade as an app service. |
| `src/renderer/api/types/languages.d.ts` | **New:** public script result types and `ILanguages`. |
| `src/renderer/api/types/app.d.ts` | Add `readonly languages: ILanguages`. |
| `src/renderer/scripting/ai-vision/namespaces/languages.ts` | **New:** MCP descriptor and `$help`. |
| `src/renderer/scripting/ai-vision/namespaces/index.ts` | Register the languages descriptor. |
| `src/renderer/scripting/ai-vision/root.ts` | Expose the `languages` node in the root tree. |
| `assets/editor-types/languages.d.ts`, `assets/editor-types/app.d.ts`, `assets/editor-types/_imports.txt` | **Generated:** refreshed from source declarations by the Vite editor-types plugin; do not hand-edit. |
| `src/renderer/i18n/startup.ts` | **No change:** reuse its exported `refreshLanguagePacks()` and startup locale state. |
| `src/main/i18n-locale.ts` | **No change:** main-process locale updates are outside the read API. |
| `src/renderer/scripting/api-wrapper/AppWrapper.ts` | **No change:** registered app services are exposed by the existing descriptor-backed wrapper. |
| `src/renderer/scripting/ai-vision/call-limits.ts` | **No change:** design MCP returns to stay within the existing default shaping limit. |
| `doc/architecture/scripting.md` | **No change:** its existing script wrapper/type architecture already describes the integration seam. |
| `src/ipc/board-bridge-channels.ts`, board shim, and `BOARD_BRIDGE_VERSION` | **No change:** US-1676 is a renderer/script/MCP read API and reuses the existing board host checks. |
