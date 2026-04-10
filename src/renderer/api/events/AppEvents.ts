import { EventChannel } from "./EventChannel";
import type { ContextMenuEvent, BookmarkEvent } from "./events";
import type { IFileTarget } from "../types/events";
import type { ILink } from "../types/io.tree";
import type { ILinkData } from "../../../shared/link-data";

export class FileExplorerEvents {
    readonly itemContextMenu = new EventChannel<ContextMenuEvent<IFileTarget>>({ name: "fileExplorer.itemContextMenu" });
}

export class BrowserEvents {
    readonly onBookmark = new EventChannel<BookmarkEvent>({ name: "browser.onBookmark" });
}

export class AppEvents {
    readonly fileExplorer = new FileExplorerEvents();
    readonly browser = new BrowserEvents();

    // Link pipeline (EPIC-012 → EPIC-023)
    readonly openRawLink = new EventChannel<ILinkData>({ name: "openRawLink" });
    readonly openLink = new EventChannel<ILinkData>({ name: "openLink" });
    readonly openContent = new EventChannel<ILinkData>({ name: "openContent" });

    // Link context menu — type-aware menu items for any ILink (EPIC-015, EPIC-018)
    readonly linkContextMenu = new EventChannel<ContextMenuEvent<ILink>>({ name: "linkContextMenu" });
}
