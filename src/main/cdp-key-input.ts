import type { WebContents } from "electron";
import type { BrowserKeyboardInputEvent } from "../ipc/browser-ipc";

/** Dispatch a keyboard event to an already-resolved Electron web contents. */
export function sendElectronKeyboardInput(webContents: WebContents, input: BrowserKeyboardInputEvent): void {
    if (webContents.isDestroyed()) throw new Error("WebContents not found or destroyed");
    webContents.sendInputEvent(input);
}
