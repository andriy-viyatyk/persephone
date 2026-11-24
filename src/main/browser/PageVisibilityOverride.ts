import { BrowserWindow, type WebContents } from "electron";
import type { BrowserEventData } from "../../ipc/browser-ipc";
import { browserGuests } from "./BrowserGuestRegistry";

/**
 * Electron-internal: a `<webview>` guest's top document gets non-configurable own
 * `document.visibilityState` / `document.hidden` properties, driven by this message, which Electron
 * sends with the embedder window's state ("hidden" when minimized or hidden). Page JavaScript cannot
 * override them, so the top document is kept visible here; the preload shim covers subframes.
 * Verified on Electron 44 (castlabs); re-check on every Electron upgrade (US-1757). If the internal
 * send method is missing, the override skips itself and the top document reports its real state.
 */
const GUEST_VISIBILITY_CHANNEL = "GUEST_INSTANCE_VISIBILITY_CHANGE";

type InternalSender = (channel: string, ...args: unknown[]) => unknown;
interface GuestInternals { _sendInternal?: InternalSender }

/** Fans the process-owned unseen-mode state out to embedded browser guests. */
export class PageVisibilityOverride {
    private enabled = false;
    private unsubscribeAttachments: (() => void) | undefined;
    private readonly originalSenders = new WeakMap<WebContents, InternalSender>();
    private warnedUnsupported = false;

    start(enabled: boolean): void {
        this.enabled = enabled;
        if (this.unsubscribeAttachments) return;
        this.unsubscribeAttachments = browserGuests.subscribeAttachments((attachment) => {
            if (attachment.type !== "attach") return;
            this.wrapTopDocumentVisibility(attachment.webContents);
            if (this.enabled) this.sendTopDocumentVisibility(attachment.webContents);
            browserGuests.getByWebContents(attachment.webContents)?.sendEvent(
                "visibility-mode-changed",
                this.eventData(),
            );
        });
    }

    setEnabled(enabled: boolean): void {
        if (this.enabled === enabled) return;
        this.enabled = enabled;
        for (const [, guest] of browserGuests.entries()) {
            this.sendTopDocumentVisibility(guest.webContents);
            guest.sendEvent("visibility-mode-changed", this.eventData());
        }
    }

    dispose(): void {
        this.unsubscribeAttachments?.();
        this.unsubscribeAttachments = undefined;
        this.enabled = false;
    }

    private eventData(): BrowserEventData {
        return { unseenModeEnabled: this.enabled };
    }

    /** Rewrites Electron's embedder-visibility message to "visible" while unseen mode is on. */
    private wrapTopDocumentVisibility(contents: WebContents): void {
        if (contents.isDestroyed() || this.originalSenders.has(contents)) return;
        const internals = contents as unknown as GuestInternals;
        const original = internals._sendInternal;
        if (typeof original !== "function") {
            if (!this.warnedUnsupported) console.warn("[unseen-mode] Electron guest internals changed; webview top documents keep their real visibility.");
            this.warnedUnsupported = true;
            return;
        }
        this.originalSenders.set(contents, original);
        internals._sendInternal = (channel: string, ...args: unknown[]) => original.call(
            contents,
            channel,
            ...(channel === GUEST_VISIBILITY_CHANNEL && this.enabled ? ["visible"] : args),
        );
    }

    /** Pushes the current state now: "visible" while enabled, otherwise the embedder window's real state. */
    private sendTopDocumentVisibility(contents: WebContents): void {
        const original = this.originalSenders.get(contents);
        if (!original || contents.isDestroyed()) return;
        const embedder = contents.hostWebContents;
        const window = embedder && !embedder.isDestroyed() ? BrowserWindow.fromWebContents(embedder) : null;
        const real = window && window.isVisible() && !window.isMinimized() ? "visible" : "hidden";
        original.call(contents, GUEST_VISIBILITY_CHANNEL, this.enabled ? "visible" : real);
    }
}
