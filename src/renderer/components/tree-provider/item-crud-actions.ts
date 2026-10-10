import type { ITreeProvider, ITreeProviderItem } from "../../api/types/io.tree";
import { ui } from "../../api/ui";
import { errMessage } from "../../../shared/utils";
import { pasteOsClipboardInto } from "./os-clipboard";
import { DialogButton } from "../../ui/dialogs/dialog-buttons";
import { t } from "../../../shared/i18n/t";

export interface ItemCrudContext {
    provider: ITreeProvider;
    /** Converts an item into the path expected by provider.rename/list operations. */
    getItemPath(item: ITreeProviderItem): string;
    refresh(): Promise<void>;
}

/** Paste OS clipboard files into a directory and refresh after a successful operation. */
export async function pasteIntoDir(context: ItemCrudContext, directory: string): Promise<void> {
    if (await pasteOsClipboardInto(context.provider, directory)) {
        await context.refresh();
    }
}

export async function createNewFile(context: ItemCrudContext, directory: string): Promise<void> {
    const { provider } = context;
    if (!provider.addItem) return;

    const inputResult = await ui.input(t("menus.enterFileName"), {
        title: t("menus.newFile"),
        buttons: [DialogButton.create, DialogButton.cancel],
    });
    if (inputResult?.button !== DialogButton.create || !inputResult.value.trim()) return;

    const name = inputResult.value.trim();
    const href = provider.resolveLink(directory ? directory + "/" + name : name);
    try {
        await provider.addItem({
            href,
            title: name,
            category: directory,
            tags: [],
            isDirectory: false,
        });
    } catch (error) {
        ui.notify(errMessage(error, t("menus.failedCreateFile")), "warning");
        return;
    }
    await context.refresh();
}

export async function createNewFolder(context: ItemCrudContext, directory: string): Promise<void> {
    const { provider } = context;
    if (!provider.mkdir) return;

    const inputResult = await ui.input(t("menus.enterFolderName"), {
        title: t("menus.newFolder"),
        buttons: [DialogButton.create, DialogButton.cancel],
    });
    if (inputResult?.button !== DialogButton.create || !inputResult.value.trim()) return;

    const name = inputResult.value.trim();
    const folderPath = directory ? directory + "/" + name : name;
    try {
        await provider.mkdir(folderPath);
    } catch (error) {
        ui.notify(errMessage(error, t("menus.failedCreateFolder")), "warning");
        return;
    }
    await context.refresh();
}

export async function renameItem(context: ItemCrudContext, item: ITreeProviderItem): Promise<void> {
    const { provider } = context;
    if (!provider.rename) return;

    const inputResult = await ui.input(t("menus.enterNewName"), {
        title: item.isDirectory ? t("menus.renameFolder") : t("menus.renameFile"),
        value: item.title,
        buttons: [DialogButton.rename, DialogButton.cancel],
        selectAll: true,
    });
    if (inputResult?.button !== DialogButton.rename || !inputResult.value.trim()) return;

    const name = inputResult.value.trim();
    const category = item.category;
    const newPath = category ? category + "/" + name : name;
    try {
        await provider.rename(context.getItemPath(item), newPath);
    } catch (error) {
        ui.notify(errMessage(error, t("menus.failedRename")), "warning");
        return;
    }
    await context.refresh();
}

export async function deleteItemAction(
    context: ItemCrudContext,
    item: ITreeProviderItem,
): Promise<void> {
    const { provider } = context;
    if (!provider.deleteItem) return;

    const button = await ui.confirm(
        t("menus.deleteItemConfirmation", { title: item.title }),
        { title: t("menus.deleteConfirmation"), buttons: [DialogButton.delete, DialogButton.cancel] },
    );
    if (button !== DialogButton.delete) return;

    try {
        await provider.deleteItem(item.href);
    } catch (error) {
        ui.notify(errMessage(error, t("menus.failedToDelete")), "warning");
        return;
    }
    await context.refresh();
}
