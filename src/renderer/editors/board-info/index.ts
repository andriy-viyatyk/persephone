import { TComponentState } from "../../core/state/state";
import {
    BoardInfoEditorModel,
    getDefaultBoardInfoEditorState,
} from "./BoardInfoEditorModel";
import { BoardInfoEditorView } from "./BoardInfoEditorView";
import { defineEditorModule } from "../base/editorRegistry";

const createEditor = () => new BoardInfoEditorModel(new TComponentState(getDefaultBoardInfoEditorState()));

export const boardInfoModule = defineEditorModule(BoardInfoEditorModel, {
    createEditor,
    View: BoardInfoEditorView,
    restoreFromDescriptor: async (descriptor) => {
        const editor = createEditor();
        try {
            editor.applyRestoreData(descriptor as unknown as Parameters<typeof editor.applyRestoreData>[0]);
            await editor.restore();
            return editor;
        } catch (error) {
            await editor.dispose();
            throw error;
        }
    },
});

export { BoardInfoEditorModel, getDefaultBoardInfoEditorState } from "./BoardInfoEditorModel";
export type { BoardInfoEditorState } from "./BoardInfoEditorModel";
