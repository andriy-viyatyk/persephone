import path from "node:path";
import { app, BrowserWindow } from "electron";
import { openWindows } from "../../main/open-windows";
import { isValidOpenPath } from "../../main/utils";

function isUrl(arg: string): boolean {
    return arg.startsWith("http://") || arg.startsWith("https://");
}

// Unpackaged, the command line is `electron . <arg>`; argv[1] is the app folder, not an input.
const startupArg: string | undefined = process.argv[app.isPackaged ? 1 : 2];
let argFile: string | undefined;
let argUrl: string | undefined;

if (startupArg && isUrl(startupArg)) {
    argUrl = startupArg;
} else if (startupArg && isValidOpenPath(path.resolve(startupArg))) {
    argFile = path.resolve(startupArg);
}

export async function windowReady(window: BrowserWindow): Promise<void> {
    const openWindow = openWindows.findWindowDataByWindow(window);
    openWindow?.ready?.();
    return;
}

export async function getFileToOpen(): Promise<string | undefined> {
    const path = argFile;
    argFile = undefined;
    if (path && isValidOpenPath(path)) {
        return path;
    }
    return undefined;
}

export async function getUrlToOpen(): Promise<string | undefined> {
    const url = argUrl;
    argUrl = undefined;
    return url;
}
