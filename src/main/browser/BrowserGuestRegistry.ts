import type { WebContents } from "electron";
import type { BrowserGuest } from "./BrowserGuest";

export interface BrowserContentsAttachment {
    type: "attach" | "detach";
    webContents: WebContents;
    pageId?: string;
    editorId: string;
    popupId?: string;
}

export class BrowserGuestRegistry {
    private readonly guests = new Map<string, BrowserGuest>();
    private readonly watchedSenders = new WeakSet<WebContents>();
    private readonly attachmentListeners = new Set<(attachment: BrowserContentsAttachment) => void>();

    subscribeAttachments(listener: (attachment: BrowserContentsAttachment) => void): () => void {
        this.attachmentListeners.add(listener);
        for (const guest of this.guests.values()) listener(this.attachment(guest, "attach"));
        return () => this.attachmentListeners.delete(listener);
    }

    private attachment(guest: BrowserGuest, type: BrowserContentsAttachment["type"]): BrowserContentsAttachment {
        return { type, webContents: guest.webContents, pageId: guest.pageId, editorId: guest.tabId };
    }

    register(guest: BrowserGuest): void {
        const previous = this.guests.get(guest.key);
        if (previous) this.publish(this.attachment(previous, "detach"));
        this.guests.set(guest.key, guest);
        this.publish(this.attachment(guest, "attach"));
    }

    unregister(key: string, options: { keepCdpState?: boolean } = {}): void {
        this.guests.get(key)?.dispose(options);
    }

    removeIfCurrent(guest: BrowserGuest): void {
        if (this.guests.get(guest.key) !== guest) return;
        this.guests.delete(guest.key);
        this.publish(this.attachment(guest, "detach"));
    }

    get(key: string): BrowserGuest | undefined {
        return this.guests.get(key);
    }

    /** The live guest registered under `key` by `sender`, or undefined for a foreign, stale or malformed key. */
    owned(key: unknown, sender: WebContents): BrowserGuest | undefined {
        if (typeof key !== "string" || key.length > 240) return undefined;
        const guest = this.guests.get(key);
        if (!guest || guest.senderWebContents !== sender || guest.webContents.isDestroyed()) return undefined;
        return guest;
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

    private publish(attachment: BrowserContentsAttachment): void {
        for (const listener of this.attachmentListeners) listener(attachment);
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
