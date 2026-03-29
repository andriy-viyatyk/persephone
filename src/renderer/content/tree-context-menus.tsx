import { app } from "../api/app";
import { RawLinkEvent } from "../api/events/events";
import {
    FolderOpenIcon,
    NewWindowIcon,
    OpenFileIcon,
} from "../theme/icons";

/**
 * Register default context menu handlers for tree provider items.
 *
 * Handlers add type-specific menu items based on the item's href.
 * Call during app bootstrap (same pattern as registerRawLinkParsers).
 *
 * Registration order matters (LIFO): last registered runs first.
 */
export function registerTreeContextMenuHandlers(): void {
    // File handler — for local file paths (not HTTP)
    app.events.treeProviderContextMenu.subscribe(async (event) => {
        const item = event.target;
        if (!item) return;
        if (item.href.startsWith("http://") || item.href.startsWith("https://")) return;
        if (item.isDirectory) {
            event.items.push(
                {
                    startGroup: true,
                    label: "Open in New Tab",
                    icon: <OpenFileIcon />,
                    onClick: async () => {
                        const { pagesModel } = await import("../api/pages");
                        pagesModel.addEmptyPageWithNavPanel(item.href);
                    },
                },
            );
            // Show in File Explorer (folders)
            event.items.push({
                label: "Show in File Explorer",
                icon: <FolderOpenIcon />,
                onClick: async () => {
                    const { api } = await import("../../ipc/renderer/api");
                    api.showFolder(item.href);
                },
            });
        } else {
            event.items.push(
                {
                    startGroup: true,
                    label: "Open in New Tab",
                    icon: <OpenFileIcon />,
                    onClick: () => app.events.openRawLink.sendAsync(new RawLinkEvent(item.href)),
                },
                {
                    label: "Open in New Window",
                    icon: <NewWindowIcon />,
                    onClick: async () => {
                        const { pagesModel } = await import("../api/pages");
                        pagesModel.openPathInNewWindow(item.href);
                    },
                },
                {
                    label: "Show in File Explorer",
                    icon: <FolderOpenIcon />,
                    onClick: async () => {
                        const { api } = await import("../../ipc/renderer/api");
                        api.showItemInFolder(item.href);
                    },
                },
            );

            // Re-fire on fileExplorer.itemContextMenu for script compatibility
            const { ContextMenuEvent: CtxMenuEvent } = await import("../api/events/events");
            const fileTarget = {
                path: item.href,
                name: item.name,
                isDirectory: item.isDirectory,
            };
            const compatEvent = new CtxMenuEvent("file-explorer-item", fileTarget, [...event.items]);
            await app.events.fileExplorer.itemContextMenu.sendAsync(compatEvent);
            // Merge any items added by script subscribers
            if (compatEvent.items.length > event.items.length) {
                event.items.push(...compatEvent.items.slice(event.items.length));
            }
        }
    });
}
