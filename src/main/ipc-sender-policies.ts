import { BrowserWindow, type WebContents } from "electron";
import type { SenderPolicy } from "./ipc-sender-guard";
import { openWindows } from "./open-windows";

export const requireAppWindow: SenderPolicy = (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    return !!window && !!openWindows.findByWindow(window);
};

export const requireNormalWindow: SenderPolicy = (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    const registered = window && openWindows.findByWindow(window);
    return !!registered && !registered.boardRoot;
};

export function requireWindowOf(target: WebContents | (() => WebContents | undefined)): SenderPolicy {
    return (event) => {
        const expected = typeof target === "function" ? target() : target;
        return !!expected && !expected.isDestroyed() && expected === event.sender;
    };
}

export function anyPolicy(...policies: SenderPolicy[]): SenderPolicy {
    return (event) => policies.some((policy) => policy(event));
}
