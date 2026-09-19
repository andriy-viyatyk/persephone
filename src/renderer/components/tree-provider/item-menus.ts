import type { ITreeProvider, ITreeProviderItem } from "../../api/types/io.tree";
import type { MenuItem } from "../../uikit/Menu";
import { isUrlOrCurl } from "../../content/link-utils";
import { toClipboard } from "../../core/utils/utils";
import {
    CopyIcon,
    CutIcon,
    DeleteIcon,
    FolderOpenIcon,
    NewFileIcon,
    NewFolderIcon,
    PasteIcon,
    RenameIcon,
    TerminalIcon,
} from "../../theme/icons";
import { copyPathToOsClipboard, supportsOsClipboard } from "./os-clipboard";

export interface ItemMenuActions {
    createFile(directory: string): void;
    createFolder(directory: string): void;
    paste(directory: string): void;
    rename(item: ITreeProviderItem): void;
    deleteItem(item: ITreeProviderItem): void;
}

/**
 * The four "change what is on disk" actions, as one group placed directly after the
 * clipboard group. File and folder rows build it from here so the two menus agree: before
 * this, folders opened with New File / New Folder and kept Rename / Delete near the bottom,
 * while files got New File / New Folder appended last of all by the background handler.
 *
 * `directory` is where New File / New Folder create — the folder itself for a folder row,
 * the file's parent for a file row. Rename and Delete are suppressed for a tree root, which
 * owns neither operation.
 */
function pushEditGroup(
    items: MenuItem[],
    options: {
        provider: ITreeProvider;
        item: ITreeProviderItem;
        directory: string;
        actions: Pick<ItemMenuActions, "createFile" | "createFolder" | "rename" | "deleteItem">;
        allowRenameDelete: boolean;
    },
): void {
    const { provider, item, directory, actions, allowRenameDelete } = options;
    const startIndex = items.length;

    if (allowRenameDelete && provider.writable && provider.rename) {
        items.push({
            label: "Rename...",
            icon: RenameIcon.createElement(),
            onClick: () => actions.rename(item),
        });
    }
    if (allowRenameDelete && provider.writable && provider.deleteItem) {
        items.push({
            label: "Delete",
            icon: DeleteIcon.createElement(),
            onClick: () => actions.deleteItem(item),
        });
    }
    if (provider.writable && provider.mkdir) {
        items.push(
            {
                label: "New File...",
                icon: NewFileIcon.createElement(),
                onClick: () => actions.createFile(directory),
            },
            {
                label: "New Folder...",
                icon: NewFolderIcon.createElement(),
                onClick: () => actions.createFolder(directory),
            },
        );
    }

    // Whichever of the four survived the provider's capabilities opens the group.
    const first = items[startIndex];
    if (first && startIndex > 0) first.startGroup = true;
}

export function getFileMenuItems(
    provider: ITreeProvider,
    item: ITreeProviderItem,
    actions: ItemMenuActions,
    /** The file's parent — what Paste and New File / New Folder target, as Ctrl+V does. */
    directory: string,
): MenuItem[] {
    const items: MenuItem[] = [{
        label: isUrlOrCurl(item.href) ? "Copy Href" : "Copy Path",
        icon: CopyIcon.createElement(),
        onClick: () => toClipboard(item.href),
    }];

    if (supportsOsClipboard(provider)) {
        items.push(
            {
                startGroup: true,
                label: "Cut",
                icon: CutIcon.createElement(),
                onClick: () => copyPathToOsClipboard(item.href, true),
            },
            {
                label: "Copy",
                icon: CopyIcon.createElement(),
                onClick: () => copyPathToOsClipboard(item.href, false),
            },
        );
        // Paste belongs with Cut/Copy, as it already does on a folder row. The background
        // handler that used to contribute it appends after every other layer, which stranded
        // it at the bottom of the menu next to Inspect.
        items.push({
            label: "Paste",
            icon: PasteIcon.createElement(),
            onClick: () => actions.paste(directory),
        });
    }

    pushEditGroup(items, { provider, item, directory, actions, allowRenameDelete: true });
    return items;
}

export interface FolderMenuOptions {
    provider: ITreeProvider;
    item: ITreeProviderItem;
    /** Provider list/create path for this folder, which differs from href for archive trees. */
    directory: string;
    isRoot?: boolean;
    onOpen?: () => void;
    actions: ItemMenuActions;
}

export function getFolderMenuItems(options: FolderMenuOptions): MenuItem[] {
    const { provider, item, directory, isRoot = false, onOpen, actions } = options;
    const items: MenuItem[] = [];

    if (onOpen) {
        items.push({ label: "Open", icon: FolderOpenIcon.createElement(), onClick: onOpen });
    }

    items.push({
        startGroup: items.length > 0,
        label: isUrlOrCurl(item.href) ? "Copy Href" : "Copy Path",
        icon: CopyIcon.createElement(),
        onClick: () => toClipboard(item.href),
    });

    if (supportsOsClipboard(provider)) {
        if (!isRoot) {
            items.push({
                startGroup: true,
                label: "Cut",
                icon: CutIcon.createElement(),
                onClick: () => copyPathToOsClipboard(item.href, true),
            });
        }
        items.push(
            {
                startGroup: isRoot,
                label: "Copy",
                icon: CopyIcon.createElement(),
                onClick: () => copyPathToOsClipboard(item.href, false),
            },
            {
                label: "Paste",
                icon: PasteIcon.createElement(),
                onClick: () => actions.paste(directory),
            },
        );
    }

    pushEditGroup(items, { provider, item, directory, actions, allowRenameDelete: !isRoot });

    if (supportsOsClipboard(provider)) {
        items.push({
            startGroup: true,
            label: "Open Terminal here",
            icon: TerminalIcon.createElement(),
            onClick: async () => {
                const { openTerminalAt } = await import("../../api/terminal");
                openTerminalAt(item.href);
            },
        });
    }
    return items;
}

export function getBackgroundMenuItems(
    provider: ITreeProvider,
    directory: string,
    actions: Pick<ItemMenuActions, "createFile" | "createFolder" | "paste">,
): MenuItem[] {
    const items: MenuItem[] = [];
    if (provider.writable && provider.mkdir) {
        items.push(
            {
                label: "New File...",
                icon: NewFileIcon.createElement(),
                onClick: () => actions.createFile(directory),
            },
            {
                label: "New Folder...",
                icon: NewFolderIcon.createElement(),
                onClick: () => actions.createFolder(directory),
            },
        );
    }
    if (supportsOsClipboard(provider)) {
        items.push({
            startGroup: items.length > 0,
            label: "Paste",
            icon: PasteIcon.createElement(),
            onClick: () => actions.paste(directory),
        });
    }
    return items;
}
