import type { ITreeProvider, ITreeProviderItem } from "../../api/types/io.tree";
import { app } from "../../api/app";
import { ContextMenuEvent } from "../../api/events/events";
import { api } from "../../../ipc/renderer/api";
import { isLocalFileProvider } from "../../content/tree-providers/tree-provider-capabilities";
import type { MenuItem } from "../../uikit/Menu";
import { copyPathsToOsClipboard } from "./os-clipboard";
import {
    createNewFile,
    createNewFolder,
    deleteItemAction,
    pasteIntoDir,
    renameItem,
    type ItemCrudContext,
} from "./item-crud-actions";
import {
    getBackgroundMenuItems,
    getFileMenuItems,
    getFolderMenuItems,
    type ItemMenuActions,
} from "./item-menus";
import { hrefKey, sameHref } from "./href-utils";
import { buildMultiItemMenuItems, deleteItemsBatch, pruneNestedItems } from "./plural-actions";

export interface ProviderItemControllerOptions {
    provider(): ITreeProvider;
    getItemPath(item: ITreeProviderItem): string;
    refresh(): Promise<void>;
    getSelectedItems(): ITreeProviderItem[];
    isMultiSelect(): boolean;
    setOutsideRightClickSelection(item: ITreeProviderItem): void;
    clearSelection(): void;
    resolvePasteTarget(item?: ITreeProviderItem): string;
    resolveFileDirectory(item: ITreeProviderItem): string;
    resolveFolderDirectory(item: ITreeProviderItem): string;
    isRoot(item: ITreeProviderItem): boolean;
    onOpenFolder?(item: ITreeProviderItem): void;
    onContextMenu?(
        event: ContextMenuEvent<ITreeProviderItem>,
        selection: ITreeProviderItem[],
    ): void;
    canStartOsDrag(item: ITreeProviderItem): boolean;
    excludeRootFromDrag: boolean;
}

/** Composes provider-item actions while leaving selection and targeting policy to each host. */
export class ProviderItemController {
    constructor(private readonly options: ProviderItemControllerOptions) {}

    static isEditableTarget(event: KeyboardEvent): boolean {
        const target = event.target as HTMLElement | null;
        return !!target && (
            target.tagName === "INPUT"
            || target.tagName === "TEXTAREA"
            || target.isContentEditable
        );
    }

    private get crudContext(): ItemCrudContext {
        return {
            provider: this.options.provider(),
            getItemPath: this.options.getItemPath,
            refresh: this.options.refresh,
        };
    }

    private readonly menuActions: ItemMenuActions = {
        createFile: (directory) => { void createNewFile(this.crudContext, directory); },
        createFolder: (directory) => { void createNewFolder(this.crudContext, directory); },
        paste: (directory) => { void this.paste(directory); },
        rename: (item) => { void this.renameItem(item); },
        deleteItem: (item) => { void this.deleteItem(item); },
    };

    paste = (directory = this.options.resolvePasteTarget()): Promise<void> =>
        pasteIntoDir(this.crudContext, directory);

    renameItem = (item: ITreeProviderItem): Promise<void> =>
        renameItem(this.crudContext, item);

    deleteItem = (item: ITreeProviderItem): Promise<void> =>
        deleteItemAction(this.crudContext, item);

    deleteItems = async (items: ITreeProviderItem[]): Promise<void> => {
        const outcome = await deleteItemsBatch(
            this.options.provider(),
            items,
            this.deleteItem,
        );
        if (outcome !== "batch") return;
        this.options.clearSelection();
        await this.options.refresh();
    };

    copyItemsToClipboard = async (items: ITreeProviderItem[], cut: boolean): Promise<void> => {
        if (!isLocalFileProvider(this.options.provider())) return;
        const targets = pruneNestedItems(items);
        await copyPathsToOsClipboard(targets.map((item) => item.href), cut);
    };

    onItemContextMenu = (item: ITreeProviderItem, event: MouseEvent): void => {
        this.options.setOutsideRightClickSelection(item);
        const contextEvent = ContextMenuEvent.fromNativeEvent(
            event,
            "tree-provider-item",
        ) as ContextMenuEvent<ITreeProviderItem>;
        contextEvent.target = item;

        const multi = this.multiTargets(item);
        contextEvent.items.push(...(multi
            ? this.multiMenuItems(multi)
            : item.isDirectory
                ? getFolderMenuItems({
                    provider: this.options.provider(),
                    item,
                    directory: this.options.resolveFolderDirectory(item),
                    isRoot: this.options.isRoot(item),
                    onOpen: this.options.onOpenFolder ? () => this.options.onOpenFolder?.(item) : undefined,
                    actions: this.menuActions,
                })
                : getFileMenuItems(
                    this.options.provider(),
                    item,
                    this.menuActions,
                    this.options.resolveFileDirectory(item),
                )));

        event.contextMenuPromise = (async () => {
            const result = await app.events.linkContextMenu.sendAsync(contextEvent);
            this.options.onContextMenu?.(contextEvent, multi ?? [item]);
            return result;
        })();
    };

    onBackgroundContextMenu = (event: MouseEvent): void => {
        if (event.contextMenuEvent?.target) return;
        const items = getBackgroundMenuItems(
            this.options.provider(),
            this.options.resolvePasteTarget(),
            this.menuActions,
        );
        if (!items.length) return;
        const contextEvent = ContextMenuEvent.fromNativeEvent(event, "tree-provider-background");
        contextEvent.items.push(...items);
    };

    dragItemsFor = (item: ITreeProviderItem): ITreeProviderItem[] => {
        const selected = this.options.getSelectedItems();
        const isSelected = selected.some((selectedItem) => hrefKey(selectedItem.href) === hrefKey(item.href));
        const items = this.options.isMultiSelect() && selected.length > 1 && isSelected
            ? selected
            : [item];
        const targets = pruneNestedItems(items);
        return this.options.excludeRootFromDrag
            ? targets.filter((target) => !sameHref(target.href, this.options.provider().rootPath))
            : targets;
    };

    handleOsDragStart = (item: ITreeProviderItem, event: DragEvent): boolean => {
        const provider = this.options.provider();
        if (!isLocalFileProvider(provider) || !this.options.canStartOsDrag(item)) return false;
        const paths = this.dragItemsFor(item).map((target) => target.href);
        if (!paths.length) return false;
        event.preventDefault();
        void api.startOsFileDrag(paths);
        return true;
    };

    private multiTargets(item: ITreeProviderItem): ITreeProviderItem[] | null {
        if (!this.options.isMultiSelect()) return null;
        const selected = this.options.getSelectedItems();
        if (selected.length < 2) return null;
        if (!selected.some((selectedItem) => hrefKey(selectedItem.href) === hrefKey(item.href))) return null;
        const targets = pruneNestedItems(selected);
        return targets.length > 1 ? targets : null;
    }

    private multiMenuItems(items: ITreeProviderItem[]): MenuItem[] {
        return buildMultiItemMenuItems(
            this.options.provider(),
            items,
            () => this.deleteItems(items),
        );
    }
}
