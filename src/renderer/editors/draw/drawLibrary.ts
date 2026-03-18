import type { LibraryPersistenceAdapter } from "@excalidraw/excalidraw/dist/types/excalidraw/data/library";
import { fpJoin } from "../../core/utils/file-path";
import { fs } from "../../api/fs";
import { settings } from "../../api/settings";
import { api } from "../../../ipc/renderer/api";

const LIBRARY_FILENAME = "library.excalidrawlib";

/**
 * Initialize the default drawing library path if not yet configured.
 * Called once when the first draw editor mounts.
 */
export async function initDefaultLibraryPath(): Promise<void> {
    if (settings.get("drawing.library-path")) return;
    const userData = await api.getCommonFolder("userData");
    const dir = fpJoin(userData, "data", "excalidraw-lib");
    await fs.mkdir(dir);
    settings.set("drawing.library-path", dir);
}

/**
 * Create a LibraryPersistenceAdapter that reads/writes Excalidraw library
 * items to the configured drawing library folder.
 *
 * The adapter reads the path lazily from settings on each call, so changes
 * in Settings take effect on next load/save without restarting.
 */
export function createLibraryAdapter(): LibraryPersistenceAdapter {
    const getDir = () => settings.get("drawing.library-path");

    return {
        async load() {
            const dir = getDir();
            if (!dir) return null;
            const filePath = fpJoin(dir, LIBRARY_FILENAME);
            if (!fs.fileExistsSync(filePath)) return null;
            try {
                const text = await fs.read(filePath);
                const data = JSON.parse(text);
                return { libraryItems: data.libraryItems || [] };
            } catch {
                return null;
            }
        },
        async save(libraryData) {
            const dir = getDir();
            if (!dir) return;
            await fs.mkdir(dir);
            const filePath = fpJoin(dir, LIBRARY_FILENAME);
            await fs.write(filePath, JSON.stringify(libraryData, null, 2));
        },
    };
}
