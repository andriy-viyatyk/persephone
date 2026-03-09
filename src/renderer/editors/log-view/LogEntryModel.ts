import { TOneState } from "../../core/state/state";
import { LogEntry } from "./logTypes";

/**
 * Reactive wrapper around a plain LogEntry object.
 *
 * Created lazily by LogViewModel when an entry becomes visible (virtualized grid)
 * or is accessed programmatically. Evicted when the entry scrolls out of view.
 *
 * Immutable fields: id, type, timestamp.
 * Mutable field: data (via TOneState for reactive UI updates).
 *
 * On flush/dispose, current data is written back to the plain LogEntry object
 * so state is preserved across model eviction cycles.
 */
export class LogEntryModel {
    readonly id: string;
    readonly type: string;
    readonly timestamp: number | undefined;
    readonly state: TOneState<{ data: any }>;

    /** Reference to the plain LogEntry in the entries array. */
    private entry: LogEntry;
    private disposed = false;

    constructor(entry: LogEntry) {
        this.entry = entry;
        this.id = entry.id;
        this.type = entry.type;
        this.timestamp = entry.timestamp;
        this.state = new TOneState({ data: entry.data });
    }

    /** Update the entry's data. Triggers reactive UI update and writes back to plain object. */
    update(data: any): void {
        if (this.disposed) return;
        this.state.update((s) => {
            s.data = data;
        });
        this.entry.data = data;
    }

    /** Merge partial data into the entry. */
    mergeData(partial: Record<string, any>): void {
        if (this.disposed) return;
        const newData = { ...this.state.get().data, ...partial };
        this.update(newData);
    }

    /** Returns the underlying plain LogEntry object. */
    toJSON(): LogEntry {
        return this.entry;
    }

    /** Sync current reactive state back to the plain LogEntry object. */
    flush(): void {
        if (this.disposed) return;
        this.entry.data = this.state.get().data;
    }

    /** Flush state and mark as disposed. */
    dispose(): void {
        if (this.disposed) return;
        this.flush();
        this.disposed = true;
    }
}
