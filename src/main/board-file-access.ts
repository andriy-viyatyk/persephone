import fs from "node:fs";
import path from "node:path";
import type { NormalizedBoardPermissions } from "../shared/board-manifest-utils";
import { boardPermissionError } from "../shared/board-manifest-utils";

type FileIntent = "read" | "write" | "folder";

interface ResolveOptions {
    boardRoot: string;
    requestedPath: string;
    permissions: NormalizedBoardPermissions;
    intent: FileIntent;
    rootOnly?: boolean;
}

interface PickedPath {
    readonly path: string;
    readonly folder: boolean;
}

const pickedPathsByRoot = new Map<string, PickedPath[]>();

function normalizedForCompare(value: string): string {
    const resolved = path.resolve(value);
    const pathRoot = path.parse(resolved).root;
    const trimmed = resolved.length > pathRoot.length ? resolved.replace(/[\\/]+$/, "") : resolved;
    return process.platform === "win32" ? trimmed.toLowerCase() : trimmed;
}

function isWithin(root: string, candidate: string): boolean {
    const relative = path.relative(normalizedForCompare(root), normalizedForCompare(candidate));
    return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
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
        throw boardPermissionError("fileSystem");
    }
    const driveDesignator = /^[A-Za-z]:/.test(slashNormalized) ? 2 : 0;
    if (driveDesignator && !path.win32.isAbsolute(slashNormalized)) throw boardPermissionError("fileSystem");
    if (slashNormalized.slice(driveDesignator).includes(":")) throw boardPermissionError("fileSystem");
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

function effectiveFileSystem(permissions: NormalizedBoardPermissions): false | "board" | "full" {
    return permissions.kind === "legacy" ? "full" : permissions.flags.fileSystem;
}

function allowedByScope(boardRoot: string, candidate: string, permissions: NormalizedBoardPermissions): boolean {
    const mode = effectiveFileSystem(permissions);
    if (mode === "full") return true;
    if (mode !== "board") return false;
    if (isWithin(boardRoot, candidate)) return true;
    const picks = pickedPathsByRoot.get(normalizedForCompare(boardRoot)) ?? [];
    return picks.some((pick) => pick.folder ? isWithin(pick.path, candidate) : normalizedForCompare(pick.path) === normalizedForCompare(candidate));
}

/** Resolve and authorize every path a board can cause the app to access. */
export async function resolveAuthorizedPath(options: ResolveOptions): Promise<string> {
    if (!options.rootOnly && effectiveFileSystem(options.permissions) === false) {
        throw boardPermissionError("fileSystem");
    }
    validateRequestedPath(options.requestedPath);
    const root = await realpathNative(options.boardRoot);
    const candidate = await resolveExistingOrNewTarget(
        path.isAbsolute(options.requestedPath) ? options.requestedPath : path.resolve(root, options.requestedPath),
        options.intent,
    );
    if (options.rootOnly) {
        if (!isWithin(root, candidate)) throw boardPermissionError("fileSystem");
        return candidate;
    }
    if (!allowedByScope(root, candidate, options.permissions)) throw boardPermissionError("fileSystem");
    return candidate;
}

export function requireDialogPermission(permissions: NormalizedBoardPermissions): void {
    if (effectiveFileSystem(permissions) === false) throw boardPermissionError("fileSystem");
}

/** Record only paths actually returned by this board's native dialog. */
export async function recordPickedPaths(
    boardRoot: string,
    values: string | string[] | undefined,
    folder: boolean,
    permissions: NormalizedBoardPermissions,
): Promise<void> {
    requireDialogPermission(permissions);
    if (values === undefined) return;
    const picks = Array.isArray(values) ? values : [values];
    const root = await realpathNative(boardRoot);
    const recorded = pickedPathsByRoot.get(normalizedForCompare(root)) ?? [];
    for (const value of picks) {
        const resolved = await resolveAuthorizedPath({
            boardRoot: root,
            requestedPath: value,
            permissions: { kind: "legacy", service: false },
            intent: folder ? "folder" : "write",
        });
        recorded.push({ path: resolved, folder });
    }
    pickedPathsByRoot.set(normalizedForCompare(root), recorded);
}

/** Re-resolve a just-created write target immediately before opening it. */
export async function recheckWriteTarget(
    boardRoot: string,
    requestedPath: string,
    permissions: NormalizedBoardPermissions,
): Promise<string> {
    return resolveAuthorizedPath({ boardRoot, requestedPath, permissions, intent: "write" });
}
