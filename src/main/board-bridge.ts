/**
 * Per-board bridge (; re-homed onto a `MessagePort` in
 * ).
 *
 * A board iframe has no `ipcRenderer` and no preload. Its only channel to the
 * privileged side is a `MessageChannelMain` port minted **per board** in main:
 * `createBoardPort` keeps `port2` here, wired to the RPC handler, and ships
 * `port1` to the host renderer (`hostWebContents.postMessage(eBoardPort, …,
 * [port1])`), which transfers it into the board frame (the one-time handshake).
 * Thereafter the board ↔ main talk directly over the duplex port.
 *
 * The bridge serves the in-app effects `execute()` cannot express:
 *  • `execute()` (streaming) rides `{ kind:"runner", … }` envelopes → the shared
 *    command runner (`command-runner.ts`), defaulting the cwd to the board folder;
 *  • request/reply: the native dialogs, `readFile`/`writeFile`, and `openRawLink`;
 *  • fire-and-forget: `notify`;
 *  • main → board: live theme retint (`pushThemeToBoards`).
 *
 * The board root + owner window are resolved from the per-board registry (keyed by
 * the boardId minted at the handshake), NOT from `event.sender.session` — with one
 * shared host session that can't disambiguate boards, as in the old model.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import {
    BrowserWindow,
    MessageChannelMain,
    MessagePortMain,
    WebContents,
    clipboard,
    ClipboardItem,
    dialog,
    nativeImage,
    shell,
} from "electron";
import {
    BoardFileEncoding,
    BoardCallRequest,
    BoardFireMethod,
    BoardNotifyType,
    BoardRunnerOutMsg,
    BoardRpcMethod,
    BoardThemePalette,
    BoardToMain,
    OpenFileDialogParams,
    OpenFolderDialogParams,
    SaveFileDialogParams,
    BoardFolderEntry,
    BoardFolderListOptions,
    BoardWatchOptions,
} from "../ipc/board-bridge-channels";
import type { BoardNotifyMsg } from "../ipc/board-bridge-channels";
import { RunnerChannel, RunnerKillMsg, RunnerStartMsg, RunnerStdinMsg } from "../ipc/runner-channels";
import { EventEndpoint, type PathWatchBatch, type PathWatchOwner } from "../ipc/api-types";
import {
    showOpenFileDialog,
    showOpenFolderDialog,
    showSaveFileDialog,
} from "../ipc/main/dialog-handlers";
import { getBoardRootForHost } from "./board-protocol-service";
import {
    endJobStdin,
    getJobsBySinkIds,
    JobSink,
    killJob,
    reapJobsBySinkId,
    startJobTo,
    startNodeJobTo,
    writeJobStdin,
} from "./command-runner";
import { errMessage } from "../shared/utils";
import { toWireError } from "../shared/wire-error";
import * as boardLog from "./board-log";
import { isPositiveIntegerTimeout, resolveBoardCallTimeout } from "../shared/ai-vision-timeout";
import { requestRenderer } from "./renderer-rpc";
import type { RendererRpcMethod, RendererRpcMethods } from "../ipc/renderer-rpc";
import { boardThemeMethodOf } from "../shared/board/board-call-route";
import {
    deleteBoardStorageValue,
    getBoardStorageKeys,
    getBoardStorageValue,
    setBoardStorageValue,
    validateBoardStorageKey,
    validateBoardStorageValue,
} from "./board-storage";
import { moduleServiceSupervisor } from "./module-service-supervisor";
import { boardTrustService } from "./board-trust-service";
import { boardDisplayName, readBoardManifest } from "./board-manifest-reader";
import { BoardGrant } from "../shared/board/board-grant";
import { boardFileAccess } from "./board-file-access";
import { t } from "../shared/i18n/t";
import { pathWatchService } from "./path-watch-service";
import { capabilityRouter, publicCapabilityProvider } from "./capability-router";
import { BoardRoot } from "../shared/board/board-root";
import { boardRootDigest } from "./board-root-hashes";
import { capabilityResult } from "../ipc/main/core-handlers";
import { comparePathKey, isPathInside } from "./utils";
import { onWebContentsGone } from "./webcontents-lifetime";
import type { CapabilityClientInvoke, CapabilityClientOptions } from "../ipc/capability-bus-channels";


interface FolderCursor { root: string; boardRoot: string; boardId: string; entries: BoardFolderEntry[]; offset: number; expires: number; truncated: boolean }
const folderCursors = new Map<string, FolderCursor>();
const MAX_FOLDER_PAGE_SIZE = 1000;
/** Most TypeScript projects one board frame may keep registered at once. */
const MAX_TS_PROJECTS_PER_FRAME = 8;

const MAX_FOLDER_RESULTS = 100000;
const FOLDER_CURSOR_TTL_MS = 5 * 60 * 1000;

class BoardRpcError extends Error {
    constructor(readonly code: string, message: string) { super(message); this.name = "BoardRpcError"; }
}

function rpcFailure(code: string, message: string): BoardRpcError { return new BoardRpcError(code, message); }

function asBoardRpcError(error: unknown): unknown {
    if (error instanceof BoardRpcError) return error;
    const code = (error as { code?: unknown } | null)?.code;
    return typeof code === "string" ? rpcFailure(code, errMessage(error)) : error;
}

function fileAccessError(error: unknown): Error & { code: string } {
    const existingCode = (error as { code?: unknown } | null)?.code;
    if (typeof existingCode === "string") return error as Error & { code: string };
    const code = errMessage(error).startsWith("permission-denied:")
        ? "permission-denied"
        : existingCode === "ENOENT" ? "not-found" : "io-error";
    return Object.assign(error instanceof Error ? error : new Error(errMessage(error)), { code });
}

async function boardName(entry: BoardPortEntry): Promise<string> {
    const root = BoardRoot.from(entry.root);
    return boardDisplayName(root, await readBoardManifest(root));
}

async function getBoardFileAccess(entry: BoardPortEntry, requestedPath: unknown): Promise<{ read: boolean; write: boolean }> {
    if (typeof requestedPath !== "string" || requestedPath.trim().length === 0) {
        throw rpcFailure("invalid-argument", "A file path is required.");
    }
    const grant = await boardTrustService.getGrant(entry.root);
    if (!grant) return { read: false, write: false };
    const canAccess = async (intent: "read" | "write"): Promise<boolean> => {
        try {
            await boardFileAccess.authorize(entry.root, requestedPath, intent);
            return true;
        } catch (error: unknown) {
            if (errMessage(error).startsWith("permission-denied:")) return false;
            if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return false;
            throw error;
        }
    };
    const [read, write] = await Promise.all([canAccess("read"), canAccess("write")]);
    return { read, write };
}

function parseFolderOptions(value: unknown): Required<Pick<BoardFolderListOptions, "recursive" | "limit">> & Pick<BoardFolderListOptions, "masks" | "cursor"> {
    if (value === undefined) value = {};
    if (!value || typeof value !== "object" || Array.isArray(value)) throw rpcFailure("invalid-argument", "Folder listing options must be an object.");
    const options = value as BoardFolderListOptions;
    if (options.recursive !== undefined && typeof options.recursive !== "boolean") throw rpcFailure("invalid-argument", "recursive must be a boolean.");
    if (options.limit !== undefined && (!Number.isInteger(options.limit) || options.limit < 1)) throw rpcFailure("invalid-argument", "limit must be a positive integer.");
    if ((options.limit ?? 500) > MAX_FOLDER_PAGE_SIZE) throw rpcFailure("too-many-entries", `A folder page can contain at most ${MAX_FOLDER_PAGE_SIZE} entries.`);
    if (options.cursor !== undefined && typeof options.cursor !== "string") throw rpcFailure("invalid-argument", "cursor must be a string.");
    if (options.masks !== undefined && (!Array.isArray(options.masks) || options.masks.length > 32
        || options.masks.some((mask) => typeof mask !== "string" || mask.length > 256 || /[\\/]/.test(mask)))) {
        throw rpcFailure("invalid-argument", "masks must contain at most 32 basename masks of at most 256 characters using only * and ? as wildcard operators.");
    }
    return { recursive: options.recursive ?? false, limit: options.limit ?? MAX_FOLDER_PAGE_SIZE, masks: options.masks, cursor: options.cursor };
}

function folderMaskMatches(name: string, masks: string[] | undefined): boolean {
    if (!masks?.length) return true;
    const escaped = masks.map((mask) => [...mask].map((character) => character === "*" ? ".*"
        : character === "?" ? "."
            : character.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(""));
    const flags = process.platform === "win32" ? "i" : "";
    return escaped.some((mask) => new RegExp(`^${mask}$`, flags).test(name));
}

async function listBoardFolder(entry: BoardPortEntry, requestedPath: unknown, rawOptions: unknown): Promise<unknown> {
    if (typeof requestedPath !== "string") throw rpcFailure("invalid-argument", "A folder path is required.");
    const options = parseFolderOptions(rawOptions);
    const grant = await boardTrustService.getGrant(entry.root);
    if (!grant) throw Object.assign(BoardGrant.deny("fileSystem"), { code: "permission-denied" });
    let cursor: FolderCursor | undefined;
    if (options.cursor) {
        cursor = folderCursors.get(options.cursor);
        if (!cursor) throw rpcFailure("invalid-argument", "The folder cursor is invalid.");
        folderCursors.delete(options.cursor);
        if (cursor.expires < Date.now()) throw rpcFailure("cursor-expired", "The folder cursor has expired.");
        if (!BoardRoot.from(cursor.boardRoot).equals(entry.root)) throw rpcFailure("invalid-argument", "The folder cursor belongs to another board.");
        if (cursor.boardId !== entry.boardId) throw rpcFailure("invalid-argument", "The folder cursor belongs to another board frame.");
        try { await boardFileAccess.authorize(entry.root, cursor.root, "list"); }
        catch { folderCursors.delete(options.cursor); throw Object.assign(BoardGrant.deny("fileSystem"), { code: "permission-denied" }); }
    } else {
        let root: string;
        try { root = await boardFileAccess.authorize(entry.root, requestedPath, "list"); }
        catch (error: unknown) {
            const errorCode = (error as NodeJS.ErrnoException)?.code;
            if (errorCode === "ENOENT") throw rpcFailure("not-found", "The folder does not exist.");
            throw Object.assign(error instanceof Error ? error : new Error("Folder access denied."), { code: "permission-denied" });
        }
        let rootStat;
        try { rootStat = await fs.promises.stat(root); } catch { throw rpcFailure("not-found", "The folder does not exist."); }
        if (!rootStat.isDirectory()) throw rpcFailure("not-directory", "The requested path is not a folder.");
        const entries: BoardFolderEntry[] = [];
        let truncated = false;
        const visit = async (directory: string, depth: number): Promise<void> => {
            if (depth > 32) throw rpcFailure("depth-limit", "Folder recursion exceeds the depth limit of 32.");
            const authorizedDirectory = await boardFileAccess.authorize(entry.root, directory, "list");
            let children;
            try { children = await fs.promises.readdir(authorizedDirectory, { withFileTypes: true }); }
            catch (error: unknown) { throw rpcFailure("io-error", errMessage(error, "Could not read the folder.")); }
            for (const child of children) {
                const childPath = path.join(authorizedDirectory, child.name);
                const lstat = await fs.promises.lstat(childPath);
                if (lstat.isSymbolicLink()) continue;
                let canonical: string;
                try { canonical = await boardFileAccess.authorize(entry.root, childPath, child.isDirectory() ? "list" : "read"); }
                catch { throw Object.assign(BoardGrant.deny("fileSystem"), { code: "permission-denied" }); }
                const stat = await fs.promises.stat(canonical);
                if (stat.isDirectory() || folderMaskMatches(child.name, options.masks)) {
                    if (entries.length >= MAX_FOLDER_RESULTS) { truncated = true; return; }
                    entries.push({ name: child.name, path: canonical, isDirectory: stat.isDirectory(), size: stat.isDirectory() ? 0 : stat.size, mtime: stat.mtimeMs });
                }
                if (options.recursive && stat.isDirectory()) await visit(canonical, depth + 1);
                if (truncated) return;
            }
        };
        try { await visit(root, 0); }
        catch (error: unknown) { if (error instanceof BoardRpcError) throw error; throw rpcFailure("io-error", errMessage(error, "Could not list the folder.")); }
        cursor = { root, boardRoot: entry.root, boardId: entry.boardId, entries, offset: 0, expires: Date.now() + FOLDER_CURSOR_TTL_MS, truncated };
    }
    const end = Math.min(cursor.offset + options.limit, cursor.entries.length);
    const pageEntries: BoardFolderEntry[] = [];
    for (const item of cursor.entries.slice(cursor.offset, end)) {
        try { await boardFileAccess.authorize(entry.root, item.path, item.isDirectory ? "list" : "read"); pageEntries.push(item); }
        catch { throw Object.assign(BoardGrant.deny("fileSystem"), { code: "permission-denied" }); }
    }
    cursor.offset = end;
    let nextCursor: string | undefined;
    if (end < cursor.entries.length) { nextCursor = crypto.randomUUID(); folderCursors.set(nextCursor, cursor); }
    return { entries: pageEntries, ...(nextCursor ? { nextCursor } : {}), truncated: cursor.truncated };
}

interface BoardPortEntry {
    /** Per-frame identity used to bind paged listing cursors. */
    boardId: string;
    /** Main's end of the per-board channel. */
    port: MessagePortMain;
    /** Absolute board root — default `execute()` cwd + relative-path base. */
    root: string;
    /** The board's `board://` host. */
    host: string;
     /** The owning `BoardEditorModel` ID, stable across mounts/reloads of
     *  the same board tab, unlike the per-mount `boardId`. Groups job sinks for
     *  busy retention + final reaping. */
    ownerId: string;
    /** The host renderer window — owner for dialogs/links/notify/log. */
    hostWebContents: WebContents;
    /** Exact local file currently exposed to this board frame, if any. */
    hostedFilePath: string | null;
    /** Per-load identity prevents delayed updates from changing a replacement port. */
    token: string;
     /** Set when the shim's "connected" message arrives. */
    connected?: boolean;
    /** Mode-D handshake watchdog; cleared on connect / dispose. */
    watchdog?: ReturnType<typeof setTimeout>;
    /** Normalized roots of the TypeScript projects this frame registered. */
    tsProjectRoots: Set<string>;
    capabilityRequests: Map<string, AbortController>;
}

async function hostRequest<M extends RendererRpcMethod>(
    entry: BoardPortEntry,
    method: M,
    params: RendererRpcMethods[M]["params"],
    timeoutMs?: number,
): Promise<RendererRpcMethods[M]["result"]> {
    try {
        return await requestRenderer(method, params, { webContents: entry.hostWebContents }, timeoutMs);
    } catch (error: unknown) {
        throw new Error(errMessage(error));
    }
}

/** Live board ports keyed by the per-mount boardId minted at the handshake. */
const boardPorts = new Map<string, BoardPortEntry>();
interface BoardWatchRecord {
    boardId: string;
    watchId: number;
    entry: BoardPortEntry;
    boardRoot: string;
    requestedPath: string;
    authorizedPath: string;
    filterScope: { path: string };
    scopeKind: "file" | "folder";
    intent: "read" | "list";
    hostedDocument: boolean;
    recursive: boolean;
    serviceId: string;
    dispose: () => void;
}
const boardWatches = new Map<string, BoardWatchRecord>();
const MAX_BOARD_WATCHES = 64;
const BOARD_CALL_TIMEOUT_MIN_MS = 1_000;
const BOARD_CALL_TIMEOUT_MAX_MS = 3_600_000;
/** Unset until the renderer pushes one; see the same reasoning in `src/renderer/api/boards.ts`. */
let boardCallTimeoutMs: number | undefined;

function boardWatchKey(boardId: string, watchId: number): string { return `${boardId}:${watchId}`; }

function normalizeWatchPath(value: string): string {
    const normalized = path.normalize(value);
    return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function watchPathInScope(scopePath: string, candidatePath: string, kind: "file" | "folder"): boolean {
    if (kind === "file") return normalizeWatchPath(scopePath) === normalizeWatchPath(candidatePath);
    return isPathInside(scopePath, candidatePath);
}

// ── Busy owners — job retention across mounts  ────────────────────────
// A board that called `persephone.setBoardBusy(true)` keeps its spawned jobs when
// its iframe unmounts (page navigation / reload): `disposeBoardPort` skips reaping
// for a busy owner, and the sinkIds accumulate under the owner until a final
// `reapBoardOwner` (model dispose = page close), a non-busy port dispose, or a
// host-renderer crash (`reapHost`).

/** Every sinkId (per-mount boardId) ever minted for an owner, until reaped —
 *  plus the host webContents id for crash reaping of kept (port-less) jobs. */
const ownerSinks = new Map<string, { sinkIds: Set<string>; hostWcId: number }>();

/** Owners whose jobs must survive port disposal. Mirrors the renderer-side
 *  `BoardEditorModel.state.busy` (set via the `setBoardBusy` endpoint). */
const busyOwners = new Set<string>();

function indexOwnerSink(ownerId: string, sinkId: string, hostWcId: number): void {
    let entry = ownerSinks.get(ownerId);
    if (!entry) {
        entry = { sinkIds: new Set(), hostWcId };
        ownerSinks.set(ownerId, entry);
    }
    entry.sinkIds.add(sinkId);
    entry.hostWcId = hostWcId;
}

/** Tree-kill every job (kept + current) of a board owner and forget it.
 *  Idempotent. The final-teardown path: model dispose (page close), a non-busy
 *  port dispose, host crash, or an explicit busy=false with no live port. */
export function reapBoardOwner(ownerId: string): void {
    for (const record of [...boardWatches.values()]) {
        if (record.entry.ownerId === ownerId) removeBoardWatch(record, true);
    }
    const entry = ownerSinks.get(ownerId);
    if (entry) {
        for (const sinkId of entry.sinkIds) reapJobsBySinkId(sinkId);
        ownerSinks.delete(ownerId);
    }
    busyOwners.delete(ownerId);
}

/** Mirror the renderer's busy flag. Clearing busy with no live port for
 *  the owner (defensive — busy normally changes only while the board is mounted)
 *  reaps immediately, since no future unmount would. */
export function setBoardBusy(ownerId: string, busy: boolean): void {
    if (busy) {
        busyOwners.add(ownerId);
        return;
    }
    busyOwners.delete(ownerId);
    const hasLivePort = [...boardPorts.values()].some((e) => e.ownerId === ownerId);
    if (!hasLivePort) reapBoardOwner(ownerId);
}

export function setBoardCallTimeout(timeoutMs: number): void {
    if (!Number.isFinite(timeoutMs) || !Number.isInteger(timeoutMs)
        || timeoutMs < BOARD_CALL_TIMEOUT_MIN_MS || timeoutMs > BOARD_CALL_TIMEOUT_MAX_MS) {
        throw new TypeError(`boards.callTimeoutMs must be an integer from ${BOARD_CALL_TIMEOUT_MIN_MS} to ${BOARD_CALL_TIMEOUT_MAX_MS}.`);
    }
    boardCallTimeoutMs = timeoutMs;
}

/** Host webContents we've wired load-failure + crash/destroy reaping on (once each). */
const wiredHosts = new Set<number>();

/** Mode-D handshake watchdog window: a healthy board connects in tens of ms; this
 *  is generous against a slow first paint while still catching a dead bridge. */
const BOARD_HANDSHAKE_TIMEOUT_MS = 5000;

/**
 * The BrowserWindow that owns a board's host renderer. With the iframe model the
 * requester is a real window (not a `<webview>` guest), so `fromWebContents` is
 * reliable; keep the focused/any fallbacks defensively.
 */
function ownerWindow(hostWebContents: WebContents): BrowserWindow | undefined {
    return (
        BrowserWindow.fromWebContents(hostWebContents) ??
        BrowserWindow.getFocusedWindow() ??
        BrowserWindow.getAllWindows()[0] ??
        undefined
    );
}

/** A runner sink that streams a board's job output over its port. */
function portSink(entry: BoardPortEntry, boardId: string): JobSink {
    return {
        id: boardId,
        send(channel: RunnerChannel, payload: unknown) {
            try {
                entry.port.postMessage({ kind: "runner", channel, msg: payload });
            } catch {
                // port closed — ignore
            }
        },
    };
}

/** Run a request/reply RPC and return its result (thrown errors reject the caller). */
/** Validate a board's `encoding` argument. Absent → "utf8" (the historical default).
 *  An UNKNOWN value throws rather than falling back: the old code coerced anything that
 *  wasn't "base64" to "utf8", so a board asking a too-old Persephone for "binary" got a
 *  UTF-8 string back — silently mangled bytes instead of an error. Boards gate on
 *  `minAppVersion`, so a loud failure here only ever means a genuine typo. */
function fileEncoding(value: unknown): BoardFileEncoding {
    if (value == null) return "utf8";
    if (value === "utf8" || value === "base64" || value === "binary") return value;
    throw new Error(
        `Unknown file encoding "${String(value)}" — expected "utf8", "base64" or "binary".`,
    );
}

/** The bytes a board sent for a "binary" write. Structured clone delivers a Uint8Array;
 *  accept a bare ArrayBuffer too, since that is the easy thing for a board to pass. */
function toBytes(data: unknown, requirement = 'writeFile with encoding "binary"'): Uint8Array {
    if (data instanceof Uint8Array) return data;
    if (data instanceof ArrayBuffer) return new Uint8Array(data);
    if (ArrayBuffer.isView(data)) {
        return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    }
    throw new Error(`${requirement} needs a Uint8Array or ArrayBuffer.`);
}

function validateWatchOptions(value: unknown): Required<Pick<BoardWatchOptions, "recursive" | "debounceMs">> {
    if (value !== undefined && (!value || typeof value !== "object" || Array.isArray(value)
        || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null))) {
        throw rpcFailure("invalid-argument", "Watch options must be a plain object.");
    }
    const options = (value ?? {}) as BoardWatchOptions;
    if (options.recursive !== undefined && typeof options.recursive !== "boolean") {
        throw rpcFailure("invalid-argument", "Watch recursive must be a boolean.");
    }
    if (options.debounceMs !== undefined && (!Number.isInteger(options.debounceMs)
        || options.debounceMs < 50 || options.debounceMs > 60_000)) {
        throw rpcFailure("invalid-argument", "Watch debounceMs must be an integer from 50 to 60000.");
    }
    return { recursive: options.recursive ?? false, debounceMs: options.debounceMs ?? 300 };
}

function watchAuthorizationError(error: unknown): BoardRpcError {
    const code = (error as NodeJS.ErrnoException | null)?.code;
    return code === "ENOENT"
        ? rpcFailure("not-found", "The watch target does not exist.")
        : rpcFailure("permission-denied", "The board is not authorized to watch this path.");
}

async function resolveBoardWatchTarget(entry: BoardPortEntry, requestedPath: string, grant: NonNullable<Awaited<ReturnType<typeof boardTrustService.getGrant>>>): Promise<{
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
                throw rpcFailure("permission-denied", "Only the exact hosted document can be watched.");
            }
            const stats = await verifyStat(authorizedPath);
            if (!stats.isFile()) throw rpcFailure("permission-denied", "Only a regular hosted document can be watched.");
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
        if (!fileStats.isFile()) throw rpcFailure("permission-denied", "Only regular files and folders can be watched.");
        return { path: readPath, kind: "file", intent: "read", hostedDocument: false };
    } catch (listError: unknown) {
        if ((listError as { code?: unknown } | null)?.code === "not-found") throw listError;
        try {
            const readPath = await boardFileAccess.authorize(entry.root, requestedPath, "read");
            const stats = await verifyStat(readPath);
            if (!stats.isFile()) throw rpcFailure("permission-denied", "Only regular files and folders can be watched.");
            return { path: readPath, kind: "file", intent: "read", hostedDocument: false };
        } catch (readError: unknown) {
            if ((readError as { code?: unknown } | null)?.code === "not-found") throw readError;
            throw watchAuthorizationError(readError);
        }
    }
}

type BoardRpcHandler = (entry: BoardPortEntry, args: unknown[]) => Promise<unknown> | unknown;

const pendingWatchReservations = new Map<string, number>();

function removeBoardWatch(record: BoardWatchRecord, disposeService: boolean): void {
    const key = boardWatchKey(record.boardId, record.watchId);
    if (boardWatches.get(key) !== record) return;
    boardWatches.delete(key);
    if (disposeService) record.dispose();
}

function cleanupBoardWatches(boardId: string): void {
    for (const record of [...boardWatches.values()]) {
        if (record.boardId === boardId) removeBoardWatch(record, true);
    }
}

async function startBoardWatch(entry: BoardPortEntry, args: unknown[]): Promise<void> {
    const [watchId, requestedPath, rawOptions] = args;
    if (!Number.isSafeInteger(watchId) || (watchId as number) <= 0) {
        throw rpcFailure("invalid-argument", "Watch id must be a positive integer.");
    }
    if (typeof requestedPath !== "string" || requestedPath.trim().length === 0) {
        throw rpcFailure("invalid-argument", "A non-empty watch path is required.");
    }
    const options = validateWatchOptions(rawOptions);
    const key = boardWatchKey(entry.boardId, watchId as number);
    if (boardWatches.has(key)) throw rpcFailure("invalid-argument", "This watch id is already in use.");
    const grant = await boardTrustService.getGrant(entry.root);
    if (!grant) throw rpcFailure("permission-denied", "This board is not trusted.");
    let target: Awaited<ReturnType<typeof resolveBoardWatchTarget>>;
    try { target = await resolveBoardWatchTarget(entry, requestedPath, grant); }
    catch (error: unknown) {
        if ((error as { code?: unknown } | null)?.code) throw error;
        throw watchAuthorizationError(error);
    }
    if (target.kind === "file" && options.recursive) {
        throw rpcFailure("invalid-argument", "Recursive watches require a folder.");
    }

    const rootKey = BoardRoot.from(entry.root).key;
    const liveCount = [...boardWatches.values()].filter((watch) => BoardRoot.from(watch.boardRoot).key === rootKey).length;
    const pendingCount = pendingWatchReservations.get(rootKey) ?? 0;
    if (liveCount + pendingCount >= MAX_BOARD_WATCHES) {
        throw rpcFailure("too-many-watches", "A board can have at most 64 live watches.");
    }
    pendingWatchReservations.set(rootKey, pendingCount + 1);
    try {
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
            const record = boardWatches.get(key);
            if (!record || record.entry !== entry || boardPorts.get(entry.boardId) !== entry) return;
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
            try { entry.port.postMessage({ kind: "watch", watchId: record.watchId, batch: { ...batch, changes } }); }
            catch { /* The port may close between the identity check and post. */ }
            if (batch.ended) removeBoardWatch(record, false);
        });
        if (boardPorts.get(entry.boardId) !== entry) {
            subscription.dispose();
            return;
        }
        boardWatches.set(key, {
            boardId: entry.boardId, watchId: watchId as number, entry, boardRoot: entry.root,
            requestedPath, authorizedPath: target.path, filterScope: scope,
            scopeKind: target.kind, intent: target.intent,
            hostedDocument: target.hostedDocument, recursive: options.recursive,
            serviceId: subscription.id, dispose: subscription.dispose,
        });
    } finally {
        const pending = pendingWatchReservations.get(rootKey) ?? 1;
        if (pending <= 1) pendingWatchReservations.delete(rootKey);
        else pendingWatchReservations.set(rootKey, pending - 1);
    }
}

export async function recheckBoardWatches(boardRoot: string): Promise<void> {
    const matching = [...boardWatches.values()].filter((watch) => BoardRoot.from(watch.boardRoot).equals(boardRoot));
    for (const record of matching) {
        if (boardPorts.get(record.boardId) !== record.entry) {
            removeBoardWatch(record, true);
            continue;
        }
        const grant = await boardTrustService.getGrant(record.boardRoot);
        if (!grant) {
            pathWatchService.endSubscription(record.serviceId, "revoked");
            continue;
        }
        try {
            let authorizedPath: string;
            if (record.hostedDocument) {
                authorizedPath = await boardFileAccess.authorizeHostedRead(
                    record.boardRoot, record.requestedPath, record.entry.hostedFilePath,
                );
                if (!record.entry.hostedFilePath || normalizeWatchPath(authorizedPath)
                    !== normalizeWatchPath(await fs.promises.realpath(record.entry.hostedFilePath))) {
                    throw rpcFailure("permission-denied", "Hosted document access changed.");
                }
            } else {
                authorizedPath = await boardFileAccess.authorize(record.boardRoot, record.requestedPath, record.intent);
            }
            const stats = await fs.promises.stat(authorizedPath);
            if ((record.scopeKind === "folder" && !stats.isDirectory())
                || (record.scopeKind === "file" && !stats.isFile())
                || (record.recursive && !stats.isDirectory())) {
                throw rpcFailure("permission-denied", "The authorized watch target changed type.");
            }
            record.authorizedPath = authorizedPath;
            record.filterScope.path = authorizedPath;
        } catch {
            pathWatchService.endSubscription(record.serviceId, "revoked");
        }
    }
}


/** Board RPC handlers are exhaustive over the public bridge contract. */
const boardRpcHandlers: Record<BoardRpcMethod, BoardRpcHandler> = {
    async openRawLink(entry, args) {
        const href = args[0];
        const rawOptions = args[1];
        if (typeof href !== "string" || !href.trim()) {
            throw rpcFailure("invalid-argument", "A non-empty link is required.");
        }
        const trimmedHref = href.trim();
        const isAbsolutePath = path.isAbsolute(href);
        const isPngDataUrl = /^data:image\/png;base64,/i.test(trimmedHref);
        let parsedUrl: URL | undefined;
        if (!isAbsolutePath && !isPngDataUrl) {
            try { parsedUrl = new URL(trimmedHref); } catch { /* Not a URL; reject below. */ }
        }
        const allowedProtocol = parsedUrl && ["file:", "http:", "https:", "mailto:", "torrent:"].includes(parsedUrl.protocol.toLowerCase());
        if (!isAbsolutePath && !isPngDataUrl && !allowedProtocol) {
            throw rpcFailure("invalid-argument", "openRawLink accepts only absolute paths, file:, http:, https:, mailto:, data:image/png;base64, and torrent: links.");
        }
        if (rawOptions !== undefined && (!rawOptions || typeof rawOptions !== "object" || Array.isArray(rawOptions))) {
            throw rpcFailure("invalid-argument", "openRawLink options must be an object.");
        }
        const options = (rawOptions ?? {}) as {
            editor?: unknown; revealLine?: unknown; highlightText?: unknown; reuseKey?: unknown;
        };
        if (options.editor !== undefined && typeof options.editor !== "string") {
            throw rpcFailure("invalid-argument", "openRawLink editor must be a string.");
        }
        if (options.revealLine !== undefined
            && (!Number.isSafeInteger(options.revealLine) || (options.revealLine as number) < 1)) {
            throw rpcFailure("invalid-argument", "openRawLink revealLine must be a positive integer.");
        }
        if (options.highlightText !== undefined && typeof options.highlightText !== "string") {
            throw rpcFailure("invalid-argument", "openRawLink highlightText must be a string.");
        }
        if (options.reuseKey !== undefined && typeof options.reuseKey !== "string") {
            throw rpcFailure("invalid-argument", "openRawLink reuseKey must be a string.");
        }
        const editor = typeof options.editor === "string" ? options.editor : undefined;
        const revealLine = typeof options.revealLine === "number" ? options.revealLine : undefined;
        const highlightText = typeof options.highlightText === "string" ? options.highlightText : undefined;
        const reuseKey = typeof options.reuseKey === "string" ? options.reuseKey : undefined;
        let target = href;
        if (/^file:/i.test(trimmedHref)) {
            try { target = fileURLToPath(trimmedHref); }
            catch (error: unknown) { throw rpcFailure("invalid-argument", errMessage(error, "Invalid file URL.")); }
        }
        ownerWindow(entry.hostWebContents)?.focus();
        await hostRequest(entry, "openRawLink", { target, editor, revealLine, highlightText, reuseKey, boardRoot: entry.root });
        return undefined;
    },
    async openBoard(entry, args) {
        const folder = args[0];
        if (typeof folder !== "string" || !folder.trim()) {
            throw rpcFailure("invalid-argument", "A non-empty board folder path is required.");
        }
        let canonicalFolder: string;
        try {
            canonicalFolder = await boardFileAccess.authorize(entry.root, folder, "list");
        } catch (error: unknown) {
            const errorCode = (error as NodeJS.ErrnoException)?.code;
            if (errorCode === "ENOENT") throw rpcFailure("not-found", "The board folder does not exist.");
            if (error instanceof Error && error.message === BoardGrant.deny("fileSystem").message) {
                throw Object.assign(error, { code: "permission-denied" });
            }
            throw error;
        }
        await hostRequest(entry, "openBoard", { folder: canonicalFolder });
        return undefined;
    },
    async openFileDialog(entry, args) {
        await boardFileAccess.requireDialogPermission(entry.root);
        const result = await showOpenFileDialog(ownerWindow(entry.hostWebContents), (args[0] as OpenFileDialogParams) ?? {});
        await boardFileAccess.recordPickedPaths(entry.root, result, false);
        return result;
    },
    async saveFileDialog(entry, args) {
        await boardFileAccess.requireDialogPermission(entry.root);
        const result = await showSaveFileDialog(ownerWindow(entry.hostWebContents), (args[0] as SaveFileDialogParams) ?? {});
        await boardFileAccess.recordPickedPaths(entry.root, result, false);
        return result;
    },
    async openFolderDialog(entry, args) {
        await boardFileAccess.requireDialogPermission(entry.root);
        const result = await showOpenFolderDialog(ownerWindow(entry.hostWebContents), (args[0] as OpenFolderDialogParams) ?? {});
        await boardFileAccess.recordPickedPaths(entry.root, result, true);
        return result;
    },
    async listFolder(entry, args) { return listBoardFolder(entry, args[0], args[1]); },
    async rememberFolder(entry, args) {
        const requestedPath = args[0];
        if (typeof requestedPath !== "string") throw rpcFailure("invalid-argument", "A folder path is required.");
        let plan;
        try { plan = await boardFileAccess.planRemember(entry.root, "folder", requestedPath); }
        catch (error: unknown) { throw asBoardRpcError(error); }
        if (plan.kind === "covered") return true;
        if (plan.kind === "declined") return false;
        const response = await dialog.showMessageBox(ownerWindow(entry.hostWebContents), {
            type: "question", title: t("board.rememberFolderTitle"),
            message: t("board.rememberFolderPrompt", { name: await boardName(entry) }),
            detail: t("board.rememberFolderDetail", { path: plan.path, root: entry.root }),
            buttons: [t("board.rememberFolderAllow"), t("board.rememberCancel")], defaultId: 1, cancelId: 1, noLink: true,
        });
        if (response.response !== 0) return false;
        await boardFileAccess.remember(entry.root, "folder", plan.path);
        return true;
    },
    async rememberFile(entry, args) {
        const requestedPath = args[0];
        if (typeof requestedPath !== "string") throw rpcFailure("invalid-argument", "A file path is required.");
        let plan;
        try { plan = await boardFileAccess.planRemember(entry.root, "file", requestedPath); }
        catch (error: unknown) { throw asBoardRpcError(error); }
        if (plan.kind === "covered") return true;
        if (plan.kind === "declined") return false;
        const response = await dialog.showMessageBox(ownerWindow(entry.hostWebContents), {
            type: "question", title: t("board.rememberFileTitle"),
            message: t("board.rememberFilePrompt", { name: await boardName(entry) }),
            detail: t("board.rememberFileDetail", { path: plan.path, root: entry.root }),
            buttons: [t("board.rememberFileAllow"), t("board.rememberCancel")], defaultId: 1, cancelId: 1, noLink: true,
        });
        if (response.response !== 0) return false;
        await boardFileAccess.remember(entry.root, "file", plan.path);
        return true;
    },
    async getFileAccess(entry, args) { return getBoardFileAccess(entry, args[0]); },
    async readFile(entry, args) {
        const requestedPath = args[0] as string;
        let filePath: string;
        try {
            filePath = await boardFileAccess.authorizeHostedRead(entry.root, requestedPath, entry.hostedFilePath);
        } catch (error: unknown) { throw fileAccessError(error); }
        const encoding = fileEncoding(args[1]);
        let buf: Buffer;
        try { buf = await fs.promises.readFile(filePath); }
        catch (error: unknown) { throw fileAccessError(error); }
        if (encoding === "binary") {
            return new Uint8Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
        }
        return buf.toString(encoding);
    },
    async writeFile(entry, args) {
        const requestedPath = args[0] as string;
        let filePath: string;
        try { filePath = await boardFileAccess.authorize(entry.root, requestedPath, "write"); }
        catch (error: unknown) { throw fileAccessError(error); }
        const encoding = fileEncoding(args[2]);
        const data = args[1];
        try {
            await boardFileAccess.authorize(entry.root, path.dirname(requestedPath), "write");
            await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
        } catch {
            const parentStat = await fs.promises.stat(path.dirname(filePath)).catch((): undefined => undefined);
            if (!parentStat?.isDirectory()) throw rpcFailure("permission-denied", "A file grant does not authorize creating its parent folder.");
        }
        let checkedPath: string;
        try { checkedPath = await boardFileAccess.authorize(entry.root, requestedPath, "write"); }
        catch (error: unknown) { throw fileAccessError(error); }
        const existing = await fs.promises.lstat(checkedPath).catch((): undefined => undefined);
        if (existing && !existing.isFile()) throw rpcFailure("permission-denied", "The write target must be a regular file.");
        const body = encoding === "binary"
            ? Buffer.from(toBytes(data))
            : Buffer.from((data as string) ?? "", encoding);
        try { await fs.promises.writeFile(checkedPath, body); }
        catch (error: unknown) { throw fileAccessError(error); }
    },
    // Recycle Bin rather than unlink, so a mistaken delete can be restored; authorized like a write.
    async trashFile(entry, args) {
        const requestedPath = args[0] as string;
        let checkedPath: string;
        try {
            await boardFileAccess.authorize(entry.root, requestedPath, "write");
            checkedPath = await boardFileAccess.authorize(entry.root, requestedPath, "write");
        } catch (error: unknown) { throw fileAccessError(error); }
        const existing = await fs.promises.lstat(checkedPath).catch((): undefined => undefined);
        if (!existing) throw rpcFailure("not-found", "The file does not exist.");
        if (!existing.isFile()) throw rpcFailure("permission-denied", "Only a regular file can be moved to the Recycle Bin.");
        try { await shell.trashItem(checkedPath); }
        catch (error: unknown) { throw fileAccessError(error); }
    },
    async registerTypeScriptProject(entry, args) {
        const requested = args[0];
        if (typeof requested !== "string" || !requested.trim()) throw rpcFailure("invalid-argument", "A project folder path is required.");
        let authorized: string; // realpath: used ONLY for the permission gate and the directory check
        try { authorized = await boardFileAccess.authorize(entry.root, requested, "list"); }
        catch (error: unknown) { throw fileAccessError(error); }
        // The renderer root keeps the board's own spelling so it matches the paths pages are opened with.
        const root = path.resolve(entry.root, requested);
        const stats = await fs.promises.stat(authorized).catch((): undefined => undefined);
        if (!stats?.isDirectory()) throw rpcFailure("not-directory", "The project path is not a folder.");
        const key = comparePathKey(root);
        if (entry.tsProjectRoots.size >= MAX_TS_PROJECTS_PER_FRAME && !entry.tsProjectRoots.has(key)) {
            throw rpcFailure("limit", "Too many TypeScript projects registered by this board.");
        }
        await hostRequest(entry, "registerTsProject", { root, owner: entry.boardId });
        entry.tsProjectRoots.add(key);
        return undefined;
    },
    async unregisterTypeScriptProject(entry, args) {
        const requested = args[0];
        if (typeof requested !== "string" || !requested.trim()) throw rpcFailure("invalid-argument", "A project folder path is required.");
        // Only removes this frame's own registration; the folder may already be gone, so no realpath or permission check.
        const root = path.resolve(entry.root, requested);
        await hostRequest(entry, "unregisterTsProject", { root, owner: entry.boardId });
        entry.tsProjectRoots.delete(comparePathKey(root));
        return undefined;
    },
    async watch(entry, args) { await startBoardWatch(entry, args); },
    unwatch(entry, args) {
        const watchId = args[0];
        if (!Number.isSafeInteger(watchId) || (watchId as number) <= 0) {
            throw rpcFailure("invalid-argument", "Watch id must be a positive integer.");
        }
        const record = boardWatches.get(boardWatchKey(entry.boardId, watchId as number));
        if (record) removeBoardWatch(record, true);
    },
    getJobs(entry) {
        const owner = ownerSinks.get(entry.ownerId);
        return owner ? getJobsBySinkIds(owner.sinkIds) : [];
    },
    serviceRequest: (entry, args) => moduleServiceSupervisor.request(
        entry.root,
        crypto.randomUUID(),
        args[0],
    ),
    serviceOpenChannel: (entry, args) => moduleServiceSupervisor.openChannel(
        entry.root, entry.hostWebContents, entry.boardId, args[0],
    ),
    capabilityList: (entry) => capabilityResult(() => capabilityRouter.list({ kind: "board-page", provider: boardRootDigest(BoardRoot.from(entry.root)) }).map(publicCapabilityProvider)),
    capabilityProviders: (entry, args) => capabilityResult(() => capabilityRouter.providers({ kind: "board-page", provider: boardRootDigest(BoardRoot.from(entry.root)) }, args[0] as string).map(publicCapabilityProvider)),
    capabilityGet: (entry, args) => capabilityResult(() => {
        const bound = capabilityRouter.resolve({ kind: "board-page", provider: boardRootDigest(BoardRoot.from(entry.root)) }, args[0] as string, args[1] as CapabilityClientOptions | undefined);
        return bound ? publicCapabilityProvider(bound.registration) : null;
    }),
    capabilityInvoke: (entry, args) => capabilityResult(async () => {
        const request = args[0] as CapabilityClientInvoke;
        if (!request || typeof request.requestId !== "string" || !request.requestId || request.requestId.length > 256 || typeof request.method !== "string" || !Array.isArray(request.args)) throw rpcFailure("rejected", "Invalid capability request.");
        if (entry.capabilityRequests.has(request.requestId)) throw rpcFailure("rejected", "Duplicate capability request id.");
        const bound = capabilityRouter.bindKey({ kind: "board-page", provider: boardRootDigest(BoardRoot.from(entry.root)) }, request.key, request.filter);
        if (!bound || !bound.registration.methods[request.method]) throw rpcFailure("no-handler", "Capability handler unavailable.");
        const controller = new AbortController();
        entry.capabilityRequests.set(request.requestId, controller);
        const channel = bound.registration.methods[request.method].kind === "channel";
        let openedChannel = false;
        try {
            const invocation = capabilityRouter.createInvocationContext(bound, { signal: controller.signal, owner: entry.hostWebContents, target: entry.hostWebContents });
            try {
                const value = await capabilityRouter.invoke(bound, request.method, request.args, { invocation, target: entry.hostWebContents,
                    ...(channel ? { channelDelivery: { kind: "board-frame", webContents: entry.hostWebContents, boardId: entry.boardId } } : {}) });
                if (channel) {
                    const opened = value as { channelId: string; onClose: (listener: () => void) => () => void };
                    openedChannel = true;
                    opened.onClose(() => entry.capabilityRequests.delete(request.requestId));
                    return { channelId: opened.channelId };
                }
                return value;
            } finally { if (!openedChannel) invocation.dispose(); }
        } finally { if (!openedChannel) entry.capabilityRequests.delete(request.requestId); }
    }),
    capabilityCancel: (entry, args) => capabilityResult(() => { if (typeof args[0] === "string") entry.capabilityRequests.get(args[0])?.abort(); }),
    async servicesList(entry, args) {
        const interfaceId = args[0];
        if (typeof interfaceId !== "string") throw rpcFailure("invalid-argument", "A service interface id is required.");
        await boardTrustService.refresh();
        const uses = boardTrustService.getGrantedUsesFromSnapshot(entry.root);
        const allowedVersions = new Set(uses.filter((use) => use.id === interfaceId).map((use) => use.version));
        if (!allowedVersions.size) throw rpcFailure("permission-denied", "The board has no trusted grant for this service interface.");
        return moduleServiceSupervisor.listServiceProviders(interfaceId).filter((provider) => allowedVersions.has(provider.version));
    },
    async servicesConnect(entry, args) {
        const interfaceId = args[0];
        const selector = args[1] as { provider: string; version: number } | undefined;
        if (typeof interfaceId !== "string" || !selector || typeof selector.provider !== "string") throw rpcFailure("invalid-argument", "A service interface and provider selector are required.");
        await boardTrustService.refresh();
        return moduleServiceSupervisor.connectServiceChannel(entry.root, entry.hostWebContents, entry.boardId, interfaceId, selector, args[2]);
    },
    serviceStatus: (entry) => moduleServiceSupervisor.getStatus(entry.root),
    serviceStop: (entry) => moduleServiceSupervisor.stop(entry.root, "explicit"),
    storageGet: (entry, args) => getBoardStorageValue(entry.root, validateBoardStorageKey(args[0])),
    storageSet: (entry, args) => setBoardStorageValue(
        entry.root,
        validateBoardStorageKey(args[0]),
        validateBoardStorageValue(args[1]),
    ),
    storageDelete: (entry, args) => deleteBoardStorageValue(entry.root, validateBoardStorageKey(args[0])),
    storageKeys: (entry) => getBoardStorageKeys(entry.root),
    // A board frame cannot use `navigator.clipboard`: the toolbar button it is usually
    // reacting to lives in Persephone's own chrome, so the board document is not the
    // focused one and the write throws "Document is not focused". Electron's clipboard
    // has no focus requirement, and it is what every built-in editor already copies
    // through (`editors/shared/image-export.ts`).
    async clipboardWriteImage(_entry, args) {
        const bytes = toBytes(args[0], "clipboard.writeImage");
        const image = nativeImage.createFromBuffer(Buffer.from(bytes));
        if (image.isEmpty()) throw new Error("clipboard.writeImage got bytes that are not a readable image.");
        await clipboard.write([new ClipboardItem({ "image/png": new Blob([new Uint8Array(image.toPNG())], { type: "image/png" }) })]);
    },
    async clipboardWriteText(_entry, args) {
        if (typeof args[0] !== "string") throw new Error("clipboard.writeText needs a string.");
        await clipboard.writeText(args[0]);
    },
};

/** Run a request/reply RPC and return its result (thrown errors reject the caller). */
async function runRpc(entry: BoardPortEntry, method: BoardRpcMethod, args: unknown[]): Promise<unknown> {
    if (method === "servicesList" || method === "servicesConnect") {
        if (!boardTrustService.getGrantedUsesFromSnapshot(entry.root).length) throw BoardGrant.deny("service interface");
    } else if (method === "serviceRequest" || method === "serviceOpenChannel" || method === "serviceStatus" || method === "serviceStop") {
        if (!(await boardTrustService.allows(entry.root, "service"))) throw BoardGrant.deny("service");
    }
    if (method.startsWith("capability") && (boardPorts.get(entry.boardId) !== entry || !entry.token || entry.hostWebContents.isDestroyed())) throw rpcFailure("cancelled", "The board frame is closed.");
    const handler = boardRpcHandlers[method];
    if (!handler) throw new Error(`Unknown board RPC method: ${method}`);
    return handler(entry, args);
}

function jsonSafe(value: unknown): unknown {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) throw new Error("Board call returned a non-serializable value.");
    return JSON.parse(encoded);
}

async function runBoardCall(boardId: string, entry: BoardPortEntry, id: number, request: BoardCallRequest): Promise<void> {
    try {
        if (request.timeoutMs !== undefined && !isPositiveIntegerTimeout(request.timeoutMs)) {
            throw new Error("Board call timeoutMs must be a positive integer.");
        }
        const timeout = resolveBoardCallTimeout(request.timeoutMs, undefined, boardCallTimeoutMs);
        const themeMethod = boardThemeMethodOf(request.path);
        const canRouteTheme = themeMethod !== undefined && (request.args === undefined || Array.isArray(request.args));
        const result = canRouteTheme
            ? await hostRequest(entry, "boardThemes", {
                ownerId: entry.ownerId,
                boardId,
                method: themeMethod,
                args: request.args ?? [],
                ...(Object.prototype.hasOwnProperty.call(request, "value") ? { value: request.value } : {}),
            }, timeout.ms)
            : await hostRequest(entry, "boardCall", { ownerId: entry.ownerId, boardId, request }, timeout.ms);
        if (boardPorts.get(boardId) !== entry) return;
        entry.port.postMessage({ kind: "call-result", id, result: jsonSafe(result) });
    } catch (error) {
        if (boardPorts.get(boardId) !== entry) return;
        try {
            entry.port.postMessage({ kind: "call-result", id, error: errMessage(error, "Board call failed.") });
        } catch {
            // The Board disconnected while its request was completing.
        }
    }
}
/** Fire-and-forget effects (no reply). */
function runFire(entry: BoardPortEntry, method: BoardFireMethod, args: unknown[]): void {
    const win = ownerWindow(entry.hostWebContents);
    if (method === "notify") {
        const message = args[0] as string;
        if (!message) return;
        const type = args[1] as BoardNotifyType | undefined;
        const persistent = args[2] === true;
        win?.webContents.send(EventEndpoint.eBoardNotify, { message, type, persistent } satisfies BoardNotifyMsg);
        // Mirror errors/warnings to the board's ui.log for author/agent review.
        if (type === "error" || type === "warning") {
            void boardLog.append(entry.root, type, message).catch(() => {});
        }
    }
}

type BoardRunnerHandler = (entry: BoardPortEntry, boardId: string, msg: unknown) => Promise<void>;

/** Outbound runner messages are exhaustive over the board side of RunnerChannel. */
const boardRunnerHandlers: Record<BoardRunnerOutMsg["channel"], BoardRunnerHandler> = {
    async [RunnerChannel.start](entry, boardId, raw) {
        if (!(await boardTrustService.allows(entry.root, "execute"))) {
            portSink(entry, boardId).send(RunnerChannel.error, { jobId: (raw as RunnerStartMsg).jobId, message: BoardGrant.deny("execute").message });
            return;
        }
        const msg = raw as RunnerStartMsg;
        const opts = { ...(entry.root ? { cwd: entry.root } : {}), ...msg.opts };
        if (msg.node) {
            const script = path.isAbsolute(msg.command) ? msg.command : path.resolve(entry.root, msg.command);
            if (!fs.existsSync(script)) {
                portSink(entry, boardId).send(RunnerChannel.error, { jobId: msg.jobId, message: `Node script not found: ${script}` });
                return;
            }
            startNodeJobTo(portSink(entry, boardId), { ...msg, command: script, opts });
            return;
        }
        startJobTo(portSink(entry, boardId), { ...msg, opts });
    },
    async [RunnerChannel.stdin](entry, _boardId, raw) {
        if (!(await boardTrustService.allows(entry.root, "execute"))) return;
        const msg = raw as RunnerStdinMsg;
        writeJobStdin(msg.jobId, msg.data);
    },
    async [RunnerChannel.endStdin](entry, _boardId, raw) {
        if (!(await boardTrustService.allows(entry.root, "execute"))) return;
        endJobStdin((raw as { jobId: string }).jobId);
    },
    async [RunnerChannel.kill](entry, _boardId, raw) {
        if (!(await boardTrustService.allows(entry.root, "execute"))) return;
        const msg = raw as RunnerKillMsg;
        killJob(msg.jobId, msg.signal);
    },
};

/** Dispatch a board → main port message. */
function handleBoardMessage(boardId: string, data: BoardToMain): void {
    const entry = boardPorts.get(boardId);
    if (!entry || !data) return;

    if (data.kind === "connected") {
        // Mode D: the shim is live — cancel the handshake watchdog.
        entry.connected = true;
        if (entry.watchdog) {
            clearTimeout(entry.watchdog);
            entry.watchdog = undefined;
        }
        return;
    }

    if (data.kind === "runner") {
        // A malformed port message must be ignored like the former switch default.
        const handler = boardRunnerHandlers[data.channel];
        if (handler) void handler(entry, boardId, data.msg).catch((error: unknown) => {
            portSink(entry, boardId).send(RunnerChannel.error, { jobId: (data.msg as { jobId?: string }).jobId, message: errMessage(error) });
        });
        return;
    }
    if (data.kind === "fire") {
        runFire(entry, data.method, data.args);
        return;
    }

    if (data.kind === "rpc") {
        const { id, method, args } = data;
        void runRpc(entry, method, args)
            .then((result) => entry.port.postMessage({ kind: "rpc-result", id, result }))
            .catch((error: unknown) => entry.port.postMessage({ kind: "rpc-result", id, error: toWireError(error) }));
        return;
    }

    if (data.kind === "call") {
        void runBoardCall(boardId, entry, data.id, data.request);
    }
}

/** Reap every board hosted by a host webContents that crashed/was destroyed —
 *  including kept (port-less) jobs of busy owners, which the `boardPorts` loop
 *  can't see. */
function reapHost(hostWebContentsId: number): void {
    for (const [boardId, entry] of [...boardPorts]) {
        if (entry.hostWebContents.id === hostWebContentsId) disposeBoardPort(boardId);
    }
    for (const [ownerId, entry] of [...ownerSinks]) {
        if (entry.hostWcId === hostWebContentsId) reapBoardOwner(ownerId);
    }
    wiredHosts.delete(hostWebContentsId);
}

/** Append a board load failure to its `ui.log` and toast the host renderer — the shared
 *  funnel for modes A and D. Never throws into the caller. */
function reportBoardLoadFailure(hostWebContents: WebContents, root: string, detail: string): void {
    if (root) {
        void boardLog.append(root, "error", detail).catch(() => {});
    }
    try {
        hostWebContents.send(EventEndpoint.eBoardNotify, {
            message: `Board failed to load: ${detail}`,
            type: "error",
        } satisfies BoardNotifyMsg);
    } catch {
        // Window gone — nothing to toast.
    }
}

/**
 * Wire a host renderer once: mode-A board load-failure reporting + crash reaping of its
 * orphaned board ports. Idempotent (guarded by `wiredHosts`). Called at
 * board MOUNT (`registerBoard` via the controller — so it catches a main-doc failure that
 * never fires the iframe `load`) and again from `createBoardPort`.
 */
export function ensureHostWired(hostWebContents: WebContents): void {
    if (wiredHosts.has(hostWebContents.id)) return;
    wiredHosts.add(hostWebContents.id);

    // Mode A: Electron fires `did-fail-load` on the PARENT wc for sub-frame failures
    // (isMainFrame=false). The board:// frame is the only sub-frame; filter to it and
    // resolve its root from the mount-time registry (`getBoardRootForHost`).
    hostWebContents.on("did-fail-load", (_e, errorCode, errorDescription, validatedURL, isMainFrame) => {
        if (isMainFrame) return; // host's own navigation, not a board
        if (errorCode === -3) return; // ERR_ABORTED — superseded navigation (e.g. soft reload)
        if (!validatedURL || !validatedURL.startsWith("board://")) return;
        let host: string;
        try {
            host = new URL(validatedURL).host;
        } catch {
            return;
        }
        const root = getBoardRootForHost(host);
        if (!root) return;
        reportBoardLoadFailure(hostWebContents, root, `${errorCode} ${errorDescription} ${validatedURL}`);
    });

    // Backstop: dispose this host's board ports + jobs if the renderer dies.
    onWebContentsGone(hostWebContents, () => reapHost(hostWebContents.id), {
        events: ["destroyed", "render-process-gone"],
        repeat: true,
    });
}

/** Mint a per-board port pair, wire port2 to the RPC handler, deliver port1 to the
 *  requesting host renderer. Called from the `requestBoardPort` endpoint on every
 *  iframe `load`; a re-request for a live boardId disposes the old.
 *  `ownerId` is the owning BoardEditorModel id — the stable job-retention key
 * across mounts of the same board tab. */
export function createBoardPort(
    hostWebContents: WebContents,
    boardId: string,
    host: string,
    ownerId: string,
    hostedPath: string | null,
    token: string,
): void {
    // Re-handshake (reload / navigation): drop the superseded port first.
    if (boardPorts.has(boardId)) disposeBoardPort(boardId);

    const root = getBoardRootForHost(host) ?? "";
    const { port1, port2 } = new MessageChannelMain();
    const entry: BoardPortEntry = { boardId, port: port2, root, host, ownerId, hostWebContents, hostedFilePath: hostedPath, token, tsProjectRoots: new Set(), capabilityRequests: new Map() };
    boardPorts.set(boardId, entry);
    indexOwnerSink(ownerId, boardId, hostWebContents.id);

    port2.on("message", (e) => handleBoardMessage(boardId, e.data as BoardToMain));
    port2.start();

    ensureHostWired(hostWebContents);

    // Mode D: the shim posts `{ kind: "connected" }` as soon as it attaches the port.
    // If it never arrives, the board painted but its bridge is dead — report it.
    if (root) {
        entry.watchdog = setTimeout(() => {
            if (!entry.connected) {
                reportBoardLoadFailure(
                    hostWebContents,
                    root,
                    "board bridge did not connect (the board loaded but its script bridge never initialized)",
                );
            }
        }, BOARD_HANDSHAKE_TIMEOUT_MS);
    }

    hostWebContents.postMessage(EventEndpoint.eBoardPort, { boardId }, [port1]);
}

/** Update only the live port created by this host renderer for this exact load. */
export function updateBoardHostedPath(
    hostWebContents: WebContents,
    boardId: string,
    token: string,
    hostedPath: string | null,
): boolean {
    const entry = boardPorts.get(boardId);
    if (!entry || entry.hostWebContents !== hostWebContents || entry.token !== token
        || hostWebContents.isDestroyed()) return false;
    entry.hostedFilePath = hostedPath;
    return true;
}

/** Tear down a board's port (unmount / reload / host crash). Jobs: a BUSY owner's
 *  jobs are KEPT because they outlive the iframe; otherwise every job of the
 *  owner is reaped (current sink + any kept from prior busy mounts). */
export function disposeBoardPort(boardId: string): void {
    const entry = boardPorts.get(boardId);
    if (!entry) return;
    entry.hostedFilePath = null;
    entry.token = "";
    for (const controller of entry.capabilityRequests.values()) controller.abort();
    entry.capabilityRequests.clear();
    moduleServiceSupervisor.closeBoardChannels(boardId, {
        code: "renderer-reloaded",
        message: "The board page closed or was reloaded.",
    });
    if (entry.watchdog) {
        clearTimeout(entry.watchdog);
        entry.watchdog = undefined;
    }
    cleanupBoardWatches(boardId);
    try { entry.port.close(); } catch { /* already closed */ }
    if (entry.tsProjectRoots.size && !entry.hostWebContents.isDestroyed()) {
        // Release this frame's TypeScript projects on reload, close, grant refresh, or quit.
        void hostRequest(entry, "releaseTsProjects", { owner: entry.boardId })
            .catch((error: unknown) => { console.warn(`Releasing TypeScript projects failed: ${errMessage(error)}`); });
    }
    boardPorts.delete(boardId);
    if (!busyOwners.has(entry.ownerId)) {
        // Per-sink reaping: a board's main and secondary frames share
        // one owner (`model.id`). A single frame's port going away reaps ONLY that frame's
        // jobs (its sink), never the shared owner's other frames — else closing a secondary
        // panel would tree-kill the main frame's processes. The WHOLE owner is reaped only
        // from `reapBoardOwner` (model dispose / host crash / quit).
        reapJobsBySinkId(boardId);
        ownerSinks.get(entry.ownerId)?.sinkIds.delete(boardId);
    }
}

/** Live retint: push a new palette to every running board. */
export function pushThemeToBoards(palette: BoardThemePalette): void {
    for (const entry of boardPorts.values()) {
        try {
            entry.port.postMessage({ kind: "theme", palette });
        } catch {
            // port closed — ignore
        }
    }
}

/** Dispose all board ports + jobs. Wired into `app.on("will-quit", …)`. Kept jobs
 *  of busy owners are reaped too (`killAllCommands` also backstops the children). */
export function disposeAllBoardPorts(): void {
    busyOwners.clear(); // quit overrides busy — disposeBoardPort now reaps everything
    for (const boardId of [...boardPorts.keys()]) disposeBoardPort(boardId);
    for (const ownerId of [...ownerSinks.keys()]) reapBoardOwner(ownerId);
    wiredHosts.clear();
}
