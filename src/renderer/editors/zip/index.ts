import { ZipEditorView } from "./ZipEditorView";
import type { EditorModule } from "../types";
import type { EditorType, IEditorState } from "../../../shared/types";

const zipEditorModule: EditorModule = {
    Editor: ZipEditorView,
    newEditorModel: async (filePath?: string) => {
        const { ZipEditorModel } = await import("./ZipEditorModel");
        const model = new ZipEditorModel();
        if (filePath) await model.initFromArchive(filePath);
        return model;
    },
    newEmptyEditorModel: async (editorType: EditorType) => {
        if (editorType !== "zipFile") return null;
        const { ZipEditorModel } = await import("./ZipEditorModel");
        return new ZipEditorModel();
    },
    newEditorModelFromState: async (state: Partial<IEditorState>) => {
        const { ZipEditorModel } = await import("./ZipEditorModel");
        const model = new ZipEditorModel();
        model.applyRestoreData(state as any); // eslint-disable-line @typescript-eslint/no-explicit-any
        return model;
    },
};

export default zipEditorModule;
