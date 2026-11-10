import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { BrowserUrlMaskClaim } from "../ipc/api-param-types";
import type { BoardServiceTrustSnapshot, TrustedBoardSnapshotEntry } from "../ipc/module-service-channels";
import { BOARD_BRIDGE_VERSION } from "../shared/board-bridge-version";
import { mergeCapabilityDeclarations, normalizeCapabilityDeclarations } from "../shared/capability-contract";
import { OwnershipRegistry } from "../shared/ownership-registry";
import { SerialQueue } from "../shared/serial-queue";
import { isKeyInside } from "../shared/path-containment";
import { BOARD_MANIFEST_FILE } from "../shared/board/board-manifest-schema";
import { normalizeBoardServicePath, normalizeServiceInterfaces, normalizeServiceUses, type BoardServiceUseDeclaration } from "../shared/board/board-service-declarations";
import { normalizeBrowserUrlMasks } from "../shared/board/board-masks";
import { BoardGrant } from "../shared/board/board-grant";
import { normalizePermissions, type NormalizedBoardPermissions } from "../shared/board/board-permissions";
import { getBoardCompatibility } from "../shared/version-utils";
import { BoardRoot } from "../shared/board/board-root";
import { boardLocalCallerId } from "./board-root-hashes";
import { stableBoardIdentity } from "../shared/board/board-stable-identity";
import { EventEndpoint } from "../ipc/api-types";
import { downloadService } from "./download-service";
import { moduleServiceSupervisor } from "./module-service-supervisor";
import { openWindows } from "./open-windows";
import { append as appendBoardLog } from "./board-log";
import { comparePathKey, getAssetPath, getDataFolder } from "./utils";

interface BoardManifestData {
    name?: unknown;
    author?: unknown;
    permissions?: unknown;
    service?: unknown;
    browserUrlMasks?: unknown;
    minBridgeVersion?: unknown;
    serviceInterfaces?: unknown;
    capabilities?: unknown;
    uses?: unknown;
}

interface BoardSource {
    root: string;
    manifest: BoardManifestData | null;
    bundledId?: string;
}

type BoardAccessChangedListener = (boardRoot: string) => Promise<void>;
const boardAccessChangedListeners = new Set<BoardAccessChangedListener>();

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

interface TrustedBoardGrant {
    root: string;
    permissions: NormalizedBoardPermissions;
    folderGrants?: string[];
    fileGrants?: string[];
    manifestChanged?: boolean;
    uses?: BoardServiceUseDeclaration[];
    manifestUses?: BoardServiceUseDeclaration[];
}

function parseTrustRecords(data: string): { records: TrustedBoardGrant[]; migrated: boolean } | null {
    try {
        const value: unknown = JSON.parse(data);
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
        return { records: result, migrated };
    } catch { return null; }
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
    private readonly queue = new SerialQueue();
    private disabledBundledBoards = new Set<string>();
    private paths: string[] = [];
    private grants: TrustedBoardGrant[] = [];
    private permissionSnapshot: TrustedBoardGrant[] = [];

    init(): Promise<void> {
        if (!this.initialization) {
            this.initialization = this.queue.run(async () => {
                const dataFolder = getDataFolder();
                await fs.mkdir(dataFolder, { recursive: true });
                const trustFile = path.join(dataFolder, "trustedBoards.json");
                let data = "";
                try { data = await fs.readFile(trustFile, "utf8"); } catch { /* migrate legacy file below */ }
                const records = parseTrustRecords(data);
                if (records) {
                    this.grants = records.records;
                    if (records.migrated) {
                        // Persist normalized old grants through the existing atomic write path.
                        await this.writeGrantsAtomically(this.grants);
                    }
                }
                else {
                    const legacyFile = path.join(dataFolder, "trustedBoards.txt");
                    let legacy = "";
                    try { legacy = await fs.readFile(legacyFile, "utf8"); } catch { /* first run */ }
                    const oldPaths = parseTrustedPaths(legacy);
                    this.grants = await Promise.all(oldPaths.map(async (root) => ({
                        root: BoardRoot.from(root).path,
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

    onBoardAccessChanged(listener: BoardAccessChangedListener): () => void {
        boardAccessChangedListeners.add(listener);
        return () => boardAccessChangedListeners.delete(listener);
    }

    private async notifyBoardAccessChanged(boardRoots: string[]): Promise<void> {
        const results = await Promise.allSettled(boardRoots.flatMap((boardRoot) =>
            [...boardAccessChangedListeners].map((listener) => listener(boardRoot))));
        for (const result of results) {
            if (result.status === "rejected") {
                console.error("[BoardTrustService] Board access-change listener failed", result.reason);
            }
        }
    }

    async getPaths(): Promise<string[]> {
        await this.ready();
        return [...this.paths];
    }

    async getPermissionGrants(): Promise<Array<TrustedBoardGrant & {
        manifestPermissions: NormalizedBoardPermissions;
        manifestUses: BoardServiceUseDeclaration[];
        service?: string;
        serviceInterfaces: import("../shared/board/board-service-declarations").BoardServiceInterfaceDeclaration[];
        boardName: string;
        callerId: string;
    }>> {
        await this.ready();
        return this.queue.run(async () => {
            const { serviceSnapshot, claims } = await this.createSnapshots(this.paths);
            await moduleServiceSupervisor.applyBoardServiceTrustSnapshot(serviceSnapshot);
            downloadService.setBrowserUrlMaskClaims(claims);
            return serviceSnapshot.boards.map(({ boardRoot, permissions, manifestPermissions, manifestChanged, uses, manifestUses, service, serviceInterfaces, boardName, callerId }) => ({
                root: boardRoot, permissions, manifestPermissions, manifestChanged, uses, manifestUses, service, serviceInterfaces, boardName, callerId,
            }));
        });
    }

    async getGrant(boardRoot: string): Promise<BoardGrant | undefined> {
        await this.ready();
        return this.getGrantFromSnapshot(boardRoot);
    }

    async getGrantedRootsFromSnapshot(): Promise<string[]> {
        await this.ready();
        const disabledRoots = new Set([...this.disabledBundledBoards].map(id =>
            BoardRoot.from(path.join(getAssetPath("boards"), id)).key));
        return this.permissionSnapshot.map(({ root }) => root)
            .filter(root => !disabledRoots.has(BoardRoot.from(root).key));
    }

    /** Read an already-built main-owned grant snapshot without awaiting initialization. */
    getGrantFromSnapshot(boardRoot: string): BoardGrant | undefined {
        const permissions = this.permissionSnapshot.find(({ root }) => BoardRoot.from(root).equals(boardRoot))?.permissions;
        return permissions ? BoardGrant.from(permissions) : undefined;
    }

    getGrantedUsesFromSnapshot(boardRoot: string): BoardServiceUseDeclaration[] {
        return [...(this.permissionSnapshot.find(({ root }) => BoardRoot.from(root).equals(boardRoot))?.uses ?? [])];
    }

    async getFileAccessGrants(boardRoot: string): Promise<{ folderGrants: string[]; fileGrants: string[] }> {
        await this.ready();
        const grant = this.grants.find((entry) => BoardRoot.from(entry.root).equals(boardRoot));
        return { folderGrants: [...(grant?.folderGrants ?? [])], fileGrants: [...(grant?.fileGrants ?? [])] };
    }

    async addFileAccessGrant(boardRoot: string, kind: "folder" | "file", canonicalPath: string): Promise<void> {
        await this.ready();
        await this.queue.run(async () => {
            const nextGrants = this.grants.map((entry) => ({ ...entry, folderGrants: [...(entry.folderGrants ?? [])], fileGrants: [...(entry.fileGrants ?? [])] }));
            const grant = nextGrants.find((entry) => BoardRoot.from(entry.root).equals(boardRoot));
            if (!grant) throw new Error("This board is not trusted.");
            const property = kind === "folder" ? "folderGrants" : "fileGrants";
            const values = [...(grant[property] ?? [])];
            if (!values.some((value) => comparePathKey(value) === comparePathKey(canonicalPath))) values.push(path.resolve(canonicalPath));
            grant[property] = values;
            await this.writeGrantsAtomically(nextGrants);
            this.grants = nextGrants;
            (await import("./board-file-access")).invalidatePersistedBoardGrants(boardRoot);
            await this.notifyBoardAccessChanged([boardRoot]);
            openWindows.send(EventEndpoint.eBoardTrustChanged, [...this.paths]);
        });
    }

    async revokeFileAccessGrant(boardRoot: string, kind: "folder" | "file", canonicalPath: string): Promise<void> {
        await this.ready();
        await this.queue.run(async () => {
            const nextGrants = this.grants.map((entry) => ({ ...entry, folderGrants: [...(entry.folderGrants ?? [])], fileGrants: [...(entry.fileGrants ?? [])] }));
            const grant = nextGrants.find((entry) => BoardRoot.from(entry.root).equals(boardRoot));
            if (!grant) return;
            const property = kind === "folder" ? "folderGrants" : "fileGrants";
            grant[property] = (grant[property] ?? []).filter((value) => comparePathKey(value) !== comparePathKey(canonicalPath));
            await this.writeGrantsAtomically(nextGrants);
            this.grants = nextGrants;
            (await import("./board-file-access")).invalidatePersistedBoardGrants(boardRoot);
            await this.notifyBoardAccessChanged([boardRoot]);
            openWindows.send(EventEndpoint.eBoardTrustChanged, [...this.paths]);
        });
    }

    async allows(boardRoot: string, flag: keyof import("../shared/board/board-permissions").BoardPermissionFlags): Promise<boolean> {
        await this.ready();
        const grant = this.permissionSnapshot.find(({ root }) => isKeyInside(BoardRoot.from(root).key, BoardRoot.from(boardRoot).key));
        if (!grant) return false;
        return BoardGrant.from(grant.permissions).allows(flag);
    }

    async setTrust(boardRoot: string, trusted: boolean, expectedPermissions?: NormalizedBoardPermissions, expectedUses?: BoardServiceUseDeclaration[]): Promise<string[]> {
        await this.ready();
        return this.queue.run(async () => {
            if (typeof boardRoot !== "string" || !path.isAbsolute(boardRoot)) {
                throw new Error("Board trust requires an absolute root path.");
            }
            const boardRootIdentity = BoardRoot.from(boardRoot);
            const current = [...this.paths];
            const nextGrants = [...this.grants];
            const key = boardRootIdentity.key;
            if (trusted) {
                const effectiveRoot = current.find((root) => isKeyInside(BoardRoot.from(root).key, key));
                if (effectiveRoot && !BoardRoot.from(effectiveRoot).equals(boardRootIdentity)) return [...current];
                const manifest = await readManifest(boardRoot);
                const permissions = normalizePermissions(manifest?.permissions);
                const uses = normalizeServiceUses(manifest?.uses);
                if ((expectedPermissions && JSON.stringify(permissions) !== JSON.stringify(expectedPermissions))
                    || (expectedUses && JSON.stringify(uses) !== JSON.stringify(expectedUses))) {
                    throw new Error("Board permissions changed while the trust dialog was open. Review the updated permissions and try again.");
                }
                // Stored and shown as the resolved path (backslashes, original case); compare with the key.
                const grant = { root: boardRootIdentity.path, permissions, uses: expectedUses ?? uses };
                const kept = nextGrants.filter(({ root }) => !isKeyInside(key, BoardRoot.from(root).key)
                    && !BoardRoot.from(root).equals(boardRootIdentity));
                nextGrants.splice(0, nextGrants.length, ...kept, grant);
            } else {
                nextGrants.splice(0, nextGrants.length, ...nextGrants.filter(({ root }) => !BoardRoot.from(root).equals(boardRootIdentity)));
            }
            await this.writeGrantsAtomically(nextGrants);
            if (!trusted) (await import("./board-file-access")).clearBoardFileAccess(boardRoot);
            this.grants = nextGrants;
            this.paths = nextGrants.map(({ root }) => root);
            const { serviceSnapshot, claims } = await this.createSnapshots(this.paths);
            const stop = moduleServiceSupervisor.applyBoardServiceTrustSnapshot(serviceSnapshot);
            downloadService.setBrowserUrlMaskClaims(claims);
            await this.notifyBoardAccessChanged([boardRoot]);
            openWindows.send(EventEndpoint.eBoardTrustChanged, [...this.paths]);
            await stop;
            return [...this.paths];
        });
    }

    async setDisabledBundledBoards(ids: string[]): Promise<void> {
        await this.ready();
        await this.queue.run(async () => {
            this.disabledBundledBoards = new Set(ids.filter((id): id is string => typeof id === "string"));
            const { serviceSnapshot, claims } = await this.createSnapshots(this.paths);
            await moduleServiceSupervisor.applyBoardServiceTrustSnapshot(serviceSnapshot);
            downloadService.setBrowserUrlMaskClaims(claims);
        });
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
            const source = trustedSources.find(({ root }) => BoardRoot.from(root).equals(grant.root));
            if (!source) return grant;
            const manifestPermissions = normalizePermissions(source.manifest?.permissions);
            const changes = BoardGrant.from(grant.permissions).reductionTo(manifestPermissions);
            const manifestUses = normalizeServiceUses(source.manifest?.uses);
            const grantUses = grant.uses ?? [];
            const reducedUses = grantUses.filter((use) => manifestUses.some((item) => item.id === use.id && item.version === use.version));
            const usesReduced = reducedUses.length !== grantUses.length;
            if (!changes && !usesReduced) return grant;
            reductionsApplied = true;
            if (changes) reductionLogs.push(appendBoardLog(grant.root, "info", `Board permissions reduced automatically: ${changes.join(", ")}.`));
            return { ...grant, ...(changes ? { permissions: manifestPermissions } : {}), uses: reducedUses };
        });
        if (reductionsApplied) {
            await this.writeGrantsAtomically(nextGrants);
            this.grants = nextGrants;
            this.paths = nextGrants.map(({ root }) => root);
            await Promise.all(reductionLogs.map((entry) => entry.catch((error: unknown) => {
                console.error("[BoardTrustService] Failed to write a permission-reduction board-log entry", error);
            })));
        }
        const bundledSources = await this.readBundledSources();
        const enabledBundledSources = bundledSources.filter((source) => !this.disabledBundledBoards.has(source.bundledId ?? ""));
        const allSources = [...trustedSources, ...enabledBundledSources];
        const boards: TrustedBoardSnapshotEntry[] = [];
        for (const source of allSources) {
            const service = normalizeBoardServicePath(source.manifest?.service);
            const manifestUses = normalizeServiceUses(source.manifest?.uses);
            const manifestInterfaces = normalizeServiceInterfaces(source.manifest?.serviceInterfaces);
            const granted = source.bundledId
                ? normalizePermissions(source.manifest?.permissions)
                : this.grants.find((grant) => BoardRoot.from(grant.root).equals(source.root))?.permissions
                    ?? normalizePermissions(source.manifest?.permissions);
            const storedGrant = this.grants.find((grant) => BoardRoot.from(grant.root).equals(source.root));
            const manifestChanged = !!storedGrant
                && (!BoardGrant.same(normalizePermissions(source.manifest?.permissions), storedGrant.permissions)
                    || JSON.stringify(manifestUses) !== JSON.stringify(storedGrant.uses ?? []));
            const callerId = stableBoardIdentity(source.manifest)
                ?? (source.bundledId ? `bundled:${source.bundledId}` : boardLocalCallerId(BoardRoot.from(source.root)));
            const compatible = getBoardCompatibility({
                minBridgeVersion: source.manifest?.minBridgeVersion,
                requiresMinBridgeVersion: BoardGrant.from(normalizePermissions(source.manifest?.permissions)).isDeclared(),
            }, { bridgeVersion: BOARD_BRIDGE_VERSION }).compatible;
            const declarations = compatible ? normalizeCapabilityDeclarations(source.manifest?.capabilities, undefined, { service: source.manifest?.service, permissions: source.manifest?.permissions }) : [];
            boards.push({
                boardRoot: source.root,
                legacyCapabilities: declarations.filter((declaration) => !declaration.methods || Object.values(declaration.methods).some((method) => method.kind === "open")),
                capabilities: compatible ? mergeCapabilityDeclarations(declarations, manifestInterfaces) : [],
                canStartService: BoardGrant.from(granted).canRunService(),
                permissions: granted,
                manifestPermissions: normalizePermissions(source.manifest?.permissions),
                ...(manifestChanged ? { manifestChanged: true } : {}),
                ...(service ? { service } : {}),
                uses: source.bundledId ? manifestUses : storedGrant?.uses ?? [],
                manifestUses,
                serviceInterfaces: manifestInterfaces,
                boardName: boardName(source),
                callerId,
            });
        }
        this.permissionSnapshot = boards.map(({ boardRoot, permissions, manifestPermissions, manifestChanged, uses }) => ({
            root: boardRoot, permissions, manifestPermissions, uses, ...(manifestChanged ? { manifestChanged: true } : {}),
        }));

        if (reductionsApplied) {
            await this.notifyBoardAccessChanged(nextGrants.map(({ root }) => root));
            openWindows.send(EventEndpoint.eBoardTrustChanged, [...this.paths]);
        }

        const browserUrlMaskOwners = new OwnershipRegistry<BoardSource>();
        const claims: BrowserUrlMaskClaim[] = [];
        for (const source of [...trustedSources, ...bundledSources.filter((board) => !this.disabledBundledBoards.has(board.bundledId ?? ""))]) {
            const compatibility = getBoardCompatibility(
                {
                    minBridgeVersion: source.manifest?.minBridgeVersion,
                    requiresMinBridgeVersion: BoardGrant.fromManifest(source.manifest?.permissions).isDeclared(),
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
