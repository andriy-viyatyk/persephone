import { BrowserWindow } from "electron";
import { openWindows } from "../../main/open-windows";
import { isValidFilePath } from "../../main/utils";

function isUrl(arg: string): boolean {
    return arg.startsWith("http://") || arg.startsWith("https://");
}

let argFile: string | undefined = process.argv[1];
let argUrl: string | undefined;

if (isUrl(argFile ?? "")) {
    argUrl = argFile;
    argFile = undefined;
} else if (!isValidFilePath(argFile)) {
    argFile = undefined;
}

export async function windowReady(window: BrowserWindow): Promise<void> {
    const openWindow = openWindows.findWindowDataByWindow(window);
    openWindow?.ready?.();
    return;
}

export async function getFileToOpen(): Promise<string | undefined> {
    const path = argFile;
    argFile = undefined;
    if (path && isValidFilePath(path)) {
        return path;
    }
    return undefined;
}

export async function getUrlToOpen(): Promise<string | undefined> {
    const url = argUrl;
    argUrl = undefined;
    return url;
}
