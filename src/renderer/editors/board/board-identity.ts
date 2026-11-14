import { boardDisplayText, boardMetadataKeys, ensureBoardDisplayText, onBoardDisplayTextChanged } from "../../api/boards/board-display-text";
import { readBoardManifest } from "../../api/boards/board-manifest-io";
import { fpBasename } from "../../core/utils/file-path";
import { createBoardGlyphElement } from "../../components/icons/board-glyph-element";
import { subscribeBoardIconChanges } from "../../components/icons/board-icon-cache";

type BoardDisplayTextReason = "resolve" | "refresh" | "invalidate";

export type BoardIdentityChangedEvent =
    | { kind: "text"; root: string; reason: BoardDisplayTextReason }
    | { kind: "icon"; root: string };

type BoardIdentityListener = (event: BoardIdentityChangedEvent) => void;

/** Shared board identity snapshots and notifications for shell surfaces. */
export class BoardIdentity {
    private readonly warmedRoots = new Set<string>();
    private readonly manifestNames = new Map<string, string>();
    private readonly listeners = new Set<BoardIdentityListener>();

    public constructor() {
        onBoardDisplayTextChanged((root, reason) => {
            if (reason === "invalidate") this.warmedRoots.clear();
            const event: BoardIdentityChangedEvent = { kind: "text", root, reason };
            for (const listener of this.listeners) listener(event);
        });
        subscribeBoardIconChanges((root) => {
            const event: BoardIdentityChangedEvent = { kind: "icon", root };
            for (const listener of this.listeners) listener(event);
        });
    }

    public displayName(root: string, fallback = fpBasename(root)): string {
        this.warm(root);
        return boardDisplayText(root, undefined, boardMetadataKeys.name, fallback);
    }

    public manifestName(root: string): string {
        this.warm(root);
        return this.manifestNames.get(root) || fpBasename(root);
    }

    public glyph(root?: string, size?: number): Element {
        return size === undefined ? createBoardGlyphElement(root) : createBoardGlyphElement(root, size);
    }

    public warm(root: string): void {
        if (this.warmedRoots.has(root)) return;
        this.warmedRoots.add(root);
        void readBoardManifest(root).then((manifest) => {
            if (!manifest) return;
            this.manifestNames.set(root, manifest.name?.trim() || fpBasename(root));
            return ensureBoardDisplayText(root, manifest);
        }).catch(() => {});
    }

    public onChanged(listener: BoardIdentityListener): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }
}

export const boardIdentity = new BoardIdentity();
