import fs from "node:fs/promises";
import path from "node:path";
import { normalizeServiceUses, type BoardServiceUseDeclaration } from "../shared/board/board-service-declarations";
import type { NormalizedBoardPermissions } from "../shared/board/board-permissions";
import { BoardRoot } from "../shared/board/board-root";
import { JsonFileStore } from "./json-file-store";
import { readBoardManifest } from "./board-manifest-reader";
import { manifestPermissions } from "./board-trust-snapshot-builder";
import { comparePathKey, getDataFolder } from "./utils";

function parseTrustedPaths(data: string): string[] {
    const lines = data.split("\n").map((line) => line.trim()).filter(Boolean);
    const paths: string[] = [];
    const seen = new Set<string>();
    for (const boardRoot of lines) {
        const root = BoardRoot.tryFrom(boardRoot);
        if (!root) return [];
        const key = root.key;
        if (!key || seen.has(key)) continue;
        seen.add(key);
        paths.push(boardRoot);
    }
    return paths;
}

export interface TrustedBoardGrant {
    root: string;
    permissions: NormalizedBoardPermissions;
    folderGrants?: string[];
    fileGrants?: string[];
    manifestChanged?: boolean;
    uses?: BoardServiceUseDeclaration[];
    manifestUses?: BoardServiceUseDeclaration[];
}

interface TrustedBoardsFile { version: 1; boards: TrustedBoardGrant[] }

function validateTrustFile(value: unknown, ctx: { markDirty(): void }): TrustedBoardsFile | null {
    try {
        if (!value || typeof value !== "object" || !Array.isArray((value as { boards?: unknown }).boards)) return null;
        const boards = (value as { boards: unknown[] }).boards;
        const result: TrustedBoardGrant[] = [];
        let migrated = false;
        for (const [index, item] of boards.entries()) {
            let reason: string | undefined;
            if (!item || typeof item !== "object") reason = "record is not an object";
            if (reason) {
                console.warn("[BoardTrustService] Skipping malformed trusted board record", { index, root: undefined, reason });
                continue;
            }
            const record = item as { root?: unknown; permissions?: unknown; folderGrants?: unknown; fileGrants?: unknown; uses?: unknown };
            if (typeof record.root !== "string" || !BoardRoot.tryFrom(record.root)) reason = "root is not an absolute path";
            const permissions = record.permissions;
            if (!reason && (!permissions || typeof permissions !== "object")) reason = "permissions are not an object";
            const normalized = permissions as Partial<NormalizedBoardPermissions>;
            if (!reason && normalized.kind === "legacy") {
                if (typeof normalized.service !== "boolean") reason = "legacy service flag is invalid";
            } else if (!reason && normalized.kind === "flags") {
                const flags = (normalized as Extract<NormalizedBoardPermissions, { kind: "flags" }>).flags;
                if (!flags || typeof flags !== "object"
                    || typeof flags.execute !== "boolean" || typeof flags.service !== "boolean"
                    || !(flags.fileSystem === false || flags.fileSystem === "board" || flags.fileSystem === "full")
                    || typeof flags.openExternal !== "boolean" || typeof flags.appScripting !== "boolean"
                    || !(flags.network === false || flags.network === "internet" || flags.network === "full")
                    || typeof flags.clipboardRead !== "boolean" || typeof flags.camera !== "boolean"
                    || typeof flags.microphone !== "boolean" || typeof flags.geolocation !== "boolean"
                    || typeof flags.notifications !== "boolean"
                    || (flags.themes !== undefined && typeof flags.themes !== "boolean")
                    || (flags.computerAudio !== undefined && typeof flags.computerAudio !== "boolean")) reason = "permission flags are invalid";
                else {
                    if (flags.themes === undefined) {
                        (flags as { themes?: boolean }).themes = false;
                        migrated = true;
                    }
                    if (flags.computerAudio === undefined) {
                        (flags as { computerAudio?: boolean }).computerAudio = false;
                        migrated = true;
                    }
                }
            } else if (!reason) reason = "permission kind is invalid";
            if (reason) {
                console.warn("[BoardTrustService] Skipping malformed trusted board record", { index, root: record.root, reason });
                continue;
            }
            const validPaths = (input: unknown): string[] => {
                if (!Array.isArray(input)) return [];
                const result: string[] = [];
                const seen = new Set<string>();
                for (const candidate of input) {
                    if (typeof candidate !== "string" || !path.isAbsolute(candidate)) continue;
                    const canonical = path.resolve(candidate);
                    const key = comparePathKey(canonical);
                    if (!key || seen.has(key)) continue;
                    seen.add(key);
                    result.push(canonical);
                }
                return result;
            };
            result.push({ root: BoardRoot.from(record.root as string).path, permissions: permissions as NormalizedBoardPermissions,
                folderGrants: validPaths(record.folderGrants), fileGrants: validPaths(record.fileGrants), uses: normalizeServiceUses(record.uses) });
        }
        if (migrated) ctx.markDirty();
        return { version: 1, boards: result };
    } catch { return null; }
}

const trustStore = new JsonFileStore<TrustedBoardsFile>("trustedBoards.json", {
    validate: validateTrustFile,
    defaultValue: () => ({ version: 1, boards: [] }),
});

export class BoardTrustStore {
    /** Persisted grants. Migrates the legacy trustedBoards.txt when trustedBoards.json is missing or invalid,
     *  and rewrites a normalized file; the same persistence points as before. */
    async load(): Promise<TrustedBoardGrant[]> {
        const loaded = await trustStore.load();
        if (loaded.status === "ok") {
            if (loaded.dirty) await this.save(loaded.value.boards);
            return loaded.value.boards;
        }

        const legacyFile = path.join(getDataFolder(), "trustedBoards.txt");
        let legacy = "";
        try { legacy = await fs.readFile(legacyFile, "utf8"); } catch { /* first run */ }
        const oldPaths = parseTrustedPaths(legacy);
        const grants = await Promise.all(oldPaths.map(async (root) => ({
            root: BoardRoot.from(root).path,
            permissions: manifestPermissions(await readBoardManifest(BoardRoot.from(root))),
        })));
        await this.save(grants);
        return grants;
    }

    save(grants: TrustedBoardGrant[]): Promise<void> {
        return trustStore.save({ version: 1, boards: grants });
    }
}

export const boardTrustStore = new BoardTrustStore();
