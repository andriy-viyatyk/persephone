import { EventEndpoint } from "../ipc/api-types";
import { capabilityRegistry } from "./capability-registry";
import { downloadService } from "./download-service";
import { moduleServiceSupervisor } from "./module-service-supervisor";
import { openWindows } from "./open-windows";
import { recheckBoardWatches } from "./board-bridge";
import { boardTrustService } from "./board-trust-service";
import { boardFileAccess } from "./board-file-access";

/** The single place that says who consumes a board trust snapshot and in what order. */
export function subscribeBoardTrustConsumers(): void {
    // Order matters: file access forgets grants before the registry, supervisor, and claims reconcile.
    boardTrustService.onSnapshot((snapshot) => boardFileAccess.onTrustSnapshot(snapshot.serviceSnapshot.trustedPaths));
    boardTrustService.onSnapshot((snapshot) => capabilityRegistry.replace(snapshot.serviceSnapshot));
    boardTrustService.onSnapshot((snapshot) => moduleServiceSupervisor.applyBoardServiceTrustSnapshot(snapshot.serviceSnapshot));
    boardTrustService.onSnapshot((snapshot) => downloadService.setBrowserUrlMaskClaims(snapshot.claims));
    boardTrustService.onBoardAccessChanged(recheckBoardWatches);
    boardTrustService.onTrustChanged((paths) => openWindows.send(EventEndpoint.eBoardTrustChanged, paths));
}
