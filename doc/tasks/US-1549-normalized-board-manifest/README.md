# US-1549: Board manifest parsed once into a normalized model

## Goal

Use one normalized manifest parser and one shared string-list normalizer across board manifest readers. `customEditorRegistry.refresh()` must parse each source once before its registration axes; fresh facade, Board Info, and trust-dialog reads must use the same parser without a stale registry cache. The facade projects the normalized applied values while preserving optional authored fields where no default was declared.

## Background

EPIC-115 identifies repeated list loops in `src/renderer/editors/board/board-manifest.ts`, duplicated board-kind / pipe checks, a duplicated `CustomEditorMatch` shape, and fields dropped by `BoardEditorFacade.copyManifest()`. Since US-1548, `customEditorRegistry.refresh()` collects `BoardRefreshSource[]` and runs per-axis collect/commit functions. The epic's "After US-1548" note says parsing belongs at the single source-read point and that Board Info computes bridge compatibility itself. EPIC-106 D1 remains closed: `permissions` is disclosure-only.

### Verified current manifest surface

`BoardManifest` in `src/renderer/editors/board/board-manifest.ts:74-234` accepts top-level fields `schemaVersion`, `name`, `description`, `author`, `repository`, `version`, `standalone`, `singleInstance`, `minAppVersion`, `minBridgeVersion`, `permissions`, `service`, `contentProviders`, `capabilities`, `settings`, `fileMasks`, `browserUrlMasks`, `folderMasks`, `folderEditorMasks`, `contentMasks`, `editorPriority`, `folderEditorPriority`, `editorName`, `editorKind`, `editorSources`, `secondaryViews`, and `guides`. Capability declarations at `:62-72` include `id`, `representation`, `version`, `priority`, `accepts`, `payloadSchema`, `title`, `headless`, and `alwaysOpensNewPage`.

The current facade copy at `src/renderer/scripting/api-wrapper/BoardEditorFacade.ts:554-616` omits top-level `browserUrlMasks`, `contentMasks`, `singleInstance`, `settings`, and `guides`, and capability `alwaysOpensNewPage`. Both `src/renderer/api/types/board-editor.d.ts:21-57` and `assets/editor-types/board-editor.d.ts:21-57` omit the same fields. `representation` already exists in both capability type declarations. These two declarations must remain synchronized; `board-api.d.ts` IntelliSense is out of scope.

### String-list normalization contract

Place `normalizeStringList` in `src/shared/board-manifest-utils.ts`, because `src/main/board-trust-service.ts:13` imports this shared module. Its renderer-neutral signature is:

```ts
export function normalizeStringList(
    raw: unknown,
    options: {
        map: (entry: string) => string;
        max?: number;
        accept?: (value: string, acceptedSoFar: readonly string[]) => boolean;
    },
): string[];
```

The helper ignores non-string entries; maps each string; drops mapped `""`; skips a mapped value already accepted (first mapped occurrence wins); calls `accept(value, acceptedSoFar)`; pushes accepted values; and then stops when `max` accepted values have been pushed. Dedupe is on the mapped value and occurs before `accept`. `max` therefore matches `normalizeBrowserUrlMasks`' existing push-then-break-at-64 behavior.

Replace all seven string-list loops with these exact options. Constants named below already exist at the indicated source sites.

| Current list loop | Exact options / retained surrounding rule |
|-------------------|------------------------------------------|
| `normalizePermissions`, `src/shared/board-manifest-utils.ts:5-13` | `{ map: (entry) => entry.trim() }` |
| `normalizeBrowserUrlMasks`, `src/shared/board-manifest-utils.ts:23-32` | `{ map: (entry) => entry.trim().toLowerCase(), max: MAX_BROWSER_URL_MASKS, accept: (value) => value.length <= MAX_BROWSER_URL_MASK_CHARS }` |
| provider `schemes`, `src/renderer/editors/board/board-manifest.ts:429-435` | `{ map: (entry) => entry.trim().toLowerCase().replace(/:$/, "") }` |
| capability `accepts`, `src/renderer/editors/board/board-manifest.ts:462-467` | `{ map: (entry) => entry.trim() }` |
| `fileMasks`, `src/renderer/editors/board/board-manifest.ts:518-535` | `{ map: (entry) => { let mask = entry.trim().toLowerCase(); if (!mask) return ""; if (!mask.includes("*") && !mask.includes("?")) { if (mask.startsWith(".")) mask = "*" + mask; else if (!mask.includes(".")) mask = "*." + mask; } return mask; } }` |
| `folderMasks`, `src/renderer/editors/board/board-manifest.ts:560-575` | `{ map: (entry) => entry.trim().toLowerCase().replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "").replace(/\/+$/, "") }`; `normalizeFolderEditorMasks` remains a wrapper over this same result. |
| `contentMasks`, `src/renderer/editors/board/board-manifest.ts:664-675` | `{ map: (entry) => entry.trim(), accept: (value) => value.length <= MAX_CONTENT_MASK_CHARS && compileContentMask(value) !== null }`; `MAX_CONTENT_MASK_CHARS` is 500. |

All list entries above have no `max` except browser URL masks. The existing per-declaration rules remain outside this helper: provider `type` trim/blank rejection; capability object validation and rejection/reporting for a present non-boolean `alwaysOpensNewPage`; content regex compilation; and settings declaration validation. `secondaryViews` at `board-manifest.ts:791-805` is an object walk, not a string list, and stays specialized. The three pass-through wrappers remain `normalizeFolderEditorMasks` (`:580-582`), `readBoardSecondaryViews` (`:812-816`), and `normalizeBoardVersionRequirement` (`:414-416`).

The distinct transformations are intentional: permissions preserve case and are uncapped; browser masks lowercase, reject over-512-character entries, and cap at 64; provider schemes lowercase and strip one final colon; capability accepts preserve case; file masks lowercase and coerce bare extensions; folder masks lowercase and normalize separators and edge slashes; content masks preserve case and reject over-500-character or uncompilable regexes. Preserve first-seen order and all existing warnings.

## Implementation Plan

### Implementation checklist

- [x] Shared `normalizeStringList` and all seven list normalizers use the specified transformations.
- [x] Normalized model, parser, fresh reader, association defaults, issue capture, and trust disclosure helper.
- [x] Shared board-kind and pipe-ownership helpers; association-based `CustomEditorMatch` shape.
- [x] Registry sources parse once, including raw bundled records, and registration axes consume normalized values.
- [x] Facade, Board Info, and trust consumers perform fresh normalized reads.
- [x] Facade projects normalized values and clones nested JSON; script-facing declarations synchronized.
- [x] Share manifest declaration projections between Board Editor and Board Info; expose the complete normalized manifest field set in Board Info.
- [x] Run requested typecheck and lint; resolve any reports.
- [ ] Live verification listed below (requires the app and representative boards).

1. **Shared list primitive.** Add the signature and algorithm above to `src/shared/board-manifest-utils.ts` and rewrite `normalizePermissions` (`:5`) and `normalizeBrowserUrlMasks` (`:23`) to call it. Import it into `src/renderer/editors/board/board-manifest.ts`; replace the schemes loop in `normalizeContentProviders` (`:420-439`), accepts loop in `normalizeCapabilities` (`:442-494`), and the loops in `normalizeFileMasks` (`:518-536`), `normalizeFolderMasks` (`:560-576`), and `normalizeContentMasks` (`:664-676`). Retain the specialized declaration validation and public wrapper functions.

2. **Normalized model and one parser.** In `src/renderer/editors/board/board-manifest.ts`, add `NormalizedBoardManifest`, `parseBoardManifest(raw: unknown): NormalizedBoardManifest | null`, and `readNormalizedBoardManifest(root: string): Promise<NormalizedBoardManifest | null>`. `readNormalizedBoardManifest` calls `readBoardManifest(root)` once and passes its result to `parseBoardManifest`. Keep the accepted source scalars (including `schemaVersion`) separately from normalized applied values. Include normalized provider/capability/settings declarations, `BoardEditorAssociation | null`, normalized permissions/browser masks/service/guides/secondary views, and `issues: { kind: "capability" | "settings"; name: string; reason: string }[]`. Capture issue callbacks from `normalizeCapabilities` (`:442`) and `normalizeBoardSettings` (`:350`) during parsing; do not report them from a second normalization pass. Preserve authored-field presence: absent or invalid optional fields remain absent; derived `editorKind: "simple"` and `editorSources: "local"` live on the association, not as new facade defaults. Keep a non-number schema version distinguishable so the facade can continue returning `undefined`.

3. **Board kind and association shape.** Export `type BoardEditorKind = "simple" | "content-host" | "stream-host"` and `hostOwnsPipe(kind: BoardEditorKind): boolean` from `board-manifest.ts`. Change `BoardEditorAssociation.editorKind` (`:706-727`) and `CustomEditorMatch.editorKind` (`src/renderer/editors/board/custom-editor-registry.ts:90-120`) to use that type. Replace `CustomEditorMatch`'s duplicate association fields with the exact shape `interface CustomEditorMatch extends Omit<BoardEditorAssociation, "editorName" | "editorPriority"> { origin: "trusted" | "bundled"; editorId: string; boardRoot: string; name: string; priority: number; }`. Build `name` from `association.editorName || source.boardName` and `priority` from `association.editorPriority`, preserving consumer property names.

   The current host-owns-pipe predicates are: `BoardEditorModel.pipeUrlEnabled` at `BoardEditorModel.ts:630` (`content-host || stream-host`); the local-source filter at `editor-switch-options.ts:87` (same); its catalog complement at `editor-switch-options.ts:97-98` (not content-host and not stream-host); and the host portion of the compound non-local filter at `custom-editor-registry.ts:706-710` (not content-host and not stream-host, plus the independent `editorSources !== "any"` rejection). Use `hostOwnsPipe` at those four matching sites without changing the separate `editorSources` clause. `BoardEditorModel.isStreamHost` at `:634`, `resolveStreamPipe` at `:643`, and stream restoration at `:742` are stream-only and must not use it. `board-manifest.ts:766-769` normalizes unknown kinds to the simple default, while `BoardEditorFacade.ts:601-606` validates all three authored values; neither is a pipe-ownership predicate and neither should be folded into the helper.

4. **Parse refresh sources once, including bundles.** In `src/renderer/editors/board/custom-editor-registry.ts`, change `BoardRefreshSource` at `:150-154` to hold `manifest: NormalizedBoardManifest | null` plus a precomputed `boardName: string`. Replace `readBoardManifest` at `:512-520` with one raw read followed by `parseBoardManifest` per trusted/installed source. `bundledBoardRegistry.list()` at `:523-527` supplies raw `BoardManifest` records; parse each bundled record exactly once while building `sources` there. Keep `BundledBoard` in `bundled-board-registry.ts:15-22` raw because its other consumers (`resolvePersistedRoot` at `:82-102` and `tools-editors-registry.ts:217`) use the raw declaration; do not add a bundled-registry cache or root-keyed normalized accessor.

   Compute `boardName = normalizedManifest.name?.trim() || fpBasename(root)` once on every source record. Compute a stable settings namespace once from trimmed `author` and `name` when `hasStableBoardIdentity` is true; replace the repeated board-name expressions at `custom-editor-registry.ts:275,290,360,415,544` and namespace expression at `:554` with those source/model fields. Change `collectProviderAxis` (`:270-297`), `collectCapabilityAxis` (`:353-368`), `collectUrlMaskAxis` (`:410-425`), the association/settings loop (`:542-575`), compatibility filtering (`:530-533`), and commit preparation to consume normalized fields only; do not invoke normalizers again in these axes.

   Preserve warning order: the parser stores capability and settings issues in source order. The existing source-registration pass (`:542-575`) appends only `settings` issues at the same point that `normalizeBoardSettings` reports them today; `collectCapabilityAxis` (`:353-368`) appends only `capability` issues at the point `normalizeCapabilities` reports them today. Keep issue kind/name/reason identical. Continue to let commit-time provider, scheme, capability ownership, and URL-mask conflicts append through the current `addRegistrationIssue` paths (`:299-408`) in their existing order. This preserves Board Info registration rows and first-appearance toast behavior.

5. **Fresh reads for consumers.** Do not route consumers through a registry snapshot. The registry subscribes only to trust paths (`custom-editor-registry.ts:473-475`), bundled registry changes (`:476-478`), and the disabled-bundled setting (`:479-480`); it has no manifest-file watcher. Keep consumers fresh by using `readNormalizedBoardManifest(root)` at each current raw read point:
   - `BoardEditorModel.readManifestForFacade()` (`src/renderer/editors/board/BoardEditorModel.ts:1051-1053`).
   - `BoardInfoEditorModel.loadProperties()` (`src/renderer/editors/board-info/BoardInfoEditorModel.ts:375-415`) and `register()` trust disclosure (`:649-654`).
   - `BoardEditorView.trustBoard()` (`src/renderer/editors/board/BoardEditorView.ts:276-282`).
   - `boards.registerBoard()` (`src/renderer/api/boards.ts:321-325`).
   This removes the proposed root-keyed registry accessor and avoids delaying visible manifest edits until an unrelated registry refresh. The three trust entry points continue to make the same trust decision sequence; US-1554 owns deduplicating those flows.

6. **Trust disclosure helper.** Add `boardTrustDisclosure(manifest: NormalizedBoardManifest): { permissions: readonly string[]; serviceDeclared: boolean; capabilities: readonly string[] }` in `board-manifest.ts`. Use it at `BoardEditorView.ts:277-281`, `BoardInfoEditorModel.ts:649-653`, and `api/boards.ts:321-324`. Keep the optional `capabilities` fallback in `showTrustBoardDialog` (`src/renderer/ui/dialogs/TrustBoardDialog.ts:19-25`) for existing/future callers that omit it, but change that fallback to call `readNormalizedBoardManifest(boardPath)` and `boardTrustDisclosure`; remove its direct `normalizeCapabilities`/`readBoardManifest` path. Verified current direct callers are those three sites; each will pass the full helper result. Preserve dialog rows and wording and keep `permissions` disclosure-only.

7. **Facade projection and script-visible decision.** In `src/renderer/scripting/api-wrapper/BoardEditorFacade.ts:285-287,554-616`, replace `copyManifest(manifest: BoardManifest)` with `projectBoardManifest(manifest: NormalizedBoardManifest): IBoardManifest | undefined`. Return `undefined` when the authored `schemaVersion` is not a number, as today. Project normalized applied values for declarations and masks, but keep a field optional when it was absent/invalid instead of filling association defaults into the facade. In particular, keep `editorKind?` and `editorSources?` only when valid authored values exist; association defaults remain internal. Deep-clone nested JSON values (`settings`, `payloadSchema`) and all arrays/records before returning them so script mutation cannot affect the parsed model. Extend both `IBoardManifest` declarations and nested interfaces with every accepted field.

#### Script-visible changes

This is an intentional facade behavior change: `getManifest()` reports normalized values Persephone applies, rather than returning known-type authored values that can disagree with registry behavior. Existing fields can change as follows:

- `permissions`: trimmed and first-seen deduplicated (case preserved).
- `browserUrlMasks`: trimmed, lowercased, deduplicated, invalid-length values dropped, capped at 64.
- `service`: safe normalized board-relative path or absent; unsafe values no longer pass through as authored strings.
- `contentProviders`: valid provider types are trimmed; blank types are removed; schemes are trimmed, lowercased, have one final colon removed, and are deduplicated.
- `capabilities`: ids, `representation`, and `title` are trimmed; `accepts` is trimmed and deduplicated; a declaration with a present non-boolean `alwaysOpensNewPage` is rejected and its current issue is retained. The valid `alwaysOpensNewPage` field is now exposed.
- `fileMasks`: trim/lowercase/dedupe and bare-extension coercion (for example, authored `drawio` projects as `*.drawio`).
- `folderMasks` and `folderEditorMasks`: trim/lowercase, slash normalization, edge-slash removal, and dedupe.
- `contentMasks`: trim, dedupe, and reject overlong or invalid regex entries.
- `editorName`: trim and omit an empty value. For each present numeric `editorPriority` or `folderEditorPriority`, project the applied value (finite positive number, otherwise `0`); keep an absent priority absent.
- `secondaryViews`: normalize text fields; remove malformed, separator-containing, and later duplicate ids.
- Newly exposed fields are `browserUrlMasks`, `contentMasks`, `singleInstance`, `settings`, `guides`, and capability `alwaysOpensNewPage`. `settings` exposes only declarations with a trimmed non-empty id, supported type, valid type-matching scalar default (finite for numbers), and valid enum options/default; duplicate ids are first-wins. Its options are trimmed and deduplicated, and blank format/label/description values are omitted. `guides` is trimmed, slash-normalized with leading `./` and trailing slashes removed, and rejected when absolute or containing empty, `.` or `..` path segments. Other descriptive scalar strings and valid authored enum/boolean fields retain their authored value.
- `IBoardInfoProperties` exposes the same normalized manifest-derived fields as Board Editor for `standalone`, `singleInstance`, `minAppVersion`, `browserUrlMasks`, `contentMasks`, `editorPriority`, `editorSources`, `settings`, `secondaryViews`, and `guides`, plus capability `representation` and `alwaysOpensNewPage`. These fields remain omitted when absent; arrays are copied and capability `payloadSchema` is deep-cloned.

8. **Board Info.** Change `BoardInfoEditorModel.loadProperties()` at `:375-415` to read a fresh normalized manifest and project its manifest-derived values and association. Keep service status, compatibility result, registration issues, root/trust/install/catalog data app-owned. Change the `register()` disclosure branch at `:649-654` to use the shared trust helper. Preserve the distinction between missing optional fields and explicit normalized empty arrays in the properties model.

9. **Types and script API docs.** Synchronize `src/renderer/api/types/board-editor.d.ts` and `assets/editor-types/board-editor.d.ts` with all fields in the verified manifest inventory and capability shape, including `representation` and `alwaysOpensNewPage`. Do not edit `src/renderer/editors/board/board-api.d.ts` or any board IntelliSense copy. These declaration changes are a script API change.

10. **Other raw readers and scope.** Convert only the required registry, facade, Board Info, and trust-disclosure paths above. Keep the following raw reads/normalizer callers and record why they remain outside this story:

| Current readers/callers (source line at review) | Decision and reason |
|-----------------------------------------------|---------------------|
| `src/renderer/content/open-handler.ts:57-58`; `src/renderer/api/pages/PagesLifecycleModel.ts:116` (`isBoardSingleInstance`) | Keep focused single-instance routing reads; they read fresh raw metadata and are not registry/facade/Board Info/trust paths. |
| `src/renderer/editors/board/BoardEditorModel.ts:879` (title), `:954-955` (`readBoardSecondaryViews`) | Keep focused title and secondary-view reads; the secondary-view object walk remains specialized. |
| `src/renderer/api/board-settings/board-settings-bridge.ts:54-59,210-214`; `src/renderer/api/board-namespace.ts:27-29` (`normalizeBoardSettings`, `hasStableBoardIdentity`) | Keep fresh reads in setting-value and identity checks; parser may share their pure validators, but no registry snapshot is introduced. |
| `src/renderer/guides/board-guide-mounts.ts:46` (`normalizeBoardGuidesFolder`) | Keep guide-mount safety boundary and shared validator; no manifest cache is added. |
| `src/renderer/api/board-install.ts:69,181`; `src/renderer/api/boards.ts:262-264,599-602`; `src/renderer/editors/board/board-scaffold.ts:75-79` | Keep raw source reads for install/version checks, board-list metadata, uninstall labeling, and read-modify-write scaffolding. Scaffolding must preserve authored fields it does not own. |
| `src/renderer/editors/board/board-usage-cache.ts:45-46` (`boardUsageGroup`); `src/renderer/editors/tools-hub/SearchBoardsTab.ts:33` | Keep the cache's explicit invalidation/re-probe behavior for manifest edits and its existing raw manifest input. |
| `src/renderer/ui/sidebar/tools-editors-registry.ts:217`; `src/renderer/api/pages/PagesPersistenceModel.ts:81` (`getBoardEditorAssociation`) | Keep external/bundled association consumers out of this pass; `CustomEditorMatch` reuse is limited to the registry model and must not change these callers' source types. |
| `src/renderer/editors/board/board-service-permission.ts:10-13` (`normalizePermissions`) | Keep the focused permission predicate; moving the helper to shared keeps renderer and main behavior aligned without requiring a normalized-model dependency. |
| `src/renderer/editors/board/bundled-board-registry.ts:51-58,82-102` (`readBoardManifest`) | Keep `BundledBoard.manifest: BoardManifest` raw for existing bundled consumers; `customEditorRegistry.refresh()` parses each listed record when constructing its normalized source. |
| `src/main/board-trust-service.ts:58-71,195-217,245-246`; `src/main/board-storage.ts:207-212`; `src/main/mcp/ai-vision/board-guide-mounts.ts:49-51` | Keep main-process-owned readers and security boundaries; renderer model is unavailable there. Main trust uses the new shared list helper, while storage reads only the display name and guide mounting uses the shared guide-path validator. |

Other consumers of `normalizeFileMasks`, `normalizeFolderMasks`, `normalizeBoardServicePath`, and related helpers should continue calling the public normalizers; those functions become projections of the same underlying semantics where applicable. `isBoardStandalone`, `boardUsageGroup`, `isBoardSingleInstance`, `readBoardSecondaryViews`, `getBoardEditorAssociation`, and `hasStableBoardIdentity` are not all registry reads; only `getBoardEditorAssociation` in registry/Board Info is replaced by the parsed association in this story. The call-site inventory above is the verified scope boundary.

### Review findings addressed

1. Shared string-list helper is placed in `src/shared/board-manifest-utils.ts` and exact options are specified above.
2. Facade projects normalized applied values; optional authored presence and the `schemaVersion` failure rule are explicit, and all visible changes are listed above.
3. Fresh readers call `readNormalizedBoardManifest`; no registry snapshot accessor is planned.
4. Bundled records remain raw in `BundledBoardRegistry` and are parsed once while `customEditorRegistry.refresh()` builds sources.
5. Parse-time capability/settings issues are retained and replayed in the existing registration stages/order.
6. `boardTrustDisclosure` is shared by all three trust callers; the dialog fallback stays but uses that helper.
7. `boardName` and normalized settings namespace are computed once per source.
8. Other manifest readers and helpers are enumerated above with scope decisions.
9. Exact host ownership sites are identified; stream-only and enum-validation sites remain distinct.
10. `CustomEditorMatch` uses the explicit `Omit<BoardEditorAssociation, ...>` shape above.
11. The before/after snippet below uses ASCII slash wording; the document contains no mojibake.
12. Bridge handlers are checked below; no board-facing manifest result is changed.
13. Live registration-table and editor-switch comparisons are listed under Not verified / risks.

Before / after (shape only):

```ts
// Before: raw source and repeated consumer normalization
interface BoardRefreshSource { manifest: BoardManifest | null; /* ... */ }
const copy = copyManifest(rawManifest);

// After: one normalized source is passed through registration axes
interface BoardRefreshSource { manifest: NormalizedBoardManifest | null; boardName: string; /* ... */ }
const copy = projectBoardManifest(normalizedManifest);
```

## Concerns

- **Normalization compatibility:** preserve mapped first-seen dedupe, caps, trim/case rules, extension coercion, regex rejection, warnings, and issue order exactly as specified.
- **Script API:** `page.editor.getManifest()` and `src/renderer/api/types/board-editor.d.ts` change. Only the facade's returned manifest semantics and exposed fields change; do not edit board IntelliSense declarations.
- **Bridge version:** keep `BOARD_BRIDGE_VERSION` at `1.23.0`. Inspection of `BoardWebview`'s board-frame message handlers and the `persephone.*` bridge surface found no board-facing manifest object/result; `page.editor.getManifest()` is the Persephone script facade, not the board bridge. Recheck handlers during implementation if a new board-frame result is added; that would require a bridge bump under EPIC-115.
- **Facade isolation:** clone nested JSON (`settings`, `payloadSchema`) and all normalized lists/declarations. Do not return references owned by a normalized source.
- **Trust:** `permissions` remains disclosure-only; trust remains granted only after the same user dialog and namespace check. US-1554 owns consolidation of granting paths.
- **No implementation yet:** this document is the plan for review. Do not add or run tests or a test harness for this task.

## Acceptance Criteria

- All seven string-list walks call the shared helper with the exact options above; `secondaryViews` remains an object normalizer.
- Each trusted, installed, and bundled source reaches registry axes as a normalized source after exactly one parse per source in `refresh()`; callback issues and commit-time issues preserve their current kind, text, order, and toast behavior.
- Fresh facade, Board Info, and trust-dialog paths call `readNormalizedBoardManifest(root)` and do not depend on the registry's refresh timing.
- The facade projects all accepted fields, including `representation`, `alwaysOpensNewPage`, and the previously omitted fields; its documented script-visible normalized values are intentional and complete.
- `CustomEditorMatch` retains consumer names and derives from `BoardEditorAssociation`; helper reuse does not fold stream-only checks into `hostOwnsPipe`.
- Both `IBoardManifest` declarations stay identical and cover the full current field inventory.
- Board Info properties and registration rows, trust disclosure, registry registrations, and editor-switch choices have no unintended changes.
- No bridge change is introduced; do not bump `BOARD_BRIDGE_VERSION` unless implementation adds/changes a board-frame bridge result.
- No tests or test harnesses are added or run.

## Live verification

Run 2026-09-28 in the dev app over MCP, on synthetic files (`a.excalidraw`, `a.torrent`, `a.stream-demo`, `a.txt`) and a scratch board. Each path was invoked twice.

- [x] `page.editor.getManifest()` on Excalidraw (bundled content-host), Torrent Viewer (simple) and the demo stream-host (scratch copy of the Demo board): the fields dropped before this story now appear (Excalidraw `settings` and capability `alwaysOpensNewPage`; torrent `singleInstance` and `browserUrlMasks`; demo `secondaryViews`). Output was identical across runs and fresh pages.
- [x] Board Info properties (opened via the board menu "Board properties"): every field the facade returns matches the Board Info `properties` value, on all three boards, in both runs.
- [x] Trust dialog on the untrusted scratch board `US1538Repro`: rows read "Permissions: service, contentProviders, capabilities / Service: declared / Capabilities: demo.greet". Cancelled both times; board stayed untrusted; no page opened.
- [x] Editor-switch options and the resolved editor for `.excalidraw`, `.torrent`, `.stream-demo` and `.txt` match the pre-change baseline exactly.
- [x] Bridge: no board-frame result carries manifest data, so `BOARD_BRIDGE_VERSION` stays 1.23.0.

## Not verified

- Non-local sources (archive entry or `https` URL) in the editor-switch options. The `hostOwnsPipe` substitution is the same predicate, but it was not exercised live.
- Board Info's registration-issue rows were not compared before/after on a board that has refusals.
- Facade mutation isolation was not exercised live. It follows from the code: every `getManifest()` call re-reads and re-parses the file, and the projection copies arrays and deep-clones `payloadSchema`.
- `node scripts/build-prod.mjs` passed before the final one-line Board Info fix (`editorKind` stays the association's kind, so the "(simple)" label is unchanged). Only typecheck and lint were run after that fix.

## Decisions made on the user's behalf

- `getManifest()` returns the normalized values Persephone applies, not the authored text. That is what "a projection that cannot drift" means, and it matches what the registry does. The script-visible differences are listed above and in What's New.
- Consumers (facade, Board Info, trust dialog) read the manifest fresh and parse it with `readNormalizedBoardManifest`, rather than reading a registry snapshot. The registry does not watch manifest files, so a snapshot would hide an author's edits until some unrelated refresh.
- Board Info's script `properties` now expose the same manifest-derived fields as `getManifest()`, through one shared projection module (`board-manifest-projection.ts`). Its `editorKind` stays the association's defaulted kind, as before.

Files explicitly not to change: `src/renderer/editors/board/board-api.d.ts` and its IntelliSense copy; `src/shared/board-bridge-version.ts`; tests and test harnesses.

## Files Changed

| File | Planned change |
|------|----------------|
| `src/shared/board-manifest-utils.ts` | Add renderer-neutral `normalizeStringList`; rewrite permissions and browser URL mask normalizers |
| `src/renderer/editors/board/board-manifest.ts` | Add normalized model/parser/fresh reader/disclosure helper; replace renderer string-list loops; export kind/pipe helper |
| `src/renderer/editors/board/custom-editor-registry.ts` | Parse once per source, retain issues and source name/namespace, consume normalized axes |
| `src/renderer/editors/board/BoardEditorModel.ts` | Read fresh normalized manifest for the script facade |
| `src/renderer/scripting/api-wrapper/BoardEditorFacade.ts` | Project normalized manifest with isolated nested values |
| `src/renderer/scripting/api-wrapper/board-manifest-projection.ts` | Share manifest, declaration, and JSON-clone projections across script facades |
| `src/renderer/api/types/board-editor.d.ts`, `assets/editor-types/board-editor.d.ts` | Synchronize complete script-facing types |
| `src/renderer/editors/board-info/BoardInfoEditorModel.ts` | Read fresh normalized data for properties and trust disclosure |
| `src/renderer/scripting/api-wrapper/BoardInfoEditorFacade.ts` | Reuse shared projections and expose all normalized manifest-backed properties |
| `src/renderer/api/types/board-info-editor.d.ts`, `assets/editor-types/board-info-editor.d.ts` | Add normalized Board Info properties and reuse Board Editor declaration types |
| `src/renderer/editors/board/BoardEditorView.ts`, `src/renderer/api/boards.ts`, `src/renderer/ui/dialogs/TrustBoardDialog.ts` | Use shared normalized trust disclosure helper, including fallback |
| `src/renderer/editors/base/editor-switch-options.ts` | Use `hostOwnsPipe` at equivalent locality filters |
| `src/renderer/editors/board/custom-editor-registry.ts`, `src/renderer/editors/board/BoardEditorModel.ts` | Use shared type/helper at matching call sites only |
| `doc/tasks/US-1549-normalized-board-manifest/README.md` | Verified plan and review corrections |
