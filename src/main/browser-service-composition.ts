import type { WebContents } from "electron";
import type { PermissionPromptHandler } from "./permission-policy-service";
import {
    getBrowserServiceRegistrations,
    getBrowserServiceRegistration,
    sendBrowserRegistrationEvent,
} from "./browser-service";

export function createBrowserPermissionPromptHandler(): PermissionPromptHandler {
    return (contents, permissionRequest) => {
        for (const [, registration] of getBrowserServiceRegistrations()) {
            if (registration.webContents !== contents || contents.isDestroyed()) continue;
            sendBrowserRegistrationEvent(registration, "permission-request", { permissionRequest });
            return true;
        }
        return false;
    };
}

export function getBrowserWebContentsForCdp(key: string): WebContents | undefined {
    const registration = getBrowserServiceRegistration(key);
    return registration && !registration.webContents.isDestroyed() ? registration.webContents : undefined;
}

export function sendBrowserAiVisionSignal(
    target: WebContents,
    payload: string,
    executionContextId: number,
    mainContext: boolean,
): void {
    for (const [key, registration] of getBrowserServiceRegistrations()) {
        if (registration.webContents !== target) continue;
        if (registration.webContents.isDestroyed()) return;
        sendBrowserRegistrationEvent(registration, "ai-vision-signal", {
            registrationKey: key,
            payload,
            executionContextId,
            mainContext,
        });
        return;
    }
}

export function getBrowserRegistrationKeyForWebContents(webContentsId: number): string | undefined {
    for (const [key, registration] of getBrowserServiceRegistrations()) {
        if (!registration.webContents.isDestroyed() && registration.webContents.id === webContentsId) return key;
    }
    return undefined;
}

