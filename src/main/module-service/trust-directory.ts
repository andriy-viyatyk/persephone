import path from "node:path";
import { BoardGrant } from "../../shared/board/board-grant";
import { BoardRoot } from "../../shared/board/board-root";
import { ServiceError } from "./record";
import type { BoardServiceTrustSnapshot, TrustedBoardSnapshotEntry } from "../../ipc/module-service-channels";

export interface ServiceProviderSelector {
    provider: string;
    version: number;
}

export interface TrustSnapshotChanges {
    previousEntries: ReadonlyMap<string, TrustedBoardSnapshotEntry>;
    currentEntries: ReadonlyMap<string, TrustedBoardSnapshotEntry>;
}

export class ServiceTrustDirectory {
    private snapshot: BoardServiceTrustSnapshot | undefined;
    private entriesByRoot = new Map<string, TrustedBoardSnapshotEntry>();
    private trustedRoots = new Set<string>();
    private providerKeys = new Map<string, string>();
    private providersByInterface = new Map<string, TrustedBoardSnapshotEntry[]>();

    constructor(private readonly makeProviderKey: () => string = () => crypto.randomUUID()) {}

    isReady(): boolean {
        return this.snapshot !== undefined;
    }

    isTrusted(root: string): boolean {
        return this.trustedRoots.has(BoardRoot.from(root).key);
    }

    entryFor(root: string): TrustedBoardSnapshotEntry | undefined {
        return this.entriesByRoot.get(BoardRoot.from(root).key);
    }

    entryByKey(key: string): TrustedBoardSnapshotEntry | undefined {
        return this.entriesByRoot.get(key);
    }

    apply(snapshot: BoardServiceTrustSnapshot): TrustSnapshotChanges {
        const previousEntries = this.entriesByRoot;
        const currentEntries = new Map<string, TrustedBoardSnapshotEntry>();
        for (const entry of snapshot.boards) {
            if (typeof entry.boardRoot === "string") currentEntries.set(BoardRoot.from(entry.boardRoot).key, entry);
        }

        for (const root of this.providerKeys.keys()) {
            if (!currentEntries.has(root)) this.providerKeys.delete(root);
        }

        const providersByInterface = new Map<string, TrustedBoardSnapshotEntry[]>();
        for (const entry of currentEntries.values()) {
            if (!this.isEligibleProvider(entry)) continue;
            for (const declaration of entry.serviceInterfaces ?? []) {
                const providers = providersByInterface.get(declaration.id) ?? [];
                providers.push(entry);
                providersByInterface.set(declaration.id, providers);
            }
        }

        this.snapshot = snapshot;
        this.entriesByRoot = currentEntries;
        this.trustedRoots = new Set(snapshot.trustedPaths.map((root) => BoardRoot.from(root).key));
        this.providersByInterface = providersByInterface;
        return { previousEntries, currentEntries };
    }

    requireProvider(selector: ServiceProviderSelector, interfaceId: string, version: number): TrustedBoardSnapshotEntry {
        if (!this.snapshot) throw new ServiceError("trust-not-ready");
        let entry: TrustedBoardSnapshotEntry | undefined;
        for (const [root, providerKey] of this.providerKeys) {
            if (providerKey === selector.provider) {
                entry = this.entriesByRoot.get(root);
                break;
            }
        }
        if (!entry || !entry.service) throw new ServiceError("service-not-declared");
        if (!this.isEligibleProvider(entry)) throw new ServiceError("permission-denied");
        if (!(entry.serviceInterfaces ?? []).some((item) => item.id === interfaceId && item.version === version)) {
            throw new ServiceError("service-not-declared");
        }
        return entry;
    }

    private isEligibleProvider(entry: TrustedBoardSnapshotEntry): boolean {
        return !!entry.service && entry.canStartService && BoardGrant.from(entry.permissions).allows("service");
    }

    providerKeyForRoot(root: string): string | undefined {
        return this.providerKeys.get(BoardRoot.from(root).key);
    }

    entryForProvider(selector: ServiceProviderSelector): TrustedBoardSnapshotEntry | undefined {
        for (const [root, providerKey] of this.providerKeys) {
            if (providerKey === selector.provider) return this.entriesByRoot.get(root);
        }
        return undefined;
    }

    listProviders(interfaceId: string): Array<{ provider: string; title: string; version: number; boardName: string }> {
        if (!this.snapshot) throw new ServiceError("trust-not-ready");
        const providers: Array<{ provider: string; title: string; version: number; boardName: string }> = [];
        for (const entry of this.providersByInterface.get(interfaceId) ?? []) {
            const root = BoardRoot.from(entry.boardRoot).key;
            let provider = this.providerKeys.get(root);
            if (!provider) {
                provider = this.makeProviderKey();
                this.providerKeys.set(root, provider);
            }
            const boardName = entry.boardName || path.basename(entry.boardRoot);
            for (const declaration of entry.serviceInterfaces ?? []) {
                if (declaration.id !== interfaceId) continue;
                providers.push({ provider, title: declaration.title || boardName, version: declaration.version, boardName });
            }
        }
        return providers;
    }
}
