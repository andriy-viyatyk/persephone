import type { IpcMainEvent } from "electron";
import type { BrowserNavigationIntent } from "../../ipc/browser-ipc";
import { browserGuests } from "./BrowserGuestRegistry";

const MAX_INTENT_URL_CHARS = 32_768;

function parseNavigationIntent(value: unknown): BrowserNavigationIntent | undefined {
    const intent = value as { kind?: unknown; url?: unknown } | undefined;
    if (intent?.kind === "reload" || intent?.kind === "back" || intent?.kind === "forward") return { kind: intent.kind };
    if (intent?.kind === "load" && typeof intent.url === "string" && intent.url.length <= MAX_INTENT_URL_CHARS) {
        return { kind: "load", url: intent.url };
    }
    return undefined;
}

/**
 * The host's input to a browser tab's page guards: the user's "Allow popups" (`BrowserPopupGate`) and the
 * navigation the host is about to start (`BrowserUnloadGuard`). Both act only on a tab the sender owns.
 */
export const browserPageGuardService = {
    allowPopups(event: IpcMainEvent, key: unknown): void {
        browserGuests.owned(key, event.sender)?.popups.grant();
    },
    noteNavigationIntent(event: IpcMainEvent, request: { registrationKey?: unknown; intent?: unknown } | undefined): void {
        const intent = parseNavigationIntent(request?.intent);
        if (intent) browserGuests.owned(request?.registrationKey, event.sender)?.unload.noteIntent(intent);
    },
};
