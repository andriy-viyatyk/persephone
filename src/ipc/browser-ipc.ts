/**
 * IPC channel definitions and types for browser webview management.
 *
 * The renderer creates a <webview> element and registers it with the main
 * process by sending its webContentsId. The main process then attaches
 * reliable event listeners on the actual webContents object and relays
 * events back to the renderer. This avoids the unreliable event behavior
 * of the <webview> DOM element (e.g. page-favicon-updated not firing
 * on back/forward navigation).
 */

// IPC channel names
export const BrowserChannel = {
    // Renderer → Main
    register: "browser:register",
    unregister: "browser:unregister",
    /** Clear all storage data + cache for a given partition. Returns when done. */
    clearProfileData: "browser:clear-profile-data",
    /** Clear only HTTP cache (not cookies/storage) for a given partition. Returns when done. */
    clearCache: "browser:clear-cache",
    /** Renderer → Main (invoke): collect full DOM including iframe content. Args: (key: string) */
    collectDom: "browser:collect-dom",
    /** Renderer → Main (invoke): get network request log for a browser tab. Args: (key: string) */
    getNetworkLog: "browser:get-network-log",
    /** Renderer → Main (invoke): read bounded CDP event records for a target/session. */
    getPageEvents: "browser:get-page-events",
    /** Renderer → Main (invoke): mark the oldest reported dialog after snapshot succeeds. */
    markDialogReported: "browser:mark-dialog-reported",
    /** Renderer → Main (invoke): set dialog policy for a target/session. */
    setDialogPolicy: "browser:set-dialog-policy",
    /** Renderer → Main (invoke): resolve the pending JavaScript dialog. */
    handleDialog: "browser:handle-dialog",
    /** Renderer → Main (invoke): mark a target automation operation active/inactive. */
    automationBegin: "browser:automation-begin",
    automationEnd: "browser:automation-end",
    /** Arm a main-process CDP navigation wait. Args: (key, options) */
    armNavigationWait: "browser:arm-navigation-wait",
    /** Await and consume a previously armed navigation wait. Args: (token) */
    awaitNavigationWait: "browser:await-navigation-wait",
    /** Arm a main-process CDP response wait. Args: (key, pattern, options) */
    armResponseWait: "browser:arm-response-wait",
    /** Await and consume a previously armed response wait. Args: (token) */
    awaitResponseWait: "browser:await-response-wait",
    /** Arm one Input.dragIntercepted listener. Args: (key, sessionId?) */
    armDragIntercept: "browser:arm-drag-intercept",
    /** Consume an armed drag listener, returning data or null on timeout. Args: (token, waitMs) */
    takeDragIntercept: "browser:take-drag-intercept",
    /** Renderer → Main (invoke): attach CDP debugger to a webview. Args: (key: string, options?) */
    cdpAttach: "browser:cdp-attach",
    /** Renderer → Main (invoke): detach CDP debugger. Args: (key: string) */
    cdpDetach: "browser:cdp-detach",
    /** Renderer → Main (invoke): send CDP command. Args: (key: string, method: string, params?: object) */
    cdpSend: "browser:cdp-send",
    /** Renderer → Main: mute/unmute a webview's audio. Args: (key: string, muted: boolean) */
    setAudioMuted: "browser:set-audio-muted",
    /** Renderer → Main: allow popups for a given tabId (disable rate limiting). Args: (tabId: string) */
    allowPopups: "browser:allow-popups",
    /** Renderer → Main: hard reload (ignore cache) bypassing the beforeunload guard prompt. Args: (key: string) */
    hardReload: "browser:hard-reload",

    // Main → Renderer
    event: "browser:event",
} as const;

// Renderer → Main: register a webview
export interface BrowserRegisterRequest {
    tabId: string;
    internalTabId: string;
    webContentsId: number;
}

export interface CdpAttachOptions {
    aiVisionBinding?: boolean;
}

export type NavigationWaitUntil = "load" | "domcontentloaded" | "networkidle";
export interface NavigationWaitResult { url: string; status: number | null }
export interface NavigationWaitOptions {
    waitUntil?: NavigationWaitUntil;
    timeout?: number;
}

export interface BrowserResponsePattern { source: string; flags: string }
export interface BrowserResponseWaitOptions { timeout?: number; includeBody?: boolean; maxBodyBytes?: number }
export interface BrowserResponseResult {
    url: string;
    status: number;
    statusText: string;
    headers: Record<string, string>;
    mimeType: string;
    body?: string;
    base64Encoded?: boolean;
    truncated?: boolean;
}
export interface NetworkLogOptions { includeBodies?: boolean; maxBodyBytes?: number }
export interface NetworkResponseBody { responseBody: string; responseBodyBase64Encoded: boolean; responseBodyTruncated: boolean }

export interface DragData {
    items: Array<{ mimeType: string; data: string; title?: string; baseURL?: string }>;
    dragOperationsMask: number;
}

export type PageDialogPolicy = "accept" | "dismiss" | "manual";
export type PageDialogDisposition = "accepted" | "dismissed" | "pending";
export type PageConsoleLevel = "debug" | "info" | "log" | "warning" | "error";

export interface PageDialogRecord {
    type: string;
    message: string;
    url: string;
    timestamp: number;
    disposition: PageDialogDisposition;
    reported: boolean;
}

export interface PageConsoleRecord {
    type: PageConsoleLevel;
    args: string[];
    url: string;
    lineNumber: number;
    columnNumber: number;
    timestamp: number;
}

export interface PageErrorRecord {
    text: string;
    url: string;
    lineNumber: number;
    columnNumber: number;
    timestamp: number;
}

export interface PageEventsSnapshot {
    policy: PageDialogPolicy;
    dialogs: PageDialogRecord[];
    consoleMessages: PageConsoleRecord[];
    pageErrors: PageErrorRecord[];
}

// Main → Renderer: event payload
export interface BrowserEvent {
    tabId: string;
    internalTabId: string;
    type: BrowserEventType;
    data: BrowserEventData;
}

export type BrowserEventType =
    | "did-navigate"
    | "did-navigate-in-page"
    | "page-title-updated"
    | "page-favicon-updated"
    | "did-start-loading"
    | "did-stop-loading"
    | "did-start-navigation"
    | "new-window"
    | "context-menu"
    | "audio-state-changed"
    | "popups-blocked"
    | "show-find-bar"
    | "hide-find-bar"
    | "ai-vision-signal";

export interface BrowserEventData {
    url?: string;
    title?: string;
    favicon?: string;
    canGoBack?: boolean;
    canGoForward?: boolean;
    isMainFrame?: boolean;
    blocked?: boolean;
    disposition?: string;
    /** Context menu fields (from Electron's context-menu event params) */
    linkURL?: string;
    srcURL?: string;
    mediaType?: string;
    selectionText?: string;
    isEditable?: boolean;
    editFlags?: { canCopy: boolean; canPaste: boolean; canCut: boolean };
    x?: number;
    y?: number;
    /** Whether the webview is currently emitting audio. */
    audible?: boolean;
    /** Exact browser registration key that owns a page-authored AiVision signal. */
    registrationKey?: string;
    /** Raw JSON text authored by the page. */
    payload?: string;
}

/** A logged network request/response pair. */
export interface NetworkLogEntry {
    id: number;
    url: string;
    method: string;
    resourceType: string;
    referrer: string;
    timestamp: number;
    requestHeaders: Record<string, string>;
    requestBody?: string;
    statusCode?: number;
    statusLine?: string;
    responseHeaders?: Record<string, string[]>;
    fromCache?: boolean;
    error?: string;
    responseBody?: string;
    responseBodyBase64Encoded?: boolean;
    responseBodyTruncated?: boolean;
}
