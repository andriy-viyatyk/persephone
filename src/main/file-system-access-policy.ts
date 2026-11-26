/**
 * File System Access (`showOpenFilePicker`, `showDirectoryPicker`, `showSaveFilePicker`,
 * `handle.requestPermission`) policy for browser pages.
 *
 * Electron raises a `fileSystem` permission request for a grant upgrade (write access, read
 * access to a picked directory, a handle restored from storage) and for a picked path that is on
 * Chromium's sensitive-path blocklist. The two look the same, so this module decides from the
 * path and access type alone, as Chrome would: sensitive paths are refused without a prompt,
 * everything else is shown to the user in the permission prompt bar. Read access to a single
 * picked file is granted by Chromium itself and never reaches the handler.
 */
import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import type { BrowserFileAccessPrompt } from "../ipc/browser-ipc";
import { isLinux, isWindows } from "../shared/platform";
import { fileSystemAccessToPromptLinux } from "./file-system-access-policy-linux";
import { normalizeOrigin } from "./site-permission-store";

/** Windows shortcut and DLL-redirect files: Chrome never lets a page pick or write these. */
const BLOCKED_FILE_EXTENSIONS = new Set([".lnk", ".local"]);
const DRIVE_PATH = /^[a-z]:[\\/]/i;

function comparable(value: string): string {
    const resolved = path.win32.resolve(value);
    const root = path.win32.parse(resolved).root;
    const trimmed = resolved.length > root.length ? resolved.replace(/[\\/]+$/, "") : resolved;
    return trimmed.toLowerCase();
}

function isInside(child: string, parent: string): boolean {
    return child.startsWith(parent.endsWith("\\") ? parent : `${parent}\\`);
}

function definedPaths(values: Array<string | undefined>): string[] {
    return values.filter((value): value is string => !!value && path.win32.isAbsolute(value)).map(comparable);
}

function sensitiveFolders(): { blockAll: string[]; blockSelf: string[] } {
    const home = app.getPath("home");
    return {
        blockAll: definedPaths([
            app.getPath("appData"),
            app.getPath("userData"),
            process.env.LOCALAPPDATA,
            path.win32.join(home, "AppData"),
            path.dirname(app.getPath("exe")),
            process.env.SystemRoot,
            process.env.windir,
            process.env.ProgramFiles,
            process.env["ProgramFiles(x86)"],
            process.env.ProgramW6432,
            process.env.ProgramData,
            path.win32.join(home, ".ssh"),
        ]),
        blockSelf: definedPaths([home]),
    };
}

function isSensitive(candidate: string, folders: { blockAll: string[]; blockSelf: string[] }): boolean {
    if (candidate === comparable(path.win32.parse(candidate).root)) return true;
    for (const folder of folders.blockAll) {
        if (candidate === folder || isInside(candidate, folder) || isInside(folder, candidate)) return true;
    }
    return folders.blockSelf.some((folder) => candidate === folder || isInside(folder, candidate));
}

/** The picked path as given, plus its resolved form (junctions and symlinks followed) when it exists. */
function candidatePaths(filePath: string): string[] {
    const candidates = [comparable(filePath)];
    try {
        candidates.push(comparable(fs.realpathSync.native(filePath)));
    } catch {
        try {
            candidates.push(comparable(path.win32.join(fs.realpathSync.native(path.win32.dirname(filePath)), path.win32.basename(filePath))));
        } catch { /* Neither exists yet: the given path is all there is to check. */ }
    }
    return candidates;
}

/**
 * Decide a browser page's `fileSystem` permission request.
 * Returns the access to show in the prompt, or `undefined` to deny without a prompt.
 */
export function fileSystemAccessToPrompt(details: Electron.FilesystemPermissionRequest, topOrigin: string): BrowserFileAccessPrompt | undefined {
    // `isMainFrame` is unreliable for this permission (Electron documents it as always false on
    // checks), so the requesting document's own URL decides. Chromium already refuses pickers in
    // cross-origin subframes; this keeps a subframe from riding on the top site's prompt.
    if (details.requestingUrl && normalizeOrigin(details.requestingUrl) !== topOrigin) return undefined;
    const filePath = details.filePath;
    if (!filePath) return undefined;
    const isDirectory = details.isDirectory === true;
    if (isWindows) {
        if (!DRIVE_PATH.test(filePath)) return undefined;
        if (!isDirectory && BLOCKED_FILE_EXTENSIONS.has(path.win32.extname(filePath).toLowerCase())) return undefined;
        const folders = sensitiveFolders();
        if (candidatePaths(filePath).some((candidate) => isSensitive(candidate, folders))) return undefined;
    } else if (isLinux) {
        if (!isDirectory && BLOCKED_FILE_EXTENSIONS.has(path.win32.extname(filePath).toLowerCase())) return undefined;
        if (!fileSystemAccessToPromptLinux(filePath)) return undefined;
    } else {
        return undefined;
    }
    return { path: filePath, access: details.fileAccessType === "writable" ? "write" : "read", isDirectory };
}
