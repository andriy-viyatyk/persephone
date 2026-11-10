/**
 * The renderer mirror of main's board permission snapshot. Main owns the trusted
 * list, the trust file, and every grant decision; this module only reads the
 * snapshot and requests main-owned mutations. Trust is never read from a board
 * manifest, and this registry is not exposed on `app` or any script type.
 */
import { EventEndpoint } from "../../../ipc/api-types";
import type { BoardSnapshot, BoardSnapshotEntry, DisabledBundledBoard } from "../../../ipc/board-snapshot-channels";
import { api } from "../../../ipc/renderer/api";
import rendererEvents from "../../../ipc/renderer/renderer-events";
import { BoardGrant, type BoardPermissionChange } from "../../../shared/board/board-grant";
import type { NormalizedBoardPermissions } from "../../../shared/board/board-permissions";
import type { BoardServiceUseDeclaration } from "../../../shared/board/board-service-declarations";
import { BoardRoot } from "../../../shared/board/board-root";
import type { NormalizedBoardManifest } from "../../../shared/board/board-manifest-schema";
import { errMessage } from "../../../shared/utils";
import { settings } from "../settings";
import { MainSnapshotMirror } from "../../core/state/MainSnapshotMirror";
import { Emitter } from "../../core/state/events";
import { fpBasename, fpDirname, fpNormalizeForCompare } from "../../core/utils/file-path";
import { readBoardManifest } from "./board-manifest-io";

export type BoardOrigin = "trusted" | "bundled";

/** One permitted board, indexed by its normalized root and with a grant wrapper. */
export type BoardEntry = BoardSnapshotEntry & { readonly key: string; readonly grant: BoardGrant };

export interface BundledBoardInfo {
    readonly id: string;
    readonly root: string;
    readonly manifest: NormalizedBoardManifest;
    readonly enabled: boolean;
}

export interface BoardRegistryChange {
    added: BoardEntry[];
    removed: BoardEntry[];
    removedHere: BoardEntry[];
    updated: BoardEntry[];
    keys: string[];
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

interface BoardIndex {
    entries: BoardEntry[];
    byKey: Map<string, BoardEntry>;
    disabledByKey: Map<string, DisabledBundledBoard>;
}

interface IndexedBoardSnapshot extends BoardSnapshot {
    index: BoardIndex;
}

const EMPTY: BoardSnapshot = { revision: 0, boards: [], disabledBundled: [] };

function indexSnapshot(snapshot: BoardSnapshot): IndexedBoardSnapshot {
    const byKey = new Map<string, BoardEntry>();
    for (const wire of snapshot.boards) {
        const root = BoardRoot.tryFrom(wire.root);
        if (!root) continue;
        const entry: BoardEntry = { ...wire, key: root.key, grant: BoardGrant.from(wire.permissions) };
        const existing = byKey.get(root.key);
        if (!existing || (entry.origin === "bundled" && existing.origin !== "bundled")) byKey.set(root.key, entry);
    }
    const disabledByKey = new Map<string, DisabledBundledBoard>();
    for (const board of snapshot.disabledBundled) {
        const root = BoardRoot.tryFrom(board.root);
        if (root) disabledByKey.set(root.key, board);
    }
    return { ...snapshot, index: { entries: [...byKey.values()], byKey, disabledByKey } };
}

function sameArray<T>(left: readonly T[], right: readonly T[], same: (a: T, b: T) => boolean): boolean {
    return left.length === right.length && left.every((entry, index) => same(entry, right[index]));
}

function sameUses(left: BoardServiceUseDeclaration[], right: BoardServiceUseDeclaration[]): boolean {
    return sameArray(left, right, (a, b) => a.id === b.id && a.version === b.version);
}

function sameStrings(left: string[], right: string[]): boolean {
    return sameArray(left, right, (a, b) => a === b);
}

function sameEntry(left: BoardEntry, right: BoardEntry): boolean {
    return left.root === right.root
        && left.origin === right.origin
        && getBundledId(left) === getBundledId(right)
        && left.manifestChanged === right.manifestChanged
        && BoardGrant.same(left.permissions, right.permissions)
        && BoardGrant.same(left.manifestPermissions, right.manifestPermissions)
        && sameUses(left.uses, right.uses)
        && sameUses(left.manifestUses, right.manifestUses)
        && sameStrings(left.fileAccess.folderGrants, right.fileAccess.folderGrants)
        && sameStrings(left.fileAccess.fileGrants, right.fileAccess.fileGrants);
}

function getBundledId(entry: BoardEntry): string | undefined {
    return entry.origin === "bundled" ? entry.bundledId : undefined;
}

function diffIndex(previous: BoardIndex, next: BoardIndex): BoardRegistryChange | undefined {
    const added: BoardEntry[] = [];
    const removed: BoardEntry[] = [];
    const updated: BoardEntry[] = [];
    for (const key of new Set([...previous.byKey.keys(), ...next.byKey.keys()])) {
        const before = previous.byKey.get(key);
        const after = next.byKey.get(key);
        if (!before && after) added.push(after);
        else if (before && !after) removed.push(before);
        else if (before && after && !sameEntry(before, after)) updated.push(after);
    }
    if (!added.length && !removed.length && !updated.length) return undefined;
    return { added, removed, removedHere: [], updated, keys: [...added, ...removed, ...updated].map((entry) => entry.key) };
}

class BoardRegistry extends MainSnapshotMirror<IndexedBoardSnapshot> {
    private readonly changes = new Emitter<BoardRegistryChange>();
    private readonly bundledManifests = new Map<string, NormalizedBoardManifest>();
    private readonly requestedUntrustKeys = new Set<string>();
    private disabledPush: Promise<void> | undefined;

    constructor() {
        super(indexSnapshot(EMPTY));
        let previous = this.index;
        this.own(this.subscribeSnapshot(() => {
            const change = diffIndex(previous, this.index);
            previous = this.index;
            if (change) {
                change.removedHere = change.removed.filter((entry) => this.requestedUntrustKeys.has(entry.key));
                for (const entry of change.removedHere) this.requestedUntrustKeys.delete(entry.key);
                this.changes.fire(change);
            }
        }));
    }

    private get index(): BoardIndex { return this.snapshot.index; }

    protected override normalize(incoming: IndexedBoardSnapshot): IndexedBoardSnapshot {
        return indexSnapshot(incoming);
    }

    protected override revisionOf(snapshot: IndexedBoardSnapshot): number { return snapshot.revision; }

    protected async fetch(): Promise<IndexedBoardSnapshot> {
        await this.pushDisabledBundled();
        const snapshot = await api.getBoardSnapshot();
        await this.readBundledManifests(snapshot);
        return indexSnapshot(snapshot);
    }

    protected subscribeToMain(): void {
        this.attach(rendererEvents[EventEndpoint.eBoardSnapshotChanged], (snapshot) => this.apply(indexSnapshot(snapshot)));
        this.attach(settings.onChanged, ({ key }) => {
            if (key !== "disabled-bundled-boards") return;
            void api.setDisabledBundledBoards(settings.get("disabled-bundled-boards")).catch((error: unknown) => {
                console.error(`Disabled bundled board setting sync failed: ${errMessage(error)}`);
            });
        });
    }

    private pushDisabledBundled(): Promise<void> {
        this.disabledPush ??= (async () => {
            await settings.wait();
            await api.setDisabledBundledBoards(settings.get("disabled-bundled-boards"));
        })().catch((error: unknown) => {
            this.disabledPush = undefined;
            throw error;
        });
        return this.disabledPush;
    }

    private async readBundledManifests(snapshot: BoardSnapshot): Promise<void> {
        const roots = [...snapshot.boards.filter((board) => board.origin === "bundled"), ...snapshot.disabledBundled]
            .map((board) => board.root);
        await Promise.all(roots.map(async (root) => {
            const key = BoardRoot.tryFrom(root)?.key;
            if (!key || this.bundledManifests.has(key)) return;
            const manifest = await readBoardManifest(root);
            if (manifest) this.bundledManifests.set(key, manifest);
        }));
    }

    get(root: string): BoardEntry | undefined {
        const key = BoardRoot.tryFrom(root)?.key;
        return key ? this.index.byKey.get(key) : undefined;
    }

    list(origin?: BoardOrigin): BoardEntry[] {
        return origin ? this.index.entries.filter((entry) => entry.origin === origin) : [...this.index.entries];
    }

    roots(origin?: BoardOrigin): string[] { return this.list(origin).map((entry) => entry.root); }
    isPermitted(root: string): boolean { return this.get(root) !== undefined; }
    permissionOrigin(root: string): BoardOrigin | undefined { return this.get(root)?.origin; }
    isTrusted(root: string): boolean { return this.get(root)?.origin === "trusted"; }
    isBundled(root: string): boolean { return this.bundledId(root) !== undefined; }

    bundledId(root: string): string | undefined {
        const key = BoardRoot.tryFrom(root)?.key;
        if (!key) return undefined;
        const enabled = this.index.byKey.get(key);
        return (enabled?.origin === "bundled" ? enabled.bundledId : undefined)
            ?? this.index.disabledByKey.get(key)?.bundledId;
    }

    bundled(): BundledBoardInfo[] {
        const boards: BundledBoardInfo[] = [];
        for (const entry of this.index.entries) {
            if (entry.origin !== "bundled") continue;
            const manifest = this.bundledManifests.get(entry.key);
            if (manifest) boards.push({ id: entry.bundledId, root: entry.root, manifest, enabled: true });
        }
        for (const [key, entry] of this.index.disabledByKey) {
            const manifest = this.bundledManifests.get(key);
            if (manifest) boards.push({ id: entry.bundledId, root: entry.root, manifest, enabled: false });
        }
        return boards.sort((left, right) => left.id.localeCompare(right.id));
    }

    grant(root: string): BoardGrant | undefined { return this.get(root)?.grant; }

    permissionSnapshot(root: string): BoardPermissionSnapshot | undefined {
        const entry = this.get(root);
        if (!entry) return undefined;
        return {
            root,
            permissions: entry.permissions,
            manifestPermissions: entry.manifestPermissions,
            manifestChanged: entry.manifestChanged,
            changes: entry.grant.diff(entry.manifestPermissions),
            uses: entry.uses,
            manifestUses: entry.manifestUses,
            useChanges: diffBoardUses(entry.uses, entry.manifestUses),
        };
    }

    fileAccess(root: string): { folderGrants: string[]; fileGrants: string[] } {
        const fileAccess = this.get(root)?.fileAccess;
        return fileAccess
            ? { folderGrants: [...fileAccess.folderGrants], fileGrants: [...fileAccess.fileGrants] }
            : { folderGrants: [], fileGrants: [] };
    }

    subscribe(listener: (change: BoardRegistryChange) => void): () => void {
        return this.changes.event(listener);
    }

    subscribeMembership(listener: () => void): () => void {
        return this.subscribe((change) => {
            if (change.added.length || change.removed.length) listener();
        });
    }

    async trust(root: string, expectedPermissions?: NormalizedBoardPermissions, expectedUses?: BoardServiceUseDeclaration[]): Promise<void> {
        await api.setBoardTrust(root, true, expectedPermissions, expectedUses);
        await this.pullAfterMutation();
    }

    async untrust(root: string): Promise<void> {
        const key = BoardRoot.tryFrom(root)?.key;
        if (key) this.requestedUntrustKeys.add(key);
        try {
            await api.setBoardTrust(root, false);
        } catch (error) {
            if (key) this.requestedUntrustKeys.delete(key);
            throw error;
        }
        await this.pullAfterMutation();
    }

    async revokeFileAccessGrant(root: string, kind: "folder" | "file", canonicalPath: string): Promise<void> {
        await api.revokeBoardFileAccessGrant(root, kind, canonicalPath);
        await this.pullAfterMutation();
    }

    setBundledDisabled(id: string, disabled: boolean): void {
        const current = settings.get("disabled-bundled-boards");
        if (disabled && !current.includes(id)) settings.set("disabled-bundled-boards", [...current, id]);
        else if (!disabled && current.includes(id)) settings.set("disabled-bundled-boards", current.filter((entry) => entry !== id));
    }

    async resolvePersistedRoot(persistedRoot: string): Promise<string | undefined> {
        await this.load();
        if (await readBoardManifest(persistedRoot)) return persistedRoot;
        const candidateId = fpBasename(persistedRoot);
        const parentMatchesBoards = fpNormalizeForCompare(fpBasename(fpDirname(persistedRoot))) === "boards";
        if (!candidateId || !parentMatchesBoards) return undefined;
        return this.bundled().find((board) => fpNormalizeForCompare(board.id) === fpNormalizeForCompare(candidateId))?.root;
    }

    private async pullAfterMutation(): Promise<void> {
        this.apply(await this.fetch());
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

export const boardRegistry = new BoardRegistry();
