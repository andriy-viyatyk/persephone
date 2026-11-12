import { t } from "../../../shared/i18n/t";
import { ui } from "../../api/ui";
import { DialogButton } from "../../ui/dialogs/dialog-buttons";
import { pages } from "../../api/pages";

import type { TextFileModel } from "./TextFileModel";

export class TextFileActionsModel {
    constructor(private model: TextFileModel) {}

    openSearchInNavPanel = () => {
        const { filePath } = this.model.state.get();
        const page = this.model.page;
        if (!page?.hasSidebar && !filePath) return;

        const navModel = page?.ensureSecondaryViewsModel();
        if (navModel && !navModel.state.get().open) {
            page?.setSecondaryViewsState({ open: true });
        }
    };

    confirmRelease = async (): Promise<boolean> => {
        if (this.model.skipSave) {
            return true;
        }

        const { modified, title, temp } = this.model.state.get();
        if (!modified || temp) {
            return true;
        }

        pages.navigation.showPage(this.model.state.get().id);
        const confirmBt = await ui.confirm(
            t("editors.doYouWantToSaveChanges", { title }),
            { title: t("editors.unsavedChanges"), buttons: [DialogButton.save, DialogButton.dontSave, DialogButton.cancel] },
        );

        switch (confirmBt) {
            case DialogButton.save:
                return await this.model.io.saveFile();
            case DialogButton.dontSave:
                return true;
            default:
                return false;
        }
    };
}
