import { BrowserWindow } from "electron";
import { reapplyBrowserGuestZoom } from "./browser-service";
import { sendRendererEvent } from "../ipc/main/renderer-event-sender";

export function zoom(webContents: Electron.WebContents, delta: number): void {
    const window = BrowserWindow.fromWebContents(webContents);
    const currentZoom = window?.webContents.getZoomLevel() || 0;
    const newZoom = currentZoom + delta;
    window?.webContents.setZoomLevel(newZoom);
    if (window) reapplyBrowserGuestZoom(window.webContents);
    if (window) sendRendererEvent(window.webContents, "eZoomChanged", newZoom);
}

export function resetZoom(webContents: Electron.WebContents): void {
    const window = BrowserWindow.fromWebContents(webContents);
    window?.webContents.setZoomLevel(0);
    if (window) reapplyBrowserGuestZoom(window.webContents);
    if (window) sendRendererEvent(window.webContents, "eZoomChanged", 0);
}
