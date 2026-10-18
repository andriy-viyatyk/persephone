# US-1710: Multi-line board settings

Epic: [EPIC-131: Agent sessions in boards](../../epics/EPIC-131.md), Phase 0, P0-D.

## Goal

Allow a board manifest to declare a string setting with "format": "multiline", and render that setting with UIKit TextareaView in the board's Settings page. Persist the value on blur, matching the existing Textarea settings pattern and avoiding a disk write per keystroke.

## Background

### Verified existing behavior

- src/renderer/editors/settings/sections/BoardSettingsSection.ts handles type === "string" && format === "folderPath" with LibraryPathSectionView; all remaining non-boolean/non-enum declarations instantiate InputView. inputProps() calls writeValue() from InputView.onChange for string values, so the current one-line string input persists every change. The row already owns its label, optional manifest description, and localized Reset action.
- src/renderer/editors/settings/sections/FileSearchSection.ts imports TextareaView, its props type, and Textarea.css. It holds an editable draft, updates that draft in onChange, and saves in onBlur; it configures maxHeight: 200 and size: "sm". This is the existing model to follow for multi-line editing, without its singleLine: true option.
- src/renderer/uikit/Textarea/TextareaView.ts provides value, onChange, onBlur, and controlled update(); regular input emits onChange, and blur is forwarded from its native contenteditable root. It is a contenteditable="plaintext-only" textbox and uses innerText normalization. No max-length prop is defined. The view imports no CSS itself; FileSearchSection.ts explicitly imports Textarea.css, so the board section must do likewise.
- BoardSettingDeclaration.format in src/renderer/api/board-settings/types.ts is string. normalizeBoardSettingDeclaration() in src/renderer/editors/board/board-manifest.ts trims and preserves any non-empty string format without validating supported values. Unknown formats are therefore tolerated and, in the current Settings UI, fall back to InputView. Preserve this compatibility: recognize only multiline as a new UI case and do not reject unknown format strings.
- src/renderer/api/board-settings/board-settings-bridge.ts validates setting values by scalar type only (string, finite number, or boolean); it does not enforce string length. BoardSettingsStore.ts parses, serializes, and writes scalar values in board-settings.json without a string-length cap. The Settings request is handled by BoardWebview.resolveSettings() and returns scalar values; the settings request/result declarations in src/ipc/board-bridge-channels.ts have no string-length cap. No store, bridge, or IPC length limit was found.
- Board settings are host-renderer-owned and persisted to %APPDATA%\persephone\data\board-settings.json by BoardSettingsStore; persephone.settings.get() is a read-only settings bridge and is separate from the native Settings page editor.
- Board-facing string labels and descriptions are supplied by the board manifest / board language pack. The new control needs no new generic UI label; its existing manifest label/description and localized settings.reset remain in use. No localization catalog change is currently indicated.
- src/shared/board-bridge-version.ts defines BOARD_BRIDGE_VERSION as 1.41.0. Because an older host displays multiline through its existing one-line fallback, the board-facing compatibility contract must advance and boards relying on this setting must declare the new minimum bridge version.
- src/shared/board-manifest-utils.ts does not normalize settings declarations; it owns shared manifest helpers for permissions, paths, lists, and browser URL masks. Settings normalization lives in src/renderer/editors/board/board-manifest.ts.
- The checked-in current-version references to update are the constant, src/renderer/editors/board/board-api.d.ts, doc/architecture/overview.md, doc/architecture/key-files.md, assets/guides/boards.md, assets/guides/agents/boards.md, and assets/board-template/CLAUDE.md. The board template documents the current bridge version and stable settings identity, but not the settings declaration syntax. The 1.41.0 mentions on trashFile() describe when that historical API was introduced and remain accurate. The board version constant has no matching unit test or version table elsewhere in source; its consumers import the shared constant.

## Implementation Plan

### Progress

- [x] Add the multiline Textarea control with local draft and blur persistence.
- [x] Preserve focused drafts across external updates and commit dirty drafts on disposal.
- [x] Bump the shared board bridge to 1.42.0 and update its source history.
- [x] Update board-author, user-facing, template, and developer documentation.
- [x] Run `npm run typecheck`, `npm run lint`, and `npm run build-prod`.

1. **Add the multiline control in src/renderer/editors/settings/sections/BoardSettingsSection.ts.** Import TextareaView, TextareaProps, and ../../../uikit/Textarea/Textarea.css (the same three-level UIKit import depth as the existing InputView import); extend BoardSettingControl with textarea?: TextareaView and persistedValue?: string; add the type === "string" && format === "multiline" branch after the folderPath branch and before the general input branch. Reuse the row's existing label, optional description, reset button, stable name board-setting-ID, and current draft. Configure an unconstrained multi-line TextareaView at size "sm" (no singleLine: true).

   Before:
   ~~~ts
   } else {
       const input = this.child(new InputView(this.inputProps(control)));
       control.input = input;
       row.append(input.root);
       input.mount();
   }
   ~~~

   After (shape):
   ~~~ts
   } else if (declaration.type === "string" && declaration.format === "multiline") {
       const textarea = this.child(new TextareaView(this.textareaProps(control)));
       control.textarea = textarea;
       row.append(textarea.root);
       textarea.mount();
   } else {
       // Existing InputView fallback, including unknown formats.
   }
   ~~~

2. **Keep draft editing local and persist on blur in BoardSettingsSection.ts.** Add a textareaProps(control) builder that passes control.draft as value, stores changes to control.draft in onChange, and calls writeValue(control, control.draft ?? "") in onBlur. Do not call setBoardSetting() from the textarea's per-keystroke handler. Track the last effective/persisted string in control.persistedValue: initialize it from the declaration default, set it from successful reads and writes, and update it when an external store value arrives. Keep the existing InputView immediate-save behavior unchanged for ordinary strings. Follow FileSearchSection.ts for the draft/onBlur pattern; the multi-line textarea must not set singleLine: true.

3. **Protect an active draft from external value pushes in applyValue().** When control.textarea exists and document.activeElement === control.textarea.root, if control.draft differs from the incoming value, update control.persistedValue but skip changing control.draft and skip textarea.update(). TextareaView exposes its editable root directly, so document.activeElement === textarea.root is the focus check. Preserve the in-progress draft; its blur commit wins over the external value. When the textarea is not focused, applyValue() updates the draft, persistedValue, and textarea props as usual.

4. **Commit a dirty multiline draft when the section is disposed.** BoardSettingsSectionView already has an onDispose() lifecycle hook. Before clearing controls there, iterate multiline string controls and compare draft with persistedValue; if they differ, call void this.writeValue(control, draft) so the store write continues after the view is disposed. writeValue() already checks this.isDisposed before calling applyValue() on success and returns without UI notifications on a disposed view after failure, so this disposal path must not call applyValue() itself. This covers tab/window closure and section rebuild while the textarea is still focused, when blur may never fire.

5. **Retain manifest normalization behavior.** normalizeBoardSettingDeclaration() already preserves format: "multiline" and tolerates unknown nonempty format strings, and BoardSettingDeclaration.format already accepts strings. No format validator or settings schema change is needed; the renderer alone opts into Textarea for the exact "multiline" value. Unknown values continue to render as ordinary inputs.

6. **Make the single Phase 0 bridge bump.** US-1710 is implemented first and performs the one Phase 0 bump of BOARD_BRIDGE_VERSION in src/shared/board-bridge-version.ts from 1.41.0 to 1.42.0 for US-1703, US-1704, US-1709, and US-1710 shipping together in release 5.0.13. Add the 1.42.0 history/guide entry now; later Phase 0 tasks append their features to the same 1.42.0 entry and upcoming release notes and must not bump the version again. Update current-version references and feature history in src/renderer/editors/board/board-api.d.ts, doc/architecture/overview.md, and doc/architecture/key-files.md, plus the current-version sentences in the board guides and template listed below. Preserve historical 1.41.0 references that say trashFile() was introduced then. Confirm the existing source of truth is consumed by src/board-shim.ts, src/main/board-trust-service.ts, src/renderer/editors/board-info/BoardInfoEditorModel.ts, and src/renderer/editors/board/custom-editor-registry.ts; do not duplicate the constant in those consumers. Repository search found no bridge-version unit tests or separate version table to update.

7. **Update board-author documentation and release notes.** In assets/guides/boards.md, document format: "multiline", its Textarea Settings behavior, and minBridgeVersion: "1.42.0" for boards that rely on it; update the current bridge sentence/history from 1.41.0 to 1.42.0. Update the settings declaration and current-version information in assets/guides/agents/boards.md; update the current bridge version information in assets/board-template/CLAUDE.md (it does not document settings declaration syntax). Add a user-facing entry under the existing Version 5.0.13 (Upcoming) section in assets/guides/whats-new.md, grouped with the Phase 0 additions at 1.42.0 for later tasks to extend.

8. **Update developer documentation.** Update the board settings and bridge-version description in doc/architecture/overview.md, and update the BOARD_BRIDGE_VERSION source-of-truth row in doc/architecture/key-files.md to describe the shared 1.42.0 Phase 0 release and multiline board settings; later Phase 0 tasks append to this history without another bump.

9. **Localization and test policy.** Reuse the existing translated Reset label and manifest-supplied labels/descriptions; add no new application localization keys unless implementation introduces new user-facing copy. Do not add unit tests or test harnesses; this project does not use them, per task scope.

## Concerns

- **Save timing:** Existing plain string settings save on each InputView.onChange, but that would serialize and write board-settings.json on every keystroke. Use a textarea draft and commit on blur, following FileSearchSection.ts. Reset remains immediate through the existing unsetBoardSetting() path.
- **Concurrent updates:** applyValue() is also invoked for store subscriptions. Implementation should update the textarea after a successful external/store value change without saving from onChange; the local onChange callback must only update the draft.
- **Focused edit conflicts:** If document.activeElement is the TextareaView root and the draft differs from an incoming store value, applyValue() updates persistedValue but preserves the focused draft and does not call textarea.update(). The blur handler then writes the draft, so the user's current edit wins; unfocused controls accept external values.
- **Section disposal:** A focused contenteditable may not emit blur when its Settings section is torn down. BoardSettingsSectionView.onDispose() must enqueue dirty multiline values through writeValue() before clearing controls; writeValue() must keep its existing isDisposed guard so a completed write never updates the disposed view.
- **Backward compatibility:** Old Persephone versions ignore the new format and show a one-line input. Set minBridgeVersion: "1.42.0" in boards that require multiline behavior; the platform should continue tolerating unknown format strings for forward compatibility.
- **String size:** No explicit length cap exists in the settings store, settings bridge, or settings IPC path. Do not add an arbitrary cap for this task.
- **Localization:** No new localized copy is required if only the existing label, description, and Reset action are used.

## Acceptance Criteria

- A declaration with "type": "string", "format": "multiline" renders as a multi-line UIKit TextareaView in Settings → Editors → the board node, with its manifest label/description, draft value, and Reset action.
- Typing does not call the persistence path per keystroke; the final value is saved when the textarea blurs and is reflected after reload / reset / external setting updates.
- If the section is disposed while the multiline textarea has a dirty draft and blur has not fired, disposal commits that draft to the settings store without attempting to update the disposed view.
- If an external setting update arrives while the multiline textarea is focused and its draft differs, the textarea keeps its draft; blur commits that draft over the external value. An unfocused textarea accepts the external value.
- A multiline setting's value is preserved as a string without a newly introduced length limit.
- folderPath retains its existing folder-picker behavior; other and unknown formats retain the existing one-line input fallback.
- BOARD_BRIDGE_VERSION and all documented bridge-current references are advanced to 1.42.0, and board-author docs state that boards relying on multiline settings require minBridgeVersion: "1.42.0".
- US-1710 performs the sole Phase 0 bridge bump to 1.42.0; subsequent Phase 0 tasks append their feature notes to the same 1.42.0 documentation and 5.0.13 upcoming notes without bumping again.
- The boards guide, upcoming What's New section, and developer documentation describe the change.
- No tests or harnesses, commit, active-work dashboard edit, or epic edit is part of this implementation task.

## Files Changed Summary

| File | Planned change |
|---|---|
| src/renderer/editors/settings/sections/BoardSettingsSection.ts | Add Textarea control, persisted-value tracking, blur and disposal commits, and focused-draft protection for format: "multiline". |
| src/shared/board-bridge-version.ts | Bump BOARD_BRIDGE_VERSION to 1.42.0. |
| src/renderer/editors/board/board-api.d.ts | Update current-version comments / feature history. |
| assets/guides/boards.md | Document multiline settings, minimum bridge version, and current bridge version. |
| assets/guides/agents/boards.md | Update the settings declaration and bridge version reference. |
| assets/board-template/CLAUDE.md | Update the current bridge version reference in the board-author template. |
| assets/guides/whats-new.md | Add upcoming release note. |
| doc/architecture/overview.md | Document multiline board settings and bridge version. |
| doc/architecture/key-files.md | Update shared bridge source-of-truth history. |
| src/renderer/editors/board/board-manifest.ts | **No change:** normalization already preserves string formats without rejecting unknown formats. |
| src/renderer/api/board-settings/types.ts | **No change:** format?: string already represents the normalized declaration. |
| src/renderer/api/board-settings/board-settings-bridge.ts | **No change:** string type validation is sufficient; no format validation or length cap is needed. |
| src/renderer/api/board-settings/BoardSettingsStore.ts | **No change:** scalar strings persist without a length cap. |
| src/shared/board-manifest-utils.ts | **No change:** it does not own settings declaration normalization. |
| src/renderer/editors/settings/sections/FileSearchSection.ts | **No change:** reference pattern only (Textarea draft saved on blur). |
| src/renderer/uikit/Textarea/TextareaView.ts | **No change:** existing component supports multi-line editing and blur. |
| src/ipc/board-bridge-channels.ts | **No change:** settings result is scalar and has no length cap. |
| src/renderer/editors/board/BoardWebview.ts | **No change:** existing Settings bridge remains read-only and scalar. |
| src/main/board-trust-service.ts | **No change:** compatibility validation already consumes the shared version constant. |
| src/renderer/editors/board-info/BoardInfoEditorModel.ts | **No change:** compatibility validation already consumes the shared version constant. |
| src/renderer/editors/board/custom-editor-registry.ts | **No change:** compatibility validation already consumes the shared version constant. |
| src/board-shim.ts | **No change:** it consumes the shared bridge version constant; its trashFile() comment remains a correct historical 1.41.0 introduction. |
| Bridge-version tests / separate version tables | **No change:** repository search found no source tests or separate table keyed to BOARD_BRIDGE_VERSION. |
| Localization catalogs under assets/guides / src | **No change planned:** no new generic UI string is needed. |
| Tests / test harnesses | **No change:** explicitly excluded by task scope. |
