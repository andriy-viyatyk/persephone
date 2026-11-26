import type { NativeImage, WebContents } from "electron";

/** Start the native Linux file drag using Electron's platform drag bridge. */
export function startLinuxFileDrag(sender: WebContents, files: string[], icon: NativeImage): void {
    sender.startDrag(files.length > 1
        ? { file: files[0], files, icon }
        : { file: files[0], icon });
}
