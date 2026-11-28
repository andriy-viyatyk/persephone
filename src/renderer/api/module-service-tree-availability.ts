import { BoardRoot } from "../../shared/board/board-root";
import { Emitter } from "../core/state/events";

interface TreeAvailabilityEntry {
    emitter: Emitter<void>;
    subscriptions: number;
}

const entries = new Map<string, TreeAvailabilityEntry>();

function keyOf(boardRoot: string, type: string): string {
    return `${BoardRoot.from(boardRoot).key}\0${type}`;
}

/** Subscribe to a tree type's first registration announcement for each service lease. */
export function subscribeModuleServiceTreeAvailability(
    boardRoot: string,
    type: string,
    listener: () => void,
): () => void {
    const key = keyOf(boardRoot, type);
    let entry = entries.get(key);
    if (!entry) {
        entry = { emitter: new Emitter<void>(), subscriptions: 0 };
        entries.set(key, entry);
    }
    entry.subscriptions++;
    const subscriptionEntry = entry;
    const unsubscribe = subscriptionEntry.emitter.event(listener);
    let disposed = false;
    return () => {
        if (disposed) return;
        disposed = true;
        unsubscribe();
        subscriptionEntry.subscriptions--;
        if (subscriptionEntry.subscriptions === 0) {
            subscriptionEntry.emitter.dispose();
            entries.delete(key);
        }
    };
}

/** Publish after the current lease's cached capabilities record tree registration. */
export function notifyModuleServiceTreeAvailable(boardRoot: string, type: string): void {
    entries.get(keyOf(boardRoot, type))?.emitter.fire();
}
