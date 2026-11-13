import { TComponentState } from "../../core/state/state";
import { decodePersephoneToolsetLink } from "../../content/persephone-toolset-link";
import {
    ToolsetEditorModel,
    getDefaultToolsetEditorState,
} from "./ToolsetEditorModel";
import { ToolsetEditorView } from "./ToolsetEditorView";
import { defineEditorModule } from "../base/editorRegistry";
import type { EditorModelInstance as EditorModel } from "../base/EditorModel";

export const toolsetModule = defineEditorModule(ToolsetEditorModel, {
    createEditor: () =>
        new ToolsetEditorModel(new TComponentState(getDefaultToolsetEditorState())),
    View: ToolsetEditorView,
    newEditorModel: async (filePath?: string) => {
        const model = new ToolsetEditorModel(new TComponentState(getDefaultToolsetEditorState()));
        if (filePath) {
            // A toolset is opened by its own root path (persephone-toolset:// link).
            const link = decodePersephoneToolsetLink(filePath);
            if (link) model.initFromToolsetRoot(link.toolsetRoot);
        }
        return model as unknown as EditorModel;
    },
});

export { ToolsetEditorModel, getDefaultToolsetEditorState } from "./ToolsetEditorModel";
export type { ToolsetEditorState } from "./ToolsetEditorModel";
