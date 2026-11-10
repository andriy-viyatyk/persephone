import { BoardRoot } from "../../shared/board/board-root";
import { SERVICE_REQUEST_DEADLINE_MS, type BoardServiceStatus } from "../../ipc/module-service-channels";
import { EventEndpoint } from "../../ipc/api-types";
import { api } from "../../ipc/renderer/api";
import rendererEvents from "../../ipc/renderer/renderer-events";
import { errMessage } from "../../shared/utils";
import { withTimeout } from "../core/utils/utils";
import { Emitter } from "../core/state/events";
import { MainSnapshotMirror } from "../core/state/MainSnapshotMirror";

type StatusMap = ReadonlyMap<string, BoardServiceStatus>;

const keyOf = (status: BoardServiceStatus): string | undefined =>
    typeof status?.boardRoot === "string" && status.boardRoot.length > 0
        ? BoardRoot.from(status.boardRoot).key
        : undefined;

class ModuleServiceStatus extends MainSnapshotMirror<StatusMap> {
    /** Stamp at which a key last received a broadcast event. */
    private readonly changedAt = new Map<string, number>();
    private readonly emitters = new Map<string, Emitter<BoardServiceStatus>>();

    constructor() { super(new Map()); }

    protected async fetch(): Promise<StatusMap | undefined> {
        const request = api.getModuleServiceStatuses();
        void request.catch((error: unknown) => console.error(`Module service status hydration failed: ${errMessage(error)}`));
        const statuses = await withTimeout(request, SERVICE_REQUEST_DEADLINE_MS, undefined);
        if (!statuses) return undefined;
        const map = new Map<string, BoardServiceStatus>();
        for (const status of statuses) {
            const key = keyOf(status);
            if (key) map.set(key, status);
        }
        return map;
    }

    protected subscribeToMain(): void {
        this.attach(rendererEvents[EventEndpoint.eModuleServiceStatusChanged], (status) => this.applyEvent(status));
    }

    /** Preserve event values per key when a pull started before those events. */
    protected override mergePull(current: StatusMap, pulled: StatusMap, startStamp: number): StatusMap {
        const fresh = (key: string) => (this.changedAt.get(key) ?? 0) > startStamp;
        const next = new Map(current);
        for (const key of current.keys()) if (!pulled.has(key) && !fresh(key)) next.delete(key);
        for (const [key, status] of pulled) if (!fresh(key)) next.set(key, status);
        return next;
    }

    private applyEvent(status: BoardServiceStatus): void {
        const key = keyOf(status);
        if (!key) return;
        const stamp = this.commit(new Map(this.snapshot).set(key, status));
        this.changedAt.set(key, stamp);
        this.emitters.get(key)?.fire(status);
    }

    getStatus(boardRoot: string): BoardServiceStatus | undefined {
        return this.snapshot.get(BoardRoot.from(boardRoot).key);
    }

    /** Refresh from main, coalescing concurrent callers; never rejects, with a bounded IPC wait. */
    refresh(): Promise<void> { return this.reload(); }

    /** Event-driven status notifications for one board, after its snapshot is updated. */
    subscribe(boardRoot: string, listener: (status: BoardServiceStatus) => void): () => void {
        const key = BoardRoot.from(boardRoot).key;
        let emitter = this.emitters.get(key);
        if (!emitter) {
            emitter = new Emitter<BoardServiceStatus>();
            this.emitters.set(key, emitter);
        }
        return emitter.event(listener);
    }
}

export const moduleServiceStatus = new ModuleServiceStatus();
