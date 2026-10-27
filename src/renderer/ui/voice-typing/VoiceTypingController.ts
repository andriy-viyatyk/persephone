import { errMessage } from "../../../shared/utils";
import { api } from "../../../ipc/renderer/api";
import { SERVICE_CHANNEL_OPEN_TIMEOUT_MS } from "../../../ipc/module-service-channels";
import { EventEndpoint } from "../../../ipc/api-types";
import { settings } from "../../api/settings";
import { ui } from "../../api/ui";
import { t } from "../../../shared/i18n/t";
import { normalizeVoiceTypingShortcut } from "../../../shared/voice-typing-shortcut";
import { toClipboard } from "../../core/utils/utils";
import rendererEvents from "../../../ipc/renderer/renderer-events";
import type { VoiceTypingOverlayState } from "./VoiceTypingOverlayView";
import { liveSpeechSessionCoordinator } from "../speech/LiveSpeechSessionCoordinator";
import { SpeechTranscriptionProvider } from "../speech/SpeechTranscriptionProvider";
import { createSpeechServiceChannel, type SpeechServiceChannel } from "../speech/SpeechServiceChannel";
import { PcmAudioCapture } from "../speech/PcmAudioCapture";

const VOICE_BOARD_PREFIX = "voice-typing:";
const MAX_AUDIO_MS = 300_000;
const AUDIO_SAMPLE_RATE = 16_000;

interface VoiceSession {
    id: string;
    cancelled: boolean;
    stopRequested: boolean;
    channel?: SpeechServiceChannel;
    capture?: AudioCapture;
    /** Set once the provider accepted the channel; audio captured before then waits in capture.pending. */
    channelReady?: boolean;
    accepted?: { resolve: () => void; reject: (error: Error) => void };
    finished: boolean;
    resultReceived?: boolean;
    live?: boolean;
    insertionQueue: Promise<void>;
    insertedSegments: string[];
    bufferedSegments: string[];
    clipboardFallback: boolean;
    draftUtterances: Set<string>;
    draft?: string;
    draftUtterance?: string;
    acousticLevels: Array<{ startMs: number; endMs: number; value: number }>;
    speechLevels: number[];
    quietThreshold?: number;
    segmentCount: number;
    levelDurationMs: number;
    quietSince?: number;
    releaseLease?: () => void;
}

interface AudioCapture {
    pipeline: PcmAudioCapture;
    pending: ArrayBuffer[];
    sentSamples: number;
    sendQueue: Promise<void>;
    startedAt: number;
    stopped: boolean;
    levelDurationMs: number;
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
    private providerDiscovery: SpeechTranscriptionProvider | undefined;
    private readonly portWaiters = new Map<string, (port: MessagePort) => void>();
    private readonly onState: (state: VoiceTypingOverlayState) => void;

    public constructor(onState: (state: VoiceTypingOverlayState) => void) {
        this.onState = onState;
    }

    public start(): void {
        this.providerDiscovery = new SpeechTranscriptionProvider();
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
        this.providerDiscovery?.dispose();
        this.providerDiscovery = undefined;
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
        if (this.session) return;
        const releaseLease = liveSpeechSessionCoordinator.acquire("voice-typing");
        if (!releaseLease) {
            ui.notify(t("voiceTyping.sessionConflict"), "warning");
            return;
        }
        const session: VoiceSession = {
            id: sessionId, cancelled: false, stopRequested: false, finished: false,
            insertionQueue: Promise.resolve(), insertedSegments: [], bufferedSegments: [], clipboardFallback: false,
            draftUtterances: new Set(), acousticLevels: [], speechLevels: [], segmentCount: 0, levelDurationMs: 0,
        };
        session.releaseLease = releaseLease;
        this.session = session;
        this.level = 0;
        this.changeState("starting", 0);
        this.timer = setInterval(() => {
            const capture = session.capture;
            const status = session.finished ? "idle" : session.stopRequested ? "transcribing" : capture ? "recording" : "starting";
            this.publishState(session, status, capture ? Date.now() - capture.startedAt : 0);
            this.checkAutoStop(session);
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
            if (session.capture) await this.stopCapture(session.capture);
            if (session.cancelled || this.session !== session) return;
            const code = this.errorCode(error);
            this.showError(code, error);
            await this.finishSession(session);
        }
    }

    private async openChannel(session: VoiceSession): Promise<void> {
        const providers = await this.providerDiscovery?.list() ?? [];
        if (session.cancelled || this.session !== session) return;
        const provider = providers.find((item) => item.version === 1);
        if (!provider) throw Object.assign(new Error(t("voiceTyping.missingProvider")), { code: "missing-provider" });
        const liveSupport = await this.providerDiscovery?.supportsLive(provider).catch((): undefined => undefined);
        const live = liveSupport ?? false;
        if (session.cancelled || this.session !== session) return;

        const opened = this.waitForChannel(session);
        const channelId = await api.connectHostServiceChannel({
            provider: provider.provider,
            version: 1,
            openMessage: { type: "transcribe", format: { encoding: "pcm-s16le", sampleRate: AUDIO_SAMPLE_RATE, channels: 1 }, ...(live ? { live: true } : {}) },
        });
        const port = await this.waitForPort(channelId);
        this.pendingPorts.delete(channelId);
        session.channel = createSpeechServiceChannel(port);
        session.live = live;
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
        while (capture.pending.length) this.queuePcm(capture, capture.pending.shift()!);
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
            const value = message as { type?: unknown; state?: unknown; code?: unknown; message?: unknown; text?: unknown; utterance?: unknown; startMs?: unknown; endMs?: unknown };
            if (value.type === "status") {
                if (value.state === "listening") session.accepted?.resolve();
                if (value.state === "transcribing") this.changeState("transcribing", this.captureDuration(session));
            } else if (value.type === "draft" && typeof value.text === "string") {
                if (!session.live) return;
                const utterance = this.utteranceId(value.utterance);
                if (utterance !== undefined && !session.finished && !session.cancelled) {
                    session.draftUtterances.add(utterance);
                    session.draftUtterance = utterance;
                    session.draft = value.text.length > 80 ? `…${value.text.slice(-79)}` : value.text;
                    this.publishState(session, session.stopRequested ? "transcribing" : "recording", this.captureDuration(session));
                }
            } else if (value.type === "segment" && typeof value.text === "string") {
                if (!session.live) return;
                const utterance = this.utteranceId(value.utterance);
                if (utterance !== undefined) {
                    session.draftUtterances.delete(utterance);
                    if (session.draftUtterance === utterance) {
                        session.draftUtterance = undefined;
                        session.draft = undefined;
                    }
                }
                if (typeof value.startMs === "number" && typeof value.endMs === "number") {
                    this.recordSpeechBaseline(session, value.startMs, value.endMs);
                }
                this.publishState(session, session.stopRequested ? "transcribing" : "recording", this.captureDuration(session));
                this.queueSegment(session, value.text);
            } else if (value.type === "result" && typeof value.text === "string") {
                session.resultReceived = true;
                this.clearDraft(session);
                void this.finishLiveResult(session, value.text);
            } else if (value.type === "error") {
                const error = Object.assign(new Error(typeof value.message === "string" ? value.message : ""), { code: value.code });
                session.accepted?.reject(error);
                if (value.code === "cancelled" && session.cancelled) return;
                this.showError(typeof value.code === "string" ? value.code : "failed", error);
                this.clearDraft(session);
                void session.insertionQueue.then(() => this.finishSession(session));
            }
        });
        channel.onClose((reason) => {
            if (!session.accepted) return;
            const error = Object.assign(new Error(reason.message), { code: reason.code });
            session.accepted.reject(error);
            if (!session.finished && !session.cancelled && !session.resultReceived) {
                this.showError(reason.code, error);
                this.clearDraft(session);
                void session.insertionQueue.then(() => this.finishSession(session));
            }
        });
    }

    private async startCapture(stream: MediaStream, session: VoiceSession): Promise<AudioCapture> {
        const capture: AudioCapture = {
            pipeline: new PcmAudioCapture(),
            pending: [],
            sentSamples: 0,
            sendQueue: Promise.resolve(),
            startedAt: Date.now(),
            stopped: false,
            levelDurationMs: 0,
        };
        try {
            await capture.pipeline.start(stream, (buffer) => {
                capture.sentSamples += buffer.byteLength / 2;
                if ((capture.sentSamples / AUDIO_SAMPLE_RATE) * 1000 > MAX_AUDIO_MS) {
                    void this.cancelSession(session.id, "too-long");
                    return;
                }
                capture.pending.push(buffer);
                if (session.channelReady) this.drainPending(capture);
            }, (level, durationMs) => {
                this.level = level;
                const startMs = capture.levelDurationMs;
                capture.levelDurationMs += durationMs;
                session.levelDurationMs = capture.levelDurationMs;
                session.acousticLevels.push({ startMs, endMs: capture.levelDurationMs, value: level });
                if (session.acousticLevels.length > 30_000) session.acousticLevels.splice(0, 10_000);
                if (session.stopRequested) return;
                this.publishState(session, "recording", Date.now() - capture.startedAt);
            });
            return capture;
        } catch (error: unknown) {
            stream.getTracks().forEach((track) => track.stop());
            await capture.pipeline.stop();
            throw error;
        }
    }

    private queuePcm(capture: AudioCapture, buffer: ArrayBuffer): void {
        if (!buffer.byteLength || !this.session?.channel) return;
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
            await capture.pipeline.flush();
            if (session.cancelled || session.finished) return;
            capture.stopped = true;
            this.drainPending(capture);
            await capture.sendQueue;
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
        await capture.pipeline.stop();
    }

    private async cancelSession(sessionId: string, reason = "cancelled"): Promise<void> {
        const session = this.session;
        if (!session || session.id !== sessionId || session.finished) return;
        session.cancelled = true;
        this.clearDraft(session);
        if (reason === "too-long") this.showError(reason);
        try { session.channel?.send({ type: "cancel" }); } catch { /* channel may already be closed */ }
        session.channel?.close({ code: reason, message: t(reason === "too-long" ? "voiceTyping.tooLong" : "voiceTyping.cancelled") });
        await this.finishSession(session);
    }

    private queueSegment(session: VoiceSession, rawText: string): void {
        const text = rawText.trim();
        if (!text || session.finished || session.cancelled) return;
        session.segmentCount++;
        session.insertionQueue = session.insertionQueue.then(async () => {
            if (session.finished || session.cancelled) return;
            if (session.clipboardFallback) {
                session.bufferedSegments.push(text);
                return;
            }
            try {
                const result = await api.insertVoiceTypingText({ sessionId: session.id, text, deferClipboard: true });
                if (result.copied) {
                    session.clipboardFallback = true;
                    session.bufferedSegments.push(text);
                } else {
                    session.insertedSegments.push(text);
                }
            } catch (error: unknown) {
                this.showError(this.errorCode(error), error);
                session.clipboardFallback = true;
                session.bufferedSegments.push(text);
            }
        });
    }

    private async finishLiveResult(session: VoiceSession, text: string): Promise<void> {
        if (session.finished || session.cancelled || this.session !== session) return;
        text = text.trim();
        await session.insertionQueue;
        if (session.finished || session.cancelled || this.session !== session) return;
        if (!session.live || session.segmentCount === 0) {
            await this.insertFinalResult(session, text);
            return;
        }
        const inserted = session.insertedSegments.join(" ");
        const buffered = session.bufferedSegments.join(" ");
        if (session.clipboardFallback) {
            const expected = [inserted, buffered].filter(Boolean).join(" ");
            if (text.startsWith(`${expected} `)) {
                const suffix = text.slice(expected.length + 1);
                if (suffix) session.bufferedSegments.push(suffix);
            } else if (text !== expected) {
                console.warn("Voice typing provider result did not match its committed segment contract.");
            }
            this.copyBuffered(session);
            await this.finishSession(session);
            return;
        }
        if (text === inserted) {
            await this.finishSession(session);
            return;
        }
        if (inserted && text.startsWith(`${inserted} `)) {
            const suffix = text.slice(inserted.length + 1);
            if (suffix) await this.insertFinalResult(session, suffix);
            else await this.finishSession(session);
            return;
        }
        if (!inserted) {
            await this.insertFinalResult(session, text);
            return;
        }
        console.warn("Voice typing provider result did not match its committed segment contract.");
        await this.finishSession(session);
    }

    private async insertFinalResult(session: VoiceSession, text: string): Promise<void> {
        if (session.finished || session.cancelled || this.session !== session) return;
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

    private copyBuffered(session: VoiceSession): void {
        const buffered = session.bufferedSegments.join(" ").trim();
        if (!buffered || session.cancelled) return;
        toClipboard(buffered);
        ui.notify(t("voiceTyping.copied"), "info");
        session.bufferedSegments = [];
    }

    private utteranceId(value: unknown): string | undefined {
        return typeof value === "string" || typeof value === "number" ? String(value) : undefined;
    }

    private clearDraft(session: VoiceSession): void {
        session.draft = undefined;
        session.draftUtterance = undefined;
        session.draftUtterances.clear();
        this.publishState(session, session.stopRequested ? "transcribing" : "recording", this.captureDuration(session));
    }

    private publishState(session: VoiceSession, status: VoiceTypingOverlayState["status"], durationMs: number): void {
        this.onState({ status, binding: this.shortcut, level: this.level, durationMs });
    }

    private recordSpeechBaseline(session: VoiceSession, startMs: number, endMs: number): void {
        for (const sample of session.acousticLevels) {
            if (sample.endMs > startMs && sample.startMs < endMs) session.speechLevels.push(sample.value);
        }
        if (!session.speechLevels.length) return;
        // Quiet means below a fifth of the median level heard during committed speech.
        const ordered = [...session.speechLevels].sort((left, right) => left - right);
        const middle = Math.floor(ordered.length / 2);
        const median = ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
        session.quietThreshold = Math.max(0.005, median * 0.2);
    }

    private checkAutoStop(session: VoiceSession): void {
        if (session.finished || session.cancelled || session.stopRequested || !session.capture) return;
        const duration = settings.get("voice-typing.auto-stop-silence-ms");
        const threshold = session.quietThreshold;
        if (!duration || session.segmentCount === 0 || session.draftUtterances.size > 0 || threshold === undefined) {
            session.quietSince = undefined;
            return;
        }
        if (this.level < threshold) {
            session.quietSince ??= Date.now();
            if (Date.now() - session.quietSince >= duration) this.stopSession(session.id);
        } else {
            session.quietSince = undefined;
        }
    }

    private async finishSession(session: VoiceSession): Promise<void> {
        if (session.finished) return;
        session.finished = true;
        session.draft = undefined;
        session.draftUtterances.clear();
        session.capture && await this.stopCapture(session.capture);
        session.channel?.close();
        session.releaseLease?.();
        session.releaseLease = undefined;
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
