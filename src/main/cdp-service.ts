/**
 * Chrome DevTools Protocol session management for browser webviews.
 *
 * Manages CDP debugger attach/detach/sendCommand per webview via IPC.
 * Uses Electron's webContents.debugger API — no network port needed.
 */
import { ipcMain, WebContents } from "electron";
import { BrowserChannel } from "../ipc/browser-ipc";

/** Track which webContents have an attached debugger. */
const attachedDebuggers = new WeakSet<WebContents>();

/**
 * Initialize CDP IPC handlers.
 * @param getWebContents — resolver from registration key to webContents
 */
export function initCdpHandlers(
    getWebContents: (key: string) => WebContents | undefined,
): void {
    ipcMain.handle(BrowserChannel.cdpAttach, async (_event, key: string) => {
        const wc = getWebContents(key);
        if (!wc || wc.isDestroyed()) return false;
        if (attachedDebuggers.has(wc)) return true;
        try {
            wc.debugger.attach("1.3");
            attachedDebuggers.add(wc);
            wc.debugger.on("detach", () => {
                attachedDebuggers.delete(wc);
            });
            return true;
        } catch {
            return false;
        }
    });

    ipcMain.handle(BrowserChannel.cdpDetach, async (_event, key: string) => {
        const wc = getWebContents(key);
        if (!wc || wc.isDestroyed()) return;
        if (!attachedDebuggers.has(wc)) return;
        try {
            wc.debugger.detach();
        } catch {
            // already detached
        }
        attachedDebuggers.delete(wc);
    });

    ipcMain.handle(
        BrowserChannel.cdpSend,
        async (_event, key: string, method: string, params?: object) => {
            const wc = getWebContents(key);
            if (!wc || wc.isDestroyed()) {
                throw new Error("WebContents not found or destroyed");
            }
            // Auto-attach on first command
            if (!attachedDebuggers.has(wc)) {
                try {
                    wc.debugger.attach("1.3");
                    attachedDebuggers.add(wc);
                    wc.debugger.on("detach", () => {
                        attachedDebuggers.delete(wc);
                    });
                } catch {
                    throw new Error("Failed to attach CDP debugger");
                }
            }
            return wc.debugger.sendCommand(method, params);
        },
    );
}
