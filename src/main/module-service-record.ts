import { spawnSync } from "node:child_process";
import type { MessagePortMain, UtilityProcess, WebContents } from "electron";
import { errMessage } from "../shared/utils";
import type { BoardServiceState } from "../ipc/module-service-channels";
import type { ModuleServiceStorageAdapter } from "./module-service-storage";
import type { RestartBudget } from "./module-service-restart-budget";

export class ServiceError extends Error {
    constructor(readonly code: string, message = code) {
        super(message);
        this.name = "ServiceError";
    }
}

export interface PendingRequest {
    resolve: (value: unknown) => void;
    reject: (reason: unknown) => void;
    timer: ReturnType<typeof setTimeout>;
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
    lifecycleListeners: Array<{ event: string; listener: () => void }>;
}

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
    generation: number;
    process?: UtilityProcess;
    startPromise?: Promise<{ boardRoot: string; pid?: number; startedAt: number }>;
    stopPromise?: Promise<void>;
    cancelAttempt?: (error: ServiceError) => void;
    requests: Map<string, PendingRequest>;
    pendingRequestSlots: number;
    leases: Map<number, RendererLease>;
    storageAdapter?: ModuleServiceStorageAdapter;
    leaseCounter: number;
    stopRequested: boolean;
}

export function isCurrent(record: ServiceRecord, process: UtilityProcess, generation: number): boolean {
    return record.process === process && record.generation === generation;
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
