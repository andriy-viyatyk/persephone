# US-1648: Stable ids for dialog buttons and menu items; split mixed UI/agent text

**Epic:** [EPIC-124 — Localization foundation](../../epics/EPIC-124.md) · **Status:** In Progress

## Goal

Before any UI string is translated, make dialog-button and menu-item identity independent of displayed text while preserving public script and board contracts. Add the English-only message accessor required by D3; do not move, duplicate, or translate settings or board-permission copy in this task.

## Background

There is no renderer-wide localization extraction in this task. EPIC-124 US-1647 has supplied the localization runtime; D3 keeps `$help`, MCP descriptions, script APIs and agent-facing data English. D4 requires identity to move off displayed text first: `IDialogResult.button` remains the English button name/stable id, while the additive `buttonLabel` exposes the displayed string. AI-vision accepts a stable id or the exact displayed label.

`ConfirmationDialog` is implemented by `src/renderer/ui/dialogs/ConfirmationDialog.ts` and `ConfirmationDialogView.ts`. Its props currently contain `buttons?: string[]`; the view renders each string and closes with that same string. `showConfirmationDialog()` returns `Promise<string>`, and `src/renderer/api/ui.ts` exposes it through `app.ui.confirm()` as `string | null`. Other result-bearing dialog paths are `InputDialog` (`InputResult.button`), `TextDialog` (`TextDialogResult.button`), and `CommitDialog` (`CommitResult.button`). The first two are also exposed by the script-facing `app.ui` API. These paths must keep returning their current English button values as ids.

The public Log View script API in `src/renderer/api/types/ui-log.d.ts` defines `IDialogResult.button` and `ui.dialog.confirm/buttons/textInput/checkboxes/radioboxes/select`. Custom `buttons` arrays are supplied by the script. The `!` prefix marks an input-required button and is stripped before display/result today. `pages.logView.push()` exposes the same interactive entries to MCP callers: `src/renderer/api/mcp/ui-push-validation.ts` validates `input.*` entries and `src/renderer/editors/log-view/` renders and resolves them. Explicit caller-provided labels must remain their own ids and displayed labels; only Persephone-provided defaults can later use catalog labels.

`src/renderer/core/events/context-menu.ts` and the public `src/renderer/api/types/events.d.ts` already define optional `MenuItem.id`. The missing link is AI-vision: `src/renderer/scripting/ai-vision/menus/index.ts` currently publishes only labels and `resolveItem()` matches `item.label === label`. `MenuItemInfo` should publish an available id, and resolution should prefer a unique exact id, then accept a unique exact displayed/qualified label. Duplicate matches remain errors. `src/renderer/scripting/ai-vision/attention.ts` generates action examples from the live menu snapshot, so the help can demonstrate ids when present and labels as a compatible fallback.

The board host already has stable action identity for board toolbar controls. `src/renderer/editors/board/BoardToolbarControls.ts` validates board menu-entry ids and emits `ToolbarAction.id`; the bridge carries the action id/value, not the displayed label. The board API does not expose a dialog-result button-label field or a host dialog-button-label protocol. Keep that bridge and the board API backward compatible. `app.ui.confirm()` remains a string-returning API whose string is the English id; object-shaped input/text results gain only an additive `buttonLabel` field.

src/renderer/editors/settings/settings-catalog.ts and src/renderer/editors/board/board-permission-copy.ts remain the single English sources until Phase 2 extracts their UI strings into catalog keys. Do not move or duplicate either source in this task. settingsComments in src/renderer/api/settings.ts is serialized into appSettings.json and stays English documentation.

### Agent-facing text

When Phase 2 extracts UI strings from settings-catalog.ts and board-permission-copy.ts into catalog keys, UI consumers call t(key) and agent-facing consumers call englishMessage(key) with the same key. This keeps one English source while allowing translated UI and English agent output. Add a short comment documenting this rule at scripting/ai-vision/namespaces/settings.ts, scripting/ai-vision/dialogs/trust-board.ts, scripting/api-wrapper/BoardInfoEditorFacade.ts, and the LEGACY_BOARD_AGENT_DEPRECATION_NOTE consumer in api/boards.ts. US-1651 should include this rule in the localization conventions.

### Source-verified button and menu selection inventory

The following renderer comparisons use a dialog response or menu selection as a label. Each must switch to the returned/stored id where it controls behavior. Comparisons against event mouse-button numbers, internal enum values such as `"accept"`, and `undefined` cancellation checks are not display-label identity and are intentionally excluded.

| Source | Compared value(s) | Consumer / action |
|---|---|---|
| `src/renderer/components/tree-provider/tree-drop-actions.ts` | `"Move"`, `"Copy"`, `"Overwrite"` | Move/copy and overwrite confirmations in the tree-drop flows |
| `src/renderer/components/tree-provider/item-crud-actions.ts` | `"Create"`, `"Rename"`, `"Delete"` | File/folder create, rename and delete |
| `src/renderer/components/tree-provider/plural-actions.ts` | `"Delete"` | Confirm deleting multiple tree items |
| `src/renderer/components/tree-provider/os-clipboard.ts` | `"Overwrite"` | Clipboard file overwrite confirmation |
| `src/renderer/editors/text/TextFileActionsModel.ts` | `case "Save"`, `case "Don't Save"` | Unsaved text-file close decision |
| `src/renderer/editors/board/BoardEditorModel.ts` | `"Save"`, `"Don't Save"` | Unsaved board close decision |
| `src/renderer/api/board-install.ts` | `"Delete"` | Delete a downloaded board archive |
| `src/renderer/api/board-updates.ts` | `"Close board & continue"` | Continue a board update after closing the open board |
| `src/renderer/api/site-extension-management.ts` | `"Delete"` | Delete a site extension |
| `src/renderer/editors/git-tree/GitChangesView.ts` | `"Reset"`, `"Commit"`, `"Commit & Push"` | Reset changes; select commit action and optional push |
| `src/renderer/editors/git-tree/GitTreeEditorModel.ts` | `"Create"` | Create branch from an input dialog |
| `src/renderer/editors/text/TextEditorModel.ts` | `"Rename"` | Rename a text file from an input dialog |
| `src/renderer/editors/text/ScriptPanel.ts` | `"Save"` | Save a script after input dialog |
| `src/renderer/editors/mneme-config/MnemeConfigEditorModel.ts` | `"Add"`; `confirmLabel` | Add a Mneme root and compare its destructive confirmation choice |
| `src/renderer/editors/browser/BrowserBookmarksUIModel.ts` | `"Select a file"`, `"Create new file"` | Select the bookmark-file workflow from a confirmation dialog |
| `src/renderer/editors/link-editor/LinkEditor.ts` | `"Import All"` | Confirm importing a folder of links |
| `src/renderer/editors/notebook/NotebookEditor.ts` | `"Delete"`, `"Move"` | Delete a note and move a note between categories |
| `src/renderer/editors/env-vars/EnvVarsEditor.ts` | `"Delete"` | Delete an environment profile or namespace |
| `src/renderer/editors/settings/sections/BrowserProfilesSectionModel.ts` | `"Delete"`, `"Clear"` | Delete a browser profile or clear its profile data |
| `src/renderer/editors/settings/sections/ThemeSection.ts` | `"Delete"` | Delete a custom theme |
| `src/renderer/editors/board-info/BoardInfoEditorModel.ts` | `"Remove"`, `"Delete & continue"` | Remove a board or delete its files and continue |
| `src/renderer/editors/log-view/index.ts` | `"Yes"` | Clear all Log View entries after confirmation |
| `src/renderer/scripting/ai-vision/menus/index.ts` | `item.label === label` | Resolve an AI-vision popup-menu request |
| `src/renderer/scripting/ai-vision/dialogs/commit.ts` | `"Cancel"`, visible action labels | Route a commit-dialog click and map a displayed action back to the submit value |
| `src/renderer/scripting/ai-vision/dialogs/create-board.ts`, `create-board-vars-storage.ts`, `edit-link.ts`, `library-setup.ts`, `open-url.ts`, `password.ts` | `"Cancel"`; `open-url.ts` also `"Open"` | Route adapter button clicks |
| `src/renderer/scripting/ai-vision/dialogs/namespace-collision.ts` | `"Register Anyway"` | Resolve namespace-collision choice |
| `src/renderer/scripting/ai-vision/dialogs/register-toolset.ts` | `"Register toolset"` | Resolve toolset-registration choice |
| `src/renderer/scripting/ai-vision/dialogs/confirmation.ts`, `input.ts`, `text.ts`, `tor-info.ts`, `trust-board.ts` | Adapter button names from live dialog state; trust-board maps visible actions to results | Resolve every registered adapter by stable id or unique displayed label, then act by id |

The `src/renderer/api/types/ui-log.d.ts` examples compare `result.button` with `"OK"`/`"Yes"`, and `src/renderer/api/types/ui.d.ts` documents comparing `app.ui.textDialog()` with `"Execute"`; update these examples to explain that `button` is the English id and `buttonLabel` is presentation text. `CommitDialog` has internal branches on `"Cancel"`, `"Commit"`, and `"Commit & Push"`; retain them as id comparisons while separating the view label from the submitted id.

`showConfirmationDialog()` is called from `src/renderer/api/board-install.ts`, `board-updates.ts`, `site-extension-management.ts`, `src/renderer/editors/git-tree/GitChangesView.ts`, `src/renderer/content/builtin-schemes.ts`, `src/renderer/editors/log-view/index.ts`, `src/renderer/editors/explorer/ClipboardSecondaryView.ts`, `BoardsSecondaryView.ts`, `src/renderer/editors/mneme-config/MnemeConfigEditorModel.ts`, `src/renderer/editors/board-info/BoardInfoEditorModel.ts`, and `src/renderer/editors/text/ScriptPanel.ts`; the public wrapper is `src/renderer/api/ui.ts`. Also migrate the `ui.confirm()` callers in the first four tree-provider files above, `TextFileActionsModel.ts`, `BoardEditorModel.ts`, `LinkEditor.ts`, `NotebookEditor.ts`, `EnvVarsEditor.ts`, and the browser-profile settings model. Preserve each call’s behavior and cancellation path.

## Implementation Plan

1. **Give dialog buttons separate identity and presentation.** In `src/renderer/ui/dialogs/ConfirmationDialog.ts` and `ConfirmationDialogView.ts`, introduce an internal button definition (`id`, `label`) and preserve the old string-button input as a compatibility form that normalizes each string to `{ id: string, label: string }`. Built-in app buttons must be passed as explicit definitions so a later catalog label can differ without changing the id. `ConfirmationDialog` resolves its existing `Promise<string>` with the id; keep `confirmationDialogId`, cancellation (`undefined`), and existing callers compatible. Correct the default title from `"Confirmatioin"` to `"Confirmation"`.

   Before:

   ```ts
   buttons: ["Delete", "Cancel"]
   // click resolves "Delete" and the view also renders "Delete"
   ```

   After:

   ```ts
   // dialog-buttons.ts exports stable ids and dialogButton(id).
   buttons: [dialogButton(DialogButton.delete), dialogButton(DialogButton.cancel)]
   if (choice !== DialogButton.delete) return;
   // dialogButton(id) currently uses the English id as label.
   ```

2. **Centralize built-in button ids.** Add src/renderer/ui/dialogs/dialog-buttons.ts with a small DialogButton constant set for repeated built-in names, including delete, save, dontSave, cancel, overwrite, yes, no, and ok. Values remain the current English result strings. Export dialogButton(id), which builds { id, label: id } for this task; Phase 2 changes only the label expression to t(key). Built-in callers use constants both when defining buttons and comparing results. One-off actions such as Close board & continue, Select a file, Import All, and Register Anyway get local constants used for both definition and comparison. Caller-supplied strings remain id=label. Keep CommitDialog ids Commit / Commit & Push while actionButtonLabel() affects only presentation.
3. **Preserve script-facing API compatibility and report displayed text.** In `src/renderer/api/types/ui-log.d.ts`, document `IDialogResult.button` as the English id and add `buttonLabel: string | undefined`; update every `ui.dialog.*` example and the main `IUiLog` example. In `src/renderer/scripting/api-wrapper/UiFacade.ts` and the dialog implementations under `src/renderer/editors/log-view/`, normalize response buttons as `{ id, label, requiresInput }`. The `button` field in resolved entries and returned `IDialogResult` stays the id; `buttonLabel` is the rendered label. For script-supplied button lists, id and label are the caller’s string and are never catalog-translated. When a list is omitted, use built-in default ids and the current English labels from the shared DialogButton definitions; Phase 2 routes only the label side through `t()` with catalog keys. Preserve `!` as the input-required marker, stripping it from both id and label as it does today while retaining the requirement behavior.

   Apply the same normalization to `pages.logView.push()` question entries. Update `src/renderer/editors/log-view/logTypes.ts`, `LogViewEditor.ts`, `items/ButtonsPanel.ts`, and the confirm/text-input/checkbox/radiobox/select dialog views so resolution and the selected-button indicator compare ids, and the answer text is available separately as `buttonLabel`. Update `src/renderer/api/mcp/ui-push-validation.ts` and its API types only as needed to preserve the existing accepted entry shapes. The MCP-authored strings and explicit `buttons` lists stay caller-owned English; defaults remain app-owned.

4. **Keep `app.ui` object results compatible.** In `src/renderer/api/types/ui.d.ts` and `src/renderer/api/ui.ts`, keep `confirm()` returning its existing string/null (the stable English id), and keep `input()` / `textDialog()` result shapes with `button` unchanged while adding `buttonLabel`. Update `src/renderer/ui/dialogs/InputDialog.ts`, `InputDialogView.ts`, `TextDialog.ts`, and `TextDialogView.ts` to return the selected id and displayed label separately. Existing caller-supplied strings remain id=label; built-in defaults have explicit definitions. `CommitDialog` likewise keeps its `button` result as the English id.

5. **Resolve AI-vision menus and dialogs by id or label.** Include optional id in MenuItemInfo snapshots. Resolve a unique exact id first, then a unique exact displayed/qualified label. If a requested string is one item's id and a different item's displayed label, id wins. Duplicate ids are errors; without an id match, duplicate labels are ambiguous. Keep submenu, disabled, and stale-item checks. Update click signatures, $help, and attention examples to state id precedence and label fallback. Apply the same rule to every dialog adapter: expose id/label separately where needed and perform actions by resolved id. MenuItem.id is already optional in context-menu.ts and api/types/events.d.ts; do not require it. Add menu ids only where current known agent/code actions depend on labels; Phase 2 adds ids as each built-in menu is extracted.
6. **Add the D3 English accessor and document the shared-source rule.** Export englishMessage(key, params?) from src/shared/i18n/t.ts beside t(). It uses the same typed keys/params, placeholder replacement, and plural rendering, but always selects the English catalog and English plural category, ignoring active locale and packs. Do not change or duplicate text in settings-catalog.ts or board-permission-copy.ts. Add short comments at scripting/ai-vision/namespaces/settings.ts, scripting/ai-vision/dialogs/trust-board.ts, scripting/api-wrapper/BoardInfoEditorFacade.ts, and the LEGACY_BOARD_AGENT_DEPRECATION_NOTE consumer in src/renderer/api/boards.ts: after Phase 2 extraction, UI calls t(key) and agent consumers call englishMessage(key) with that same key. Keep current English behavior and leave settingsComments unchanged.
7. **Keep board contracts stable.** Verify the toolbar path in BoardToolbarControls.ts, board-api.d.ts, BoardWebview.ts, and board-bridge-channels.ts: a board receives action id/value, not a host-translated label. Do not bump bridge version or change payloads. Keep app.ui.confirm() and existing script button values as English ids; only add result-label fields to object results.
8. **Complete a source re-scan.** Search `src/renderer` for comparisons of dialog results and menu selections against string literals, including `===`, `!==`, `case`, and label-based lookups. Reconcile any new result with the inventory above. Exclude only comparisons that are demonstrably event fields, enum/state values, or non-UI data rather than a displayed button/menu choice.

## Concerns

- If a custom script supplies the same string twice as a button label, both buttons still have the same id under the compatibility rule; AI-vision label resolution must report ambiguity rather than silently choose one. Stable built-in ids must be unique within a dialog/menu snapshot.
- When a requested value is one button's id and a different button's displayed label, resolve the id. State this precedence in AI-vision $help; fall back to labels only when no id matches.
- A button's displayed label can become language-dependent later, but the id, existing `button` return value, decision logic, and board bridge payload cannot. In particular, avoid deriving an id from `buttonLabel` after normalization.
- Do not localize caller-supplied `ui.dialog.*` or `pages.logView.push()` strings. Translating them would change the script author’s chosen text and could break the expected id=label contract.
- Keep `settingsComments` in `src/renderer/api/settings.ts` English: these strings are explanatory comments written into the user's JSON settings file, not transient interface copy; D3 keeps agent/documentation surfaces English.
- `doc/architecture/ui-element-contract.md` is not in scope: the contract explicitly excludes transient dialogs and popup menus, which agents discover from a fresh snapshot.
- Do not add duplicate settings or board-permission English catalogs or pass-through UI seams; englishMessage() is the agent-facing English accessor after Phase 2 extraction.
- This task adds no tests or harnesses. Acceptance is checked live by Claude through Persephone MCP; no strings are translated or extracted here.

## Acceptance Criteria

- No renderer behavior branch depends on a displayed dialog button label. The source scan finds no remaining button-result/string comparisons; internal comparisons use stable ids.
- `ConfirmationDialog` returns stable ids, renders independent labels, keeps existing `string[]` callers working, uses the corrected `Confirmation` default title, and all existing callers preserve their current cancel/confirm behavior.
- `IDialogResult.button` continues to return the English id in every language; `buttonLabel` carries the displayed label. `app.ui.confirm()` and existing board APIs remain backward compatible.
- Caller-supplied script and MCP button strings remain untranslated, id=label values. Built-in defaults have independent ids and labels. The `!` prefix still requires input and does not appear in the answer id or displayed label.
- AI-vision clicks accept a stable id or exact displayed label. Duplicate/ambiguous labels fail; if one item's id equals another item's label, id wins. Generated $help states this precedence. This task adds no translation and script-supplied labels cannot differ from ids, so Claude verifies identity by source scan and exercises built-in dialogs/menu clicks through MCP by id and currently displayed label; changed-label runtime verification belongs to US-1652/en-XA.
- englishMessage(key, params?) uses the English catalog, English plural rules, and the same placeholder rendering as t(), regardless of active locale/packs. Consumer comments document that Phase 2 UI callers use t(key) and agent callers englishMessage(key) with one shared key. These strings are not moved, duplicated, or translated here.
- Board toolbar ids and action/value messages remain unchanged; the board bridge version and public board API stay compatible.
- Live MCP acceptance covers delete/overwrite/save confirmations, a script ui.dialog.confirm() result with button and buttonLabel, a pages.logView.push() question, and AI-vision dialog/menu clicks using ids and the current displayed labels. Because this task does not translate UI and script-supplied labels are id=label, independence for a changed built-in label is verified by source scan; changed-label runtime verification belongs to US-1652/en-XA.

### Files needing no changes

| File / area | Why |
|---|---|
| `doc/active-work.md`, `doc/epics/EPIC-124.md` | Already link to this task path; explicitly leave both untouched |
| `src/renderer/core/events/context-menu.ts`, `src/renderer/api/types/events.d.ts` | Optional `MenuItem.id` already exists; use it without making it required |
| `src/renderer/editors/board/board-api.d.ts`, `src/renderer/editors/board/BoardWebview.ts`, `src/ipc/board-bridge-channels.ts`, `src/main/board-bridge.ts`, `src/board-shim.ts` | Board toolbar actions already travel by id/value; no displayed-label result contract to change |
| `src/renderer/api/settings.ts` (`settingsComments`) | Comments persisted into `appSettings.json` remain English documentation |
| settings-catalog.ts, SettingsView.ts, board-permission-copy.ts | Keep the existing single English sources unchanged; Phase 2 handles extraction and accessor migration |
| `doc/architecture/ui-element-contract.md` | Transient dialogs and popup menus are expressly out of this shell-selector contract |
| Language packs and English source catalog files under src/shared/i18n/en/ | They remain the source strings; only src/shared/i18n/t.ts changes in this task |
| Test suites and harnesses | Acceptance is live through Persephone MCP; the task explicitly excludes tests/harnesses |

## Files Changed

| File | Planned change |
|---|---|
| src/renderer/ui/dialogs/dialog-buttons.ts | Export stable built-in ids and dialogButton(id) with current English labels |
| `src/renderer/ui/dialogs/ConfirmationDialog.ts` | Add id/label definitions, preserve string compatibility, fix default title |
| `src/renderer/ui/dialogs/ConfirmationDialogView.ts` | Render label and resolve id |
| `src/renderer/ui/dialogs/InputDialog.ts`, `InputDialogView.ts` | Preserve button id; add displayed label to result |
| `src/renderer/ui/dialogs/TextDialog.ts`, `TextDialogView.ts` | Preserve button id; add displayed label to result |
| `src/renderer/ui/dialogs/CommitDialog.ts`, `CommitDialogView.ts` | Keep action ids separate from display labels |
| `src/renderer/api/ui.ts`, `src/renderer/api/types/ui.d.ts` | Preserve string/button contracts and add `buttonLabel` to object results |
| `src/renderer/api/types/ui-log.d.ts` | Document id/label semantics and update examples |
| `src/renderer/components/tree-provider/tree-drop-actions.ts`, `item-crud-actions.ts`, `plural-actions.ts`, `os-clipboard.ts` | Route decision logic by ids |
| `src/renderer/editors/text/TextFileActionsModel.ts`, `TextEditorModel.ts`, `ScriptPanel.ts` | Route save/rename decisions by ids |
| `src/renderer/editors/board/BoardEditorModel.ts` | Route unsaved-board decision by id |
| `src/renderer/api/board-install.ts`, `board-updates.ts`, `site-extension-management.ts` | Route board/site-extension decisions by ids |
| `src/renderer/editors/git-tree/GitChangesView.ts`, `GitTreeEditorModel.ts` | Route reset/commit/branch decisions by ids |
| `src/renderer/editors/mneme-config/MnemeConfigEditorModel.ts` | Route input/confirmation decisions by ids |
| `src/renderer/editors/browser/BrowserBookmarksUIModel.ts` | Route bookmark-file workflow choice by id |
| `src/renderer/editors/link-editor/LinkEditor.ts`, `notebook/NotebookEditor.ts`, `env-vars/EnvVarsEditor.ts` | Route import/delete/move decisions by ids |
| `src/renderer/editors/settings/sections/BrowserProfilesSectionModel.ts`, `ThemeSection.ts` | Route profile/theme decisions by ids |
| `src/renderer/editors/board-info/BoardInfoEditorModel.ts`, `src/renderer/editors/explorer/ClipboardSecondaryView.ts`, `BoardsSecondaryView.ts`, `src/renderer/content/builtin-schemes.ts`, `src/renderer/editors/log-view/index.ts` | Preserve `showConfirmationDialog` caller behavior while using ids |
| `src/renderer/scripting/api-wrapper/UiFacade.ts` | Normalize Log View responses with separate id and label |
| `src/renderer/editors/log-view/logTypes.ts`, `LogViewEditor.ts`, `items/ButtonsPanel.ts`, `items/ConfirmDialogView.ts`, `items/ButtonsDialogView.ts`, `items/TextInputDialogView.ts`, `items/CheckboxesDialogView.ts`, `items/RadioboxesDialogView.ts`, `items/SelectDialogView.ts`, `LogEntryContent.ts` | Keep question response identity on ids and expose displayed answer label |
| `src/renderer/api/mcp/ui-push-validation.ts` | Preserve caller-owned button entries and built-in defaults through normalization |
| `src/renderer/scripting/ai-vision/menus/index.ts`, `attention.ts` | Publish ids; resolve id or exact visible label; update generated guidance |
| `src/renderer/scripting/ai-vision/dialogs/*.ts` | Resolve button id or displayed label with id precedence and route by id |
| src/shared/i18n/t.ts | Export englishMessage(key, params?) using the English catalog and plural rules |
| src/renderer/scripting/ai-vision/namespaces/settings.ts | Add Phase 2 same-key t()/englishMessage() comment |
| src/renderer/scripting/ai-vision/dialogs/trust-board.ts | Add Phase 2 same-key t()/englishMessage() comment |
| src/renderer/scripting/api-wrapper/BoardInfoEditorFacade.ts | Add Phase 2 same-key t()/englishMessage() comment |
| src/renderer/api/boards.ts | Add Phase 2 same-key t()/englishMessage() comment at legacy note consumer |

## Implementation progress

- [x] 1. Separate confirmation button ids from displayed labels and correct the default title.
- [x] 2. Centralize built-in button ids and migrate built-in result comparisons.
- [x] 3. Preserve Log View script/MCP button shapes while exposing `buttonLabel` separately.
- [x] 4. Add `buttonLabel` to `app.ui.input()` and `textDialog()` result objects.
- [x] 5. Resolve AI-vision menu and dialog selections by id first, then by exact label.
- [x] 6. Add `englishMessage()` and document the Phase 2 shared-source rule.
- [x] 7. Verify board toolbar actions still use id/value without changing bridge payloads.
- [x] 8. Re-scan renderer dialog/menu comparisons and reconcile remaining enum/event/state matches.

Typecheck, lint, and production build pass. Live Persephone MCP acceptance remains for the user to verify.

