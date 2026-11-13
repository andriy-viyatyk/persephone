import { TComponentState } from "../../core/state/state";
import { MermaidEditor, defaultMermaidEditorState } from "./MermaidEditor";
import { defineEditorModule } from "../base/editorRegistry";
import { MermaidEditorView } from "./MermaidEditorView";

export const mermaidModule = defineEditorModule(MermaidEditor, {
    createEditor: () => new MermaidEditor(new TComponentState({ ...defaultMermaidEditorState })),
    View: MermaidEditorView,
});

export { MermaidEditor, defaultMermaidEditorState };
export type { MermaidEditorState, MermaidQueueEvent } from "./MermaidEditor";
