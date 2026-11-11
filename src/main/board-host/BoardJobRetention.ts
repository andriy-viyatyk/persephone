import { getJobsBySinkIds, reapJobsBySinkId } from "../command-runner";

interface OwnerSinks {
    sinkIds: Set<string>;
    hostWcId: number;
}

export interface BoardJobRetentionCallbacks {
    hasLivePort(ownerId: string): boolean;
    removeOwnerWatches(ownerId: string): void;
}

/** Owns job sink indexing and retention across board frame mounts. */
export class BoardJobRetention {
    private readonly ownerSinks = new Map<string, OwnerSinks>();
    private readonly busyOwners = new Set<string>();

    public constructor(private readonly callbacks: BoardJobRetentionCallbacks) {}

    public indexOwnerSink(ownerId: string, sinkId: string, hostWcId: number): void {
        let entry = this.ownerSinks.get(ownerId);
        if (!entry) {
            entry = { sinkIds: new Set(), hostWcId };
            this.ownerSinks.set(ownerId, entry);
        }
        entry.sinkIds.add(sinkId);
        entry.hostWcId = hostWcId;
    }

    public getJobs(ownerId: string) {
        const entry = this.ownerSinks.get(ownerId);
        return entry ? getJobsBySinkIds(entry.sinkIds) : [];
    }

    public setBoardBusy(ownerId: string, busy: boolean): void {
        if (busy) {
            this.busyOwners.add(ownerId);
            return;
        }
        this.busyOwners.delete(ownerId);
        if (!this.callbacks.hasLivePort(ownerId)) this.reapBoardOwner(ownerId);
    }

    /** Reaps all indexed sinks and watches for explicit whole-owner teardown. */
    public reapBoardOwner(ownerId: string): void {
        this.callbacks.removeOwnerWatches(ownerId);
        const entry = this.ownerSinks.get(ownerId);
        if (entry) {
            for (const sinkId of entry.sinkIds) reapJobsBySinkId(sinkId);
            this.ownerSinks.delete(ownerId);
        }
        this.busyOwners.delete(ownerId);
    }

    public disposeSink(ownerId: string, sinkId: string): void {
        if (this.busyOwners.has(ownerId)) return;
        reapJobsBySinkId(sinkId);
        this.ownerSinks.get(ownerId)?.sinkIds.delete(sinkId);
    }

    public reapHostOwners(hostWcId: number): void {
        for (const [ownerId, entry] of [...this.ownerSinks]) {
            if (entry.hostWcId === hostWcId) this.reapBoardOwner(ownerId);
        }
    }

    public clearBusy(): void {
        this.busyOwners.clear();
    }

    public reapAllOwners(): void {
        for (const ownerId of [...this.ownerSinks.keys()]) this.reapBoardOwner(ownerId);
    }
}
