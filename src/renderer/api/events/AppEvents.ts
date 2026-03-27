import { EventChannel } from "./EventChannel";
import type { ContextMenuEvent, BookmarkEvent, RawLinkEvent, OpenLinkEvent, OpenContentEvent } from "./events";
import type { IFileTarget } from "../types/events";

export class FileExplorerEvents {
    readonly itemContextMenu = new EventChannel<ContextMenuEvent<IFileTarget>>({ name: "fileExplorer.itemContextMenu" });
}

export class BrowserEvents {
    readonly onBookmark = new EventChannel<BookmarkEvent>({ name: "browser.onBookmark" });
}

export class AppEvents {
    readonly fileExplorer = new FileExplorerEvents();
    readonly browser = new BrowserEvents();

    // Link pipeline (EPIC-012)
    readonly openRawLink = new EventChannel<RawLinkEvent>({ name: "openRawLink" });
    readonly openLink = new EventChannel<OpenLinkEvent>({ name: "openLink" });
    readonly openContent = new EventChannel<OpenContentEvent>({ name: "openContent" });
}
