/**
 * Per-board trust gate. A Board's UI is web content and
 * `persephone.execute()` is arbitrary RCE, so a board does not render or run
 * until the user has trusted it. Trust is per board (its absolute root folder),
 * persisted across sessions in a line-delimited list of original-case absolute
 * paths at `<userData>/data/trustedBoards.txt`.
 *
 * Main owns that file and the snapshots derived from it: this class
 * asks main to mutate trust and mirrors the authoritative list main returns or
 * broadcasts to every window, so no window can hold, or push back, a stale list.
 *
 * Trust is NEVER read from the board's manifest or any in-board file — a portable
 * board must not be able to self-trust. It is always a user action (the trust
 * dialog / the "Trust all boards in this project" bulk action) or a provenance
 * write Persephone makes for a board it created itself (auto-trust on create).
 * Matching uses the shared board-root key so separator/case variants on Windows
 * still match. This module is intentionally NOT exposed on the `app` object
 * model or any script `.d.ts` — a script must never be able to silently self-trust.
 */
import { BoardRoot } from "../../../shared/board/board-root";
import { api } from "../../../ipc/renderer/api";
import { TGlobalState } from "../../core/state/state";
import { isKeyInside } from "../../../shared/path-containment";
import { BoardGrant, type BoardPermissionChange } from "../../../shared/board/board-grant";
import type { NormalizedBoardPermissions, BoardPermissionFlags } from "../../../shared/board/board-permissions";
import { type BoardServiceUseDeclaration } from "../../../shared/board/board-service-declarations";

interface BoardTrustState {
    paths: string[];
    loaded: boolean;
}

export interface BoardPermissionSnapshot {
    root: string;
    permissions: NormalizedBoardPermissions;
    manifestPermissions: NormalizedBoardPermissions;
    manifestChanged: boolean;
    changes: BoardPermissionChange[];
    uses: BoardServiceUseDeclaration[];
    manifestUses: BoardServiceUseDeclaration[];
    useChanges: Array<{ kind: "added" | "removed"; use: BoardServiceUseDeclaration }>;
}

class BoardTrust {
    private readonly state = new TGlobalState<BoardTrustState>({ paths: [], loaded: false });
    private loadPromise: Promise<void> | undefined;
    private pathsRevision = 0;
    private grants = new Map<string, NormalizedBoardPermissions>();
    private manifests = new Map<string, NormalizedBoardPermissions>();
    private uses = new Map<string, BoardServiceUseDeclaration[]>();
    private manifestUses = new Map<string, BoardServiceUseDeclaration[]>();
    private fileAccess = new Map<string, { folderGrants: string[]; fileGrants: string[] }>();
    private grantsPromise: Promise<void> | undefined;
    private readonly grantListeners = new Set<(changedRoots: string[]) => void>();

    /** Load the main-owned trusted list once into reactive state. */
    async load(): Promise<void> {
        if (!this.loadPromise) {
            const revision = this.pathsRevision;
            this.loadPromise = api.getBoardTrustPaths()
                .then((paths) => {
                    if (revision === this.pathsRevision) this.applyAuthoritativePaths(paths);
                })
                .catch((error: unknown) => {
                    this.loadPromise = undefined;
                    throw error;
                });
        }
        await this.loadPromise;
        await this.loadGrants();
    }

    private async loadGrants(): Promise<void> {
        if (!this.grantsPromise) {
            this.grantsPromise = this.refreshGrants().catch((error: unknown) => {
                this.grantsPromise = undefined;
                throw error;
            });
        }
        await this.grantsPromise;
    }

    private async refreshGrants(): Promise<void> {
        const entries = await api.getBoardPermissionGrants();
        const next = new Map(entries.map(({ boardRoot, permissions }) => [BoardRoot.from(boardRoot).key, permissions]));
        const nextManifests = new Map(entries.map(({ boardRoot, manifestPermissions }) => [BoardRoot.from(boardRoot).key, manifestPermissions]));
        const nextUses = new Map(entries.map(({ boardRoot, uses }) => [BoardRoot.from(boardRoot).key, uses ?? []]));
        const nextManifestUses = new Map(entries.map(({ boardRoot, manifestUses }) => [BoardRoot.from(boardRoot).key, manifestUses ?? []]));
        const nextFileAccess = new Map(await Promise.all(entries.map(async ({ boardRoot }) => [
            BoardRoot.from(boardRoot).key, await api.getBoardFileAccessGrants(boardRoot),
        ] as const)));
        const changedRoots = new Set<string>();
        for (const root of new Set([...this.grants.keys(), ...next.keys(), ...this.manifests.keys(), ...nextManifests.keys(), ...this.uses.keys(), ...nextUses.keys(), ...this.manifestUses.keys(), ...nextManifestUses.keys(), ...this.fileAccess.keys(), ...nextFileAccess.keys()])) {
            if (JSON.stringify(this.grants.get(root)) !== JSON.stringify(next.get(root))
                || JSON.stringify(this.manifests.get(root)) !== JSON.stringify(nextManifests.get(root))
                || JSON.stringify(this.uses.get(root)) !== JSON.stringify(nextUses.get(root))
                || JSON.stringify(this.manifestUses.get(root)) !== JSON.stringify(nextManifestUses.get(root))
                || JSON.stringify(this.fileAccess.get(root)) !== JSON.stringify(nextFileAccess.get(root))) changedRoots.add(root);
        }
        this.grants = next;
        this.manifests = nextManifests;
        this.uses = nextUses;
        this.manifestUses = nextManifestUses;
        this.fileAccess = nextFileAccess;
        if (changedRoots.size) {
            for (const listener of this.grantListeners) listener([...changedRoots]);
        }
    }

    async allows(boardRoot: string, flag: keyof BoardPermissionFlags): Promise<boolean> {
        try {
            await this.loadGrants();
            const key = BoardRoot.from(boardRoot).key;
            const grant = [...this.grants].find(([root]) => isKeyInside(root, key))?.[1];
            if (!grant) return false;
            return BoardGrant.from(grant).allows(flag);
        } catch { return false; }
    }

    async getGrant(boardRoot: string): Promise<BoardGrant | undefined> {
        try {
            await this.loadGrants();
            const key = BoardRoot.from(boardRoot).key;
            const permissions = [...this.grants].find(([root]) => isKeyInside(root, key))?.[1];
            return permissions ? BoardGrant.from(permissions) : undefined;
        } catch { return undefined; }
    }

    async getPermissionSnapshot(boardRoot: string): Promise<BoardPermissionSnapshot | undefined> {
        try {
            await this.loadGrants();
            const root = BoardRoot.from(boardRoot).key;
            const matchedRoot = this.grants.has(root)
                ? root
                : [...this.grants.keys()].find((candidate) => isKeyInside(candidate, root));
            if (!matchedRoot) return undefined;
            const permissions = this.grants.get(matchedRoot);
            const manifestPermissions = this.manifests.get(matchedRoot);
            if (!permissions || !manifestPermissions) return undefined;
            return {
                root: boardRoot,
                permissions,
                manifestPermissions,
                manifestChanged: !BoardGrant.same(permissions, manifestPermissions)
                    || JSON.stringify(this.uses.get(matchedRoot) ?? []) !== JSON.stringify(this.manifestUses.get(matchedRoot) ?? []),
                changes: BoardGrant.from(permissions).diff(manifestPermissions),
                uses: this.uses.get(matchedRoot) ?? [],
                manifestUses: this.manifestUses.get(matchedRoot) ?? [],
                useChanges: diffBoardUses(this.uses.get(matchedRoot) ?? [], this.manifestUses.get(matchedRoot) ?? []),
            };
        } catch { return undefined; }
    }

    async getFileAccessGrants(boardRoot: string): Promise<{ folderGrants: string[]; fileGrants: string[] }> {
        try {
            await this.loadGrants();
            const key = BoardRoot.from(boardRoot).key;
            const match = [...this.fileAccess].find(([root]) => root === key)?.[1];
            return match ? { folderGrants: [...match.folderGrants], fileGrants: [...match.fileGrants] } : await api.getBoardFileAccessGrants(boardRoot);
        }
        catch { return { folderGrants: [], fileGrants: [] }; }
    }

    async revokeFileAccessGrant(boardRoot: string, kind: "folder" | "file", canonicalPath: string): Promise<void> {
        await api.revokeBoardFileAccessGrant(boardRoot, kind, canonicalPath);
        this.grantsPromise = undefined;
        await this.loadGrants();
    }

    /** Refresh main's live manifest metadata before an open/reload permission preflight. */
    async refreshPermissionSnapshot(): Promise<void> {
        this.grantsPromise = undefined;
        await this.loadGrants();
    }

    /** Read main's current list without updating reactive state. */
    async readPaths(): Promise<string[]> {
        try {
            return [...await api.getBoardTrustPaths()];
        } catch {
            return [];
        }
    }

    /** Sync check against loaded state. Ancestor-aware: parent trust is inherited. */
    isTrusted(boardRoot: string): boolean {
        const key = BoardRoot.from(boardRoot).key;
        return this.state.get().paths.some((root) => isKeyInside(BoardRoot.from(root).key, key));
    }

    /** All trusted paths (sync, non-reactive). Call `load()` first. */
    listPaths(): string[] {
        return [...this.state.get().paths];
    }

    /** True after the first successful main query or broadcast. */
    isLoaded(): boolean {
        return this.state.get().loaded;
    }

    /** Subscribe to main-authoritative trusted-list changes. */
    subscribePaths(listener: () => void): () => void {
        return this.state.subscribe(() => listener(), (state) => state.paths);
    }

    /** Subscribe to main-authoritative grant snapshot changes, including re-trust with unchanged paths. */
    subscribeGrants(listener: (changedRoots: string[]) => void): () => void {
        this.grantListeners.add(listener);
        return () => this.grantListeners.delete(listener);
    }

    /** Apply paths received from main IPC or its trust broadcast. */
    applyAuthoritativePaths(paths: string[]): void {
        this.pathsRevision += 1;
        const previousRoots = [...this.grants.keys()];
        this.grantsPromise = this.refreshGrants().catch(() => {
            this.grants.clear();
            this.fileAccess.clear();
            if (previousRoots.length) {
                for (const listener of this.grantListeners) listener(previousRoots);
            }
            this.grantsPromise = undefined;
        });
        this.state.update((state) => {
            if (state.paths.length !== paths.length || state.paths.some((root, index) => root !== paths[index])) {
                state.paths = [...paths];
            }
            state.loaded = true;
        });
    }

    /** Request a main-owned trust mutation after the caller's user confirmation. */
    async trust(boardRoot: string, expectedPermissions?: NormalizedBoardPermissions, expectedUses?: BoardServiceUseDeclaration[]): Promise<void> {
        this.applyAuthoritativePaths(await api.setBoardTrust(boardRoot, true, expectedPermissions, expectedUses));
        await this.loadGrants();
    }

    /** Remove a board from main's trusted list. */
    async untrust(boardRoot: string): Promise<void> {
        this.applyAuthoritativePaths(await api.setBoardTrust(boardRoot, false));
        await this.loadGrants();
    }
}

function diffBoardUses(granted: BoardServiceUseDeclaration[], proposed: BoardServiceUseDeclaration[]): Array<{ kind: "added" | "removed"; use: BoardServiceUseDeclaration }> {
    const key = (use: BoardServiceUseDeclaration) => `${use.id}\u0000${use.version}`;
    const grantedKeys = new Set(granted.map(key));
    const proposedKeys = new Set(proposed.map(key));
    return [
        ...proposed.filter((use) => !grantedKeys.has(key(use))).map((use) => ({ kind: "added" as const, use })),
        ...granted.filter((use) => !proposedKeys.has(key(use))).map((use) => ({ kind: "removed" as const, use })),
    ];
}

export const boardTrust = new BoardTrust();
