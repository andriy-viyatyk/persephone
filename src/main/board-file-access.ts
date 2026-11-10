import fs from "node:fs";
import path from "node:path";
import { BoardGrant } from "../shared/board/board-grant";
import { BoardRoot } from "../shared/board/board-root";
import { isPathInside } from "./utils";

type FileIntent = "read" | "write" | "folder" | "list";

type ResolveScope = { grant: BoardGrant } | { rootOnly: true } | { userPicked: true };

interface ResolveOptions {
    boardRoot: string;
    requestedPath: string;
    intent: FileIntent;
}

type ScopedResolveOptions = ResolveOptions & ResolveScope;

interface PickedPath {
    readonly path: string;
    readonly folder: boolean;
}

const pickedPathsByRoot = new Map<string, PickedPath[]>();
const sourceReadPathsByRoot = new Map<string, Set<string>>();
const deliveredSourcePathsByRoot = new Map<string, Set<string>>();
const persistedGrantCache = new Map<string, { folderGrants: string[]; fileGrants: string[] }>();

function normalizedForCompare(value: string): string {
    const resolved = path.resolve(value);
    const pathRoot = path.parse(resolved).root;
    const trimmed = resolved.length > pathRoot.length ? resolved.replace(/[\\/]+$/, "") : resolved;
    return process.platform === "win32" ? trimmed.toLowerCase() : trimmed;
}

function normalizeWindowsComponents(value: string): string {
    const normalized = value.replace(/\//g, "\\");
    const prefix = path.win32.parse(normalized).root;
    const rest = normalized.slice(prefix.length).split("\\").filter(Boolean)
        .map((component) => {
            const withoutTrailingSpaces = component.replace(/ +$/g, "");
            if (withoutTrailingSpaces === "." || withoutTrailingSpaces === "..") return withoutTrailingSpaces;
            return component.replace(/[ .]+$/g, "");
        });
    return prefix + rest.join("\\");
}

function validateRequestedPath(value: unknown): asserts value is string {
    if (typeof value !== "string" || value.trim().length === 0) throw new Error("A file path is required");
    const slashNormalized = value.replace(/\//g, "\\");
    if (slashNormalized.startsWith("\\\\?\\") || slashNormalized.startsWith("\\\\.\\")) {
        throw BoardGrant.deny("fileSystem");
    }
    const driveDesignator = /^[A-Za-z]:/.test(slashNormalized) ? 2 : 0;
    if (driveDesignator && !path.win32.isAbsolute(slashNormalized)) throw BoardGrant.deny("fileSystem");
    if (slashNormalized.slice(driveDesignator).includes(":")) throw BoardGrant.deny("fileSystem");
}

async function realpathNative(value: string): Promise<string> {
    return path.normalize(await fs.promises.realpath(value));
}

async function resolveExistingOrNewTarget(value: string, intent: FileIntent): Promise<string> {
    const normalized = process.platform === "win32" ? normalizeWindowsComponents(value) : path.normalize(value);
    if (intent !== "write") return realpathNative(normalized);
    try {
        return await realpathNative(normalized);
    } catch (error: unknown) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const missing: string[] = [];
    let ancestor = normalized;
    for (;;) {
        try {
            const realAncestor = await realpathNative(ancestor);
            return path.resolve(realAncestor, ...missing.reverse());
        } catch (error: unknown) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
            const parent = path.dirname(ancestor);
            if (parent === ancestor) throw error;
            missing.push(path.basename(ancestor));
            ancestor = parent;
        }
    }
}

function allowedByScope(boardRoot: string, candidate: string, grant: BoardGrant | undefined, userPicked: boolean,
    intent: FileIntent, grants: { folderGrants: string[]; fileGrants: string[] }): boolean {
    if (userPicked) return true;
    const mode = grant?.fileSystemMode() ?? false;
    if (mode === "full") return true;
    if (intent === "read") {
        const key = BoardRoot.from(boardRoot).key;
        const candidateKey = normalizedForCompare(candidate);
        if (sourceReadPathsByRoot.get(key)?.has(candidateKey) || deliveredSourcePathsByRoot.get(key)?.has(candidateKey)) return true;
    }
    if (mode !== "board") return false;
    if (isPathInside(boardRoot, candidate)) return true;
    const picks = pickedPathsByRoot.get(BoardRoot.from(boardRoot).key) ?? [];
    if (picks.some((pick) => pick.folder ? isPathInside(pick.path, candidate) : normalizedForCompare(pick.path) === normalizedForCompare(candidate))) return true;
    if ((intent === "read" || intent === "list" || intent === "folder")
        && grants.folderGrants.some((folder) => isPathInside(folder, candidate))) return true;
    if ((intent === "read" || intent === "write") && grants.fileGrants.some((file) => normalizedForCompare(file) === normalizedForCompare(candidate))) return true;
    return false;
}

async function persistedGrants(boardRoot: string): Promise<{ folderGrants: string[]; fileGrants: string[] }> {
    const key = BoardRoot.from(boardRoot).key;
    const cached = persistedGrantCache.get(key);
    if (cached) return cached;
    const { boardTrustService } = await import("./board-trust-service");
    const grants = await boardTrustService.getFileAccessGrants(boardRoot);
    persistedGrantCache.set(key, grants);
    return grants;
}

export function invalidatePersistedBoardGrants(boardRoot: string): void {
    persistedGrantCache.delete(BoardRoot.from(boardRoot).key);
}

/** Resolve and authorize every path a board can cause the app to access. */
export async function resolveAuthorizedPath(options: ScopedResolveOptions): Promise<string> {
    validateRequestedPath(options.requestedPath);
    const root = await realpathNative(options.boardRoot);
    const candidate = await resolveExistingOrNewTarget(
        path.isAbsolute(options.requestedPath) ? options.requestedPath : path.resolve(root, options.requestedPath),
        options.intent,
    );
    if ("rootOnly" in options) {
        if (!isPathInside(root, candidate)) throw BoardGrant.deny("fileSystem");
        return candidate;
    }
    const grants = await persistedGrants(root);
    const canonicalCandidate = normalizedForCompare(candidate);
    const fileGrant = grants.fileGrants.find((file) => normalizedForCompare(file) === canonicalCandidate);
    if (fileGrant && options.intent !== "folder" && options.intent !== "list") {
        try {
            const stat = await fs.promises.stat(candidate);
            if (!stat.isFile()) throw BoardGrant.deny("fileSystem");
            const real = await realpathNative(candidate);
            if (normalizedForCompare(real) !== normalizedForCompare(fileGrant)) throw BoardGrant.deny("fileSystem");
        } catch (error: unknown) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT" || options.intent !== "write") throw error;
            const parent = await realpathNative(path.dirname(candidate));
            if (normalizedForCompare(path.join(parent, path.basename(candidate))) !== normalizedForCompare(fileGrant)) throw BoardGrant.deny("fileSystem");
        }
    }
    if (!allowedByScope(root, candidate, "grant" in options ? options.grant : undefined, "userPicked" in options, options.intent, grants)) throw BoardGrant.deny("fileSystem");
    return candidate;
}

/** Resolve a hosted document read by exact canonical identity, or use normal file authorization. */
export async function resolveHostedReadOrAuthorizedPath(options: {
    boardRoot: string;
    requestedPath: string;
    hostedPath: string | null;
    grant: BoardGrant;
}): Promise<string> {
    if (options.hostedPath) {
        try {
            validateRequestedPath(options.requestedPath);
            validateRequestedPath(options.hostedPath);
            const root = await realpathNative(options.boardRoot);
            const requested = path.isAbsolute(options.requestedPath)
                ? options.requestedPath
                : path.resolve(root, options.requestedPath);
            const requestedCanonical = await realpathNative(
                process.platform === "win32" ? normalizeWindowsComponents(requested) : requested,
            );
            const hostedCanonical = await realpathNative(
                process.platform === "win32" ? normalizeWindowsComponents(options.hostedPath) : options.hostedPath,
            );
            if (normalizedForCompare(requestedCanonical) === normalizedForCompare(hostedCanonical)) {
                return requestedCanonical;
            }
        } catch {
            // Invalid or missing candidates cannot use the hosted-document exception.
        }
    }
    return resolveAuthorizedPath({
        boardRoot: options.boardRoot,
        requestedPath: options.requestedPath,
        grant: options.grant,
        intent: "read",
    });
}

export function requireDialogPermission(grant: BoardGrant): void {
    if (grant.fileSystemMode() === false) throw BoardGrant.deny("fileSystem");
}

/** Keep delivered board sources and source-context items in separate session-only read grants. */
export async function grantBoardSourceReads(boardRoot: string, sourceValues: string[], contextValues: string[] = []): Promise<void> {
    if (!Array.isArray(sourceValues) || !Array.isArray(contextValues) || sourceValues.length + contextValues.length > 5000) {
        throw new TypeError("At most 5,000 source paths may be delivered at once.");
    }
    const root = await realpathNative(boardRoot);
    const key = BoardRoot.from(root).key;
    const delivered = deliveredSourcePathsByRoot.get(key) ?? new Set<string>();
    const context = sourceReadPathsByRoot.get(key) ?? new Set<string>();
    for (const [values, granted] of [[sourceValues, delivered], [contextValues, context]] as const) {
        for (const value of values) {
            if (typeof value !== "string" || !path.isAbsolute(value) || /^(https?|archive):/i.test(value)) continue;
            try {
                validateRequestedPath(value);
                const canonical = await realpathNative(process.platform === "win32" ? normalizeWindowsComponents(value) : value);
                if ((await fs.promises.stat(canonical)).isFile()) granted.add(normalizedForCompare(canonical));
            } catch { /* delivered URLs, archive paths, missing files, and special files are not grants */ }
        }
    }
    if (delivered.size) deliveredSourcePathsByRoot.set(key, delivered);
    if (context.size) sourceReadPathsByRoot.set(key, context);
}

export function clearBoardFileAccess(boardRoot: string): void {
    const key = BoardRoot.from(boardRoot).key;
    pickedPathsByRoot.delete(key);
    sourceReadPathsByRoot.delete(key);
    deliveredSourcePathsByRoot.delete(key);
    invalidatePersistedBoardGrants(boardRoot);
}

/** Return a canonical local file only when this board received it as its own source this session. */
export async function isDeliveredSourceFile(boardRoot: string, requestedPath: string): Promise<string | undefined> {
    const root = await realpathNative(boardRoot);
    const candidate = await realpathNative(requestedPath);
    const key = BoardRoot.from(root).key;
    if (!deliveredSourcePathsByRoot.get(key)?.has(normalizedForCompare(candidate))) return undefined;
    if (!(await fs.promises.stat(candidate)).isFile()) return undefined;
    return candidate;
}

export async function isDialogPickedPath(boardRoot: string, requestedPath: string, folder: boolean): Promise<string | undefined> {
    const root = await realpathNative(boardRoot);
    const candidate = await resolveExistingOrNewTarget(requestedPath, folder ? "folder" : "write");
    const picks = pickedPathsByRoot.get(BoardRoot.from(root).key) ?? [];
    return picks.some((pick) => pick.folder === folder && normalizedForCompare(pick.path) === normalizedForCompare(candidate))
        ? candidate
        : undefined;
}

/** Record only paths actually returned by this board's native dialog. */
export async function recordPickedPaths(
    boardRoot: string,
    values: string | string[] | undefined,
    folder: boolean,
    grant: BoardGrant,
): Promise<void> {
    requireDialogPermission(grant);
    if (values === undefined) return;
    const picks = Array.isArray(values) ? values : [values];
    const root = await realpathNative(boardRoot);
    const recorded = pickedPathsByRoot.get(BoardRoot.from(root).key) ?? [];
    for (const value of picks) {
        const resolved = await resolveAuthorizedPath({
            boardRoot: root,
            requestedPath: value,
            userPicked: true,
            intent: folder ? "folder" : "write",
        });
        recorded.push({ path: resolved, folder });
    }
    pickedPathsByRoot.set(BoardRoot.from(root).key, recorded);
}

/** Re-resolve a just-created write target immediately before opening it. */
export async function recheckWriteTarget(
    boardRoot: string,
    requestedPath: string,
    grant: BoardGrant,
): Promise<string> {
    return resolveAuthorizedPath({ boardRoot, requestedPath, grant, intent: "write" });
}
