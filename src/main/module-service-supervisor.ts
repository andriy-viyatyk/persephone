import path from "node:path";
import type { WebContents } from "electron";
import { boardTrustService } from "./board-trust-service";
import { BoardRoot } from "../shared/board/board-root";
import { BoardGrant } from "../shared/board/board-grant";
import { boardLocalCallerId, boardRootDigest } from "./board-root-hashes";
import {
    MAX_OUTSTANDING_REQUESTS_PER_SERVICE,
    type BoardServiceState,
    SERVICE_REQUEST_DEADLINE_MS,
    type BoardServiceStatus,
    type ServiceParentMessage,
    type ServiceMainMessage,
    type ServiceStopReason,
    STOP_REASON_CODE,
    STOP_REASON_LEASE_REASON,
    type StartResult,
    type BoardServiceTrustSnapshot,
    type TrustedBoardSnapshotEntry,
} from "../ipc/module-service-channels";
import { errMessage } from "../shared/utils";
import { ModuleServiceStorageAdapter } from "./module-service/storage";
import { openWindows } from "./open-windows";
import { ServiceError, type ServiceRecord } from "./module-service/record";
import { RestartBudget, RESTART_BUDGET } from "./module-service/restart-budget";
import { acknowledgeRendererLease, failLease, transferRendererLease, type LeaseCallbacks } from "./module-service/leases";
import { issuePrivateMcpEndpoint, revokePrivateMcpEndpointForBoard, revokePrivateMcpEndpointsForBoard } from "./mcp/private-session-endpoints";
import type { CapabilityCallerIdentity } from "../shared/capability-contract";
import { PendingRequests } from "../shared/pending-requests";
import { ServiceBoardSettingsAdapter } from "./module-service/board-settings-adapter";
import { ServiceMcpEndpointAdapter } from "./module-service/mcp-endpoint-adapter";
import { ServiceCapabilityClientAdapter } from "./module-service/capability-client-adapter";
import { HOST_SERVICE_CHANNEL_POLICIES } from "../ipc/module-service-channels";
import { ServiceTrustDirectory } from "./module-service/trust-directory";
import { ServiceChannelBroker } from "./module-service/channel-broker";
import type { ChannelDelivery } from "./channel-delivery";
import { ModuleServiceProcess } from "./module-service/process";

class ModuleServiceSupervisor {
    private readonly records = new Map<string, ServiceRecord>();
    private readonly trustDirectory = new ServiceTrustDirectory();
    private readonly channelBroker = new ServiceChannelBroker();
    private readonly leaseCallbacks: LeaseCallbacks = {
        getProcess: (record) => record.current,
        postMessage: (process, message, ports) => process.postMessage(message, ports),
    };
    private disposing = false;
    readonly boardSettings = new ServiceBoardSettingsAdapter({
        isAllowed: (record) => this.isBoardSettingsAllowed(record),
        selectRenderer: (excluded) => this.selectBoardSettingsRenderer(excluded),
    });
    private readonly mcpEndpoints = new ServiceMcpEndpointAdapter({
        isRunningAndTrusted: (record) => record.state === "running" && !record.stopRequested && this.isEffectivelyTrusted(record.boardRoot),
        appScriptingAllowed: (record) => this.isAppScriptingAllowed(record),
        issue: issuePrivateMcpEndpoint,
        revoke: revokePrivateMcpEndpointForBoard,
    });
    private readonly serviceCapabilities = new ServiceCapabilityClientAdapter({
        start: (record, mode) => this.start(record.boardRoot, mode),
        getCurrentProcess: (record) => record.current,
        callerFor: (record) => ({ kind: "board-service", provider: boardRootDigest(BoardRoot.from(record.boardRoot)) }),
    });

    async applyBoardServiceTrustSnapshot(snapshot: BoardServiceTrustSnapshot): Promise<void> {
        if (this.disposing) return;
        const previouslyUntrusted = new Set(
            [...this.records.values()]
                .filter((record) => !this.isEffectivelyTrusted(record.boardRoot))
                .map((record) => record.key),
        );
        const trustChanges = this.trustDirectory.apply(snapshot);
        const stopPromises: Promise<void>[] = [];

        const serviceEntries = new Map<string, TrustedBoardSnapshotEntry>();
        for (const entry of snapshot.boards) {
            if (typeof entry.boardRoot !== "string") continue;
            if (typeof entry.service !== "string" || !entry.service) continue;
            serviceEntries.set(BoardRoot.from(entry.boardRoot).key, entry);
        }

        for (const [key, entry] of serviceEntries) {
            const existing = this.records.get(key);
            if (existing) {
                const previous = trustChanges.previousEntries.get(key);
                if (previous && BoardGrant.from(previous.permissions).allows("appScripting")
                    && !BoardGrant.from(entry.permissions).allows("appScripting")) {
                    await revokePrivateMcpEndpointsForBoard(existing.boardRoot);
                }
                const serviceEntryChanged = existing.serviceEntry !== entry.service;
                existing.boardRoot = entry.boardRoot;
                existing.serviceEntry = entry.service;
                existing.canStartService = entry.canStartService;
                if (previous?.canStartService && !entry.canStartService) {
                    this.closeChannelsForProvider(existing, { code: "permission-denied", message: "The provider no longer grants service access." });
                    stopPromises.push(this.stopRecord(existing, "explicit"));
                } else if (serviceEntryChanged && (existing.current || existing.startPromise)) {
                    stopPromises.push(this.stopRecord(existing, "explicit"));
                }
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
                lastGeneration: 0,
                requests: new PendingRequests<unknown, undefined, string>({ timeoutError: () => new ServiceError("service-timeout") }),
                pendingRequestSlots: 0,
                leases: new Map(),
                channels: new Map(),
                leaseCounter: 0,
                stopRequested: false,
            };
            this.records.set(key, record);
            record.storageAdapter = new ModuleServiceStorageAdapter({
                getBoardRoot: () => record.boardRoot,
                getUnavailableCode: () => this.storageUnavailableCode(record),
                getOutstandingRequestCount: () => record.pendingRequestSlots + record.requests.size,
                isAvailable: () => this.isStorageAvailable(record),
                postMessage: (message) => record.current?.postMessage(message),
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
        for (const record of this.records.values()) {
            const provider = this.trustDirectory.entryFor(record.boardRoot);
            for (const [channelId, owner] of record.channels) {
                if (owner.interfaceId && owner.version !== undefined
                    && !(provider?.serviceInterfaces ?? []).some((item) => item.id === owner.interfaceId && item.version === owner.version)) {
                    this.closeChannel(record, channelId, { code: "service-not-declared", message: "The provider no longer declares this service interface." });
                    continue;
                }
                if (!owner.consumerRoot) continue;
                const consumer = this.trustDirectory.entryFor(owner.consumerRoot);
                const previous = trustChanges.previousEntries.get(BoardRoot.from(owner.consumerRoot).key);
                const granted = consumer?.uses.some((use) => use.id === owner.interfaceId && use.version === owner.version) === true;
                const wasGranted = previous?.uses.some((use) => use.id === owner.interfaceId && use.version === owner.version) === true;
                const lostTrust = !consumer && !this.isEffectivelyTrusted(owner.consumerRoot);
                if (lostTrust || (wasGranted && !granted)) {
                    this.closeChannel(record, channelId, lostTrust
                        ? { code: "untrusted", message: "The consumer board was untrusted." }
                        : { code: "permission-denied", message: "The consumer no longer grants this service interface." });
                }
            }
        }
        await Promise.all(stopPromises);
    }

    getStatus(boardRoot: string): BoardServiceStatus | undefined {
        const record = this.records.get(BoardRoot.from(boardRoot).key);
        return record ? this.statusOf(record) : undefined;
    }

    trackServiceOwner(boardRoot: string, onClosed: () => void): () => void {
        return this.channelBroker.trackServiceOwner(BoardRoot.from(boardRoot).key, onClosed);
    }

    getStatuses(): BoardServiceStatus[] {
        return [...this.records.values()].map((record) => this.statusOf(record));
    }

    async start(boardRoot: string, mode: "explicit" | "request"): Promise<StartResult> {
        await this.awaitTrustReady();
        const record = this.requireRecord(boardRoot);
        if (record.state === "running" && record.current) {
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
        const record = this.records.get(BoardRoot.from(boardRoot).key);
        if (!record) return;
        await revokePrivateMcpEndpointsForBoard(record.boardRoot);
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

        if (record.requests.has(requestId)) throw new ServiceError("service-busy");

        if (!record.current || record.state !== "running") {
            throw new ServiceError(record.reason === "untrusted" ? "untrusted" : "service-exited");
        }
        const { promise } = record.requests.create(SERVICE_REQUEST_DEADLINE_MS, undefined, { id: requestId });
        try { record.current.postMessage({ kind: "request", requestId, message } satisfies ServiceParentMessage); }
        catch (error) { record.requests.fail(requestId, new ServiceError("service-exited", errMessage(error))); }
        return promise;
    }

    async callCapability(boardRoot: string, message: Extract<ServiceParentMessage, { kind: "capability-call" }>, signal: AbortSignal, reauthorize: () => void): Promise<unknown> {
        await this.awaitTrustReady();
        const record = this.requireRecord(boardRoot);
        return this.serviceCapabilities.call(record, message, signal, reauthorize);
    }

    private isBoardSettingsAllowed(record: ServiceRecord): boolean {
        const grant = this.trustDirectory.entryFor(record.boardRoot);
        return !!grant && grant.canStartService && BoardGrant.from(grant.permissions).allows("service")
            && this.isEffectivelyTrusted(record.boardRoot);
    }

    private isAppScriptingAllowed(record: ServiceRecord): boolean {
        const grant = this.trustDirectory.entryFor(record.boardRoot);
        return !!grant && BoardGrant.from(grant.permissions).allows("appScripting");
    }

    private async selectBoardSettingsRenderer(excluded?: WebContents): Promise<WebContents | undefined> {
        const data = openWindows.windows.find((entry) => entry.window && !entry.window.window.isDestroyed()
            && !entry.window.window.webContents.isDestroyed() && entry.window.window.webContents !== excluded);
        if (!data?.window) return undefined;
        if (data.whenReady) await data.whenReady;
        if (data.window.window.isDestroyed() || data.window.window.webContents.isDestroyed()) return undefined;
        if (data.window.window.webContents.isLoadingMainFrame()) {
            await new Promise<void>((resolve) => {
                data.window?.window.webContents.once("did-finish-load", (): void => resolve());
                data.window?.window.webContents.once("destroyed", (): void => resolve());
            });
            if (data.window.window.isDestroyed() || data.window.window.webContents.isDestroyed()) return undefined;
        }
        return data.window.window.webContents;
    }

    async openCapabilityChannel(boardRoot: string, consumer: string, consumerServiceRoot: string | undefined, openMessage: unknown,
        info: { interface: { id: string; version: number }; caller: CapabilityCallerIdentity }, signal: AbortSignal,
        reauthorize: () => void, delivery?: ChannelDelivery) {
        await this.awaitTrustReady();
        if (signal.aborted) throw signal.reason;
        reauthorize();
        const record = this.requireRecord(boardRoot);
        if (consumerServiceRoot) consumer = `service:${BoardRoot.from(consumerServiceRoot).key}`;
        return this.channelBroker.openCapabilityChannel(record, consumer, openMessage, info, signal, reauthorize,
            async () => { await this.start(boardRoot, "request"); }, delivery);
    }

    async transferRendererPort(boardRoot: string, target: WebContents): Promise<void> {
        await this.awaitTrustReady();
        await this.start(boardRoot, "request");
        const record = this.requireRecord(boardRoot);
        return transferRendererLease(record, target, this.leaseCallbacks);
    }

    async openChannel(boardRoot: string, target: WebContents, boardId: string, openMessage: unknown): Promise<string> {
        await this.awaitTrustReady();
        await this.start(boardRoot, "request");
        const record = this.requireRecord(boardRoot);
        return this.channelBroker.openBoardChannel(record, target, boardId, openMessage);
    }

    listServiceProviders(interfaceId: string): Array<{ provider: string; title: string; version: number; boardName: string }> {
        return this.trustDirectory.listProviders(interfaceId);
    }

    async connectServiceChannel(consumerRoot: string, target: WebContents, boardId: string, interfaceId: string, selector: { provider: string; version: number }, openMessage?: unknown): Promise<string> {
        await this.awaitTrustReady();
        if (!selector || typeof selector.provider !== "string" || !Number.isSafeInteger(selector.version) || selector.version <= 0) throw new ServiceError("invalid-argument");
        const consumer = this.trustDirectory.entryFor(consumerRoot);
        if (!consumer || !(consumer.uses ?? []).some((use) => use.id === interfaceId && use.version === selector.version)) throw new ServiceError("permission-denied");
        const providerEntry = this.trustDirectory.requireProvider(selector, interfaceId, selector.version);
        const providerRoot = BoardRoot.from(providerEntry.boardRoot).key;
        const record = this.requireRecord(providerRoot);
        await this.start(providerEntry.boardRoot, "request");
        const latestConsumer = this.trustDirectory.entryFor(consumerRoot);
        if (!latestConsumer || !(latestConsumer.uses ?? []).some((use) => use.id === interfaceId && use.version === selector.version)) throw new ServiceError("permission-denied");
        if (!this.trustDirectory.entryForProvider(selector)) throw new ServiceError("untrusted");
        const latestProvider = this.trustDirectory.requireProvider(selector, interfaceId, selector.version);
        if (latestProvider.boardRoot !== providerEntry.boardRoot && BoardRoot.from(latestProvider.boardRoot).key !== providerRoot) throw new ServiceError("untrusted");
        if (!record.current || record.state !== "running") throw new ServiceError("service-exited");
        return this.channelBroker.openServiceChannel(record, target, boardId, BoardRoot.from(consumerRoot).key, interfaceId,
            selector.version, openMessage, { id: latestConsumer.callerId ?? boardLocalCallerId(BoardRoot.from(consumerRoot)), name: latestConsumer.boardName ?? path.basename(consumerRoot) });
    }

    async connectHostServiceChannel(target: WebContents, selector: { interfaceId: string; provider: string; version: number }, openMessage: unknown): Promise<string> {
        if (!selector || typeof selector.interfaceId !== "string" || typeof selector.provider !== "string" || typeof selector.version !== "number") throw new ServiceError("invalid-argument");
        const policy = HOST_SERVICE_CHANNEL_POLICIES[`${selector.interfaceId}@${selector.version}` as keyof typeof HOST_SERVICE_CHANNEL_POLICIES];
        if (!policy) throw new ServiceError("invalid-argument");
        const { interfaceId, version, openTypes, ownerLabel } = policy;
        const openType = openMessage && typeof openMessage === "object" ? (openMessage as { type?: unknown }).type : undefined;
        if (typeof openType !== "string" || !(openTypes as readonly string[]).includes(openType)) throw new ServiceError("invalid-argument");
        await this.awaitTrustReady();
        const provider = this.trustDirectory.requireProvider(selector, interfaceId, version);
        const providerRoot = BoardRoot.from(provider.boardRoot).key;
        const record = this.requireRecord(providerRoot);
        await this.start(provider.boardRoot, "request");
        if (!this.trustDirectory.entryForProvider(selector)) throw new ServiceError("untrusted");
        this.trustDirectory.requireProvider(selector, interfaceId, version);
        if (!record.current || record.state !== "running") throw new ServiceError("service-exited");
        if (target.isDestroyed()) throw new ServiceError("service-exited");
        return this.channelBroker.openHostServiceChannel(record, target, ownerLabel, interfaceId, version, openMessage);
    }

    private closeChannel(record: ServiceRecord, channelId: string, reason: { code: string; message: string }): void {
        this.channelBroker.closeChannel(record, channelId, reason);
    }

    private closeChannelsForProvider(record: ServiceRecord, reason: { code: string; message: string }): void {
        this.channelBroker.closeChannelsForProvider(record, reason);
    }

    closeBoardChannels(boardId: string, reason: { code: string; message: string }): void {
        this.channelBroker.closeBoardChannels(this.records.values(), boardId, reason);
    }

    updateLocale(locale: string): void {
        const message = { kind: "locale-changed", locale } satisfies ServiceParentMessage;
        // Include services still starting: their spawn environment may already hold the old locale.
        for (const record of this.records.values()) {
            const process = record.current;
            if (!process) continue;
            try {
                process.postMessage(message);
            } catch {
                // The service may be exiting; its next spawn reads the current locale.
            }
        }
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
            void revokePrivateMcpEndpointsForBoard(record.boardRoot);
            const process = record.current;
            this.closeRecordChannels(record, { code: "quit", message: "Persephone is closing." });
            record.current = undefined;
            // Killing comes first and stands alone: it is the part that must happen.
            try {
                process?.killSync();
            } catch {
                // Nothing actionable during quit; the OS reaps a child we could not signal.
            }
            try {
                this.rejectRequests(record, "quit");
                this.boardSettings.settle(record, "quit");
                this.boardSettings.removeForRecord(record);
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
        await boardTrustService.ready();
    }

    private requireRecord(boardRoot: string): ServiceRecord {
        if (!this.trustDirectory.isReady()) throw new ServiceError("trust-not-ready");
        const key = BoardRoot.from(boardRoot).key;
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
            && record.current !== undefined
            && this.isEffectivelyTrusted(record.boardRoot);
    }

    private storageUnavailableCode(record: ServiceRecord): string {
        if (record.reason === "untrusted") return "untrusted";
        if (record.reason === "quit" || this.disposing) return "quit";
        if (record.state === "failed" || record.terminalFailure) return "service-failed";
        return "service-exited";
    }

    private isEffectivelyTrusted(boardRoot: string): boolean {
        return this.trustDirectory.isTrusted(boardRoot);
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
        const absoluteEntry = await ModuleServiceProcess.resolveEntry(record);
        if (record.stopRequested || this.disposing) {
            throw new ServiceError(this.abortCode(record));
        }
        this.assertStartable(record);
        const generation = ++record.lastGeneration;
        let serviceProcess: ModuleServiceProcess;
        try {
            serviceProcess = new ModuleServiceProcess(record, generation, {
                isTrusted: (boardRoot) => this.isEffectivelyTrusted(boardRoot),
                capabilities: (currentRecord) => this.trustDirectory.entryFor(currentRecord.boardRoot)?.capabilities,
                mcpEndpoint: (currentRecord, currentProcess, message) => this.mcpEndpoints.handle(currentRecord, currentProcess, message),
                boardSettings: (currentRecord, currentProcess, message) => this.boardSettings.handle(currentRecord, currentProcess, message),
                capabilityClient: (currentRecord, currentProcess, message) => this.serviceCapabilities.handleClient(currentRecord, currentProcess, message),
                capabilityResult: (currentRecord, currentProcess, message) => this.serviceCapabilities.handleResult(currentRecord, currentProcess, message),
                channelEnded: (currentRecord, channelId) => this.channelBroker.channelEnded(currentRecord, channelId),
                response: (currentRecord, message) => this.settleServiceResponse(currentRecord, message),
                rendererAttached: (currentRecord, leaseGeneration, leaseNonce) => acknowledgeRendererLease(currentRecord, leaseGeneration, leaseNonce),
                ready: (currentProcess) => {
                    record.cancelAttempt = undefined;
                    record.pid = currentProcess.pid;
                    record.startedAt = Date.now();
                    record.terminalFailure = false;
                    this.transition(record, "running", undefined);
                    return { boardRoot: record.boardRoot, pid: record.pid, startedAt: record.startedAt };
                },
                unexpectedExit: (currentProcess, code) => this.handleUnexpectedExit(record, currentProcess, code),
            }, absoluteEntry);
        } catch (error) {
            throw new ServiceError("spawn-error", errMessage(error));
        }

        record.current = serviceProcess;
        record.pid = serviceProcess.pid;

        if (record.stopRequested || this.disposing || !this.isEffectivelyTrusted(record.boardRoot)) {
            if (record.current === serviceProcess) record.current = undefined;
            record.pid = undefined;
            serviceProcess.killSync();
            throw new ServiceError(this.abortCode(record));
        }

        record.cancelAttempt = (error) => serviceProcess.cancelStart(error);
        try {
            return await serviceProcess.start();
        } catch (error: unknown) {
            if (record.cancelAttempt) record.cancelAttempt = undefined;
            if (record.current === serviceProcess) record.current = undefined;
            record.pid = undefined;
            record.startedAt = undefined;
            throw error;
        }
    }

    private settleServiceResponse(record: ServiceRecord, message: Extract<ServiceMainMessage, { kind: "response" }>): void {
        if ("error" in message) {
            if (typeof message.error === "string") {
                record.requests.fail(message.requestId, new ServiceError("service-error", message.error));
            } else {
                record.requests.fail(message.requestId, new ServiceError(
                    message.error.code,
                    errMessage(message.error.message, "Service request failed"),
                ));
            }
        } else {
            record.requests.settle(message.requestId, message.result);
        }
    }

    private handleUnexpectedExit(record: ServiceRecord, serviceProcess: ModuleServiceProcess, code: number): void {
        if (record.current !== serviceProcess) return;
        this.boardSettings.settle(record, "service-exited");
        this.boardSettings.removeForRecord(record);
        void revokePrivateMcpEndpointsForBoard(record.boardRoot);
        record.current = undefined;
        this.closeRecordChannels(record, { code: "service-exited", message: "The board service exited." });
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
        this.boardSettings.settle(record, STOP_REASON_CODE[reason]);
        this.boardSettings.removeForRecord(record);
        void revokePrivateMcpEndpointsForBoard(record.boardRoot);
        const process = record.current;
        this.closeRecordChannels(record, {
            code: STOP_REASON_CODE[reason],
            message: reason === "untrusted" ? "Board service trust was revoked."
                : reason === "quit" ? "Persephone is closing."
                    : "The board service was stopped.",
        });
        record.current = undefined;
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
                await process.stop(reason);
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
        this.serviceCapabilities.rejectRecord(record, code);
        record.requests.failAll(new ServiceError(code));
    }

    private closeRecordChannels(record: ServiceRecord, reason: { code: string; message: string }): void {
        this.channelBroker.closeRecordChannels(record, reason);
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
        openWindows.send("eModuleServiceStatusChanged", this.statusOf(record));
    }
}

export const moduleServiceSupervisor = new ModuleServiceSupervisor();
