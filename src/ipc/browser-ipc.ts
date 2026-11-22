/**
 * IPC channel definitions and types for browser webview management.
 *
 * The renderer creates a <webview> element and registers it with the main
 * process by sending its webContentsId. The main process then attaches
 * reliable event listeners on the actual webContents object and relays
 * supported events back to the renderer.
 */

// IPC channel names
export const BrowserChannel = {
    // Renderer → Main
    register: "browser:register",
    setZoom: "browser:set-zoom",
    unregister: "browser:unregister",
    /** Clear all storage data + cache for a given partition. Returns when done. */
    clearProfileData: "browser:clear-profile-data",
    /** Clear only HTTP cache (not cookies/storage) for a given partition. Returns when done. */
    clearCache: "browser:clear-cache",
    /** Renderer → Main (invoke): list saved permission decisions for a profile. */
    listPermissionDecisions: "browser:list-permission-decisions",
    /** Renderer → Main (invoke): remove one saved site permission decision. */
    removePermissionDecision: "browser:remove-permission-decision",
    /** Renderer → Main (invoke): revoke all saved permissions for a profile. */
    clearPermissionDecisions: "browser:clear-permission-decisions",
    /** Renderer → Main (invoke): resolve an in-tab permission prompt. */
    resolvePermissionRequest: "browser:resolve-permission-request",
    /** Renderer → Main (invoke): read site permissions for a registered browser tab. */
    getSitePermissions: "browser:get-site-permissions",
    /** Renderer → Main (invoke): set a site permission for a registered browser tab. */
    setSitePermission: "browser:set-site-permission",
    /** Renderer → Main (invoke): reset site permissions for a registered browser tab. */
    resetSitePermissions: "browser:reset-site-permissions",
    /** Renderer → Main (invoke): collect full DOM including iframe content. Args: (key: string) */
    collectDom: "browser:collect-dom",
    /** Renderer → Main (invoke): URLs of resources every frame loaded, cache hits included. Args: (key: string) */
    collectLoadedResources: "browser:collect-loaded-resources",
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
    /** Wait for the next download from a registered browser page. */
    waitForDownload: "browser:wait-for-download",
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
    /** Register source for future documents in one browser tab. */
    addInitScript: "browser:add-init-script",
    /** Remove one browser-tab init script by its opaque ID. */
    removeInitScript: "browser:remove-init-script",
    /** Remove all init scripts registered for one browser tab. */
    clearInitScripts: "browser:clear-init-scripts",
    getStorageStateCookies: "browser:get-storage-state-cookies",
    setStorageStateCookies: "browser:set-storage-state-cookies",
    addRequestRoute: "browser:add-request-route",
    removeRequestRoutes: "browser:remove-request-routes",
    /** Renderer → Main (invoke): dispatch keyboard input to a registered app or browser target. */
    cdpSendInputEvent: "browser:cdp-send-input-event",
    /** Renderer → Main: mute/unmute a webview's audio. Args: (key: string, muted: boolean) */
    setAudioMuted: "browser:set-audio-muted",
    /** Renderer → Main: the user's "Allow popups" for one browser tab's current site. Args: (key: string) */
    allowPopups: "browser:allow-popups",
    /** Renderer → Main: the host is about to load/reload/go back/forward in a tab, so a `beforeunload`
     *  confirm can repeat it on "Leave". Args: ({ registrationKey, intent: BrowserNavigationIntent }) */
    navigationIntent: "browser:navigation-intent",
    /** Renderer → Main: hard reload (ignore cache) bypassing the beforeunload guard prompt. Args: (key: string) */
    hardReload: "browser:hard-reload",
    /** Renderer → Main: take a webview out of HTML fullscreen (its page was hidden). Args: (key: string) */
    exitHtmlFullscreen: "browser:exit-html-fullscreen",
    fullscreen: "browser:fullscreen",
    exitFullscreen: "browser:exit-fullscreen",
    closePopup: "browser:close-popup",
    closeOwnedPopups: "browser:close-owned-popups",
    focusPopup: "browser:focus-popup",
    insertPopupText: "browser:insert-popup-text",
    listPopups: "browser:list-popups",

    // Main → Renderer
    event: "browser:event",
} as const;

// Renderer → Main: register a webview
export interface BrowserRegisterRequest {
    tabId: string;
    pageId?: string;
    internalTabId: string;
    webContentsId: number;
    zoomPercent: number;
}

/** A navigation the host or the page asked a browser tab for (see `BrowserUnloadGuard`). */
export type BrowserNavigationIntent =
    | { kind: "load"; url: string }
    | { kind: "reload" }
    | { kind: "back" }
    | { kind: "forward" };

export interface BrowserNavigationIntentRequest {
    registrationKey: string;
    intent: BrowserNavigationIntent;
}

export interface BrowserSetZoomRequest {
    registrationKey: string;
    zoomPercent: number;
}

export interface BrowserPopupSnapshot {
    id: string;
    openerId: string;
    url: string;
    title: string;
    loading: boolean;
}

export interface CdpAttachOptions {
    aiVisionBinding?: boolean;
}

export interface BrowserInitScriptRequest {
    registrationKey: string;
    source: string;
}

export interface BrowserInitScriptRemovalRequest {
    registrationKey: string;
    id: string;
}

export interface BrowserInitScriptTargetRequest {
    registrationKey: string;
}

export type BrowserInitScriptId = string;

export interface BrowserCookie {
    name: string; value: string; url?: string; domain?: string; path?: string; expires?: number;
    httpOnly?: boolean; secure?: boolean; sameSite?: "Strict" | "Lax" | "None";
    priority?: "Low" | "Medium" | "High"; sameParty?: boolean;
    sourceScheme?: "Unset" | "NonSecure" | "Secure"; sourcePort?: number;
    size?: number; session?: boolean; partitionKey?: { topLevelSite: string; hasCrossSiteAncestor?: boolean }; partitionKeyOpaque?: boolean;
}
export interface BrowserStorageCookiesRequest { registrationKey: string; urls: string[]; }
export interface BrowserSetStorageCookiesRequest { registrationKey: string; cookies: BrowserCookie[]; }
export interface BrowserDownloadWaitOptions { timeout?: number; }
export interface BrowserDownloadWaitRequest { registrationKey: string; options?: BrowserDownloadWaitOptions; }
export interface BrowserDownloadResult { suggestedFilename: string; path: string; size: number; }

export type BrowserRoutePattern = string | BrowserResponsePattern;
export type BrowserRouteAbortReason =
    | "Failed" | "Aborted" | "TimedOut" | "AccessDenied" | "ConnectionClosed"
    | "ConnectionReset" | "ConnectionRefused" | "ConnectionAborted" | "ConnectionFailed"
    | "NameNotResolved" | "InternetDisconnected" | "AddressUnreachable"
    | "BlockedByClient" | "BlockedByResponse";
export interface BrowserRouteResponse {
    status?: number;
    body?: string;
    bodyBase64?: string;
    headers?: Record<string, string>;
    contentType?: string;
    delayMs?: number;
}
export type BrowserRouteAction = "abort" | { abort: BrowserRouteAbortReason } | BrowserRouteResponse;
export interface BrowserRouteOptions { times?: number; method?: string | string[]; resourceTypes?: string[]; }
export interface BrowserRouteRequest {
    registrationKey: string;
    pattern: BrowserRoutePattern;
    response: BrowserRouteAction;
    options?: BrowserRouteOptions;
}
export interface BrowserRouteRemovalRequest { registrationKey: string; pattern?: BrowserRoutePattern; }

export interface BrowserKeyboardInputEvent {
    type: "keyDown" | "keyUp";
    keyCode: string;
    modifiers?: Array<"control" | "alt" | "shift" | "meta">;
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
    | "zoom-intent"
    | "did-navigate"
    | "did-navigate-in-page"
    | "did-start-loading"
    | "did-stop-loading"
    | "did-start-navigation"
    | "new-window"
    | "scheme-handoff"
    | "context-menu"
    | "audio-state-changed"
    | "popups-blocked"
    | "permission-request"
    | "ai-vision-signal"
    | "popup-opened"
    | "popup-changed"
    | "popup-closed";

export type BrowserPermissionKey =
    | "camera" | "microphone" | "geolocation" | "notifications" | "midi" | "midiSysex"
    | "clipboard-read" | "idle-detection" | "window-management" | "speaker-selection" | "openExternal";

export type BrowserSitePermissionKey = Exclude<BrowserPermissionKey, "openExternal"> | `openExternal:${string}`;
export interface BrowserSitePermissionEntry {
    key: BrowserSitePermissionKey;
    decision: "allow" | "block" | undefined;
}
export interface BrowserSitePermissions {
    origin: string;
    entries: BrowserSitePermissionEntry[];
}
export interface BrowserSitePermissionRegistrationRequest {
    registrationKey: string;
}
export interface SetBrowserSitePermissionRequest extends BrowserSitePermissionRegistrationRequest {
    key: BrowserSitePermissionKey;
    decision: "allow" | "block";
}

/** A File System Access request: the picked file or folder and the access the page asks for. */
export interface BrowserFileAccessPrompt {
    path: string;
    access: "read" | "write";
    isDirectory: boolean;
}

export interface BrowserPermissionPromptData {
    requestId: string;
    /** The origin the decision applies to — always the tab's top-level origin. */
    topLevelOrigin: string;
    permissions: BrowserPermissionKey[];
    externalScheme?: string;
    /** Set for a File System Access prompt (then `permissions` is empty); answered once, never remembered. */
    fileAccess?: BrowserFileAccessPrompt;
}

export interface BrowserEventData {
    zoomIntent?: "in" | "out" | "reset";
    url?: string;
    canGoBack?: boolean;
    canGoForward?: boolean;
    isMainFrame?: boolean;
    isSameDocument?: boolean;
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
    executionContextId?: number;
    mainContext?: boolean;
    permissionRequest?: BrowserPermissionPromptData;
    popup?: BrowserPopupSnapshot;
}

export interface BrowserPermissionDecisionEntry {
    origin: string;
    permission: string;
    decision: "allow" | "block";
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
