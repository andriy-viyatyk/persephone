import { InternalEditorIds } from "../base/editor-ids";
import { EditorModel, type EditorModelInstance, type EditorStateBase } from "../base/EditorModel";
import { TComponentState } from "../../core/state/state";
import type { IPageHost } from "../../api/pages/IPageHost";
import type { EditorDescriptor } from "../../../shared/persistence";
import type { EditorRestoreModule } from "../base/editorRegistry";
import { untranslated } from "../../../shared/i18n/t";

interface ClipboardPanelEditorState extends EditorStateBase {}

export class ClipboardPanelEditor extends EditorModel<ClipboardPanelEditorState> {
    readonly editorId = InternalEditorIds.clipboard;
    readonly panelOrder = 2;
    readonly sidebarOptional = true;

    constructor(state: TComponentState<ClipboardPanelEditorState>) {
        super(state);
        this.noLanguage = true;
        this.skipSave = true;
    }

    closeClipboard(): void {
        this.secondaryView = undefined;
    }

    beforeNavigateAway(): void {
        // Clipboard stays attached while the page's main editor changes.
    }

    setPage(page: IPageHost | null): void {
        super.setPage(page);
    }

    static create(): ClipboardPanelEditor {
        return new ClipboardPanelEditor(new TComponentState({
            id: crypto.randomUUID(),
            title: untranslated("Clipboard"),
            modified: false,
            secondaryView: ["clipboard"],
        }));
    }
}

export const clipboardRestoreModule: EditorRestoreModule = {
    restoreFromDescriptor: async (descriptor: EditorDescriptor): Promise<EditorModelInstance | null> => {
        if (descriptor.editorId !== InternalEditorIds.clipboard) return null;
        const editor = new ClipboardPanelEditor(new TComponentState({
            ...descriptor.state,
            id: descriptor.id,
            title: untranslated("Clipboard"),
            modified: false,
        } as ClipboardPanelEditorState));
        try {
            editor.applyRestoreData(descriptor.state as Parameters<typeof editor.applyRestoreData>[0]);
            await editor.restore();
            return editor;
        } catch (error) {
            await editor.dispose();
            throw error;
        }
    },
};
