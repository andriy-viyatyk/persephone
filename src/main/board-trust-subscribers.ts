import { capabilityRegistry } from "./capability-registry";
import { downloadService } from "./download-service";
import { moduleServiceSupervisor } from "./module-service-supervisor";
import { recheckBoardWatches } from "./board-bridge";
import { boardTrustService } from "./board-trust-service";
import { boardFileAccess } from "./board-file-access";
import { boardSnapshotBroadcaster } from "./board-snapshot-broadcaster";
import type { BoardTrustSnapshot } from "./board-trust-snapshot-builder";

/** The single place that says who consumes a board trust snapshot and in what order. */
export function subscribeBoardTrustConsumers(): void {
    // Order matters: file access forgets grants before the registry, supervisor, claims, and broadcaster reconcile.
    const onServiceChange = (consume: (snapshot: BoardTrustSnapshot) => void | Promise<void>): void => {
        boardTrustService.onSnapshot((snapshot) => (snapshot.change === "file-access" ? undefined : consume(snapshot)));
    };
    onServiceChange((snapshot) => boardFileAccess.onTrustSnapshot(snapshot.serviceSnapshot.trustedPaths));
    onServiceChange((snapshot) => capabilityRegistry.replace(snapshot.serviceSnapshot));
    onServiceChange((snapshot) => moduleServiceSupervisor.applyBoardServiceTrustSnapshot(snapshot.serviceSnapshot));
    onServiceChange((snapshot) => downloadService.setBrowserUrlMaskClaims(snapshot.claims));
    // Last: windows are told after the main-side consumers have started reconciling.
    boardTrustService.onSnapshot((snapshot) => boardSnapshotBroadcaster.publish(snapshot));
    boardTrustService.onBoardAccessChanged(recheckBoardWatches);
}
