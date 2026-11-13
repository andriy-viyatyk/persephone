import type { WebContents } from "electron";
import type { BrowserGuest } from "./BrowserGuest";

export class BrowserGuestRegistry {
    private readonly guests = new Map<string, BrowserGuest>();
    private readonly watchedSenders = new WeakSet<WebContents>();

    register(guest: BrowserGuest): void {
        this.guests.set(guest.key, guest);
    }

    unregister(key: string, options: { keepCdpState?: boolean } = {}): void {
        this.guests.get(key)?.dispose(options);
    }

    removeIfCurrent(guest: BrowserGuest): void {
        if (this.guests.get(guest.key) === guest) this.guests.delete(guest.key);
    }

    get(key: string): BrowserGuest | undefined {
        return this.guests.get(key);
    }

    getByWebContents(contents: WebContents): BrowserGuest | undefined {
        for (const guest of this.guests.values()) {
            if (guest.webContents === contents) return guest;
        }
        return undefined;
    }

    getByWebContentsId(webContentsId: number): BrowserGuest | undefined {
        for (const guest of this.guests.values()) {
            if (guest.webContents.id === webContentsId) return guest;
        }
        return undefined;
    }

    forSender(sender: WebContents): BrowserGuest[] {
        return [...this.guests.values()].filter(guest => guest.senderWebContents === sender);
    }

    anyHtmlFullscreen(sender: WebContents): boolean {
        return this.forSender(sender).some(guest => guest.htmlFullscreen);
    }

    hasWebContents(contents: WebContents): boolean {
        return this.getByWebContents(contents) !== undefined;
    }

    entries(): IterableIterator<[string, BrowserGuest]> {
        return this.guests.entries();
    }

    watchSender(sender: WebContents, onBlur: () => void): void {
        if (this.watchedSenders.has(sender)) return;
        this.watchedSenders.add(sender);
        sender.once("destroyed", () => {
            for (const [key, guest] of this.guests) {
                if (guest.senderWebContents === sender) this.unregister(key);
            }
        });
        onBlur();
    }
}

export const browserGuests = new BrowserGuestRegistry();

/** Reapply embedded guest zoom after Chromium synchronizes its host webContents. */
export function reapplyBrowserGuestZoom(sender: WebContents): void {
    setImmediate(() => {
        if (sender.isDestroyed()) return;
        for (const guest of browserGuests.forSender(sender)) guest.applyZoom();
    });
}
