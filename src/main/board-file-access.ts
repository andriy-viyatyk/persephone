import fs from "node:fs";
import path from "node:path";
import { codedError } from "../shared/coded-error";
import { BoardGrant } from "../shared/board/board-grant";
import { BoardRoot } from "../shared/board/board-root";
import { comparePathKey, isPathInside } from "./utils";
import { boardTrustService } from "./board-trust-service";

type FileIntent = "read" | "write" | "folder" | "list";
type GrantKind = "folder" | "file";

interface PickedPath {
    readonly path: string;
    readonly folder: boolean;
}

export type RememberPlan = { kind: "covered" } | { kind: "declined" } | { kind: "ask"; path: string };

export class BoardFileAccessService {
    private readonly picks = new Map<string, PickedPath[]>();
    private readonly sourceReads = new Map<string, Set<string>>();
    private readonly deliveredSources = new Map<string, Set<string>>();
    private trustedKeys = new Map<string, string>();

    /** Resolve and authorize a path a board asked for. Looks up the board's grant; no grant denies. */
    async authorize(boardRoot: string, requestedPath: string, intent: FileIntent): Promise<string> {
        const grant = await boardTrustService.getGrant(boardRoot);
        if (!grant) throw BoardGrant.deny("fileSystem");
        return this.resolve(boardRoot, requestedPath, intent, grant);
    }

    /** Resolve a hosted document read by exact canonical identity, or use normal file authorization. */
    async authorizeHostedRead(boardRoot: string, requestedPath: string, hostedPath: string | null): Promise<string> {
        const grant = await boardTrustService.getGrant(boardRoot);
        if (!grant) throw BoardGrant.deny("fileSystem");
        if (hostedPath) {
            try {
                validateRequestedPath(requestedPath);
                validateRequestedPath(hostedPath);
                const root = await realpathNative(boardRoot);
                const requested = path.isAbsolute(requestedPath) ? requestedPath : path.resolve(root, requestedPath);
                const requestedCanonical = await realpathNative(
                    process.platform === "win32" ? normalizeWindowsComponents(requested) : requested,
                );
                const hostedCanonical = await realpathNative(
                    process.platform === "win32" ? normalizeWindowsComponents(hostedPath) : hostedPath,
                );
                if (comparePathKey(requestedCanonical) === comparePathKey(hostedCanonical)) return requestedCanonical;
            } catch {
                // Invalid or missing candidates cannot use the hosted-document exception.
            }
        }
        return this.authorize(boardRoot, requestedPath, "read");
    }

    /** Confine access to a resource root without requiring a board trust grant. */
    async authorizeInsideRoot(rootPath: string, requestedPath: string): Promise<string> {
        validateRequestedPath(requestedPath);
        const root = await realpathNative(rootPath);
        const candidate = await resolveExistingOrNewTarget(
            path.isAbsolute(requestedPath) ? requestedPath : path.resolve(root, requestedPath), "read",
        );
        if (!isPathInside(root, candidate)) throw BoardGrant.deny("fileSystem");
        return candidate;
    }

    async planRemember(boardRoot: string, kind: GrantKind, requestedPath: string): Promise<RememberPlan> {
        if (await this.isRemembered(boardRoot, kind, requestedPath)) return { kind: "covered" };
        const grant = await boardTrustService.getGrant(boardRoot);
        if (grant?.fileSystemMode() === "full") return { kind: "covered" };

        const picked = kind === "folder"
            ? await this.isDialogPickedPath(boardRoot, requestedPath, true)
            : await this.isDialogPickedPath(boardRoot, requestedPath, false)
                ?? await this.isDeliveredSourceFile(boardRoot, requestedPath);
        if (!picked) {
            const message = kind === "folder"
                ? "Only a folder picked by this board can be remembered."
                : "Only a file picked or delivered as a source to this board can be remembered.";
            throw codedError("permission-denied", message);
        }
        if (!grant) throw codedError("permission-denied", "This board is not trusted.");
        if (grant.fileSystemMode() !== "board") return { kind: "declined" };

        if (kind === "folder") {
            const folderStat = await fs.promises.stat(picked).catch((): undefined => undefined);
            if (!folderStat?.isDirectory()) throw codedError("not-directory", "The selected folder is no longer a folder.");
        } else {
            const selectedStat = await fs.promises.stat(picked).catch((): undefined => undefined);
            if (selectedStat && !selectedStat.isFile()) throw codedError("permission-denied", "Only regular files can be remembered.");
            if (!selectedStat) {
                const parentStat = await fs.promises.stat(path.dirname(picked));
                if (!parentStat.isDirectory()) throw codedError("not-directory", "The selected file's parent path is not a folder.");
            }
        }
        return { kind: "ask", path: picked };
    }

    async remember(boardRoot: string, kind: GrantKind, canonicalPath: string): Promise<void> {
        await boardTrustService.addFileAccessGrant(boardRoot, kind, canonicalPath);
    }

    async revoke(boardRoot: string, kind: GrantKind, canonicalPath: string): Promise<void> {
        await boardTrustService.revokeFileAccessGrant(boardRoot, kind, canonicalPath);
    }

    async grantSourceReads(boardRoot: string, sourceValues: string[], contextValues: string[] = []): Promise<void> {
        const grant = await boardTrustService.getGrant(boardRoot);
        if (!grant) throw new Error("This board is not trusted.");
        await this.recordSourceReads(boardRoot, sourceValues, grant.fileSystemMode() === "board" ? contextValues : []);
    }

    async requireDialogPermission(boardRoot: string): Promise<void> {
        const grant = await boardTrustService.getGrant(boardRoot);
        if (!grant || grant.fileSystemMode() === false) throw BoardGrant.deny("fileSystem");
    }

    async recordPickedPaths(boardRoot: string, values: string | string[] | undefined, folder: boolean): Promise<void> {
        await this.requireDialogPermission(boardRoot);
        if (values === undefined) return;
        const root = await realpathNative(boardRoot);
        const key = BoardRoot.from(root).key;
        const recorded = this.picks.get(key) ?? [];
        for (const value of Array.isArray(values) ? values : [values]) {
            const resolved = await this.resolveUserPicked(root, value, folder ? "folder" : "write");
            recorded.push({ path: resolved, folder });
        }
        this.picks.set(key, recorded);
    }

    async onTrustSnapshot(trustedRoots: readonly string[]): Promise<void> {
        const next = new Map(trustedRoots.map((root) => [BoardRoot.from(root).key, root]));
        const removed = [...this.trustedKeys.entries()].filter(([key]) => !next.has(key));
        this.trustedKeys = next;
        for (const [key] of removed) this.forgetKey(key);
        await Promise.all(removed.map(async ([, root]) => {
            const realRoot = await realpathNative(root).catch((): undefined => undefined);
            if (realRoot) this.forgetKey(BoardRoot.from(realRoot).key);
        }));
    }

    private async isDeliveredSourceFile(boardRoot: string, requestedPath: string): Promise<string | undefined> {
        const root = await realpathNative(boardRoot);
        const candidate = await realpathNative(requestedPath);
        const key = BoardRoot.from(root).key;
        if (!this.deliveredSources.get(key)?.has(comparePathKey(candidate))) return undefined;
        if (!(await fs.promises.stat(candidate)).isFile()) return undefined;
        return candidate;
    }
    private async isDialogPickedPath(boardRoot: string, requestedPath: string, folder: boolean): Promise<string | undefined> {
        const root = await realpathNative(boardRoot);
        const candidate = await resolveExistingOrNewTarget(requestedPath, folder ? "folder" : "write");
        const picks = this.picks.get(BoardRoot.from(root).key) ?? [];
        return picks.some((pick) => pick.folder === folder && comparePathKey(pick.path) === comparePathKey(candidate)) ? candidate : undefined;
    }
    private async resolve(boardRoot: string, requestedPath: string, intent: FileIntent, grant: BoardGrant): Promise<string> {
        validateRequestedPath(requestedPath);
        const root = await realpathNative(boardRoot);
        const candidate = await resolveExistingOrNewTarget(
            path.isAbsolute(requestedPath) ? requestedPath : path.resolve(root, requestedPath), intent,
        );
        const grants = await boardTrustService.getFileAccessGrants(root);
        await this.verifyFileGrantIdentity(candidate, intent, grants.fileGrants);
        if (!this.allowedByScope(root, candidate, grant, intent, grants)) throw BoardGrant.deny("fileSystem");
        return candidate;
    }

    private async verifyFileGrantIdentity(candidate: string, intent: FileIntent, fileGrants: readonly string[]): Promise<void> {
        const fileGrant = fileGrants.find((file) => this.isGrantedFile([file], candidate));
        if (fileGrant && intent !== "folder" && intent !== "list") {
            try {
                const stat = await fs.promises.stat(candidate);
                if (!stat.isFile()) throw BoardGrant.deny("fileSystem");
                const real = await realpathNative(candidate);
                if (comparePathKey(real) !== comparePathKey(fileGrant)) throw BoardGrant.deny("fileSystem");
            } catch (error: unknown) {
                if ((error as NodeJS.ErrnoException).code !== "ENOENT" || intent !== "write") throw error;
                const parent = await realpathNative(path.dirname(candidate));
                if (comparePathKey(path.join(parent, path.basename(candidate))) !== comparePathKey(fileGrant)) throw BoardGrant.deny("fileSystem");
            }
        }
    }

    private async resolveUserPicked(boardRoot: string, requestedPath: string, intent: FileIntent): Promise<string> {
        validateRequestedPath(requestedPath);
        const root = await realpathNative(boardRoot);
        const candidate = await resolveExistingOrNewTarget(path.isAbsolute(requestedPath) ? requestedPath : path.resolve(root, requestedPath), intent);
        const grants = await boardTrustService.getFileAccessGrants(root);
        await this.verifyFileGrantIdentity(candidate, intent, grants.fileGrants);
        return candidate;
    }

    private allowedByScope(boardRoot: string, candidate: string, grant: BoardGrant, intent: FileIntent,
        grants: { folderGrants: string[]; fileGrants: string[] }): boolean {
        const mode = grant.fileSystemMode();
        if (mode === "full") return true;
        if (intent === "read") {
            const key = BoardRoot.from(boardRoot).key;
            const candidateKey = comparePathKey(candidate);
            if (this.sourceReads.get(key)?.has(candidateKey) || this.deliveredSources.get(key)?.has(candidateKey)) return true;
        }
        if (mode !== "board") return false;
        if (isPathInside(boardRoot, candidate)) return true;
        const picks = this.picks.get(BoardRoot.from(boardRoot).key) ?? [];
        if (picks.some((pick) => pick.folder ? isPathInside(pick.path, candidate) : comparePathKey(pick.path) === comparePathKey(candidate))) return true;
        if ((intent === "read" || intent === "list" || intent === "folder") && this.coversFolder(grants.folderGrants, candidate)) return true;
        return (intent === "read" || intent === "write") && this.isGrantedFile(grants.fileGrants, candidate);
    }

    private coversFolder(folders: readonly string[], candidate: string): boolean {
        return folders.some((folder) => isPathInside(folder, candidate));
    }

    private isGrantedFile(files: readonly string[], candidate: string): boolean {
        return files.some((file) => comparePathKey(file) === comparePathKey(candidate));
    }

    private async isRemembered(boardRoot: string, kind: GrantKind, requestedPath: string): Promise<boolean> {
        if (!path.isAbsolute(requestedPath)) return false;
        const canonical = await realpathNative(requestedPath).catch((): undefined => undefined);
        if (!canonical) return false;
        const grants = await boardTrustService.getFileAccessGrants(boardRoot);
        return kind === "folder" ? this.coversFolder(grants.folderGrants, canonical) : this.isGrantedFile(grants.fileGrants, canonical);
    }

    private async recordSourceReads(boardRoot: string, sourceValues: string[], contextValues: string[]): Promise<void> {
        if (!Array.isArray(sourceValues) || !Array.isArray(contextValues) || sourceValues.length + contextValues.length > 5000) {
            throw new TypeError("At most 5,000 source paths may be delivered at once.");
        }
        const root = await realpathNative(boardRoot);
        const key = BoardRoot.from(root).key;
        const delivered = this.deliveredSources.get(key) ?? new Set<string>();
        const context = this.sourceReads.get(key) ?? new Set<string>();
        for (const [values, granted] of [[sourceValues, delivered], [contextValues, context]] as const) {
            for (const value of values) {
                if (typeof value !== "string" || !path.isAbsolute(value) || /^(https?|archive):/i.test(value)) continue;
                try {
                    validateRequestedPath(value);
                    const canonical = await realpathNative(process.platform === "win32" ? normalizeWindowsComponents(value) : value);
                    if ((await fs.promises.stat(canonical)).isFile()) granted.add(comparePathKey(canonical));
                } catch { /* delivered URLs, archive paths, missing files, and special files are not grants */ }
            }
        }
        if (delivered.size) this.deliveredSources.set(key, delivered);
        if (context.size) this.sourceReads.set(key, context);
    }

    private forgetKey(key: string): void {
        this.picks.delete(key);
        this.sourceReads.delete(key);
        this.deliveredSources.delete(key);
    }
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
    if (slashNormalized.startsWith("\\\\?\\") || slashNormalized.startsWith("\\\\.\\")) throw BoardGrant.deny("fileSystem");
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

export const boardFileAccess = new BoardFileAccessService();

