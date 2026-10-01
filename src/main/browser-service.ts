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
 * internal browser tabs per persephone page tab.
 */
import { app, BrowserWindow, dialog, IpcMainEvent, IpcMainInvokeEvent, session, webContents, WebContents, WebFrameMain } from "electron";
import * as cheerio from "cheerio";
import {
    BrowserChannel,
    BrowserRegisterRequest,
    BrowserSitePermissionRegistrationRequest,
    SetBrowserSitePermissionRequest,
    BrowserSitePermissions,
    BrowserEvent,
} from "../ipc/browser-ipc";
import { EventEndpoint } from "../ipc/api-types";
import { globalPopupRateLimiter } from "../ipc/popup-rate-limiter";
import { initNetworkLogger, setWebContentsResolver, clearNetworkLog } from "./network-logger";
import { clearCdpTargetState, initCdpHandlers } from "./cdp-service";
import { withNativeDialogSync } from "./native-dialog-tracker";
import { appPartition, fileAccessPersistPartition } from "./constants";
import { clearProfilePermissionDecisions, getSitePermissionEntries, hasSavedProfilePermissionDecisions, listProfilePermissionDecisions, removeProfilePermissionDecision, resetSitePermissionDecisions, resolvePermissionRequest, setPermissionPromptHandler, setSitePermissionDecision, settlePermissionRequestsForWebContents } from "./permission-policy-service";
import { guardedIpcHandle, guardedIpcOn } from "./ipc-sender-guard";

const BLOCKED_PROTOCOLS = ["file:", "app-asset:"];
const CHROMIUM_NAVIGATION_PROTOCOLS = [
    "http:",
    "https:",
    "about:",
    "blob:",
    "mailto:",
    "tel:",
];

/** Chromium's transient user activation lasts 5 s. A page navigation to a non-web scheme
 *  is passed to the host only within this window after a real click or key press. */
const USER_ACTIVATION_WINDOW_MS = 5000;

type NavigationScheme = "blocked" | "chromium" | "external" | "invalid";

function getNavigationScheme(url: string): NavigationScheme {
    try {
        const protocol = new URL(url).protocol;
        if (BLOCKED_PROTOCOLS.includes(protocol)) return "blocked";
        if (CHROMIUM_NAVIGATION_PROTOCOLS.includes(protocol)) return "chromium";
        return "external";
    } catch {
        return "invalid";
    }
}

function attachPopupNavigationGuards(contents: WebContents): void {
    const popupEvents = contents as unknown as EventTarget;
    popupEvents.on("will-navigate", ((event: Electron.Event, url: string) => {
        if (getNavigationScheme(url) !== "chromium") event.preventDefault();
    }) as AnyEventHandler);
    popupEvents.on("will-redirect", ((event: Electron.Event, details: Electron.WebContentsWillRedirectEventParams) => {
        if (getNavigationScheme(details.url) === "blocked") event.preventDefault();
    }) as AnyEventHandler);
    popupEvents.on("will-frame-navigate", ((details: Electron.Event & Electron.WebContentsWillFrameNavigateEventParams) => {
        // The main frame is handled by will-navigate.
        if (!details.isMainFrame && getNavigationScheme(details.url) === "blocked") details.preventDefault();
    }) as AnyEventHandler);
}

function destroyPopupWithNodeIntegration(childWindow: BrowserWindow, details: Electron.DidCreateWindowDetails): boolean {
    const preferences = details.options.webPreferences;
    if (!preferences?.nodeIntegration && !preferences?.nodeIntegrationInSubFrames) return false;

    console.warn("[browser] Destroying popup with Node integration enabled");
    childWindow.destroy();
    return true;
}

function isPersistentBrowserProfilePartition(partition: unknown): partition is string {
    return typeof partition === "string"
        && partition.startsWith("persist:browser-")
        && partition.length > "persist:browser-".length
        && partition.length <= 256;
}

/** Generic event-listener shape — used for storing handlers we attach to
 *  WebContents. WebContents extends EventEmitter; this matches that surface
 *  while letting us bypass Electron's per-event overloaded `on()` types. */
type AnyEventHandler = (...args: unknown[]) => void;
interface EventTarget {
    on(event: string, handler: AnyEventHandler): void;
    removeListener(event: string, handler: AnyEventHandler): void;
}

// Track sessions whose User-Agent has already been cleaned
const cleanedSessions = new WeakSet<Electron.Session>();

/**
 * The User-Agent Chrome itself would send: "persephone/x.x.x" and "Electron/x.x.x" removed,
 * and the version reduced to "Chrome/<major>.0.0.0" (Chrome's User-Agent reduction).
 */
function toChromeUserAgent(ua: string): string {
    return ua
        .replace(/\s*persephone\/\S+/i, "")
        .replace(/\s*Electron\/\S+/i, "")
        .replace(/Chrome\/(\d+)\.[\d.]+/, "Chrome/$1.0.0.0");
}

/**
 * Give a browser session the Chrome User-Agent.
 *
 * This covers the top frame only: a cross-origin iframe runs in its own renderer process and
 * reads `app.userAgentFallback` instead, so `initBrowserUserAgent()` must clean that too. A page
 * whose iframes still say "Electron" fails Cloudflare's challenge endlessly (US-1584).
 */
function cleanUserAgent(ses: Electron.Session): void {
    if (cleanedSessions.has(ses)) return;
    cleanedSessions.add(ses);
    ses.setUserAgent(toChromeUserAgent(ses.getUserAgent()));
}

/**
 * Make the process-wide fallback User-Agent the Chrome one, so every frame of a browser page
 * (including cross-origin iframes such as Cloudflare's challenge) reports the same identity.
 * Must run before any renderer process starts.
 */
export function initBrowserUserAgent(): void {
    app.userAgentFallback = toChromeUserAgent(app.userAgentFallback);
}

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
    listeners: Array<{ event: string; handler: AnyEventHandler }>;
    /** One-shot: when true, the next will-prevent-unload is allowed without a
     *  confirmation prompt. Armed by a hard reload (Ctrl+F5 / Ctrl+Shift+R from
     *  either keyboard path), consumed by the will-prevent-unload handler, and
     *  cleared defensively on did-stop-loading so it can never leak to a later
     *  reload if no prompt was triggered. */
    bypassUnloadGuard: boolean;
    /** The page is in HTML fullscreen (a video's fullscreen button), which also made the
     *  host window fullscreen. */
    htmlFullscreen: boolean;
    /** A mouse button pressed in the page and not yet released (see releaseLostPress). */
    pressed: { x: number; y: number; button: "left" | "middle" | "right" } | null;
    /** Time (Date.now()) of the last trusted mouse or key press in the page; 0 = none or consumed. */
    lastUserActivation: number;
}

// Active registrations: `${tabId}/${internalTabId}` → registration
const registrations = new Map<string, RegisteredWebview>();

/** True only for a Browser editor guest that was registered by the renderer. */
export function isRegisteredBrowserWebContents(contents: WebContents): boolean {
    for (const registration of registrations.values()) {
        if (registration.webContents === contents) return true;
    }
    return false;
}

// Track senders that already have a "destroyed" listener to avoid stacking
const watchedSenders = new WeakSet<WebContents>();

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

function sendHostEvent(sender: WebContents, endpoint: EventEndpoint, data: string): void {
    try {
        if (!sender.isDestroyed()) {
            sender.send(endpoint, data);
        }
    } catch {
        // The host renderer may be destroyed before the webview is disposed.
    }
}

/**
 * Take the host window out of fullscreen once no webview of it is in HTML fullscreen.
 * Electron makes the whole window fullscreen for a guest's fullscreen request; when the guest
 * goes away or ignores an exit request, nothing else would ever restore the window.
 */
function releaseWindowFullscreen(sender: WebContents): void {
    if (sender.isDestroyed()) return;
    for (const reg of registrations.values()) {
        if (reg.senderWebContents === sender && reg.htmlFullscreen) return;
    }
    const win = BrowserWindow.fromWebContents(sender);
    if (win && !win.isDestroyed() && win.isFullScreen()) win.setFullScreen(false);
}

/**
 * Complete a press whose mouse-up the page never received. When a press in the page opens a
 * popup or a new tab (an ad script on a video's seek bar) or moves focus away, the release lands
 * elsewhere. The page then believes the button is still held — a video player
 * stays in "dragging the seek bar" and ignores clicks — and Chromium keeps routing the mouse to
 * that page, so even the browser toolbar stops responding until the user clicks inside the page
 * again. Sending the missing mouse-up where the pointer last was ends both.
 */
function releaseLostPress(reg: RegisteredWebview, reason: string): void {
    const press = reg.pressed;
    if (!press || reg.webContents.isDestroyed()) return;
    reg.pressed = null;
    console.log(`[browser] released a mouse press lost to ${reason} (${reg.tabId}/${reg.internalTabId})`);
    reg.webContents.sendInputEvent({ type: "mouseUp", x: press.x, y: press.y, button: press.button, clickCount: 1 });
}

/** Ask a fullscreen page to leave fullscreen; force the window out if it does not. */
function exitHtmlFullscreen(key: string): void {
    const reg = registrations.get(key);
    if (!reg?.htmlFullscreen || reg.webContents.isDestroyed()) return;
    const { webContents: wc, senderWebContents: sender } = reg;
    wc.executeJavaScript("document.fullscreenElement ? document.exitFullscreen() : undefined", true)
        .catch((): void => undefined);
    setTimeout(() => {
        const current = registrations.get(key);
        if (current?.webContents === wc) {
            if (!current.htmlFullscreen) return;
            current.htmlFullscreen = false;
        }
        releaseWindowFullscreen(sender);
    }, 1000);
}

/**
 * Guard a popup window opened by a webview. Blocks popups from the child
 * until the user has explicitly focused (activated) the window. This prevents
 * cascade attacks where each popup opens the next without user interaction.
 * Applied recursively to any grandchild windows.
 */
function guardPopupWindow(
    childWindow: BrowserWindow,
    sender: WebContents,
    tabId: string,
    internalTabId: string,
) {
    let userActivated = false;

    // Mark as activated when the user focuses the window
    childWindow.once("focus", () => {
        userActivated = true;
    });

    const childWc = childWindow.webContents;
    attachPopupNavigationGuards(childWc);

    childWc.setWindowOpenHandler(({ url, disposition, features }) => {
        // Link clicks → open as internal tab in the parent page
        if (disposition === "foreground-tab" || disposition === "background-tab") {
            sendEvent(sender, tabId, internalTabId, "new-window", {
                url,
                disposition,
            });
            return { action: "deny" };
        }

        // Block popups from windows the user hasn't activated
        if (!userActivated) {
            sendEvent(sender, tabId, internalTabId, "popups-blocked", { url });
            return { action: "deny" };
        }

        // User-activated window: apply global rate limiting
        if (!globalPopupRateLimiter.isAllowed("popups") && !globalPopupRateLimiter.check("popups")) {
            sendEvent(sender, tabId, internalTabId, "popups-blocked", { url });
            return { action: "deny" };
        }

        // Center on the child window
        const parentBounds = childWindow.getBounds();
        const popupWidth = parseFeature(features, "width") || 500;
        const popupHeight = parseFeature(features, "height") || 600;

        return {
            action: "allow",
            overrideBrowserWindowOptions: {
                autoHideMenuBar: true,
                width: popupWidth,
                height: popupHeight,
                x: Math.round(parentBounds.x + (parentBounds.width - popupWidth) / 2),
                y: Math.round(parentBounds.y + (parentBounds.height - popupHeight) / 2),
            },
        };
    });

    // Recursively guard grandchild windows
    childWc.on("did-create-window", (grandchild, details) => {
        if (destroyPopupWithNodeIntegration(grandchild, details)) return;
        guardPopupWindow(grandchild, sender, tabId, internalTabId);
    });
}

function registerWebview(event: IpcMainEvent, request: BrowserRegisterRequest) {
    const { tabId, internalTabId, webContentsId } = request;
    const key = regKey(tabId, internalTabId);

    // Clean up any previous registration for this key. This re-runs on every dom-ready, so a
    // re-registration of the SAME webContents keeps its CDP state: pending navigation waits
    // (which this very load is about to satisfy), page-event buffers and the dialog policy.
    const previous = registrations.get(key);
    unregisterWebview(key, { keepCdpState: previous?.webContents.id === webContentsId });

    const wc = webContents.fromId(webContentsId);
    if (!wc) return;

    const sender = event.sender;
    const listeners: RegisteredWebview["listeners"] = [];

    const wcEvents = wc as unknown as EventTarget;
    function on<T extends string>(
        eventName: T,
        handler: AnyEventHandler,
    ) {
        wcEvents.on(eventName, handler);
        listeners.push({ event: eventName, handler });
    }

    on("did-navigate", (_e: Electron.Event, url: string) => {
        sendEvent(sender, tabId, internalTabId, "did-navigate", {
            url,
            canGoBack: wc.canGoBack(),
            canGoForward: wc.canGoForward(),
        });
    });

    on("did-navigate-in-page", (_e: Electron.Event, url: string, isMainFrame: boolean) => {
        if (isMainFrame) {
            sendEvent(sender, tabId, internalTabId, "did-navigate-in-page", {
                url,
                canGoBack: wc.canGoBack(),
                canGoForward: wc.canGoForward(),
                isMainFrame,
            });
        }
    });

    on("did-start-navigation", (_e: Electron.Event, url: string, _inPlace: boolean, isMainFrame: boolean) => {
        if (isMainFrame) {
            settlePermissionRequestsForWebContents(wc);
            sendEvent(sender, tabId, internalTabId, "did-start-navigation", { url, isMainFrame });
        }
    });

    on("page-title-updated", (_e: Electron.Event, title: string) => {
        sendEvent(sender, tabId, internalTabId, "page-title-updated", {
            title,
        });
    });

    on("page-favicon-updated", (_e: Electron.Event, favicons: string[]) => {
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
        // Defensive: clear a hard-reload bypass that was set but never consumed
        // (e.g. the page had no beforeunload guard, so no prompt fired).
        const reg = registrations.get(key);
        if (reg) reg.bypassUnloadGuard = false;
        sendEvent(sender, tabId, internalTabId, "did-stop-loading", {});
    });

    // A page with a beforeunload handler (e.g. an unsaved-changes guard) tries
    // to cancel reloads/navigations. Electron's default is to SILENTLY cancel
    // the unload — no prompt, no reload — which makes Reload/F5 appear dead.
    // Surface a confirmation instead: "Leave" allows the unload (reload
    // proceeds), "Cancel" keeps the page. A hard reload (Ctrl+F5 /
    // Ctrl+Shift+R) arms bypassUnloadGuard to skip the prompt and force through.
    on("will-prevent-unload", (event: Electron.Event) => {
        const reg = registrations.get(key);
        if (reg?.bypassUnloadGuard) {
            reg.bypassUnloadGuard = false;
            event.preventDefault(); // allow unload — reload without prompting
            return;
        }
        const parentWindow = BrowserWindow.fromWebContents(sender);
        const options: Electron.MessageBoxSyncOptions = {
            type: "question",
            buttons: ["Leave", "Cancel"],
            defaultId: 1,
            cancelId: 1,
            title: "Unsaved changes",
            message: "You have unsaved changes. Leave the page and discard them?",
        };
        const choice = withNativeDialogSync(parentWindow, "messageBox", () => parentWindow
            ? dialog.showMessageBoxSync(parentWindow, options)
            : dialog.showMessageBoxSync(options));
        if (choice === 0) {
            event.preventDefault(); // user chose Leave — allow the unload/reload
        }
    });

    on("enter-html-full-screen", () => {
        const reg = registrations.get(key);
        if (reg) reg.htmlFullscreen = true;
    });

    on("leave-html-full-screen", () => {
        const reg = registrations.get(key);
        if (reg) reg.htmlFullscreen = false;
    });

    // Track the page's button state so a press whose release went elsewhere can be completed.
    on("before-mouse-event", (_e: Electron.Event, mouse: Electron.MouseInputEvent) => {
        const reg = registrations.get(key);
        if (!reg) return;
        if (mouse.type === "mouseDown") {
            reg.lastUserActivation = Date.now();
            reg.pressed = { x: mouse.x, y: mouse.y, button: mouse.button ?? "left" };
        } else if (mouse.type === "mouseUp") {
            reg.lastUserActivation = Date.now();
            reg.pressed = null;
        } else if (mouse.type === "mouseMove" && reg.pressed) {
            reg.pressed.x = mouse.x;
            reg.pressed.y = mouse.y;
        }
    });

    on("blur", () => {
        const reg = registrations.get(key);
        if (reg) releaseLostPress(reg, "focus loss");
    });

    on("audio-state-changed", (e: Electron.Event & { audible: boolean }) => {
        sendEvent(sender, tabId, internalTabId, "audio-state-changed", {
            audible: e.audible,
        });
    });

    // Non-web schemes reach the host only after a user action; the host opens only board-claimed ones.
    // will-navigate fires only for navigations triggered by the page
    // (links, window.location, forms) — NOT for programmatic loadURL().
    // This allows app-initiated file:// navigations (MCP, restore) while
    // blocking third-party sites from redirecting to local files.
    on("will-navigate", (event: Electron.Event, url: string) => {
        try {
            const scheme = getNavigationScheme(url);
            if (scheme === "invalid") return;
            if (scheme === "blocked") {
                event.preventDefault();
                sendEvent(
                    sender,
                    tabId,
                    internalTabId,
                    "did-start-navigation",
                    { url, blocked: true },
                );
                return;
            }
            if (scheme === "external") {
                event.preventDefault();
                const reg = registrations.get(key);
                // Consume the activation: one user action hands over at most one URL.
                const activated = !!reg && Date.now() - reg.lastUserActivation <= USER_ACTIVATION_WINDOW_MS;
                if (reg) reg.lastUserActivation = 0;
                if (activated) sendHostEvent(sender, EventEndpoint.eOpenPipelineCandidate, url);
            }
        } catch {
            // Invalid URL
        }
    });

    on("will-redirect", (event: Electron.Event, details: Electron.WebContentsWillRedirectEventParams) => {
        if (getNavigationScheme(details.url) === "blocked") event.preventDefault();
    });

    on("will-frame-navigate", (details: Electron.Event & Electron.WebContentsWillFrameNavigateEventParams) => {
        // The main frame is handled by will-navigate.
        if (!details.isMainFrame && getNavigationScheme(details.url) === "blocked") details.preventDefault();
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

    // Intercept browser hotkeys before the webview consumes them.
    //
    // Ctrl+F and Escape are deliberately NOT handled here (US-1284). This hook
    // fires *before* the key is dispatched to the guest page, so
    // `preventDefault()` means the page's own DOM never sees the keydown — a
    // page with its own find UI, or one that closes its popover on Escape,
    // could never claim the key, unlike in Chrome or Edge. The decision needs
    // the outcome of the page's handlers, which only exists after dispatch, so
    // it lives in `preload-webview.ts` instead.
    on("before-input-event", (_e: Electron.Event, input: Electron.Input) => {
        if (input.type !== "keyDown") return;
        const reg = registrations.get(key);
        if (reg) reg.lastUserActivation = Date.now();
        // Escape leaves a page's HTML fullscreen, as in Chrome. Electron does not do it for a
        // webview guest, which left a fullscreen video with no keyboard way out.
        if (input.key === "Escape" && registrations.get(key)?.htmlFullscreen) {
            _e.preventDefault();
            exitHtmlFullscreen(key);
            return;
        }
        const keyLower = input.key.toLowerCase();
        if (input.key === "F5" || (keyLower === "r" && input.control)) {
            _e.preventDefault();
            if (input.key === "F5" ? input.control : input.shift) {
                // Hard reload (Ctrl+F5 / Ctrl+Shift+R): force through any
                // beforeunload guard without prompting.
                const reg = registrations.get(key);
                if (reg) reg.bypassUnloadGuard = true;
                wc.reloadIgnoringCache();
            } else {
                wc.reload();
            }
        } else if (input.key === "F12") {
            _e.preventDefault();
            wc.openDevTools();
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
            const reg = registrations.get(key);
            if (reg) releaseLostPress(reg, "a new tab");
            sendEvent(sender, tabId, internalTabId, "new-window", {
                url,
                disposition,
            });
            return { action: "deny" };
        }

        // window.open() from JS (OAuth popups, etc.) → allow as real popup window.
        // This preserves window.opener reference needed by auth flows.
        // Rate-limit to prevent popup spam.
        if (!globalPopupRateLimiter.isAllowed("popups") && !globalPopupRateLimiter.check("popups")) {
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

    // Block popup chains: child popup windows cannot open more popups
    // unless the user has activated (focused) them first.
    // Must go through on() — registerWebview re-runs on every dom-ready, and
    // only tracked listeners are removed by the unregisterWebview() above.
    on("did-create-window", (childWindow: BrowserWindow, details: Electron.DidCreateWindowDetails) => {
        if (destroyPopupWithNodeIntegration(childWindow, details)) return;
        const reg = registrations.get(key);
        if (reg) releaseLostPress(reg, "a popup window");
        guardPopupWindow(childWindow, sender, tabId, internalTabId);
    });

    // Clean up if the webview's webContents is destroyed
    on("destroyed", () => {
        settlePermissionRequestsForWebContents(wc);
        unregisterWebview(key);
    });

    // Clean up all registrations for this sender when the renderer window is destroyed.
    // Only attach one listener per sender to avoid exceeding MaxListeners.
    if (!watchedSenders.has(sender)) {
        watchedSenders.add(sender);
        // The window losing focus mid-press (a popup, another app) loses the release too.
        BrowserWindow.fromWebContents(sender)?.on("blur", () => {
            for (const reg of registrations.values()) {
                if (reg.senderWebContents === sender) releaseLostPress(reg, "window focus loss");
            }
        });
        sender.once("destroyed", () => {
            for (const [k, reg] of registrations) {
                if (reg.senderWebContents === sender) {
                    unregisterWebview(k);
                }
            }
        });
    }

    registrations.set(key, {
        tabId,
        internalTabId,
        webContents: wc,
        senderWebContents: sender,
        listeners,
        bypassUnloadGuard: false,
        htmlFullscreen: false,
        pressed: null,
        lastUserActivation: 0,
    });
}

function unregisterWebview(key: string, options: { keepCdpState?: boolean } = {}) {
    const reg = registrations.get(key);
    if (!reg) return;
    settlePermissionRequestsForWebContents(reg.webContents);

    // Remove all event listeners
    for (const { event: eventName, handler } of reg.listeners) {
        try {
            if (!reg.webContents.isDestroyed()) {
                (reg.webContents as unknown as EventTarget).removeListener(eventName, handler);
            }
        } catch {
            // webContents may already be destroyed
        }
    }

    registrations.delete(key);
    // A tab closed while its video is fullscreen would leave the window fullscreen for good.
    if (reg.htmlFullscreen) releaseWindowFullscreen(reg.senderWebContents);
    if (!options.keepCdpState) {
        clearNetworkLog(key);
        clearCdpTargetState(key);
    }
}

// =====================================================================
// DOM Collection (View Actual DOM — includes iframe content)
// =====================================================================

/** Compare two URLs ignoring protocol, trailing slashes, and fragment. */
function urlsMatch(a: string, b: string): boolean {
    try {
        const urlA = new URL(a, "http://base");
        const urlB = new URL(b, "http://base");
        const normalize = (u: URL) =>
            (u.hostname + u.pathname).replace(/\/+$/, "") + u.search;
        return normalize(urlA) === normalize(urlB);
    } catch {
        return false;
    }
}

interface FrameResult {
    url: string;
    name: string;
    html: string;
}

/** Inject iframe DOM content inside an <iframe> element. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function injectIframeContent($: cheerio.CheerioAPI, el: any, result: FrameResult) {
    const $el = $(el);
    const comment = `<!-- IFRAME DOM: src="${result.url}"${result.name ? ` name="${result.name}"` : ""} -->`;
    $el.attr("data-dom-injected", "true");
    $el.html(comment + "\n" + result.html);
}

/**
 * Collect the full DOM from a registered webview, including all iframe content.
 * Uses Electron's WebFrameMain API to iterate all frames in the subtree and
 * cheerio to inject each iframe's DOM into the corresponding <iframe> element.
 */
async function collectDom(key: string): Promise<string> {
    const reg = registrations.get(key);
    if (!reg || reg.webContents.isDestroyed()) return "";

    const mainFrame = reg.webContents.mainFrame;

    // Collect DOM from main frame
    const mainHtml = await mainFrame.executeJavaScript(
        "document.documentElement.outerHTML",
    ) as string;

    // Collect DOM from all child frames
    const childFrames = mainFrame.framesInSubtree.filter(
        (f: WebFrameMain) => f !== mainFrame,
    );
    if (childFrames.length === 0) return mainHtml;

    // Collect each frame's DOM
    const frameResults: FrameResult[] = [];
    for (const frame of childFrames) {
        try {
            const frameHtml = await frame.executeJavaScript(
                "document.documentElement.outerHTML",
            ) as string;
            frameResults.push({
                url: frame.url || "",
                name: frame.name || "",
                html: frameHtml,
            });
        } catch {
            // Frame may have been destroyed or navigated away — skip
        }
    }

    if (frameResults.length === 0) return mainHtml;

    // Use cheerio to find <iframe> elements and inject content
    const $ = cheerio.load(mainHtml, { xml: false });
    const unmatched: FrameResult[] = [];

    for (const result of frameResults) {
        let matched = false;

        // Try to match by src attribute
        if (result.url && result.url !== "about:blank") {
            $("iframe").each((_i, el) => {
                if (matched) return;
                const src = $(el).attr("src") || "";
                if (
                    src &&
                    !$(el).attr("data-dom-injected") &&
                    (result.url.includes(src) ||
                        src.includes(result.url) ||
                        urlsMatch(src, result.url))
                ) {
                    injectIframeContent($, el, result);
                    matched = true;
                    return false; // break .each()
                }
            });
        }

        // Try to match by name attribute
        if (!matched && result.name) {
            $("iframe").each((_i, el) => {
                if (matched) return;
                const name = $(el).attr("name") || "";
                if (name && name === result.name && !$(el).attr("data-dom-injected")) {
                    injectIframeContent($, el, result);
                    matched = true;
                    return false;
                }
            });
        }

        if (!matched) {
            unmatched.push(result);
        }
    }

    // For unmatched frames, try matching by index order
    if (unmatched.length > 0) {
        const emptyIframes = $("iframe").filter((_i, el) => {
            return !$(el).attr("data-dom-injected");
        });

        for (let i = 0; i < unmatched.length && i < emptyIframes.length; i++) {
            injectIframeContent($, emptyIframes[i], unmatched[i]);
        }

        // Any remaining unmatched frames: append at end of body
        for (let i = emptyIframes.length; i < unmatched.length; i++) {
            const result = unmatched[i];
            const comment = `<!-- UNMATCHED IFRAME: src="${result.url}"${result.name ? ` name="${result.name}"` : ""} -->`;
            $("body").append("\n" + comment + "\n" + result.html + "\n");
        }
    }

    return $.html();
}

/**
 * Initialize browser IPC handlers. Call once during app startup.
 */
export function initBrowserHandlers(): void {
    // Clean User-Agent for every browser partition session as soon as it's created.
    // This must happen before any request is made, so we hook session-created
    // rather than waiting for webview registration.
    app.on("session-created", (ses) => {
        cleanUserAgent(ses);
    });

    setPermissionPromptHandler((contents, permissionRequest) => {
        for (const registration of registrations.values()) {
            if (registration.webContents !== contents || contents.isDestroyed()) continue;
            sendEvent(registration.senderWebContents, registration.tabId, registration.internalTabId,
                "permission-request", { permissionRequest });
            return true;
        }
        return false;
    });

    const ownedRegistration = (event: IpcMainInvokeEvent, key: unknown): RegisteredWebview | undefined => {
        if (typeof key !== "string" || key.length > 240) return undefined;
        const registration = registrations.get(key);
        if (!registration || registration.senderWebContents !== event.sender
            || registration.webContents.isDestroyed()) return undefined;
        return registration;
    };
    const isBrowserPermissionSession = (registration: RegisteredWebview): boolean =>
        registration.webContents.session !== session.fromPartition(appPartition)
        && registration.webContents.session !== session.fromPartition(fileAccessPersistPartition);

    guardedIpcHandle(BrowserChannel.getSitePermissions, (event, request: BrowserSitePermissionRegistrationRequest): BrowserSitePermissions => {
        const empty: BrowserSitePermissions = { origin: "", entries: [] };
        const registration = ownedRegistration(event, request?.registrationKey);
        if (!registration || !isBrowserPermissionSession(registration)) return empty;
        const origin = registration.webContents.getURL();
        try {
            const parsed = new URL(origin);
            if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return empty;
            return { origin: parsed.origin, entries: getSitePermissionEntries(registration.webContents.session, origin) };
        } catch { return empty; }
    });

    guardedIpcHandle(BrowserChannel.setSitePermission, (event, request: SetBrowserSitePermissionRequest): boolean => {
        if (!request || typeof request !== "object") return false;
        const registration = ownedRegistration(event, request.registrationKey);
        if (!registration || !isBrowserPermissionSession(registration) || typeof request.key !== "string"
            || (request.decision !== "allow" && request.decision !== "block")) return false;
        return setSitePermissionDecision(registration.webContents.session, registration.webContents.getURL(), request.key, request.decision);
    });

    guardedIpcHandle(BrowserChannel.resetSitePermissions, (event, request: BrowserSitePermissionRegistrationRequest): boolean => {
        const registration = ownedRegistration(event, request?.registrationKey);
        if (!registration || !isBrowserPermissionSession(registration)) return false;
        return resetSitePermissionDecisions(registration.webContents.session, registration.webContents.getURL());
    });

    guardedIpcHandle(BrowserChannel.resolvePermissionRequest, (event, request: { requestId: string; decision: "allow" | "block" }) => {
        if (!request || typeof request.requestId !== "string"
            || (request.decision !== "allow" && request.decision !== "block")) return false;
        return resolvePermissionRequest(request.requestId, request.decision);
    });

    const validProfileName = (name: unknown): name is string => typeof name === "string"
        && name.trim().length > 0 && name.length <= 80 && !/[\\/]/.test(name)
        && !Array.from(name).some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);
    guardedIpcHandle(BrowserChannel.listPermissionDecisions, (_event, profileName: string) => {
        if (!validProfileName(profileName)) return [];
        if (profileName !== "default" && !hasSavedProfilePermissionDecisions(profileName)) return [];
        return listProfilePermissionDecisions(profileName);
    });
    guardedIpcHandle(BrowserChannel.removePermissionDecision, (_event, request: { profileName: string; origin: string; permission: string }) => {
        if (!request || !validProfileName(request.profileName)
            || typeof request.origin !== "string" || typeof request.permission !== "string") return false;
        if (!hasSavedProfilePermissionDecisions(request.profileName)) return false;
        removeProfilePermissionDecision(request.profileName, request.origin, request.permission);
        return true;
    });
    guardedIpcHandle(BrowserChannel.clearPermissionDecisions, (_event, profileName: string) => {
        if (!validProfileName(profileName)) return false;
        if (!hasSavedProfilePermissionDecisions(profileName)) return false;
        clearProfilePermissionDecisions(profileName);
        return true;
    });

    guardedIpcOn(
        BrowserChannel.register,
        (event, request: BrowserRegisterRequest) => {
            registerWebview(event, request);
        },
    );

    guardedIpcOn(BrowserChannel.unregister, (_event, key: string) => {
        unregisterWebview(key);
    });

    guardedIpcOn(BrowserChannel.setAudioMuted, (_event, key: string, muted: boolean) => {
        const reg = registrations.get(key);
        if (reg && !reg.webContents.isDestroyed()) {
            reg.webContents.setAudioMuted(muted);
        }
    });

    guardedIpcOn(BrowserChannel.exitHtmlFullscreen, (_event, key: string) => {
        exitHtmlFullscreen(key);
    });

    guardedIpcOn(BrowserChannel.allowPopups, () => {
        globalPopupRateLimiter.allow("popups");
    });

    // Hard reload routed from the renderer (Ctrl+F5 / Ctrl+Shift+R while focus
    // is on the browser UI rather than inside the page). Arm the bypass flag
    // and reload here so the beforeunload guard is skipped without a prompt —
    // mirrors the main-side before-input-event path.
    guardedIpcOn(BrowserChannel.hardReload, (_event, key: string) => {
        const reg = registrations.get(key);
        if (reg && !reg.webContents.isDestroyed()) {
            reg.bypassUnloadGuard = true;
            reg.webContents.reloadIgnoringCache();
        }
    });

    guardedIpcHandle(BrowserChannel.clearProfileData, async (_event, partition: string) => {
        if (!isPersistentBrowserProfilePartition(partition)) {
            console.warn(`[IPC] Rejected invalid partition for ${BrowserChannel.clearProfileData}`);
            return;
        }
        const ses = session.fromPartition(partition);
        await ses.clearStorageData();
        await ses.clearCache();
    });

    guardedIpcHandle(BrowserChannel.clearCache, async (_event, partition: string) => {
        if (!isPersistentBrowserProfilePartition(partition)) {
            console.warn(`[IPC] Rejected invalid partition for ${BrowserChannel.clearCache}`);
            return;
        }
        const ses = session.fromPartition(partition);
        await Promise.all([
            ses.clearCache(),
            ses.clearCodeCaches({}),
            ses.clearStorageData({ storages: ["serviceworkers", "cachestorage"] }),
        ]);
    });

    guardedIpcHandle(BrowserChannel.collectDom, async (_event, key: string) => {
        return collectDom(key);
    });

    // CDP session management for browser automation
    initCdpHandlers((key: string) => {
        const reg = registrations.get(key);
        return reg && !reg.webContents.isDestroyed() ? reg.webContents : undefined;
    }, (webContents, payload) => {
        for (const [key, registration] of registrations) {
            if (registration.webContents !== webContents) continue;
            if (registration.webContents.isDestroyed()) return;
            sendEvent(
                registration.senderWebContents,
                registration.tabId,
                registration.internalTabId,
                "ai-vision-signal",
                { registrationKey: key, payload },
            );
            return;
        }
    });

    // Network request logging
    initNetworkLogger();
    setWebContentsResolver((wcId: number) => {
        for (const [key, reg] of registrations) {
            if (!reg.webContents.isDestroyed() && reg.webContents.id === wcId) {
                return key;
            }
        }
        return undefined;
    });
}
