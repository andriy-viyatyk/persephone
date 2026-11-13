import { TComponentState } from "../../core/state/state";
import { BrowserEditor } from "./BrowserEditor";
import { getDefaultBrowserPageState } from "./browser-state";
import { BrowserEditorView } from "./BrowserEditorView";
import { defineEditorModule } from "../base/editorRegistry";

export const browserModule = defineEditorModule(BrowserEditor, {
    createEditor: () =>
        new BrowserEditor(new TComponentState(getDefaultBrowserPageState())),
    View: BrowserEditorView,
});

export { BrowserEditor };
export type { BrowserQueueEvent } from "./BrowserEditor";
export type { BrowserEditorState, BrowserTabData } from "./browser-state";
