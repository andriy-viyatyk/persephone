import { TComponentState } from "../../core/state/state";
import { AboutEditor, getDefaultAboutEditorState } from "./AboutEditor";
import { AboutEditorView } from "./AboutView";
import { defineEditorModule } from "../base/editorRegistry";

export const aboutModule = defineEditorModule(AboutEditor, {
    createEditor: () =>
        new AboutEditor(new TComponentState(getDefaultAboutEditorState())),
    View: AboutEditorView,
});

export { AboutEditor, getDefaultAboutEditorState, ABOUT_PAGE_ID } from "./AboutEditor";
export type { AboutEditorState } from "./AboutEditor";
