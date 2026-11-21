import { BrowserGuestMessageChannel, sendToHost } from "../ipc/browser-guest-messages";

/**
 * Report pointer lock to the host, which names the origin and the Esc exit in a notice (Chrome's
 * "Press Esc to show your cursor"). Installed in every frame — an iframe can lock the pointer too.
 * The preload runs in an isolated world at document start, so its capture listener on `document`
 * runs before any page listener there and a page cannot hide the lock from the host.
 * (Fullscreen needs no reporter: the host sees the webview's `enter-html-full-screen` event.)
 */
export function installExclusiveAccessReporter(): void {
    const { ipcRenderer } = require("electron");
    document.addEventListener("pointerlockchange", () => {
        sendToHost(ipcRenderer, { channel: BrowserGuestMessageChannel.pointerLock, payload: { locked: !!document.pointerLockElement } });
    }, true);
}
