import { EventChannel } from "./EventChannel";
import type { ContextMenuEvent } from "./events";
import type { IFileTarget } from "../types/events";

export class FileExplorerEvents {
    readonly itemContextMenu = new EventChannel<ContextMenuEvent<IFileTarget>>({ name: "fileExplorer.itemContextMenu" });
}

export class AppEvents {
    readonly fileExplorer = new FileExplorerEvents();
}
