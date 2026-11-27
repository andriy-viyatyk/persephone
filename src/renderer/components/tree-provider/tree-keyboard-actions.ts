import type { ITreeProvider, ITreeProviderItem } from "../../api/types/io.tree";
import { isLocalFileProvider, treeTransferCapability } from "../../content/tree-providers/tree-provider-capabilities";
import { ProviderItemController } from "./provider-item-controller";
import { resolveDropTarget } from "./tree-drop-actions";
import { sameHref } from "./href-utils";

export function handleTreeClipboardKeyDown(
    event: KeyboardEvent,
    provider: ITreeProvider,
    selected: ITreeProviderItem[],
    primary: ITreeProviderItem | undefined,
    copyItems: (items: ITreeProviderItem[], cut: boolean) => Promise<void>,
    paste: (directory: string) => Promise<void>,
): boolean {
    if (ProviderItemController.isEditableTarget(event)
        || !event.ctrlKey || event.altKey || event.shiftKey) return false;
    const key = event.key.toLowerCase();
    if (key !== "c" && key !== "x" && key !== "v") return false;
    const capability = treeTransferCapability(provider);
    if (!isLocalFileProvider(provider) && capability?.sourceKind !== "board") return false;
    const consume = () => {
        event.preventDefault();
        event.stopPropagation();
        return true;
    };

    if (key === "v") {
        if (!isLocalFileProvider(provider) && (!provider.writable || !capability)) return false;
        void paste(primary ? resolveDropTarget(provider, primary).path : provider.rootPath);
        return consume();
    }
    if (!selected.length) return false;
    const hasRoot = selected.some((item) => sameHref(item.href, provider.rootPath));
    if (hasRoot && key === "c" && capability?.sourceKind === "board") return false;
    if (hasRoot && key === "x") return false;
    if (key === "x" && !isLocalFileProvider(provider)
        && (!provider.writable || !provider.deleteItem)) return false;
    void copyItems(selected, key === "x");
    return consume();
}

