import { EventEndpoint } from "../ipc/api-types";
import type { BoardSnapshot } from "../ipc/board-snapshot-channels";
import type { BoardTrustSnapshot } from "./board-trust-snapshot-builder";
import { openWindows } from "./open-windows";

class BoardSnapshotBroadcaster {
    private snapshot: BoardSnapshot = { revision: 0, boards: [], disabledBundled: [] };
    private serialized = "";

    /** Send when the content differs from the last publish; a repeat is not a new revision. */
    publish(trust: BoardTrustSnapshot): void {
        const content = { boards: trust.entries, disabledBundled: trust.disabledBundled };
        const serialized = JSON.stringify(content);
        if (serialized === this.serialized) return;
        this.serialized = serialized;
        this.snapshot = { revision: this.snapshot.revision + 1, ...content };
        openWindows.send(EventEndpoint.eBoardSnapshotChanged, this.snapshot);
    }

    current(): BoardSnapshot {
        return this.snapshot;
    }
}

export const boardSnapshotBroadcaster = new BoardSnapshotBroadcaster();
