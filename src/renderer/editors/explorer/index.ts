import { InternalEditorIds } from "../base/editor-ids";
import { TComponentState } from "../../core/state/state";
import type { EditorRestoreModule } from "../base/editorRegistry";
import type { EditorModelInstance as EditorModel } from "../base/EditorModel";
import type { EditorDescriptor } from "../../../shared/persistence";
import { ExplorerEditor, getDefaultExplorerEditorState } from "./ExplorerEditorModel";

export const explorerRestoreModule: EditorRestoreModule = {
    restoreFromDescriptor: async (descriptor: EditorDescriptor): Promise<EditorModel | null> => {
        if (descriptor.editorId !== InternalEditorIds.explorer) return null;
        const editor = new ExplorerEditor(new TComponentState({
            ...getDefaultExplorerEditorState(),
            ...descriptor.state,
            id: descriptor.id,
        }));
        try {
            editor.applyRestoreData(
                descriptor.state as unknown as Parameters<typeof editor.applyRestoreData>[0],
            );
            await editor.restore();
            return editor;
        } catch (error) {
            await editor.dispose();
            throw error;
        }
    },
};

export { ExplorerEditor, getDefaultExplorerEditorState } from "./ExplorerEditorModel";
export type { ExplorerEditorState } from "./ExplorerEditorModel";
