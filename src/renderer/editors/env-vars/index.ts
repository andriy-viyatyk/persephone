import { TComponentState } from "../../core/state/state";
import { EnvVarsEditor, defaultEnvVarsEditorState } from "./EnvVarsEditor";
import { defineEditorModule } from "../base/editorRegistry";
import { EnvVarsEditorView } from "./EnvVarsEditorView";

export const envVarsModule = defineEditorModule(EnvVarsEditor, {
    createEditor: () =>
        new EnvVarsEditor(new TComponentState({ ...defaultEnvVarsEditorState })),
    View: EnvVarsEditorView,
});

export { EnvVarsEditor, defaultEnvVarsEditorState };
export type { EnvVarsEditorState } from "./EnvVarsEditor";
