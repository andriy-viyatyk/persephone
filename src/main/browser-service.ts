/**
 * Main process browser service.
 *
 * Manages webContents for browser tab webviews. When a renderer registers
 * a webview by its webContentsId, this service attaches event listeners
 * on the actual webContents and relays events back to the renderer via IPC.
 * This provides reliable events (e.g. page-favicon-updated fires consistently)
 * compared to the <webview> DOM element's event API.
 *
 * Registration key is `${tabId}/${internalTabId}` to support multiple
 * internal browser tabs per js-notepad page tab.
 */
import { BrowserWindow, ipcMain, IpcMainEvent, session, webContents, WebContents } from "electron";
import {
    BrowserChannel,
    BrowserRegisterRequest,
    BrowserEvent,
} from "../ipc/browser-ipc";
import { PopupRateLimiter } from "../ipc/popup-rate-limiter";

const BLOCKED_PROTOCOLS = ["file:", "app-asset:", "safe-file:"];

/** Extract a numeric value from a window.open() features string (e.g. "width=500,height=600"). */
function parseFeature(features: string, name: string): number | undefined {
    const match = features.match(new RegExp(`${name}=(\\d+)`));
    return match ? parseInt(match[1], 10) : undefined;
}

interface RegisteredWebview {
    tabId: string;
    internalTabId: string;
    webContents: WebContents;
    senderWebContents: WebContents;
    listeners: Array<{ event: string; handler: (...args: any[]) => void }>;
}

// Active registrations: `${tabId}/${internalTabId}` → registration
const registrations = new Map<string, RegisteredWebview>();

// Rate limiter for popup windows (window.open calls)
const popupRateLimiter = new PopupRateLimiter();

function regKey(tabId: string, internalTabId: string): string {
    return `${tabId}/${internalTabId}`;
}

function sendEvent(
    sender: WebContents,
    tabId: string,
    internalTabId: string,
    type: BrowserEvent["type"],
    data: BrowserEvent["data"],
) {
    try {
        if (!sender.isDestroyed()) {
            const event: BrowserEvent = { tabId, internalTabId, type, data };
            sender.send(BrowserChannel.event, event);
        }
    } catch {
        // Sender may have been destroyed
    }
}

function registerWebview(event: IpcMainEvent, request: BrowserRegisterRequest) {
    const { tabId, internalTabId, webContentsId } = request;
    const key = regKey(tabId, internalTabId);

    // Clean up any previous registration for this key
    unregisterWebview(key);

    const wc = webContents.fromId(webContentsId);
    if (!wc) return;

    const sender = event.sender;
    const listeners: RegisteredWebview["listeners"] = [];

    function on<T extends string>(
        eventName: T,
        handler: (...args: any[]) => void,
    ) {
        wc.on(eventName as any, handler);
        listeners.push({ event: eventName, handler });
    }

    on("did-navigate", (_e: any, url: string) => {
        sendEvent(sender, tabId, internalTabId, "did-navigate", {
            url,
            canGoBack: wc.canGoBack(),
            canGoForward: wc.canGoForward(),
        });
    });

    on("did-navigate-in-page", (_e: any, url: string, isMainFrame: boolean) => {
        if (isMainFrame) {
            sendEvent(sender, tabId, internalTabId, "did-navigate-in-page", {
                url,
                canGoBack: wc.canGoBack(),
                canGoForward: wc.canGoForward(),
                isMainFrame,
            });
        }
    });

    on("page-title-updated", (_e: any, title: string) => {
        sendEvent(sender, tabId, internalTabId, "page-title-updated", {
            title,
        });
    });

    on("page-favicon-updated", (_e: any, favicons: string[]) => {
        if (favicons && favicons.length > 0) {
            sendEvent(sender, tabId, internalTabId, "page-favicon-updated", {
                favicon: favicons[0],
            });
        }
    });

    on("did-start-loading", () => {
        sendEvent(sender, tabId, internalTabId, "did-start-loading", {});
    });

    on("did-stop-loading", () => {
        sendEvent(sender, tabId, internalTabId, "did-stop-loading", {});
    });

    on("audio-state-changed", (e: any) => {
        sendEvent(sender, tabId, internalTabId, "audio-state-changed", {
            audible: e.audible,
        });
    });

    on("did-start-navigation", (_e: any, url: string) => {
        // Block navigation to dangerous protocols
        try {
            const parsed = new URL(url);
            if (BLOCKED_PROTOCOLS.includes(parsed.protocol)) {
                wc.stop();
                sendEvent(
                    sender,
                    tabId,
                    internalTabId,
                    "did-start-navigation",
                    { url, blocked: true },
                );
            }
        } catch {
            // Invalid URL
        }
    });

    // Intercept right-click context menu — relay params to renderer
    on("context-menu", (event: Electron.Event, params: Electron.ContextMenuParams) => {
        event.preventDefault();
        sendEvent(sender, tabId, internalTabId, "context-menu", {
            linkURL: params.linkURL || undefined,
            srcURL: params.srcURL || undefined,
            mediaType: params.mediaType !== "none" ? params.mediaType : undefined,
            selectionText: params.selectionText || undefined,
            isEditable: params.isEditable || undefined,
            editFlags: params.editFlags,
            x: params.x,
            y: params.y,
        });
    });

    // Intercept browser hotkeys before the webview consumes them
    on("before-input-event", (_e: Electron.Event, input: Electron.Input) => {
        if (input.type !== "keyDown") return;
        const keyLower = input.key.toLowerCase();
        if (input.key === "F5" || (keyLower === "r" && input.control)) {
            _e.preventDefault();
            if (input.key === "F5" ? input.control : input.shift) {
                wc.reloadIgnoringCache();
            } else {
                wc.reload();
            }
        } else if (input.key === "F12") {
            _e.preventDefault();
            wc.openDevTools();
        } else if (input.key === "Escape") {
            _e.preventDefault();
            wc.stop();
            sendEvent(sender, tabId, internalTabId, "hide-find-bar", {});
        } else if (keyLower === "f" && input.control) {
            _e.preventDefault();
            sendEvent(sender, tabId, internalTabId, "show-find-bar", {});
        } else if (input.alt && (input.key === "ArrowLeft" || input.key === "ArrowRight")) {
            _e.preventDefault();
            if (input.key === "ArrowLeft") {
                wc.goBack();
            } else {
                wc.goForward();
            }
        }
    });

    // Intercept window.open / target="_blank"
    wc.setWindowOpenHandler(({ url, disposition, features }) => {
        // Link clicks (target="_blank") → open as internal tab
        if (disposition === "foreground-tab" || disposition === "background-tab") {
            sendEvent(sender, tabId, internalTabId, "new-window", {
                url,
                disposition,
            });
            return { action: "deny" };
        }

        // window.open() from JS (OAuth popups, etc.) → allow as real popup window.
        // This preserves window.opener reference needed by auth flows.
        // Rate-limit to prevent popup spam.
        const limiterKey = regKey(tabId, internalTabId);
        if (!popupRateLimiter.isAllowed(tabId) && !popupRateLimiter.check(limiterKey)) {
            sendEvent(sender, tabId, internalTabId, "popups-blocked", { url });
            return { action: "deny" };
        }

        // Center the popup on the parent window.
        const parentWindow = BrowserWindow.fromWebContents(sender);
        const parentBounds = parentWindow?.getBounds();

        const popupWidth = parseFeature(features, "width") || 500;
        const popupHeight = parseFeature(features, "height") || 600;

        const overrideBrowserWindowOptions: Electron.BrowserWindowConstructorOptions = {
            autoHideMenuBar: true,
            width: popupWidth,
            height: popupHeight,
        };

        if (parentBounds) {
            overrideBrowserWindowOptions.x = Math.round(
                parentBounds.x + (parentBounds.width - popupWidth) / 2,
            );
            overrideBrowserWindowOptions.y = Math.round(
                parentBounds.y + (parentBounds.height - popupHeight) / 2,
            );
        }

        return { action: "allow", overrideBrowserWindowOptions };
    });

    // Clean up if the webview's webContents is destroyed
    wc.once("destroyed", () => {
        registrations.delete(key);
    });

    // Clean up if the sender (renderer window) is destroyed
    sender.once("destroyed", () => {
        unregisterWebview(key);
    });

    registrations.set(key, {
        tabId,
        internalTabId,
        webContents: wc,
        senderWebContents: sender,
        listeners,
    });
}

function unregisterWebview(key: string) {
    const reg = registrations.get(key);
    if (!reg) return;

    // Remove all event listeners
    for (const { event: eventName, handler } of reg.listeners) {
        try {
            if (!reg.webContents.isDestroyed()) {
                (reg.webContents as any).removeListener(eventName, handler);
            }
        } catch {
            // webContents may already be destroyed
        }
    }

    registrations.delete(key);
}

/**
 * Initialize browser IPC handlers. Call once during app startup.
 */
export function initBrowserHandlers(): void {
    ipcMain.on(
        BrowserChannel.register,
        (event, request: BrowserRegisterRequest) => {
            registerWebview(event, request);
        },
    );

    ipcMain.on(BrowserChannel.unregister, (_event, key: string) => {
        unregisterWebview(key);
    });

    ipcMain.on(BrowserChannel.setAudioMuted, (_event, key: string, muted: boolean) => {
        const reg = registrations.get(key);
        if (reg && !reg.webContents.isDestroyed()) {
            reg.webContents.setAudioMuted(muted);
        }
    });

    ipcMain.on(BrowserChannel.allowPopups, (_event, tabId: string) => {
        popupRateLimiter.allowByPrefix(tabId);
    });

    ipcMain.handle(BrowserChannel.clearProfileData, async (_event, partition: string) => {
        const ses = session.fromPartition(partition);
        await ses.clearStorageData();
        await ses.clearCache();
    });

    ipcMain.handle(BrowserChannel.clearCache, async (_event, partition: string) => {
        const ses = session.fromPartition(partition);
        await Promise.all([
            ses.clearCache(),
            ses.clearCodeCaches({}),
            ses.clearStorageData({ storages: ["serviceworkers", "cachestorage"] }),
        ]);
    });
}
