import { TComponentState } from "../../core/state/state";
import { FileDiffEditor, defaultFileDiffEditorState } from "./FileDiffEditor";
import { defineEditorModule } from "../base/editorRegistry";
import { FileDiffEditorView } from "./FileDiffEditorView";

export const fileDiffModule = defineEditorModule(FileDiffEditor, {
    createEditor: () =>
        new FileDiffEditor(new TComponentState({ ...defaultFileDiffEditorState })),
    View: FileDiffEditorView,
});

export { FileDiffEditor, defaultFileDiffEditorState };
export type { FileDiffEditorState, RevSel } from "./FileDiffEditor";

