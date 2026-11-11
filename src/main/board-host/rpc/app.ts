import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { clipboard, ClipboardItem, nativeImage } from "electron";
import type { BoardCallRequest } from "../../../ipc/board-bridge/port-protocol";
import type { OpenFileDialogParams, OpenFolderDialogParams, SaveFileDialogParams } from "../../../ipc/api-param-types";
import { BoardGrantDeniedError } from "../../../shared/board/board-grant";
import { boardFileAccess } from "../../board-file-access";
import { showOpenFileDialog, showOpenFolderDialog, showSaveFileDialog } from "../../native-dialogs";
import { errMessage } from "../../../shared/utils";
import { isPositiveIntegerTimeout, resolveBoardCallTimeout } from "../../../shared/ai-vision-timeout";
import { boardThemeMethodOf } from "../../../shared/board/board-call-route";
import { comparePathKey } from "../../utils";
import { BoardRpcError, fileAccessError } from "./errors";
import { ownerWindow, hostRequest } from "./context";
import { toBytes } from "./file-bytes";
import type { BoardBridgeConnection } from "../BoardBridgeConnection";
import type { BoardJobRetention } from "../BoardJobRetention";
import type { BoardRpcSlice } from "./types";

const MAX_TS_PROJECTS_PER_FRAME = 8;

export interface AppHandlerDependencies {
    retention: BoardJobRetention;
    currentTimeout: () => number | undefined;
    hostRequest: typeof hostRequest;
}

function jsonSafe(value: unknown): unknown {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) throw new Error("Board call returned a non-serializable value.");
    return JSON.parse(encoded);
}

async function runBoardCall(entry: BoardBridgeConnection, request: BoardCallRequest, dependencies: AppHandlerDependencies): Promise<unknown> {
    if (!request || typeof request !== "object" || Array.isArray(request)) throw new Error("Invalid board call request.");
    if (typeof request.path !== "string" || !request.path) throw new Error("persephone.call() needs a non-empty path.");
    if (request.args !== undefined && !Array.isArray(request.args)) throw new Error("persephone.call() options.args must be an array.");
    if (request.timeoutMs !== undefined && !isPositiveIntegerTimeout(request.timeoutMs)) {
        throw new Error("Board call timeoutMs must be a positive integer.");
    }
    const boardId = entry.boardId;
    const timeout = resolveBoardCallTimeout(request.timeoutMs, undefined, dependencies.currentTimeout());
    const themeMethod = boardThemeMethodOf(request.path);
    const canRouteTheme = themeMethod !== undefined && (request.args === undefined || Array.isArray(request.args));
    try {
        const result = canRouteTheme
            ? await dependencies.hostRequest(entry, "boardThemes", {
                ownerId: entry.ownerId,
                boardId,
                method: themeMethod,
                args: request.args ?? [],
                ...(Object.prototype.hasOwnProperty.call(request, "value") ? { value: request.value } : {}),
            }, timeout.ms)
            : await dependencies.hostRequest(entry, "boardCall", { ownerId: entry.ownerId, boardId, request }, timeout.ms);
        return jsonSafe(result);
    } catch (error: unknown) { throw new BoardRpcError("error", errMessage(error, "Board call failed.")); }
}

export function createAppHandlers(dependencies: AppHandlerDependencies) {
    const handlers = {
openRawLink: { handle: async (entry, href, rawOptions) => {
        if (typeof href !== "string" || !href.trim()) {
            throw new BoardRpcError("invalid-argument", "A non-empty link is required.");
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
            throw new BoardRpcError(
                "invalid-argument",
                "openRawLink accepts only absolute paths, file:, http:, https:, mailto:, data:image/png;base64, and torrent: links.",
            );
        }
        if (rawOptions !== undefined && (!rawOptions || typeof rawOptions !== "object" || Array.isArray(rawOptions))) {
            throw new BoardRpcError("invalid-argument", "openRawLink options must be an object.");
        }
        const options = (rawOptions ?? {}) as {
            editor?: unknown; revealLine?: unknown; highlightText?: unknown; reuseKey?: unknown;
        };
        if (options.editor !== undefined && typeof options.editor !== "string") {
            throw new BoardRpcError("invalid-argument", "openRawLink editor must be a string.");
        }
        if (options.revealLine !== undefined
            && (!Number.isSafeInteger(options.revealLine) || (options.revealLine as number) < 1)) {
            throw new BoardRpcError("invalid-argument", "openRawLink revealLine must be a positive integer.");
        }
        if (options.highlightText !== undefined && typeof options.highlightText !== "string") {
            throw new BoardRpcError("invalid-argument", "openRawLink highlightText must be a string.");
        }
        if (options.reuseKey !== undefined && typeof options.reuseKey !== "string") {
            throw new BoardRpcError("invalid-argument", "openRawLink reuseKey must be a string.");
        }
        const editor = typeof options.editor === "string" ? options.editor : undefined;
        const revealLine = typeof options.revealLine === "number" ? options.revealLine : undefined;
        const highlightText = typeof options.highlightText === "string" ? options.highlightText : undefined;
        const reuseKey = typeof options.reuseKey === "string" ? options.reuseKey : undefined;
        let target = href;
        if (/^file:/i.test(trimmedHref)) {
            try { target = fileURLToPath(trimmedHref); }
            catch (error: unknown) { throw new BoardRpcError("invalid-argument", errMessage(error, "Invalid file URL.")); }
        }
        ownerWindow(entry.hostWebContents)?.focus();
        await dependencies.hostRequest(entry, "openRawLink", { target, editor, revealLine, highlightText, reuseKey, boardRoot: entry.root });
        return undefined;
    } },
openBoard: { handle: async (entry, folder) => {
        if (typeof folder !== "string" || !folder.trim()) {
            throw new BoardRpcError("invalid-argument", "A non-empty board folder path is required.");
        }
        let canonicalFolder: string;
        try {
            canonicalFolder = await boardFileAccess.authorize(entry.root, folder, "list");
        } catch (error: unknown) {
            const errorCode = (error as NodeJS.ErrnoException)?.code;
            if (errorCode === "ENOENT") throw new BoardRpcError("not-found", "The board folder does not exist.");
            if (error instanceof BoardGrantDeniedError) {
                throw new BoardRpcError("permission-denied", error.message);
            }
            throw error;
        }
        await dependencies.hostRequest(entry, "openBoard", { folder: canonicalFolder });
        return undefined;
    } },
openFileDialog: { permission: "dialog", handle: async (entry, params) => {
        const result = await showOpenFileDialog(ownerWindow(entry.hostWebContents), (params as OpenFileDialogParams) ?? {});
        await boardFileAccess.recordPickedPaths(entry.root, result, false);
        return result;
    } },
saveFileDialog: { permission: "dialog", handle: async (entry, params) => {
        const result = await showSaveFileDialog(ownerWindow(entry.hostWebContents), (params as SaveFileDialogParams) ?? {});
        await boardFileAccess.recordPickedPaths(entry.root, result, false);
        return result;
    } },
openFolderDialog: { permission: "dialog", handle: async (entry, params) => {
        const result = await showOpenFolderDialog(ownerWindow(entry.hostWebContents), (params as OpenFolderDialogParams) ?? {});
        await boardFileAccess.recordPickedPaths(entry.root, result, true);
        return result;
    } },
clipboardWriteImage: { handle: async (_entry, data) => {
        const bytes = toBytes(data, "clipboard.writeImage");
        const image = nativeImage.createFromBuffer(Buffer.from(bytes));
        if (image.isEmpty()) throw new Error("clipboard.writeImage got bytes that are not a readable image.");
        await clipboard.write([new ClipboardItem({ "image/png": new Blob([new Uint8Array(image.toPNG())], { type: "image/png" }) })]);
    } },
clipboardWriteText: { handle: async (_entry, text) => {
        if (typeof text !== "string") throw new Error("clipboard.writeText needs a string.");
        await clipboard.writeText(text);
    } },
registerTypeScriptProject: { handle: async (entry, requested) => {
        if (typeof requested !== "string" || !requested.trim()) throw new BoardRpcError("invalid-argument", "A project folder path is required.");
        let authorized: string; // realpath: used ONLY for the permission gate and the directory check
        try { authorized = await boardFileAccess.authorize(entry.root, requested, "list"); }
        catch (error: unknown) { throw fileAccessError(error); }
        // The renderer root keeps the board's own spelling so it matches the paths pages are opened with.
        const root = path.resolve(entry.root, requested);
        const stats = await fs.promises.stat(authorized).catch((): undefined => undefined);
        if (!stats?.isDirectory()) throw new BoardRpcError("not-directory", "The project path is not a folder.");
        const key = comparePathKey(root);
        if (entry.tsProjectRoots.size >= MAX_TS_PROJECTS_PER_FRAME && !entry.tsProjectRoots.has(key)) {
            throw new BoardRpcError("limit", "Too many TypeScript projects registered by this board.");
        }
        await dependencies.hostRequest(entry, "registerTsProject", { root, owner: entry.boardId });
        entry.tsProjectRoots.add(key);
        return undefined;
    } },
unregisterTypeScriptProject: { handle: async (entry, requested) => {
        if (typeof requested !== "string" || !requested.trim()) throw new BoardRpcError("invalid-argument", "A project folder path is required.");
        // Only removes this frame's own registration; the folder may already be gone, so no realpath or permission check.
        const root = path.resolve(entry.root, requested);
        await dependencies.hostRequest(entry, "unregisterTsProject", { root, owner: entry.boardId });
        entry.tsProjectRoots.delete(comparePathKey(root));
        return undefined;
    } },
getJobs: { handle(entry) {
        return dependencies.retention.getJobs(entry.ownerId);
    } },
call: { handle: (entry, request) => runBoardCall(entry, request, dependencies) }
    } satisfies BoardRpcSlice<AppDomainKeys>;
    return handlers;
}

export type AppDomainKeys =
    | "openRawLink"
    | "openBoard"
    | "openFileDialog"
    | "saveFileDialog"
    | "openFolderDialog"
    | "clipboardWriteImage"
    | "clipboardWriteText"
    | "registerTypeScriptProject"
    | "unregisterTypeScriptProject"
    | "getJobs"
    | "call";
