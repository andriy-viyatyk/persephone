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

/** Tab info exposed by automation targets that can report selected documents. */
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

/** CDP capabilities used by shared automation operations. */
export interface IAutomationTarget {
    /** Editor model ID (for page identification). */
    readonly id: string;

    /** CDP session for a specific tab (or active tab if omitted). */
    cdp(tabId?: string): CdpSession;

    /** CDP input channel for the selected document or an attached OOPIF session. */
    inputCdp(tabId?: string, sessionId?: string): IInputSession;

    /** Optional: ensure a tab is attachable before a command runs. */
    ensureReady?(tabId?: string): Promise<void>;
}

/** Host seams used only by the explicit synthetic input compatibility path. */
export interface ISyntheticInputHost {
    /** Focus the host webview for explicit synthetic compatibility. */
    focusWebview(tabId?: string): void;

    /** Insert text through the host's legacy native insertion seam for explicit synthetic compatibility. */
    insertText(text: string, tabId?: string): Promise<void>;

}

export interface INavigableTarget {
    navigate(url: string): void;
    back(): void;
    forward(): void;
    reload(): void;

}

export interface ITabInfoTarget {
    readonly tabs: ReadonlyArray<ITargetTab>;
    readonly activeTab: ITargetTab | undefined;
}

export interface ITabbedTarget extends ITabInfoTarget {
    /** Select the active tab. Async for targets that must mount a frame on demand. */
    switchTab(tabId: string): void | Promise<void>;
}

export interface IMutableTabTarget extends ITabbedTarget {
    addTab(url?: string): string;
    closeTab(tabId?: string): void;
}
