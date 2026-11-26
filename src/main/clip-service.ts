import type { ClipboardFileList } from "../ipc/clipboard-ipc";
import { isLinux, isWindows } from "../shared/platform";
import { readWindowsClipboardFiles, writeWindowsClipboardFiles } from "./clip-service-windows";
import { readLinuxClipboardFiles, writeLinuxClipboardFiles } from "./clip-service-linux";

const EMPTY: ClipboardFileList = { paths: [], dropEffect: "none" };

/** Read file clipboard data for the current platform. */
export function readClipboardFiles(): Promise<ClipboardFileList> {
    if (isLinux) return readLinuxClipboardFiles();
    if (isWindows) return readWindowsClipboardFiles();
    return Promise.resolve(EMPTY);
}

/** Write file clipboard data for the current platform. */
export function writeClipboardFiles(paths: string[], cut: boolean): Promise<boolean> {
    if (isLinux) return writeLinuxClipboardFiles(paths, cut);
    if (isWindows) return writeWindowsClipboardFiles(paths, cut);
    return Promise.resolve(false);
}
