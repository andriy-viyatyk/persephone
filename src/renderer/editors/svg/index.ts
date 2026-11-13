import { TComponentState } from "../../core/state/state";
import { SvgEditor, defaultSvgEditorState } from "./SvgEditor";
import { defineEditorModule } from "../base/editorRegistry";
import { SvgEditorView } from "./SvgEditorView";

export const svgModule = defineEditorModule(SvgEditor, {
    createEditor: () => new SvgEditor(new TComponentState({ ...defaultSvgEditorState })),
    View: SvgEditorView,
});

export { SvgEditor, defaultSvgEditorState };
export type { SvgEditorState, SvgQueueEvent } from "./SvgEditor";
