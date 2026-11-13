import { TComponentState } from "../../core/state/state";
import { MonacoEditor, defaultMonacoEditorState } from "./MonacoEditor";
import { defineEditorModule } from "../base/editorRegistry";
import { MonacoEditorView } from "./MonacoEditorView";

export const monacoModule = defineEditorModule(MonacoEditor, {
    createEditor: () =>
        new MonacoEditor(new TComponentState({ ...defaultMonacoEditorState })),
    View: MonacoEditorView,
});

export { MonacoEditor, defaultMonacoEditorState };
export type {
    MonacoEditorState,
    MonacoQueueEvent,
    MonacoQueueRequest,
} from "./MonacoEditor";
