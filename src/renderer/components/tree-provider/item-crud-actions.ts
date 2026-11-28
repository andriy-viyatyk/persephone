import type { ITreeProvider, ITreeProviderItem } from "../../api/types/io.tree";
import { ui } from "../../api/ui";
import { errMessage } from "../../../shared/utils";
import { pasteTreeClipboardInto, reportTreePasteFailure } from "./tree-paste-actions";
import { DialogButton } from "../../api/dialogs/dialog-buttons";
import { t } from "../../../shared/i18n/t";
import { joinTreeChild } from "./tree-path";
import { treeTransferCapability } from "../../content/tree-providers/tree-provider-capabilities";

export interface ItemCrudContext {
    provider: ITreeProvider;
    /** Converts an item into the path expected by provider.rename/list operations. */
    getItemPath(item: ITreeProviderItem): string;
    refresh(): Promise<void>;
}

/** Paste OS clipboard files into a directory and refresh after a successful operation. */
export async function pasteIntoDir(context: ItemCrudContext, directory: string): Promise<void> {
    try {
        if (await pasteTreeClipboardInto(context.provider, directory)) await context.refresh();
    } catch (error: unknown) {
        reportTreePasteFailure(error);
    }
}

/** A tree with a transfer capability addresses a not-yet-listed child by path (a board tree asks
 *  its service for the href); others resolve it through their own link map. */
async function newChildHref(provider: ITreeProvider, directory: string, name: string): Promise<string> {
    const transfer = treeTransferCapability(provider);
    if (!transfer) return provider.resolveLink(joinTreeChild(directory, name));
    return transfer.resolveContentHref(transfer.joinChild(directory, name));
}

export async function createNewFile(context: ItemCrudContext, directory: string): Promise<void> {
    const { provider } = context;
    if (!provider.writable || !provider.addItem) return;

    const inputResult = await ui.input(t("menus.enterFileName"), {
        title: t("menus.newFile"),
        buttons: [DialogButton.create, DialogButton.cancel],
    });
    if (inputResult?.button !== DialogButton.create || !inputResult.value.trim()) return;

    const name = inputResult.value.trim();
    try {
        const href = await newChildHref(provider, directory, name);
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
    if (!provider.writable || !provider.mkdir) return;

    const inputResult = await ui.input(t("menus.enterFolderName"), {
        title: t("menus.newFolder"),
        buttons: [DialogButton.create, DialogButton.cancel],
    });
    if (inputResult?.button !== DialogButton.create || !inputResult.value.trim()) return;

    const name = inputResult.value.trim();
    const folderPath = joinTreeChild(directory, name);
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
    if (!provider.writable || !provider.rename) return;

    const inputResult = await ui.input(t("menus.enterNewName"), {
        title: item.isDirectory ? t("menus.renameFolder") : t("menus.renameFile"),
        value: item.title,
        buttons: [DialogButton.rename, DialogButton.cancel],
        selectAll: true,
    });
    if (inputResult?.button !== DialogButton.rename || !inputResult.value.trim()) return;

    const name = inputResult.value.trim();
    const category = item.category;
    const newPath = joinTreeChild(category, name);
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
    if (!provider.writable || !provider.deleteItem) return;

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
