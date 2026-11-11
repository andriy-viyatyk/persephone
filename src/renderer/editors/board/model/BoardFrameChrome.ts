import type {
    BoardStatusBarItem,
    BoardStatusBarPatch,
    BoardToolbarControlDescriptor,
    BoardToolbarControlPatch,
} from "../../../../ipc/board-bridge/ui-catalog";
import { TOneState } from "../../../core/state/state";
import {
    mergePatch,
    mergeStatusBarPatch,
    type BoardChromeWarning,
} from "../chrome/board-chrome-protocol";

export interface BoardToolbarElementDeclaration {
    readonly name: string;
    readonly purpose: string;
    readonly where: string;
    readonly selector: string;
}

export interface BoardChromeOwner {
    readonly token: object;
    readonly generation: number;
}

export interface BoardChromeCatalog<T> {
    readonly items: readonly T[];
    readonly warning: BoardChromeWarning;
}

export interface BoardChromeState {
    readonly owner: BoardChromeOwner | undefined;
    readonly toolbar: BoardChromeCatalog<BoardToolbarControlDescriptor> | undefined;
    readonly status: BoardChromeCatalog<BoardStatusBarItem> | undefined;
    readonly toolbarText: string | undefined;
    readonly statusText: string | undefined;
}

export type BoardSaveResult = { success: boolean; error?: string };
export type BoardSaveRequest = (discard?: boolean) => Promise<BoardSaveResult>;

interface BoardSaveHandler {
    readonly id: number;
    readonly request: BoardSaveRequest;
}

interface BoardFrameChromeOptions {
    readonly canExposeDeclarations: () => boolean;
    readonly setPageMuted: (muted: boolean | undefined) => void;
}

const EMPTY_STATE: BoardChromeState = {
    owner: undefined,
    toolbar: undefined,
    status: undefined,
    toolbarText: undefined,
    statusText: undefined,
};

function sameOwner(left: BoardChromeOwner | undefined, right: BoardChromeOwner): boolean {
    return left?.token === right.token && left.generation === right.generation;
}

function inBoardMenu(descriptor: BoardToolbarControlDescriptor): boolean {
    return descriptor.type === "menu" && descriptor.placement === "board-menu";
}

function atStart(descriptor: BoardToolbarControlDescriptor): boolean {
    return (descriptor.type === "button" || descriptor.type === "menu")
        && descriptor.placement === "start";
}

export class BoardFrameChrome {
    readonly state = new TOneState<BoardChromeState>(EMPTY_STATE);
    private readonly boardThemePreviewGenerations = new Map<string, number>();
    private muteToggle: (() => void) | undefined;
    private mutePresent = false;
    private saveHandler: BoardSaveHandler | undefined;

    constructor(private readonly options: BoardFrameChromeOptions) {}

    setToolbar(
        owner: BoardChromeOwner,
        controls: readonly BoardToolbarControlDescriptor[],
        warning: BoardChromeWarning,
    ): void {
        const state = this.claim(owner);
        this.publish({ ...state, toolbar: { items: [...controls], warning } });
    }

    updateToolbar(
        owner: BoardChromeOwner,
        patches: readonly BoardToolbarControlPatch[],
        warning: BoardChromeWarning,
    ): void {
        const state = this.state.get();
        if (!state.owner) {
            for (const patch of patches) {
                warning(`Ignored board toolbar update for unknown control "${patch.id}".`);
            }
            return;
        }
        if (!sameOwner(state.owner, owner)) return;
        const items = [...(state.toolbar?.items ?? [])];
        for (const patch of patches) {
            const index = items.findIndex((control) => control.id === patch.id);
            if (index < 0) {
                warning(`Ignored board toolbar update for unknown control "${patch.id}".`);
                continue;
            }
            const next = mergePatch(items[index], patch, warning);
            if (next) items[index] = next;
        }
        this.publish({ ...state, toolbar: { items, warning } });
    }

    setStatusBar(
        owner: BoardChromeOwner,
        items: readonly BoardStatusBarItem[],
        warning: BoardChromeWarning,
    ): void {
        const state = this.claim(owner);
        this.publish({ ...state, status: { items: [...items], warning } });
    }

    updateStatusBar(
        owner: BoardChromeOwner,
        patches: readonly BoardStatusBarPatch[],
        warning: BoardChromeWarning,
    ): void {
        const state = this.state.get();
        if (!sameOwner(state.owner, owner) || !state.status) return;
        const items = [...state.status.items];
        for (const patch of patches) {
            const index = items.findIndex((item) => item.id === patch.id);
            if (index < 0) {
                warning(`Ignored board status-bar update for unknown item "${patch.id}".`);
                continue;
            }
            const next = mergeStatusBarPatch(items[index], patch, warning);
            if (next) items[index] = next;
        }
        this.publish({ ...state, status: { items, warning } });
    }

    setToolbarText(owner: BoardChromeOwner, text: string): void {
        this.publish({ ...this.claim(owner), toolbarText: text });
    }

    setStatusText(owner: BoardChromeOwner, text: string): void {
        this.publish({ ...this.claim(owner), statusText: text });
    }

    setMuted(owner: BoardChromeOwner, muted: boolean | null, onToggle: () => void): void {
        if (muted === null) {
            if (!sameOwner(this.state.get().owner, owner)) return;
            if (!this.mutePresent && !this.muteToggle) return;
            this.mutePresent = false;
            this.muteToggle = undefined;
            this.options.setPageMuted(undefined);
            this.notifyPresenceChange();
            return;
        }
        this.claim(owner);
        const wasPresent = this.mutePresent;
        const changedToggle = this.muteToggle !== onToggle;
        this.mutePresent = true;
        this.muteToggle = onToggle;
        this.options.setPageMuted(muted);
        if (wasPresent !== this.mutePresent || changedToggle) this.notifyPresenceChange();
    }

    get toggleMuteAll(): (() => void) | undefined {
        return this.mutePresent ? this.muteToggle : undefined;
    }

    setSaveHandler(owner: BoardChromeOwner, handlerId: number, request: BoardSaveRequest): void {
        this.claim(owner);
        this.saveHandler = { id: handlerId, request };
    }

    clearSaveHandler(owner: BoardChromeOwner, handlerId: number): void {
        if (!sameOwner(this.state.get().owner, owner) || this.saveHandler?.id !== handlerId) return;
        this.saveHandler = undefined;
    }

    get saveRequest(): BoardSaveRequest | undefined {
        return this.saveHandler?.request;
    }

    getLiveToolbarElementDeclarations(): readonly BoardToolbarElementDeclaration[] {
        const state = this.state.get();
        if (!this.options.canExposeDeclarations()) return [];
        const toolbar = (state.toolbar?.items ?? []).filter((item) => !inBoardMenu(item)).map((item) => ({
            name: `board-toolbar-control-${item.id}`,
            selector: `[data-name="board-toolbar-control-${item.id}"]`,
            purpose: `Locate the board toolbar ${item.type} "${item.label ?? item.id}" control.`,
            where: atStart(item)
                ? "board toolbar, at the left before the board text slot"
                : item.type === "breadcrumb"
                    ? "board toolbar, after start controls and before normal controls"
                    : "board toolbar, between the board text slot and Persephone controls",
        }));
        const status = (state.status?.items ?? []).filter((item) => !item.hidden).map((item) => ({
            name: `board-status-bar-item-${item.id}`,
            purpose: `Board status-bar item ${item.id}`,
            where: "Board footer status bar",
            selector: `[data-name="board-status-bar-item-${item.id}"]`,
        }));
        return [...toolbar, ...status];
    }

    recordBoardThemePreview(boardId: string, generation: number): void {
        this.boardThemePreviewGenerations.set(boardId, generation);
    }

    takeBoardThemePreviewGeneration(boardId: string): number | undefined {
        const generation = this.boardThemePreviewGenerations.get(boardId);
        this.boardThemePreviewGenerations.delete(boardId);
        return generation;
    }

    retireFrame(owner: BoardChromeOwner): void {
        if (!sameOwner(this.state.get().owner, owner)) return;
        this.clearFrameState();
    }

    dispose(): void {
        this.clearFrameState();
        this.boardThemePreviewGenerations.clear();
    }

    private claim(owner: BoardChromeOwner): BoardChromeState {
        const state = this.state.get();
        if (sameOwner(state.owner, owner)) return state;
        this.clearFrameState();
        const claimed = { ...EMPTY_STATE, owner: { token: owner.token, generation: owner.generation } };
        this.publish(claimed);
        return claimed;
    }

    private clearFrameState(): void {
        this.mutePresent = false;
        this.muteToggle = undefined;
        this.saveHandler = undefined;
        this.options.setPageMuted(undefined);
        this.publish(EMPTY_STATE);
    }

    private publish(state: BoardChromeState): void {
        this.state.set(state);
    }

    private notifyPresenceChange(): void {
        this.state.set({ ...this.state.get() });
    }
}
