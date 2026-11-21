import { BrowserWindow, screen, WebContents } from "electron";
import { globalMuteService } from "../global-mute-service";
import { globalPopupRateLimiter } from "../../ipc/popup-rate-limiter";
import type { BrowserEvent } from "../../ipc/browser-ipc";
import { getPageOpenAction } from "../../shared/browser-navigation-policy";
import { attachNavigationSchemeGuards } from "./navigation-scheme-guards";
import { guardPageDialogs } from "./page-dialog-guard";

type SendEvent = (type: BrowserEvent["type"], data: BrowserEvent["data"]) => void;

const DEFAULT_POPUP_WIDTH = 500;
const DEFAULT_POPUP_HEIGHT = 600;
const MIN_POPUP_SIZE = 100;
const MAX_POPUP_TITLE_CHARS = 200;

export function parseFeature(features: string, name: string): number | undefined {
    const match = features.match(new RegExp(`${name}=(\\d+)`));
    return match ? parseInt(match[1], 10) : undefined;
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), Math.max(min, max));
}

export function destroyPopupWithNodeIntegration(childWindow: BrowserWindow, details: Electron.DidCreateWindowDetails): boolean {
    const preferences = details.options.webPreferences;
    if (!preferences?.nodeIntegration && !preferences?.nodeIntegrationInSubFrames) return false;
    console.warn("[browser] Destroying popup with Node integration enabled");
    childWindow.destroy();
    return true;
}

/**
 * Window options for a page-opened popup: the page's requested size, kept within the work area of the
 * display the opener is on, centred on the opener and never placed off that work area.
 */
export function popupWindowOptions(anchor: Electron.Rectangle | undefined, features: string): Electron.BrowserWindowConstructorOptions {
    const area = (anchor ? screen.getDisplayMatching(anchor) : screen.getPrimaryDisplay()).workArea;
    const width = clamp(parseFeature(features, "width") || DEFAULT_POPUP_WIDTH, MIN_POPUP_SIZE, area.width);
    const height = clamp(parseFeature(features, "height") || DEFAULT_POPUP_HEIGHT, MIN_POPUP_SIZE, area.height);
    const center = anchor ?? area;
    return {
        autoHideMenuBar: true,
        width,
        height,
        x: clamp(Math.round(center.x + (center.width - width) / 2), area.x, area.x + area.width - width),
        y: clamp(Math.round(center.y + (center.height - height) / 2), area.y, area.y + area.height - height),
    };
}

/**
 * Popup windows have no address bar, so the title names the origin that controls the content
 * (`mainFrame.origin`: an `about:blank` popup written by its opener shows the opener's origin) ahead of
 * the page's own title, which the page could otherwise use to pose as anything.
 */
function showPopupOrigin(window: BrowserWindow): void {
    const contents = window.webContents;
    const update = (): void => {
        if (window.isDestroyed() || contents.isDestroyed()) return;
        let origin = contents.mainFrame?.origin ?? "";
        if (!origin || origin === "null") origin = contents.getURL().split(/[?#]/)[0] || "about:blank";
        const title = contents.getTitle().slice(0, MAX_POPUP_TITLE_CHARS);
        window.setTitle(title && title !== contents.getURL() ? `${origin} — ${title}` : origin);
    };
    window.on("page-title-updated", (event) => {
        event.preventDefault();
        update();
    });
    contents.on("did-navigate", update);
    update();
}

export function guardPopupWindow(
    childWindow: BrowserWindow,
    sender: WebContents,
    sendEvent: SendEvent,
    registerPopup: (window: BrowserWindow, openerId: string, opener: WebContents) => string | undefined,
    openerId: string,
    opener: WebContents,
): void {
    let userActivated = false;
    childWindow.once("focus", () => { userActivated = true; });

    const childContents = childWindow.webContents;
    globalMuteService.register(childContents, "popup");
    attachNavigationSchemeGuards(childContents);
    guardPageDialogs(childContents);
    showPopupOrigin(childWindow);
    childContents.setWindowOpenHandler(({ url, disposition, features }) => {
        if (getPageOpenAction(url) !== "open") return { action: "deny" };
        const tab = disposition === "foreground-tab" || disposition === "background-tab";
        if (!userActivated || !globalPopupRateLimiter.check(tab ? "tabs" : "popups")) {
            sendEvent("popups-blocked", { url });
            return { action: "deny" };
        }
        if (tab) {
            sendEvent("new-window", { url, disposition });
            return { action: "deny" };
        }
        return { action: "allow", overrideBrowserWindowOptions: popupWindowOptions(childWindow.getBounds(), features) };
    });
    const popupId = registerPopup(childWindow, openerId, opener);
    if (!popupId) return;
    childContents.on("did-create-window", (grandchild, details) => {
        if (destroyPopupWithNodeIntegration(grandchild, details)) return;
        guardPopupWindow(grandchild, sender, sendEvent, registerPopup, popupId, childContents);
    });
}
