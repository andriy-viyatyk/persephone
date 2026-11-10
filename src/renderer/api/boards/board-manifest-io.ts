import { fs } from "../fs";
import { settings } from "../settings";
import { fpBasename, fpJoin } from "../../core/utils/file-path";
import { OBJECT_PERMISSION_BRIDGE_VERSION } from "../../../shared/version-utils";
import { BOARD_MANIFEST_FILE, BOARD_MANIFEST_SCHEMA_VERSION, parseBoardManifest, type RawBoardManifest, type NormalizedBoardManifest } from "../../../shared/board/board-manifest-schema";

export function boardManifestPath(boardRoot: string): string {
    return fpJoin(boardRoot, BOARD_MANIFEST_FILE);
}

function configuredDefaultAuthor(): string {
    const configuredAuthor = settings.get("boards.default-author");
    return typeof configuredAuthor === "string" ? configuredAuthor : "";
}

function defaultBoardManifest(name = "", author = configuredDefaultAuthor()): RawBoardManifest {
    return {
        schemaVersion: BOARD_MANIFEST_SCHEMA_VERSION,
        minBridgeVersion: OBJECT_PERMISSION_BRIDGE_VERSION,
        permissions: {
            execute: false,
            service: false,
            fileSystem: false,
            openExternal: false,
            appScripting: false,
            network: false,
            clipboardRead: false,
            camera: false,
            microphone: false,
            computerAudio: false,
            geolocation: false,
            notifications: false,
            themes: false,
        },
        name,
        author,
    };
}

/** True iff the folder carries a `board-manifest.json`. Cheap existence check —
 *  does not parse. Enumeration and Explorer use this check. */
export async function isBoardFolder(boardRoot: string): Promise<boolean> {
    return fs.exists(boardManifestPath(boardRoot));
}

/** Read + parse a board's manifest. Returns null if absent or unparseable — callers
 *  treat a malformed / missing manifest as "no metadata", never throw. A manifest with
 *  an unknown (higher) schemaVersion is still returned (best-effort forward-compat). */
async function readRawBoardManifest(boardRoot: string): Promise<RawBoardManifest | null> {
    const p = boardManifestPath(boardRoot);
    try {
        if (!(await fs.exists(p))) return null;
        const file = await fs.readFile(p);
        const parsed = JSON.parse(file.content);
        if (!parsed || typeof parsed !== "object") return null;
        return parsed as RawBoardManifest;
    } catch {
        return null;
    }
}

/** Read and normalize a board's manifest. Null when absent, unreadable or not a JSON object. A higher
 * `schemaVersion` is still returned (best-effort forward compatibility). */
export async function readBoardManifest(boardRoot: string): Promise<NormalizedBoardManifest | null> {
    return parseBoardManifest(await readRawBoardManifest(boardRoot));
}


/** Write a manifest (2-space JSON + trailing newline for human-editability). */
async function writeBoardManifest(boardRoot: string, manifest: RawBoardManifest): Promise<void> {
    await fs.write(boardManifestPath(boardRoot), JSON.stringify(manifest, null, 2) + "\n");
}

/** Write a default manifest only if the folder doesn't already have one. Used by the
 *  create flow so every new board — including the template-copy-failure fallback —
 *  is a valid, identifiable board. No-op when the template already supplied one. */
async function ensureBoardManifest(boardRoot: string, author: string): Promise<void> {
    if (await isBoardFolder(boardRoot)) return;
    await writeBoardManifest(boardRoot, defaultBoardManifest(fpBasename(boardRoot), author));
}

/** Make a freshly scaffolded folder a board named `name`, keeping whatever else the template authored. */
export async function stampNewBoardManifest(boardRoot: string, name: string): Promise<void> {
    const author = configuredDefaultAuthor();
    await ensureBoardManifest(boardRoot, author);
    const manifest = await readRawBoardManifest(boardRoot) ?? defaultBoardManifest(name, author);
    manifest.name = name;
    manifest.author = author;
    await writeBoardManifest(boardRoot, manifest);
}
