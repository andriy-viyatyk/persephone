import { BrowserWindow } from "electron";
import { openWindows } from "../../main/open-windows";
import { RendererEvent } from "../api-types";
import { guardedIpcOn } from "../../main/ipc-sender-guard";

export const initRendererEvents = () => {
    guardedIpcOn(RendererEvent.fileDropped, (event, filePath: string) => {
        const senderWindow = BrowserWindow.fromWebContents(event.sender);
        if (senderWindow) {
            const openWindow = openWindows.findByWindow(senderWindow);
            if (openWindow) {
                openWindow.send("eOpenFile", filePath);
            }
        }
    });
};
