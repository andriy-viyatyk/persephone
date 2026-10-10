# US-1681: Ukrainian language pack

## Goal

Draft and validate the complete Ukrainian app pack, the two bundled-board packs, and the fifteen catalog-board packs. Settle and record the Ukrainian glossary first, then hand the pack to the Ukrainian-speaking user for review and apply their corrections in these same files.

This task also records the repeatable drafting process for US-1682 through US-1685, which cover the other sixteen languages.

## Background

EPIC-127 G1 specifies file-written built-in packs; G3 requires each language's glossary before drafting; G5 keeps catalog-board work on `persephone-boards` branch `develop` without another version bump; G6 makes Ukrainian the end-to-end proving language. Roadmap D7 defines app pack schema version 1, `messages`, and per-key English `source` hashes. D10 defines board packs and `manifest.*` display keys. D14 requires machine drafting and speaker review. The accepted roadmap §4 lists `uk` as a built-in language, with English Monaco widgets.

The English app catalog is in `src/shared/i18n/en/`, assembled as 19 areas by `src/shared/i18n/en/index.ts`; EPIC-127 records 1,524 messages. Each catalog entry can include a `note`. The `app.languages.english(area)` implementation in `src/renderer/api/languages.ts` already returns each entry's message, sorted placeholder names, optional note, and `hashEnglishMessage()` result. `src/shared/i18n/hash.ts` hashes strings directly and plural objects in canonical CLDR-category order. The current checker launcher is `scripts/i18n-check.mjs`, which bundles `scripts/i18n-check-entry.ts` with esbuild before running it.

The shipped guide `assets/guides/agents/languages.md` says to use notes, preserve keys and placeholders, supply the locale's plural categories, save one area at a time, and inspect UTF-8 read-back. Its API flow is for user packs; these built-in packs are authored directly as files per G1. Pack files must be UTF-8 without BOM. Write them with a file-edit tool or Node `fs.writeFileSync(path, text, "utf8")`; never use PowerShell to write translated packs.

`assets/guides/agents/languages-glossary.md` has an empty Ukrainian table. The shipped guide describes user-requested pack work, where an agent asks the user to approve terms before translating. EPIC-127's built-in pack work is autonomous: the drafting agent fills the glossary, Claude reviews it before area drafting, and the user reviews the glossary and completed pack together at the end. Use Windows Ukrainian terminology and the polite **ви** register, matching Windows' courteous form. Record decisions in that shipped table; US-1682 through US-1685 use the same Claude glossary review without a user gate.

### File-export tooling decision (G1)

Add a small maintainer exporter. It lets a drafting session read source and context by area from disk without an app session, MCP result-size limit, or manual hash copying. The existing catalogs and pure helpers are sufficient; this does not change the runtime API.

Implement `scripts/i18n-export.mjs` as an esbuild launcher modeled on `scripts/i18n-check.mjs`, with a TypeScript entry at `scripts/i18n-export-entry.ts`. Add `"i18n:export": "node scripts/i18n-export.mjs"` to `package.json`. Usage: `npm run i18n:export -- <outDir>`; require exactly one output directory argument and resolve it from the current working directory. Use the writable, gitignored repository folder `.i18n-work/` for exports and draft chunks; the default invocation is `npm run i18n:export -- .i18n-work/en`. Do not check generated source exports or intermediate drafts into version control. The script creates the directory if needed and writes one `<area>.json` per catalog area, in `englishCatalog` area order.

Each output is a UTF-8 JSON array of entries with this shape (omit `note` when absent):

```json
[
  {
    "key": "common.items",
    "message": { "one": "{count} item", "other": "{count} items" },
    "placeholders": ["count"],
    "note": "A count of items.",
    "sourceHash": "f6907d4a"
  }
]
```

The entry imports `englishCatalog`, all area entry catalogs, `messagePlaceholders` from `src/shared/i18n/validate-pack.ts`, and `hashEnglishMessage` from `src/shared/i18n/hash.ts`. It mirrors `englishEntries()` in `src/renderer/api/languages.ts`: sorted full keys, cloned messages, unique sorted placeholders, optional note, and the current source hash. Use Node `fs.writeFileSync(file, `${JSON.stringify(entries, null, 2)}\n`, "utf8")` (or the promises equivalent) so files have no BOM. Fail with a usage message for a missing or extra argument. Do not emit a partially valid result if bundling or writing fails.

### Board-pack facts

`assets/guides/agents/boards.md` documents that `manifest.*` values are translated only in the non-default locale pack, as plain strings without placeholders. Applicable keys are determined by each board's `board-manifest.json`: `manifest.name`, `manifest.description`, optional `manifest.editorName`, `manifest.views.<id>.title`, `manifest.settings.<id>.label` / `.description`, and `manifest.capabilities.<id>.title`. Keep IDs exactly as declared. `src/renderer/editors/board/board-display-text.ts` maps those values to the display keys; with no language configuration, `loadBoardI18n()` returns empty tables and display text falls back to the English manifest value.

| Board | Ukrainian `manifest.*` keys from its current manifest |
|---|---|
| Bundled REST Client | `manifest.name`, `manifest.description`, `manifest.capabilities.http.request.open.title`, `manifest.views.requests.title` |
| Bundled Excalidraw | `manifest.name`, `manifest.description`, `manifest.settings.library-path.label`, `manifest.settings.library-path.description`, `manifest.capabilities.image.edit.title`, `manifest.capabilities.diagram.edit.title` |
| `agent-log-viewer` | `manifest.name`, `manifest.description`, `manifest.editorName`, `manifest.settings.showCost.label` |
| `aivision-explorer` | `manifest.name`, `manifest.description` |
| `cert-viewer` | `manifest.name`, `manifest.description`, `manifest.editorName`, `manifest.capabilities.certificate.view.title` |
| `chess` | `manifest.name`, `manifest.description` |
| `drawio-viewer` | `manifest.name`, `manifest.description`, `manifest.editorName` |
| `excel-viewer` | `manifest.name`, `manifest.description`, `manifest.editorName` |
| `force-graph` | `manifest.name`, `manifest.description`, `manifest.editorName` |
| `pdf-viewer` | `manifest.name`, `manifest.description`, `manifest.editorName` |
| `pe-viewer` | `manifest.name`, `manifest.description`, `manifest.editorName` |
| `powerpoint-viewer` | `manifest.name`, `manifest.description`, `manifest.editorName` |
| `sqlite-viewer` | `manifest.name`, `manifest.description`, `manifest.editorName`, `manifest.views.tables.title` |
| `theme-editor` | `manifest.name`, `manifest.description`, `manifest.capabilities.theme.edit.title` |
| `todo` | `manifest.name`, `manifest.description`, `manifest.editorName`, `manifest.views.lists.title` |
| `torrent-viewer` | `manifest.name`, `manifest.description`, `manifest.editorName` |
| `word-viewer` | `manifest.name`, `manifest.description`, `manifest.editorName` |

The two bundled boards are under `assets/boards/`. REST Client declares `languages: { folder: "lang", default: "en" }`; its default pack has 94 message keys. Add its `lang/uk.json` with those messages and applicable manifest strings. Excalidraw currently has no `languages` declaration and its UI uses its own bundled locale files, which include `uk-UA`. It still needs localized board metadata: add the `languages` declaration with folder `lang` and default `en`, an empty `lang/en.json` (`{"messages": {}}`) as the required default pack, and `lang/uk.json` containing the manifest keys in the table. The host's checker requires a declared default pack; `board-display-text.ts` will otherwise keep English manifest values. This does not replace or duplicate Excalidraw's own UI locale.

The fifteen catalog boards are `C:\projects\persephone-boards\boards\*`, in a separate repository outside this repo's drafting sandbox. Draft and edit these packs in a separate run whose working root is `C:\projects\persephone-boards`, on branch `develop`. Verified current package versions exceed the latest matching published tags for all fifteen: agent-log-viewer 1.1.0 > 1.0.0; aivision-explorer 1.1.0 > 1.0.6; cert-viewer 1.1.0 > 1.0.1; chess 1.1.0 > 1.0.0; drawio-viewer 1.2.0 > 1.1.2; excel-viewer 1.3.0 > 1.2.2; force-graph 1.1.0 > 1.0.1; pdf-viewer 1.2.0 > 1.1.1; pe-viewer 1.1.0 > 1.0.4; powerpoint-viewer 1.2.0 > 1.1.1; sqlite-viewer 1.2.0 > 1.1.1; theme-editor 1.2.0 > 1.1.0; todo 1.3.0 > 1.2.1; torrent-viewer 1.10.0 > 1.9.3; word-viewer 1.2.0 > 1.1.1. Add `lang/uk.json` to each board. In each current `WHATS-NEW.md` entry, maintain one English line exactly as `Interface languages: Ukrainian.`; US-1682 through US-1685 append their languages to that same line rather than adding another. Do not bump versions, touch `main`, publish, or modify anything outside `develop` in the board repository. Recheck the branch and version/tag relation before editing because the catalog repository can move independently. Run the catalog checks from `C:\projects\persephone` after the separate drafting run.

## Implementation Plan

### Before → after examples

App packs are not present yet (`assets/languages/` currently contains only its README). The completed pack will follow the existing schema and include a source hash for every translated key:

```json
// Before: no assets/languages/uk.lang.json
// After: assets/languages/uk.lang.json
{
  "schemaVersion": 1,
  "code": "uk",
  "name": "<Ukrainian native name>",
  "englishName": "Ukrainian",
  "messages": { "common.ok": "<approved Ukrainian translation>" },
  "source": { "common.ok": "<hash from the current English entry>" }
}
```

The exporter is also new; it turns the existing English catalog entry and hash helper into a disk-readable source file:

```text
Before: package.json has i18n:check and i18n:check-boards; no i18n:export command.
After:  npm run i18n:export -- <outDir> writes <outDir>/common.json, <outDir>/main.json, ...
```

Excalidraw currently has no language configuration, so the host supplies no board translation tables. After the change, the host has a default pack to compare with Ukrainian metadata text:

```json
// Before: no "languages" property in assets/boards/excalidraw/board-manifest.json
// After:
"languages": { "folder": "lang", "default": "en" }
```

The empty default file `{"messages": {}}` is valid and produces no warning: `parseBoardLanguagePack()` accepts the empty object (`src/shared/i18n/board-pack.ts:30-68`); `loadBoardI18n()` retains it as an empty `defaultTable` and appends only actual pack warnings (`src/renderer/editors/board/board-i18n.ts:22-49`); the CLI checker sees no default warnings or message entries and a manifest-only Ukrainian pack has no default message keys missing (`scripts/i18n-check-entry.ts:177-210`). No change is needed to make this empty default valid.

1. [ ] **Settle and review glossary before translation.** In `assets/guides/agents/languages-glossary.md`, fill the Ukrainian table with English-to-Ukrainian choices for core app terms: page, tab, board, editor, sidebar, script, pin, workspace, Git terms (including commit and push), plus Windows interface terms such as File, Save, Settings, Open, and Close. Check Microsoft's [Ukrainian Localization Style Guide](https://download.microsoft.com/download/6/4/a/64a8b98e-e69f-47c9-96dd-f8bc55c176c6/ukr-ukr-StyleGuide.pdf) and use its polite, lowercase **ви** form consistently. Claude reviews the filled glossary before area drafting; address any review findings, then proceed without waiting for user approval. Apply the same process to US-1682 through US-1685. The user reviews the glossary and complete pack together at the end. Keep the `Stays English` entries unchanged; add only further product/protocol names that genuinely remain English. **Done in this run:** drafted the 57-term Ukrainian glossary; Claude review and later speaker review remain pending.

2. [ ] **Add and use the source exporter.** Implement the launcher, entry, and npm script specified above. Run `npm run i18n:export -- .i18n-work/en` and inspect the export for notes, plural forms, placeholders, and hashes. Save area drafts under `.i18n-work/` as needed; do not include exporter output or intermediate drafts in the pack or commit them. **Done in this run:** implemented the exporter and attempted the command, which failed because esbuild could not spawn (`EPERM`); skimmed source catalog messages across all 19 areas as a fallback, but could not inspect the generated export.

3. [ ] **Draft `assets/languages/uk.lang.json` in catalog order, one area per saved chunk:** `common`, `main`, `settings`, `dialogs`, `shell`, `editors`, `menus`, `api`, `browser`, `board`, `explorer`, `links`, `git`, `mneme`, `about`, `tools`, `uikit`, `notebook`, `logView`. For each area, read that area's exporter file, translate every entry, preserve each full key and exact placeholder name, follow notes and glossary, and copy its source hash into `source`. Assemble the pack metadata (`schemaVersion: 1`, `code: "uk"`, native `name`, `englishName: "Ukrainian"`, `messages`, `source`). Save the whole updated pack after each completed area so completed chunks survive a lost session. Use UTF-8 without BOM via a file-edit tool or Node `fs.writeFileSync(..., "utf8")`; never PowerShell. For every plural, include the categories returned by `new Intl.PluralRules("uk").resolvedOptions().pluralCategories` and `other` (Ukrainian requires `one`, `few`, `many`, `other`). Preserve the placeholders in every form.

4. [ ] **Resume safely between sessions.** Start with `npm run i18n:check` and use the `uk.lang.json` Missing, Stale source hashes, and Unverified source hashes report to find unfinished work. The checker prints at most 20 missing keys, so use the exporter and pack to identify the first incomplete area and any remaining keys in it; finish and save that area before moving to the next listed area. A completed area is already on disk. Re-run the checker after every few areas and at the end; resolve stale hashes and unverified translated entries before proceeding. Never restart by overwriting completed translations.

5. [x] **Check English leakage.** Extend the existing `scripts/i18n-check-entry.ts` checker with `--identical`, invoked as `npm run i18n:check -- --identical`. It lists exact app-pack values identical to their English source, grouped per pack; when `--boards` roots are supplied, it also lists identical translated board-pack values per board pack. It never fails solely because it found identical values. For board message keys compare with the English default pack; for `manifest.*` keys compare with the corresponding English value in `board-manifest.json`. Allow exact unchanged terms only when they are product/protocol names or acronyms, shortcuts, or entries listed as staying English in `assets/guides/agents/languages-glossary.md`. Review and resolve every other English match; this option is a report, not a translation-quality verdict. **Done in this run:** implemented the report; running it was blocked by esbuild `spawn EPERM`, and translation leakage review remains for after packs are drafted.

6. [ ] **Translate the bundled boards.** Complete `assets/boards/rest-client/lang/uk.json` (94 default message keys plus its applicable manifest keys) and add the Excalidraw language declaration, empty English default file, and Ukrainian manifest-only file as described above. Do not translate Excalidraw's internal UI strings a second time. **Done in this run:** Excalidraw now declares `lang`/`en` and has the empty default pack; its Ukrainian manifest-only pack and REST Client translations remain pending.

7. [ ] **Translate catalog boards in a separate run.** Start a separate drafting run with working root `C:\projects\persephone-boards`, confirm branch `develop`, then edit each of the fifteen catalog board directories in the table. Compare `lang/uk.json` against `lang/en.json`: same message keys, same placeholders in every form, target plural categories including `other`, and applicable `manifest.*` keys. Under the current release heading in each `WHATS-NEW.md`, create or extend the one English line `Interface languages: Ukrainian.`; later language tasks append their language names to this same line. Do not bump versions. After this run, return to `C:\projects\persephone` and run the catalog checks there.

8. [ ] **Run the pack checks.** Run from `C:\projects\persephone`:

   ```text
   npm run i18n:check
   npm run i18n:check-boards
   npm run i18n:check -- --boards "../persephone-boards/boards/*"
   npm run i18n:check -- --identical
   npm run i18n:check -- --identical --boards "assets/boards/*" "../persephone-boards/boards/*"
   ```

   Require `uk.lang.json` to report 0 missing, 0 stale, and 0 unverified messages, with no `BROKEN` lines. Require bundled and catalog board checks to pass with no missing/invalid/broken entries. Also run the English-leakage review from step 5. No `BROKEN` findings, mojibake, replacement characters, unexpected question marks, or BOMs may remain.

9. [ ] **Prepare the user review.** Claude switches to Ukrainian, captures screenshots for Settings > General > Language, the main window (tabs, sidebar and menus), at least one dialog, and board screens including REST Client, Excalidraw, and representative catalog boards where metadata is visible; Claude then switches back to English. Ask the user to review the screenshots, glossary, and Ukrainian wording together. Apply their corrections directly to `assets/languages/uk.lang.json`, the relevant bundled `lang/uk.json`, or the relevant catalog board `lang/uk.json`; preserve keys/placeholders and refresh an app `source` hash only if its English source changed. Re-run the relevant checks after corrections. The language switch reloads every window, so capture screenshots after `apply("uk")` completes and restore English with `apply("en")` afterwards.

## Concerns

- The shipped glossary deliberately contains no Ukrainian translations yet. The drafting agent fills it, Claude reviews it before area drafting, and the user reviews the glossary and pack together at the end; no user approval gate blocks drafting. US-1682 through US-1685 follow the same process.
- `validateLanguagePack()` checks structure and placeholder consistency; it does not prove natural translation quality or complete locale plural coverage. `scripts/i18n-check-entry.ts` calls `checkTranslatedMessage()`, which uses `Intl.PluralRules` and catches missing locale categories, broken UTF-8, and unexpected question marks.
- `npm run i18n:check -- --identical` reports app-pack matches; supply `--boards` roots to list board-pack matches in the same report. Identical values are listed per pack and never fail the check; product/protocol names, shortcuts, and approved glossary entries may legitimately remain identical.
- Catalog-board versions and tags were checked against the local `develop` checkout on 2026-10-10. Reconfirm immediately before edits. This task does not publish those versions.
- The first pack is large (1,524 app messages plus 94 REST Client messages and the catalog-board texts). Area-by-area writes are the recovery boundary; always save completed areas immediately.

## Acceptance Criteria

- The drafting agent fills the Ukrainian glossary table in `assets/guides/agents/languages-glossary.md` with core UI, board, workspace, and Git terminology using Ukrainian Windows terminology and the polite **ви** register. Claude reviews it before area drafting, without a user gate; the user reviews the glossary and complete pack together at the end. US-1682 through US-1685 use the same review sequence for their glossaries.
- `npm run i18n:export -- .i18n-work/en` works without opening Persephone and creates one no-BOM UTF-8 JSON file per English area with `{ key, message, placeholders, note?, sourceHash }`; `.i18n-work/` is gitignored and writable by the in-repo drafting agent. Individual area drafts may also be saved there.
- `assets/languages/uk.lang.json` covers all 1,524 catalog messages with current source hashes, preserved placeholders, notes followed, and Ukrainian plural categories `one`, `few`, `many`, `other` where applicable.
- `assets/boards/rest-client/lang/uk.json` covers all 94 default keys and applicable manifest display keys. Excalidraw declares `languages`, has a valid empty English default pack and Ukrainian manifest display entries, while its own bundled UI locale remains the source of its internal interface translation.
- All fifteen catalog boards on `persephone-boards` `develop` have complete `lang/uk.json` packs, applicable `manifest.*` keys, and the line `Interface languages: Ukrainian.` in What's New. Draft them in a separate run rooted at `C:\projects\persephone-boards`; their versions are not bumped, no publish occurs, and no change is made on `main`.
- From `C:\projects\persephone`, `npm run i18n:check`, `npm run i18n:check-boards`, `npm run i18n:check -- --boards "../persephone-boards/boards/*"`, and `npm run i18n:check -- --identical --boards "assets/boards/*" "../persephone-boards/boards/*"` run as specified. The app pack reports 0 missing, 0 stale, 0 unverified, and no `BROKEN` lines. Identical-value output is per pack and non-failing; review it under the stated exceptions.
- Claude captures screenshots with the app switched to `uk`, then restores `en`; the user reviews screenshots, glossary, and complete Ukrainian pack together, and requested corrections are applied to the source pack files and rechecked.
- This task document describes the complete glossary-first, area-by-area, board-by-board workflow so US-1682 through US-1685 can repeat it for their sixteen languages; Claude reviews each glossary before translation and there is no user gate before drafting.
- No translation pack or runtime implementation is added until this task plan is reviewed and the user asks to implement it.

## Files Changed Summary

| File | Planned change |
|---|---|
| `doc/tasks/US-1681-ukrainian-pack/README.md` | **New:** verified Ukrainian pack plan, exporter specification, area chunk order, board manifest inventory, validation and review handoff; reusable for US-1682 through US-1685. |
| `doc/active-work.md` | Link US-1681 under active EPIC-127. |
| `doc/epics/EPIC-127.md` | Link the US-1681 row to this task document. |
| `.gitignore` | Ignore `.i18n-work/` for English exports and resumable draft chunks. |
| `assets/guides/agents/languages-glossary.md` | Fill the Ukrainian table before translating, with speaker-approved Windows-aligned terms and register. |
| `package.json` | Add `i18n:export` launcher. |
| `scripts/i18n-export.mjs` | **New:** esbuild launcher for the source exporter. |
| `scripts/i18n-export-entry.ts` | **New:** writes per-area English entries, notes, placeholders, and hashes to caller-selected output. |
| `scripts/i18n-check-entry.ts` | Add non-failing `--identical` reports for app packs and supplied board roots. |
| `src/shared/i18n/hash.ts`, `src/shared/i18n/validate-pack.ts`, `src/renderer/api/languages.ts` | **No change:** the exporter reuses the existing hash, placeholder, and English-entry behavior. |
| `src/renderer/editors/board/board-manifest.ts`, `src/renderer/editors/board/board-display-text.ts`, `src/renderer/editors/board/board-i18n.ts` | **No change:** existing board language configuration, manifest display lookup, and pack loading provide the required behavior. |
| `assets/languages/uk.lang.json` | **New:** complete Ukrainian app pack. |
| `assets/boards/rest-client/lang/uk.json` | **New:** Ukrainian REST Client board pack. |
| `assets/boards/excalidraw/board-manifest.json` | Declare `lang`/`en` so board metadata can be localized. |
| `assets/boards/excalidraw/lang/en.json` | **New:** empty required default message pack. |
| `assets/boards/excalidraw/lang/uk.json` | **New:** Ukrainian manifest display text; Excalidraw's own UI locale stays bundled. |
| `C:\projects\persephone-boards\boards\*/lang/uk.json` | **New:** fifteen Ukrainian catalog board packs, authored on branch `develop`. |
| `C:\projects\persephone-boards\boards\*/WHATS-NEW.md` | Add or extend the single English `Interface languages: Ukrainian.` line under each current release heading; later language tasks append to that line; no version bump. |
| `C:\projects\persephone-boards\boards\*/board-manifest.json` | **No change:** all catalog boards already declare their English default language pack; translate display strings through `manifest.*` pack entries. |
| `assets/boards/excalidraw/lib/**` | **No change:** Excalidraw's bundled UI locale data already contains Ukrainian. |
