import { app, BrowserWindow, ipcMain, MessageChannelMain, type MessagePortMain, type UtilityProcess, type WebContents } from "electron";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { EventEndpoint } from "../ipc/api-types";
import { MAX_SERVICE_CHANNELS_PER_BOARD } from "../shared/capability-limits";
import { boardPermissionAllows } from "../shared/board-manifest-utils";
import { errMessage } from "../shared/utils";
import { appPartition } from "./constants";
import { capabilityRegistry } from "./capability-registry";
import type { BoundCapability, MainCapabilityInvocationContext } from "./capability-router";
import { armAudioMicrophoneGrant, armAudioLoopbackGrant, clearAudioCaptureGrants, setAudioWindowTargetResolver } from "./permission-policy-service";
import { setAudioCaptureCount } from "./audio-capture-state";

const CONTROL_CHANNEL = "persephone:audio-control";
const ARM_CHANNEL = "persephone:audio-arm-capture";
const CLEAR_CHANNEL = "persephone:audio-clear-capture";
const CLOSE_CHANNEL = "persephone:audio-close-channel";
const OPEN_CHANNEL = "persephone:audio-open-channel";
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

function capabilityError(code: string, message = code): Error { return Object.assign(new Error(message), { code }); }

function withAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        let settled = false;
        const finish = (error?: unknown, value?: T): void => {
            if (settled) return;
            settled = true;
            signal.removeEventListener("abort", abort);
            if (error !== undefined) reject(error); else resolve(value as T);
        };
        const abort = (): void => finish(signal.reason ?? capabilityError("cancelled"));
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
    private pendingOpens = 0;
    private initialized = false;

    initialize(): void {
        if (this.initialized) return;
        this.initialized = true;
        setAudioWindowTargetResolver(() => this.window && !this.window.isDestroyed() ? this.window.webContents : undefined);
        ipcMain.on(CONTROL_CHANNEL, (event, message: { type?: unknown; channelId?: unknown; epoch?: unknown; code?: unknown; message?: unknown; count?: unknown }) => {
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
        ipcMain.handle(ARM_CHANNEL, async (event, source: unknown) => {
            const window = this.window;
            if (!window || window.isDestroyed() || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame
                || (source !== "microphone" && source !== "computer")) throw capabilityError("permission-denied");
            if (source === "computer") armAudioLoopbackGrant(window.webContents);
            else armAudioMicrophoneGrant(window.webContents);
        });
        ipcMain.handle(CLEAR_CHANNEL, (event) => {
            const window = this.window;
            if (!window || window.isDestroyed() || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw capabilityError("permission-denied");
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

    async openCapabilityChannel(
        bound: BoundCapability,
        method: string,
        argument: Record<string, unknown>,
        invocation: MainCapabilityInvocationContext,
        delivery: { target: WebContents | UtilityProcess; requestId: string } | undefined,
        reauthorize: () => void,
    ): Promise<{ channelId: string; onClose: (listener: () => void) => () => void }> {
        if (method !== "capture" && method !== "play") throw capabilityError("no-handler", "Audio channel is unavailable.");
        if (!delivery) throw capabilityError("no-handler", "A capability channel consumer is required.");
        const request = method === "capture" ? this.validateCapture(argument) : this.validatePlayback(argument);
        const captureSource = method === "capture" ? (request as ReturnType<AudioService["validateCapture"]>).source : undefined;
        this.authorize(bound, captureSource);
        reauthorize();
        if (invocation.signal.aborted) throw capabilityError("cancelled");
        const owner = delivery.target;
        const callerKey = "provider" in bound.caller ? `${bound.caller.kind}:${bound.caller.provider}` : bound.caller.kind;
        if ([...this.channels.values()].filter((item) => {
            const itemCallerKey = "provider" in item.bound.caller ? `${item.bound.caller.kind}:${item.bound.caller.provider}` : item.bound.caller.kind;
            return item.owner === owner || itemCallerKey === callerKey;
        }).length >= MAX_SERVICE_CHANNELS_PER_BOARD) {
            throw capabilityError("busy", "The audio consumer has reached its channel limit.");
        }

        this.pendingOpens++;
        let openedWindow: { window: BrowserWindow; generation: number };
        try {
            openedWindow = await this.ensureWindow(invocation.signal);
            if (invocation.signal.aborted || openedWindow.window.isDestroyed() || openedWindow.generation !== this.generation) throw capabilityError("cancelled");
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
        let readyResolve!: () => void;
        let readyReject!: (error: unknown) => void;
        const ready = new Promise<void>((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
        const record: ChannelRecord = {
            id: channelId, bound, source: captureSource, method, owner, invocation, controller: invocation.controller,
            readyResolve, readyReject, ready, readyTimer: setTimeout(() => readyReject(capabilityError("handler-closed", "The audio window did not accept the channel.")), 12000),
            closed: false, listeners: new Set(), ports: [consumerPort, audioPort], cancelOwner: () => undefined, removeOwnerListener: () => undefined,
        };
        this.channels.set(channelId, record);
        this.pendingOpens--;
        const cancel = (): void => this.finishChannel(record, "cancelled", "Audio capture was cancelled.", true);
        record.cancelOwner = cancel;
        invocation.signal.addEventListener("abort", cancel, { once: true });
        if ("mainFrame" in owner) {
            const contents = owner as WebContents;
            contents.once("destroyed", cancel);
            contents.once("render-process-gone", cancel);
            contents.once("did-navigate", cancel);
            record.removeOwnerListener = () => {
                contents.removeListener("destroyed", cancel);
                contents.removeListener("render-process-gone", cancel);
                contents.removeListener("did-navigate", cancel);
            };
        } else {
            const utility = owner as UtilityProcess;
            utility.once("exit", cancel);
            record.removeOwnerListener = () => utility.removeListener("exit", cancel);
        }
        let established = false;
        try {
            reauthorize();
            if ("mainFrame" in delivery.target) {
                delivery.target.postMessage(EventEndpoint.eBoardServiceChannel, {
                    boardId: delivery.requestId.startsWith("board-frame:") ? delivery.requestId.slice(12) : `capability:${delivery.requestId}`,
                    channelId,
                }, [consumerPort]);
            } else {
                delivery.target.postMessage({ kind: "capability-client-port", requestId: delivery.requestId }, [consumerPort]);
            }
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

    private validateCapture(argument: Record<string, unknown>): { source: "microphone" | "computer"; deviceId?: string; echoCancel?: boolean } {
        const keys = Object.keys(argument);
        if (keys.some((key) => !["source", "deviceId", "echoCancel"].includes(key))) throw capabilityError("rejected", "Invalid audio capture options.");
        if (argument.source !== "microphone" && argument.source !== "computer") throw capabilityError("rejected", "Audio source must be microphone or computer.");
        if (argument.deviceId !== undefined && (typeof argument.deviceId !== "string" || !argument.deviceId.trim())) throw capabilityError("rejected", "Invalid audio device id.");
        if (argument.echoCancel !== undefined && typeof argument.echoCancel !== "boolean") throw capabilityError("rejected", "echoCancel must be a boolean.");
        if (argument.source === "computer" && (argument.deviceId !== undefined || argument.echoCancel !== undefined)) throw capabilityError("rejected", "Computer capture does not accept deviceId or echoCancel.");
        if (argument.source === "computer" && process.platform !== "win32") throw capabilityError("no-handler", "Computer audio capture is supported on Windows only.");
        return { source: argument.source as "microphone" | "computer",
            ...(argument.deviceId !== undefined ? { deviceId: argument.deviceId as string } : {}),
            ...(argument.echoCancel !== undefined ? { echoCancel: argument.echoCancel as boolean } : {}) };
    }

    private validatePlayback(argument: Record<string, unknown>): { sampleRate: number } {
        if (Object.keys(argument).some((key) => key !== "sampleRate") || !Number.isFinite(argument.sampleRate)
            || !Number.isInteger(argument.sampleRate) || (argument.sampleRate as number) < 8000 || (argument.sampleRate as number) > 192000) {
            throw capabilityError("rejected", "Playback sampleRate must be an integer from 8000 through 192000 Hz.");
        }
        return { sampleRate: argument.sampleRate as number };
    }

    private authorize(bound: BoundCapability, source?: "microphone" | "computer"): void {
        if (bound.registration.id !== "audio" || bound.registration.version !== 1 || bound.registration.origin !== "platform") throw capabilityError("permission-denied");
        if (bound.caller.kind === "agent") throw capabilityError("permission-denied");
        if (bound.caller.kind === "platform") return;
        if (!("provider" in bound.caller)) throw capabilityError("permission-denied");
        const board = capabilityRegistry.board(bound.caller.provider);
        if (!board || !board.uses?.some((use) => use.id === "audio" && use.version === 1)
            || (bound.caller.kind === "board-service" && !board.canStartService)) throw capabilityError("permission-denied", "The board is not trusted for audio.");
        if (source === "microphone" && !boardPermissionAllows(board.permissions, "microphone")) throw capabilityError("permission-denied", "Microphone permission is required.");
        if (source === "computer" && (board.permissions.kind !== "flags" || !boardPermissionAllows(board.permissions, "computerAudio"))) throw capabilityError("permission-denied", "Computer audio permission is required.");
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
        window.webContents.once("render-process-gone", () => this.failWindow(generation, capabilityError("crashed", "The audio window crashed.")));
        window.once("closed", () => this.failWindow(generation, capabilityError("handler-closed", "The audio window closed.")));
        void window.loadURL(target).catch((error: unknown) => this.failWindow(generation, error));
        let startupTimer: ReturnType<typeof setTimeout> | undefined;
        const timeout = new Promise<never>((_resolve, reject) => {
            startupTimer = setTimeout(() => {
                const error = capabilityError("timeout", "The audio window did not become ready.");
                this.failWindow(generation, error);
                reject(error);
            }, 12000);
        });
        try {
            await withAbort(Promise.race([this.readyPromise, timeout]), signal);
        } finally { if (startupTimer) clearTimeout(startupTimer); }
        if (generation !== this.generation || window.isDestroyed()) throw capabilityError("cancelled");
        return { window, generation };
    }

    private failWindow(generation: number, error: unknown): void {
        if (generation !== this.generation) return;
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
        record.readyReject(capabilityError(code, message));
        if (![...this.channels.values()].some((channel) => channel.method === "capture")) setAudioCaptureCount(0);
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
    }

    dispose(): void {
        for (const record of [...this.channels.values()]) this.finishChannel(record, "handler-closed", "Audio service is shutting down.", true);
        this.startupReject?.(capabilityError("handler-closed", "Audio service is shutting down."));
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
