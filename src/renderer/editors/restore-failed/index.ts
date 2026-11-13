import { defineEditorModule } from "../base/editorRegistry";
import { RestoreFailedEditor } from "./RestoreFailedEditor";
import { RestoreFailedView } from "./RestoreFailedView";
import { t } from "../../../shared/i18n/t";

export const restoreFailedModule = defineEditorModule(RestoreFailedEditor, {
    createEditor: () => new RestoreFailedEditor(crypto.randomUUID(), t("editors.restoreFailedTitle"), ""),
    View: RestoreFailedView,
    restoreFromDescriptor: async () => null,
});
