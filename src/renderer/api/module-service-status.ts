import { EventEndpoint } from "../../ipc/api-types";
import { SERVICE_REQUEST_DEADLINE_MS, type BoardServiceStatus } from "../../ipc/module-service-channels";
import { api } from "../../ipc/renderer/api";
import rendererEvents from "../../ipc/renderer/renderer-events";
import { errMessage } from "../../shared/utils";
import { fpNormalizeForCompare } from "../core/utils/file-path";
import { withTimeout } from "../core/utils/utils";

const statuses = new Map<string, BoardServiceStatus>();
const statusEventRevisions = new Map<string, number>();
let statusSubscription: (() => void) | undefined;
let refreshPromise: Promise<void> | undefined;
let statusRevision = 0;

function statusKey(boardRoot: string): string {
    return fpNormalizeForCompare(boardRoot);
}

function replaceStatus(status: BoardServiceStatus): void {
    if (typeof status?.boardRoot !== "string" || status.boardRoot.length === 0) return;
    const key = statusKey(status.boardRoot);
    statusRevision += 1;
    statusEventRevisions.set(key, statusRevision);
    statuses.set(key, status);
}

async function hydrate(): Promise<void> {
    const hydrationRevision = statusRevision;
    const request = api.getModuleServiceStatuses();
    void request.catch((error: unknown) => {
        console.error(`Module service status hydration failed: ${errMessage(error)}`);
    });
    const snapshot = await withTimeout(request, SERVICE_REQUEST_DEADLINE_MS, undefined);
    if (!snapshot) return;
    const snapshotStatuses = new Map<string, BoardServiceStatus>();
    for (const status of snapshot) {
        if (typeof status?.boardRoot !== "string" || status.boardRoot.length === 0) continue;
        snapshotStatuses.set(statusKey(status.boardRoot), status);
    }
    for (const key of statuses.keys()) {
        if (!snapshotStatuses.has(key) && (statusEventRevisions.get(key) ?? 0) <= hydrationRevision) {
            statuses.delete(key);
        }
    }
    for (const [key, status] of snapshotStatuses) {
        if ((statusEventRevisions.get(key) ?? 0) > hydrationRevision) continue;
        statuses.set(key, status);
    }
}

/** Initialize the renderer-lifetime cache before trust synchronization can emit records. */
export async function initModuleServiceStatus(): Promise<void> {
    if (!statusSubscription) {
        statusSubscription = rendererEvents[EventEndpoint.eModuleServiceStatusChanged].subscribe(replaceStatus);
    }
    await refresh();
}

/** Refresh the cache from main, coalescing concurrent callers and bounding the IPC wait. */
export function refresh(): Promise<void> {
    if (!refreshPromise) {
        refreshPromise = hydrate().finally(() => {
            refreshPromise = undefined;
        });
    }
    return refreshPromise;
}

export function getStatus(boardRoot: string): BoardServiceStatus | undefined {
    return statuses.get(statusKey(boardRoot));
}

export const moduleServiceStatus = {
    getStatus,
    refresh,
};
