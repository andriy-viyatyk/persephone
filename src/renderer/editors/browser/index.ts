import { TComponentState } from "../../core/state/state";
import { BrowserEditor } from "./BrowserEditor";
import { getDefaultBrowserPageState } from "./browser-state";
import { BrowserEditorView } from "./BrowserEditorView";
import type { EditorModule } from "../base/editorRegistry";

export const browserModule: EditorModule = {
    createEditor: () =>
        new BrowserEditor(new TComponentState(getDefaultBrowserPageState())),
    View: BrowserEditorView,
};

export { BrowserEditor };
export type { BrowserQueueEvent } from "./BrowserEditor";
export type { BrowserEditorState, BrowserTabData } from "./browser-state";
