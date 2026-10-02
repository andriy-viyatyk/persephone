import type { BoardPermissionChange } from "../../api/board-trust";
import type { BoardPermissionFlags, NormalizedBoardPermissions } from "../../../shared/board-manifest-utils";

export const BOARD_PERMISSION_INTRODUCTION = "This board can do only what is listed below. Without any permission it can still show its own pages, work with the document you open in it, copy to the clipboard, and open links inside Persephone.";
export const LEGACY_PERMISSION_EXPLANATION = "This board uses an older manifest without permission settings, so it can do anything you can: read and write your files, run programs, and use the network.";
export const FULL_ACCESS_DETAIL = "Can reach everything your user account can.";

const FLAG_COPY: Record<keyof BoardPermissionFlags, string> = {
    execute: "Run programs and scripts on this computer.",
    service: "Run a background program while Persephone is open.",
    fileSystem: "",
    openExternal: "Open links or files in your browser or another app.",
    appScripting: "Control Persephone: run app scripts, open and change pages, use agent tools.",
    network: "",
    clipboardRead: "Read the contents of your clipboard.",
    camera: "Use your camera.",
    microphone: "Use your microphone.",
    geolocation: "Read this device's location.",
    notifications: "Show desktop notifications.",
};

export interface BoardPermissionLine {
    text: string;
    fullAccess: boolean;
}

export function boardPermissionLines(permissions: NormalizedBoardPermissions): BoardPermissionLine[] {
    if (permissions.kind === "legacy") return [{ text: "Unrestricted", fullAccess: false }];
    const lines: BoardPermissionLine[] = [];
    for (const [key, value] of Object.entries(permissions.flags) as [keyof BoardPermissionFlags, BoardPermissionFlags[keyof BoardPermissionFlags]][]) {
        if (value === false) continue;
        let text = FLAG_COPY[key];
        if (key === "fileSystem") {
            text = value === "board"
                ? "Read and write files in this board's folder (including its own code) and files you pick in its dialogs."
                : "Read and write any file you can access.";
        } else if (key === "network") {
            text = value === "internet"
                ? "Connect to public internet services; local and private network addresses are blocked."
                : "Connect to the internet, this computer, and your local network.";
        }
        lines.push({
            text,
            fullAccess: key === "execute" || key === "service" || key === "appScripting"
                || (key === "fileSystem" && value === "full")
                || (key === "network" && value === "full"),
        });
    }
    if (!lines.length) lines.push({ text: "No permissions requested.", fullAccess: false });
    return lines;
}

export function permissionChangeLines(changes: readonly BoardPermissionChange[]): string[] {
    return changes.map((change) => {
        const label = change.flag === "fileSystem" ? "File access" : change.flag === "openExternal" ? "External opening"
            : change.flag === "appScripting" ? "App scripting" : change.flag === "clipboardRead" ? "Clipboard reading"
                : change.flag[0].toUpperCase() + change.flag.slice(1);
        const level = (value: boolean | string | undefined): string =>
            typeof value === "string" ? ` (${value})` : "";
        if (change.kind === "added") return `Added: ${label}${level(change.to)}.`;
        if (change.kind === "removed") return `Removed: ${label}${level(change.from)}.`;
        return `Changed: ${label} (${change.from} -> ${change.to}).`;
    });
}

