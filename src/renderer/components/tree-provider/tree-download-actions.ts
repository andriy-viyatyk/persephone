import type { ILink, ITreeProvider, ITreeProviderItem } from "../../api/types/io.tree";
import { api } from "../../../ipc/renderer/api";
import { ui } from "../../api/ui";
import { fpBasename } from "../../core/utils/file-path";
import { t } from "../../../shared/i18n/t";
import { errMessage } from "../../../shared/utils";
import { createTreeProvider } from "../../content/tree-providers/tree-provider-factory";
import { treeTransferCapability } from "../../content/tree-providers/tree-provider-capabilities";
import { sameHref } from "./href-utils";
import { pruneProviderItems } from "./plural-actions";
import { transferTreeItemsWithResults, type DropTarget } from "./tree-drop-actions";

function toLink(item: ITreeProviderItem): ILink {
    return {
        title: item.title,
        href: item.href,
        category: item.category,
        tags: [...item.tags],
        isDirectory: item.isDirectory,
        size: item.size,
        mtime: item.mtime,
    };
}

async function refreshSelectedLinks(provider: ITreeProvider, selected: ILink[]): Promise<ILink[]> {
    const parents = [...new Set(selected.map((item) => item.category))];
    const listed = new Map<string, ILink>();
    for (const parent of parents) {
        for (const item of await provider.list(parent)) listed.set(item.href, item);
    }
    return selected.map((item) => {
        const current = listed.get(item.href);
        if (!current || current.title !== item.title || current.category !== item.category
            || current.isDirectory !== item.isDirectory) {
            throw new Error(t("dialogs.treeTransferLiveSourceUnavailable"));
        }
        return current;
    });
}

/** Copy selected board items to a chosen local folder through the shared transfer workflow. */
export async function downloadBoardTreeItems(
    sourceProvider: ITreeProvider,
    selectedItems: ITreeProviderItem[],
): Promise<void> {
    const sourceCapability = treeTransferCapability(sourceProvider);
    if (sourceCapability?.sourceKind !== "board" || !selectedItems.length) return;
    if (selectedItems.some((item) => sameHref(item.href, sourceProvider.rootPath))) return;

    let ownedSource: ITreeProvider | undefined;
    let targetProvider: ITreeProvider | undefined;
    try {
        const pruned = pruneProviderItems(sourceProvider, selectedItems.map(toLink));
        await sourceCapability.assertAvailable();
        ownedSource = sourceCapability.createClipboardSource?.();
        if (!ownedSource) throw new Error(t("dialogs.treeTransferLiveSourceUnavailable"));

        const ownedCapability = treeTransferCapability(ownedSource);
        if (ownedCapability?.sourceKind !== "board") {
            throw new Error(t("dialogs.treeTransferLiveSourceUnavailable"));
        }
        await ownedCapability.assertAvailable();

        const result = await api.showOpenFolderDialog({ title: t("dialogs.treeDownloadPickerTitle") });
        if (!result?.length || !result[0]) return;
        const folder = result[0];

        const currentItems = await refreshSelectedLinks(ownedSource, pruned);
        await ownedCapability.assertAvailable();

        targetProvider = createTreeProvider({ type: "file", rootPath: folder });
        const target: DropTarget = { path: folder, title: fpBasename(folder) || folder };
        await transferTreeItemsWithResults(ownedSource, targetProvider, currentItems, target, "copy");
    } catch (error: unknown) {
        ui.notify(errMessage(error, t("dialogs.treeTransferFailed")), "warning");
    } finally {
        targetProvider?.dispose?.();
        ownedSource?.dispose?.();
    }
}
