import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { dialog, shell } from "electron";
import type { BoardFileEncoding, BoardFolderEntry, BoardFolderPage, BoardFolderListOptions } from "../../../ipc/board-bridge/port-protocol";
import { BoardGrant } from "../../../shared/board/board-grant";
import { BoardRoot } from "../../../shared/board/board-root";
import { errMessage } from "../../../shared/utils";
import { boardTrustService } from "../../board-trust-service";
import { boardFileAccess } from "../../board-file-access";
import { t } from "../../../shared/i18n/t";
import { BoardRpcError, asBoardRpcError, fileAccessError } from "./errors";
import { ownerWindow, boardName } from "./context";
import { toBytes } from "./file-bytes";
import type { BoardBridgeConnection, BoardFolderCursor } from "../BoardBridgeConnection";
import type { BoardRpcSlice } from "./types";

const MAX_FOLDER_PAGE_SIZE = 1000;
const MAX_FOLDER_RESULTS = 100000;
const FOLDER_CURSOR_TTL_MS = 5 * 60 * 1000;

async function getBoardFileAccess(entry: BoardBridgeConnection, requestedPath: unknown): Promise<{ read: boolean; write: boolean }> {
    if (typeof requestedPath !== "string" || requestedPath.trim().length === 0) {
        throw new BoardRpcError("invalid-argument", "A file path is required.");
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
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new BoardRpcError("invalid-argument", "Folder listing options must be an object.");
    const options = value as BoardFolderListOptions;
    if (options.recursive !== undefined && typeof options.recursive !== "boolean") throw new BoardRpcError("invalid-argument", "recursive must be a boolean.");
    if (options.limit !== undefined && (!Number.isInteger(options.limit) || options.limit < 1)) {
        throw new BoardRpcError("invalid-argument", "limit must be a positive integer.");
    }
    if ((options.limit ?? 500) > MAX_FOLDER_PAGE_SIZE) {
        throw new BoardRpcError("too-many-entries", `A folder page can contain at most ${MAX_FOLDER_PAGE_SIZE} entries.`);
    }
    if (options.cursor !== undefined && typeof options.cursor !== "string") throw new BoardRpcError("invalid-argument", "cursor must be a string.");
    if (options.masks !== undefined && (!Array.isArray(options.masks) || options.masks.length > 32
        || options.masks.some((mask) => typeof mask !== "string" || mask.length > 256 || /[\\/]/.test(mask)))) {
        throw new BoardRpcError(
            "invalid-argument",
            "masks must contain at most 32 basename masks of at most 256 characters using only * and ? as wildcard operators.",
        );
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

async function listBoardFolder(entry: BoardBridgeConnection, requestedPath: unknown, rawOptions: unknown): Promise<BoardFolderPage> {
    if (typeof requestedPath !== "string") throw new BoardRpcError("invalid-argument", "A folder path is required.");
    const options = parseFolderOptions(rawOptions);
    const grant = await boardTrustService.getGrant(entry.root);
    if (!grant) throw new BoardRpcError("permission-denied", BoardGrant.deny("fileSystem").message);
    let cursor: BoardFolderCursor | undefined;
    if (options.cursor) {
        cursor = entry.folderCursors.get(options.cursor);
        if (!cursor) throw new BoardRpcError("invalid-argument", "The folder cursor is invalid.");
        entry.folderCursors.delete(options.cursor);
        if (cursor.expires < Date.now()) throw new BoardRpcError("cursor-expired", "The folder cursor has expired.");
        if (!BoardRoot.from(cursor.boardRoot).equals(entry.root)) throw new BoardRpcError("invalid-argument", "The folder cursor belongs to another board.");
        if (cursor.boardId !== entry.boardId) throw new BoardRpcError("invalid-argument", "The folder cursor belongs to another board frame.");
        try { await boardFileAccess.authorize(entry.root, cursor.root, "list"); }
        catch { entry.folderCursors.delete(options.cursor); throw new BoardRpcError("permission-denied", BoardGrant.deny("fileSystem").message); }
    } else {
        let root: string;
        try { root = await boardFileAccess.authorize(entry.root, requestedPath, "list"); }
        catch (error: unknown) {
            const errorCode = (error as NodeJS.ErrnoException)?.code;
            if (errorCode === "ENOENT") throw new BoardRpcError("not-found", "The folder does not exist.");
            throw new BoardRpcError("permission-denied", errMessage(error, "Folder access denied."));
        }
        let rootStat;
        try { rootStat = await fs.promises.stat(root); } catch { throw new BoardRpcError("not-found", "The folder does not exist."); }
        if (!rootStat.isDirectory()) throw new BoardRpcError("not-directory", "The requested path is not a folder.");
        const entries: BoardFolderEntry[] = [];
        let truncated = false;
        const visit = async (directory: string, depth: number): Promise<void> => {
            if (depth > 32) throw new BoardRpcError("depth-limit", "Folder recursion exceeds the depth limit of 32.");
            const authorizedDirectory = await boardFileAccess.authorize(entry.root, directory, "list");
            let children;
            try { children = await fs.promises.readdir(authorizedDirectory, { withFileTypes: true }); }
            catch (error: unknown) { throw new BoardRpcError("io-error", errMessage(error, "Could not read the folder.")); }
            for (const child of children) {
                const childPath = path.join(authorizedDirectory, child.name);
                const lstat = await fs.promises.lstat(childPath);
                if (lstat.isSymbolicLink()) continue;
                let canonical: string;
                try {
                    canonical = await boardFileAccess.authorize(
                        entry.root,
                        childPath,
                        child.isDirectory() ? "list" : "read",
                    );
                }
                catch { throw new BoardRpcError("permission-denied", BoardGrant.deny("fileSystem").message); }
                const stat = await fs.promises.stat(canonical);
                if (stat.isDirectory() || folderMaskMatches(child.name, options.masks)) {
                    if (entries.length >= MAX_FOLDER_RESULTS) { truncated = true; return; }
                    entries.push({
                        name: child.name,
                        path: canonical,
                        isDirectory: stat.isDirectory(),
                        size: stat.isDirectory() ? 0 : stat.size,
                        mtime: stat.mtimeMs,
                    });
                }
                if (options.recursive && stat.isDirectory()) await visit(canonical, depth + 1);
                if (truncated) return;
            }
        };
        try { await visit(root, 0); }
        catch (error: unknown) {
            if (error instanceof BoardRpcError) throw error;
            throw new BoardRpcError("io-error", errMessage(error, "Could not list the folder."));
        }
        cursor = { root, boardRoot: entry.root, boardId: entry.boardId, entries, offset: 0, expires: Date.now() + FOLDER_CURSOR_TTL_MS, truncated };
    }
    const end = Math.min(cursor.offset + options.limit, cursor.entries.length);
    const pageEntries: BoardFolderEntry[] = [];
    for (const item of cursor.entries.slice(cursor.offset, end)) {
        try { await boardFileAccess.authorize(entry.root, item.path, item.isDirectory ? "list" : "read"); pageEntries.push(item); }
        catch { throw new BoardRpcError("permission-denied", BoardGrant.deny("fileSystem").message); }
    }
    if (!entry.isCurrent()) throw new BoardRpcError("cancelled", "The board frame is closed.");
    cursor.offset = end;
    let nextCursor: string | undefined;
    if (end < cursor.entries.length) { nextCursor = crypto.randomUUID(); entry.folderCursors.set(nextCursor, cursor); }
    return { entries: pageEntries, ...(nextCursor ? { nextCursor } : {}), truncated: cursor.truncated };
}

function fileEncoding(value: unknown): BoardFileEncoding {
    if (value == null) return "utf8";
    if (value === "utf8" || value === "base64" || value === "binary") return value;
    throw new Error(
        `Unknown file encoding "${String(value)}" — expected "utf8", "base64" or "binary".`,
    );
}

const handlers = {
listFolder: { handle: (entry, requestedPath, options) => listBoardFolder(entry, requestedPath, options) },
rememberFolder: { handle: async (entry, requestedPath) => {
        if (typeof requestedPath !== "string") throw new BoardRpcError("invalid-argument", "A folder path is required.");
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
    } },
rememberFile: { handle: async (entry, requestedPath) => {
        if (typeof requestedPath !== "string") throw new BoardRpcError("invalid-argument", "A file path is required.");
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
    } },
getFileAccess: { handle: (entry, requestedPath) => getBoardFileAccess(entry, requestedPath) },
readFile: { handle: async (entry, requestedPath, rawEncoding) => {
        let filePath: string;
        try {
            filePath = await boardFileAccess.authorizeHostedRead(entry.root, requestedPath, entry.hostedFilePath);
        } catch (error: unknown) { throw fileAccessError(error); }
        const encoding = fileEncoding(rawEncoding);
        let buf: Buffer;
        try { buf = await fs.promises.readFile(filePath); }
        catch (error: unknown) { throw fileAccessError(error); }
        if (encoding === "binary") {
            return new Uint8Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
        }
        return buf.toString(encoding);
    } },
writeFile: { handle: async (entry, requestedPath, data, rawEncoding) => {
        let filePath: string;
        try { filePath = await boardFileAccess.authorize(entry.root, requestedPath, "write"); }
        catch (error: unknown) { throw fileAccessError(error); }
        const encoding = fileEncoding(rawEncoding);
        try {
            await boardFileAccess.authorize(entry.root, path.dirname(requestedPath), "write");
            await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
        } catch {
            const parentStat = await fs.promises.stat(path.dirname(filePath)).catch((): undefined => undefined);
            if (!parentStat?.isDirectory()) throw new BoardRpcError("permission-denied", "A file grant does not authorize creating its parent folder.");
        }
        let checkedPath: string;
        try { checkedPath = await boardFileAccess.authorize(entry.root, requestedPath, "write"); }
        catch (error: unknown) { throw fileAccessError(error); }
        const existing = await fs.promises.lstat(checkedPath).catch((): undefined => undefined);
        if (existing && !existing.isFile()) throw new BoardRpcError("permission-denied", "The write target must be a regular file.");
        const body = encoding === "binary"
            ? Buffer.from(toBytes(data))
            : Buffer.from((data as string) ?? "", encoding);
        try { await fs.promises.writeFile(checkedPath, body); }
        catch (error: unknown) { throw fileAccessError(error); }
    } },
trashFile: { handle: async (entry, requestedPath) => {
        let checkedPath: string;
        try {
            await boardFileAccess.authorize(entry.root, requestedPath, "write");
            checkedPath = await boardFileAccess.authorize(entry.root, requestedPath, "write");
        } catch (error: unknown) { throw fileAccessError(error); }
        const existing = await fs.promises.lstat(checkedPath).catch((): undefined => undefined);
        if (!existing) throw new BoardRpcError("not-found", "The file does not exist.");
        if (!existing.isFile()) throw new BoardRpcError("permission-denied", "Only a regular file can be moved to the Recycle Bin.");
        try { await shell.trashItem(checkedPath); }
        catch (error: unknown) { throw fileAccessError(error); }
    } }
} satisfies BoardRpcSlice<FilesDomainKeys>;

export const fileHandlers = handlers;

export type FilesDomainKeys = "listFolder" | "rememberFolder" | "rememberFile" | "getFileAccess" | "readFile" | "writeFile" | "trashFile";
