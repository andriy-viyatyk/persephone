# US-1667 — Board packs and `persephone.i18n`

Epic: [EPIC-126 — Boards localization](../../epics/EPIC-126.md#us-1667--board-packs-and-persephonei18n)

## Goal

Add optional board language packs and provide each registered board frame with the app's active locale and resolved board tables. Expose frozen `persephone.locale: { code }` and `persephone.i18n.t()` / `has()` in the board shim, preserving boards that have no language declaration.

## Background

The board manifest is read from the renderer through `app.fs` in `readBoardManifest()` and normalized by `parseBoardManifest()` in `src/renderer/editors/board/board-manifest.ts:467-481,832`. `BoardManifest` and `NormalizedBoardManifest` are declared in that file (`:77`, `:272`). The shared `src/shared/board-manifest-utils.ts` contains permission/path normalizers, not a complete manifest parser. The main process has shallow readers for separate purposes: `board-trust-service.ts:131-137` reads trust fields; `board-protocol-service.ts:351-358` only tests permission object shape; `board-storage.ts:212-220` reads a name; and `main/mcp/ai-vision/board-guide-mounts.ts:64` reads the guides folder. Those paths do not need a `languages` field to serve their current purpose. Parse and normalize `languages` in the renderer manifest type/parser; add a shared pure normalizer to `board-manifest-utils.ts` only if a concrete cross-process caller emerges.

At registration, `BoardWebview.registerBoard()` currently calls `api.registerBoard(boardRoot, computeBoardThemePalette(), BOARD_TOKEN_VARS)` (`src/renderer/editors/board/BoardWebview.ts:543-555`). The IPC type is at `src/ipc/api-types.ts:315`; the renderer wrapper forwards positional parameters at `src/ipc/renderer/api.ts:468-474`; `src/ipc/main/board-handlers.ts:53-64` calls `main/board-protocol-service.ts:374-385`. Main stores the design in `hostToDesign`; `buildBootScript()` serializes it to `window.__persephoneBoot`, and the board protocol injects boot data and the shim before board scripts (`src/main/board-protocol-service.ts:43-48,111-121,332-337`). `BoardBootContext` is defined in `src/ipc/board-bridge-channels.ts:62-70`; `src/board-shim.ts:185-239` reads it synchronously. The palette is therefore the right transport pattern for locale/tables. Live theme changes use the separate `theme` MessagePort event (`src/main/board-bridge.ts:623-630`, `src/board-shim.ts:1140-1188`); D5/F3 means locale and tables are registration-time data, with no live language event.

The app locale is set in renderer startup from `resolveLocale()` and exposed through `getActiveLocale()` (`src/renderer/i18n/startup.ts:81-89`, `src/shared/i18n/active-locale.ts:1-4`, `src/shared/i18n/resolve-locale.ts:3-17`). `t()` selects a plural category only when `params.count` is a number, otherwise uses `other`; it calls the shared `pluralCategory(locale, count)` and substitutes `{name}` tokens (`src/shared/i18n/t.ts:15-30`, `src/shared/i18n/plurals.ts:3-9`). The app pack validator currently owns placeholder extraction, placeholder-set comparison, and accepted CLDR category names inside `validateLanguagePack()` (`src/shared/i18n/validate-pack.ts:4-26,39-75`); board messages cannot use its app-catalog key allow-list or `<code>.lang.json` filename convention as-is. Extract the small message-shape, plural-category, and placeholder helpers for reuse, retaining current app validation behavior and validating board translations against each default-pack message. Do not copy those rules into the board loader.

Board logging is already available in the view: `BoardWebview.appendLog()` forwards a level/message through `api.appendBoardLog()` (`src/renderer/editors/board/BoardWebview.ts:1534-1536`), which reaches `src/ipc/main/board-handlers.ts:65-72`. Both the main and every secondary `BoardWebview` run `registerBoard()` (`BoardWebview.ts:543-555`, `BoardSecondaryView.ts:140-149`), so collect warnings during loading and append them only from the main view after the existing `----- board loaded -----` line (`BoardWebview.ts:551-553`). If `languages` is declared but its default pack file is absent, append exactly one warning; absent current/base packs remain silent. Missing folder/file should not throw.

`createPseudoLocalePack()` currently transforms the app's English catalog, but its `transformText()` helper is private (`src/shared/i18n/pseudo-locale.ts:6-25`). F8 needs the same transform for arbitrary strings and plural forms in a board's default table. Move the transformation to `src/shared/i18n/pseudo-text.ts` as an exported `pseudoText(text)` that does not import `englishCatalog`, then have `pseudo-locale.ts` import it. The renderer builds the pseudo-transformed table in the current-language slot; the shim contains no pseudo-localization logic. Preserve placeholder tokens exactly.

`BOARD_BRIDGE_VERSION` is currently `1.35.0` (`src/shared/board-bridge-version.ts:1-2`). The shim's `persephone.version` describes versioned additions near `src/board-shim.ts:1708-1716`; retain and update this version comment for 1.36.0. The board author guides are the maintained API reference and US-1671 owns those edits.

## Implementation Plan

1. [x] **Add manifest shape and normalization.** In `src/renderer/editors/board/board-manifest.ts`, add `languages?: { folder?: string; default?: string }` to `BoardManifest` and normalized form. Normalize absent members to `folder: "lang"` and `default: "en"`; reject unsafe/non-board-relative folder paths and blank or malformed codes using the existing board-relative path conventions. Ensure `parseBoardManifest()` preserves normalized language settings. If a shared normalization helper is warranted, put only the pure normalizer/types in `src/shared/board-manifest-utils.ts`; main readers listed above should remain untouched unless they begin consuming this field. The `parseBoardManifest(raw)` caller in `custom-editor-registry.ts:481` and consumers of `readNormalizedBoardManifest()` will then receive the field through the existing normalization path.

2. [x] **Define the board pack contract and shared validation primitives.** A pack at `<languages.folder>/<code>.json` has `{ "messages": { "author.flat.key": string | CLDR plural object }, "source"?: { ... } }`. Keys are author-defined flat strings; dots are ordinary key characters. Reuse the app's accepted plural categories and placeholder-set comparison by extracting/refactoring small helpers in `src/shared/i18n/validate-pack.ts`, `plurals.ts`, and/or `resolve-message.ts`; preserve the app validator's current behavior. Compare ordinary non-default messages against the corresponding default-pack message. Drop any ordinary non-default entry whose key is absent from the default pack with a board-log warning naming it as an unknown key, mirroring app packs. `manifest.*` is the exception: F1's English values live in the manifest, so these keys may be absent from the default pack and are never rejected as unknown. Accept `manifest.*` entries only as plain strings containing no `{placeholder}` tokens; drop plural objects or strings with placeholders with an invalid-entry warning. A default pack may also contain `manifest.*`; do not use those values for placeholder comparison. Drop malformed message shapes and placeholder mismatches with warnings; never reject arbitrary author keys merely because they are absent from the app catalog.

3. [x] **Load only the three relevant board packs in the renderer.** Add `src/renderer/editors/board/board-i18n.ts` using the existing `app.fs` API, following renderer ownership of the board root and theme palette. Resolve `code = getActiveLocale()`, derive `base` from the part before the first `-`, and read only the exact current code, base code when distinct, and manifest default when distinct. Read JSON packs from the normalized board folder. With no `languages` declaration, return an i18n context containing `{ locale: { code }, tables: [{}, {}, {}] }`. For declared languages, a missing default pack emits one collected warning; missing current/base files stay silent. Accumulate all pack/entry warnings, but append them only when `BoardWebview.isMain` is true and after `registerBoard()` appends its existing `----- board loaded -----` marker. This prevents duplicate warnings from the main plus sidebar webviews and preserves log order. For `en-XA`, load the default pack and put a pseudo-transformed copy of its table in the current table slot; do not request `en-XA.json`.

4. [x] **Extend registration payload end-to-end and initial boot context.** Define `BoardI18nContext` in `src/ipc/board-bridge-channels.ts` with `locale: { code: string }` and a fixed ordered tuple, `tables: [currentTable, baseTable, defaultTable]`, where each table maps string keys to board messages and empty objects are allowed. The shim consumes these slots in order and does not need to know locale fallback rules. Always provide the context, including for boards without `languages`; those boards get the app's active `code` and empty tables so libraries such as Excalidraw can inspect locale in US-1672. Add it beside `theme` in `BoardBootContext`. Update the IPC endpoint signature (`src/ipc/api-types.ts:315`), `api.registerBoard()` (`src/ipc/renderer/api.ts:468-474`), `Endpoint.registerBoard` handler (`src/ipc/main/board-handlers.ts:53-64`), `BoardWebview.registerBoard()` (`:543-555`), and `registerBoard()`/`BoardDesign`/`buildBootScript()` in `src/main/board-protocol-service.ts` (`:43-48,111-121,374-385`). Keep the `theme` route unchanged: its initial palette is serialized in boot context and its later pushes travel over `MainToBoard` as `{ kind: "theme", palette }` (`src/main/board-bridge.ts:623-630`, `src/board-shim.ts:1174-1188`). Locale/tables are boot-only.

   **Before → after, registration path:**

   ```ts
   // Before
   api.registerBoard(boardRoot, computeBoardThemePalette(), BOARD_TOKEN_VARS)

   // After
   api.registerBoard(boardRoot, computeBoardThemePalette(), BOARD_TOKEN_VARS, boardI18n)
   ```

   ```ts
   // Before: BoardBootContext
   { theme: BoardThemePalette; tokens: Record<string, string>; hostOrigin: string }

   // After
   { theme: BoardThemePalette; tokens: Record<string, string>; i18n: BoardI18nContext; hostOrigin: string }
   ```

5. [x] **Expose shim API.** Set frozen `persephone.locale = { code }` from the boot context for every board. Implement `persephone.i18n.t(key, params?)` over the ordered table array: select the first matching key (current → base → default), otherwise return the key. For plural objects, use `params.count` only when numeric; select with a cached `Intl.PluralRules(code)` instance, falling back to an `Intl.PluralRules("en")` instance if `Intl` rejects the app locale code, and choose `other` when count is absent. Replace `{name}` placeholders from `params`, leaving missing/null values intact to match app `t()`. Keep `has(key)`: it returns true if any of the current, base, or default tables contains the key, independent of the selected plural category. Keep implementation in the plain-JS-compatible style of `src/board-shim.ts`. US-1671's board guides are the maintained API reference.

   **Before → after, public shim API:**

   ```ts
   // Before: no board locale or message API
   interface Persephone { readonly theme: PersephoneThemePalette; }

   // After
   interface Persephone {
       readonly locale: Readonly<{ code: string }>;
       readonly i18n: {
           t(key: string, params?: Record<string, unknown>): string;
           has(key: string): boolean;
       };
   }
   ```

6. [x] **Add renderer-side board pseudo-localization.** Add `src/shared/i18n/pseudo-text.ts` with exported `pseudoText(text: string): string`, containing the current placeholder-preserving transform but no `englishCatalog` import. Refactor `src/shared/i18n/pseudo-locale.ts` to import and use `pseudoText()` for the app catalog. The renderer board loader applies `pseudoText()` to every default-pack string (including every plural form) and puts that transformed table in the current slot when the app code is `en-XA`. The shim does not pseudo-localize. Do not read a board `en-XA.json` pack. Board manifest strings are passed through as keys/data in this task; metadata presentation is US-1669.

7. [x] **Bump bridge compatibility.** Change `src/shared/board-bridge-version.ts` from `1.35.0` to `1.36.0` (F6), and update the `persephone.version` feature comment in `src/board-shim.ts` near `:1708-1716`. The current-version/API prose and references in `assets/guides/boards.md`, `assets/guides/agents/boards.md`, `assets/board-template/CLAUDE.md`, and review guidance are author documentation assigned to US-1671. Update the existing source-of-truth feature summary in `doc/architecture/key-files.md` (currently enumerates features through 1.32.0) with the 1.36.0 locale/i18n API. Search for any new changelog/version-table entry during implementation; `assets/guides/whats-new.md` has no existing 1.35.0 feature row to edit, so add a release note only through the normal release work, not as a guessed historical entry.

8. [x] **Cover every board document mount.** `BoardEditorView` creates the main `BoardWebview` (`src/renderer/editors/board/BoardEditorView.ts:72-96`); `BoardSecondaryView` creates another `BoardWebview` for sidebar documents (`src/renderer/editors/board/BoardSecondaryView.ts:136-151`). Capability registrations use the main board frame tracked by `BoardWebview` (`:766-783`); the `headless` flag means the declaration is not invoked as a frame handler, so it does not add another board document mount. Board Info (`src/renderer/editors/board-info/BoardInfoEditorView.ts:91-100,516-520`) is a native metadata view with an Open Board action, not a board-document preview iframe; opening it goes through the main `BoardEditorView` registration. Theme previews are board calls managed by `BoardWebview` (`:830-836`), not separate documents. Verify with a source search for direct `board://` iframe creation before implementation; current `BoardWebview.createIframe()` is the renderer owner of board document frames (`:559-579`).

9. [ ] **Live verification with a disposable scratch board.** Not run: the user instructed that Persephone cannot be started in this sandbox, and the scratch board is outside the writable workspace. `C:\projects\test-boards` exists; QA already identifies it as the scratch-board root (`qa/surfaces/events.md:17`, `qa/surfaces/remote-app.md:18`). Create a new child such as `C:\projects\test-boards\us-1667-i18n` with an `index.html`, a valid manifest declaring `languages: { "folder": "lang", "default": "en" }`, `lang/en.json`, and `lang/de.json`; include one German message with a wrong placeholder. Make English/German values visible in the DOM and include a plural message. Through MCP, call `boards.registerBoard(root)` and complete the existing trust dialog if it is a new untrusted root (the flow is covered in `qa/surfaces/editors/boards.md:119-124`); then call `boards.openBoard(root)` (`qa/surfaces/remote-app.md:37-44`). Read the rendered frame with the board page's `pages[i].asBrowser().snapshot()` path, which supports board pages (`doc/epics/EPIC-083.md:258-260`); verify German text, per-key English fallback for the invalid German entry, plural choice, and a warning in the board log. Set `app.settings.set("language", "de")` (the setting is documented as reload-bound at `src/renderer/api/types/settings.d.ts:20`), reload the app window, and reopen/snapshot the board. Repeat with `en-XA`, then with an unlocalized board. Do not edit an existing scratch board or create the fixture inside the repository.

## Concerns

- App packs use the `<code>.lang.json` filename and app catalog schema, while board packs intentionally use `<code>.json` and arbitrary keys. Reuse only the validation primitives, not the whole app pack loader or catalog-key gate.
- Define malformed-code and unsafe-folder behavior consistently with existing board manifest normalizers. Missing current/base packs are silent; a declared but missing default pack logs exactly one warning. Parse/validation problems must be visible in the board log without making board registration fail.
- The renderer builds the `en-XA` pseudo table from the default pack and places it in the current slot while `persephone.locale.code` remains `en-XA`.
- US-1667 only transports reserved `manifest.*` messages. Rendering those keys in Board Info/sidebar/catalog belongs to US-1669 and must not be pulled into this implementation.
- The board author guides contain current-version prose and feature references; US-1671 owns those guide edits. The existing developer feature list in `doc/architecture/key-files.md` should be updated with the bridge bump.

## Acceptance Criteria

- A manifest without `languages` keeps current behavior; a declared language configuration defaults to `folder: "lang"` and `default: "en"`.
- Registration reads at most the current-language, base-language, and default board packs, and passes resolved locale/tables in `BoardBootContext`.
- Board message validation shares the app's placeholder/plural validation primitives; ordinary placeholders are checked against the matching default message. Unknown non-default keys are dropped with an "unknown key" warning, except `manifest.*`; those accept only plain strings without placeholders. Invalid entries are dropped and logged as board warnings, never thrown. Missing current/base files are silent; a declared but missing default pack logs one warning.
- `persephone.locale` is frozen `{ code }` for localized and unlocalized boards. `t()` follows current/base/default/key fallback, interpolation, and app-compatible plural selection with cached, guarded `Intl.PluralRules`; `has()` reports whether any ordered table contains the key.
- `en-XA` pseudo-localizes the default board pack in the renderer's current table slot using shared `pseudoText()` while preserving placeholders; the shim has no pseudo logic and no `en-XA.json` file is required.
- Main and secondary board documents receive locale/tables through the same boot context; capability dispatch uses the registered main frame, headless declarations add no frame, and Board Info opens that same main frame rather than embedding a board preview.
- `BOARD_BRIDGE_VERSION` is `1.36.0`, the `persephone.version` comment and existing developer feature list describe the addition, and board author guide prose is handed to US-1671.
- Live scratch-board verification demonstrates German lookup, fallback after a malformed-placeholder entry, plural selection, board-log warning, `en-XA`, unchanged behavior without packs, and language change after window reload.

## Files Changed

Files investigated that should need no changes: `src/shared/board-manifest-utils.ts` (no shared manifest parser currently consumes languages); `src/main/board-trust-service.ts`, `src/main/board-protocol-service.ts` shallow permission readers, `src/main/board-storage.ts`, and `src/main/mcp/ai-vision/board-guide-mounts.ts` (their focused reads do not need languages); `src/ipc/main/board-handlers.ts` beyond the register endpoint; `src/main/board-bridge.ts` theme push protocol (locale is initial boot data); `assets/guides/agents/boards.md`, `assets/guides/boards.md`, `assets/board-template/CLAUDE.md`, and `assets/guides/agents/board-review.md` (guide prose is US-1671); `assets/guides/whats-new.md` (no existing 1.35.0 feature row); and `doc/active-work.md` / `doc/epics/EPIC-126.md` (explicitly out of scope for this task-document request).

| File | Change |
|---|---|
| `doc/tasks/US-1667-board-i18n-runtime/README.md` | This implementation task plan. |
| `src/renderer/editors/board/board-manifest.ts` | Manifest language type and normalization. |
| `src/renderer/editors/board/board-i18n.ts` | New renderer loader/validator integration for the three board packs. |
| `src/shared/i18n/validate-pack.ts` | Extract reusable message and placeholder validation primitives without changing app pack behavior. |
| `src/shared/i18n/plurals.ts` | Share CLDR-category validation/selection helpers if needed. |
| `src/shared/i18n/pseudo-text.ts` | New `pseudoText(text)` helper without an app-catalog dependency. |
| `src/shared/i18n/pseudo-locale.ts` | Reuse `pseudoText()` for the app pseudo-locale catalog. |
| `src/shared/i18n/resolve-message.ts` | Shared fallback/lookup helper if appropriate to the board runtime. |
| `src/ipc/board-bridge-channels.ts` | Board i18n context and boot data wire types. |
| `src/ipc/api-types.ts` | Extend `registerBoard` endpoint arguments. |
| `src/ipc/renderer/api.ts` | Forward locale/table payload through `registerBoard`. |
| `src/ipc/main/board-handlers.ts` | Receive and pass i18n registration data to main protocol service. |
| `src/main/board-protocol-service.ts` | Store and serialize i18n context in `window.__persephoneBoot`. |
| `src/renderer/editors/board/BoardWebview.ts` | Load packs, log validation warnings, and register with locale/tables. |
| `src/renderer/editors/board/board-api.d.ts` | Declare the public `persephone.locale` and `persephone.i18n` board APIs. |
| `src/board-shim.ts` | Add `persephone.locale`, `persephone.i18n.t()` and `has()`, and update the `persephone.version` comment for 1.36.0. |
| `src/shared/board-bridge-version.ts` | Bump bridge version from 1.35.0 to 1.36.0. |
| `doc/architecture/key-files.md` | Update the existing bridge feature summary for 1.36.0. |
