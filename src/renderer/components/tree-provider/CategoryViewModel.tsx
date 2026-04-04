import { TComponentModel } from "../../core/state/model";
import type { ITreeProvider, ITreeProviderItem } from "../../api/types/io.tree";
import type { MenuItem } from "../overlay/PopupMenu";
import { ContextMenuEvent } from "../../api/events/events";
import { ui } from "../../api/ui";
import {
    CopyIcon,
    DeleteIcon,
    FolderOpenIcon,
    RenameIcon,
} from "../../theme/icons";

// =============================================================================
// Types
// =============================================================================

/** All modes defined for future use. Only "list" is implemented initially. */
export type CategoryViewMode =
    | "list"
    | "tiles-landscape"
    | "tiles-landscape-big"
    | "tiles-portrait"
    | "tiles-portrait-big";

export interface CategoryViewProps {
    provider: ITreeProvider;
    /** Category path to display items for */
    category: string;
    /** Called when user clicks a non-directory item */
    onItemClick?: (item: ITreeProviderItem) => void;
    /** Called when user double-clicks a non-directory item */
    onItemDoubleClick?: (item: ITreeProviderItem) => void;
    /** Called when user clicks a directory item (navigate into) */
    onFolderClick?: (item: ITreeProviderItem) => void;
    /** Currently selected item href */
    selectedHref?: string;
    /** View mode. Default: "list" */
    viewMode?: CategoryViewMode;
    /** Called when view mode changes */
    onViewModeChange?: (mode: CategoryViewMode) => void;
    /** Portal target for search controls. When set, search renders there instead of own toolbar. */
    toolbarPortalRef?: HTMLElement | null;
}

export interface CategoryViewState {
    items: ITreeProviderItem[];
    filteredItems: ITreeProviderItem[];
    searchText: string;
    loading: boolean;
    error: string | null;
}

export const defaultCategoryViewState: CategoryViewState = {
    items: [],
    filteredItems: [],
    searchText: "",
    loading: false,
    error: null,
};

// =============================================================================
// Model
// =============================================================================

export class CategoryViewModel extends TComponentModel<
    CategoryViewState,
    CategoryViewProps
> {
    setProps = () => {
        if (
            this.isFirstUse
            || this.oldProps?.category !== this.props.category
            || this.oldProps?.provider !== this.props.provider
        ) {
            this.loadItems();
        }
    };

    // ── Data loading ─────────────────────────────────────────────────────

    loadItems = async () => {
        this.state.update((s) => { s.loading = true; s.error = null; });

        try {
            const items = await this.props.provider.list(this.props.category);
            const { searchText } = this.state.get();
            const filteredItems = filterItems(items, searchText);

            this.state.update((s) => {
                s.items = items;
                s.filteredItems = filteredItems;
                s.loading = false;
                s.error = null;
            });
        } catch (err: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
            this.state.update((s) => {
                s.items = [];
                s.filteredItems = [];
                s.loading = false;
                s.error = err.message || "Failed to load items";
            });
        }
    };

    // ── Search ───────────────────────────────────────────────────────────

    setSearchText = (text: string) => {
        const { items } = this.state.get();
        const filteredItems = filterItems(items, text);
        this.state.update((s) => {
            s.searchText = text;
            s.filteredItems = filteredItems;
        });
    };

    // ── Click handlers ───────────────────────────────────────────────────

    onItemClick = (item: ITreeProviderItem) => {
        this.props.onItemClick?.(item);
    };

    onItemDoubleClick = (item: ITreeProviderItem) => {
        if (item.isDirectory) {
            this.props.onFolderClick?.(item);
        } else {
            this.props.onItemDoubleClick?.(item);
        }
    };

    // ── Context menus ────────────────────────────────────────────────────

    onItemContextMenu = (item: ITreeProviderItem, e: React.MouseEvent) => {
        const ctxEvent = ContextMenuEvent.fromNativeEvent(e, "tree-provider-item");
        const menuItems = item.isDirectory
            ? this.getFolderMenuItems(item)
            : this.getFileMenuItems(item);
        ctxEvent.items.push(...menuItems);
    };

    private getFileMenuItems = (item: ITreeProviderItem): MenuItem[] => {
        const { provider } = this.props;
        const items: MenuItem[] = [];

        items.push({
            label: "Copy Path",
            icon: <CopyIcon />,
            onClick: () => navigator.clipboard.writeText(item.href),
        });

        if (provider.writable) {
            if (provider.rename) {
                items.push({
                    startGroup: true,
                    label: "Rename...",
                    icon: <RenameIcon />,
                    onClick: () => this.renameItem(item),
                });
            }
            if (provider.deleteItem) {
                items.push({
                    label: "Delete",
                    icon: <DeleteIcon />,
                    onClick: () => this.deleteItemAction(item),
                });
            }
        }

        return items;
    };

    private getFolderMenuItems = (item: ITreeProviderItem): MenuItem[] => {
        const { provider } = this.props;
        const items: MenuItem[] = [];

        items.push({
            label: "Open",
            icon: <FolderOpenIcon />,
            onClick: () => this.props.onFolderClick?.(item),
        });

        items.push({
            label: "Copy Path",
            icon: <CopyIcon />,
            onClick: () => navigator.clipboard.writeText(item.href),
        });

        if (provider.writable) {
            if (provider.rename) {
                items.push({
                    startGroup: true,
                    label: "Rename...",
                    icon: <RenameIcon />,
                    onClick: () => this.renameItem(item),
                });
            }
            if (provider.deleteItem) {
                items.push({
                    label: "Delete",
                    icon: <DeleteIcon />,
                    onClick: () => this.deleteItemAction(item),
                });
            }
        }

        return items;
    };

    // ── File operations ──────────────────────────────────────────────────

    private renameItem = async (item: ITreeProviderItem) => {
        const { provider } = this.props;
        if (!provider.rename) return;

        const inputResult = await ui.input("Enter new name:", {
            title: `Rename ${item.isDirectory ? "Folder" : "File"}`,
            value: item.name,
            buttons: ["Rename", "Cancel"],
            selectAll: true,
        });
        if (inputResult?.button !== "Rename" || !inputResult.value.trim()) return;

        const newName = inputResult.value.trim();
        const category = item.category;
        const oldPath = category ? category + "/" + item.name : item.name;
        const newPath = category ? category + "/" + newName : newName;

        try {
            await provider.rename(oldPath, newPath);
        } catch (err: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
            ui.notify(err.message || "Failed to rename.", "warning");
            return;
        }
        await this.loadItems();
    };

    private deleteItemAction = async (item: ITreeProviderItem) => {
        const { provider } = this.props;
        if (!provider.deleteItem) return;

        const bt = await ui.confirm(
            `Are you sure you want to delete "${item.name}"?`,
            { title: "Delete Confirmation", buttons: ["Delete", "Cancel"] },
        );
        if (bt !== "Delete") return;

        try {
            await provider.deleteItem(item.href);
        } catch (err: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
            ui.notify(err.message || "Failed to delete.", "warning");
            return;
        }
        await this.loadItems();
    };
}

// =============================================================================
// Pure utility functions
// =============================================================================

function filterItems(items: ITreeProviderItem[], searchText: string): ITreeProviderItem[] {
    if (!searchText) return items;
    const words = searchText.toLowerCase().split(" ").filter(Boolean);
    if (words.length === 0) return items;
    return items.filter((item) => {
        const nameLower = item.name.toLowerCase();
        return words.every((w) => nameLower.includes(w));
    });
}
