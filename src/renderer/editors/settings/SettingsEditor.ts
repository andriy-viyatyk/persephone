import {
    EditorModel,
    type EditorStateBase,
} from "../base/EditorModel";
import { englishMessage } from "../../../shared/i18n/t";
import { SETTINGS_PAGE_ID } from "./settings-page-id";

export { SETTINGS_PAGE_ID } from "./settings-page-id";

export interface SettingsEditorState extends EditorStateBase {
    /** State-type discriminator. */
}

export const getDefaultSettingsEditorState = (): SettingsEditorState => ({
    id: SETTINGS_PAGE_ID,
    // Stored and script-facing title stays English; the tab translates it (ui/tabs/page-title.ts).
    title: englishMessage("settings.pageTitle"),
    modified: false,
    editor: "settings-view",
});

export class SettingsEditor extends EditorModel<SettingsEditorState> {
    /** Editor identity. Matches `EditorDescriptor.editorId`. */
    readonly editorId = "settings-view";

    noLanguage = true;
    skipSave = true;
    showBackgroundOrnament = true;

    /** Preserve the legacy `restore()` title-reset for parity. */
    async restore(): Promise<void> {
        await super.restore();
        this.state.update((s) => { s.title = englishMessage("settings.pageTitle"); });
    }
}
