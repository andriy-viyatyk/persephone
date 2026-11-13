import type { TimeoutExemptions } from "../timeout-exemptions";
import type { PageDragData, PageDescriptor, WindowPages } from "../../shared/types";
import type { IWindowDisplay, IWindowMoveResult, WindowDisplayTarget } from "../api-param-types";
import type { EventObject } from "./event-object";

export interface WindowApi {
    setBoardWindowIdentity: (request: { displayName: string; iconDataUrl: string }) => Promise<void>;
    createBoardShortcut: (request: CreateBoardShortcutRequest) => Promise<boolean>;
    openBoardWindow: (boardRoot: string) => Promise<void>;
    maximizeWindow: () => Promise<void>;
    getDisplays: () => Promise<readonly IWindowDisplay[]>;
    moveToDisplay: (
        target: WindowDisplayTarget,
        options?: { maximize?: boolean; fullscreen?: boolean },
    ) => Promise<IWindowMoveResult>;
    setFullScreen: (on: boolean) => Promise<{ fullscreen: boolean }>;
    getFullScreen: () => Promise<boolean>;
    minimizeWindow: () => Promise<void>;
    restoreWindow: () => Promise<void>;
    closeWindow: () => Promise<void>;
    setCanQuit: (canQuit: boolean) => Promise<void>;
    resolveWindowClose: (result: WindowCloseResolution) => Promise<void>;
    zoom: (delta: number) => Promise<void>;
    windowReady: () => Promise<void>;
    getWindowIndex: () => Promise<number>;
    openNewWindow: (filePath?: string) => Promise<number>;
    getWindowPages: () => Promise<WindowPages[]>;
    showWindowPage: (windowIndex: number, pageId: string) => Promise<void>;
    addDragEvent: (event: PageDragData) => Promise<void>;
    resetZoom: () => Promise<void>;
}

export interface WindowEvents {
    eWindowMaximized: EventObject<boolean>;
    eBeforeQuit: EventObject<void>;
    eReloadForLanguage: EventObject<void>;
    eShowPage: EventObject<string>;
    eMovePageIn: EventObject<{ page: PageDescriptor; targetPageId: string | undefined }>;
    eMovePageOut: EventObject<string>;
    eZoomChanged: EventObject<number>;
}

export interface CreateBoardShortcutRequest {
    boardRoot: string;
    linkPath: string;
    overwrite?: boolean;
    displayName: string;
    iconDataUrl: string;
}

export type WindowCloseResolution =
    | { outcome: "prompting" }
    | { outcome: "cancel" }
    | { outcome: "close"; canQuit: boolean };


export const windowTimeoutExemptions = {
    showWindowPage: "Opening a window waits for renderer startup without a fixed bound.",
    createBoardShortcut: "Icon decoding and filesystem verification are not request-bounded.",
    moveToDisplay: "Coordinated OS transitions can exceed the default deadline.",
} satisfies TimeoutExemptions<WindowApi>;
