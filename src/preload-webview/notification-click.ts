import { BrowserGuestMessageChannel, sendToHost } from "../ipc/browser-guest-messages";
import { installNotificationClickObserver } from "../shared/notification-click-observer";

const { contextBridge, ipcRenderer } = require("electron");

/** Observe clicks on native notifications created by this page document. */
export function installPageNotificationClickObserver(): void {
    contextBridge.executeInMainWorld({
        func: installNotificationClickObserver,
        args: [() => sendToHost(ipcRenderer, { channel: BrowserGuestMessageChannel.notificationClick })],
    });
}
