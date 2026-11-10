import path from "node:path";
import type { TrustedBoardSnapshotEntry } from "../ipc/module-service-channels";
import { SerialQueue } from "../shared/serial-queue";
import type { BoardServiceUseDeclaration } from "../shared/board/board-service-declarations";
import { BoardGrant } from "../shared/board/board-grant";
import type { NormalizedBoardPermissions } from "../shared/board/board-permissions";
import { BoardRoot } from "../shared/board/board-root";
import { boardTrustStore, type TrustedBoardGrant } from "./board-trust-store";
import { buildBoardTrustSnapshot, manifestPermissions, type BoardSource, type BoardTrustSnapshot, type BoardTrustSnapshotListener } from "./board-trust-snapshot-builder";
import { append as appendBoardLog } from "./board-log";
import { comparePathKey } from "./utils";
import { readBoardManifest } from "./board-manifest-reader";
import { bundledBoardId, listBundledBoards } from "./bundled-boards";

type BoardAccessChangedListener = (boardRoot: string) => Promise<void>;

class BoardTrustService {
    private initialization: Promise<void> | undefined;
    private readonly queue = new SerialQueue();
    private disabledBundledBoards = new Set<string>();
    private paths: string[] = [];
    private grants: TrustedBoardGrant[] = [];
    private snapshot: BoardTrustSnapshot = { serviceSnapshot: { trustedPaths: [], boards: [] }, claims: [] };
    private readonly snapshotListeners = new Set<BoardTrustSnapshotListener>();
    private readonly boardAccessChangedListeners = new Set<BoardAccessChangedListener>();
    private readonly trustChangedListeners = new Set<(trustedPaths: string[]) => void>();

    init(): Promise<void> {
        if (!this.initialization) {
            this.initialization = this.queue.run(async () => {
                this.grants = await boardTrustStore.load();
                this.paths = this.grants.map(({ root }) => root);
                await this.publish(await this.rebuild());
            });
        }
        return this.initialization;
    }

    async ready(): Promise<void> {
        await this.init();
    }

    onBoardAccessChanged(listener: BoardAccessChangedListener): () => void {
        this.boardAccessChangedListeners.add(listener);
        return () => this.boardAccessChangedListeners.delete(listener);
    }

    onSnapshot(listener: BoardTrustSnapshotListener): () => void {
        this.snapshotListeners.add(listener);
        return () => this.snapshotListeners.delete(listener);
    }

    onTrustChanged(listener: (trustedPaths: string[]) => void): () => void {
        this.trustChangedListeners.add(listener);
        return () => this.trustChangedListeners.delete(listener);
    }

    current(): BoardTrustSnapshot {
        return this.snapshot;
    }

    private publish(snapshot: BoardTrustSnapshot): Promise<void> {
        const pending: Promise<void>[] = [];
        for (const listener of [...this.snapshotListeners]) {
            try { pending.push(Promise.resolve(listener(snapshot))); }
            catch (error) { pending.push(Promise.reject(error)); }
        }
        return Promise.all(pending).then((): undefined => undefined);
    }

    private notifyTrustChanged(): void {
        for (const listener of [...this.trustChangedListeners]) listener([...this.paths]);
    }

    private async notifyBoardAccessChanged(boardRoots: string[]): Promise<void> {
        const results = await Promise.allSettled(boardRoots.flatMap((boardRoot) =>
            [...this.boardAccessChangedListeners].map((listener) => listener(boardRoot))));
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

    async refresh(): Promise<void> {
        await this.ready();
        await this.queue.run(async () => { await this.publish(await this.rebuild()); });
    }

    async getPermissionGrants(): Promise<Array<Omit<TrustedBoardSnapshotEntry, "capabilities" | "legacyCapabilities">>> {
        await this.ready();
        return this.snapshot.serviceSnapshot.boards.map(({ capabilities: _capabilities, legacyCapabilities: _legacyCapabilities, ...entry }) => entry);
    }

    async getGrant(boardRoot: string): Promise<BoardGrant | undefined> {
        await this.ready();
        return this.getGrantFromSnapshot(boardRoot);
    }

    async getGrantedRootsFromSnapshot(): Promise<string[]> {
        await this.ready();
        return this.snapshot.serviceSnapshot.boards.map(({ boardRoot }) => boardRoot)
            .filter((root) => !this.disabledBundledBoards.has(bundledBoardId(BoardRoot.from(root)) ?? ""));
    }

    /** Read an already-built main-owned grant snapshot without awaiting initialization. */
    getGrantFromSnapshot(boardRoot: string): BoardGrant | undefined {
        const permissions = this.snapshot.serviceSnapshot.boards.find(({ boardRoot: root }) => BoardRoot.from(root).equals(boardRoot))?.permissions;
        return permissions ? BoardGrant.from(permissions) : undefined;
    }

    getGrantedUsesFromSnapshot(boardRoot: string): BoardServiceUseDeclaration[] {
        return [...(this.snapshot.serviceSnapshot.boards.find(({ boardRoot: root }) => BoardRoot.from(root).equals(boardRoot))?.uses ?? [])];
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
            await this.saveGrants(nextGrants);
            this.grants = nextGrants;
            await this.notifyBoardAccessChanged([boardRoot]);
            this.notifyTrustChanged();
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
            await this.saveGrants(nextGrants);
            this.grants = nextGrants;
            await this.notifyBoardAccessChanged([boardRoot]);
            this.notifyTrustChanged();
        });
    }

    async allows(boardRoot: string, flag: keyof import("../shared/board/board-permissions").BoardPermissionFlags): Promise<boolean> {
        await this.ready();
        return (await this.getGrant(boardRoot))?.allows(flag) ?? false;
    }

    async setTrust(boardRoot: string, trusted: boolean, expectedPermissions?: NormalizedBoardPermissions, expectedUses?: BoardServiceUseDeclaration[]): Promise<string[]> {
        await this.ready();
        return this.queue.run(async () => {
            if (typeof boardRoot !== "string" || !path.isAbsolute(boardRoot)) {
                throw new Error("Board trust requires an absolute root path.");
            }
            const boardRootIdentity = BoardRoot.from(boardRoot);
            const nextGrants = [...this.grants];
            if (trusted) {
                const manifest = await readBoardManifest(boardRootIdentity);
                const permissions = manifestPermissions(manifest);
                const uses = manifest?.uses ?? [];
                if ((expectedPermissions && JSON.stringify(permissions) !== JSON.stringify(expectedPermissions))
                    || (expectedUses && JSON.stringify(uses) !== JSON.stringify(expectedUses))) {
                    throw new Error("Board permissions changed while the trust dialog was open. Review the updated permissions and try again.");
                }
                // Stored and shown as the resolved path (backslashes, original case); compare with the key.
                const grant = { root: boardRootIdentity.path, permissions, uses: expectedUses ?? uses };
                const kept = nextGrants.filter(({ root }) => !BoardRoot.from(root).equals(boardRootIdentity));
                nextGrants.splice(0, nextGrants.length, ...kept, grant);
            } else {
                nextGrants.splice(0, nextGrants.length, ...nextGrants.filter(({ root }) => !BoardRoot.from(root).equals(boardRootIdentity)));
            }
            await this.saveGrants(nextGrants);
            this.grants = nextGrants;
            this.paths = nextGrants.map(({ root }) => root);
            if (!trusted) this.dropFromSnapshot(boardRootIdentity);
            const applied = this.publish(await this.rebuild());
            applied.catch((): undefined => undefined);
            await this.notifyBoardAccessChanged([boardRoot]);
            this.notifyTrustChanged();
            await applied;
            return [...this.paths];
        });
    }

    async setDisabledBundledBoards(ids: string[]): Promise<void> {
        await this.ready();
        await this.queue.run(async () => {
            this.disabledBundledBoards = new Set(ids.filter((id): id is string => typeof id === "string"));
            await this.publish(await this.rebuild());
        });
    }

    private saveGrants(grants: TrustedBoardGrant[]): Promise<void> {
        return boardTrustStore.save(grants);
    }

    private dropFromSnapshot(root: BoardRoot): void {
        const serviceSnapshot = this.snapshot.serviceSnapshot;
        this.snapshot = {
            ...this.snapshot,
            serviceSnapshot: {
                ...serviceSnapshot,
                boards: serviceSnapshot.boards.filter(({ boardRoot }) => !BoardRoot.from(boardRoot).equals(root)),
                trustedPaths: serviceSnapshot.trustedPaths.filter((trustedRoot) => !BoardRoot.from(trustedRoot).equals(root)),
            },
        };
    }

    private async rebuild(): Promise<BoardTrustSnapshot> {
        const trustedSources = await Promise.all(this.paths.map(async (root): Promise<BoardSource> => ({
            root,
            manifest: await readBoardManifest(BoardRoot.from(root)),
        })));
        const enabledBundledSources = await this.readBundledSources();
        const build = buildBoardTrustSnapshot({
            grants: this.grants,
            trusted: trustedSources,
            bundled: enabledBundledSources,
        });
        if (build.reductions.length > 0) {
            const reductionLogs = build.reductions.flatMap(({ root, permissionChanges }) => permissionChanges
                ? [appendBoardLog(root, "info", `Board permissions reduced automatically: ${permissionChanges.join(", ")}.`)]
                : []);
            await this.saveGrants(build.grants);
            this.grants = build.grants;
            this.paths = build.grants.map(({ root }) => root);
            await Promise.all(reductionLogs.map((entry) => entry.catch((error: unknown) => {
                console.error("[BoardTrustService] Failed to write a permission-reduction board-log entry", error);
            })));
        }
        // Publish the current snapshot before access notifications; recheckBoardWatches reads it synchronously.
        this.snapshot = build.snapshot;
        if (build.reductions.length > 0) {
            await this.notifyBoardAccessChanged(this.grants.map(({ root }) => root));
            this.notifyTrustChanged();
        }
        return build.snapshot;
    }

    private async readBundledSources(): Promise<BoardSource[]> {
        const sources = await Promise.all((await listBundledBoards()).map(async ({ id, root }): Promise<BoardSource | null> => {
            const manifest = await readBoardManifest(root);
            return manifest ? { root: root.path, manifest, bundledId: id } : null;
        }));
        return sources.filter((source): source is BoardSource => source !== null)
            .filter((source) => !this.disabledBundledBoards.has(source.bundledId ?? ""));
    }
}

export const boardTrustService = new BoardTrustService();
