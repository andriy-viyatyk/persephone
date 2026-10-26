import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import {
    app,
    BrowserWindow,
    MessageChannelMain,
    type UtilityProcess,
    type WebContents,
    utilityProcess,
} from "electron";
import { EventEndpoint } from "../ipc/api-types";
import { BoardServiceSettingsChannel, type BoardServiceSettingsReply, type BoardServiceSettingsRequest } from "../ipc/board-service-settings-channels";
import { guardedIpcOn } from "./ipc-sender-guard";
import {
    MAX_OUTSTANDING_REQUESTS_PER_SERVICE,
    MAX_SERVICE_CHANNELS_PER_BOARD,
    MAX_SERVICE_CHANNELS_PER_SERVICE,
    MAX_SERVICE_CHANNEL_IN_FLIGHT,
    MAX_SERVICE_CHANNEL_MESSAGE_BYTES,
    SERVICE_CHANNEL_ACK_BATCH,
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
import { boardPermissionAllows } from "../shared/board-manifest-utils";
import { MAX_BUFFERED_PIPE_BYTES, MAX_BOARD_PIPE_CHUNK_BYTES } from "../shared/board-pipe-constants";
import { ModuleServiceStorageAdapter } from "./module-service-storage";
import { openWindows } from "./open-windows";
import { getAssetPath } from "./utils";
import * as boardLog from "./board-log";
import { ServiceError, type ServiceRecord, isCurrent, killUtilityProcessSync } from "./module-service-record";
import { RestartBudget, RESTART_BUDGET } from "./module-service-restart-budget";
import { Handshake, routeProcessMessage } from "./module-service-handshake";
import { failLease, transferRendererLease, type LeaseCallbacks } from "./module-service-leases";
import { issuePrivateMcpEndpoint, revokePrivateMcpEndpointForBoard, revokePrivateMcpEndpointsForBoard } from "./mcp/private-session-endpoints";

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
    private readonly providerKeys = new Map<string, string>();
    private providerIndex = new Map<string, TrustedBoardSnapshotEntry[]>();
    private disposing = false;
    private readonly boardSettingsPending = new Map<string, {
        record: ServiceRecord;
        process: UtilityProcess;
        generation: number;
        webContents: WebContents;
        timer: ReturnType<typeof setTimeout>;
        resolve: (reply: BoardServiceSettingsReply) => void;
        lifecycleListeners: Array<() => void>;
    }>();
    private readonly boardSettingsSubscriptions = new Map<string, {
        record: ServiceRecord;
        process: UtilityProcess;
        generation: number;
        subscriptionId: string;
        webContents?: WebContents;
        lifecycleListeners: Array<() => void>;
    }>();

    constructor() {
        app.on("browser-window-created", (_event, window) => {
            window.webContents.once("did-finish-load", (): void => {
                for (const subscription of this.boardSettingsSubscriptions.values()) {
                    if (!subscription.webContents) {
                        void this.installBoardSettingsSubscription(subscription).catch((error: unknown): void => {
                            console.error(`Board settings subscription reinstall failed: ${errMessage(error)}`);
                        });
                    }
                }
            });
        });
        for (const replyChannel of [
            BoardServiceSettingsChannel.getReply,
            BoardServiceSettingsChannel.subscribeReply,
            BoardServiceSettingsChannel.unsubscribeReply,
        ]) {
            guardedIpcOn(replyChannel, (event, reply: BoardServiceSettingsReply) => {
                if (!reply || typeof reply.requestId !== "string") return;
                const pending = this.boardSettingsPending.get(reply.requestId);
                if (!pending || pending.webContents !== event.sender) return;
                this.boardSettingsPending.delete(reply.requestId);
                clearTimeout(pending.timer);
                this.detachBoardSettingsPending(pending);
                pending.resolve(isCurrent(pending.record, pending.process, pending.generation)
                    ? reply
                    : { requestId: reply.requestId, ok: false, error: { code: "service-exited", message: "The service has exited." } });
            });
        }
        guardedIpcOn(BoardServiceSettingsChannel.changed, (event, change: { subscriptionId: string; id: string; value: unknown }) => {
            if (!change || typeof change.subscriptionId !== "string" || typeof change.id !== "string"
                || !(typeof change.value === "string" || typeof change.value === "boolean"
                    || (typeof change.value === "number" && Number.isFinite(change.value)))) return;
            const subscription = [...this.boardSettingsSubscriptions.values()].find((candidate) => candidate.subscriptionId === change.subscriptionId);
            if (!subscription || subscription.webContents !== event.sender
                || !isCurrent(subscription.record, subscription.process, subscription.generation)
                || subscription.record.state !== "running" || !this.isBoardSettingsAllowed(subscription.record)) return;
            try {
                subscription.process.postMessage({
                    kind: "board-settings-changed",
                    subscriptionId: subscription.subscriptionId,
                    id: change.id,
                    value: change.value,
                });
            } catch { /* The generation check prevents forwarding to a replacement service. */ }
        });
    }

    async applyBoardServiceTrustSnapshot(snapshot: BoardServiceTrustSnapshot): Promise<void> {
        if (this.disposing) return;
        const previousSnapshot = this.trustedSnapshot;
        const previouslyUntrusted = new Set(
            [...this.records.values()]
                .filter((record) => !this.isEffectivelyTrusted(record.boardRoot))
                .map((record) => record.key),
        );
        this.trustedSnapshot = snapshot;
        const currentRoots = new Set(snapshot.boards.map((entry) => normalizeRoot(entry.boardRoot)));
        for (const root of this.providerKeys.keys()) if (!currentRoots.has(root)) this.providerKeys.delete(root);
        this.providerIndex = new Map();
        for (const entry of snapshot.boards) {
            if (!entry.service || !entry.canStartService || !boardPermissionAllows(entry.permissions, "service")) continue;
            for (const declaration of entry.serviceInterfaces ?? []) {
                const providers = this.providerIndex.get(declaration.id) ?? [];
                if (!providers.includes(entry)) providers.push(entry);
                this.providerIndex.set(declaration.id, providers);
            }
        }
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
                const previous = previousSnapshot?.boards.find((board) => normalizeRoot(board.boardRoot) === key);
                if (previous && boardPermissionAllows(previous.permissions, "appScripting")
                    && !boardPermissionAllows(entry.permissions, "appScripting")) {
                    await revokePrivateMcpEndpointsForBoard(existing.boardRoot);
                }
                const serviceEntryChanged = existing.serviceEntry !== entry.service;
                existing.boardRoot = entry.boardRoot;
                existing.serviceEntry = entry.service;
                existing.canStartService = entry.canStartService;
                if (previous?.canStartService && !entry.canStartService) {
                    this.closeChannelsForProvider(existing, { code: "permission-denied", message: "The provider no longer grants service access." });
                    stopPromises.push(this.stopRecord(existing, "explicit"));
                } else if (serviceEntryChanged && (existing.process || existing.startPromise)) {
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
                generation: 0,
                requests: new Map(),
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
        for (const record of this.records.values()) {
            const provider = snapshot.boards.find((entry) => normalizeRoot(entry.boardRoot) === record.key);
            for (const [channelId, owner] of record.channels) {
                if (owner.interfaceId && owner.version !== undefined
                    && !(provider?.serviceInterfaces ?? []).some((item) => item.id === owner.interfaceId && item.version === owner.version)) {
                    this.closeChannel(record, channelId, { code: "service-not-declared", message: "The provider no longer declares this service interface." });
                    continue;
                }
                if (!owner.consumerRoot) continue;
                const consumer = snapshot.boards.find((entry) => normalizeRoot(entry.boardRoot) === normalizeRoot(owner.consumerRoot));
                const previous = previousSnapshot?.boards.find((entry) => normalizeRoot(entry.boardRoot) === normalizeRoot(owner.consumerRoot));
                const granted = consumer?.uses.some((use) => use.id === owner.interfaceId && use.version === owner.version) === true;
                const wasGranted = previous?.uses.some((use) => use.id === owner.interfaceId && use.version === owner.version) === true;
                const lostTrust = !consumer && this.isEffectivelyTrusted(owner.consumerRoot) === false;
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

    private isBoardSettingsAllowed(record: ServiceRecord): boolean {
        const grant = this.trustedSnapshot?.boards.find((board) => normalizeRoot(board.boardRoot) === record.key);
        return !!grant && grant.canStartService && boardPermissionAllows(grant.permissions, "service")
            && this.isEffectivelyTrusted(record.boardRoot);
    }

    private async handleBoardSettingsRequest(
        record: ServiceRecord,
        process: UtilityProcess,
        generation: number,
        message: Extract<import("../ipc/module-service-channels").ServiceMainMessage, { kind: "board-settings-get" | "board-settings-subscribe" | "board-settings-unsubscribe" }>,
    ): Promise<void> {
        const post = (kind: "board-settings-response" | "board-settings-subscribe-response" | "board-settings-unsubscribe-response", payload: { result?: unknown; error?: { code: string; message: string } } = {}) => {
            if (!isCurrent(record, process, generation)) return;
            try { process.postMessage({ kind, requestId: message.requestId, ...payload }); } catch { /* service exited */ }
        };
        try {
            if (typeof message.requestId !== "string" || !message.requestId) throw new ServiceError("service-error", "Malformed board settings request.");
            if (!isCurrent(record, process, generation) || record.state !== "running" || record.stopRequested) throw new ServiceError("service-exited");
            if (!this.isBoardSettingsAllowed(record)) throw new ServiceError("untrusted");
            if (message.kind === "board-settings-get") {
                if (typeof message.id !== "string" || !message.id.trim()) throw new ServiceError("service-error", "Board setting id must be a non-empty string.");
                const reply = await this.requestBoardSettingsRenderer(record, process, generation, BoardServiceSettingsChannel.get, { id: message.id.trim() });
                if (!reply.ok) throw new ServiceError(reply.error?.code ?? "service-error", reply.error?.message ?? "Board settings request failed.");
                if (!(typeof reply.result === "string" || typeof reply.result === "boolean"
                    || (typeof reply.result === "number" && Number.isFinite(reply.result)))) {
                    throw new ServiceError("service-error", "Board setting result must be a finite scalar.");
                }
                post("board-settings-response", { result: reply.result });
                return;
            }
            if (typeof message.subscriptionId !== "string" || !message.subscriptionId) throw new ServiceError("service-error", "Malformed board settings subscription.");
            if (message.kind === "board-settings-subscribe") {
                const existing = this.boardSettingsSubscriptions.get(record.key);
                if (existing && existing.subscriptionId !== message.subscriptionId) throw new ServiceError("service-busy", "A board settings subscription is already active.");
                const subscription = existing ?? { record, process, generation, subscriptionId: message.subscriptionId, lifecycleListeners: [] };
                this.boardSettingsSubscriptions.set(record.key, subscription);
                try {
                    await this.installBoardSettingsSubscription(subscription);
                } catch (error: unknown) {
                    if (!existing) this.removeBoardSettingsSubscription(subscription);
                    throw error;
                }
                post("board-settings-subscribe-response");
                return;
            }
            const subscription = this.boardSettingsSubscriptions.get(record.key);
            if (subscription?.subscriptionId === message.subscriptionId) {
                try {
                    await this.sendBoardSettingsToWebContents(record, process, generation, subscription.webContents, BoardServiceSettingsChannel.unsubscribe,
                        { boardRoot: record.boardRoot, subscriptionId: message.subscriptionId });
                } finally {
                    this.removeBoardSettingsSubscription(subscription);
                }
            }
            post("board-settings-unsubscribe-response");
        } catch (error: unknown) {
            const serviceError = this.asServiceError(error, "service-error");
            const kind = message.kind === "board-settings-get" ? "board-settings-response"
                : message.kind === "board-settings-subscribe" ? "board-settings-subscribe-response" : "board-settings-unsubscribe-response";
            post(kind, { error: { code: serviceError.code, message: serviceError.message } });
        }
    }

    private async requestBoardSettingsRenderer(
        record: ServiceRecord,
        process: UtilityProcess,
        generation: number,
        channel: string,
        request: Pick<BoardServiceSettingsRequest, "id">,
    ): Promise<BoardServiceSettingsReply> {
        const requestId = `board-settings-${crypto.randomUUID()}`;
        return new Promise<BoardServiceSettingsReply>((resolve) => {
            let settled = false;
            const timer = setTimeout(() => {
                settled = true;
                const pending = this.boardSettingsPending.get(requestId);
                this.boardSettingsPending.delete(requestId);
                if (pending) this.detachBoardSettingsPending(pending);
                resolve({ requestId, ok: false, error: { code: "service-timeout", message: "Service request timed out." } });
            }, SERVICE_REQUEST_DEADLINE_MS);
            void (async () => {
                const renderer = await this.selectBoardSettingsRenderer();
                if (settled) return;
                if (!renderer) {
                    settled = true;
                    clearTimeout(timer);
                    resolve({ requestId, ok: false, error: { code: "service-exited", message: "No renderer window is available." } });
                    return;
                }
                if (!isCurrent(record, process, generation)) {
                    settled = true;
                    clearTimeout(timer);
                    resolve({ requestId, ok: false, error: { code: "service-exited", message: "The service has exited." } });
                    return;
                }
                const pending = { record, process, generation, webContents: renderer, timer, resolve, lifecycleListeners: [] as Array<() => void> };
                this.boardSettingsPending.set(requestId, pending);
                this.watchBoardSettingsRendererRequest(requestId, pending);
                try {
                    renderer.send(channel, { ...request, requestId, boardRoot: record.boardRoot });
                } catch (error: unknown) {
                    settled = true;
                    this.boardSettingsPending.delete(requestId);
                    this.detachBoardSettingsPending(pending);
                    clearTimeout(timer);
                    resolve({ requestId, ok: false, error: { code: "service-exited", message: errMessage(error, "Renderer is unavailable.") } });
                }
            })().catch((error: unknown) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                resolve({ requestId, ok: false, error: { code: "service-exited", message: errMessage(error, "Renderer is unavailable.") } });
            });
        });
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

    private async installBoardSettingsSubscription(subscription: {
        record: ServiceRecord;
        process: UtilityProcess;
        generation: number;
        subscriptionId: string;
        webContents?: WebContents;
        lifecycleListeners: Array<() => void>;
    }, excluded?: WebContents): Promise<void> {
        if (!isCurrent(subscription.record, subscription.process, subscription.generation)
            || !this.isBoardSettingsAllowed(subscription.record)) throw new ServiceError("untrusted");
        const renderer = await this.selectBoardSettingsRenderer(excluded);
        if (!renderer) throw new ServiceError("service-exited", "No renderer window is available.");
        const reply = await this.sendBoardSettingsToWebContents(subscription.record, subscription.process, subscription.generation, renderer, BoardServiceSettingsChannel.subscribe,
            { boardRoot: subscription.record.boardRoot, subscriptionId: subscription.subscriptionId });
        if (!reply.ok) throw new ServiceError(reply.error?.code ?? "service-error", reply.error?.message ?? "Board settings subscription failed.");
        if (!isCurrent(subscription.record, subscription.process, subscription.generation)) throw new ServiceError("service-exited");
        this.detachBoardSettingsRenderer(subscription);
        subscription.webContents = renderer;
        const lost = (): void => {
            if (subscription.webContents !== renderer) return;
            this.detachBoardSettingsRenderer(subscription);
            void this.reinstallBoardSettingsSubscription(subscription, renderer);
        };
        renderer.on("did-navigate", lost);
        renderer.on("render-process-gone", lost);
        renderer.on("destroyed", lost);
        subscription.lifecycleListeners.push(
            () => { renderer.removeListener("did-navigate", lost); },
            () => { renderer.removeListener("render-process-gone", lost); },
            () => { renderer.removeListener("destroyed", lost); },
        );
    }

    private async reinstallBoardSettingsSubscription(subscription: {
        record: ServiceRecord;
        process: UtilityProcess;
        generation: number;
        subscriptionId: string;
        webContents?: WebContents;
        lifecycleListeners: Array<() => void>;
    }, previous: WebContents): Promise<void> {
        if (!isCurrent(subscription.record, subscription.process, subscription.generation)
            || this.boardSettingsSubscriptions.get(subscription.record.key) !== subscription) return;
        const others = openWindows.windows.some((entry) => entry.window && !entry.window.window.isDestroyed()
            && !entry.window.window.webContents.isDestroyed() && entry.window.window.webContents !== previous);
        if (!others && !previous.isDestroyed()) {
            previous.once("did-finish-load", (): void => {
                void this.installBoardSettingsSubscription(subscription).catch((error: unknown): void => {
                    console.error(`Board settings subscription reinstall failed: ${errMessage(error)}`);
                });
            });
            return;
        }
        try {
            await this.installBoardSettingsSubscription(subscription, previous);
        } catch (error: unknown) {
            console.error(`Board settings subscription reinstall failed: ${errMessage(error)}`);
        }
    }

    private detachBoardSettingsRenderer(subscription: { webContents?: WebContents; lifecycleListeners: Array<() => void> }): void {
        for (const dispose of subscription.lifecycleListeners) dispose();
        subscription.lifecycleListeners = [];
        subscription.webContents = undefined;
    }

    private removeBoardSettingsSubscription(subscription: {
        record: ServiceRecord;
        subscriptionId: string;
        webContents?: WebContents;
        lifecycleListeners: Array<() => void>;
    }): void {
        if (subscription.webContents && !subscription.webContents.isDestroyed()) {
            try { subscription.webContents.send(BoardServiceSettingsChannel.unsubscribe, { requestId: crypto.randomUUID(), boardRoot: subscription.record.boardRoot, subscriptionId: subscription.subscriptionId }); } catch { /* renderer exited */ }
        }
        this.detachBoardSettingsRenderer(subscription);
        if (this.boardSettingsSubscriptions.get(subscription.record.key) === subscription) this.boardSettingsSubscriptions.delete(subscription.record.key);
    }

    private sendBoardSettingsToWebContents(
        record: ServiceRecord,
        process: UtilityProcess,
        generation: number,
        webContents: WebContents | undefined,
        channel: string,
        request: Omit<BoardServiceSettingsRequest, "requestId">,
    ): Promise<BoardServiceSettingsReply> {
        if (!webContents || webContents.isDestroyed()) return Promise.resolve({ requestId: "", ok: false, error: { code: "service-exited", message: "The renderer is unavailable." } });
        const requestId = crypto.randomUUID();
        return new Promise((resolve) => {
            const timer = setTimeout(() => {
                const pending = this.boardSettingsPending.get(requestId);
                this.boardSettingsPending.delete(requestId);
                if (pending) this.detachBoardSettingsPending(pending);
                resolve({ requestId, ok: false, error: { code: "service-timeout", message: "Service request timed out." } });
            }, SERVICE_REQUEST_DEADLINE_MS);
            const pendingRequest = { ...request, requestId };
            const pending = { record, process, generation, webContents, timer, resolve, lifecycleListeners: [] as Array<() => void> };
            this.boardSettingsPending.set(requestId, pending);
            this.watchBoardSettingsRendererRequest(requestId, pending);
            try { webContents.send(channel, pendingRequest); }
            catch (error: unknown) {
                this.boardSettingsPending.delete(requestId);
                this.detachBoardSettingsPending(pending);
                clearTimeout(timer);
                resolve({ requestId, ok: false, error: { code: "service-exited", message: errMessage(error, "Renderer is unavailable.") } });
            }
        });
    }

    private watchBoardSettingsRendererRequest(
        requestId: string,
        pending: { webContents: WebContents; lifecycleListeners: Array<() => void>; timer: ReturnType<typeof setTimeout>; resolve: (reply: BoardServiceSettingsReply) => void },
    ): void {
        const lost = (): void => {
            if (this.boardSettingsPending.get(requestId) !== pending) return;
            this.boardSettingsPending.delete(requestId);
            clearTimeout(pending.timer);
            this.detachBoardSettingsPending(pending);
            pending.resolve({ requestId, ok: false, error: { code: "service-exited", message: "The renderer became unavailable." } });
        };
        pending.webContents.on("did-navigate", lost);
        pending.webContents.on("render-process-gone", lost);
        pending.webContents.on("destroyed", lost);
        pending.lifecycleListeners.push(
            () => { pending.webContents.removeListener("did-navigate", lost); },
            () => { pending.webContents.removeListener("render-process-gone", lost); },
            () => { pending.webContents.removeListener("destroyed", lost); },
        );
    }

    private detachBoardSettingsPending(pending: { lifecycleListeners: Array<() => void> }): void {
        for (const dispose of pending.lifecycleListeners) dispose();
        pending.lifecycleListeners = [];
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
        if (!record.process || record.state !== "running") throw new ServiceError("service-exited");
        const boardChannels = [...record.channels.values()].filter((owner) => owner.boardId === boardId).length;
        if (boardChannels >= MAX_SERVICE_CHANNELS_PER_BOARD || record.channels.size >= MAX_SERVICE_CHANNELS_PER_SERVICE) {
            throw new ServiceError("service-busy", "The service has reached its open channel limit.");
        }
        const channelId = crypto.randomUUID();
        const generation = record.generation;
        const { port1, port2 } = new MessageChannelMain();
        record.channels.set(channelId, { boardId, generation, host: target });
        try {
            record.process.postMessage({ kind: "channel-open", channelId, boardId, generation, openMessage, info: { page: { boardId } } }, [port2]);
            target.postMessage(EventEndpoint.eBoardServiceChannel, { boardId, channelId }, [port1]);
        } catch (error) {
            try { record.process?.postMessage({ kind: "channel-close", channelId, reason: { code: "service-exited", message: "The channel could not be delivered." } } satisfies ServiceParentMessage); } catch { /* service exited */ }
            record.channels.delete(channelId);
            try { port1.close(); } catch { /* transferred or already closed */ }
            try { port2.close(); } catch { /* transferred or already closed */ }
            throw new ServiceError("service-exited", errMessage(error));
        }
        return channelId;
    }

    listServiceProviders(interfaceId: string): Array<{ provider: string; title: string; version: number; boardName: string }> {
        if (!this.trustedSnapshot) throw new ServiceError("trust-not-ready");
        const providers: Array<{ provider: string; title: string; version: number; boardName: string }> = [];
        for (const entry of this.providerIndex.get(interfaceId) ?? []) {
            const root = normalizeRoot(entry.boardRoot);
            let provider = this.providerKeys.get(root);
            if (!provider) { provider = crypto.randomUUID(); this.providerKeys.set(root, provider); }
            for (const declaration of entry.serviceInterfaces ?? []) {
                if (declaration.id !== interfaceId) continue;
                providers.push({ provider, title: declaration.title || entry.boardName || path.basename(entry.boardRoot), version: declaration.version, boardName: entry.boardName || path.basename(entry.boardRoot) });
            }
        }
        return providers;
    }

    async connectServiceChannel(consumerRoot: string, target: WebContents, boardId: string, interfaceId: string, selector: { provider: string; version: number }, openMessage?: unknown): Promise<string> {
        await this.awaitTrustReady();
        if (!selector || typeof selector.provider !== "string" || !Number.isSafeInteger(selector.version) || selector.version <= 0) throw new ServiceError("invalid-argument");
        const snapshot = this.trustedSnapshot;
        const consumer = snapshot?.boards.find((entry) => normalizeRoot(entry.boardRoot) === normalizeRoot(consumerRoot));
        if (!consumer || !(consumer.uses ?? []).some((use) => use.id === interfaceId && use.version === selector.version)) throw new ServiceError("permission-denied");
        const providerEntry = snapshot?.boards.find((entry) => {
            const key = this.providerKeys.get(normalizeRoot(entry.boardRoot));
            return key === selector.provider;
        });
        if (!providerEntry || !providerEntry.service) throw new ServiceError("service-not-declared");
        if (!providerEntry.canStartService || !boardPermissionAllows(providerEntry.permissions, "service")) throw new ServiceError("permission-denied");
        const declaration = (providerEntry.serviceInterfaces ?? []).find((item) => item.id === interfaceId && item.version === selector.version);
        if (!declaration) throw new ServiceError("service-not-declared");
        const providerRoot = normalizeRoot(providerEntry.boardRoot);
        const record = this.requireRecord(providerRoot);
        await this.start(providerEntry.boardRoot, "request");
        const latestSnapshot = this.trustedSnapshot;
        const latestConsumer = latestSnapshot?.boards.find((entry) => normalizeRoot(entry.boardRoot) === normalizeRoot(consumerRoot));
        const latestProvider = latestSnapshot?.boards.find((entry) => this.providerKeys.get(normalizeRoot(entry.boardRoot)) === selector.provider);
        if (!latestConsumer || !(latestConsumer.uses ?? []).some((use) => use.id === interfaceId && use.version === selector.version)) throw new ServiceError("permission-denied");
        if (!latestProvider) throw new ServiceError("untrusted");
        if (!latestProvider.service || !latestProvider.canStartService || !boardPermissionAllows(latestProvider.permissions, "service")) throw new ServiceError("permission-denied");
        if (!(latestProvider.serviceInterfaces ?? []).some((item) => item.id === interfaceId && item.version === selector.version)) throw new ServiceError("service-not-declared");
        if (!record.process || record.state !== "running") throw new ServiceError("service-exited");
        const boardChannels = [...record.channels.values()].filter((owner) => owner.boardId === boardId).length;
        if (boardChannels >= MAX_SERVICE_CHANNELS_PER_BOARD || record.channels.size >= MAX_SERVICE_CHANNELS_PER_SERVICE) throw new ServiceError("service-busy");
        const channelId = crypto.randomUUID();
        const generation = record.generation;
        const { port1, port2 } = new MessageChannelMain();
        record.channels.set(channelId, { boardId, generation, host: target, consumerRoot: normalizeRoot(consumerRoot), interfaceId, version: selector.version });
        const caller = latestConsumer;
        const info = {
            page: { boardId },
            interface: { id: interfaceId, version: selector.version },
            caller: { id: caller?.callerId ?? this.localCallerId(consumerRoot), name: caller?.boardName ?? path.basename(consumerRoot) },
        };
        try {
            record.process.postMessage({ kind: "channel-open", channelId, boardId, generation, openMessage, info }, [port2]);
            target.postMessage(EventEndpoint.eBoardServiceChannel, { boardId, channelId }, [port1]);
        } catch (error) {
            record.channels.delete(channelId);
            try { port1.close(); } catch { /* already transferred */ }
            try { port2.close(); } catch { /* already transferred */ }
            throw new ServiceError("service-exited", errMessage(error));
        }
        return channelId;
    }

    async connectHostServiceChannel(target: WebContents, selector: { provider: string; version: number }, openMessage: unknown): Promise<string> {
        const interfaceId = "speech.transcribe";
        if (!selector || typeof selector.provider !== "string" || selector.version !== 1) throw new ServiceError("invalid-argument");
        const openType = openMessage && typeof openMessage === "object" ? (openMessage as { type?: unknown }).type : undefined;
        // Voice typing asks the provider whether it supports live text before it transcribes.
        if (openType !== "transcribe" && openType !== "describe") {
            throw new ServiceError("invalid-argument", "The host service channel accepts describe and transcription requests only.");
        }
        await this.awaitTrustReady();
        const findProvider = (): TrustedBoardSnapshotEntry | undefined => this.trustedSnapshot?.boards.find((entry) =>
            this.providerKeys.get(normalizeRoot(entry.boardRoot)) === selector.provider,
        );
        const provider = findProvider();
        if (!provider || !provider.service) throw new ServiceError("service-not-declared");
        if (!provider.canStartService || !boardPermissionAllows(provider.permissions, "service")) throw new ServiceError("permission-denied");
        if (!(provider.serviceInterfaces ?? []).some((item) => item.id === interfaceId && item.version === 1)) throw new ServiceError("service-not-declared");
        const providerRoot = normalizeRoot(provider.boardRoot);
        const record = this.requireRecord(providerRoot);
        await this.start(provider.boardRoot, "request");
        const latestProvider = findProvider();
        if (!latestProvider) throw new ServiceError("untrusted");
        if (!latestProvider.service || !latestProvider.canStartService || !boardPermissionAllows(latestProvider.permissions, "service")) throw new ServiceError("permission-denied");
        if (!(latestProvider.serviceInterfaces ?? []).some((item) => item.id === interfaceId && item.version === 1)) throw new ServiceError("service-not-declared");
        if (!record.process || record.state !== "running") throw new ServiceError("service-exited");
        if (target.isDestroyed()) throw new ServiceError("service-exited");

        const boardId = `voice-typing:${BrowserWindow.fromWebContents(target)?.id ?? target.id}`;
        const boardChannels = [...record.channels.values()].filter((owner) => owner.boardId === boardId).length;
        if (boardChannels >= MAX_SERVICE_CHANNELS_PER_BOARD || record.channels.size >= MAX_SERVICE_CHANNELS_PER_SERVICE) throw new ServiceError("service-busy");
        const channelId = crypto.randomUUID();
        const generation = record.generation;
        const { port1, port2 } = new MessageChannelMain();
        record.channels.set(channelId, { boardId, generation, host: target, interfaceId, version: 1 });
        const info = {
            page: { boardId },
            interface: { id: interfaceId, version: 1 },
            caller: { id: "persephone", name: "Persephone" },
        };
        try {
            record.process.postMessage({ kind: "channel-open", channelId, boardId, generation, openMessage, info }, [port2]);
            target.postMessage(EventEndpoint.eBoardServiceChannel, { boardId, channelId }, [port1]);
        } catch (error: unknown) {
            record.channels.delete(channelId);
            try { port1.close(); } catch { /* already transferred */ }
            try { port2.close(); } catch { /* already transferred */ }
            throw new ServiceError("service-exited", errMessage(error));
        }
        return channelId;
    }

    private localCallerId(boardRoot: string): string {
        return `local:${createHash("sha256").update(normalizeRoot(boardRoot)).digest("hex")}`;
    }

    private closeChannel(record: ServiceRecord, channelId: string, reason: { code: string; message: string }): void {
        if (!record.channels.delete(channelId)) return;
        try { record.process?.postMessage({ kind: "channel-close", channelId, reason } satisfies ServiceParentMessage); } catch { /* exiting */ }
    }

    private closeChannelsForProvider(record: ServiceRecord, reason: { code: string; message: string }): void {
        for (const channelId of record.channels.keys()) this.closeChannel(record, channelId, reason);
    }

    closeBoardChannels(boardId: string, reason: { code: string; message: string }): void {
        for (const record of this.records.values()) {
            for (const [channelId, owner] of record.channels) {
                if (owner.boardId !== boardId) continue;
                this.closeChannel(record, channelId, reason);
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
            const process = record.process;
            this.closeRecordChannels(record, { code: "quit", message: "Persephone is closing." });
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
                    onMcpEndpointRequest: (message) => {
                        void (async () => {
                            try {
                                if (!isCurrent(record, process, generation) || record.state !== "running" || record.stopRequested) throw new ServiceError("service-exited");
                                const grant = this.trustedSnapshot?.boards.find((board) => normalizeRoot(board.boardRoot) === record.key);
                                if (!grant || !this.isEffectivelyTrusted(record.boardRoot)) throw new ServiceError("untrusted");
                                if (!boardPermissionAllows(grant.permissions, "appScripting")) throw new ServiceError("permission-denied");
                                let result: unknown;
                                if (message.operation === "issue") {
                                    const issued = await issuePrivateMcpEndpoint(record.boardRoot);
                                    const latestGrant = this.trustedSnapshot?.boards.find((board) => normalizeRoot(board.boardRoot) === record.key);
                                    if (!isCurrent(record, process, generation) || record.state !== "running" || record.stopRequested
                                        || !latestGrant || !this.isEffectivelyTrusted(record.boardRoot)
                                        || !boardPermissionAllows(latestGrant.permissions, "appScripting")) {
                                        await revokePrivateMcpEndpointForBoard(record.boardRoot, issued.token);
                                        throw new ServiceError("permission-denied");
                                    }
                                    result = issued;
                                } else if (typeof message.token === "string") {
                                    await revokePrivateMcpEndpointForBoard(record.boardRoot, message.token);
                                }
                                process.postMessage({ kind: "mcp-endpoint-response", requestId: message.requestId, result });
                            } catch (error) {
                                const serviceError = this.asServiceError(error, "service-error");
                                try {
                                    process.postMessage({ kind: "mcp-endpoint-response", requestId: message.requestId,
                                        error: { code: serviceError.code, message: serviceError.message } });
                                } catch { /* Service exited before the reply. */ }
                            }
                        })();
                    },
                    onBoardSettingsRequest: (message) => {
                        void this.handleBoardSettingsRequest(record, process, generation, message);
                    },
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
                    maxServiceChannelInFlight: MAX_SERVICE_CHANNEL_IN_FLIGHT,
                    maxServiceChannelMessageBytes: MAX_SERVICE_CHANNEL_MESSAGE_BYTES,
                    serviceChannelAckBatch: SERVICE_CHANNEL_ACK_BATCH,
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
        this.settleBoardSettings(record, "service-exited");
        const subscription = this.boardSettingsSubscriptions.get(record.key);
        if (subscription) this.removeBoardSettingsSubscription(subscription);
        void revokePrivateMcpEndpointsForBoard(record.boardRoot);
        record.process = undefined;
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
        this.settleBoardSettings(record, STOP_REASON_CODE[reason]);
        const settingsSubscription = this.boardSettingsSubscriptions.get(record.key);
        if (settingsSubscription) this.removeBoardSettingsSubscription(settingsSubscription);
        void revokePrivateMcpEndpointsForBoard(record.boardRoot);
        const process = record.process;
        const generation = record.generation;
        record.generation += 1;
        this.closeRecordChannels(record, {
            code: STOP_REASON_CODE[reason],
            message: reason === "untrusted" ? "Board service trust was revoked."
                : reason === "quit" ? "Persephone is closing."
                    : "The board service was stopped.",
        });
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

    private settleBoardSettings(record: ServiceRecord, code: string): void {
        for (const [requestId, pending] of this.boardSettingsPending) {
            if (pending.record !== record) continue;
            clearTimeout(pending.timer);
            this.boardSettingsPending.delete(requestId);
            this.detachBoardSettingsPending(pending);
            pending.resolve({ requestId, ok: false, error: { code, message: code } });
        }
    }

    private closeRecordChannels(record: ServiceRecord, reason: { code: string; message: string }): void {
        for (const [channelId] of record.channels) {
            try { record.process?.postMessage({ kind: "channel-close", channelId, reason } satisfies ServiceParentMessage); } catch { /* exiting */ }
        }
        record.channels.clear();
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
