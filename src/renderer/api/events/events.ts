import React from "react";
import { BaseEvent } from "./BaseEvent";
import type { MenuItem } from "../types/events";
import type { IContentPipe } from "../types/io.pipe";
import type { ILinkMetadata } from "../types/io.events";

/**
 * Identifies the source/kind of context menu.
 * Used to filter events in a global `onContextMenu` channel.
 */
export type ContextMenuTargetKind =
    | "page-tab"
    | "file-explorer-item"
    | "file-explorer-background"
    | "sidebar-folder"
    | "sidebar-background"
    | "markdown-link"
    | "browser-webview"
    | "browser-url-bar"
    | "browser-tab"
    | "grid-cell"
    | "graph-node"
    | "graph-area"
    | "link-item"
    | "link-pinned"
    | "generic";

/** Bookmark event — fired before the Add/Edit Bookmark dialog opens. */
export class BookmarkEvent extends BaseEvent {
    constructor(
        public title: string,
        public href: string,
        public discoveredImages: string[],
        public imgSrc: string,
        public category: string,
        public tags: string[],
        public readonly isEdit: boolean,
    ) {
        super();
    }
}

/** Generic context menu event. T defines the target that was right-clicked. */
export class ContextMenuEvent<T> extends BaseEvent {
    readonly targetKind: ContextMenuTargetKind;
    target: T;
    items: MenuItem[];

    constructor(targetKind: ContextMenuTargetKind, target: T, items: MenuItem[] = []) {
        super();
        this.targetKind = targetKind;
        this.target = target;
        this.items = items;
    }

    /** Get or create a ContextMenuEvent on the native mouse event. */
    static fromNativeEvent(e: React.MouseEvent, targetKind: ContextMenuTargetKind): ContextMenuEvent<unknown> {
        if (!e.nativeEvent.contextMenuEvent) {
            e.nativeEvent.contextMenuEvent = new ContextMenuEvent(targetKind, null);
        }
        return e.nativeEvent.contextMenuEvent;
    }
}

// ── Link Pipeline Events (EPIC-012) ────────────────────────────────

/** Layer 1: Raw link string to be parsed. */
export class RawLinkEvent extends BaseEvent {
    constructor(
        public readonly raw: string,
    ) {
        super();
    }
}

/** Layer 2: Structured link to be resolved into provider + transformers. */
export class OpenLinkEvent extends BaseEvent {
    constructor(
        public readonly url: string,
        public target?: string,
        public metadata?: ILinkMetadata,
    ) {
        super();
    }
}

/** Layer 3: Content pipe + target to be opened in an editor. */
export class OpenContentEvent extends BaseEvent {
    constructor(
        public readonly pipe: IContentPipe,
        public readonly target: string,
        public readonly metadata?: ILinkMetadata,
    ) {
        super();
    }
}
