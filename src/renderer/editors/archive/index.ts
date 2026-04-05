import { ArchiveEditorView } from "./ArchiveEditorView";
import type { EditorModule } from "../types";
import type { EditorType, IEditorState } from "../../../shared/types";

const archiveEditorModule: EditorModule = {
    Editor: ArchiveEditorView,
    newEditorModel: async (filePath?: string) => {
        const { ArchiveEditorModel } = await import("./ArchiveEditorModel");
        const model = new ArchiveEditorModel();
        if (filePath) await model.initFromArchive(filePath);
        return model;
    },
    newEmptyEditorModel: async (editorType: EditorType) => {
        if (editorType !== "archiveFile") return null;
        const { ArchiveEditorModel } = await import("./ArchiveEditorModel");
        return new ArchiveEditorModel();
    },
    newEditorModelFromState: async (state: Partial<IEditorState>) => {
        const { ArchiveEditorModel } = await import("./ArchiveEditorModel");
        const model = new ArchiveEditorModel();
        model.applyRestoreData(state as any); // eslint-disable-line @typescript-eslint/no-explicit-any
        return model;
    },
};

export default archiveEditorModule;
