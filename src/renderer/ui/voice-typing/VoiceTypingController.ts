import { errMessage } from "../../../shared/utils";
import { api } from "../../../ipc/renderer/api";
import {
    MAX_SERVICE_CHANNEL_IN_FLIGHT,
    MAX_SERVICE_CHANNEL_MESSAGE_BYTES,
    SERVICE_CHANNEL_ACK_BATCH,
    SERVICE_CHANNEL_ACK_DELAY_MS,
    SERVICE_CHANNEL_OPEN_TIMEOUT_MS,
} from "../../../ipc/module-service-channels";
import { EventEndpoint } from "../../../ipc/api-types";
import { settings } from "../../api/settings";
import { ui } from "../../api/ui";
import { t } from "../../../shared/i18n/t";
import { normalizeVoiceTypingShortcut } from "../../../shared/voice-typing-shortcut";
import rendererEvents from "../../../ipc/renderer/renderer-events";
import type { VoiceTypingOverlayState } from "./VoiceTypingOverlayView";

const VOICE_BOARD_PREFIX = "voice-typing:";
const MAX_AUDIO_MS = 300_000;
const AUDIO_CHUNK_SAMPLES = 3_200;
const AUDIO_SAMPLE_RATE = 16_000;
const WORKLET_SOURCE = `class VoiceTypingProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.flushRequested = false;
        this.port.onmessage = ({ data }) => { if (data?.type === "flush") this.flushRequested = true; };
    }
    process(inputs) {
        const channels = inputs[0];
        if (!channels || !channels.length) {
            if (this.flushRequested) { this.port.postMessage({ type: "flushed" }); return false; }
            return true;
        }
        const mono = new Float32Array(channels[0].length);
        let energy = 0;
        for (let i = 0; i < mono.length; i++) {
            let sum = 0;
            for (const channel of channels) sum += channel[i] || 0;
            mono[i] = sum / channels.length;
            energy += mono[i] * mono[i];
        }
        this.port.postMessage({ type: "level", value: Math.sqrt(energy / Math.max(1, mono.length)) });
        this.port.postMessage({ type: "samples", data: mono }, [mono.buffer]);
        if (this.flushRequested) { this.port.postMessage({ type: "flushed" }); return false; }
        return true;
    }
}
registerProcessor("voice-typing-capture", VoiceTypingProcessor);`;

interface VoiceServiceChannel {
    readonly writable: boolean;
    send(message: unknown): void;
    onMessage(callback: (message: unknown) => void): () => void;
    onClose(callback: (reason: { code: string; message: string }) => void): () => void;
    close(reason?: { code: string; message: string }): void;
    whenWritable(): Promise<void>;
}

interface VoiceSession {
    id: string;
    cancelled: boolean;
    stopRequested: boolean;
    channel?: VoiceServiceChannel;
    capture?: AudioCapture;
    /** Set once the provider accepted the channel; audio captured before then waits in capture.pending. */
    channelReady?: boolean;
    accepted?: { resolve: () => void; reject: (error: Error) => void };
    finished: boolean;
    resultReceived?: boolean;
}

interface AudioCapture {
    stream: MediaStream;
    context: AudioContext;
    source: MediaStreamAudioSourceNode;
    node: AudioWorkletNode;
    mute: GainNode;
    sourceSamples: Float32Array;
    sourceBase: number;
    nextSource: number;
    pending: number[];
    sentSamples: number;
    sendQueue: Promise<void>;
    startedAt: number;
    stopped: boolean;
    flushResolve?: () => void;
}

function createVoiceServiceChannel(port: MessagePort): VoiceServiceChannel {
    const messageHandlers = new Set<(message: unknown) => void>();
    const closeHandlers = new Set<(reason: { code: string; message: string }) => void>();
    const writableWaiters = new Set<{ resolve: () => void; reject: (error: Error) => void }>();
    let closed = false;
    let closeReason = { code: "service-exited", message: "The service channel disconnected." };
    let sent = 0;
    let acknowledged = 0;
    let received = 0;
    let acknowledgedReceived = 0;
    let ackQueued = false;

    const finish = (reason: { code: string; message: string }): void => {
        if (closed) return;
        closed = true;
        closeReason = reason;
        try { port.close(); } catch { /* already closed */ }
        for (const waiter of writableWaiters) waiter.reject(Object.assign(new Error(reason.message), { code: reason.code }));
        writableWaiters.clear();
        for (const handler of closeHandlers) handler(reason);
        closeHandlers.clear();
        messageHandlers.clear();
    };

    port.onmessage = (event: MessageEvent<{ kind?: string; sequence?: number; value?: unknown; reason?: { code: string; message: string } }>): void => {
        const value = event.data;
        if (!value) return;
        if (value.kind === "ack" && Number.isSafeInteger(value.sequence)) {
            acknowledged = Math.max(acknowledged, Math.min(value.sequence, sent));
            for (const waiter of writableWaiters) waiter.resolve();
            writableWaiters.clear();
        } else if (value.kind === "data" && value.sequence === received + 1) {
            received = value.sequence;
            for (const handler of messageHandlers) handler(value.value);
            if (received - acknowledgedReceived >= SERVICE_CHANNEL_ACK_BATCH) {
                acknowledgedReceived = received;
                port.postMessage({ kind: "ack", sequence: acknowledgedReceived });
            } else if (!ackQueued) {
                ackQueued = true;
                setTimeout(() => {
                    ackQueued = false;
                    if (!closed && received > acknowledgedReceived) {
                        acknowledgedReceived = received;
                        port.postMessage({ kind: "ack", sequence: acknowledgedReceived });
                    }
                }, SERVICE_CHANNEL_ACK_DELAY_MS);
            }
        } else if (value.kind === "close") finish(value.reason ?? { code: "service-exited", message: "The service channel closed." });
    };
    port.onmessageerror = (): void => finish({ code: "service-exited", message: "The service channel received an invalid message." });
    port.start();

    return {
        get writable() { return !closed && sent - acknowledged < MAX_SERVICE_CHANNEL_IN_FLIGHT; },
        send(message) {
            if (closed) throw Object.assign(new Error(closeReason.message), { code: closeReason.code });
            if (sent - acknowledged >= MAX_SERVICE_CHANNEL_IN_FLIGHT) throw Object.assign(new Error("Service channel send window is full."), { code: "channel-backpressure" });
            if (message && typeof message === "object" && "data" in message && (message as { data?: unknown }).data instanceof ArrayBuffer
                && (message as { data: ArrayBuffer }).data.byteLength > MAX_SERVICE_CHANNEL_MESSAGE_BYTES) {
                throw Object.assign(new Error("Service channel message exceeds 1 MiB."), { code: "channel-message-too-large" });
            }
            const sequence = ++sent;
            port.postMessage({ kind: "data", sequence, value: message });
        },
        onMessage(callback) { messageHandlers.add(callback); return () => messageHandlers.delete(callback); },
        onClose(callback) { if (closed) callback(closeReason); else closeHandlers.add(callback); return () => closeHandlers.delete(callback); },
        close(reason = { code: "channel-closed", message: "Voice typing closed the channel." }) {
            if (closed) return;
            try { port.postMessage({ kind: "close", reason }); } catch { /* disconnected */ }
            finish(reason);
        },
        whenWritable() {
            if (closed) return Promise.reject(Object.assign(new Error(closeReason.message), { code: closeReason.code }));
            if (sent - acknowledged < MAX_SERVICE_CHANNEL_IN_FLIGHT) return Promise.resolve();
            return new Promise<void>((resolve, reject) => writableWaiters.add({ resolve, reject }));
        },
    };
}

export class VoiceTypingController {
    private session: VoiceSession | undefined;
    private shortcut = "Alt+V";
    private level = 0;
    private timer: ReturnType<typeof setInterval> | undefined;
    private boardChannelSubscription: (() => void) | undefined;
    private shortcutSubscription: (() => void) | undefined;
    private settingsSubscription: (() => void) | undefined;
    private readonly pendingPorts = new Map<string, MessagePort>();
    private readonly portWaiters = new Map<string, (port: MessagePort) => void>();
    private readonly onState: (state: VoiceTypingOverlayState) => void;

    public constructor(onState: (state: VoiceTypingOverlayState) => void) {
        this.onState = onState;
    }

    public start(): void {
        this.boardChannelSubscription = api.onBoardServiceChannel((boardId, channelId, port) => {
            // Every board's channel arrives on this event too; those ports belong to their board views.
            if (!boardId.startsWith(VOICE_BOARD_PREFIX)) return;
            const waiter = this.portWaiters.get(channelId);
            if (waiter) { this.portWaiters.delete(channelId); waiter(port); }
            else this.pendingPorts.set(channelId, port);
        });
        this.shortcutSubscription = rendererEvents[EventEndpoint.eVoiceTypingShortcut].subscribe((event) => {
            if (event.action === "start") this.startSession(event.sessionId);
            else if (event.action === "stop") this.stopSession(event.sessionId);
            else this.cancelSession(event.sessionId);
        });
        this.settingsSubscription = settings.onChanged.subscribe(({ key }) => {
            if (key === "voice-typing.shortcut") this.sendShortcutConfig();
        });
        void api.setVoiceTypingState({ state: "idle" }).catch((error: unknown) => {
            ui.notify(errMessage(error, t("voiceTyping.failed")), "error");
        });
        void settings.wait().then(() => this.sendShortcutConfig()).catch((error: unknown) => {
            ui.notify(errMessage(error, t("voiceTyping.failed")), "error");
        });
    }

    public dispose(): void {
        this.boardChannelSubscription?.();
        this.shortcutSubscription?.();
        this.settingsSubscription?.();
        this.boardChannelSubscription = undefined;
        this.shortcutSubscription = undefined;
        this.settingsSubscription = undefined;
        if (this.timer) clearInterval(this.timer);
        this.timer = undefined;
        for (const port of this.pendingPorts.values()) port.close();
        this.pendingPorts.clear();
        this.portWaiters.clear();
        const session = this.session;
        if (session) void this.cancelSession(session.id);
    }

    private async sendShortcutConfig(): Promise<void> {
        this.shortcut = normalizeVoiceTypingShortcut(settings.get("voice-typing.shortcut")) ?? "Alt+V";
        try { await api.setVoiceTypingConfig({ shortcut: this.shortcut }); }
        catch (error: unknown) { ui.notify(errMessage(error, t("voiceTyping.failed")), "error"); }
    }

    private startSession(sessionId: string): void {
        if (this.session) void this.cancelSession(this.session.id);
        const session: VoiceSession = { id: sessionId, cancelled: false, stopRequested: false, finished: false };
        this.session = session;
        this.level = 0;
        this.changeState("starting", 0);
        this.timer = setInterval(() => {
            const capture = session.capture;
            const status = session.finished ? "idle" : session.stopRequested ? "transcribing" : capture ? "recording" : "starting";
            this.onState({ status, binding: this.shortcut, level: this.level, durationMs: capture ? Date.now() - capture.startedAt : 0 });
        }, 150);
        void this.openProviderAndCapture(session);
    }

    private async openProviderAndCapture(session: VoiceSession): Promise<void> {
        // The microphone opens in parallel with the provider channel and buffers until the channel is accepted,
        // so speech that starts right after the shortcut is not lost while the board service connects.
        const microphone = this.openMicrophone(session);
        try {
            const [, capture] = await Promise.all([this.openChannel(session), microphone]);
            if (session.cancelled || this.session !== session) return;
            session.channelReady = true;
            if (capture) this.drainPending(capture);
            if (session.stopRequested) await this.endChannel(session);
        } catch (error: unknown) {
            void microphone.then((capture) => capture && this.stopCapture(capture)).catch(() => {});
            session.capture?.stream.getTracks().forEach((track) => track.stop());
            if (session.cancelled || this.session !== session) return;
            const code = this.errorCode(error);
            this.showError(code, error);
            await this.finishSession(session);
        }
    }

    private async openChannel(session: VoiceSession): Promise<void> {
        const providers = await api.getBoardServiceProviders("speech.transcribe");
        if (session.cancelled || this.session !== session) return;
        const provider = providers.find((item) => item.version === 1);
        if (!provider) throw Object.assign(new Error(t("voiceTyping.missingProvider")), { code: "missing-provider" });

        const opened = this.waitForChannel(session);
        const channelId = await api.connectHostServiceChannel({
            provider: provider.provider,
            version: 1,
            openMessage: { type: "transcribe", format: { encoding: "pcm-s16le", sampleRate: AUDIO_SAMPLE_RATE, channels: 1 } },
        });
        const port = await this.waitForPort(channelId);
        this.pendingPorts.delete(channelId);
        session.channel = createVoiceServiceChannel(port);
        this.observeChannel(session);
        await opened;
    }

    /** Resolves with the live capture, or undefined when the session ended before the microphone opened. */
    private async openMicrophone(session: VoiceSession): Promise<AudioCapture | undefined> {
        let stream: MediaStream | undefined;
        try {
            await api.armVoiceTypingMicrophone();
            try {
                stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
            } finally {
                await api.clearVoiceTypingMicrophone().catch(() => {});
            }
            if (session.cancelled || session.finished || this.session !== session || session.stopRequested) {
                stream.getTracks().forEach((track) => track.stop());
                return undefined;
            }
            session.capture = await this.startCapture(stream, session);
            if (session.cancelled || session.finished || this.session !== session) {
                await this.stopCapture(session.capture);
                return undefined;
            }
            if (!session.stopRequested) this.changeState("recording", 0);
            return session.capture;
        } catch (error: unknown) {
            await api.clearVoiceTypingMicrophone().catch(() => {});
            stream?.getTracks().forEach((track) => track.stop());
            throw error;
        }
    }

    private drainPending(capture: AudioCapture): void {
        while (capture.pending.length >= AUDIO_CHUNK_SAMPLES) this.queuePcm(capture, capture.pending.splice(0, AUDIO_CHUNK_SAMPLES));
    }

    private waitForChannel(session: VoiceSession): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            session.accepted = { resolve, reject };
        });
    }

    private waitForPort(channelId: string): Promise<MessagePort> {
        const pending = this.pendingPorts.get(channelId);
        if (pending) {
            this.pendingPorts.delete(channelId);
            return Promise.resolve(pending);
        }
        return new Promise<MessagePort>((resolve, reject) => {
            const timer = setTimeout(() => {
                this.portWaiters.delete(channelId);
                reject(new Error("The provider channel did not reach the app window."));
            }, SERVICE_CHANNEL_OPEN_TIMEOUT_MS);
            this.portWaiters.set(channelId, (port) => { clearTimeout(timer); resolve(port); });
        });
    }

    private observeChannel(session: VoiceSession): void {
        const channel = session.channel;
        if (!channel) return;
        channel.onMessage((message) => {
            if (!message || typeof message !== "object") return;
            const value = message as { type?: unknown; state?: unknown; code?: unknown; message?: unknown; text?: unknown };
            if (value.type === "status") {
                if (value.state === "listening") session.accepted?.resolve();
                if (value.state === "transcribing") this.changeState("transcribing", this.captureDuration(session));
            } else if (value.type === "result" && typeof value.text === "string") {
                session.resultReceived = true;
                void this.insertResult(session, value.text);
            } else if (value.type === "error") {
                const error = Object.assign(new Error(typeof value.message === "string" ? value.message : ""), { code: value.code });
                session.accepted?.reject(error);
                if (value.code === "cancelled" && session.cancelled) return;
                this.showError(typeof value.code === "string" ? value.code : "failed", error);
                void this.finishSession(session);
            }
        });
        channel.onClose((reason) => {
            if (!session.accepted) return;
            const error = Object.assign(new Error(reason.message), { code: reason.code });
            session.accepted.reject(error);
            if (!session.finished && !session.cancelled && !session.resultReceived) {
                this.showError(reason.code, error);
                void this.finishSession(session);
            }
        });
    }

    private async startCapture(stream: MediaStream, session: VoiceSession): Promise<AudioCapture> {
        let context: AudioContext | undefined;
        try {
            context = new AudioContext({ sampleRate: AUDIO_SAMPLE_RATE });
            const moduleUrl = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: "text/javascript" }));
            try { await context.audioWorklet.addModule(moduleUrl); }
            finally { URL.revokeObjectURL(moduleUrl); }
        } catch {
            await context?.close().catch(() => {});
            context = new AudioContext();
            const moduleUrl = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: "text/javascript" }));
            try { await context.audioWorklet.addModule(moduleUrl); }
            catch (error: unknown) {
                await context.close().catch(() => {});
                throw error;
            } finally { URL.revokeObjectURL(moduleUrl); }
        }
        const source = context.createMediaStreamSource(stream);
        const node = new AudioWorkletNode(context, "voice-typing-capture", { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
        const mute = context.createGain();
        mute.gain.value = 0;
        source.connect(node);
        node.connect(mute);
        mute.connect(context.destination);
        const capture: AudioCapture = {
            stream, context, source, node, mute,
            sourceSamples: new Float32Array(0),
            sourceBase: 0,
            nextSource: 0,
            pending: [],
            sentSamples: 0,
            sendQueue: Promise.resolve(),
            startedAt: Date.now(),
            stopped: false,
        };
        node.port.onmessage = ({ data }: MessageEvent<{ type: string; value?: number; data?: Float32Array }>): void => {
            if (data.type === "flushed") {
                capture.flushResolve?.();
                capture.flushResolve = undefined;
                return;
            }
            if (data.type === "level" && typeof data.value === "number") {
                this.level = data.value;
                if (session.stopRequested) return;
                this.onState({ status: "recording", binding: this.shortcut, level: this.level, durationMs: Date.now() - capture.startedAt });
            } else if (data.type === "samples" && data.data && !capture.stopped) {
                this.consumeSamples(capture, data.data, session);
            }
        };
        return capture;
    }

    private consumeSamples(capture: AudioCapture, samples: Float32Array, session: VoiceSession): void {
        const ratio = capture.context.sampleRate / AUDIO_SAMPLE_RATE;
        const merged = new Float32Array(capture.sourceSamples.length + samples.length);
        merged.set(capture.sourceSamples);
        merged.set(samples, capture.sourceSamples.length);
        capture.sourceSamples = merged;
        const end = capture.sourceBase + merged.length;
        const output: number[] = [];
        while (capture.nextSource + 1 < end) {
            const left = Math.floor(capture.nextSource);
            const fraction = capture.nextSource - left;
            const offset = left - capture.sourceBase;
            output.push(merged[offset] * (1 - fraction) + merged[offset + 1] * fraction);
            capture.nextSource += ratio;
        }
        const discard = Math.max(0, Math.floor(capture.nextSource) - capture.sourceBase);
        if (discard) {
            capture.sourceSamples = merged.slice(discard);
            capture.sourceBase += discard;
        }
        capture.sentSamples += output.length;
        if ((capture.sentSamples / AUDIO_SAMPLE_RATE) * 1000 > MAX_AUDIO_MS) {
            void this.cancelSession(session.id, "too-long");
            return;
        }
        capture.pending.push(...output);
        if (session.channelReady) this.drainPending(capture);
    }

    private queuePcm(capture: AudioCapture, samples: number[]): void {
        if (!samples.length || !this.session?.channel) return;
        const buffer = new ArrayBuffer(samples.length * 2);
        const view = new DataView(buffer);
        for (let index = 0; index < samples.length; index++) {
            const sample = Math.max(-1, Math.min(1, samples[index]));
            view.setInt16(index * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
        }
        const channel = this.session.channel;
        capture.sendQueue = capture.sendQueue.then(async () => {
            if (!channel.writable) await channel.whenWritable();
            channel.send({ type: "audio", data: buffer });
        });
    }

    private stopSession(sessionId: string): void {
        const session = this.session;
        if (!session || session.id !== sessionId || session.finished) return;
        session.stopRequested = true;
        const duration = this.captureDuration(session);
        this.changeState("transcribing", duration);
        if (session.capture && session.channelReady) void this.endChannel(session);
    }

    private async endChannel(session: VoiceSession): Promise<void> {
        if (session.finished || session.cancelled) return;
        const capture = session.capture;
        if (capture) {
            await this.flushCapture(capture);
            if (session.cancelled || session.finished) return;
            capture.stopped = true;
            capture.stream.getTracks().forEach((track) => track.stop());
            if (capture.sourceSamples.length && capture.nextSource < capture.sourceBase + capture.sourceSamples.length) {
                capture.pending.push(capture.sourceSamples[capture.sourceSamples.length - 1] || 0);
                capture.sentSamples++;
            }
            this.queuePcm(capture, capture.pending.splice(0));
            await this.stopCapture(capture);
        }
        if (session.cancelled || session.finished) return;
        try {
            await capture?.sendQueue;
            session.channel?.send({ type: "end" });
            this.changeState("transcribing", this.captureDuration(session));
        } catch (error: unknown) {
            this.showError(this.errorCode(error), error);
            await this.finishSession(session);
        }
    }

    private async stopCapture(capture: AudioCapture): Promise<void> {
        capture.stopped = true;
        try { capture.node.port.close(); } catch { /* already closed */ }
        capture.source.disconnect();
        capture.node.disconnect();
        capture.mute.disconnect();
        capture.stream.getTracks().forEach((track) => track.stop());
        await capture.context.close().catch(() => {});
    }

    private async flushCapture(capture: AudioCapture): Promise<void> {
        await new Promise<void>((resolve) => {
            let settled = false;
            const finish = (): void => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                capture.flushResolve = undefined;
                resolve();
            };
            const timer = setTimeout(finish, 120);
            capture.flushResolve = finish;
            try { capture.node.port.postMessage({ type: "flush" }); }
            catch { finish(); }
        });
    }

    private async cancelSession(sessionId: string, reason = "cancelled"): Promise<void> {
        const session = this.session;
        if (!session || session.id !== sessionId || session.finished) return;
        session.cancelled = true;
        if (reason === "too-long") this.showError(reason);
        try { session.channel?.send({ type: "cancel" }); } catch { /* channel may already be closed */ }
        session.channel?.close({ code: reason, message: t(reason === "too-long" ? "voiceTyping.tooLong" : "voiceTyping.cancelled") });
        await this.finishSession(session);
    }

    private async insertResult(session: VoiceSession, text: string): Promise<void> {
        if (session.finished || session.cancelled || this.session !== session) return;
        // Whisper pads its output with a leading space and a trailing line break.
        text = text.trim();
        if (!text) { await this.finishSession(session); return; }
        try {
            const result = await api.insertVoiceTypingText({ sessionId: session.id, text });
            if (result.copied) ui.notify(t("voiceTyping.copied"), "info");
            await this.finishSession(session);
        } catch (error: unknown) {
            this.showError(this.errorCode(error), error);
            await this.finishSession(session);
        }
    }

    private async finishSession(session: VoiceSession): Promise<void> {
        if (session.finished) return;
        session.finished = true;
        session.capture && await this.stopCapture(session.capture);
        session.channel?.close();
        await api.clearVoiceTypingMicrophone().catch(() => {});
        if (this.timer) clearInterval(this.timer);
        this.timer = undefined;
        if (this.session === session) this.session = undefined;
        this.level = 0;
        this.changeState("idle", 0);
    }

    private changeState(state: VoiceTypingOverlayState["status"], durationMs: number): void {
        this.onState({ status: state, binding: this.shortcut, level: this.level, durationMs });
        // The main process only distinguishes idle, recording, and transcribing; starting is part of recording.
        void api.setVoiceTypingState({ state: state === "starting" ? "recording" : state }).catch((error: unknown) => {
            ui.notify(errMessage(error, t("voiceTyping.failed")), "error");
        });
    }

    private captureDuration(session: VoiceSession): number {
        const capture = session.capture;
        return capture ? Date.now() - capture.startedAt : 0;
    }

    private errorCode(error: unknown): string {
        if (error && typeof error === "object" && "code" in error && typeof error.code === "string") return error.code;
        if (error && typeof error === "object" && "name" in error && typeof error.name === "string") return error.name;
        return "failed";
    }

    private showError(code: string, error?: unknown): void {
        const key = code === "missing-provider" ? "voiceTyping.missingProvider"
            : code === "not-ready" ? "voiceTyping.notReady"
                : code === "connection-refused" ? "voiceTyping.providerRefused"
                    : code === "NotAllowedError" || code === "permission-denied" ? "voiceTyping.permissionDenied"
                        : code === "too-long" ? "voiceTyping.tooLong"
                            : "voiceTyping.failed";
        const detail = error ? errMessage(error, "") : "";
        ui.notify(detail && key === "voiceTyping.failed" ? `${t(key)} ${detail}` : t(key), "warning");
    }
}
