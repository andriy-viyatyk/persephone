import type { CdpSession } from "./CdpSession";
import type {
    PageConsoleLevel,
    PageConsoleRecord,
    PageDialogPolicy,
    PageDialogRecord,
    PageErrorRecord,
} from "../../ipc/browser-ipc";

export type { PageConsoleLevel, PageConsoleRecord, PageDialogPolicy, PageDialogRecord, PageErrorRecord };

export interface IPageDialogSnapshot {
    policy: PageDialogPolicy;
    dialogs: PageDialogRecord[];
}

export interface IConsoleMessageOptions {
    since?: number;
    level?: PageConsoleLevel;
}

/** Tab info returned by IBrowserTarget. */
export interface ITargetTab {
    id: string;
    url: string;
    title: string;
    loading: boolean;
    active: boolean;
}

export interface IInputPoint {
    x: number;
    y: number;
}

export interface IInputSession {
    cdp: CdpSession;
    sessionId?: string;
    /** Map document-local coordinates through same-process ancestor iframe offsets. */
    mapPoint(point: IInputPoint, ancestorFrameOffsets?: ReadonlyArray<IInputPoint>): IInputPoint;
}

/** Lightweight adapter interface — what the automation layer needs from the browser editor. */
export interface IBrowserTarget {
    /** Editor model ID (for page identification). */
    readonly id: string;

    /** CDP session for a specific tab (or active tab if omitted). */
    cdp(tabId?: string): CdpSession;

    /** CDP input channel for the selected document or an attached OOPIF session. */
    inputCdp(tabId?: string, sessionId?: string): IInputSession;

    /** Focus the host webview for the explicit synthetic compatibility route. Trusted keys use inputCdp(). */
    focusWebview(tabId?: string): void;

    /** Insert text through the host's legacy native insertion seam for explicit synthetic compatibility. */
    insertText(text: string, tabId?: string): Promise<void>;

    /** Navigation */
    navigate(url: string): void;
    back(): void;
    forward(): void;
    reload(): void;

    /** Tab management */
    readonly tabs: ReadonlyArray<ITargetTab>;
    readonly activeTab: ITargetTab | undefined;
    addTab(url?: string): string;
    closeTab(tabId?: string): void;
    /** Select the active tab. Async for targets that must mount the tab's frame on demand
     *  (a board auto-expands + waits for a secondary-view frame); sync `void` otherwise. */
    switchTab(tabId: string): void | Promise<void>;

    /** Optional: ensure a tab is attachable before a command runs (e.g. a board expands
     *  + waits for a secondary-view frame). Omit when tabs are always ready. */
    ensureReady?(tabId?: string): Promise<void>;
}
