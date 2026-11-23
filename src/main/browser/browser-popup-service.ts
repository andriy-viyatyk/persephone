import type { IpcMainInvokeEvent } from "electron";
import type { BrowserPopupSnapshot } from "../../ipc/browser-ipc";
import { browserGuests } from "./BrowserGuestRegistry";
import { browserPopups } from "./BrowserPopupRegistry";

/** Resolve the browser tab registration the calling renderer owns; popups are addressed only through it. */
function requireOwnedRootKey(event: IpcMainInvokeEvent, registrationKey: unknown): string {
    const registration = browserGuests.owned(registrationKey, event.sender);
    if (!registration) throw new Error("Browser tab is unregistered or unavailable.");
    return registration.key;
}

function requirePopupId(popupId: unknown): string {
    if (typeof popupId !== "string") throw new Error("Popup id must be a string.");
    return popupId;
}

/** IPC entry points for agent access to the real popup windows a browser tab opened. */
export const browserPopupService = {
    listPopups(event: IpcMainInvokeEvent, request: { registrationKey: string }): BrowserPopupSnapshot[] {
        const registration = browserGuests.owned(request?.registrationKey, event.sender);
        return registration ? browserPopups.list(registration.key, event.sender) : [];
    },
    async closePopup(event: IpcMainInvokeEvent, request: { registrationKey: string; popupId: string }): Promise<void> {
        await browserPopups.close(requirePopupId(request?.popupId), requireOwnedRootKey(event, request?.registrationKey), event.sender);
    },
    closeOwnedPopups(event: IpcMainInvokeEvent, request: { registrationKey: string }): void {
        const registration = browserGuests.owned(request?.registrationKey, event.sender);
        if (registration) browserPopups.closeOwned(registration.key, event.sender);
    },
    async focusPopup(event: IpcMainInvokeEvent, request: { registrationKey: string; popupId: string }): Promise<void> {
        await browserPopups.focus(requirePopupId(request?.popupId), requireOwnedRootKey(event, request?.registrationKey), event.sender);
    },
    insertPopupText(event: IpcMainInvokeEvent, request: { registrationKey: string; popupId: string; text: string }): void {
        if (typeof request?.text !== "string") throw new Error("Popup text must be a string.");
        browserPopups.insertText(requirePopupId(request.popupId), requireOwnedRootKey(event, request.registrationKey), event.sender, request.text);
    },
};
