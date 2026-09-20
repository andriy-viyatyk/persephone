import { api } from "../../../ipc/renderer/api";
import { fs } from "../../api/fs";
import {
    fpBasename,
    fpDirname,
    fpJoin,
    fpNormalizeForCompare,
} from "../../core/utils/file-path";
import {
    readBoardManifest,
    type BoardManifest,
} from "./board-manifest";

/** A board shipped inside the application resources. */
export interface BundledBoard {
    /** Immediate child folder name under `assets/boards`. */
    readonly id: string;
    /** Current absolute filesystem root. */
    readonly root: string;
    readonly manifest: BoardManifest;
    readonly origin: "bundled";
}

class BundledBoardRegistry {
    private records: BundledBoard[] = [];
    private initialized = false;
    private initialization: Promise<void> | undefined;
    private refreshGeneration = 0;
    private readonly listeners = new Set<() => void>();

    async ensureInitialized(): Promise<void> {
        if (this.initialized) return;
        if (!this.initialization) {
            this.initialization = this.refresh().finally(() => {
                this.initialization = undefined;
            });
        }
        await this.initialization;
    }

    async refresh(): Promise<void> {
        const generation = ++this.refreshGeneration;
        const appRoot = await api.getAppRootPath();
        const boardsRoot = fpJoin(appRoot, "assets", "boards");
        const entries = await fs.listDirWithTypes(boardsRoot);
        const records: BundledBoard[] = [];

        for (const entry of entries) {
            if (!entry.isDirectory) continue;
            const root = fpJoin(boardsRoot, entry.name);
            const manifest = await readBoardManifest(root);
            if (!manifest) continue;
            records.push({
                id: entry.name,
                root,
                manifest,
                origin: "bundled",
            });
        }

        if (generation !== this.refreshGeneration) return;
        records.sort((left, right) => left.id.localeCompare(right.id));
        this.records = records;
        this.initialized = true;
        for (const listener of this.listeners) listener();
    }

    list(): readonly BundledBoard[] {
        return this.records;
    }

    isBundled(root: string): boolean {
        const key = fpNormalizeForCompare(root);
        return this.records.some((record) => fpNormalizeForCompare(record.root) === key);
    }

    /**
     * Resolve a persisted board root to its current path when it is a stale bundled root.
     * A readable manifest at the persisted path always wins: a user board must never be
     * adopted merely because its folder resembles an app-owned board.
     */
    async resolvePersistedRoot(persistedRoot: string): Promise<string | undefined> {
        await this.ensureInitialized();

        if (await readBoardManifest(persistedRoot)) return persistedRoot;

        const candidateId = fpBasename(persistedRoot);
        const parentName = fpBasename(fpDirname(persistedRoot));
        const parentMatchesBoards = process.platform === "win32"
            ? parentName.toLowerCase() === "boards"
            : parentName === "boards";
        if (!candidateId || !parentMatchesBoards) return undefined;

        const candidateKey = process.platform === "win32"
            ? candidateId.toLowerCase()
            : candidateId;
        return this.records.find((record) => {
            const recordKey = process.platform === "win32"
                ? record.id.toLowerCase()
                : record.id;
            return recordKey === candidateKey;
        })?.root;
    }

    subscribe(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }
}

export const bundledBoardRegistry = new BundledBoardRegistry();
