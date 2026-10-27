# US-1730: Multi-select board setting

## Goal

Allow a board manifest to declare a string setting whose choices come from a fixed option list, and edit it from Persephone's Settings page with a checkbox multi-select. Preserve the existing string value contract so board code continues to read and write a comma-separated string through `persephone.settings`.

## Background

- `src/renderer/editors/board/board-manifest.ts` owns manifest setting normalization. `RawBoardSetting` already includes `options` and `format`; current options are normalized only from strings, and `format` is retained as an arbitrary non-empty string. Enum settings require valid string options and a default that matches one option. A string with any other format remains a valid string setting.
- `src/renderer/editors/settings/sections/BoardSettingsSection.ts` selects controls by declaration type and recognized string format. `folderPath` gets a folder picker, `multiline` gets `TextareaView`, and unrecognized string formats (including a future format on an older Persephone build) fall through to `InputView`; they are not rejected or ignored.
- `src/renderer/api/board-settings/types.ts` declares scalar `BoardSettingValue` and `BoardSettingType`; persisted values in `BoardSettingsStore` and the renderer/board settings bridge remain strings for this feature. `setBoardSetting()` validates only the declared scalar type for string settings, so existing hand-entered values can contain tokens absent from a manifest option list.
- UIKit `src/renderer/uikit/MultiSelect/MultiSelectView.ts` and `MultiSelectModel.ts` already provide a read-only closed trigger with `formatSelection`, plus a `MultiListBox` in the popover. `MultiListBoxView.ts` renders checkbox rows using `IListBoxItem.label`; its props support controlled selection and option labels. `formatSelection` can render the selected item values joined with `", "`. No UIKit extension is expected for the requested trigger and rows.
- `src/renderer/uikit/CLAUDE.md` requires controlled values, native `VanillaView` composition, static scoped UIKit CSS for component changes, and `uikitText()` for default component-owned text. This task should reuse the component without changing UIKit internals unless implementation reveals a gap.
- Board setting labels and descriptions are localized through `boardDisplayText()` and keys `manifest.settings.<id>.label` / `.description` in `src/renderer/editors/board/board-display-text.ts`. Option labels have no current metadata localization lookup. Treat each option label as the manifest's display string; Speech to Text language endonyms do not need translation.
- `src/shared/board-bridge-version.ts` currently declares `1.42.0`. An unknown string format by itself falls through to `InputView` on older Persephone builds. However, `getBoardCompatibility()` in `src/shared/version-utils.ts` marks a board whose `minBridgeVersion` exceeds the running bridge as incompatible, and board registration filters it out. Therefore the Speech to Text board requiring the new UI will not load on older builds after it declares `minBridgeVersion: "1.43.0"`; the scalar storage/API contract remains unchanged for compatible builds and for boards that omit the minimum.
- The motivating Speech to Text manifest change is tracked separately in [BT-065: Language multi-select](../../../../persephone-boards/doc/tasks/BT-065-language-multiselect/README.md). It covers the 101 language options and endonym labels generated with `Intl.DisplayNames`.

### Manifest contract

Keep `type: "string"`, `default`, and persisted values as strings. Add `format: "multiselect"` and accept `options` entries as either a string (`value` and visible label are the same) or `{ "value": string, "label"?: string }`. Normalize by trimming values and labels; require a non-empty value, a non-empty label when supplied, and unique values after trimming. Require at least one valid option. An empty default (`""`) is valid and means no choices are selected; only non-empty default tokens must match an option. A malformed option list makes that setting declaration invalid and reports a settings issue, rather than silently changing what the board author declared. `format: "multiselect"` is valid only for `type: "string"`.

When reading a stored string, split on commas and trim tokens. Render known tokens in option order. Preserve non-empty tokens that match no option as additional checked rows, after declared options and in their existing stored order; use the raw token as both value and visible label. This keeps legacy/manual values visible and prevents silently discarding them when a user toggles another choice. Unknown-token rows are synthesized from the current value, so unchecking one removes it from the value and it is not shown again. On any selection change, serialize selected values as declared option values in manifest order followed by still-selected unknown tokens in their prior order, joined with `","` (no spaces). Clearing every checkbox stores `""`. The closed trigger formats the same selected ids with `", "` (for example `app, en`), not labels, so stored/API identity remains legible.

The dropdown includes a built-in search box. `MultiListBoxModel.matches()` filters case-insensitively against each option's `label`, so labels should include their id (for example `uk (Українська)`) to make rows findable by either id or endonym.

## Implementation Plan

1. [x] **Extend declaration normalization.** In `src/renderer/editors/board/board-manifest.ts`, define normalized option typing that can carry `{ value, label? }` while preserving current enum string options. Parse string options as same-value/same-label entries and object options as normalized value/optional label. Validate `multiselect` only on string declarations, enforce the manifest contract above, verify comma-separated defaults against options, and report malformed declarations through the existing `BoardSettingsIssueReporter`. Keep the normalized `BoardSettingDeclaration` shape in `src/renderer/api/board-settings/types.ts` aligned with what the settings UI consumes; do not change `BoardSettingValue` or the saved file shape.

2. [x] **Render the controlled multi-select.** In `src/renderer/editors/settings/sections/BoardSettingsSection.ts`, add a `MultiSelectView<IListBoxItem>` control branch for string `format === "multiselect"`. Parse the current draft into tokens, construct visible items with option labels, synthesize checked rows for unknown stored tokens, use `formatSelection` to join item values with comma-space, and serialize each emitted selection in the defined order before calling the existing `writeValue()`. Treat an empty draft as no selected tokens, and allow clearing every checkbox to write `""`. Keep `applyValue()`, asynchronous reads, external setting subscriptions, and reset behavior synchronized with the new control. Use `MultiSelect` without select-all unless the control's standard behavior or usability review calls for it.

3. [x] **Bump the board bridge.** Change `BOARD_BRIDGE_VERSION` in `src/shared/board-bridge-version.ts` from `1.42.0` to `1.43.0`. A board depending on the multi-select presentation must declare `minBridgeVersion: "1.43.0"`. Without that minimum, an older build displays the unknown format as a text input; with the minimum set, older builds exclude the board as incompatible.

4. [x] **Document board authoring.** Update the “Board settings” section in `assets/guides/agents/boards.md` with the string `multiselect` format, option forms and validation, comma-separated default/storage contract, saved-value order, unknown-token behavior, and the `1.43.0` minimum bridge requirement. Include a manifest example. Explain that the dropdown search filters labels case-insensitively, and advise including each id in its label (for example `uk (Українська)`) so users can search by id or endonym. State that setting label/description keys can be localized in board language packs, while option labels are currently literal manifest strings; endonyms such as language names need no localization.

5. [x] **Check types and architecture docs.** Update `assets/editor-types/` or `src/renderer/editors/board/board-api.d.ts` only if investigation during implementation finds a declaration of the manifest setting format there; current searches show no manifest setting declaration in the board API types. Update the bridge feature history in `doc/architecture/overview.md` to mention `format: "multiselect"` and its minimum version. Keep the scalar `persephone.settings.get()` API type unchanged.

### Before → after

Current declaration and value:

```json
{ "id": "language-hints", "type": "string", "default": "app,en" }
```

Planned declaration shape:

```json
{
  "id": "language-hints",
  "type": "string",
  "format": "multiselect",
  "options": [
    { "value": "app", "label": "app (Persephone UI language)" },
    { "value": "uk", "label": "uk (Українська)" },
    { "value": "en", "label": "en (English)" }
  ],
  "default": "app,en"
}
```

The settings API and stored value remain scalar strings:

```js
const languageHints = await persephone.settings.get("language-hints"); // "app,en"
```

## Concerns / Open Questions

- **Resolved:** the proposed string-plus-format design matches the current persistence and bridge API. The settings bridge validates a string setting by scalar type only; it will not reject retained unknown tokens.
- **Resolved:** older builds do not reject unknown string formats; the settings renderer falls through to `InputView`. But a board declaring `minBridgeVersion: "1.43.0"` is filtered out entirely by compatibility checks on an older bridge, so only boards omitting the minimum get that fallback.
- **Resolved:** UIKit `MultiSelect` meets the requested display and checkbox-row requirements through `formatSelection` and labelled items. No component extension is currently needed.
- **Resolved:** setting names/descriptions can be localized through board language-pack metadata keys. Option labels should remain literal manifest values for this feature; Speech to Text uses endonyms. If a later board needs translated option labels, that requires an explicit metadata-key design.

## Acceptance Criteria

- A valid `type: "string", format: "multiselect"` declaration normalizes options supplied as plain strings or `{ value, label? }` objects; malformed, duplicate, empty, or incompatible declarations report a settings issue and are omitted.
- Persephone Settings shows a closed control whose value is selected ids joined by comma-space, and an open dropdown with every declared option as a checkbox row using its configured label.
- Selecting or clearing choices stores a comma-separated string in declaration option order; clearing every checkbox stores `""`; `persephone.settings.get()` and setting change notifications continue returning a string.
- Empty defaults are valid and mean no selected options. Every non-empty default token must match a declared option.
- Non-empty stored tokens that do not match a current option remain visible as checked rows and survive unrelated selection changes, after known options in prior unknown-token order; unchecking an unknown token removes its row and value.
- The built-in search filters option labels case-insensitively, and authoring guidance asks labels to include the option id so users can search by id or label.
- Existing saved values, defaults, and reset semantics remain compatible. Unknown string formats on older builds render as text inputs when no newer `minBridgeVersion` is declared; boards declaring `1.43.0` are excluded by older bridge compatibility checks.
- `BOARD_BRIDGE_VERSION` is `1.43.0`; the boards guide documents that boards using this UI require `minBridgeVersion: "1.43.0"`. The Speech to Text manifest requirement is tracked in BT-065.
- Board setting labels/descriptions continue using board language packs. Option labels remain literal and can use endonyms.
- `assets/guides/agents/boards.md` documents the declaration, validation, persistence and localization behavior. Typed board API assets are changed only if a manifest declaration is found there.
- No unit tests are added or run for this task document.

## Files Changed Summary

| File | Planned change |
|---|---|
| `src/renderer/editors/board/board-manifest.ts` | Normalize and validate multi-select options and defaults. |
| `src/renderer/api/board-settings/types.ts` | Type normalized labelled options; preserve scalar value typing. |
| `src/renderer/editors/settings/sections/BoardSettingsSection.ts` | Render and synchronize the controlled UIKit MultiSelect. |
| `src/shared/board-bridge-version.ts` | Bump the bridge version to `1.43.0`. |
| `assets/guides/agents/boards.md` | Document the string multi-select manifest contract and version requirement. |
| `src/renderer/editors/board/board-api.d.ts` and `assets/editor-types/` | No change expected; no manifest setting declarations were found in the API types. |
| `doc/architecture/overview.md` | Add the 1.43.0 multi-select setting feature to the board bridge history. |
| `src/shared/version-utils.ts` | No change; existing compatibility checks exclude boards whose declared minimum exceeds the current bridge. |
| `doc/epics/EPIC-134.md` | Link US-1730 in the epic task table. |
| `doc/active-work.md` | Add US-1730 under EPIC-134. |
| `doc/tasks/US-1730-board-multiselect-setting/README.md` | Task plan. |
