import type { WebContents } from "electron";
import { globalPopupRateLimiter } from "../../ipc/popup-rate-limiter";
import type { UserActivation } from "./user-activation";

/** The http(s) origin of a URL, or undefined for anything else (an opaque origin is never granted). */
function webOrigin(url: string): string | undefined {
    try {
        const parsed = new URL(url);
        return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.origin : undefined;
    } catch {
        return undefined;
    }
}

/**
 * Decides whether a browser tab's page may open a new tab or popup window now.
 *
 * Without the user's "Allow popups" for this tab, an open needs a fresh user gesture (consumed, so one
 * gesture opens one window, as in Chrome) and passes the app-wide rate limit. "Allow popups" is kept for
 * the tab's top-level origin at the moment the user allowed it and is dropped when the tab commits a
 * document from another origin.
 */
export class BrowserPopupGate {
    private grantedOrigin: string | undefined;

    constructor(private readonly contents: WebContents, private readonly activation: UserActivation) {}

    allowOpen(kind: "tabs" | "popups"): boolean {
        if (this.isGranted()) return true;
        if (!this.activation.consume()) return false;
        return globalPopupRateLimiter.check(kind);
    }

    grant(): void {
        if (!this.contents.isDestroyed()) this.grantedOrigin = webOrigin(this.contents.getURL());
    }

    onNavigated(url: string): void {
        if (this.grantedOrigin !== undefined && webOrigin(url) !== this.grantedOrigin) this.grantedOrigin = undefined;
    }

    private isGranted(): boolean {
        return this.grantedOrigin !== undefined && !this.contents.isDestroyed()
            && webOrigin(this.contents.getURL()) === this.grantedOrigin;
    }
}
