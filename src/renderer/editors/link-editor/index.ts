import { TComponentState } from "../../core/state/state";
import { defineEditorModule } from "../base/editorRegistry";
import { LinkEditor, defaultLinkEditorState } from "./LinkEditor";
import { LinkEditorView } from "./LinkEditorView";

export const linkModule = defineEditorModule(LinkEditor, {
    createEditor: () =>
        new LinkEditor(new TComponentState({ ...defaultLinkEditorState })),
    View: LinkEditorView,
});

export { LinkEditor, defaultLinkEditorState };
export type { LinkEditorState, LinkQueueEvent, ExpandedPanel } from "./LinkEditor";
