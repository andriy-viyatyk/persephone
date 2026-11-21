import type { WebContents } from "electron";
import { getNavigationScheme } from "../../shared/browser-navigation-policy";
import { globalMuteService } from "../global-mute-service";
import { guardPageDialogs } from "./page-dialog-guard";

interface NavigationEventTarget {
    on(event: string, handler: (...args: unknown[]) => void): void;
}

/**
 * Scheme guards for a guest page or popup: its main frame navigates only to Chromium schemes, and no
 * redirect or subframe reaches a blocked (local) scheme. A registered browser tab additionally hands
 * external schemes to the host from `BrowserGuest`.
 */
export function attachNavigationSchemeGuards(contents: WebContents): void {
    const events = contents as unknown as NavigationEventTarget;
    events.on("will-navigate", ((event: Electron.Event, url: string) => {
        if (getNavigationScheme(url) !== "chromium") event.preventDefault();
    }));
    events.on("will-redirect", ((event: Electron.Event, details: Electron.WebContentsWillRedirectEventParams) => {
        if (getNavigationScheme(details.url) === "blocked") event.preventDefault();
    }));
    events.on("will-frame-navigate", ((details: Electron.Event & Electron.WebContentsWillFrameNavigateEventParams) => {
        if (!details.isMainFrame && getNavigationScheme(details.url) === "blocked") details.preventDefault();
    }));
}

/**
 * Policy for a browser `<webview>` guest from the moment it exists. The renderer registers a guest only
 * after its first document is ready, and that document (a new tab's `src`) loads its frames before
 * then; guarding here leaves no window without the scheme guards or the dialog guard. Window opening is
 * denied until registration installs the real handler.
 */
export function guardBrowserGuestAtCreation(contents: WebContents): void {
    globalMuteService.register(contents, "webview");
    attachNavigationSchemeGuards(contents);
    guardPageDialogs(contents);
    contents.setWindowOpenHandler(() => ({ action: "deny" }));
}
