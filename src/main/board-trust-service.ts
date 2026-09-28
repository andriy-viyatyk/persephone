import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { BrowserUrlMaskClaim } from "../ipc/api-param-types";
import type { BoardServiceTrustSnapshot, TrustedBoardSnapshotEntry } from "../ipc/module-service-channels";
import { BOARD_BRIDGE_VERSION } from "../shared/board-bridge-version";
import { OwnershipRegistry } from "../shared/ownership-registry";
import {
    BOARD_MANIFEST_FILE,
    normalizeBoardServicePath,
    normalizeBrowserUrlMasks,
    normalizePermissions,
} from "../shared/board-manifest-utils";
import { getBoardCompatibility } from "../shared/version-utils";
import { EventEndpoint } from "../ipc/api-types";
import { downloadService } from "./download-service";
import { moduleServiceSupervisor } from "./module-service-supervisor";
import { openWindows } from "./open-windows";
import { getAssetPath, getDataFolder } from "./utils";

interface BoardManifestData {
    name?: unknown;
    permissions?: unknown;
    service?: unknown;
    browserUrlMasks?: unknown;
    minBridgeVersion?: unknown;
}

interface BoardSource {
    root: string;
    manifest: BoardManifestData | null;
    bundledId?: string;
}

function normalizePathForCompare(filePath: string): string {
    const resolved = path.resolve(filePath).replace(/\\/g, "/").replace(/\/+$/, "");
    return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function pathCovers(ancestor: string, descendant: string): boolean {
    return descendant === ancestor || descendant.startsWith(`${ancestor}/`);
}

function parseTrustedPaths(data: string): string[] {
    const lines = data.split("\n").map((line) => line.trim()).filter(Boolean);
    const paths: string[] = [];
    const seen = new Set<string>();
    for (const boardRoot of lines) {
        if (!path.isAbsolute(boardRoot)) return [];
        const key = normalizePathForCompare(boardRoot);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        paths.push(boardRoot);
    }
    return paths;
}

async function readManifest(boardRoot: string): Promise<BoardManifestData | null> {
    try {
        const text = await fs.readFile(path.join(boardRoot, BOARD_MANIFEST_FILE), "utf8");
        const parsed: unknown = JSON.parse(text);
        return parsed && typeof parsed === "object" && !Array.isArray(parsed)
            ? parsed as BoardManifestData
            : null;
    } catch {
        return null;
    }
}

function boardName(source: BoardSource): string {
    const name = typeof source.manifest?.name === "string" ? source.manifest.name.trim() : "";
    return name || path.basename(source.root);
}

class BoardTrustService {
    private initialization: Promise<void> | undefined;
    private operation = Promise.resolve();
    private disabledBundledBoards = new Set<string>();
    private paths: string[] = [];

    init(): Promise<void> {
        if (!this.initialization) {
            this.initialization = this.serialize(async () => {
                const dataFolder = getDataFolder();
                await fs.mkdir(dataFolder, { recursive: true });
                const trustFile = path.join(dataFolder, "trustedBoards.txt");
                try {
                    await fs.access(trustFile);
                } catch {
                    await fs.writeFile(trustFile, "", "utf8");
                }
                this.paths = await this.readPathsFromDisk();
                const { serviceSnapshot, claims } = await this.createSnapshots(this.paths);
                await moduleServiceSupervisor.applyBoardServiceTrustSnapshot(serviceSnapshot);
                downloadService.setBrowserUrlMaskClaims(claims);
            });
        }
        return this.initialization;
    }

    async ready(): Promise<void> {
        await this.init();
    }

    async getPaths(): Promise<string[]> {
        await this.ready();
        return [...this.paths];
    }

    async setTrust(boardRoot: string, trusted: boolean): Promise<string[]> {
        await this.ready();
        return this.serialize(async () => {
            if (typeof boardRoot !== "string" || !path.isAbsolute(boardRoot)) {
                throw new Error("Board trust requires an absolute root path.");
            }
            const current = await this.readPathsFromDisk();
            const key = normalizePathForCompare(boardRoot);
            let next: string[];
            if (trusted) {
                if (current.some((root) => pathCovers(normalizePathForCompare(root), key))) {
                    next = current;
                } else {
                    next = [
                        ...current.filter((root) => !pathCovers(key, normalizePathForCompare(root))),
                        boardRoot,
                    ];
                }
            } else {
                next = current.filter((root) => normalizePathForCompare(root) !== key);
            }

            if (next.length !== current.length || next.some((root, index) => root !== current[index])) {
                await this.writePathsAtomically(next);
            }
            this.paths = next;
            const { serviceSnapshot, claims } = await this.createSnapshots(next);
            const stop = moduleServiceSupervisor.applyBoardServiceTrustSnapshot(serviceSnapshot);
            downloadService.setBrowserUrlMaskClaims(claims);
            openWindows.send(EventEndpoint.eBoardTrustChanged, [...next]);
            await stop;
            return [...next];
        });
    }

    async setDisabledBundledBoards(ids: string[]): Promise<void> {
        await this.ready();
        await this.serialize(async () => {
            this.disabledBundledBoards = new Set(ids.filter((id): id is string => typeof id === "string"));
            this.paths = await this.readPathsFromDisk();
            const { serviceSnapshot, claims } = await this.createSnapshots(this.paths);
            await moduleServiceSupervisor.applyBoardServiceTrustSnapshot(serviceSnapshot);
            downloadService.setBrowserUrlMaskClaims(claims);
        });
    }

    private serialize<T>(operation: () => Promise<T>): Promise<T> {
        const result = this.operation.then(operation, operation);
        this.operation = result.then((): undefined => undefined, (): undefined => undefined);
        return result;
    }

    private async readPathsFromDisk(): Promise<string[]> {
        try {
            return parseTrustedPaths(await fs.readFile(path.join(getDataFolder(), "trustedBoards.txt"), "utf8"));
        } catch {
            return [];
        }
    }

    private async writePathsAtomically(paths: string[]): Promise<void> {
        const directory = getDataFolder();
        await fs.mkdir(directory, { recursive: true });
        const destination = path.join(directory, "trustedBoards.txt");
        const temporary = path.join(directory, `trustedBoards.${process.pid}.${randomUUID()}.tmp`);
        let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
        try {
            handle = await fs.open(temporary, "wx");
            await handle.writeFile(paths.join("\n"), "utf8");
            await handle.close();
            handle = undefined;
            await fs.rename(temporary, destination);
        } catch (error) {
            await handle?.close().catch((): undefined => undefined);
            await fs.rm(temporary, { force: true }).catch((): undefined => undefined);
            throw error;
        }
    }

    private async createSnapshots(paths: string[]): Promise<{
        serviceSnapshot: BoardServiceTrustSnapshot;
        claims: BrowserUrlMaskClaim[];
    }> {
        const trustedSources = await Promise.all(paths.map(async (root): Promise<BoardSource> => ({
            root,
            manifest: await readManifest(root),
        })));
        const bundledSources = await this.readBundledSources();
        const allSources = [...trustedSources, ...bundledSources];
        const boards: TrustedBoardSnapshotEntry[] = [];
        for (const source of allSources) {
            const service = normalizeBoardServicePath(source.manifest?.service);
            boards.push({
                boardRoot: source.root,
                canStartService: normalizePermissions(source.manifest?.permissions).includes("service"),
                ...(service ? { service } : {}),
            });
        }

        const browserUrlMaskOwners = new OwnershipRegistry<BoardSource>();
        const claims: BrowserUrlMaskClaim[] = [];
        for (const source of [...trustedSources, ...bundledSources.filter((board) => !this.disabledBundledBoards.has(board.bundledId ?? ""))]) {
            const compatibility = getBoardCompatibility(
                { minBridgeVersion: source.manifest?.minBridgeVersion },
                { bridgeVersion: BOARD_BRIDGE_VERSION },
            );
            if (!compatibility.compatible) continue;
            const masks = normalizeBrowserUrlMasks(source.manifest?.browserUrlMasks);
            const accepted = masks.filter((mask) => browserUrlMaskOwners.claim(
                mask,
                source,
                { origin: source.bundledId ? "bundled" : "trusted", owner: source.root },
            ).accepted);
            if (accepted.length > 0) {
                claims.push({ boardRoot: source.root, boardName: boardName(source), masks: accepted });
            }
        }

        return {
            serviceSnapshot: {
                trustedPaths: allSources.map((source) => source.root),
                boards,
            },
            claims,
        };
    }

    private async readBundledSources(): Promise<BoardSource[]> {
        const root = getAssetPath("boards");
        try {
            const entries = await fs.readdir(root, { withFileTypes: true });
            const sources = await Promise.all(entries
                .filter((entry) => entry.isDirectory())
                .map(async (entry): Promise<BoardSource | null> => {
                    const boardRoot = path.join(root, entry.name);
                    const manifest = await readManifest(boardRoot);
                    return manifest ? { root: boardRoot, manifest, bundledId: entry.name } : null;
                }));
            return sources.filter((source): source is BoardSource => source !== null)
                .sort((left, right) => (left.bundledId ?? "").localeCompare(right.bundledId ?? ""));
        } catch {
            return [];
        }
    }
}

export const boardTrustService = new BoardTrustService();
