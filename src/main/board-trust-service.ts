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
    type NormalizedBoardPermissions,
} from "../shared/board-manifest-utils";
import { getBoardCompatibility } from "../shared/version-utils";
import { EventEndpoint } from "../ipc/api-types";
import { downloadService } from "./download-service";
import { moduleServiceSupervisor } from "./module-service-supervisor";
import { openWindows } from "./open-windows";
import { append as appendBoardLog } from "./board-log";
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

interface TrustedBoardGrant { root: string; permissions: NormalizedBoardPermissions; manifestChanged?: boolean }

function parseTrustRecords(data: string): TrustedBoardGrant[] | null {
    try {
        const value: unknown = JSON.parse(data);
        if (!value || typeof value !== "object" || !Array.isArray((value as { boards?: unknown }).boards)) return null;
        const boards = (value as { boards: unknown[] }).boards;
        const result: TrustedBoardGrant[] = [];
        for (const [index, item] of boards.entries()) {
            let reason: string | undefined;
            if (!item || typeof item !== "object") reason = "record is not an object";
            if (reason) {
                console.warn("[BoardTrustService] Skipping malformed trusted board record", { index, root: undefined, reason });
                continue;
            }
            const record = item as { root?: unknown; permissions?: unknown };
            if (typeof record.root !== "string" || !path.isAbsolute(record.root)) reason = "root is not an absolute path";
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
                    || typeof flags.notifications !== "boolean") reason = "permission flags are invalid";
            } else if (!reason) reason = "permission kind is invalid";
            if (reason) {
                console.warn("[BoardTrustService] Skipping malformed trusted board record", { index, root: record.root, reason });
                continue;
            }
            result.push({ root: record.root as string, permissions: permissions as NormalizedBoardPermissions });
        }
        return result;
    } catch { return null; }
}

function permissionReduction(previous: NormalizedBoardPermissions, proposed: NormalizedBoardPermissions): string[] | undefined {
    if (previous.kind === "legacy" && proposed.kind === "legacy") {
        return previous.service && !proposed.service ? ["service"] : undefined;
    }
    if (previous.kind !== "flags" || proposed.kind !== "flags") return undefined;
    const oldFlags = previous.flags;
    const newFlags = proposed.flags;
    const levels = { false: 0, board: 1, internet: 1, full: 2 } as const;
    const changes: string[] = [];
    for (const key of Object.keys(oldFlags) as (keyof typeof oldFlags)[]) {
        const oldValue = oldFlags[key];
        const newValue = newFlags[key];
        if (oldValue === newValue) continue;
        const oldRank = typeof oldValue === "boolean" ? Number(oldValue) : levels[oldValue];
        const newRank = typeof newValue === "boolean" ? Number(newValue) : levels[newValue];
        if (newRank > oldRank) return undefined;
        changes.push(`${key}: ${oldValue} -> ${newValue}`);
    }
    return changes.length ? changes : undefined;
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
    private grants: TrustedBoardGrant[] = [];
    private permissionSnapshot: TrustedBoardGrant[] = [];

    init(): Promise<void> {
        if (!this.initialization) {
            this.initialization = this.serialize(async () => {
                const dataFolder = getDataFolder();
                await fs.mkdir(dataFolder, { recursive: true });
                const trustFile = path.join(dataFolder, "trustedBoards.json");
                let data = "";
                try { data = await fs.readFile(trustFile, "utf8"); } catch { /* migrate legacy file below */ }
                const records = parseTrustRecords(data);
                if (records) this.grants = records;
                else {
                    const legacyFile = path.join(dataFolder, "trustedBoards.txt");
                    let legacy = "";
                    try { legacy = await fs.readFile(legacyFile, "utf8"); } catch { /* first run */ }
                    const oldPaths = parseTrustedPaths(legacy);
                    this.grants = await Promise.all(oldPaths.map(async (root) => ({
                        root,
                        permissions: normalizePermissions((await readManifest(root))?.permissions),
                    })));
                    await this.writeGrantsAtomically(this.grants);
                }
                this.paths = this.grants.map(({ root }) => root);
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

    async getPermissionGrants(): Promise<Array<TrustedBoardGrant & { manifestPermissions: NormalizedBoardPermissions }>> {
        await this.ready();
        return this.serialize(async () => {
            const before = this.permissionSnapshot.map(({ root, permissions }) => [root, JSON.stringify(permissions)] as const);
            const { serviceSnapshot, claims } = await this.createSnapshots(this.paths);
            const changedByReduction = before.some(([root, permissions]) =>
                JSON.stringify(this.permissionSnapshot.find((entry) => normalizePathForCompare(entry.root) === normalizePathForCompare(root))?.permissions) !== permissions);
            if (changedByReduction) {
                await moduleServiceSupervisor.applyBoardServiceTrustSnapshot(serviceSnapshot);
                downloadService.setBrowserUrlMaskClaims(claims);
            }
            return serviceSnapshot.boards.map(({ boardRoot, permissions, manifestPermissions, manifestChanged }) => ({
                root: boardRoot, permissions, manifestPermissions, manifestChanged,
            }));
        });
    }

    async getGrantedPermissions(boardRoot: string): Promise<NormalizedBoardPermissions | undefined> {
        await this.ready();
        return this.getGrantedPermissionsFromSnapshot(boardRoot);
    }

    /** Read an already-built main-owned grant snapshot without awaiting initialization. */
    getGrantedPermissionsFromSnapshot(boardRoot: string): NormalizedBoardPermissions | undefined {
        const key = normalizePathForCompare(boardRoot);
        return this.permissionSnapshot.find(({ root }) => normalizePathForCompare(root) === key)?.permissions;
    }

    async allows(boardRoot: string, flag: keyof import("../shared/board-manifest-utils").BoardPermissionFlags): Promise<boolean> {
        await this.ready();
        const grant = this.permissionSnapshot.find(({ root }) =>
            pathCovers(normalizePathForCompare(root), normalizePathForCompare(boardRoot)));
        if (!grant) return false;
        const permissions = grant.permissions;
        if (permissions.kind === "legacy") return flag !== "service" || permissions.service;
        const value = permissions.flags[flag];
        return value === true || value === "board" || value === "full" || value === "internet";
    }

    async setTrust(boardRoot: string, trusted: boolean, expectedPermissions?: NormalizedBoardPermissions): Promise<string[]> {
        await this.ready();
        return this.serialize(async () => {
            if (typeof boardRoot !== "string" || !path.isAbsolute(boardRoot)) {
                throw new Error("Board trust requires an absolute root path.");
            }
            const current = [...this.paths];
            const nextGrants = [...this.grants];
            const key = normalizePathForCompare(boardRoot);
            if (trusted) {
                const effectiveRoot = current.find((root) => pathCovers(normalizePathForCompare(root), key));
                if (effectiveRoot && normalizePathForCompare(effectiveRoot) !== key) return [...current];
                const manifest = await readManifest(boardRoot);
                const permissions = normalizePermissions(manifest?.permissions);
                if (expectedPermissions && JSON.stringify(permissions) !== JSON.stringify(expectedPermissions)) {
                    throw new Error("Board permissions changed while the trust dialog was open. Review the updated permissions and try again.");
                }
                const grant = { root: boardRoot, permissions };
                const kept = nextGrants.filter(({ root }) => !pathCovers(key, normalizePathForCompare(root))
                    && normalizePathForCompare(root) !== key);
                nextGrants.splice(0, nextGrants.length, ...kept, grant);
            } else {
                nextGrants.splice(0, nextGrants.length, ...nextGrants.filter(({ root }) => normalizePathForCompare(root) !== key));
            }
            await this.writeGrantsAtomically(nextGrants);
            this.grants = nextGrants;
            this.paths = nextGrants.map(({ root }) => root);
            const { serviceSnapshot, claims } = await this.createSnapshots(this.paths);
            const stop = moduleServiceSupervisor.applyBoardServiceTrustSnapshot(serviceSnapshot);
            downloadService.setBrowserUrlMaskClaims(claims);
            openWindows.send(EventEndpoint.eBoardTrustChanged, [...this.paths]);
            await stop;
            return [...this.paths];
        });
    }

    async setDisabledBundledBoards(ids: string[]): Promise<void> {
        await this.ready();
        await this.serialize(async () => {
            this.disabledBundledBoards = new Set(ids.filter((id): id is string => typeof id === "string"));
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

    private async writeGrantsAtomically(grants: TrustedBoardGrant[]): Promise<void> {
        const directory = getDataFolder();
        await fs.mkdir(directory, { recursive: true });
        const destination = path.join(directory, "trustedBoards.json");
        const temporary = path.join(directory, `trustedBoards.${process.pid}.${randomUUID()}.tmp`);
        let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
        try {
            handle = await fs.open(temporary, "wx");
            await handle.writeFile(JSON.stringify({ version: 1, boards: grants }, null, 2), "utf8");
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
        let reductionsApplied = false;
        const reductionLogs: Promise<void>[] = [];
        const nextGrants = this.grants.map((grant) => {
            const source = trustedSources.find(({ root }) => normalizePathForCompare(root) === normalizePathForCompare(grant.root));
            if (!source) return grant;
            const manifestPermissions = normalizePermissions(source.manifest?.permissions);
            const changes = permissionReduction(grant.permissions, manifestPermissions);
            if (!changes) return grant;
            reductionsApplied = true;
            reductionLogs.push(appendBoardLog(grant.root, "info", `Board permissions reduced automatically: ${changes.join(", ")}.`));
            return { ...grant, permissions: manifestPermissions };
        });
        if (reductionsApplied) {
            await this.writeGrantsAtomically(nextGrants);
            this.grants = nextGrants;
            this.paths = nextGrants.map(({ root }) => root);
            await Promise.all(reductionLogs.map((entry) => entry.catch((error: unknown) => {
                console.error("[BoardTrustService] Failed to write a permission-reduction board-log entry", error);
            })));
            openWindows.send(EventEndpoint.eBoardTrustChanged, [...this.paths]);
        }
        const bundledSources = await this.readBundledSources();
        const allSources = [...trustedSources, ...bundledSources];
        const boards: TrustedBoardSnapshotEntry[] = [];
        for (const source of allSources) {
            const service = normalizeBoardServicePath(source.manifest?.service);
            const granted = source.bundledId
                ? normalizePermissions(source.manifest?.permissions)
                : this.grants.find((grant) => normalizePathForCompare(grant.root) === normalizePathForCompare(source.root))?.permissions
                    ?? normalizePermissions(source.manifest?.permissions);
            const storedGrant = this.grants.find((grant) => normalizePathForCompare(grant.root) === normalizePathForCompare(source.root));
            const manifestChanged = !!storedGrant
                && JSON.stringify(normalizePermissions(source.manifest?.permissions)) !== JSON.stringify(storedGrant.permissions);
            boards.push({
                boardRoot: source.root,
                canStartService: granted.kind === "legacy" ? granted.service : granted.flags.service,
                permissions: granted,
                manifestPermissions: normalizePermissions(source.manifest?.permissions),
                ...(manifestChanged ? { manifestChanged: true } : {}),
                ...(service ? { service } : {}),
            });
        }
        this.permissionSnapshot = boards.map(({ boardRoot, permissions, manifestPermissions, manifestChanged }) => ({
            root: boardRoot, permissions, manifestPermissions, ...(manifestChanged ? { manifestChanged: true } : {}),
        }));

        const browserUrlMaskOwners = new OwnershipRegistry<BoardSource>();
        const claims: BrowserUrlMaskClaim[] = [];
        for (const source of [...trustedSources, ...bundledSources.filter((board) => !this.disabledBundledBoards.has(board.bundledId ?? ""))]) {
            const compatibility = getBoardCompatibility(
                {
                    minBridgeVersion: source.manifest?.minBridgeVersion,
                    requiresMinBridgeVersion: !!source.manifest?.permissions && typeof source.manifest.permissions === "object" && !Array.isArray(source.manifest.permissions),
                },
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
