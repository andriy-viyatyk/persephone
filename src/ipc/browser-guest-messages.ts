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
} as const;

export type GuestMessage =
    | { channel: typeof BrowserGuestMessageChannel.pageTitle; payload: string }
    | { channel: typeof BrowserGuestMessageChannel.pageFavicon; payload: string }
    | { channel: typeof BrowserGuestMessageChannel.pointerDown }
    | { channel: typeof BrowserGuestMessageChannel.showFindBar }
    | { channel: typeof BrowserGuestMessageChannel.hideFindBar }
    | { channel: typeof BrowserGuestMessageChannel.clickedImages; payload: string[] }
    | { channel: typeof BrowserGuestMessageChannel.translationUnits; payload: TranslationUnitsMessage }
    | { channel: typeof BrowserGuestMessageChannel.translationReady; payload: { scope: TranslationFrameScope } };

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
            return payload ? { channel, payload: payload as string } : undefined;
        case BrowserGuestMessageChannel.pageFavicon:
            return payload ? { channel, payload: payload as string } : undefined;
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
        case BrowserGuestMessageChannel.translationUnits:
            return record?.scope?.document && Array.isArray(record.items)
                ? { channel, payload: payload as TranslationUnitsMessage }
                : undefined;
        default:
            return undefined;
    }
}
