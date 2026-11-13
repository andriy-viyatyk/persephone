import type { WebContents } from "electron";
import type { PermissionPromptHandler } from "./permission-policy-service";
import { browserGuests } from "./browser/BrowserGuestRegistry";

export function createBrowserPermissionPromptHandler(): PermissionPromptHandler {
    return (contents, permissionRequest) => {
        for (const [, guest] of browserGuests.entries()) {
            if (guest.webContents !== contents || contents.isDestroyed()) continue;
            guest.sendEvent("permission-request", { permissionRequest });
            return true;
        }
        return false;
    };
}

export function getBrowserWebContentsForCdp(key: string): WebContents | undefined {
    const guest = browserGuests.get(key);
    return guest && !guest.webContents.isDestroyed() ? guest.webContents : undefined;
}

export function sendBrowserAiVisionSignal(
    target: WebContents,
    payload: string,
    executionContextId: number,
    mainContext: boolean,
): void {
    for (const [key, guest] of browserGuests.entries()) {
        if (guest.webContents !== target) continue;
        if (guest.webContents.isDestroyed()) return;
        guest.sendEvent("ai-vision-signal", {
            registrationKey: key,
            payload,
            executionContextId,
            mainContext,
        });
        return;
    }
}

export function getBrowserRegistrationKeyForWebContents(webContentsId: number): string | undefined {
    const guest = browserGuests.getByWebContentsId(webContentsId);
    return guest && !guest.webContents.isDestroyed() ? guest.key : undefined;
}

