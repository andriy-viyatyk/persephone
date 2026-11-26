import { clipboard, ClipboardItem } from "electron";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import type { ClipboardFileList } from "../ipc/clipboard-ipc";

const EMPTY: ClipboardFileList = { paths: [], dropEffect: "none" };
const GNOME_FORMAT = 'electron application/osclipboard;format="x-special/gnome-copied-files"';

function parseUriList(value: string): string[] {
    const paths: string[] = [];
    for (const rawLine of value.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith("#")) continue;
        try {
            const url = new URL(line);
            if (url.protocol !== "file:" || (url.hostname && url.hostname !== "localhost")) continue;
            const filePath = fileURLToPath(url);
            if (path.isAbsolute(filePath)) paths.push(filePath);
        } catch {
            // Malformed entries are ignored; they must never become local paths.
        }
    }
    return paths;
}

export async function readLinuxClipboardFiles(): Promise<ClipboardFileList> {
    try {
        const items = await clipboard.read();
        for (const item of items) {
            if (item.types.includes(GNOME_FORMAT)) {
                const data = await (await item.getType(GNOME_FORMAT)).text();
                const [effect, ...uriLines] = data.split(/\r?\n/);
                const paths = parseUriList(uriLines.join("\n"));
                if (paths.length) return { paths, dropEffect: effect === "cut" ? "cut" : "copy" };
            }
        }
        for (const item of items) {
            if (!item.types.includes("text/uri-list")) continue;
            const paths = parseUriList(await (await item.getType("text/uri-list")).text());
            if (paths.length) return { paths, dropEffect: "copy" };
        }
    } catch (err) {
        console.error("Failed to read Linux file clipboard:", err);
    }
    return EMPTY;
}

export async function writeLinuxClipboardFiles(paths: string[], cut: boolean): Promise<boolean> {
    try {
        if (!paths.length) {
            clipboard.clear();
            return true;
        }
        const uris = paths.map((filePath) => pathToFileURL(filePath).href);
        await clipboard.write([new ClipboardItem({
            "text/uri-list": uris.join("\r\n"),
            [GNOME_FORMAT]: [cut ? "cut" : "copy", ...uris].join("\n"),
        })]);
        return true;
    } catch (err) {
        console.error("Failed to write Linux file clipboard:", err);
        return false;
    }
}
