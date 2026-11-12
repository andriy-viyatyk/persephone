import { spawnSync } from "node:child_process";
import type { MessagePortMain, UtilityProcess, WebContents } from "electron";
import { errMessage } from "../../shared/utils";
import type { BoardServiceState } from "../../ipc/module-service-channels";
import type { ModuleServiceStorageAdapter } from "./storage";
import type { RestartBudget } from "./restart-budget";
import type { PendingRequests } from "../../shared/pending-requests";
import type { ModuleServiceProcess } from "./process";

export class ServiceError extends Error {
    constructor(readonly code: string, message = code) {
        super(message);
        this.name = "ServiceError";
    }
}

export interface RendererLease {
    state: "attaching" | "attached" | "lost";
    ownerId: number;
    owner: WebContents;
    generation: number;
    leaseNonce: string;
    rendererPort: MessagePortMain;
    transferred: boolean;
    timer: ReturnType<typeof setTimeout>;
    resolve: () => void;
    reject: (reason: unknown) => void;
    stopLifecycle?: () => void;
}

export interface ServiceChannelOwner { boardId: string; generation: number; host: WebContents; consumerRoot?: string; interfaceId?: string; version?: number }

export interface ServiceRecord {
    key: string;
    boardRoot: string;
    serviceEntry?: string;
    canStartService: boolean;
    state: BoardServiceState;
    reason?: string;
    pid?: number;
    startedAt?: number;
    restartBudget: RestartBudget;
    terminalFailure: boolean;
    lastGeneration: number;
    current?: ModuleServiceProcess;
    startPromise?: Promise<{ boardRoot: string; pid?: number; startedAt: number }>;
    stopPromise?: Promise<void>;
    cancelAttempt?: (error: ServiceError) => void;
    requests: PendingRequests<unknown, undefined, string>;
    pendingRequestSlots: number;
    leases: Map<number, RendererLease>;
    channels: Map<string, ServiceChannelOwner>;
    storageAdapter?: ModuleServiceStorageAdapter;
    leaseCounter: number;
    stopRequested: boolean;
}

/** A service that has been forked: still loading its module (`starting`) or past the handshake (`running`). */
export function isStartedOrRunning(record: ServiceRecord): boolean {
    return record.state === "starting" || record.state === "running";
}

export function killUtilityProcessSync(child: UtilityProcess | undefined): void {
    if (!child) return;
    const pid = child.pid;
    try {
        child.kill();
    } catch {
        // The child may already have exited.
    }
    if (globalThis.process.platform !== "win32" || !pid) return;
    try {
        spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
            stdio: "ignore",
            windowsHide: true,
        });
    } catch (error) {
        console.warn(`Failed to reap utility process ${pid}: ${errMessage(error)}`);
    }
}
