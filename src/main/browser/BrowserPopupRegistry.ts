import { randomUUID } from "node:crypto";
import type { BrowserWindow, WebContents } from "electron";
import type { BrowserEvent, BrowserPopupSnapshot } from "../../ipc/browser-ipc";
import { browserGuests } from "./BrowserGuestRegistry";
import type { BrowserContentsAttachment } from "./BrowserGuestRegistry";
import { clearCdpTargetState } from "../cdp-service";
import { clearNetworkLog } from "../network-logger";

// Keep agent close requests bounded while allowing ordinary beforeunload handlers to run.
const POPUP_CLOSE_TIMEOUT_MS = 3000;

interface PopupEntry {
    readonly id: string;
    readonly openerId: string;
    readonly rootKey: string;
    readonly sender: WebContents;
    readonly immediateOpener: WebContents;
    readonly window: BrowserWindow;
    readonly webContents: WebContents;
    readonly pageId?: string;
    readonly editorId: string;
    readonly listeners: Array<{ event: string; handler: (...args: never[]) => void }>;
    openerDestroyed?: () => void;
    senderDestroyed?: () => void;
    closing?: { resolve(): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> };
    removed: boolean;
    windowClosed?: boolean;
}

/** The CDP / network-log key of a popup: `${editorId}/${popupId}`, the same shape as a tab's guest key. */
function popupKey(entry: PopupEntry): string {
    return `${entry.rootKey.split("/")[0]}/${entry.id}`;
}

interface PopupCleanup {
    clearCdpTargetState(key: string): void;
    clearNetworkLog(key: string): void;
}

/** Owns the runtime-only relationship between browser pages and real popup windows. */
export class BrowserPopupRegistry {
    private readonly entries = new Map<string, PopupEntry>();
    private readonly attachmentListeners = new Set<(attachment: BrowserContentsAttachment) => void>();

    constructor(private readonly cleanup: PopupCleanup) {}

    subscribeAttachments(listener: (attachment: BrowserContentsAttachment) => void): () => void {
        this.attachmentListeners.add(listener);
        for (const entry of this.entries.values()) {
            if (this.isLive(entry)) listener(this.attachment(entry, "attach"));
        }
        return () => this.attachmentListeners.delete(listener);
    }

    private attachment(entry: PopupEntry, type: BrowserContentsAttachment["type"]): BrowserContentsAttachment {
        return { type, webContents: entry.webContents, pageId: entry.pageId, editorId: entry.editorId, popupId: entry.id };
    }

    register(args: {
        window: BrowserWindow;
        rootKey: string;
        openerId: string;
        immediateOpener: WebContents;
        sender: WebContents;
    }): string | undefined {
        const { window, rootKey, openerId, immediateOpener, sender } = args;
        const contents = window.webContents;
        if (window.isDestroyed() || contents.isDestroyed() || sender.isDestroyed() || immediateOpener.isDestroyed()) return undefined;
        let id = randomUUID();
        while (this.entries.has(id) || [...browserGuests.entries()].some(([, guest]) => guest.internalTabId === id)) id = randomUUID();
        const rootGuest = browserGuests.get(rootKey);
        const entry: PopupEntry = {
            id, openerId, rootKey, sender, immediateOpener, window, webContents: contents,
            pageId: rootGuest?.pageId, editorId: rootGuest?.tabId ?? "", listeners: [], removed: false,
        };
        this.entries.set(id, entry);
        this.publishAttachment(this.attachment(entry, "attach"));
        const on = (event: string, handler: (...args: never[]) => void): void => {
            (contents as unknown as { on(name: string, callback: (...args: never[]) => void): void }).on(event, handler);
            entry.listeners.push({ event, handler });
        };
        on("did-navigate", (() => this.publish(entry, "popup-changed")) as (...args: never[]) => void);
        on("did-navigate-in-page", ((_event: unknown, _url: string, isMainFrame: boolean) => {
            if (isMainFrame) this.publish(entry, "popup-changed");
        }) as (...args: never[]) => void);
        on("page-title-updated", (() => this.publish(entry, "popup-changed")) as (...args: never[]) => void);
        on("did-start-loading", (() => this.publish(entry, "popup-changed")) as (...args: never[]) => void);
        on("did-stop-loading", (() => this.publish(entry, "popup-changed")) as (...args: never[]) => void);
        on("destroyed", (() => this.remove(entry)) as (...args: never[]) => void);
        window.once("closed", () => {
            entry.windowClosed = true;
            this.remove(entry);
            entry.closing?.resolve();
        });
        contents.once("destroyed", () => this.closeDescendants(id));
        entry.openerDestroyed = () => this.closeDescendants(openerId);
        immediateOpener.once("destroyed", entry.openerDestroyed);
        entry.senderDestroyed = () => this.closeOwned(rootKey, sender);
        sender.once("destroyed", entry.senderDestroyed);
        this.publish(entry, "popup-opened");
        return id;
    }

    list(rootKey: string, sender: WebContents): BrowserPopupSnapshot[] {
        return [...this.entries.values()]
            .filter(entry => entry.rootKey === rootKey && entry.sender === sender && this.isLive(entry))
            .map(entry => this.snapshot(entry));
    }

    has(id: string, rootKey: string, sender: WebContents): boolean {
        const entry = this.entries.get(id);
        return !!entry && entry.rootKey === rootKey && entry.sender === sender && this.isLive(entry);
    }

    sendEvent(rootKey: string, sender: WebContents, type: BrowserEvent["type"], data: BrowserEvent["data"]): void {
        const guest = browserGuests.get(rootKey);
        if (guest && guest.senderWebContents === sender) guest.sendEvent(type, data);
    }

    getWebContents(key: string): WebContents | undefined {
        for (const entry of this.entries.values()) {
            if (popupKey(entry) === key && this.isLive(entry)) return entry.webContents;
        }
        return undefined;
    }

    getRegistrationKey(webContentsId: number): string | undefined {
        for (const entry of this.entries.values()) {
            if (entry.webContents.id === webContentsId && this.isLive(entry)) return popupKey(entry);
        }
        return undefined;
    }

    getAttribution(webContentsId: number): { pageId?: string; editorId: string; popupId?: string } | undefined {
        const entry = [...this.entries.values()].find((candidate) => candidate.webContents.id === webContentsId && this.isLive(candidate));
        return entry ? { pageId: entry.pageId, editorId: entry.editorId, popupId: entry.id } : undefined;
    }

    async close(id: string, rootKey: string, sender: WebContents): Promise<void> {
        const entry = this.requireEntry(id, rootKey, sender);
        if (entry.closing) return new Promise<void>((resolve, reject) => {
            const existing = entry.closing;
            if (!existing) return reject(new Error("Popup is already closed."));
            const resolvePrevious = existing.resolve;
            const rejectPrevious = existing.reject;
            existing.resolve = () => { resolvePrevious(); resolve(); };
            existing.reject = error => { rejectPrevious(error); reject(error); };
        });
        return new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => {
                if (!entry.closing) return;
                if (entry.windowClosed) entry.closing.resolve();
                else entry.closing.reject(new Error("Popup refused to close before the close deadline."));
            }, POPUP_CLOSE_TIMEOUT_MS);
            entry.closing = {
                timer,
                resolve: () => { clearTimeout(timer); entry.closing = undefined; resolve(); },
                reject: error => { clearTimeout(timer); entry.closing = undefined; reject(error); },
            };
            // The close listener is installed by registration before this request reaches close().
            entry.window.close();
            if (entry.window.isDestroyed()) this.remove(entry);
        });
    }

    /** Bring an owned popup's window to the front and focus its page before agent input. */
    focus(id: string, rootKey: string, sender: WebContents): void {
        const entry = this.requireEntry(id, rootKey, sender);
        entry.window.focus();
        entry.webContents.focus();
    }

    insertText(id: string, rootKey: string, sender: WebContents, text: string): void {
        this.requireEntry(id, rootKey, sender).webContents.insertText(text);
    }

    closeOwned(rootKey: string, sender: WebContents): void {
        for (const entry of [...this.entries.values()]) {
            if (entry.rootKey === rootKey && entry.sender === sender) this.destroy(entry);
        }
    }

    private requireEntry(id: string, rootKey: string, sender: WebContents): PopupEntry {
        const entry = this.entries.get(id);
        if (!entry || entry.rootKey !== rootKey || entry.sender !== sender || !this.isLive(entry)) {
            throw new Error(`Popup "${id}" is unknown, closed, or belongs to another browser page.`);
        }
        return entry;
    }

    private isLive(entry: PopupEntry): boolean {
        return !entry.removed && !entry.window.isDestroyed() && !entry.webContents.isDestroyed();
    }

    private snapshot(entry: PopupEntry): BrowserPopupSnapshot {
        return {
            id: entry.id,
            openerId: entry.openerId,
            url: entry.webContents.isDestroyed() ? "" : entry.webContents.getURL(),
            title: entry.webContents.isDestroyed() ? "" : entry.webContents.getTitle(),
            loading: !entry.webContents.isDestroyed() && entry.webContents.isLoading(),
        };
    }

    private publish(entry: PopupEntry, type: "popup-opened" | "popup-changed" | "popup-closed"): void {
        if (entry.sender.isDestroyed()) return;
        const guest = browserGuests.get(entry.rootKey);
        if (guest && guest.senderWebContents === entry.sender) guest.sendEvent(type, { popup: this.snapshot(entry) });
    }

    private remove(entry: PopupEntry): void {
        if (entry.removed) return;
        entry.removed = true;
        this.publishAttachment(this.attachment(entry, "detach"));
        this.publish(entry, "popup-closed");
        this.entries.delete(entry.id);
        for (const { event, handler } of entry.listeners) {
            if (!entry.webContents.isDestroyed()) {
                (entry.webContents as unknown as { removeListener(name: string, callback: (...args: never[]) => void): void }).removeListener(event, handler);
            }
        }
        if (!entry.immediateOpener.isDestroyed() && entry.openerDestroyed) entry.immediateOpener.removeListener("destroyed", entry.openerDestroyed);
        if (!entry.sender.isDestroyed() && entry.senderDestroyed) entry.sender.removeListener("destroyed", entry.senderDestroyed);
        if (entry.windowClosed) entry.closing?.resolve();
        const key = popupKey(entry);
        this.cleanup.clearCdpTargetState(key);
        this.cleanup.clearNetworkLog(key);
    }

    private publishAttachment(attachment: BrowserContentsAttachment): void {
        for (const listener of this.attachmentListeners) listener(attachment);
    }

    private closeDescendants(openerId: string): void {
        for (const entry of [...this.entries.values()]) {
            if (entry.openerId === openerId) this.destroy(entry);
        }
    }

    private destroy(entry: PopupEntry): void {
        if (entry.removed) return;
        if (!entry.window.isDestroyed()) entry.window.destroy();
        this.remove(entry);
    }
}

export const browserPopups = new BrowserPopupRegistry({ clearCdpTargetState, clearNetworkLog });
