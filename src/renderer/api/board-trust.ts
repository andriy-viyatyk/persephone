/**
 * Per-board trust gate (EPIC-035). A Board's UI is web content and
 * `persephone.execute()` is arbitrary RCE, so a board does not render or run
 * until the user has trusted it. Trust is per board (its absolute root folder),
 * persisted across sessions in a line-delimited list of original-case absolute
 * paths at `<userData>/data/trustedBoards.txt`.
 *
 * Main owns that file and the snapshots derived from it (US-1538): this class
 * asks main to mutate trust and mirrors the authoritative list main returns or
 * broadcasts to every window, so no window can hold, or push back, a stale list.
 *
 * Trust is NEVER read from the board's manifest or any in-board file — a portable
 * board must not be able to self-trust. It is always a user action (the trust
 * dialog / the "Trust all boards in this project" bulk action) or a provenance
 * write Persephone makes for a board it created itself (auto-trust on create).
 * Matching uses `fpNormalizeForCompare` so separator/case variants on Windows
 * still match. This module is intentionally NOT exposed on the `app` object
 * model or any script `.d.ts` — a script must never be able to silently self-trust.
 */
import { api } from "../../ipc/renderer/api";
import { TGlobalState } from "../core/state/state";
import { fpNormalizeForCompare } from "../core/utils/file-path";
import type { NormalizedBoardPermissions, BoardPermissionFlags } from "../../shared/board-manifest-utils";

/**
 * True when `ancestorKey` equals or contains `descendantKey` (path-boundary aware).
 * Both arguments must already be normalized with `fpNormalizeForCompare`.
 */
export function pathCovers(ancestorKey: string, descendantKey: string): boolean {
    return descendantKey === ancestorKey || descendantKey.startsWith(ancestorKey + "/");
}

interface BoardTrustState {
    paths: string[];
    loaded: boolean;
}

export type BoardPermissionChange = {
    flag: keyof BoardPermissionFlags;
    kind: "added" | "removed" | "level";
    from?: boolean | string;
    to?: boolean | string;
};

export interface BoardPermissionSnapshot {
    root: string;
    permissions: NormalizedBoardPermissions;
    manifestPermissions: NormalizedBoardPermissions;
    manifestChanged: boolean;
    changes: BoardPermissionChange[];
}

export function diffBoardPermissions(
    granted: NormalizedBoardPermissions,
    proposed: NormalizedBoardPermissions,
): BoardPermissionChange[] {
    if (granted.kind === "legacy" || proposed.kind === "legacy") return [];
    const changes: BoardPermissionChange[] = [];
    for (const flag of Object.keys(granted.flags) as (keyof BoardPermissionFlags)[]) {
        const from = granted.flags[flag];
        const to = proposed.flags[flag];
        if (from === to) continue;
        const kind = from === false ? "added" : to === false ? "removed" : "level";
        changes.push({ flag, kind, from, to });
    }
    return changes;
}

class BoardTrust {
    private readonly state = new TGlobalState<BoardTrustState>({ paths: [], loaded: false });
    private loadPromise: Promise<void> | undefined;
    private pathsRevision = 0;
    private grants = new Map<string, NormalizedBoardPermissions>();
    private manifests = new Map<string, NormalizedBoardPermissions>();
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
        const next = new Map(entries.map(({ boardRoot, permissions }) => [fpNormalizeForCompare(boardRoot), permissions]));
        const nextManifests = new Map(entries.map(({ boardRoot, manifestPermissions }) => [fpNormalizeForCompare(boardRoot), manifestPermissions]));
        const changedRoots = new Set<string>();
        for (const root of new Set([...this.grants.keys(), ...next.keys(), ...this.manifests.keys(), ...nextManifests.keys()])) {
            if (JSON.stringify(this.grants.get(root)) !== JSON.stringify(next.get(root))
                || JSON.stringify(this.manifests.get(root)) !== JSON.stringify(nextManifests.get(root))) changedRoots.add(root);
        }
        this.grants = next;
        this.manifests = nextManifests;
        if (changedRoots.size) {
            for (const listener of this.grantListeners) listener([...changedRoots]);
        }
    }

    async allows(boardRoot: string, flag: keyof BoardPermissionFlags): Promise<boolean> {
        try {
            await this.loadGrants();
            const key = fpNormalizeForCompare(boardRoot);
            const grant = [...this.grants].find(([root]) => pathCovers(root, key))?.[1];
            if (!grant) return false;
            if (grant.kind === "legacy") return flag !== "service" || grant.service;
            const value = grant.flags[flag];
            return value === true || value === "board" || value === "full" || value === "internet";
        } catch { return false; }
    }

    async getGrantedPermissions(boardRoot: string): Promise<NormalizedBoardPermissions | undefined> {
        try {
            await this.loadGrants();
            const key = fpNormalizeForCompare(boardRoot);
            return [...this.grants].find(([root]) => pathCovers(root, key))?.[1];
        } catch { return undefined; }
    }

    async getPermissionSnapshot(boardRoot: string): Promise<BoardPermissionSnapshot | undefined> {
        try {
            await this.loadGrants();
            const root = fpNormalizeForCompare(boardRoot);
            const matchedRoot = this.grants.has(root)
                ? root
                : [...this.grants.keys()].find((candidate) => pathCovers(candidate, root));
            if (!matchedRoot) return undefined;
            const permissions = this.grants.get(matchedRoot);
            const manifestPermissions = this.manifests.get(matchedRoot);
            if (!permissions || !manifestPermissions) return undefined;
            return {
                root: boardRoot,
                permissions,
                manifestPermissions,
                manifestChanged: JSON.stringify(permissions) !== JSON.stringify(manifestPermissions),
                changes: diffBoardPermissions(permissions, manifestPermissions),
            };
        } catch { return undefined; }
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
        const key = fpNormalizeForCompare(boardRoot);
        return this.state.get().paths.some((root) => pathCovers(fpNormalizeForCompare(root), key));
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
    async trust(boardRoot: string, expectedPermissions?: NormalizedBoardPermissions): Promise<void> {
        this.applyAuthoritativePaths(await api.setBoardTrust(boardRoot, true, expectedPermissions));
        await this.loadGrants();
    }

    /** Remove a board from main's trusted list. */
    async untrust(boardRoot: string): Promise<void> {
        this.applyAuthoritativePaths(await api.setBoardTrust(boardRoot, false));
        await this.loadGrants();
    }
}

export const boardTrust = new BoardTrust();
