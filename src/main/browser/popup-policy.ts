import { BrowserWindow, WebContents } from "electron";
import { globalMuteService } from "../global-mute-service";
import { globalPopupRateLimiter } from "../../ipc/popup-rate-limiter";
import type { BrowserEvent } from "../../ipc/browser-ipc";
import { getPageOpenAction } from "../../shared/browser-navigation-policy";
import { attachNavigationSchemeGuards } from "./navigation-scheme-guards";

type SendEvent = (type: BrowserEvent["type"], data: BrowserEvent["data"]) => void;

export function parseFeature(features: string, name: string): number | undefined {
    const match = features.match(new RegExp(`${name}=(\\d+)`));
    return match ? parseInt(match[1], 10) : undefined;
}

export function destroyPopupWithNodeIntegration(childWindow: BrowserWindow, details: Electron.DidCreateWindowDetails): boolean {
    const preferences = details.options.webPreferences;
    if (!preferences?.nodeIntegration && !preferences?.nodeIntegrationInSubFrames) return false;
    console.warn("[browser] Destroying popup with Node integration enabled");
    childWindow.destroy();
    return true;
}

export function handleGuestPopup(
    parentWindow: BrowserWindow | undefined,
    features: string,
): Electron.BrowserWindowConstructorOptions {
    const popupWidth = parseFeature(features, "width") || 500;
    const popupHeight = parseFeature(features, "height") || 600;
    const options: Electron.BrowserWindowConstructorOptions = {
        autoHideMenuBar: true,
        width: popupWidth,
        height: popupHeight,
    };
    const parentBounds = parentWindow?.getBounds();
    if (parentBounds) {
        options.x = Math.round(parentBounds.x + (parentBounds.width - popupWidth) / 2);
        options.y = Math.round(parentBounds.y + (parentBounds.height - popupHeight) / 2);
    }
    return options;
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
    childContents.setWindowOpenHandler(({ url, disposition, features }) => {
        if (getPageOpenAction(url) !== "open") return { action: "deny" };
        if (disposition === "foreground-tab" || disposition === "background-tab") {
            sendEvent("new-window", { url, disposition });
            return { action: "deny" };
        }
        if (!userActivated) {
            sendEvent("popups-blocked", { url });
            return { action: "deny" };
        }
        if (!globalPopupRateLimiter.isAllowed("popups") && !globalPopupRateLimiter.check("popups")) {
            sendEvent("popups-blocked", { url });
            return { action: "deny" };
        }
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
    const popupId = registerPopup(childWindow, openerId, opener);
    if (!popupId) return;
    childContents.on("did-create-window", (grandchild, details) => {
        if (destroyPopupWithNodeIntegration(grandchild, details)) return;
        guardPopupWindow(grandchild, sender, sendEvent, registerPopup, popupId, childContents);
    });
}
