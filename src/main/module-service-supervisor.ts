import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
    MessageChannelMain,
    type MessagePortMain,
    type UtilityProcess,
    type WebContents,
    utilityProcess,
} from "electron";
import { EventEndpoint } from "../ipc/api-types";
import {
    MAX_OUTSTANDING_REQUESTS_PER_SERVICE,
    MAX_SERVICE_LOG_BYTES,
    MAX_SERVICE_LOG_CHUNK_BYTES,
    SERVICE_HANDSHAKE_TIMEOUT_MS,
    SERVICE_RENDERER_LEASE_TIMEOUT_MS,
    SERVICE_REQUEST_DEADLINE_MS,
    SERVICE_SHUTDOWN_TIMEOUT_MS,
    type BoardServiceStatus,
    type BoardServiceState,
    type RendererLeaseLostReason,
    type ServiceMainMessage,
    type ServiceParentMessage,
    type ServiceStopReason,
    type StartResult,
    type TrustedBoardSnapshot,
    type TrustedBoardSnapshotEntry,
} from "../ipc/module-service-channels";
import { errMessage } from "../shared/utils";
import { ModuleServiceStorageAdapter } from "./module-service-storage";
import { openWindows } from "./open-windows";
import { getAssetPath } from "./utils";

const FAILURE_WINDOW_MS = 60_000;

class ServiceError extends Error {
    constructor(readonly code: string, message = code) {
        super(message);
        this.name = "ServiceError";
    }
}

interface PendingRequest {
    resolve: (value: unknown) => void;
    reject: (reason: unknown) => void;
    timer: ReturnType<typeof setTimeout>;
}

interface RendererLease {
    state: "attaching" | "attached" | "lost";
    generation: number;
    leaseNonce: string;
    rendererPort: MessagePortMain;
    timer: ReturnType<typeof setTimeout>;
    resolve: () => void;
    reject: (reason: unknown) => void;
}

interface ServiceRecord {
    key: string;
    boardRoot: string;
    serviceEntry?: string;
    canStartService: boolean;
    state: BoardServiceState;
    reason?: string;
    pid?: number;
    startedAt?: number;
    restartCount: number;
    failureTimestamps: number[];
    terminalFailure: boolean;
    generation: number;
    process?: UtilityProcess;
    startPromise?: Promise<StartResult>;
    stopPromise?: Promise<void>;
    cancelAttempt?: (error: ServiceError) => void;
    requests: Map<string, PendingRequest>;
    pendingRequestSlots: number;
    lease?: RendererLease;
    storageAdapter?: ModuleServiceStorageAdapter;
    leaseCounter: number;
    stopRequested: boolean;
}

function normalizeRoot(boardRoot: string): string {
    const normalized = path.resolve(boardRoot).replace(/\\/g, "/").replace(/\/+$/, "");
    return globalThis.process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function pathCovers(ancestor: string, descendant: string): boolean {
    return descendant === ancestor || descendant.startsWith(`${ancestor}/`);
}

function isCurrent(record: ServiceRecord, process: UtilityProcess, generation: number): boolean {
    return record.process === process && record.generation === generation;
}

function delay(milliseconds: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function killUtilityProcessSync(child: UtilityProcess | undefined): void {
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

class BoundedServiceLog {
    private readonly pendingChunks: Buffer[] = [];
    private pendingBytes = 0;
    private writing = false;

    constructor(private readonly boardRoot: string) {}

    append(stream: "stdout" | "stderr", chunk: unknown): void {
        const text = Buffer.isBuffer(chunk)
            ? chunk.toString("utf8")
            : chunk instanceof Uint8Array
                ? Buffer.from(chunk).toString("utf8")
                : String(chunk);
        const bounded = Buffer.from(text).subarray(0, MAX_SERVICE_LOG_CHUNK_BYTES).toString("utf8");
        const lines = bounded.split(/\r?\n/).filter((line) => line.length > 0);
        if (lines.length === 0) return;
        const prefix = `[service:${this.boardRoot} ${stream}] `;
        const content = lines
            .map((line) => `${prefix}${line.slice(0, MAX_SERVICE_LOG_CHUNK_BYTES)}\n`)
            .join("");
        const chunkBuffer = Buffer.from(content).subarray(-MAX_SERVICE_LOG_BYTES);
        while (this.pendingChunks.length > 0 && this.pendingBytes + chunkBuffer.length > MAX_SERVICE_LOG_BYTES) {
            const dropped = this.pendingChunks.shift();
            this.pendingBytes -= dropped?.length ?? 0;
        }
        this.pendingChunks.push(chunkBuffer);
        this.pendingBytes += chunkBuffer.length;
        void this.flush();
    }

    private async flush(): Promise<void> {
        if (this.writing) return;
        this.writing = true;
        try {
            while (this.pendingChunks.length > 0) {
                const chunk = this.pendingChunks.shift() ?? Buffer.alloc(0);
                this.pendingBytes -= chunk.length;
                const filePath = path.join(this.boardRoot, "ui.log");
                await fs.promises.mkdir(this.boardRoot, { recursive: true });
                let previous: Buffer;
                try {
                    previous = await fs.promises.readFile(filePath);
                } catch {
                    previous = Buffer.alloc(0);
                }
                const next = Buffer.concat([previous, chunk]).subarray(-MAX_SERVICE_LOG_BYTES);
                await fs.promises.writeFile(filePath, next);
            }
        } catch (error: unknown) {
            console.warn(`Failed to write board service log: ${errMessage(error)}`);
        } finally {
            this.writing = false;
            if (this.pendingChunks.length > 0) void this.flush();
        }
    }
}

class ModuleServiceSupervisor {
    private readonly records = new Map<string, ServiceRecord>();
    private trustedSnapshot: TrustedBoardSnapshot | undefined;
    private trustedSnapshotGeneration = -1;
    private disposing = false;

    syncTrustedBoardSnapshot(snapshot: TrustedBoardSnapshot): void {
        if (this.disposing || snapshot.generation < this.trustedSnapshotGeneration) return;
        const previouslyUntrusted = new Set(
            [...this.records.values()]
                .filter((record) => !this.isEffectivelyTrusted(record.boardRoot))
                .map((record) => record.key),
        );
        this.trustedSnapshotGeneration = snapshot.generation;
        this.trustedSnapshot = snapshot;

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
                    existing.reason = "permission-denied";
                    this.emit(existing);
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
                restartCount: 0,
                failureTimestamps: [],
                terminalFailure: false,
                generation: 0,
                requests: new Map(),
                pendingRequestSlots: 0,
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
            this.emit(record);
        }

        for (const record of this.records.values()) {
            if (this.isEffectivelyTrusted(record.boardRoot)) {
                if (previouslyUntrusted.has(record.key) && record.reason === "untrusted") {
                    // Re-trust permits a future request/explicit start but never
                    // starts the retained service or clears its failure budget.
                    record.stopRequested = false;
                }
            } else {
                void this.stopRecord(record, "untrusted");
            }
        }
    }

    getStatus(boardRoot: string): BoardServiceStatus | undefined {
        const record = this.records.get(normalizeRoot(boardRoot));
        return record ? this.statusOf(record) : undefined;
    }

    getStatuses(): BoardServiceStatus[] {
        return [...this.records.values()].map((record) => this.statusOf(record));
    }

    async start(boardRoot: string, mode: "explicit" | "request"): Promise<StartResult> {
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
            record.failureTimestamps = [];
            record.restartCount = 0;
            record.terminalFailure = false;
            record.reason = undefined;
            this.emit(record);
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
        deadlineMs: number,
    ): Promise<unknown> {
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
        const timeout = Number.isFinite(deadlineMs) && deadlineMs > 0 ? deadlineMs : SERVICE_REQUEST_DEADLINE_MS;
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                record.requests.delete(requestId);
                reject(new ServiceError("service-timeout"));
            }, timeout);
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
        await this.start(boardRoot, "request");
        const record = this.requireRecord(boardRoot);
        const process = record.process;
        if (!process || record.state !== "running") throw new ServiceError("service-exited");

        const oldLease = record.lease;
        if (oldLease) {
            this.failLease(record, oldLease, "superseded");
            try {
                process.postMessage({
                    kind: "drop-renderer",
                    generation: oldLease.generation,
                    leaseNonce: oldLease.leaseNonce,
                } satisfies ServiceParentMessage);
            } catch {
                // The replacement lease can still be attempted; process failure is handled separately.
            }
        }

        const { port1, port2 } = new MessageChannelMain();
        const generation = record.generation;
        const leaseNonce = `${generation}:${++record.leaseCounter}`;
        const leasePromise = new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => {
                const current = record.lease;
                if (current?.leaseNonce !== leaseNonce) return;
                this.failLease(record, current, "renderer-port-attach-failed");
            }, SERVICE_RENDERER_LEASE_TIMEOUT_MS);
            record.lease = {
                state: "attaching",
                generation,
                leaseNonce,
                rendererPort: port1,
                timer,
                resolve,
                reject,
            };
        });

        try {
            process.postMessage(
                { kind: "attach-renderer", generation, leaseNonce, rendererPort: port2 } satisfies ServiceParentMessage,
                [port2],
            );
            if (target.isDestroyed()) throw new ServiceError("renderer-port-attach-failed");
            target.postMessage(
                EventEndpoint.eModuleServicePort,
                { boardRoot: record.boardRoot, generation, leaseNonce },
                [port1],
            );
        } catch (error) {
            const current = record.lease;
            if (current?.leaseNonce === leaseNonce) this.failLease(record, current, "renderer-port-attach-failed");
            throw new ServiceError("renderer-port-attach-failed", errMessage(error));
        }

        return leasePromise;
    }

    async disposeAll(): Promise<void> {
        if (this.disposing) {
            await Promise.all([...this.records.values()].map((record) => record.stopPromise).filter(Boolean));
            return;
        }
        this.disposing = true;
        await Promise.all([...this.records.values()].map((record) => this.stopRecord(record, "quit")));
    }

    /** Synchronous final backstop used by the whole-gate quit `finally` block. */
    /**
     * Last-resort teardown on app quit. Every step is individually guarded: this runs inside the
     * quit gate's `finally`, and a throw escaping it would skip `app.quit()` and leave the app
     * unquittable — strictly worse than the orphaned child it exists to prevent. One bad record
     * must also never abort the kill loop, or the remaining services survive the app (EPIC-106).
     */
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
                if (record.lease) this.failLease(record, record.lease, "quit");
                record.state = "stopped";
                record.reason = "quit";
                record.pid = undefined;
                this.emit(record);
            } catch {
                // Bookkeeping and status broadcast are best-effort while windows are tearing down.
            }
        }
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
            record.state = "stopped";
            record.reason = "untrusted";
            this.emit(record);
            throw new ServiceError("untrusted");
        }
        if (!record.serviceEntry) throw new ServiceError("service-not-declared");
        if (!record.canStartService) {
            record.state = "stopped";
            record.reason = "permission-denied";
            this.emit(record);
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
        return this.trustedSnapshot.boards.some((entry) =>
            typeof entry.boardRoot === "string" && pathCovers(normalizeRoot(entry.boardRoot), key),
        );
    }

    private async runStartAttempts(record: ServiceRecord, firstFailureAlreadyCounted: boolean): Promise<StartResult> {
        let countFailure = !firstFailureAlreadyCounted;
        while (true) {
            if (record.stopRequested || this.disposing) {
                throw new ServiceError(record.reason === "untrusted" ? "untrusted" : "quit");
            }
            this.assertStartable(record);
            record.state = "starting";
            record.reason = undefined;
            this.emit(record);
            try {
                return await this.startOneAttempt(record);
            } catch (error) {
                const failure = this.asServiceError(error, "spawn-error");
                if (record.stopRequested) {
                    const stopReason = record.reason === "untrusted" ? "untrusted" : "quit";
                    record.state = "stopped";
                    record.reason = stopReason;
                    this.emit(record);
                    throw new ServiceError(stopReason);
                }
                if (failure.code === "untrusted" || !this.isEffectivelyTrusted(record.boardRoot)) {
                    record.state = "stopped";
                    record.reason = "untrusted";
                    this.emit(record);
                    throw new ServiceError("untrusted");
                }
                if (countFailure) this.countFailure(record, failure.code);
                countFailure = true;
                if (record.restartCount >= 3) {
                    record.state = "failed";
                    record.terminalFailure = true;
                    record.reason = failure.code;
                    this.emit(record);
                    throw failure;
                }
                record.state = "stopped";
                record.reason = failure.code;
                this.emit(record);
            }
        }
    }

    private async startOneAttempt(record: ServiceRecord): Promise<StartResult> {
        const absoluteEntry = await this.resolveEntry(record);
        if (record.stopRequested || this.disposing) {
            throw new ServiceError(record.reason === "untrusted" ? "untrusted" : "quit");
        }
        this.assertStartable(record);
        const generation = ++record.generation;
        let process: UtilityProcess;
        try {
            process = utilityProcess.fork(getAssetPath("module-service-host.mjs"), [
                absoluteEntry,
                String(SERVICE_REQUEST_DEADLINE_MS),
                String(MAX_OUTSTANDING_REQUESTS_PER_SERVICE),
            ], {
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
        const log = new BoundedServiceLog(record.boardRoot);
        process.stdout?.on("data", (chunk: unknown) => log.append("stdout", chunk));
        process.stderr?.on("data", (chunk: unknown) => log.append("stderr", chunk));

        if (record.stopRequested || this.disposing || !this.isEffectivelyTrusted(record.boardRoot)) {
            record.process = undefined;
            record.pid = undefined;
            killUtilityProcessSync(process);
            throw new ServiceError(record.reason === "untrusted" ? "untrusted" : "quit");
        }

        return new Promise<StartResult>((resolve, reject) => {
            let settled = false;
            let ready = false;
            let probeSent = false;
            const timer = setTimeout(() => {
                fail(new ServiceError(ready ? "port-not-listening" : "handshake-timeout"));
            }, SERVICE_HANDSHAKE_TIMEOUT_MS);

            const fail = (error: ServiceError, kill = true): void => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                if (record.cancelAttempt) record.cancelAttempt = undefined;
                if (isCurrent(record, process, generation)) {
                    record.process = undefined;
                    record.pid = undefined;
                    record.startedAt = undefined;
                }
                if (kill) killUtilityProcessSync(process);
                reject(error);
            };

            record.cancelAttempt = (error: ServiceError) => fail(error, false);

            process.on("message", (rawMessage: unknown) => {
                if (!isCurrent(record, process, generation)) return;
                const message = rawMessage as ServiceMainMessage;
                if (message.kind === "storage-request") {
                    record.storageAdapter?.handle(message);
                    return;
                }
                if (message.kind === "renderer-attached") {
                    const lease = record.lease;
                    if (lease
                        && lease.state === "attaching"
                        && lease.generation === message.generation
                        && lease.leaseNonce === message.leaseNonce) {
                        clearTimeout(lease.timer);
                        lease.state = "attached";
                        lease.resolve();
                    }
                    return;
                }
                // Request responses are steady-state traffic and must be handled for the whole
                // life of the process. `settled` marks only that the START ATTEMPT finished, so
                // it must not gate this branch: with the guard above it, every reply after a
                // successful handshake was dropped and every request died at its deadline, which
                // made `requestService` impossible to use at all. Found by live verification.
                if (message.kind === "response") {
                    const request = record.requests.get(message.requestId);
                    if (!request) return;
                    clearTimeout(request.timer);
                    record.requests.delete(message.requestId);
                    if ("error" in message) {
                        request.reject(new ServiceError("service-error", errMessage(message.error, "Service request failed")));
                    } else {
                        request.resolve(message.result);
                    }
                    return;
                }
                // Handshake frames below are attempt-scoped and stay gated.
                if (settled) return;
                if (message.kind === "ready" && message.nonce === generation) {
                    if (probeSent) return;
                    ready = true;
                    probeSent = true;
                    try {
                        process.postMessage({ kind: "probe", nonce: generation } satisfies ServiceParentMessage);
                    } catch (error) {
                        fail(new ServiceError("port-not-listening", errMessage(error)));
                    }
                    return;
                }
                if (message.kind === "probe-ack" && message.nonce === generation && ready) {
                    if (!this.isEffectivelyTrusted(record.boardRoot)) {
                        fail(new ServiceError("untrusted"));
                        return;
                    }
                    settled = true;
                    clearTimeout(timer);
                    record.cancelAttempt = undefined;
                    record.state = "running";
                    record.reason = undefined;
                    record.pid = process.pid;
                    record.startedAt = Date.now();
                    record.terminalFailure = false;
                    this.emit(record);
                    resolve({ boardRoot: record.boardRoot, pid: record.pid, startedAt: record.startedAt });
                }
            });

            process.on("exit", (code: number) => {
                if (!isCurrent(record, process, generation)) return;
                if (!settled) {
                    fail(new ServiceError("process-exit-before-ready", `process-exit-before-ready:${code}`), false);
                } else if (record.state === "running") {
                    this.handleUnexpectedExit(record, process, generation, code);
                }
            });

            try {
                process.postMessage({ kind: "init", nonce: generation } satisfies ServiceParentMessage);
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
        if (record.lease) this.failLease(record, record.lease, "service-exited");
        const reason = `service-exited:${code}`;
        this.countFailure(record, reason);
        record.state = "stopped";
        record.reason = reason;
        this.emit(record);
        if (record.stopRequested || this.disposing || !this.isEffectivelyTrusted(record.boardRoot)) {
            record.state = "stopped";
            record.reason = record.stopRequested ? (record.reason === "untrusted" ? "untrusted" : "quit") : "untrusted";
            this.emit(record);
            return;
        }
        if (record.restartCount >= 3) {
            record.state = "failed";
            record.terminalFailure = true;
            this.emit(record);
            return;
        }
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
        record.state = "stopping";
        record.reason = reason;
        const stopCode = reason === "untrusted"
            ? "untrusted"
            : reason === "quit"
                ? "quit"
                : "service-exited";
        const leaseReason: RendererLeaseLostReason = reason === "untrusted"
            ? "untrusted"
            : reason === "quit"
                ? "quit"
                : "stopping";
        this.rejectRequests(record, stopCode);
        record.storageAdapter?.settle(stopCode);
        if (record.lease) this.failLease(record, record.lease, leaseReason);
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
            record.state = "stopped";
            record.reason = reason;
            record.pid = undefined;
            record.startedAt = undefined;
            this.emit(record);
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

    private failLease(record: ServiceRecord, lease: RendererLease, reason: RendererLeaseLostReason): void {
        if (record.lease !== lease) return;
        clearTimeout(lease.timer);
        lease.state = "lost";
        record.lease = undefined;
        try {
            lease.rendererPort.postMessage({ kind: "lease-lost", reason });
        } catch {
            // The renderer may already have gone away.
        }
        try {
            lease.rendererPort.close();
        } catch {
            // Already closed by Chromium.
        }
        const code = reason === "superseded"
            ? "renderer-reloaded"
            : reason === "untrusted"
                ? "untrusted"
                : reason === "quit"
                    ? "quit"
                    : reason === "renderer-port-attach-failed"
                        ? reason
                        : "service-exited";
        lease.reject(new ServiceError(code));
    }

    private countFailure(record: ServiceRecord, reason: string): void {
        const now = Date.now();
        record.failureTimestamps = record.failureTimestamps.filter((timestamp) => now - timestamp < FAILURE_WINDOW_MS);
        record.failureTimestamps.push(now);
        record.restartCount = Math.min(3, record.failureTimestamps.length);
        record.reason = reason;
        this.emit(record);
    }

    private asServiceError(error: unknown, fallback: string): ServiceError {
        if (error instanceof ServiceError) return error;
        return new ServiceError(fallback, errMessage(error, fallback));
    }

    private statusOf(record: ServiceRecord): BoardServiceStatus {
        if (!record.terminalFailure) {
            const now = Date.now();
            record.failureTimestamps = record.failureTimestamps.filter((timestamp) => now - timestamp < FAILURE_WINDOW_MS);
            record.restartCount = record.failureTimestamps.length;
        }
        return {
            boardRoot: record.boardRoot,
            state: record.state,
            ...(record.reason ? { reason: record.reason } : {}),
            ...(record.pid !== undefined ? { pid: record.pid } : {}),
            ...(record.startedAt !== undefined ? { startedAt: record.startedAt } : {}),
            restartCount: record.restartCount,
        };
    }

    private emit(record: ServiceRecord): void {
        openWindows.send(EventEndpoint.eModuleServiceStatusChanged, this.statusOf(record));
    }
}

export const moduleServiceSupervisor = new ModuleServiceSupervisor();

export type ModuleServiceSupervisorApi = Pick<
    ModuleServiceSupervisor,
    "syncTrustedBoardSnapshot" | "getStatus" | "getStatuses" | "start" | "stop" | "request" | "transferRendererPort" | "disposeAll"
>;
