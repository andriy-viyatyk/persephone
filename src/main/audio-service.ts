import { PLATFORM_AUDIO_CAPABILITY_ID } from "../shared/capability-constants";
import { CONTROL_CHANNEL, ARM_CHANNEL, CLEAR_CHANNEL, OPEN_CHANNEL, CLOSE_CHANNEL } from "../ipc/audio-channels";
import { globalMuteService } from "./global-mute-service";
import { app, BrowserWindow, MessageChannelMain, type MessagePortMain, type UtilityProcess, type WebContents } from "electron";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { AUDIO_DEVICES_REQUEST, AUDIO_DEVICES_REPLY, AUDIO_SETTINGS_UPDATE, AUDIO_SETTINGS_GET, AUDIO_SETTINGS_DEVICES, AUDIO_STATUS, AUDIO_STATUS_GET, AUDIO_RETRY, type AudioDevice, type AudioDevicesReply, type AudioDevicesRequest } from "../ipc/audio-channels";
import { openWindows } from "./open-windows";
import { MAX_SERVICE_CHANNELS_PER_BOARD } from "../shared/capability-limits";
import { BoardGrant } from "../shared/board/board-grant";
import { errMessage } from "../shared/utils";
import { codedError } from "../shared/coded-error";
import { openElectronServiceChannel } from "../shared/service-channel-node";
import { PendingRequests } from "../shared/pending-requests";
import { onWebContentsGone } from "./webcontents-lifetime";
import { appPartition } from "./constants";
import { capabilityRegistry } from "./capability-registry";
import type { BoundCapability, MainCapabilityInvocationContext } from "./capability-router";
import { armAudioMicrophoneGrant, armAudioLoopbackGrant, clearAudioCaptureGrants, setAudioWindowTargetResolver } from "./permission-policy-service";
import { setAudioCaptureCount } from "./audio-capture-state";
import { guardedIpcHandle, guardedIpcOn } from "./ipc-sender-guard";
import { deliverConsumerPort, deliveryOwner, type ChannelDelivery } from "./channel-delivery";

// Vite replaces this identifier in development and production builds.
declare const AUDIO_WINDOW_VITE_DEV_SERVER_URL: string | undefined;

interface ChannelRecord {
    id: string;
    bound: BoundCapability;
    source?: "microphone" | "computer";
    method: "capture" | "play";
    owner: WebContents | UtilityProcess;
    invocation: MainCapabilityInvocationContext;
    controller: AbortController;
    readyResolve: () => void;
    readyReject: (error: unknown) => void;
    ready: Promise<void>;
    readyTimer: ReturnType<typeof setTimeout>;
    closed: boolean;
    listeners: Set<() => void>;
    ports: MessagePortMain[];
    cancelOwner: () => void;
    removeOwnerListener: () => void;
}


function withAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        let settled = false;
        const finish = (error?: unknown, value?: T): void => {
            if (settled) return;
            settled = true;
            signal.removeEventListener("abort", abort);
            if (error !== undefined) reject(error); else resolve(value as T);
        };
        const abort = (): void => finish(signal.reason ?? codedError("cancelled"));
        if (signal.aborted) { abort(); return; }
        signal.addEventListener("abort", abort, { once: true });
        promise.then((value) => finish(undefined, value), (error: unknown) => finish(error));
    });
}

class AudioService {
    private window: BrowserWindow | undefined;
    private generation = 0;
    private epoch = 0;
    private readyPromise: Promise<void> | undefined;
    private readyResolve: (() => void) | undefined;
    private startupReject: ((error: unknown) => void) | undefined;
    private readonly channels = new Map<string, ChannelRecord>();
    private readonly muteChannels = new Set<() => void>();
    private readonly deviceRequests = new PendingRequests<AudioDevice[], { generation: number }, string>({
        nextId: () => crypto.randomUUID(),
        abortError: (reason) => reason ?? codedError("cancelled"),
    });
    private pendingOpens = 0;
    private initialized = false;
    private microphoneSettings: unknown;
    private readonly microphoneStatus = new Map<string, unknown>();

    initialize(): void {
        if (this.initialized) return;
        this.initialized = true;
        guardedIpcOn(AUDIO_SETTINGS_UPDATE, (event, snapshot: unknown) => {
            if (event.senderFrame !== event.sender.mainFrame || !openWindows.windows.some((item) => !item.boardRoot && item.window?.window.webContents === event.sender)) return;
            this.microphoneSettings = snapshot;
            if (this.window && !this.window.isDestroyed()) this.window.webContents.send(AUDIO_SETTINGS_UPDATE, snapshot);
        });
        guardedIpcHandle(AUDIO_SETTINGS_GET, (event) => {
            if (!this.window || event.sender !== this.window.webContents || event.senderFrame !== event.sender.mainFrame) throw codedError("permission-denied");
            return this.microphoneSettings;
        });
        guardedIpcOn(AUDIO_STATUS, (event, status: unknown) => {
            if (event.senderFrame !== event.sender.mainFrame || (event.sender !== this.window?.webContents
                && !openWindows.windows.some((item) => !item.boardRoot && item.window?.window.webContents === event.sender))) return;
            if (!status || typeof status !== "object" || !("mode" in status) || typeof status.mode !== "string") return;
            this.microphoneStatus.set(status.mode.startsWith("reference-") ? "reference" : "cleaning", status);
            for (const item of openWindows.windows) if (!item.boardRoot && item.window && !item.window.window.isDestroyed()) item.window.window.webContents.send(AUDIO_STATUS, status);
        });
        guardedIpcHandle(AUDIO_STATUS_GET, (event) => {
            if (event.senderFrame !== event.sender.mainFrame || !openWindows.windows.some((item) => !item.boardRoot && item.window?.window.webContents === event.sender)) throw codedError("permission-denied");
            return [...this.microphoneStatus.values()];
        });
        guardedIpcOn(AUDIO_RETRY, (event) => {
            if (event.senderFrame !== event.sender.mainFrame || !openWindows.windows.some((item) => !item.boardRoot && item.window?.window.webContents === event.sender)) return;
            if (this.window && !this.window.isDestroyed()) this.window.webContents.send(AUDIO_RETRY);
            for (const item of openWindows.windows) if (!item.boardRoot && item.window && !item.window.window.isDestroyed()) item.window.window.webContents.send(AUDIO_RETRY);
        });
        guardedIpcHandle(AUDIO_SETTINGS_DEVICES, async (event) => {
            if (event.senderFrame !== event.sender.mainFrame || !openWindows.windows.some((item) => !item.boardRoot && item.window?.window.webContents === event.sender)) throw codedError("permission-denied");
            this.pendingOpens++;
            let requestId: string | undefined;
            try {
                const signal = AbortSignal.timeout(10000);
                const opened = await this.ensureWindow(signal);
                const created = this.deviceRequests.create(undefined, signal, { meta: { generation: opened.generation } });
                requestId = created.id;
                try { opened.window.webContents.send(AUDIO_DEVICES_REQUEST, { requestId, epoch: this.epoch } satisfies AudioDevicesRequest); }
                catch (error) { this.deviceRequests.fail(requestId, error); throw error; }
                return await created.promise;
            } finally {
                this.pendingOpens--;
                this.destroyIdleWindow();
            }
        });
        setAudioWindowTargetResolver(() => this.window && !this.window.isDestroyed() ? this.window.webContents : undefined);
        guardedIpcOn(AUDIO_DEVICES_REPLY, (event, reply: AudioDevicesReply) => {
            const window = this.window;
            if (!window || window.isDestroyed() || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame
                || !reply || typeof reply.requestId !== "string" || reply.epoch !== this.epoch) return;
            const accepted = (meta: { generation: number }) => meta.generation === this.generation;
            if ("error" in reply) this.deviceRequests.fail(reply.requestId, codedError("rejected", reply.error.message), accepted);
            else this.deviceRequests.settle(reply.requestId, reply.devices, accepted);
        });
        guardedIpcOn(CONTROL_CHANNEL, (event, message: { type?: unknown; channelId?: unknown; epoch?: unknown; code?: unknown; message?: unknown; count?: unknown }) => {
            const window = this.window;
            if (!window || window.isDestroyed() || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) return;
            if (message?.type === "ready" && message.epoch === this.epoch) {
                this.readyResolve?.();
                this.readyResolve = undefined;
                return;
            }
            if (message?.type === "channel-ready" && typeof message.channelId === "string") {
                const record = this.channels.get(message.channelId);
                if (!record || record.closed) return;
                clearTimeout(record.readyTimer);
                record.readyResolve();
                return;
            }
            if (message?.type === "channel-closed" && typeof message.channelId === "string") {
                const record = this.channels.get(message.channelId);
                if (record) this.finishChannel(record, typeof message.code === "string" ? message.code : "channel-closed",
                    typeof message.message === "string" ? message.message : "Audio channel closed.", false);
            }
            if (message?.type === "capture-count" && Number.isSafeInteger(message.count) && (message.count as number) >= 0) {
                setAudioCaptureCount(message.count as number);
            }
        });
        guardedIpcHandle(ARM_CHANNEL, async (event, source: unknown) => {
            const window = this.window;
            if (!window || window.isDestroyed() || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame
                || (source !== "microphone" && source !== "computer")) throw codedError("permission-denied");
            if (source === "computer") armAudioLoopbackGrant(window.webContents);
            else armAudioMicrophoneGrant(window.webContents);
        });
        guardedIpcHandle(CLEAR_CHANNEL, (event) => {
            const window = this.window;
            if (!window || window.isDestroyed() || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw codedError("permission-denied");
            clearAudioCaptureGrants(window.webContents);
        });
        capabilityRegistry.onChange(() => {
            for (const record of this.channels.values()) {
                try { this.authorize(record.bound, record.source); }
                catch (error) { this.finishChannel(record, "permission-denied", errMessage(error, "Audio permission was revoked."), true); }
            }
        });
        app.on("before-quit", () => this.dispose());
    }

    async callDevices(bound: BoundCapability, method: string, args: unknown[], invocation: MainCapabilityInvocationContext, reauthorize: () => void): Promise<AudioDevice[]> {
        if (method !== "devices") throw codedError("no-handler");
        if (args.length !== 0) throw codedError("rejected", "devices takes no arguments.");
        const authorize = (): void => { reauthorize(); this.authorize(bound, "microphone"); };
        authorize();
        if (invocation.signal.aborted) throw invocation.signal.reason ?? codedError("cancelled");
        this.pendingOpens++;
        const unsubscribe = capabilityRegistry.onChange(() => {
            try { authorize(); } catch (error) { invocation.controller.abort(error); }
        });
        let requestId: string | undefined;
        try {
            const opened = await this.ensureWindow(invocation.signal);
            if (invocation.signal.aborted) throw invocation.signal.reason ?? codedError("cancelled");
            if (opened.generation !== this.generation || opened.window.isDestroyed()) throw codedError("handler-closed");
            authorize();
            const created = this.deviceRequests.create(undefined, invocation.signal, { meta: { generation: opened.generation } });
            requestId = created.id;
            const message: AudioDevicesRequest = { requestId, epoch: this.epoch };
            try { opened.window.webContents.send(AUDIO_DEVICES_REQUEST, message); }
            catch (error) { this.deviceRequests.fail(requestId, error); throw error; }
            const devices = await created.promise;
            authorize();
            return devices;
        } finally {
            unsubscribe();
            this.pendingOpens--;
            this.destroyIdleWindow();
        }
    }

    async openCapabilityChannel(
        bound: BoundCapability,
        method: string,
        argument: Record<string, unknown>,
        invocation: MainCapabilityInvocationContext,
        delivery: ChannelDelivery | undefined,
        reauthorize: () => void,
    ): Promise<{ channelId: string; onClose: (listener: () => void) => () => void }> {
        if (method === "muteApp") return this.openMuteChannel(bound, argument, invocation, delivery, reauthorize);
        if (method !== "capture" && method !== "play") throw codedError("no-handler", "Audio channel is unavailable.");
        if (!delivery) throw codedError("no-handler", "A capability channel consumer is required.");
        const request = method === "capture" ? this.validateCapture(argument) : this.validatePlayback(argument);
        const captureSource = method === "capture" ? (request as ReturnType<AudioService["validateCapture"]>).source : undefined;
        this.authorize(bound, captureSource);
        reauthorize();
        if (invocation.signal.aborted) throw codedError("cancelled");
        const owner = deliveryOwner(delivery);
        const callerKey = "provider" in bound.caller ? `${bound.caller.kind}:${bound.caller.provider}` : bound.caller.kind;
        if ([...this.channels.values()].filter((item) => {
            const itemCallerKey = "provider" in item.bound.caller ? `${item.bound.caller.kind}:${item.bound.caller.provider}` : item.bound.caller.kind;
            return item.owner === owner || itemCallerKey === callerKey;
        }).length >= MAX_SERVICE_CHANNELS_PER_BOARD) {
            throw codedError("busy", "The audio consumer has reached its channel limit.");
        }

        this.pendingOpens++;
        let openedWindow: { window: BrowserWindow; generation: number };
        try {
            openedWindow = await this.ensureWindow(invocation.signal);
            if (invocation.signal.aborted || openedWindow.window.isDestroyed() || openedWindow.generation !== this.generation) throw codedError("cancelled");
            this.authorize(bound, captureSource);
            reauthorize();
        } catch (error) {
            this.pendingOpens--;
            this.destroyIdleWindow();
            throw error;
        }
        const { window } = openedWindow;

        const channelId = crypto.randomUUID();
        const { port1: consumerPort, port2: audioPort } = new MessageChannelMain();
        let readyResolve: () => void = () => undefined;
        let readyReject: (error: unknown) => void = () => undefined;
        const ready = new Promise<void>((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
        const record: ChannelRecord = {
            id: channelId, bound, source: captureSource, method, owner, invocation, controller: invocation.controller,
            readyResolve, readyReject, ready, readyTimer: setTimeout(() => readyReject(codedError("handler-closed", "The audio window did not accept the channel.")), 12000),
            closed: false, listeners: new Set(), ports: [consumerPort, audioPort], cancelOwner: () => undefined, removeOwnerListener: () => undefined,
        };
        this.channels.set(channelId, record);
        this.pendingOpens--;
        const cancel = (): void => this.finishChannel(record, "cancelled", "Audio capture was cancelled.", true);
        record.cancelOwner = cancel;
        invocation.signal.addEventListener("abort", cancel, { once: true });
        if ("mainFrame" in owner) {
            const contents = owner as WebContents;
            record.removeOwnerListener = onWebContentsGone(contents, cancel);
        } else {
            const utility = owner as UtilityProcess;
            utility.once("exit", cancel);
            record.removeOwnerListener = () => utility.removeListener("exit", cancel);
        }
        let established = false;
        try {
            reauthorize();
            deliverConsumerPort(delivery, channelId, consumerPort);
            window.webContents.postMessage(OPEN_CHANNEL, { channelId, kind: method, open: request, epoch: this.epoch }, [audioPort]);
            await withAbort(ready, invocation.signal);
            reauthorize();
            established = true;
            return { channelId, onClose: (listener) => {
                if (record.closed) listener(); else record.listeners.add(listener);
                return () => record.listeners.delete(listener);
            } };
        } catch (error) {
            this.finishChannel(record, (error as { code?: string })?.code ?? "handler-closed", errMessage(error, "Audio channel failed to start."), true);
            throw error;
        } finally {
            if (!established) invocation.signal.removeEventListener("abort", cancel);
            if (!established) record.removeOwnerListener();
            clearTimeout(record.readyTimer);
            record.ports = [];
        }
    }

    private async openMuteChannel(
        bound: BoundCapability,
        argument: Record<string, unknown>,
        invocation: MainCapabilityInvocationContext,
        delivery: ChannelDelivery | undefined,
        reauthorize: () => void,
    ): Promise<{ channelId: string; onClose: (listener: () => void) => () => void }> {
        if (Object.keys(argument).length || !delivery) throw codedError("rejected", "muteApp takes no arguments.");
        this.authorize(bound);
        reauthorize();
        if (invocation.signal.aborted) throw codedError("cancelled");
        const channelId = crypto.randomUUID();
        const { port1: consumer, port2: port } = new MessageChannelMain();
        const listeners = new Set<() => void>();
        let closed = false;
        let release = (): void => undefined;
        const finish = (): void => {
            if (closed) return;
            closed = true;
            this.muteChannels.delete(finish);
            release();
            invocation.signal.removeEventListener("abort", finish);
            try { port.close(); } catch { /* Already closed. */ }
            for (const listener of listeners) listener();
            listeners.clear();
        };
        const channel = openElectronServiceChannel(port, "capability", finish);
        channel.onMessage((value) => {
            if ((value as { type?: unknown } | null)?.type !== "release") return;
            release();
            try { channel.send({ type: "released" }); } catch { /* Disconnected. */ }
            channel.close();
        });
        const board = "provider" in bound.caller ? capabilityRegistry.board(bound.caller.provider) : undefined;
        const label = (board?.boardName?.trim() || (board ? path.basename(board.boardRoot) : "Persephone")).slice(0, 100);
        this.muteChannels.add(finish);
        release = globalMuteService.acquire(label, () => {
            channel.close({ code: "overridden", message: "Mute was released." });
        });
        invocation.signal.addEventListener("abort", finish, { once: true });
        try {
            reauthorize();
            if (invocation.signal.aborted) throw codedError("cancelled");
            deliverConsumerPort(delivery, channelId, consumer);
            if (invocation.signal.aborted) throw codedError("cancelled");
            return { channelId, onClose: (listener) => {
                if (closed) listener(); else listeners.add(listener);
                return () => listeners.delete(listener);
            } };
        } catch (error) { finish(); try { consumer.close(); } catch { /* Transferred. */ } throw error; }
    }

    private validateCapture(argument: Record<string, unknown>): { source: "microphone" | "computer"; deviceId?: string; echoCancel?: boolean; processing?: "default" | "raw"; cancelComputerAudio?: boolean } {
        const keys = Object.keys(argument);
        if (keys.some((key) => !["source", "deviceId", "echoCancel", "processing", "cancelComputerAudio"].includes(key))) throw codedError("rejected", "Invalid audio capture options.");
        if (argument.source !== "microphone" && argument.source !== "computer") throw codedError("rejected", "Audio source must be microphone or computer.");
        if (argument.deviceId !== undefined && (typeof argument.deviceId !== "string" || !argument.deviceId.trim())) throw codedError("rejected", "Invalid audio device id.");
        if (argument.echoCancel !== undefined && typeof argument.echoCancel !== "boolean") throw codedError("rejected", "echoCancel must be a boolean.");
        if ("cancelComputerAudio" in argument && typeof argument.cancelComputerAudio !== "boolean") throw codedError("rejected", "cancelComputerAudio must be a boolean.");
        if (argument.processing !== undefined && argument.processing !== "default" && argument.processing !== "raw") throw codedError("rejected", "Invalid microphone processing mode.");
        if (argument.processing === "raw" && argument.echoCancel === true) throw codedError("rejected", "Raw capture cannot enable echo cancellation.");
        if (argument.processing === "raw" && "cancelComputerAudio" in argument) throw codedError("rejected", "Raw capture cannot request computer audio cancellation.");
        if (argument.source === "computer" && (argument.deviceId !== undefined || argument.echoCancel !== undefined || argument.processing !== undefined || "cancelComputerAudio" in argument)) throw codedError("rejected", "Computer capture does not accept microphone options.");
        if (argument.source === "computer" && process.platform !== "win32") throw codedError("no-handler", "Computer audio capture is supported on Windows only.");
        if (argument.cancelComputerAudio === true && process.platform !== "win32") throw codedError("no-handler", "Computer audio cancellation is supported on Windows only.");
        return { source: argument.source as "microphone" | "computer",
            ...(argument.deviceId !== undefined ? { deviceId: argument.deviceId as string } : {}),
            ...(argument.echoCancel !== undefined ? { echoCancel: argument.echoCancel as boolean } : {}),
            ...(argument.cancelComputerAudio !== undefined ? { cancelComputerAudio: argument.cancelComputerAudio as boolean } : {}),
            ...(argument.processing !== undefined ? { processing: argument.processing as "default" | "raw" } : {}) };
    }

    private validatePlayback(argument: Record<string, unknown>): { sampleRate: number } {
        if (Object.keys(argument).some((key) => key !== "sampleRate") || !Number.isFinite(argument.sampleRate)
            || !Number.isInteger(argument.sampleRate) || (argument.sampleRate as number) < 8000 || (argument.sampleRate as number) > 192000) {
            throw codedError("rejected", "Playback sampleRate must be an integer from 8000 through 192000 Hz.");
        }
        return { sampleRate: argument.sampleRate as number };
    }

    private authorize(bound: BoundCapability, source?: "microphone" | "computer"): void {
        if (bound.registration.id !== PLATFORM_AUDIO_CAPABILITY_ID || bound.registration.version !== 1 || bound.registration.origin !== "platform") throw codedError("permission-denied");
        if (bound.caller.kind === "agent") throw codedError("permission-denied");
        if (bound.caller.kind === "platform") return;
        if (!("provider" in bound.caller)) throw codedError("permission-denied");
        const board = capabilityRegistry.board(bound.caller.provider);
        if (!board || !board.uses?.some((use) => use.id === PLATFORM_AUDIO_CAPABILITY_ID && use.version === 1)
            || (bound.caller.kind === "board-service" && !board.canStartService)) throw codedError("permission-denied", "The board is not trusted for audio.");
        if (source === "microphone" && !BoardGrant.from(board.permissions).allows("microphone")) throw codedError("permission-denied", "Microphone permission is required.");
        if (source === "computer" && !BoardGrant.from(board.permissions).allows("computerAudio")) throw codedError("permission-denied", "Computer audio permission is required.");
    }

    private async ensureWindow(signal: AbortSignal): Promise<{ window: BrowserWindow; generation: number }> {
        if (this.window && !this.window.isDestroyed() && this.readyPromise) {
            await withAbort(this.readyPromise, signal);
            return { window: this.window, generation: this.generation };
        }
        const generation = ++this.generation;
        const epoch = ++this.epoch;
        const window = new BrowserWindow({
            show: false, width: 1, height: 1,
            webPreferences: { partition: appPartition, nodeIntegration: true, contextIsolation: false, sandbox: false, webviewTag: false, spellcheck: false, backgroundThrottling: false },
        });
        this.window = window;
        this.readyPromise = new Promise<void>((resolve, reject) => { this.readyResolve = resolve; this.startupReject = reject; });
        window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
        window.webContents.on("will-attach-webview", (event) => event.preventDefault());
        const url = typeof AUDIO_WINDOW_VITE_DEV_SERVER_URL === "string"
            ? new URL(AUDIO_WINDOW_VITE_DEV_SERVER_URL)
            : pathToFileURL(path.join(__dirname, "../renderer/main_window/audio.html"));
        url.searchParams.set("epoch", String(epoch));
        const target = url.href;
        window.webContents.on("will-navigate", (event, nextUrl) => { if (nextUrl !== target) event.preventDefault(); });
        window.webContents.on("will-redirect", (event, nextUrl) => { if (nextUrl !== target) event.preventDefault(); });
        window.webContents.once("render-process-gone", () => this.failWindow(generation, codedError("crashed", "The audio window crashed.")));
        window.once("closed", () => this.failWindow(generation, codedError("handler-closed", "The audio window closed.")));
        void window.loadURL(target).catch((error: unknown) => this.failWindow(generation, error));
        let startupTimer: ReturnType<typeof setTimeout> | undefined;
        const timeout = new Promise<never>((_resolve, reject) => {
            startupTimer = setTimeout(() => {
                const error = codedError("timeout", "The audio window did not become ready.");
                this.failWindow(generation, error);
                reject(error);
            }, 12000);
        });
        try {
            await withAbort(Promise.race([this.readyPromise, timeout]), signal);
        } finally { if (startupTimer) clearTimeout(startupTimer); }
        if (generation !== this.generation || window.isDestroyed()) throw codedError("cancelled");
        return { window, generation };
    }

    private failWindow(generation: number, error: unknown): void {
        if (generation !== this.generation) return;
        this.deviceRequests.failAll(error);
        this.startupReject?.(error);
        this.startupReject = undefined;
        for (const record of [...this.channels.values()]) this.finishChannel(record, "crashed", errMessage(error, "Audio window failed."), false);
        if (this.window && !this.window.isDestroyed()) this.window.destroy();
        this.window = undefined;
        this.readyPromise = undefined;
        setAudioCaptureCount(0);
        clearAudioCaptureGrants();
    }

    private finishChannel(record: ChannelRecord, code: string, message: string, notifyWindow: boolean): void {
        if (record.closed) return;
        record.closed = true;
        record.invocation.signal.removeEventListener("abort", record.cancelOwner);
        record.removeOwnerListener();
        clearTimeout(record.readyTimer);
        if (notifyWindow && this.window && !this.window.isDestroyed()) {
            try { this.window.webContents.send(CLOSE_CHANNEL, { channelId: record.id, code, message }); }
            catch { /* The window may be closing; its port will close with it. */ }
        }
        for (const port of record.ports) { try { port.close(); } catch { /* port may already be transferred */ } }
        this.channels.delete(record.id);
        for (const listener of record.listeners) listener();
        record.listeners.clear();
        record.readyReject(codedError(code, message));
        this.destroyIdleWindow();
    }

    private destroyIdleWindow(): void {
        if (this.channels.size || this.pendingOpens || !this.window || this.window.isDestroyed()) return;
        const window = this.window;
        this.window = undefined;
        this.readyPromise = undefined;
        this.readyResolve = undefined;
        this.startupReject = undefined;
        this.generation++;
        clearAudioCaptureGrants(window.webContents);
        window.destroy();
        setAudioCaptureCount(0);
    }

    dispose(): void {
        for (const close of [...this.muteChannels]) close();
        this.deviceRequests.failAll(codedError("handler-closed", "Audio service is shutting down."));
        for (const record of [...this.channels.values()]) this.finishChannel(record, "handler-closed", "Audio service is shutting down.", true);
        this.startupReject?.(codedError("handler-closed", "Audio service is shutting down."));
        this.generation++;
        const window = this.window;
        this.window = undefined;
        this.readyPromise = undefined;
        this.readyResolve = undefined;
        this.startupReject = undefined;
        if (window && !window.isDestroyed()) window.destroy();
        setAudioCaptureCount(0);
        clearAudioCaptureGrants();
    }
}

export const audioService = new AudioService();
