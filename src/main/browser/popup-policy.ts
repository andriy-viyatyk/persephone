import { BrowserWindow, WebContents } from "electron";
import { globalMuteService } from "../global-mute-service";
import { globalPopupRateLimiter } from "../../ipc/popup-rate-limiter";
import type { BrowserEvent } from "../../ipc/browser-ipc";
import { getNavigationScheme } from "./navigation-scheme-policy";

type SendEvent = (type: BrowserEvent["type"], data: BrowserEvent["data"]) => void;
interface PopupEventTarget {
    on(event: string, handler: (...args: unknown[]) => void): void;
}

export function parseFeature(features: string, name: string): number | undefined {
    const match = features.match(new RegExp(`${name}=(\\d+)`));
    return match ? parseInt(match[1], 10) : undefined;
}

export function attachPopupNavigationGuards(contents: WebContents): void {
    const popupEvents = contents as unknown as PopupEventTarget;
    popupEvents.on("will-navigate", ((event: Electron.Event, url: string) => {
        if (getNavigationScheme(url) !== "chromium") event.preventDefault();
    }));
    popupEvents.on("will-redirect", ((event: Electron.Event, details: Electron.WebContentsWillRedirectEventParams) => {
        if (getNavigationScheme(details.url) === "blocked") event.preventDefault();
    }));
    popupEvents.on("will-frame-navigate", ((details: Electron.Event & Electron.WebContentsWillFrameNavigateEventParams) => {
        if (!details.isMainFrame && getNavigationScheme(details.url) === "blocked") details.preventDefault();
    }));
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
): void {
    let userActivated = false;
    childWindow.once("focus", () => { userActivated = true; });

    const childContents = childWindow.webContents;
    globalMuteService.register(childContents, "popup");
    attachPopupNavigationGuards(childContents);
    childContents.setWindowOpenHandler(({ url, disposition, features }) => {
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
    childContents.on("did-create-window", (grandchild, details) => {
        if (destroyPopupWithNodeIntegration(grandchild, details)) return;
        guardPopupWindow(grandchild, sender, sendEvent);
    });
}
