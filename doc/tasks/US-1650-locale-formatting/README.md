# US-1650: Locale-aware formatting through `Intl`

Epic: [EPIC-124](../../epics/EPIC-124.md)

## Goal

Give renderer UI dates, times, relative times, numbers, and byte sizes one shared formatter backed by `Intl` and `getActiveLocale()`. Keep persisted, copied, logged, script-facing, MCP-facing, and otherwise machine-consumed values in their existing stable formats.

## Background

The active locale is held in `src/shared/i18n/active-locale.ts`; `getActiveLocale()` reads it synchronously. `src/shared/i18n/plurals.ts` and `src/shared/i18n/t.ts` are for catalog message plurals and translated text. Relative time is numeric formatting, so it must use `Intl.RelativeTimeFormat` directly rather than a `t()` plural message.

Follow D8 in `doc/localization-roadmap.md` §3: locale-format displayed values, preserve ISO/data formats, and consolidate applicable renderer UI formatters in `src/renderer/core/utils/format.ts`. This belongs in the renderer: the audited formatting consumers are native renderer views, the active locale can be imported from shared code, and main-process or script/MCP data paths must retain their current stable output.

The formatter locale resolver must map `en-XA` to `en` for `Intl`. `en-XA` is a pseudo-language for catalog text; date/number formatting should remain valid English output while translated UI text continues to be pseudo-localized. Do not pass the pseudo locale through and rely on host ICU support.

Byte sizes use 1024-based scaling, preserving current thresholds and precision, with `Intl.NumberFormat` `style: "unit"` and `unitDisplay: "short"` for localized unit labels (byte, kilobyte, megabyte, gigabyte, terabyte). The locale controls decimal separators and unit notation; unit labels are not manually appended English symbols. Return the localized zero-byte value for non-finite or non-positive inputs, matching the shared helper's existing zero behavior.

### Verified formatter and call-site inventory

| Source and symbol | What it formats / audience | Decision |
|---|---|---|
| `src/renderer/core/utils/format-bytes.ts:2` `formatBytes` | Shared renderer helper used in pipe progress (`components/pipe-status/PipeStageListView.ts:52-59`, `PagePipeStatusModel.ts:124`), board archive/progress UI (`editors/board-info/BoardInfoEditorView.ts:245,282`), and board search results (`editors/tools-hub/SearchBoardsTab.ts:448`). | Replace helper internals/use with shared localized byte formatter. These are visible UI values. |
| `src/renderer/core/utils/utils.ts:38` `formatDate` | Formats ISO notebook update dates; its only imports are `editors/notebook/ExpandedNoteView.ts:12` and `NoteItemViewModel.ts:2`, rendered by `NoteItemView.ts:240` and `ExpandedNoteView.ts:135`. Stored note timestamps remain ISO. | Replace display conversion with `formatDate`; keep stored timestamps unchanged. |
| `src/renderer/editors/mneme-config/mnemeTypes.ts:140` `formatBytes` | Mneme model downloads, model files, roots, and stale-index sizes rendered by `ModelPanel.ts:35,78` and `RootsPanel.ts:150,196,258`. MCP results are parsed as data; this local helper is only called by renderer UI. | Remove duplicate UI formatter; use shared localized byte formatter. Keep filenames and MCP payloads unchanged. |
| `src/renderer/editors/browser/BrowserDownloadsPopup.ts:321` `formatBytes` | Download progress and completed sizes displayed in the downloads popover (`:156-160`). | Remove duplicate UI formatter; use shared localized byte formatter. Keep filename and save path text unchanged. |
| `src/renderer/core/utils/html-resources.ts:134` `formatSize` | Adds a size suffix to generated inline-script/style titles (`:82-83,97-98`) in `extractHtmlResources`, whose returned `ILink[]` is explicitly also available to user scripts (`:8-10,13`). | Keep the existing fixed format. This value is part of a returned data/title contract, not a renderer-only label; do not introduce active-locale output into script results. |
| `src/renderer/components/git-tree/git-date.ts:8` `dateText` | Local-time date/time displayed in the git history date grid (`GitTreeView.ts:117-123`) and commit details (`editors/git-tree/CommitInfoPanel.ts:100`). The grid column key is numeric `authorDate`; its display projection is `dateText`. | Replace UI display with localized `formatDateTime`; retain the numeric source value and sort behavior. |
| `src/renderer/editors/explorer/clipboard-date.ts:14-35` `timeText` / `clipboardTimeLabel` | Explorer clipboard-history badge and tooltip (`ClipboardSecondaryView.ts:300,332`); currently shows local `HH:mm`, “Today at …”, and hand-built `N days ago` / `-Nd`. | Localize the displayed time and relative-day wording. Use `Intl.RelativeTimeFormat` for the day difference; keep the captured timestamp and clipboard text unchanged. |
| `src/renderer/editors/log-view/LogEntryWrapper.ts:25` `formatTimestamp` | A timestamp rendered alongside log entries (`:89-91`), with fixed `HH:mm:ss.SSS` precision. Log data also has timestamps and is inspectable/exportable. | Keep the current fixed timestamp representation. Logs are data and D3 keeps log surfaces stable. |
| `src/renderer/editors/video/AudioControls.ts:11` `formatTime` | Current playback position and media duration (`:168-170`), as `minutes:seconds`. | Leave unchanged. Media duration `mm:ss` is locale-neutral and is not a date/time-of-day. |
| `src/renderer/ui/dialogs/TorInfoDialogView.ts:16` `formatLocation` | Joins provider-supplied city, region, and country for the Tor/proxy info dialog (`:207-210`). | Leave unchanged. It formats location data, not dates, numbers, or relative time; labels and explanatory strings are separate localization work. |
| `src/renderer/uikit/DataGrid/cell-tooltip.ts:110-114` `truncate` | Displays the number of characters omitted in a clipped-cell tooltip via `dropped.toLocaleString()`. | Use shared `formatNumber` so the visible count follows the active locale. Cell contents themselves remain untouched. |
| `src/renderer/editors/board-info/BoardInfoEditorView.ts:499-500` `status.startedAt.toISOString()` | ISO timestamp shown in the service-status section of the board-info UI. | Localize this display with `formatDateTime`; retain the source timestamp and any status data returned through the object model/MCP. |
| `src/renderer/editors/log-view/LogViewEditor.ts:362-363`, `src/renderer/scripting/ScriptContext.ts:81-84,240`, `src/main/mcp/ai-vision/main-script.ts:42` | Store numeric timestamps in log/script/agent data. | Keep numeric values as-is; do not format at the source or alter agent-facing results. |
| `src/main/board-log.ts:84` | Writes ISO timestamps to a log file. | Keep ISO. |
| `src/renderer/content/providers/FileProvider.ts:46`, `CacheFileProvider.ts:55`, `GuideProvider.ts:36`, `src/renderer/content/tree-providers/FileTreeProvider.ts:127`, `ArchiveTreeProvider.ts:96` | Serialize file modification times as ISO metadata. | Keep ISO. |
| `src/renderer/editors/notebook/NotebookEditor.ts:357,683-803` | Writes notebook `updatedDate` values with `toISOString()`. | Keep ISO in note data; only notebook date labels use localized display formatting. |
| `src/renderer/scripting/script-utils.ts:100` | Returns a JavaScript `Date` as ISO text to scripts. | Keep ISO; script API output is stable data. |

### Additional formatting search findings

The repository-wide renderer/main/shared TypeScript search found one `toLocaleString()` display call: `cell-tooltip.ts` above. The manual date-part builders are `utils.ts:38-43`, `git-date.ts:8-14`, `clipboard-date.ts:14-35`, and `LogEntryWrapper.ts:25-32`, classified above. The hand-built relative phrase exists only in `clipboard-date.ts:35`; git dates are absolute date/time values, not relative phrases.

Clipboard history's captured time is displayed only in its badge and tooltip; it is not part of the copied clipboard payload. No copied payload, saved content, or filename should pass through a locale formatter. Grid sorting continues to consume the underlying values; in particular, the git date cell's `authorDate` is numeric even though its old display text was sortable-looking.

Other `toFixed()` sites found:

| Source | Use | Decision |
|---|---|---|
| `BrowserDownloadsPopup.ts:326`, `mnemeTypes.ts:149`, `format-bytes.ts:12`, `html-resources.ts:136-137` | Byte display helpers, covered above. | Replace only UI helper cases; preserve the script-returned HTML-resource title format. |
| `src/renderer/editors/mneme-root/results-to-markdown.ts:33` | Two-decimal score written into generated Markdown. | Keep fixed; generated document content is data. |
| `src/renderer/editors/storybook/renderGridStory.ts:132` | Developer story performance display. | Use `formatNumber` for the displayed millisecond value if that story remains in scope; this is UI, not returned data. |
| `src/renderer/uikit/DataGrid/DataGrid.story.ts:34` | Developer story ratio label. | Use `formatNumber` for the displayed ratio if that story remains in scope. |
| `src/renderer/theme/custom-theme.ts:378` | Rounds a contrast ratio in a returned report object. | Keep fixed; this is structured diagnostic data. |
| `src/renderer/theme/color-math.ts:46` | Serializes alpha for color/CSS parsing. | Keep fixed; this is a machine-readable color representation. |

Date construction and `toISOString()` searches also found source serialization, `Date.now()` clock/timing calculations, and IDs/deadlines; those are not display formatters and do not change. In particular, files, logs, grid/sort data, clipboard contents, generated files, script output, MCP results, ai-vision data, and object-model values retain their existing format. A formatted value visible in the native UI may be localized without changing the underlying data contract.

## Implementation Plan

- [ ] Add `src/renderer/core/utils/format.ts`, importing `getActiveLocale` from `src/shared/i18n/active-locale.ts`. Resolve `en-XA` to `en` for every `Intl` constructor. Cache formatter instances by effective locale/options if useful; formatter caching must not capture a stale locale.
- [ ] Export `formatDate`, `formatDateTime`, `formatTime`, `formatRelativeTime`, `formatNumber`, and `formatBytes`. Use `Intl.DateTimeFormat`, `Intl.NumberFormat`, and `Intl.RelativeTimeFormat`; keep option defaults consistent and allow callers to supply appropriate options where needed. `formatRelativeTime` accepts a signed numeric amount and an explicit `Intl.RelativeTimeFormatUnit`, so callers do not build plural strings. Preserve the current 1024-based byte thresholds and precision while asking `Intl.NumberFormat` to localize each unit.
- [ ] Replace `formatDate` in `src/renderer/core/utils/utils.ts` with the shared formatter and update the notebook display imports in `src/renderer/editors/notebook/ExpandedNoteView.ts` and `NoteItemViewModel.ts`. Do not change `NotebookEditor.ts` ISO writes.
- [ ] Replace byte-size display duplicates/usages in `src/renderer/core/utils/format-bytes.ts`, `src/renderer/editors/mneme-config/mnemeTypes.ts`, and `src/renderer/editors/browser/BrowserDownloadsPopup.ts`; keep UI call sites using the single shared `formatBytes` and return localized zero bytes for non-finite/non-positive input.
- [ ] Replace `dateText` presentation in `src/renderer/components/git-tree/git-date.ts` and its consumers `src/renderer/components/git-tree/GitTreeView.ts` and `src/renderer/editors/git-tree/CommitInfoPanel.ts` with localized date/time formatting. Keep `GitCommitRow.authorDate` numeric so grid sorting still uses the data value.
- [ ] Update `src/renderer/editors/explorer/clipboard-date.ts`: use localized time for the badge, `formatRelativeTime(-dayDifference, "day")` for older-item relative text, and localized date/time as needed for the visible tooltip. Remove the singular/plural ternary. Preserve day-boundary calculation and underlying captured timestamp.
- [ ] Replace `dropped.toLocaleString()` in `src/renderer/uikit/DataGrid/cell-tooltip.ts` with `formatNumber(dropped)`.
- [ ] Replace the board-info UI `status.startedAt.toISOString()` display in `src/renderer/editors/board-info/BoardInfoEditorView.ts` with localized date/time formatting.
- [ ] Update the visible developer story numbers in `src/renderer/editors/storybook/renderGridStory.ts` and `src/renderer/uikit/DataGrid/DataGrid.story.ts` to use `formatNumber`; keep their fixed precision only where it is part of the measurement display contract, and do not change the theme report/color serialization or generated Markdown score.
- [ ] Keep `src/renderer/core/utils/html-resources.ts:134-138` fixed because it contributes to titles returned from `extractHtmlResources()` to scripts. Keep `src/renderer/editors/log-view/LogEntryWrapper.ts` at `HH:mm:ss.SSS`, `src/renderer/editors/video/AudioControls.ts` at `mm:ss`, `src/renderer/ui/dialogs/TorInfoDialogView.ts` raw location composition, and all ISO serialization/log/MCP/script data unchanged.
- [ ] Extend the existing dev-only `globalThis.__persephoneI18nDebug` object in `src/renderer/i18n/startup.ts:111-122` with the six formatters so live MCP-assisted verification can invoke them without adding a test harness. Keep this hook development-only.

### Before → after examples

```ts
// Before: renderer locale ignored; separators and labels are hardcoded.
return `${unit === 0 ? Math.round(size) : size.toFixed(1)} ${units[unit]}`;

// After: the shared formatter uses the active locale and localized unit style.
return formatBytes(bytes);
```

```ts
// Before: English plural selection is embedded in clipboard UI code.
tooltip: dayDifference === 1 ? "1 day ago" : `${dayDifference} days ago`,

// After: the runtime supplies locale-specific relative-time grammar.
tooltip: formatRelativeTime(-dayDifference, "day"),
```

## Concerns

- `Intl.RelativeTimeFormat` covers the clipboard history's “N days ago” wording with locale plural rules; it does not create the current “Today at HH:mm” phrase. Keep “today” as a localized catalog message in the later string-extraction task and provide the time through `formatTime`. It does not apply to git dates, which are absolute timestamps and use `formatDateTime`.
- `Intl.NumberFormat` short unit spellings can differ by locale (for example, punctuation, spacing, and localized abbreviations); that is required locale behavior. Keep the existing 1024 scaling even though the localized short `kilobyte` unit may use an SI spelling.
- Do not localize values simply because their source is shown in a UI. `html-resources.ts` output becomes a title in an `ILink[]` returned to scripts; its size text remains fixed. The same rule applies to generated Markdown, logs, copied values, and all scripting/ai-vision/MCP responses.
- The developer story call sites are display-only but are outside normal user flows; if a later implementation excludes story-only files, record that exception rather than silently treating their `toFixed()` calls as data.

## Acceptance Criteria

- [ ] The six shared formatters use `getActiveLocale()` and `Intl`; `en-XA` successfully formats through English without passing `en-XA` to Intl constructors.
- [ ] With active locale `de`, `formatNumber(1234.5)` uses German separators and byte formatting displays a localized short unit (for example, a `1.234,5 KB`-style result, subject to Intl's localized unit spelling).
- [ ] A live locale-specific check such as `formatRelativeTime(-3, "day")` through `globalThis.__persephoneI18nDebug` produces a correctly pluralized Ukrainian “3 days ago” equivalent; the singular case is also grammatically correct.
- [ ] The notebook, git history/detail, clipboard history, board-info service status, browser downloads, Mneme panels, board/pipe status, board search, and grid tooltip number displays use the shared formatters where classified as UI above.
- [ ] Clipboard relative wording uses `Intl.RelativeTimeFormat`, not a `t()` plural entry or singular/plural ternary. Media duration remains `mm:ss`; log timestamps remain `HH:mm:ss.SSS`.
- [ ] `html-resources.ts` script-returned title sizes, file and note timestamp storage, log and generated-file formats, clipboard payloads, numeric grid sort data, script API/ai-vision/MCP output, and theme/color serialization remain byte-for-byte or structurally stable.
- [ ] No test or harness is added. Claude verifies live through Persephone MCP by invoking the dev-only formatter hook when available and observing representative rendered values under at least `de`, `uk`, and `en-XA`.

## Files Changed

| File | Planned change |
|---|---|
| `src/renderer/core/utils/format.ts` | Add the shared locale-aware `Intl` formatters. |
| `src/renderer/core/utils/utils.ts` | Remove its duplicate display `formatDate`. |
| `src/renderer/core/utils/format-bytes.ts` | Delegate/remove the duplicate UI byte formatter. |
| `src/renderer/editors/mneme-config/mnemeTypes.ts` | Remove duplicate UI byte formatter. |
| `src/renderer/editors/browser/BrowserDownloadsPopup.ts` | Remove duplicate byte formatter. |
| `src/renderer/components/git-tree/git-date.ts` | Delegate/remove the fixed UI date formatter. |
| `src/renderer/editors/explorer/clipboard-date.ts` | Use localized time and Intl relative time. |
| `src/renderer/uikit/DataGrid/cell-tooltip.ts` | Localize the displayed omitted-character count. |
| `src/renderer/editors/board-info/BoardInfoEditorView.ts` | Localize the visible service start date/time. |
| `src/renderer/editors/storybook/renderGridStory.ts` | Localize displayed numeric performance metrics. |
| `src/renderer/uikit/DataGrid/DataGrid.story.ts` | Localize the displayed numeric ratio. |
| `src/renderer/i18n/startup.ts` | Expose formatters through the existing development-only i18n debug hook. |
| `src/renderer/editors/notebook/ExpandedNoteView.ts` | Import the shared date formatter. |
| `src/renderer/editors/notebook/NoteItemViewModel.ts` | Import the shared date formatter. |
| `src/renderer/components/git-tree/GitTreeView.ts` | Use shared localized date/time projection. |
| `src/renderer/editors/git-tree/CommitInfoPanel.ts` | Use shared localized date/time display. |

### Files needing no changes

- `src/renderer/core/utils/html-resources.ts` — `formatSize` remains fixed because it is included in script-returned `ILink` titles.
- `src/renderer/editors/log-view/LogEntryWrapper.ts` — log timestamp display remains fixed `HH:mm:ss.SSS`.
- `src/renderer/editors/video/AudioControls.ts` — media elapsed/duration labels remain locale-neutral `mm:ss`.
- `src/renderer/ui/dialogs/TorInfoDialogView.ts` — provider-supplied location parts remain data values; only surrounding dialog text is localization work.
- `src/renderer/editors/mneme-root/results-to-markdown.ts` — generated Markdown score keeps its fixed two-decimal representation.
- `src/renderer/theme/custom-theme.ts` and `src/renderer/theme/color-math.ts` — structured contrast values and CSS/color serialization remain machine-stable.
- `src/main/board-log.ts`, renderer content/tree providers, `src/renderer/editors/notebook/NotebookEditor.ts`, and `src/renderer/scripting/script-utils.ts` — ISO date serialization remains unchanged.
- `src/renderer/editors/log-view/LogViewEditor.ts`, `src/renderer/scripting/ScriptContext.ts`, and `src/main/mcp/ai-vision/main-script.ts` — numeric timestamps remain unchanged in log, script, and agent data.
- `doc/active-work.md` and `doc/epics/EPIC-124.md` — already link to this task path; no link edits are needed.
