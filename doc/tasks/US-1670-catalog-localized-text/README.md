# US-1670 — Published catalog: localized name and description

Epic: [EPIC-126 — Boards localization](../../epics/EPIC-126.md#us-1670--published-catalog)

## Goal

Copy each declared board language pack’s `manifest.name` and `manifest.description` into the latest published catalog entry, then display those fields in the active app language while keeping catalog identity and agent-facing data English. This task spans the `persephone-boards` publisher and the Persephone catalog UI; catalog publishing remains a separate user decision (EPIC-126 F9).

## Background

EPIC-126 F1 stores board metadata translations in `messages["manifest.name"]` and `messages["manifest.description"]` in the board’s language packs. `persephone-boards/scripts/publish-board.mjs` currently creates the latest `boards-manifest.json` entry from `board-manifest.json`, and prepends archive-only records to each `boards/<id>/versions-manifest.json`. It does not read language packs. The catalog repo’s `CLAUDE.md` requires changes on `develop` and treats both generated manifests as machine-written.

Persephone fetches `boards-manifest.json` through `src/main/published-boards-service.ts`, validates entries in `validateBoard()`, returns them over the `getPublishedBoards` IPC endpoint, and broadcasts updates. `src/renderer/api/published-boards.ts` normalizes association masks by spreading each board object, so an optional field survives that stage. The shared `PublishedBoardInfo` contract is in `src/ipc/api-param-types.ts`.

The direct catalog display sites are Search Boards cards in `src/renderer/editors/tools-hub/SearchBoardsTab.ts` and catalog-match install tiles in `src/renderer/editors/board-info/BoardInfoEditorView.ts`. The catalog-latest update/install progress and success notifications are emitted by `runBoardVersionInstall()` in `src/renderer/api/board-updates.ts`; it is called from Board Info and from `boards.installPublished()`. Board Info properties mode shows the installed board’s own manifest metadata and is already covered by US-1669’s local board metadata resolver; do not replace that source with the catalog copy.

F5 keeps catalog APIs for agents in English. `boards.searchPublished()` in `src/renderer/api/boards.ts` explicitly projects catalog results into `PublishedBoardResult` with English `name` and `description`; `BoardInfoEditorFacade` likewise builds an explicit English snapshot. Keep these projections explicit and do not copy `localized` into their public result types. MCP AiVision exposes `boards.*` through this renderer API. The main-process script scope also includes `publishedBoardsService`; review its catalog return as an agent-facing escape hatch and ensure scripts continue to receive English catalog fields without a localized display projection.

The service has a development override, `PERSEPHONE_BOARDS_BRANCH`, but it changes the raw GitHub branch only; there is no local file/URL fixture override. Its catalog cache is persisted in Electron store and does not make a local JSON file selectable. Avoid adding a production setting just to test the new display mapping.

## Implementation Plan

### `persephone-boards` repository

Make catalog-publisher changes on `develop`, with all paths below relative to `C:/projects/persephone-boards`.

1. **Read language packs while building the latest catalog record.** In `scripts/publish-board.mjs`, add a helper called by `buildCatalogEntry(id, m, archive)`. Only inspect a language folder when `m.languages` is declared as an object. Resolve its folder from a non-empty `m.languages.folder`, defaulting to `lang`; enumerate `<code>.json` files in that folder and read their `messages` object. A pack without a usable `messages` object contributes no localized fields. Do not infer translations from undeclared `lang/` files.

2. **Validate the two copied values independently.** For each pack, accept only string values for `manifest.name` and `manifest.description`; trim accepted values, omit blank results, and reject any value containing a `{placeholder}` token. Keep a valid field even if its sibling field is invalid. Do not copy any other pack keys or locale-pack metadata. If a pack file fails JSON parsing, issue a `console.warn` naming the board and file, skip that pack, and continue publishing. This is the CI-safe behavior: the board release and catalog entry remain usable in English and other valid locales, while the missing locale falls back at display time. Invalid individual metadata values should also warn and be omitted.

3. **Emit only non-empty locale entries.** Add `localized` to the catalog entry only if at least one pack contains an accepted name or description. The generated map has the shape `localized[code] = { name?, description? }`. Preserve the manifest’s existing English `name` / `description` as the default values.

4. **Keep version history archive-focused.** Do not add localized text to `boards/<id>/versions-manifest.json`. Persephone uses that file for version, date, compatibility and archive selection; the latest catalog entry supplies the board identity shown in the UI. Historical localized names would duplicate text and could make a current board display change with a selected archive version.

5. **Keep publisher paths repo-relative and do not publish as part of this task.** The publish automation is `scripts/publish-board.mjs`; `boards-manifest.json` and `boards/<id>/versions-manifest.json` are generated outputs, not files to hand-edit. Work on `develop` per `CLAUDE.md`; merging to `main` and releasing remain outside acceptance.

Before → after catalog shape:

```json
// Before: scripts/publish-board.mjs buildCatalogEntry()
{
  "id": "drawio-viewer",
  "name": "DrawIO Viewer",
  "description": "Read-only viewer for diagrams.net / draw.io (.drawio) diagrams."
}

// After: same English identity, with translations copied from declared packs
{
  "id": "drawio-viewer",
  "name": "DrawIO Viewer",
  "description": "Read-only viewer for diagrams.net / draw.io (.drawio) diagrams.",
  "localized": {
    "uk": { "name": "Переглядач DrawIO", "description": "Перекладений опис." },
    "de": { "name": "DrawIO-Betrachter" }
  }
}
```

### Persephone repository

All paths below are relative to `C:/projects/persephone`.

6. [x] **Type and validate the optional catalog field at ingress.** In `src/ipc/api-param-types.ts`, add a localized-text map to `PublishedBoardInfo`, keyed by locale code with optional `name` and `description` strings. In `src/main/published-boards-service.ts`, make `validateBoard()` retain valid locale records when accepting a catalog entry and omit malformed fields/empty locale records. Validate strings as trimmed plain text without placeholders, matching the publisher contract. Keep the validated map intact through `withScreenshotUrls()`, the typed `getPublishedBoards` IPC response, and `ePublishedBoardsUpdated`; do not resolve it in main or mutate English fields.

   Before → after type shape:

   ```ts
   // Before: src/ipc/api-param-types.ts
   interface PublishedBoardInfo {
       id: string;
       name: string;
       description?: string;
   }

   // After: optional, per-locale presentation data; name/description remain English
   interface PublishedBoardInfo {
       id: string;
       name: string;
       description?: string;
       localized?: Record<string, { name?: string; description?: string }>;
   }
   ```

7. [x] **Add one pure catalog display resolver.** Add `src/renderer/api/published-board-display-text.ts` (or the nearest existing published-board presentation module if one is introduced before implementation). Export a helper that accepts a `PublishedBoardInfo` and active locale and resolves each field independently: exact locale code, then base language (`uk-UA` → `uk`), then the English `name` / `description`. Locale-key lookup is case-insensitive, while exact locale match takes precedence over base language (`pt-br` and `pt-BR` match). If the active locale is `en-XA`, return `pseudoText()` of the English fields using `src/shared/i18n/pseudo-text.ts`; do not pseudo-localize already translated text. Use `getActiveLocale()` from `src/shared/i18n/active-locale.ts` at UI call sites. Keep locale fallback presentation-only; never write resolved strings back to catalog state.

   Before → after display resolution:

   ```ts
   // Before: src/renderer/editors/tools-hub/SearchBoardsTab.ts
   createTextElement(name, { bold: true });
   createTextElement(description, { size: "sm" });

   // After: resolve for presentation; retain board.id and raw English catalog data
   const display = publishedBoardDisplayText(board, getActiveLocale());
   createTextElement(display.name, { bold: true });
   createTextElement(display.description ?? "", { size: "sm" });
   ```

8. [x] **Localize the two catalog cards and their search behavior.** In `src/renderer/editors/tools-hub/SearchBoardsTab.ts`, render the resolved name/description on each card. Extend `BoardDetailsSignature` so a catalog update or locale-resolved string change refreshes the card. `filteredBoards()` must match the query against both the resolved display name/description and the English `board.name` / `board.description`, plus existing file masks; a localized result must not make English searches stop working. In `src/renderer/editors/board-info/BoardInfoEditorView.ts`, resolve the same fields for `renderInstallTile()`. Leave version, size, masks, compatibility, install state, screenshot URL and button behavior as today.

9. [x] **Localize catalog names in notifications and confirmations.** In `src/renderer/api/board-updates.ts`, resolve the catalog entry by stable `id` for the progress and success notification text in `runBoardVersionInstall()`; retain its English `args.name` as fallback for version-history installs or a missing catalog record. This covers updates launched from Search Boards, the Trusted Boards list, Board Info and `boards.installPublished()`. In `src/renderer/api/board-install.ts`, resolve the catalog name for `uninstallCatalogBoard()`’s delete-confirmation message when `catalogId` is available; preserve the supplied English name as fallback. Keep error messages that do not name the board as they are. Calls from `boards.installPublished()` / `boards.uninstallBoard()` keep their current return values and stable ID behavior; only the user-visible message argument is localized.

10. [x] **Keep the agent-facing catalog projection English.** In `src/renderer/api/boards.ts`, keep `searchPublished()`’s query haystack and returned `PublishedBoardResult.name` / `description` English; do not add `localized` to `src/renderer/api/types/boards.d.ts`. In `src/renderer/scripting/api-wrapper/BoardInfoEditorFacade.ts`, keep `name` and `description` English and omit `localized`. Audit `src/renderer/scripting/ai-vision/namespaces/boards.ts` and retain `boards.*` as the supported English catalog surface. `src/main/mcp/ai-vision/main-script.ts` is intentionally unchanged: `main.script` is a settings-gated, all-access escape hatch, so its raw service result may include the optional `localized` field; its English `name` and `description` remain unchanged. The service used by IPC still returns the validated localized map. `src/main/mcp/ai-vision/main-services.ts` exposes only `main.script.execute`, not the catalog service itself, so no catalog listing is added there. Keep stable IDs for all installs, lookups, update comparisons and facade operations.

11. [ ] **Live verification (user-run).** `PERSEPHONE_BOARDS_BRANCH=develop` can read a branch catalog from GitHub, but it cannot read a local fixture, and the current `develop` catalog may not contain an updated generated entry. Do not add a production file/URL override, fixture code, or temporary renderer injection. The user will inspect Search Boards, the Board Info install tile, uninstall confirmation, update notifications, English search, and the English `boards.searchPublished()` / Board Info facade output in the live app. No archive release, `main` merge or catalog publication is required.

## Concerns

- **Bad pack policy:** a malformed translation pack should warn and be skipped instead of failing the publisher. Publishing is run in CI; one translation file should not prevent a valid archive and all other languages from becoming available. The user sees the English fallback or another locale, and the warning makes the skipped pack visible in CI logs.
- **String validation:** the catalog copy has no runtime interpolation contract. Placeholder-bearing metadata is invalid, even if it is a string; trim before storing and omit empty values. Validate each field independently so one bad field does not hide a valid sibling.
- **Catalog versus version history:** `localized` belongs only on the latest `boards-manifest.json` entry. Version records select archives and compatibility, not board identity. The app’s UI does not display historical version-specific name/description.
- **English agent behavior:** `PublishedBoardInfo` is shared by IPC and internal renderer models, but public script/MCP projections are separately shaped. Keep those projections explicit and avoid spreading the raw catalog entry into public `boards.*` results or the Board Info facade.
- **Locale update lifecycle:** application locale changes reload renderer windows under the existing localization contract, so a resolver can read the active locale at render time without introducing cache invalidation or locale subscriptions.
- **Existing display audit:** Search Boards and Board Info install mode are the two current direct catalog metadata views. Board Info properties mode uses its installed board manifest and US-1669’s resolver. The toolbar’s catalog matching path supplies install choices but does not expose catalog name/description as board identity; IDs and editor matching remain unchanged.
- **Confirmation copy:** catalog uninstall uses the catalog name in `uninstallCatalogBoard()`’s confirmation. Resolve that display name from the catalog entry while retaining the ID and supplied English fallback; do not change local-board unregister copy.
- **Task tracking files:** the epic already lists US-1670 as Planned and this document links back to it. The requested scope explicitly excludes edits to `doc/epics/EPIC-126.md` and `doc/active-work.md`; do not update either file while creating this plan.

## Acceptance Criteria

- When a board declares `languages`, `scripts/publish-board.mjs` reads `<folder>/<code>.json` packs (`folder` defaults to `lang`) and copies valid `messages["manifest.name"]` / `messages["manifest.description"]` into `localized[code]` on the latest catalog entry.
- A board without a `languages` declaration has no `localized` field, even if a `lang/` directory exists. Empty locale maps are omitted. Existing English catalog `name` / `description` remain unchanged.
- Only non-empty trimmed string metadata without placeholders is copied. An invalid field is omitted independently; malformed JSON packs produce a console warning, are skipped, and do not fail publishing the board.
- `versions-manifest.json` history records remain unchanged and do not carry localized names/descriptions.
- Main-process catalog validation and typed IPC preserve valid `localized` data; older entries without it continue to validate and display exactly as before.
- In Search Boards and Board Info install mode, each displayed name/description resolves exact locale → base locale → English per field. Under `en-XA`, the English name and description are pseudo-text from `pseudoText()`.
- Search Boards matches both resolved visible name/description and English name/description, as well as file masks.
- Progress and success notifications for catalog update/version installs show localized catalog names where available, with English fallback. They continue using the catalog ID for all lookup and operation identity.
- The catalog uninstall confirmation shows the localized catalog name where available, with English fallback; local-board unregister confirmation keeps its existing metadata source.
- MCP/script `boards.*` results and Board Info facade metadata keep English names/descriptions; no localized map leaks into their public result types.
- The user verifies exact/base/per-field fallback, `en-XA`, both catalog display surfaces, English search and English agent-facing output in the live app; no fixture or temporary source injection is left in the repository.
- No changes are made to `doc/epics/EPIC-126.md` or `doc/active-work.md`; no catalog publication or commit is part of this task.

## Files That Need No Changes

`C:/projects/persephone-boards/boards-manifest.json` and `boards/<id>/versions-manifest.json` are generated output; update them only by running the publisher during an authorized release, never by hand. `C:/projects/persephone-boards/boards/<id>/board-manifest.json` and language packs are inputs for this catalog automation and are not changed by US-1670. In Persephone, `src/renderer/api/types/boards.d.ts` remains an English-only public contract; `src/renderer/api/board-install-registry.ts` keeps its ID/root/version identity; `src/renderer/editors/board-info/BoardInfoEditorModel.ts` continues storing raw installed-manifest metadata; `src/renderer/editors/base/editor-switch-options.ts` keeps editor IDs/matching unchanged; `src/renderer/scripting/ai-vision/namespaces/boards.ts` remains the English `boards.*` descriptor; `src/main/mcp/ai-vision/main-services.ts` exposes script execution, not a catalog listing; `src/renderer/i18n/startup.ts` and `src/shared/i18n/active-locale.ts` already provide locale startup/state; `src/shared/i18n/pseudo-text.ts` already provides the `en-XA` transform; `doc/epics/EPIC-126.md` and `doc/active-work.md` are explicitly out of scope.

## Files Changed

| Repository | File | Planned change |
|---|---|---|
| `persephone-boards` | `scripts/publish-board.mjs` | Read declared language packs, validate metadata strings, warn/skip bad packs, and include non-empty `localized` data in the latest catalog entry. |
| Persephone | `src/ipc/api-param-types.ts` | Add the optional localized name/description map to `PublishedBoardInfo`. |
| Persephone | `src/main/published-boards-service.ts` | Validate localized catalog data and preserve it through fetch/cache/IPC/broadcast paths. |
| Persephone | `src/renderer/api/published-board-display-text.ts` | Add the shared locale fallback and `en-XA` display resolver. |
| Persephone | `src/renderer/editors/tools-hub/SearchBoardsTab.ts` | Display localized metadata and search both localized and English fields. |
| Persephone | `src/renderer/editors/board-info/BoardInfoEditorView.ts` | Display localized metadata on catalog install tiles. |
| Persephone | `src/renderer/api/board-updates.ts` | Use localized catalog name in progress/success notifications while preserving English fallbacks. |
| Persephone | `src/renderer/api/board-install.ts` | Use the localized catalog name in the delete-confirmation message while preserving ID-based deletion. |
| Persephone | `src/renderer/api/boards.ts` | Keep the catalog search projection English and ID-based; add no localized API output. |
| Persephone | `src/renderer/scripting/api-wrapper/BoardInfoEditorFacade.ts` | Keep the catalog metadata snapshot English and omit localized display data. |
| Persephone | `doc/tasks/US-1670-catalog-localized-text/README.md` | This implementation plan. |
