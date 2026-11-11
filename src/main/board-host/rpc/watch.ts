import fs from "node:fs";
import path from "node:path";
import type { BoardWatchOptions } from "../../../ipc/board-bridge/port-protocol";
import type { PathWatchBatch, PathWatchOwner } from "../../../ipc/api-types";
import { BoardRpcError } from "./errors";
import { boardTrustService } from "../../board-trust-service";
import { boardFileAccess } from "../../board-file-access";
import { pathWatchService } from "../../path-watch-service";
import { BoardRoot } from "../../../shared/board/board-root";
import { isPathInside } from "../../utils";
import { boardName } from "./context";
import { frameEvent } from "../../../ipc/board-bridge/frame-protocol";
import type { BoardBridgeConnection, BoardWatchRecord } from "../BoardBridgeConnection";
import type { BoardBridgeConnections } from "../BoardBridgeConnections";
import type { BoardRpcSlice } from "./types";

const MAX_BOARD_WATCHES = 64;

function normalizeWatchPath(value: string): string {
    const normalized = path.normalize(value);
    return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function watchPathInScope(scopePath: string, candidatePath: string, kind: "file" | "folder"): boolean {
    if (kind === "file") return normalizeWatchPath(scopePath) === normalizeWatchPath(candidatePath);
    return isPathInside(scopePath, candidatePath);
}

function validateWatchOptions(value: unknown): Required<Pick<BoardWatchOptions, "recursive" | "debounceMs">> {
    if (value !== undefined && (!value || typeof value !== "object" || Array.isArray(value)
        || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null))) {
        throw new BoardRpcError("invalid-argument", "Watch options must be a plain object.");
    }
    const options = (value ?? {}) as BoardWatchOptions;
    if (options.recursive !== undefined && typeof options.recursive !== "boolean") {
        throw new BoardRpcError("invalid-argument", "Watch recursive must be a boolean.");
    }
    if (options.debounceMs !== undefined && (!Number.isInteger(options.debounceMs)
        || options.debounceMs < 50 || options.debounceMs > 60_000)) {
        throw new BoardRpcError("invalid-argument", "Watch debounceMs must be an integer from 50 to 60000.");
    }
    return { recursive: options.recursive ?? false, debounceMs: options.debounceMs ?? 300 };
}

function watchAuthorizationError(error: unknown): BoardRpcError {
    const code = (error as NodeJS.ErrnoException | null)?.code;
    return code === "ENOENT"
        ? new BoardRpcError("not-found", "The watch target does not exist.")
        : new BoardRpcError("permission-denied", "The board is not authorized to watch this path.");
}

async function resolveBoardWatchTarget(
    entry: BoardBridgeConnection,
    requestedPath: string,
    grant: NonNullable<Awaited<ReturnType<typeof boardTrustService.getGrant>>>,
): Promise<{
    path: string;
    kind: "file" | "folder";
    intent: "read" | "list";
    hostedDocument: boolean;
}> {
    const verifyStat = async (authorizedPath: string): Promise<import("node:fs").Stats> => {
        try { return await fs.promises.stat(authorizedPath); }
        catch (error: unknown) { throw watchAuthorizationError(error); }
    };
    if (grant.fileSystemMode() === false) {
        try {
            const authorizedPath = await boardFileAccess.authorizeHostedRead(entry.root, requestedPath, entry.hostedFilePath);
            if (!entry.hostedFilePath || normalizeWatchPath(authorizedPath)
                !== normalizeWatchPath(await fs.promises.realpath(entry.hostedFilePath))) {
                throw new BoardRpcError("permission-denied", "Only the exact hosted document can be watched.");
            }
            const stats = await verifyStat(authorizedPath);
            if (!stats.isFile()) throw new BoardRpcError("permission-denied", "Only a regular hosted document can be watched.");
            return { path: authorizedPath, kind: "file", intent: "read", hostedDocument: true };
        } catch (error: unknown) {
            if ((error as { code?: unknown } | null)?.code === "permission-denied") throw error;
            throw watchAuthorizationError(error);
        }
    }

    try {
        const listPath = await boardFileAccess.authorize(entry.root, requestedPath, "list");
        const stats = await verifyStat(listPath);
        if (stats.isDirectory()) return { path: listPath, kind: "folder", intent: "list", hostedDocument: false };
        const readPath = await boardFileAccess.authorize(entry.root, requestedPath, "read");
        const fileStats = await verifyStat(readPath);
        if (!fileStats.isFile()) throw new BoardRpcError("permission-denied", "Only regular files and folders can be watched.");
        return { path: readPath, kind: "file", intent: "read", hostedDocument: false };
    } catch (listError: unknown) {
        if ((listError as { code?: unknown } | null)?.code === "not-found") throw listError;
        try {
            const readPath = await boardFileAccess.authorize(entry.root, requestedPath, "read");
            const stats = await verifyStat(readPath);
            if (!stats.isFile()) throw new BoardRpcError("permission-denied", "Only regular files and folders can be watched.");
            return { path: readPath, kind: "file", intent: "read", hostedDocument: false };
        } catch (readError: unknown) {
            if ((readError as { code?: unknown } | null)?.code === "not-found") throw readError;
            throw watchAuthorizationError(readError);
        }
    }
}

function removeBoardWatch(connections: BoardBridgeConnections, record: BoardWatchRecord, disposeService: boolean): void {
    connections.removeWatch(record.entry, record, disposeService);
}

async function startBoardWatch(connections: BoardBridgeConnections, entry: BoardBridgeConnection, args: unknown[]): Promise<void> {
    const [watchId, requestedPath, rawOptions] = args;
    if (!Number.isSafeInteger(watchId) || (watchId as number) <= 0) {
        throw new BoardRpcError("invalid-argument", "Watch id must be a positive integer.");
    }
    if (typeof requestedPath !== "string" || requestedPath.trim().length === 0) {
        throw new BoardRpcError("invalid-argument", "A non-empty watch path is required.");
    }
    const options = validateWatchOptions(rawOptions);
    const id = watchId as number;
    if (entry.getWatch(id)) throw new BoardRpcError("invalid-argument", "This watch id is already in use.");
    const rootKey = BoardRoot.from(entry.root).key;
    const liveCount = entry.liveWatchCount(rootKey);
    const pendingCount = entry.pendingWatchCount(rootKey);
    if (liveCount + pendingCount >= MAX_BOARD_WATCHES) {
        throw new BoardRpcError("too-many-watches", "A board can have at most 64 live watches.");
    }
    entry.reserveWatch(rootKey);
    try {
        const grant = await boardTrustService.getGrant(entry.root);
        if (!grant) throw new BoardRpcError("permission-denied", "This board is not trusted.");
        let target: Awaited<ReturnType<typeof resolveBoardWatchTarget>>;
        try { target = await resolveBoardWatchTarget(entry, requestedPath, grant); }
        catch (error: unknown) {
            if ((error as { code?: unknown } | null)?.code) throw error;
            throw watchAuthorizationError(error);
        }
        if (target.kind === "file" && options.recursive) {
            throw new BoardRpcError("invalid-argument", "Recursive watches require a folder.");
        }
        const scope = { path: target.path };
        const owner: PathWatchOwner = { kind: "board", boardRoot: entry.root, boardName: await boardName(entry) };
        const subscription = await pathWatchService.subscribe(target.path, {
            owner,
            recursive: options.recursive,
            debounceMs: options.debounceMs,
            // eslint-disable-next-line vanilla-view/no-hardcoded-ui-strings -- diagnostics label, not UI text.
            label: "board watch",
            pathFilter: (candidatePath) => watchPathInScope(scope.path, candidatePath, target.kind),
        }, (batch: PathWatchBatch) => {
            const record = entry.getWatch(id);
            if (!record || record.entry !== entry || !entry.isCurrent()) return;
            const changes: PathWatchBatch["changes"] = [];
            const seen = new Set<string>();
            const addChange = (path: string, type: "created" | "changed" | "deleted") => {
                const dedupeKey = JSON.stringify([path, type]);
                if (seen.has(dedupeKey)) return;
                seen.add(dedupeKey);
                changes.push({ path, type });
            };
            for (const change of batch.changes) {
                if (change.type === "moved") {
                    if (watchPathInScope(record.filterScope.path, change.path, record.scopeKind)) addChange(change.path, "deleted");
                    if (watchPathInScope(record.filterScope.path, change.to, record.scopeKind)) addChange(change.to, "created");
                } else {
                    addChange(change.path, change.type);
                }
            }
            try { entry.port.postMessage(frameEvent("watch", { watchId: record.watchId, batch: { ...batch, changes } })); }
            catch { /* The port may close between the identity check and post. */ }
            if (batch.ended) removeBoardWatch(connections, record, false);
        });
        if (!entry.isCurrent()) {
            subscription.dispose();
            return;
        }
        entry.addWatch({
            boardId: entry.boardId, watchId: id, entry, boardRoot: entry.root,
            requestedPath, authorizedPath: target.path, filterScope: scope,
            scopeKind: target.kind, intent: target.intent,
            hostedDocument: target.hostedDocument, recursive: options.recursive,
            serviceId: subscription.id, dispose: subscription.dispose,
        });
    } finally {
        entry.releaseWatch(rootKey);
    }
}

export function createWatchHandlers(connections: BoardBridgeConnections) {
    const handlers = {
watch: { handle: async (entry, watchId, requestedPath, options) => {
        await startBoardWatch(connections, entry, [watchId, requestedPath, options]);
    } },
unwatch: { handle: (entry, watchId) => {
        if (!Number.isSafeInteger(watchId) || (watchId as number) <= 0) {
            throw new BoardRpcError("invalid-argument", "Watch id must be a positive integer.");
        }
        const record = entry.getWatch(watchId as number);
        if (record) removeBoardWatch(connections, record, true);
    } }
    } satisfies BoardRpcSlice<WatchDomainKeys>;
    return { handlers, recheckBoardWatches: (boardRoot: string) => recheckBoardWatches(connections, boardRoot) };
}

export async function recheckBoardWatches(connections: BoardBridgeConnections, boardRoot: string): Promise<void> {
    const matching = connections.liveWatches().filter((watch) => BoardRoot.from(watch.boardRoot).equals(boardRoot));
    for (const record of matching) {
        if (!record.entry.isCurrent()) { removeBoardWatch(connections, record, true); continue; }
        const grant = await boardTrustService.getGrant(record.boardRoot);
        if (!grant) { pathWatchService.endSubscription(record.serviceId, "revoked"); continue; }
        try {
            let authorizedPath: string;
            if (record.hostedDocument) {
                authorizedPath = await boardFileAccess.authorizeHostedRead(
                    record.boardRoot,
                    record.requestedPath,
                    record.entry.hostedFilePath,
                );
                if (!record.entry.hostedFilePath
                    || normalizeWatchPath(authorizedPath)
                    !== normalizeWatchPath(await fs.promises.realpath(record.entry.hostedFilePath))) {
                    throw new BoardRpcError("permission-denied", "Hosted document access changed.");
                }
            } else authorizedPath = await boardFileAccess.authorize(record.boardRoot, record.requestedPath, record.intent);
            const stats = await fs.promises.stat(authorizedPath);
            if ((record.scopeKind === "folder" && !stats.isDirectory())
                || (record.scopeKind === "file" && !stats.isFile())
                || (record.recursive && !stats.isDirectory())) {
                throw new BoardRpcError("permission-denied", "The authorized watch target changed type.");
            }
            record.authorizedPath = authorizedPath; record.filterScope.path = authorizedPath;
        } catch { pathWatchService.endSubscription(record.serviceId, "revoked"); }
    }
}

export type WatchDomainKeys = "watch" | "unwatch";
