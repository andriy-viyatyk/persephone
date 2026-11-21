import type { TranslationFrameScope, TranslationUnitsMessage } from "./browser-translation-messages";

export const BrowserGuestMessageChannel = {
    pageTitle: "page-title",
    pageFavicon: "page-favicon",
    pointerDown: "guest-pointerdown",
    showFindBar: "show-find-bar",
    hideFindBar: "hide-find-bar",
    clickedImages: "clicked-images",
    translationUnits: "translation-units",
    translationReady: "translation-ready",
    /** A frame's pointer lock started or ended; the host shows the Esc notice. */
    pointerLock: "pointer-lock",
} as const;

/** Longest page title the host keeps (tab label, restore data, agent tools); longer titles are cut. */
export const GUEST_TITLE_MAX_CHARS = 1024;
/** Longest favicon URL the host accepts; a longer one is ignored. */
export const GUEST_FAVICON_URL_MAX_CHARS = 2048;
/** Inline (`data:image`) favicons are whole images, so they get a larger cap. */
export const GUEST_FAVICON_DATA_URL_MAX_CHARS = 32_768;

/** The page title as the host may store it. */
export function capGuestTitle(title: string): string {
    return title.length > GUEST_TITLE_MAX_CHARS ? title.slice(0, GUEST_TITLE_MAX_CHARS) : title;
}

/** The favicon URL, or "" when it is longer than the host accepts. */
export function capGuestFavicon(url: string): string {
    const limit = /^data:/i.test(url) ? GUEST_FAVICON_DATA_URL_MAX_CHARS : GUEST_FAVICON_URL_MAX_CHARS;
    return url.length > limit ? "" : url;
}

export type GuestMessage =
    | { channel: typeof BrowserGuestMessageChannel.pageTitle; payload: string }
    | { channel: typeof BrowserGuestMessageChannel.pageFavicon; payload: string }
    | { channel: typeof BrowserGuestMessageChannel.pointerDown }
    | { channel: typeof BrowserGuestMessageChannel.showFindBar }
    | { channel: typeof BrowserGuestMessageChannel.hideFindBar }
    | { channel: typeof BrowserGuestMessageChannel.clickedImages; payload: string[] }
    | { channel: typeof BrowserGuestMessageChannel.translationUnits; payload: TranslationUnitsMessage }
    | { channel: typeof BrowserGuestMessageChannel.translationReady; payload: { scope: TranslationFrameScope } }
    | { channel: typeof BrowserGuestMessageChannel.pointerLock; payload: { locked: boolean } };

export interface GuestMessageTransport {
    sendToHost(channel: string, ...args: unknown[]): void;
}

export function sendToHost(transport: GuestMessageTransport, msg: GuestMessage): void {
    if (msg.channel === BrowserGuestMessageChannel.pointerDown
        || msg.channel === BrowserGuestMessageChannel.showFindBar
        || msg.channel === BrowserGuestMessageChannel.hideFindBar) {
        transport.sendToHost(msg.channel);
    } else {
        transport.sendToHost(msg.channel, msg.payload);
    }
}

export function parseGuestMessage(channel: string, args: unknown[]): GuestMessage | undefined {
    const payload = args[0];
    const record = payload as { scope?: { document?: unknown }; items?: unknown } | undefined;
    switch (channel) {
        case BrowserGuestMessageChannel.pageTitle:
            return typeof payload === "string" && payload ? { channel, payload: capGuestTitle(payload) } : undefined;
        case BrowserGuestMessageChannel.pageFavicon: {
            const favicon = typeof payload === "string" ? capGuestFavicon(payload) : "";
            return favicon ? { channel, payload: favicon } : undefined;
        }
        case BrowserGuestMessageChannel.pointerDown:
            return { channel };
        case BrowserGuestMessageChannel.showFindBar:
            return { channel };
        case BrowserGuestMessageChannel.hideFindBar:
            return { channel };
        case BrowserGuestMessageChannel.clickedImages:
            return Array.isArray(payload) && payload.length ? { channel, payload: payload as string[] } : undefined;
        case BrowserGuestMessageChannel.translationReady:
            return record?.scope?.document ? { channel, payload: payload as { scope: TranslationFrameScope } } : undefined;
        case BrowserGuestMessageChannel.pointerLock:
            return typeof (payload as { locked?: unknown } | undefined)?.locked === "boolean"
                ? { channel, payload: { locked: (payload as { locked: boolean }).locked } }
                : undefined;
        case BrowserGuestMessageChannel.translationUnits:
            return record?.scope?.document && Array.isArray(record.items)
                ? { channel, payload: payload as TranslationUnitsMessage }
                : undefined;
        default:
            return undefined;
    }
}
