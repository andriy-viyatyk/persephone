import { TComponentState } from "../../core/state/state";
import {
    StorybookEditorModel,
    getDefaultStorybookEditorState,
} from "./StorybookEditorModel";
import { StorybookEditorView } from "./StorybookEditorView";
import { defineEditorModule } from "../base/editorRegistry";

export const storybookModule = defineEditorModule(StorybookEditorModel, {
    createEditor: () =>
        new StorybookEditorModel(new TComponentState(getDefaultStorybookEditorState())),
    View: StorybookEditorView,
});

export {
    StorybookEditorModel,
    getDefaultStorybookEditorState,
    STORYBOOK_PAGE_ID,
} from "./StorybookEditorModel";
export type { StorybookEditorState, PreviewBackground } from "./StorybookEditorModel";
