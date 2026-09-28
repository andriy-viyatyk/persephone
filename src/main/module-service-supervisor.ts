import fs from "node:fs";
import path from "node:path";
import {
    type UtilityProcess,
    type WebContents,
    utilityProcess,
} from "electron";
import { EventEndpoint } from "../ipc/api-types";
import {
    MAX_OUTSTANDING_REQUESTS_PER_SERVICE,
    type BoardServiceState,
    SERVICE_HANDSHAKE_TIMEOUT_MS,
    SERVICE_REQUEST_DEADLINE_MS,
    SERVICE_SHUTDOWN_TIMEOUT_MS,
    type BoardServiceStatus,
    type ServiceParentMessage,
    type ServiceStopReason,
    STOP_REASON_CODE,
    STOP_REASON_LEASE_REASON,
    PROVIDER_OPERATION_POLICY,
    type ProviderOperation,
    type ServiceHostConfig,
    type StartResult,
    type BoardServiceTrustSnapshot,
    type TrustedBoardSnapshotEntry,
} from "../ipc/module-service-channels";
import { errMessage } from "../shared/utils";
import { MAX_BUFFERED_PIPE_BYTES, MAX_BOARD_PIPE_CHUNK_BYTES } from "../shared/board-pipe-constants";
import { ModuleServiceStorageAdapter } from "./module-service-storage";
import { openWindows } from "./open-windows";
import { getAssetPath } from "./utils";
import * as boardLog from "./board-log";
import { ServiceError, type ServiceRecord, isCurrent, killUtilityProcessSync } from "./module-service-record";
import { RestartBudget, RESTART_BUDGET } from "./module-service-restart-budget";
import { Handshake, routeProcessMessage } from "./module-service-handshake";
import { failLease, transferRendererLease, type LeaseCallbacks } from "./module-service-leases";

function normalizeRoot(boardRoot: string): string {
    const normalized = path.resolve(boardRoot).replace(/\\/g, "/").replace(/\/+$/, "");
    return globalThis.process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function pathCovers(ancestor: string, descendant: string): boolean {
    return descendant === ancestor || descendant.startsWith(`${ancestor}/`);
}

function delay(milliseconds: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

class ModuleServiceSupervisor {
    private readonly records = new Map<string, ServiceRecord>();
    private readonly leaseCallbacks: LeaseCallbacks = {
        getProcess: (record) => record.process,
        postMessage: (process, message, ports) => process.postMessage(message, ports),
    };
    private trustedSnapshot: BoardServiceTrustSnapshot | undefined;
    private disposing = false;

    async applyBoardServiceTrustSnapshot(snapshot: BoardServiceTrustSnapshot): Promise<void> {
        if (this.disposing) return;
        const previouslyUntrusted = new Set(
            [...this.records.values()]
                .filter((record) => !this.isEffectivelyTrusted(record.boardRoot))
                .map((record) => record.key),
        );
        this.trustedSnapshot = snapshot;
        const stopPromises: Promise<void>[] = [];

        const serviceEntries = new Map<string, TrustedBoardSnapshotEntry>();
        for (const entry of snapshot.boards) {
            if (typeof entry.boardRoot !== "string") continue;
            if (typeof entry.service !== "string" || !entry.service) continue;
            serviceEntries.set(normalizeRoot(entry.boardRoot), entry);
        }

        for (const [key, entry] of serviceEntries) {
            const existing = this.records.get(key);
            if (existing) {
                existing.boardRoot = entry.boardRoot;
                existing.serviceEntry = entry.service;
                existing.canStartService = entry.canStartService;
                if (existing.state === "stopped" && !entry.canStartService) {
                    this.transition(existing, "stopped", "permission-denied");
                }
                continue;
            }
            const record: ServiceRecord = {
                key,
                boardRoot: entry.boardRoot,
                serviceEntry: entry.service,
                canStartService: entry.canStartService,
                state: "stopped",
                reason: entry.canStartService ? "not-started" : "permission-denied",
                restartBudget: new RestartBudget(),
                terminalFailure: false,
                generation: 0,
                requests: new Map(),
                pendingRequestSlots: 0,
                leases: new Map(),
                leaseCounter: 0,
                stopRequested: false,
            };
            this.records.set(key, record);
            record.storageAdapter = new ModuleServiceStorageAdapter({
                getBoardRoot: () => record.boardRoot,
                getUnavailableCode: () => this.storageUnavailableCode(record),
                getOutstandingRequestCount: () => record.pendingRequestSlots + record.requests.size,
                isAvailable: () => this.isStorageAvailable(record),
                postMessage: (message) => record.process?.postMessage(message),
            });
            this.transition(record, record.state, record.reason);
        }

        // A board that STOPS declaring a service must lose its record entirely. Without this a
        // stale entry survives forever and `boards.list()` keeps reporting a `service` for a
        // manifest that no longer has one — which breaks the contract that the key is absent for
        // boards with no service, and shows an agent something that does not exist. A record
        // still holding a live process is stopped first so the declaration cannot be dropped
        // while its `utilityProcess` keeps running.
        for (const [key, record] of [...this.records]) {
            if (serviceEntries.has(key)) continue;
            stopPromises.push(this.stopRecord(
                record,
                this.isEffectivelyTrusted(record.boardRoot) ? "explicit" : "untrusted",
            ));
            this.records.delete(key);
        }

        for (const record of this.records.values()) {
            if (this.isEffectivelyTrusted(record.boardRoot)) {
                if (previouslyUntrusted.has(record.key) && record.reason === "untrusted") {
                    // Re-trust permits a future request/explicit start but never
                    // starts the retained service or clears its failure budget.
                    record.stopRequested = false;
                }
            } else {
                stopPromises.push(this.stopRecord(record, "untrusted"));
            }
        }
        await Promise.all(stopPromises);
    }

    getStatus(boardRoot: string): BoardServiceStatus | undefined {
        const record = this.records.get(normalizeRoot(boardRoot));
        return record ? this.statusOf(record) : undefined;
    }

    getStatuses(): BoardServiceStatus[] {
        return [...this.records.values()].map((record) => this.statusOf(record));
    }

    async start(boardRoot: string, mode: "explicit" | "request"): Promise<StartResult> {
        await this.awaitTrustReady();
        const record = this.requireRecord(boardRoot);
        if (record.state === "running" && record.process) {
            return {
                boardRoot: record.boardRoot,
                pid: record.pid,
                startedAt: record.startedAt ?? Date.now(),
            };
        }
        if (record.startPromise) return record.startPromise;
        if (record.stopPromise) {
            await record.stopPromise;
            if (record.startPromise) return record.startPromise;
        }

        this.assertStartable(record);
        if (mode === "request" && record.terminalFailure) {
            throw new ServiceError("service-failed", record.reason ?? "service-failed");
        }
        if (mode === "explicit") {
            record.restartBudget.reset();
            record.terminalFailure = false;
            this.transition(record, record.state, undefined);
        }

        record.stopRequested = false;
        const promise = this.runStartAttempts(record, false);
        record.startPromise = promise;
        promise.then(
            () => {
                if (record.startPromise === promise) record.startPromise = undefined;
            },
            () => {
                if (record.startPromise === promise) record.startPromise = undefined;
            },
        );
        return promise;
    }

    async stop(boardRoot: string, reason: ServiceStopReason): Promise<void> {
        const record = this.records.get(normalizeRoot(boardRoot));
        if (!record) return;
        await this.stopRecord(record, reason);
    }

    async request(
        boardRoot: string,
        requestId: string,
        message: unknown,
    ): Promise<unknown> {
        await this.awaitTrustReady();
        const record = this.requireRecord(boardRoot);
        if (record.requests.has(requestId) || record.pendingRequestSlots + record.requests.size >= MAX_OUTSTANDING_REQUESTS_PER_SERVICE) {
            throw new ServiceError("service-busy");
        }
        record.pendingRequestSlots += 1;
        try {
            await this.start(boardRoot, "request");
        } finally {
            record.pendingRequestSlots -= 1;
        }

        if (!record.process || record.state !== "running") {
            throw new ServiceError(record.reason === "untrusted" ? "untrusted" : "service-exited");
        }
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                record.requests.delete(requestId);
                reject(new ServiceError("service-timeout"));
            }, SERVICE_REQUEST_DEADLINE_MS);
            record.requests.set(requestId, { resolve, reject, timer });
            try {
                record.process?.postMessage({ kind: "request", requestId, message } satisfies ServiceParentMessage);
            } catch (error) {
                clearTimeout(timer);
                record.requests.delete(requestId);
                reject(new ServiceError("service-exited", errMessage(error)));
            }
        });
    }

    async transferRendererPort(boardRoot: string, target: WebContents): Promise<void> {
        await this.awaitTrustReady();
        await this.start(boardRoot, "request");
        const record = this.requireRecord(boardRoot);
        return transferRendererLease(record, target, this.leaseCallbacks);
    }

    async disposeAll(): Promise<void> {
        if (this.disposing) {
            await Promise.all([...this.records.values()].map((record) => record.stopPromise).filter(Boolean));
            return;
        }
        this.disposing = true;
        await Promise.all([...this.records.values()].map((record) => this.stopRecord(record, "quit")));
    }

    /** Synchronously stops any process left during app quit. */
    forceKillAllSync(): void {
        for (const record of this.records.values()) {
            const process = record.process;
            record.process = undefined;
            // Killing comes first and stands alone: it is the part that must happen.
            try {
                if (process) killUtilityProcessSync(process);
            } catch {
                // Nothing actionable during quit; the OS reaps a child we could not signal.
            }
            try {
                this.rejectRequests(record, "quit");
                record.storageAdapter?.settle("quit");
                for (const lease of [...record.leases.values()]) {
                    failLease(record, lease, "quit", this.leaseCallbacks, process);
                }
                record.pid = undefined;
                record.startedAt = undefined;
                this.transition(record, "stopped", "quit");
            } catch {
                // Bookkeeping and status broadcast are best-effort while windows are tearing down.
            }
        }
    }

    private async awaitTrustReady(): Promise<void> {
        const { boardTrustService } = await import("./board-trust-service");
        await boardTrustService.ready();
    }

    private requireRecord(boardRoot: string): ServiceRecord {
        if (!this.trustedSnapshot) throw new ServiceError("trust-not-ready");
        const key = normalizeRoot(boardRoot);
        const existing = this.records.get(key);
        if (existing) return existing;
        if (!this.isEffectivelyTrusted(boardRoot)) throw new ServiceError("untrusted");
        throw new ServiceError("service-not-declared");
    }

    private assertStartable(record: ServiceRecord): void {
        if (this.disposing) throw new ServiceError("quit");
        if (!this.isEffectivelyTrusted(record.boardRoot)) {
            this.transition(record, "stopped", "untrusted");
            throw new ServiceError("untrusted");
        }
        if (!record.serviceEntry) throw new ServiceError("service-not-declared");
        if (!record.canStartService) {
            this.transition(record, "stopped", "permission-denied");
            throw new ServiceError("permission-denied");
        }
    }

    /**
     * Storage is available while the service PROCESS is alive and its board is trusted — which
     * includes `starting`, before the handshake has completed.
     *
     * Requiring `running` here deadlocks the normal startup shape: a service that loads persisted
     * state before declaring itself ready can never become ready, because the read it is waiting
     * on is refused until it is. Found by live verification against the demo fixture, which did
     * exactly that and was killed by the restart budget after three identical failures.
     *
     * Widening this is safe because storage is gated on trust and board identity, both of which
     * are known at fork time and neither of which the handshake establishes. `stopping`,
     * `stopped` and `failed` remain unavailable, so untrust and quit still settle in-flight work.
     */
    private isStorageAvailable(record: ServiceRecord): boolean {
        return (record.state === "running" || record.state === "starting")
            && record.process !== undefined
            && this.isEffectivelyTrusted(record.boardRoot);
    }

    private storageUnavailableCode(record: ServiceRecord): string {
        if (record.reason === "untrusted") return "untrusted";
        if (record.reason === "quit" || this.disposing) return "quit";
        if (record.state === "failed" || record.terminalFailure) return "service-failed";
        return "service-exited";
    }

    private isEffectivelyTrusted(boardRoot: string): boolean {
        if (!this.trustedSnapshot) return false;
        const key = normalizeRoot(boardRoot);
        return this.trustedSnapshot.trustedPaths.some((trustedPath) =>
            pathCovers(normalizeRoot(trustedPath), key),
        );
    }

    private async runStartAttempts(record: ServiceRecord, firstFailureAlreadyCounted: boolean): Promise<StartResult> {
        let countFailure = !firstFailureAlreadyCounted;
        while (true) {
            if (record.stopRequested || this.disposing) {
                throw new ServiceError(this.abortCode(record));
            }
            this.assertStartable(record);
            this.transition(record, "starting", undefined);
            try {
                return await this.startOneAttempt(record);
            } catch (error) {
                const failure = this.asServiceError(error, "spawn-error");
                if (record.stopRequested) {
                    throw new ServiceError(this.abortCode(record));
                }
                if (failure.code === "untrusted" || !this.isEffectivelyTrusted(record.boardRoot)) {
                    this.transition(record, "stopped", "untrusted");
                    throw new ServiceError("untrusted");
                }
                if (countFailure) this.countFailure(record);
                countFailure = true;
                if (record.restartBudget.count() >= RESTART_BUDGET) {
                    record.restartBudget.freeze();
                    record.terminalFailure = true;
                    this.transition(record, "failed", failure.code);
                    throw failure;
                }
                this.transition(record, "stopped", failure.code);
            }
        }
    }

    private async startOneAttempt(record: ServiceRecord): Promise<StartResult> {
        const absoluteEntry = await this.resolveEntry(record);
        if (record.stopRequested || this.disposing) {
            throw new ServiceError(this.abortCode(record));
        }
        this.assertStartable(record);
        const generation = ++record.generation;
        let process: UtilityProcess;
        try {
            process = utilityProcess.fork(getAssetPath("module-service-host.mjs"), [absoluteEntry], {
                cwd: record.boardRoot,
                env: this.buildServiceEnvironment(record.boardRoot),
                stdio: "pipe",
                serviceName: `Persephone board service: ${record.boardRoot}`,
            });
        } catch (error) {
            throw new ServiceError("spawn-error", errMessage(error));
        }

        record.process = process;
        record.pid = process.pid;
        const appendServiceOutput = (level: "stdout" | "stderr", chunk: unknown): void => {
            const text = Buffer.isBuffer(chunk)
                ? chunk.toString("utf8")
                : chunk instanceof Uint8Array
                    ? Buffer.from(chunk).toString("utf8")
                    : String(chunk);
            for (const line of text.split(/\r?\n/).filter((entry) => entry.length > 0)) {
                void boardLog.append(record.boardRoot, level, line).catch(() => {});
            }
        };
        process.stdout?.on("data", (chunk: unknown) => appendServiceOutput("stdout", chunk));
        process.stderr?.on("data", (chunk: unknown) => appendServiceOutput("stderr", chunk));

        if (record.stopRequested || this.disposing || !this.isEffectivelyTrusted(record.boardRoot)) {
            record.process = undefined;
            record.pid = undefined;
            killUtilityProcessSync(process);
            throw new ServiceError(this.abortCode(record));
        }

        return new Promise<StartResult>((resolve, reject) => {
            const handshake = new Handshake(generation);

            const fail = (error: ServiceError, kill = true): void => {
                if (handshake.settled) return;
                handshake.settle();
                if (record.cancelAttempt) record.cancelAttempt = undefined;
                if (isCurrent(record, process, generation)) {
                    record.process = undefined;
                    record.pid = undefined;
                    record.startedAt = undefined;
                }
                if (kill) killUtilityProcessSync(process);
                reject(error);
            };

            handshake.timer = setTimeout(() => {
                fail(new ServiceError(handshake.ready ? "port-not-listening" : "handshake-timeout"));
            }, SERVICE_HANDSHAKE_TIMEOUT_MS);

            record.cancelAttempt = (error: ServiceError) => fail(error, false);

            process.on("message", (rawMessage: unknown) => {
                routeProcessMessage(record, process, generation, rawMessage, handshake, {
                    isTrusted: (boardRoot) => this.isEffectivelyTrusted(boardRoot),
                    onStorageRequest: (message) => record.storageAdapter?.handle(message),
                    onResponse: (request, message) => {
                        clearTimeout(request.timer);
                        record.requests.delete(message.requestId);
                        if ("error" in message) {
                            if (typeof message.error === "string") {
                                request.reject(new ServiceError("service-error", message.error));
                            } else {
                                request.reject(new ServiceError(
                                    message.error.code,
                                    errMessage(message.error.message, "Service request failed"),
                                ));
                            }
                        } else {
                            request.resolve(message.result);
                        }
                    },
                    onReady: (readyProcess) => {
                        record.cancelAttempt = undefined;
                        record.pid = readyProcess.pid;
                        record.startedAt = Date.now();
                        record.terminalFailure = false;
                        this.transition(record, "running", undefined);
                        resolve({ boardRoot: record.boardRoot, pid: record.pid, startedAt: record.startedAt });
                    },
                    fail,
                });
            });

            process.on("exit", (code: number) => {
                if (!isCurrent(record, process, generation)) return;
                if (!handshake.settled) {
                    fail(new ServiceError("process-exit-before-ready", `process-exit-before-ready:${code}`), false);
                } else if (record.state === "running") {
                    this.handleUnexpectedExit(record, process, generation, code);
                }
            });

            try {
                const providerRequestClasses = Object.fromEntries(
                    (Object.keys(PROVIDER_OPERATION_POLICY) as ProviderOperation[]).map((operation) => [
                        operation,
                        PROVIDER_OPERATION_POLICY[operation].requestClass,
                    ]),
                ) as ServiceHostConfig["providerRequestClasses"];
                const config: ServiceHostConfig = {
                    serviceRequestDeadlineMs: SERVICE_REQUEST_DEADLINE_MS,
                    maxOutstandingRequestsPerService: MAX_OUTSTANDING_REQUESTS_PER_SERVICE,
                    maxBufferedPipeBytes: MAX_BUFFERED_PIPE_BYTES,
                    maxBoardPipeChunkBytes: MAX_BOARD_PIPE_CHUNK_BYTES,
                    providerRequestClasses,
                };
                process.postMessage({ kind: "init", nonce: generation, config } satisfies ServiceParentMessage);
            } catch (error) {
                fail(new ServiceError("spawn-error", errMessage(error)));
            }
        });
    }

    private async resolveEntry(record: ServiceRecord): Promise<string> {
        const entry = record.serviceEntry;
        if (!entry || entry.includes("\0") || path.isAbsolute(entry) || path.win32.isAbsolute(entry) || /^[A-Za-z]:/.test(entry)) {
            throw new ServiceError("invalid-entry");
        }
        const segments = entry.split(/[\\/]+/);
        if (segments.some((segment) => segment === ".." || segment === "." || segment.length === 0)) {
            throw new ServiceError("invalid-entry");
        }
        const absoluteEntry = path.resolve(record.boardRoot, entry);
        const relative = path.relative(record.boardRoot, absoluteEntry);
        if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
            throw new ServiceError("invalid-entry");
        }
        try {
            const stats = await fs.promises.stat(absoluteEntry);
            if (!stats.isFile()) throw new ServiceError("invalid-entry");
        } catch (error) {
            if (error instanceof ServiceError) throw error;
            throw new ServiceError("invalid-entry", errMessage(error));
        }
        return absoluteEntry;
    }

    private buildServiceEnvironment(boardRoot: string): NodeJS.ProcessEnv {
        const allowed = [
            "Path", "PATH", "SystemRoot", "SystemDrive", "WINDIR", "TEMP", "TMP", "USERPROFILE",
            "APPDATA", "LOCALAPPDATA", "PROGRAMDATA", "ProgramData", "ALLUSERSPROFILE", "ProgramFiles",
            "ProgramW6432", "ProgramFiles(x86)", "CommonProgramFiles", "CommonProgramW6432",
            "CommonProgramFiles(x86)", "HOMEDRIVE", "HOMEPATH", "USERNAME", "ComSpec", "PATHEXT", "OS",
            "PROCESSOR_ARCHITECTURE", "NUMBER_OF_PROCESSORS", "LANG", "LC_ALL", "TZ",
        ];
        const environment: NodeJS.ProcessEnv = {};
        for (const key of allowed) {
            const value = process.env[key];
            if (value !== undefined) environment[key] = value;
        }
        environment.PERSEPHONE_SERVICE = "1";
        environment.PERSEPHONE_BOARD_ROOT = boardRoot;
        return environment;
    }

    private handleUnexpectedExit(record: ServiceRecord, process: UtilityProcess, generation: number, code: number): void {
        if (!isCurrent(record, process, generation)) return;
        record.process = undefined;
        record.pid = undefined;
        record.startedAt = undefined;
        this.rejectRequests(record, "service-exited");
        record.storageAdapter?.settle("service-exited");
        for (const lease of [...record.leases.values()]) {
            failLease(record, lease, "service-exited", this.leaseCallbacks);
        }
        const reason = `service-exited:${code}`;
        this.countFailure(record);
        if (record.restartBudget.count() >= RESTART_BUDGET) {
            record.restartBudget.freeze();
            record.terminalFailure = true;
            this.transition(record, "failed", reason);
            return;
        }
        this.transition(record, "stopped", reason);
        const restart = this.runStartAttempts(record, true);
        record.startPromise = restart;
        restart.then(
            () => {
                if (record.startPromise === restart) record.startPromise = undefined;
            },
            () => {
                if (record.startPromise === restart) record.startPromise = undefined;
            },
        );
    }

    private async stopRecord(record: ServiceRecord, reason: ServiceStopReason): Promise<void> {
        if (record.stopPromise) return record.stopPromise;
        record.stopRequested = true;
        const process = record.process;
        const generation = record.generation;
        record.generation += 1;
        record.process = undefined;
        this.transition(record, "stopping", reason);
        const stopCode = STOP_REASON_CODE[reason];
        const leaseReason = STOP_REASON_LEASE_REASON[reason];
        this.rejectRequests(record, stopCode);
        record.storageAdapter?.settle(stopCode);
        for (const lease of [...record.leases.values()]) {
            failLease(record, lease, leaseReason, this.leaseCallbacks, process);
        }
        record.cancelAttempt?.(new ServiceError(stopCode));
        record.cancelAttempt = undefined;

        const stopPromise = (async () => {
            if (process) {
                try {
                    process.postMessage({ kind: "shutdown", nonce: generation, reason } satisfies ServiceParentMessage);
                } catch {
                    // The process may have already exited.
                }
                const exited = new Promise<boolean>((resolve) => {
                    if (process.pid === undefined) {
                        resolve(true);
                        return;
                    }
                    process.once("exit", () => resolve(true));
                });
                await Promise.race([exited, delay(SERVICE_SHUTDOWN_TIMEOUT_MS)]);
                if (process.pid !== undefined) killUtilityProcessSync(process);
            }
            if (record.startPromise) {
                await record.startPromise.catch((): undefined => undefined);
            }
            record.pid = undefined;
            record.startedAt = undefined;
            this.transition(record, "stopped", reason);
        })();
        record.stopPromise = stopPromise;
        try {
            await stopPromise;
        } finally {
            if (record.stopPromise === stopPromise) record.stopPromise = undefined;
        }
    }

    private rejectRequests(record: ServiceRecord, code: string): void {
        for (const [requestId, request] of record.requests) {
            clearTimeout(request.timer);
            request.reject(new ServiceError(code));
            record.requests.delete(requestId);
        }
    }

    private countFailure(record: ServiceRecord): void {
        record.restartBudget.recordFailure();
    }

    private asServiceError(error: unknown, fallback: string): ServiceError {
        if (error instanceof ServiceError) return error;
        return new ServiceError(fallback, errMessage(error, fallback));
    }

    private statusOf(record: ServiceRecord): BoardServiceStatus {
        return {
            boardRoot: record.boardRoot,
            state: record.state,
            ...(record.reason ? { reason: record.reason } : {}),
            ...(record.pid !== undefined ? { pid: record.pid } : {}),
            ...(record.startedAt !== undefined ? { startedAt: record.startedAt } : {}),
            restartCount: record.restartBudget.count(),
        };
    }

    private abortCode(record: ServiceRecord): string {
        if (this.disposing) return STOP_REASON_CODE.quit;
        if (record.stopRequested) {
            const reason = record.reason;
            if (reason === "untrusted" || reason === "explicit" || reason === "quit") {
                return STOP_REASON_CODE[reason];
            }
        }
        return "untrusted";
    }

    private transition(record: ServiceRecord, state: BoardServiceState, reason: string | undefined): void {
        record.state = state;
        record.reason = reason;
        this.emit(record);
    }

    private emit(record: ServiceRecord): void {
        openWindows.send(EventEndpoint.eModuleServiceStatusChanged, this.statusOf(record));
    }
}

export const moduleServiceSupervisor = new ModuleServiceSupervisor();
