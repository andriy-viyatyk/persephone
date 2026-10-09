# US-1650: Locale-aware formatting through `Intl`

Epic: [EPIC-124](../../epics/EPIC-124.md)

## Goal

Give renderer UI dates, times, relative times, numbers, and byte sizes one shared formatter backed by `Intl` and `getActiveLocale()`. Keep persisted, copied, logged, script-facing, MCP-facing, and otherwise machine-consumed values in their existing stable formats.

## Background

The active locale is held in `src/shared/i18n/active-locale.ts`; `getActiveLocale()` reads it synchronously. `src/shared/i18n/plurals.ts` and `src/shared/i18n/t.ts` are for catalog message plurals and translated text. Relative time is numeric formatting, so it must use `Intl.RelativeTimeFormat` directly rather than a `t()` plural message.

Follow D8 in `doc/localization-roadmap.md` §3, refined here: language-neutral numeric date/time formats (ISO-style `YYYY-MM-DD` and 24-hour `HH:mm`) stay as they are; localization applies to words, decimal/grouping separators, and units. Preserve data formats and consolidate applicable renderer UI formatters in `src/renderer/core/utils/format.ts`. This belongs in the renderer: the audited formatting consumers are native renderer views, the active locale can be imported from shared code, and main-process or script/MCP data paths must retain their current stable output.

Each formatter reads `getActiveLocale()` on every call. Map exactly `en-XA` to `en`; pass other locale codes such as `pt-BR` through. Wrap each `Intl` formatter constructor in `try/catch` and fall back to locale `en` if a malformed user-pack code is rejected. Cache instances by effective locale plus `JSON.stringify(options)`, so a locale change selects a different cache entry and cannot leave a stale formatter. `en-XA` is a pseudo-language for catalog text; date/number formatting remains valid English output while translated UI text continues to be pseudo-localized.

Byte sizes use 1024-based scaling and `Intl.NumberFormat` `style: "unit"` with `unitDisplay: "short"` for localized unit labels (`byte`, `kilobyte`, `megabyte`, `gigabyte`, `terabyte`). Keep `B` below 1024; show integer values for bytes and kilobytes, and one fractional digit for units above kilobytes using `maximumFractionDigits`, not `toFixed()`. Return the localized zero-byte value for non-finite or non-positive inputs, matching the shared helper's existing zero behavior.

### Verified formatter and call-site inventory

| Source and symbol | What it formats / audience | Decision |
|---|---|---|
| `src/renderer/core/utils/format-bytes.ts:2` `formatBytes` | Shared renderer helper used in pipe progress (`components/pipe-status/PipeStageListView.ts:52-59`, `PagePipeStatusModel.ts:124`), board archive/progress UI (`editors/board-info/BoardInfoEditorView.ts:245,282`), and board search results (`editors/tools-hub/SearchBoardsTab.ts:448`). | Replace helper internals/use with shared localized byte formatter. These are visible UI values. |
| `src/renderer/core/utils/utils.ts:38` `formatDate` | Formats notebook update dates as numeric `YYYY-MM-DD`; its only imports are `editors/notebook/ExpandedNoteView.ts:12` and `NoteItemViewModel.ts:2`, rendered by `NoteItemView.ts:240` and `ExpandedNoteView.ts:135`. Stored note timestamps remain ISO. | Keep the numeric date display unchanged; it is language-neutral and already readable across locales. |
| `src/renderer/editors/mneme-config/mnemeTypes.ts:140` `formatBytes` | Mneme model downloads, model files, roots, and stale-index sizes rendered by `ModelPanel.ts:35,78` and `RootsPanel.ts:150,196,258`. MCP results are parsed as data; this local helper is only called by renderer UI. | Remove duplicate UI formatter; use shared localized byte formatter. Keep filenames and MCP payloads unchanged. |
| `src/renderer/editors/browser/BrowserDownloadsPopup.ts:321` `formatBytes` | Download progress and completed sizes displayed in the downloads popover (`:156-160`). | Remove duplicate UI formatter; use shared localized byte formatter. Keep filename and save path text unchanged. |
| `src/renderer/core/utils/html-resources.ts:134` `formatSize` | Adds a size suffix to generated inline-script/style titles (`:82-83,97-98`) in `extractHtmlResources`, whose returned `ILink[]` is explicitly also available to user scripts (`:8-10,13`). | Keep the existing fixed format. This value is part of a returned data/title contract, not a renderer-only label; do not introduce active-locale output into script results. |
| `src/renderer/components/git-tree/git-date.ts:1-14` `dateText` | Local-time `YYYY-MM-DD HH:mm` shown in the git history date grid (`GitTreeView.ts:117-123`) and commit details (`editors/git-tree/CommitInfoPanel.ts:100`); the source documents this format as a deliberate developer choice (US-618/US-629). | Keep unchanged. It is a language-neutral numeric date and 24-hour time; the grid continues sorting by numeric `authorDate`. |
| `src/renderer/editors/explorer/clipboard-date.ts:14-35` `timeText` / `clipboardTimeLabel` | Explorer clipboard-history badge and tooltip (`ClipboardSecondaryView.ts:300,332`); shows local 24-hour `HH:mm`, “Today at …”, and hand-built `N days ago` / `-Nd`. | Keep `HH:mm`. Localize “Today at {time}” through `t("common.todayAt", { time })`; format older tooltip wording with `Intl.RelativeTimeFormat` (`numeric: "auto"` default for this call); replace the English `d` badge abbreviation with a narrow localized day unit. Keep captured timestamp and clipboard payload unchanged. |
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

Clipboard history's captured time is displayed only in its badge and tooltip; it is not part of the copied clipboard payload. No copied payload, saved content, or filename should pass through a locale formatter. Grid sorting continues to consume the underlying values; in particular, the git date cell's `authorDate` is numeric and its deliberate ISO-style display remains unchanged.

Other `toFixed()` sites found:

| Source | Use | Decision |
|---|---|---|
| `BrowserDownloadsPopup.ts:326`, `mnemeTypes.ts:149`, `format-bytes.ts:12`, `html-resources.ts:136-137` | Byte display helpers, covered above. | Replace only UI helper cases; preserve the script-returned HTML-resource title format. |
| `src/renderer/editors/mneme-root/results-to-markdown.ts:33` | Two-decimal score written into generated Markdown. | Keep fixed; generated document content is data. |
| `src/renderer/editors/storybook/renderGridStory.ts:132` | Developer-only story performance display. | Leave fixed; no user value. |
| `src/renderer/uikit/DataGrid/DataGrid.story.ts:34` | Developer-only story ratio label. | Leave fixed; no user value. |
| `src/renderer/theme/custom-theme.ts:378` | Rounds a contrast ratio in a returned report object. | Keep fixed; this is structured diagnostic data. |
| `src/renderer/theme/color-math.ts:46` | Serializes alpha for color/CSS parsing. | Keep fixed; this is a machine-readable color representation. |

Date construction and `toISOString()` searches also found source serialization, `Date.now()` clock/timing calculations, and IDs/deadlines; those are not display formatters and do not change. In particular, files, logs, grid/sort data, clipboard contents, generated files, script output, MCP results, ai-vision data, and object-model values retain their existing format. A formatted value visible in the native UI may be localized without changing the underlying data contract.

## Implementation Plan

- [x] Add `src/renderer/core/utils/format.ts`, importing `getActiveLocale()` from `src/shared/i18n/active-locale.ts`. On every formatter call, map `en-XA` to `en`, pass through other locale codes, and catch constructor failures to retry with `en`. Cache by `effectiveLocale + JSON.stringify(options)`; read the locale on every call so switching locales cannot reuse a stale formatter.
- [x] Export `formatDate`, `formatDateTime`, `formatTime`, `formatRelativeTime`, `formatNumber`, `formatUnit`, and `formatBytes`. Use `Intl.DateTimeFormat`, `Intl.NumberFormat`, and `Intl.RelativeTimeFormat`. Keep `formatDate` / `formatTime` available for future wording-heavy UI; only board-info's non-neutral timestamp is migrated to `formatDateTime`. `formatRelativeTime` takes a signed amount, an explicit `Intl.RelativeTimeFormatUnit`, and options; default `numeric` to `"auto"` so a one-day offset becomes “yesterday”/“вчора”. `formatUnit(value, unit, unitDisplay)` is a narrow `Intl.NumberFormat` unit-style helper for the clipboard badge.
- [x] Add `todayAt: { message: "Today at {time}" }` to `src/shared/i18n/en/common.ts` and use `t("common.todayAt", { time })` in the clipboard tooltip. Do not defer this word string to a later extraction task.
- [x] Keep `src/renderer/core/utils/utils.ts` `formatDate` and notebook display imports (`src/renderer/editors/notebook/ExpandedNoteView.ts`, `NoteItemViewModel.ts`) unchanged: numeric `YYYY-MM-DD` is deliberate and language-neutral. Keep `NotebookEditor.ts` ISO writes unchanged.
- [x] Replace byte-size display duplicates/usages in `src/renderer/core/utils/format-bytes.ts`, `src/renderer/editors/mneme-config/mnemeTypes.ts`, and `src/renderer/editors/browser/BrowserDownloadsPopup.ts`; keep UI call sites using the single shared `formatBytes` and return localized zero bytes for non-finite/non-positive input.
- [x] Keep `src/renderer/components/git-tree/git-date.ts`, `src/renderer/components/git-tree/GitTreeView.ts`, and `src/renderer/editors/git-tree/CommitInfoPanel.ts` unchanged. Their deliberate numeric `YYYY-MM-DD HH:mm` format is shared across git views and remains stable in every UI locale.
- [x] Update `src/renderer/editors/explorer/clipboard-date.ts`: preserve the badge and tooltip's 24-hour `HH:mm`; use `t("common.todayAt", { time })` for today's tooltip; use `formatRelativeTime(-dayDifference, "day")` for older-item tooltip wording (with `numeric: "auto"` default); build an older badge as `-${formatUnit(dayDifference, "day", "narrow")}` plus the existing 24-hour time. Remove the singular/plural ternary and English `d` abbreviation. Preserve day-boundary calculation and underlying captured timestamp.
- [x] Replace `dropped.toLocaleString()` in `src/renderer/uikit/DataGrid/cell-tooltip.ts` with `formatNumber(dropped)`.
- [x] Replace the board-info UI `status.startedAt.toISOString()` display in `src/renderer/editors/board-info/BoardInfoEditorView.ts` with localized date/time formatting.
- [x] Leave developer-only story files `src/renderer/editors/storybook/renderGridStory.ts` and `src/renderer/uikit/DataGrid/DataGrid.story.ts` unchanged; they provide no user value.
- [x] Keep `src/renderer/core/utils/html-resources.ts:134-138` fixed because it contributes to titles returned from `extractHtmlResources()` to scripts. Keep `src/renderer/editors/log-view/LogEntryWrapper.ts` at `HH:mm:ss.SSS`, `src/renderer/editors/video/AudioControls.ts` at `mm:ss`, `src/renderer/ui/dialogs/TorInfoDialogView.ts` raw location composition, and all ISO serialization/log/MCP/script data unchanged.
- [x] Extend the existing dev-only `globalThis.__persephoneI18nDebug` object in `src/renderer/i18n/startup.ts:111-122` with the seven helpers so live MCP-assisted verification can invoke them without adding a test harness. Keep this hook development-only.

### Before → after examples

```ts
// Before: renderer locale ignored; separators and labels are hardcoded.
return `${unit === 0 ? Math.round(size) : size.toFixed(1)} ${units[unit]}`;

// After: Intl owns the localized number and short SI unit spelling.
return formatBytes(bytes); // English kilobytes render as kB.
```

```ts
// Before: English plural selection is embedded in clipboard UI code.
tooltip: dayDifference === 1 ? "1 day ago" : `${dayDifference} days ago`,

// After: the runtime supplies locale-specific relative-time grammar and auto wording.
tooltip: formatRelativeTime(-dayDifference, "day"), // numeric defaults to "auto"
```

```ts
// Clipboard time stays 24-hour; only surrounding words and the compact day unit localize.
badge = `-${formatUnit(dayDifference, "day", "narrow")} ${time}`;
tooltip = dayDifference === 0 ? t("common.todayAt", { time }) : formatRelativeTime(-dayDifference, "day");
```

## Concerns

- `Intl.RelativeTimeFormat` with `numeric: "auto"` covers clipboard relative wording with locale-specific forms such as “yesterday” / “вчора”; `common.todayAt` supplies the separate translatable “Today at {time}” phrase. The clipboard's numeric 24-hour time remains `HH:mm`.
- `Intl.NumberFormat` owns unit spelling. English kilobytes will change from `KB` to the SI spelling `kB`; accept this visible change. Other locales may vary punctuation, spacing, and abbreviations. Keep 1024 thresholds and integer kilobytes despite the SI unit label; use one fractional digit only for larger units.
- Language-neutral numeric date/time formats stay as-is: notebook `YYYY-MM-DD`, git `YYYY-MM-DD HH:mm`, and clipboard `HH:mm`. `formatDate` and `formatTime` remain exported for future wording-heavy displays; board-info's raw UTC ISO string is the exception migrated to `formatDateTime`.
- Do not localize values simply because their source is shown in a UI. `html-resources.ts` output becomes a title in an `ILink[]` returned to scripts; its size text remains fixed. The same rule applies to generated Markdown, logs, copied values, and all scripting/ai-vision/MCP responses.
- Developer-only story files are explicitly out of scope and need no change.

## Acceptance Criteria

- [ ] The shared helpers use `getActiveLocale()` on every call, map `en-XA` to `en`, retry constructor failures with `en`, and cache by locale/options without reusing a prior locale's formatter.
- [ ] With active locale `de`, `formatNumber(1234.5)` uses German separators; a kilobyte value uses localized `kB` unit formatting and integer precision. Bytes below 1024 use `B`; larger-than-kilobyte units use one fractional digit via `maximumFractionDigits`.
- [ ] With active locale `en`, kilobyte labels use `kB` (not `KB`); this SI spelling change is accepted.
- [ ] A live Ukrainian check through `globalThis.__persephoneI18nDebug` formats `formatRelativeTime(-1, "day")` as “вчора” and `formatRelativeTime(-3, "day")` with the correct plural wording. The clipboard's today phrase comes from `t("common.todayAt", { time })`, while its displayed time remains 24-hour `HH:mm` and its compact day badge uses a narrow localized day unit.
- [ ] The board-info service status uses `formatDateTime`; notebook dates, git dates, and clipboard clock time retain their existing numeric `YYYY-MM-DD`, `YYYY-MM-DD HH:mm`, and `HH:mm` forms.
- [ ] Browser downloads, Mneme panels, board/pipe status, board search, and grid tooltip number displays use the shared formatters where classified as UI above. Developer-only story files remain unchanged.
- [ ] Clipboard relative wording uses `Intl.RelativeTimeFormat`, not a plural catalog message or singular/plural ternary. Media duration remains `mm:ss`; log timestamps remain `HH:mm:ss.SSS`.
- [ ] `html-resources.ts` script-returned title sizes, file and note timestamp storage, log and generated-file formats, clipboard payloads, numeric grid sort data, script API/ai-vision/MCP output, and theme/color serialization remain byte-for-byte or structurally stable.
- [ ] No test or harness is added. Claude verifies live through Persephone MCP by invoking the dev-only formatter hook when available and observing representative rendered values under at least `de`, `uk`, and `en-XA`.

## Files Changed

| File | Planned change |
|---|---|
| `src/renderer/core/utils/format.ts` | Add the shared locale-aware `Intl` formatters. |
| `src/renderer/core/utils/format-bytes.ts` | Delegate/remove the duplicate UI byte formatter. |
| `src/renderer/editors/mneme-config/mnemeTypes.ts` | Remove duplicate UI byte formatter. |
| `src/renderer/editors/browser/BrowserDownloadsPopup.ts` | Remove duplicate byte formatter. |
| `src/renderer/editors/explorer/clipboard-date.ts` | Use localized time and Intl relative time. |
| `src/renderer/uikit/DataGrid/cell-tooltip.ts` | Localize the displayed omitted-character count. |
| `src/renderer/editors/board-info/BoardInfoEditorView.ts` | Localize the visible service start date/time. |
| `src/renderer/i18n/startup.ts` | Expose formatters through the existing development-only i18n debug hook. |
| `src/shared/i18n/en/common.ts` | Add the translatable `common.todayAt` message. |

### Files needing no changes

- `src/renderer/core/utils/utils.ts`, `src/renderer/editors/notebook/ExpandedNoteView.ts`, and `src/renderer/editors/notebook/NoteItemViewModel.ts` — preserve numeric `YYYY-MM-DD`, a language-neutral date format.
- `src/renderer/components/git-tree/git-date.ts`, `src/renderer/components/git-tree/GitTreeView.ts`, and `src/renderer/editors/git-tree/CommitInfoPanel.ts` — preserve the deliberate `YYYY-MM-DD HH:mm` developer format documented for US-618/US-629; it is language-neutral and shared by all git views.
- `src/renderer/editors/storybook/renderGridStory.ts` and `src/renderer/uikit/DataGrid/DataGrid.story.ts` — developer-only stories with no user-facing value.
- `src/renderer/core/utils/html-resources.ts` — `formatSize` remains fixed because it is included in script-returned `ILink` titles.
- `src/renderer/editors/log-view/LogEntryWrapper.ts` — log timestamp display remains fixed `HH:mm:ss.SSS`.
- `src/renderer/editors/video/AudioControls.ts` — media elapsed/duration labels remain locale-neutral `mm:ss`.
- `src/renderer/ui/dialogs/TorInfoDialogView.ts` — provider-supplied location parts remain data values; only surrounding dialog text is localization work.
- `src/renderer/editors/mneme-root/results-to-markdown.ts` — generated Markdown score keeps its fixed two-decimal representation.
- `src/renderer/theme/custom-theme.ts` and `src/renderer/theme/color-math.ts` — structured contrast values and CSS/color serialization remain machine-stable.
- `src/main/board-log.ts`, renderer content/tree providers, `src/renderer/editors/notebook/NotebookEditor.ts`, and `src/renderer/scripting/script-utils.ts` — ISO date serialization remains unchanged.
- `src/renderer/editors/log-view/LogViewEditor.ts`, `src/renderer/scripting/ScriptContext.ts`, and `src/main/mcp/ai-vision/main-script.ts` — numeric timestamps remain unchanged in log, script, and agent data.
- `doc/active-work.md` and `doc/epics/EPIC-124.md` — already link to this task path; no link edits are needed.
