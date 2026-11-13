import { TComponentState } from "../../core/state/state";
import { MarkdownEditor, defaultMarkdownEditorState } from "./MarkdownEditor";
import { defineEditorModule } from "../base/editorRegistry";
import { MarkdownEditorView } from "./MarkdownEditorView";

export const markdownModule = defineEditorModule(MarkdownEditor, {
    createEditor: () =>
        new MarkdownEditor(new TComponentState({ ...defaultMarkdownEditorState })),
    View: MarkdownEditorView,
});

export { MarkdownEditor, defaultMarkdownEditorState };
export type { MarkdownEditorState, MarkdownQueueEvent } from "./MarkdownEditor";
