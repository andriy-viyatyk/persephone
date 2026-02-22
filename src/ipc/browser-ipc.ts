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
    /** Renderer → Main: mute/unmute a webview's audio. Args: (key: string, muted: boolean) */
    setAudioMuted: "browser:set-audio-muted",

    // Main → Renderer
    event: "browser:event",
} as const;

// Renderer → Main: register a webview
export interface BrowserRegisterRequest {
    tabId: string;
    internalTabId: string;
    webContentsId: number;
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
    | "audio-state-changed";

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
}
