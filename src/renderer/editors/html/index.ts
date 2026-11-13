import { TComponentState } from "../../core/state/state";
import { HtmlEditor, defaultHtmlEditorState } from "./HtmlEditor";
import { defineEditorModule } from "../base/editorRegistry";
import { HtmlEditorView } from "./HtmlEditorView";

export const htmlModule = defineEditorModule(HtmlEditor, {
    createEditor: () => new HtmlEditor(new TComponentState({ ...defaultHtmlEditorState })),
    View: HtmlEditorView,
});

export { HtmlEditor, defaultHtmlEditorState };
export type { HtmlEditorState, HtmlQueueEvent } from "./HtmlEditor";
