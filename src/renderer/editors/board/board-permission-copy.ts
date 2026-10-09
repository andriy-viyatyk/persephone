import type { BoardPermissionFlags, NormalizedBoardPermissions } from "../../../shared/board-manifest-utils";

export const BOARD_PERMISSION_INTRODUCTION = "This board can do only what is listed below. Without any permission it can still show its own pages, work with the document you open in it, copy to the clipboard, and open links inside Persephone.";
export const LEGACY_PERMISSION_EXPLANATION = "This board uses an older manifest without permission settings, so it can do anything you can: read and write your files, run programs, and use the network.";

export function legacyBoardDeprecationWarning(boardName: string): string {
    return `${boardName} doesn't declare its permissions. Boards like this are deprecated and will stop working in a future Persephone release. Ask the agent that built it to add a permissions block to board-manifest.json.`;
}

export function legacyBoardsDeprecationToast(boardNames: readonly string[]): string {
    if (boardNames.length === 1) return legacyBoardDeprecationWarning(boardNames[0]);
    const names = boardNames.join(", ");
    return `These boards don't declare their permissions: ${names}. Boards like these are deprecated and will stop working in a future Persephone release. Ask the agent that built them to add a permissions block to board-manifest.json.`;
}

export const LEGACY_BOARD_AGENT_DEPRECATION_NOTE = "This board's permissions are deprecated because its manifest omits the permissions object or uses the historical array form. Add an object-form permissions block to board-manifest.json.";
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
    themes: "Create, change, delete, and apply app themes.",
};

export interface BoardPermissionLine {
    text: string;
    fullAccess: boolean;
}

type FlagKey = keyof BoardPermissionFlags;
type FlagValue = BoardPermissionFlags[FlagKey];

/** Plain-language line for one enabled flag. */
function flagLine(key: FlagKey, value: Exclude<FlagValue, false>): BoardPermissionLine {
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
    return {
        text,
        fullAccess: key === "execute" || key === "service" || key === "appScripting"
            || (key === "fileSystem" && value === "full")
            || (key === "network" && value === "full"),
    };
}

const UNRESTRICTED_LINE: BoardPermissionLine = { text: "Unrestricted", fullAccess: false };

export function boardPermissionLines(permissions: NormalizedBoardPermissions): BoardPermissionLine[] {
    if (permissions.kind === "legacy") return [UNRESTRICTED_LINE];
    const lines: BoardPermissionLine[] = [];
    for (const [key, value] of Object.entries(permissions.flags) as [FlagKey, FlagValue][]) {
        if (value !== false) lines.push(flagLine(key, value));
    }
    if (!lines.length) lines.push({ text: "No permissions requested.", fullAccess: false });
    return lines;
}

export const PERMISSION_CHANGE_TITLE = "Board permissions changed";

export function permissionChangeMessage(boardName: string): string {
    return `${boardName} now asks for different permissions. Accept them to keep using the board, or unregister it.`;
}

export interface BoardPermissionDiffLine extends BoardPermissionLine {
    /** `kept`: granted and still requested; `added`: newly requested; `removed`: no longer requested. */
    mark: "kept" | "added" | "removed";
}

/** One list covering both sets: kept, added and removed permissions in flag order. A changed
 *  level (for example `fileSystem` "board" -> "full") is a removed line plus an added line. */
export function boardPermissionDiffLines(
    granted: NormalizedBoardPermissions,
    proposed: NormalizedBoardPermissions,
): BoardPermissionDiffLine[] {
    const lines: BoardPermissionDiffLine[] = [];
    if (granted.kind === "legacy") lines.push({ ...UNRESTRICTED_LINE, mark: proposed.kind === "legacy" ? "kept" : "removed" });
    if (granted.kind === "flags" || proposed.kind === "flags") {
        const keys = Object.keys(granted.kind === "flags" ? granted.flags : (proposed as { flags: BoardPermissionFlags }).flags) as FlagKey[];
        for (const key of keys) {
            const from: FlagValue = granted.kind === "flags" ? granted.flags[key] : false;
            const to: FlagValue = proposed.kind === "flags" ? proposed.flags[key] : false;
            if (from !== false && from === to) {
                lines.push({ ...flagLine(key, from), mark: "kept" });
                continue;
            }
            if (from !== false) lines.push({ ...flagLine(key, from), mark: "removed" });
            if (to !== false) lines.push({ ...flagLine(key, to), mark: "added" });
        }
    }
    if (proposed.kind === "legacy" && granted.kind === "flags") lines.push({ ...UNRESTRICTED_LINE, mark: "added" });
    return lines;
}
