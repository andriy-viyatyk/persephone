import { PAGE_ZOOM_DEFAULT, isValidPageZoom } from "../shared/browser-zoom";
/**
 * Main process browser service.
 *
 * Manages webContents for browser tab webviews. When a renderer registers
 * a webview by its webContentsId, this service attaches event listeners
 * on the actual webContents and relays events back to the renderer via IPC.
 * This provides reliable navigation and lifecycle events compared to the
 * <webview> DOM element's event API.
 *
 * Registration key is `${tabId}/${internalTabId}` to support multiple
 * internal browser tabs per persephone page tab.
 */
import { app, BrowserWindow, IpcMainEvent, IpcMainInvokeEvent, session, webContents, WebContents } from "electron";
import { globalMuteService } from "./global-mute-service";
import { openWindows } from "./open-windows";
import { collectDom, collectLoadedResources } from "./browser-dom-snapshot";
import { BrowserGuest, BrowserGuestHostHooks } from "./browser/BrowserGuest";
import { browserGuests } from "./browser/BrowserGuestRegistry";
import {
    BrowserChannel,
    BrowserRegisterRequest,
    BrowserSetZoomRequest,
    BrowserSitePermissionRegistrationRequest,
    SetBrowserSitePermissionRequest,
    BrowserSitePermissions,
} from "../ipc/browser-ipc";
import { globalPopupRateLimiter } from "../ipc/popup-rate-limiter";
import type { EventApi } from "../ipc/api-types";
import type { EventPayload } from "../ipc/event-types";
import { sendRendererEvent } from "../ipc/main/renderer-event-sender";
import { clearNetworkLog } from "./network-logger";
import { clearCdpTargetState } from "./cdp-service";
import { appPartition, fileAccessPersistPartition } from "./constants";
import { clearProfilePermissionDecisions, getSitePermissionEntries, hasSavedProfilePermissionDecisions, listProfilePermissionDecisions, removeProfilePermissionDecision, resetSitePermissionDecisions, setSitePermissionDecision } from "./site-permission-store";
import { resolvePermissionRequest, settlePermissionRequestsForWebContents } from "./permission-policy-service";

function isPersistentBrowserProfilePartition(partition: unknown): partition is string {
    return typeof partition === "string"
        && partition.startsWith("persist:browser-")
        && partition.length > "persist:browser-".length
        && partition.length <= 256;
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
 * whose iframes still say "Electron" fails Cloudflare's challenge endlessly.
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

function validZoomPercent(value: unknown): value is number {
    return isValidPageZoom(value);
}

/** True only for a Browser editor guest that was registered by the renderer. */
export function isRegisteredBrowserWebContents(contents: WebContents): boolean {
    return browserGuests.hasWebContents(contents);
}

function sendHostEvent<K extends keyof EventApi>(sender: WebContents, endpoint: K, data: EventPayload<K>): void {
    try {
        if (!sender.isDestroyed()) {
            sendRendererEvent(sender, endpoint, data);
        }
    } catch {
        // The host renderer may be destroyed before the webview is disposed.
    }
}

/** Exit a guest fullscreen transition and restore the host window when Electron does not. */
async function exitHtmlFullscreen(key: string): Promise<void> {
    await browserGuests.get(key)?.exitHtmlFullscreen();
}

function registerWebview(event: IpcMainEvent, request: BrowserRegisterRequest): void {
    const { tabId, internalTabId, webContentsId } = request;
    const key = `${tabId}/${internalTabId}`;
    const contents = webContents.fromId(webContentsId);
    if (!contents || contents.isDestroyed() || contents.hostWebContents !== event.sender) return;
    globalMuteService.register(contents, "webview");
    const previous = browserGuests.get(key);
    if (previous && previous.senderWebContents !== event.sender) return;
    browserGuests.unregister(key, { keepCdpState: previous?.webContents.id === webContentsId });

    const sender = event.sender;
    const hostHooks: BrowserGuestHostHooks = {
        markGuestTransition: (guestSender) => {
            const win = BrowserWindow.fromWebContents(guestSender);
            if (win) openWindows.findByWindow(win)?.hostFullscreen.markGuestTransition(guestSender);
        },
        getHostFullscreenIntent: (guestSender) => {
            const win = BrowserWindow.fromWebContents(guestSender);
            if (!win) return false;
            const owner = openWindows.findByWindow(win);
            return owner ? owner.hostFullscreen.getHostFullscreenIntent() : !win.isDestroyed() && win.isFullScreen();
        },
        releaseHostFullscreen: (guestSender) => {
            const win = BrowserWindow.fromWebContents(guestSender);
            if (win) openWindows.findByWindow(win)?.hostFullscreen.releaseWindowFullscreen(guestSender);
        },
    };
    const guest = new BrowserGuest({
        key, tabId, internalTabId, webContents: contents, senderWebContents: sender,
        zoomPercent: validZoomPercent(request.zoomPercent) ? request.zoomPercent : PAGE_ZOOM_DEFAULT,
        hooks: {
            host: hostHooks,
            sendHostEvent: (endpoint, data) => sendHostEvent(sender, endpoint, data),
            forwardVoiceTypingInput: (parentWindow, inputEvent, input, guestContents) =>
                openWindows.findByWindow(parentWindow)?.handleGuestVoiceTypingInput(inputEvent, input, guestContents),
            settlePermissionRequests: settlePermissionRequestsForWebContents,
            clearNetworkLog,
            clearCdpTargetState,
            removeFromRegistry: (current) => browserGuests.removeIfCurrent(current),
            unregisterFromRegistry: (current) => browserGuests.unregister(current.key),
            isCurrent: (current) => browserGuests.get(current.key) === current,
        },
    });
    browserGuests.register(guest);
    guest.attach();
    browserGuests.watchSender(sender, () => {
        BrowserWindow.fromWebContents(sender)?.on("blur", () => {
            for (const [, current] of browserGuests.entries()) {
                if (current.senderWebContents === sender) current.releaseLostPress("window focus loss");
            }
        });
    });
    guest.applyZoom();
}

function unregisterWebview(key: string, options: { keepCdpState?: boolean } = {}): void {
    browserGuests.unregister(key, options);
}

/**
 * Initialize browser observers and configure the service collaborators.
 */
export function initializeBrowserService(): void {
    app.on("web-contents-created", (_event, contents) => {
        if (contents.getType() === "webview") globalMuteService.register(contents, "webview");
        contents.on("will-attach-webview", (_event, webPreferences, params) => {
            const argumentsList = webPreferences.additionalArguments || [];
            const browserPreload = typeof params.preload === "string" && params.preload.toLowerCase().includes("preload-webview");
            if (browserPreload) {
                webPreferences.nodeIntegrationInSubFrames = true;
                webPreferences.contextIsolation = true;
                webPreferences.nodeIntegration = false;
                // Isolate browser-tab zoom from other guests sharing the origin.
                webPreferences.zoomMode = "isolated";
            }
            if (!isPersistentBrowserProfilePartition(params.partition)) {
                if (argumentsList.includes("--persephone-webmcp-enabled")) {
                    webPreferences.additionalArguments = argumentsList.filter(
                        (argument) => argument !== "--persephone-webmcp-enabled",
                    );
                }
                return;
            }
            if (!argumentsList.includes("--persephone-webmcp-enabled")) {
                webPreferences.additionalArguments = [...argumentsList, "--persephone-webmcp-enabled"];
            }
        });
    });

    // Clean User-Agent for every browser partition session as soon as it's created.
    // This must happen before any request is made, so we hook session-created
    // rather than waiting for webview registration.
    app.on("session-created", (ses) => {
        cleanUserAgent(ses);
    });

}

function ownedRegistration(event: IpcMainInvokeEvent, key: unknown): BrowserGuest | undefined {
    if (typeof key !== "string" || key.length > 240) return undefined;
    const registration = browserGuests.get(key);
    if (!registration || registration.senderWebContents !== event.sender || registration.webContents.isDestroyed()) return undefined;
    return registration;
}

function requireFullscreenRegistration(event: IpcMainInvokeEvent, key: unknown): BrowserGuest {
    const registration = ownedRegistration(event, key);
    if (!registration) throw new Error("Browser tab is unregistered or unavailable");
    return registration;
}

function isBrowserPermissionSession(registration: BrowserGuest): boolean {
    return registration.webContents.session !== session.fromPartition(appPartition)
        && registration.webContents.session !== session.fromPartition(fileAccessPersistPartition);
}

function validProfileName(name: unknown): name is string {
    return typeof name === "string" && name.trim().length > 0 && name.length <= 80 && !/[\\/]/.test(name)
        && !Array.from(name).some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);
}

export const browserService = {
    async enterFullscreen(event: IpcMainInvokeEvent, request: { key: string; selector?: string }) {
        if (!request || (request.selector !== undefined && typeof request.selector !== "string")) throw new Error("Invalid fullscreen request");
        return requireFullscreenRegistration(event, request.key).enterFullscreen(request.selector);
    },
    async exitFullscreen(event: IpcMainInvokeEvent, request: { key: string }) {
        const registration = requireFullscreenRegistration(event, request?.key);
        if (!registration.htmlFullscreen) return { fullscreen: false };
        await exitHtmlFullscreen(request.key);
        return { fullscreen: false };
    },
    setZoom(event: IpcMainInvokeEvent, request: BrowserSetZoomRequest): boolean {
        if (!request || !validZoomPercent(request.zoomPercent)) return false;
        const registration = ownedRegistration(event, request.registrationKey);
        if (!registration) return false;
        registration.zoomPercent = request.zoomPercent;
        registration.applyZoom();
        return true;
    },
    getSitePermissions(event: IpcMainInvokeEvent, request: BrowserSitePermissionRegistrationRequest): BrowserSitePermissions {
        const empty: BrowserSitePermissions = { origin: "", entries: [] };
        const registration = ownedRegistration(event, request?.registrationKey);
        if (!registration || !isBrowserPermissionSession(registration)) return empty;
        const origin = registration.webContents.getURL();
        try {
            const parsed = new URL(origin);
            if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return empty;
            return { origin: parsed.origin, entries: getSitePermissionEntries(registration.webContents.session, origin) };
        } catch { return empty; }
    },
    setSitePermission(event: IpcMainInvokeEvent, request: SetBrowserSitePermissionRequest): boolean {
        if (!request || typeof request !== "object") return false;
        const registration = ownedRegistration(event, request.registrationKey);
        if (!registration || !isBrowserPermissionSession(registration) || typeof request.key !== "string"
            || (request.decision !== "allow" && request.decision !== "block")) return false;
        return setSitePermissionDecision(registration.webContents.session, registration.webContents.getURL(), request.key, request.decision);
    },
    resetSitePermissions(event: IpcMainInvokeEvent, request: BrowserSitePermissionRegistrationRequest): boolean {
        const registration = ownedRegistration(event, request?.registrationKey);
        if (!registration || !isBrowserPermissionSession(registration)) return false;
        return resetSitePermissionDecisions(registration.webContents.session, registration.webContents.getURL());
    },
    resolvePermissionRequest(_event: IpcMainInvokeEvent, request: { requestId: string; decision: "allow" | "block" }): boolean {
        if (!request || typeof request.requestId !== "string" || (request.decision !== "allow" && request.decision !== "block")) return false;
        return resolvePermissionRequest(request.requestId, request.decision);
    },
    listPermissionDecisions(profileName: string) {
        if (!validProfileName(profileName)) return [];
        if (profileName !== "default" && !hasSavedProfilePermissionDecisions(profileName)) return [];
        return listProfilePermissionDecisions(profileName);
    },
    removePermissionDecision(request: { profileName: string; origin: string; permission: string }): boolean {
        if (!request || !validProfileName(request.profileName) || typeof request.origin !== "string" || typeof request.permission !== "string") return false;
        if (!hasSavedProfilePermissionDecisions(request.profileName)) return false;
        removeProfilePermissionDecision(request.profileName, request.origin, request.permission);
        return true;
    },
    clearPermissionDecisions(profileName: string): boolean {
        if (!validProfileName(profileName) || !hasSavedProfilePermissionDecisions(profileName)) return false;
        clearProfilePermissionDecisions(profileName);
        return true;
    },
    registerWebview(event: Electron.IpcMainEvent, request: BrowserRegisterRequest): void { registerWebview(event, request); },
    unregisterWebview(key: string): void { unregisterWebview(key); },
    setAudioMuted(key: string, muted: boolean): void {
        const registration = browserGuests.get(key);
        if (registration && !registration.webContents.isDestroyed()) globalMuteService.setLocalMuted(registration.webContents, muted);
    },
    exitHtmlFullscreen(key: string): void { void exitHtmlFullscreen(key).catch((): void => undefined); },
    allowPopups(): void { globalPopupRateLimiter.allow("popups"); },
    hardReload(key: string): void {
        const registration = browserGuests.get(key);
        registration?.hardReload();
    },
    async clearProfileData(partition: string): Promise<void> {
        if (!isPersistentBrowserProfilePartition(partition)) {
            console.warn(`[IPC] Rejected invalid partition for ${BrowserChannel.clearProfileData}`);
            return;
        }
        const ses = session.fromPartition(partition);
        await ses.clearStorageData();
        await ses.clearCache();
    },
    async clearCache(partition: string): Promise<void> {
        if (!isPersistentBrowserProfilePartition(partition)) {
            console.warn(`[IPC] Rejected invalid partition for ${BrowserChannel.clearCache}`);
            return;
        }
        const ses = session.fromPartition(partition);
        await Promise.all([ses.clearCache(), ses.clearCodeCaches({}), ses.clearStorageData({ storages: ["serviceworkers", "cachestorage"] })]);
    },
    collectDom(key: string) { return collectDom(browserGuests.get(key)); },
    collectLoadedResources(key: string) { return collectLoadedResources(browserGuests.get(key)); },
};
