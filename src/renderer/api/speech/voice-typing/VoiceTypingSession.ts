import { codedError } from "../../../../shared/coded-error";
import { t } from "../../../../shared/i18n/t";
import { api } from "../../../../ipc/renderer/api";
import { liveSpeechSessionCoordinator } from "../LiveSpeechSessionCoordinator";
import { MicrophoneCapture } from "../MicrophoneCapture";
import { SpeechSessionClient } from "../SpeechSessionClient";
import type { SpeechTranscriptionProvider } from "../SpeechTranscriptionProvider";
import { PcmAudioCapture } from "../../../audio/dsp/PcmAudioCapture";
import { LiveTextInserter } from "./LiveTextInserter";
import { SpeechAutoStop } from "./SpeechAutoStop";

const MAX_AUDIO_MS = 300_000;
const AUDIO_SAMPLE_RATE = 16_000;

export type VoiceTypingMode = "transcribe" | "translate";
export type VoiceTypingStatus = "idle" | "starting" | "recording" | "transcribing";

export interface VoiceTypingSessionSnapshot {
    status: VoiceTypingStatus;
    mode: VoiceTypingMode;
    translating: boolean;
    level: number;
    durationMs: number;
}

export interface VoiceTypingSessionOptions {
    id: string;
    mode: VoiceTypingMode;
    providerDiscovery: SpeechTranscriptionProvider;
    getSilenceDuration: () => number;
    getInactivityDuration: () => number;
    insert: (sessionId: string, text: string, deferClipboard?: boolean) => Promise<{ copied: boolean }>;
    clipboard: (text: string) => void;
    isCurrent: (session: VoiceTypingSession) => boolean;
    onState: (snapshot: VoiceTypingSessionSnapshot) => void;
    onProcessState: (status: VoiceTypingStatus) => void;
    onError: (code: string, error?: unknown) => void;
    onCopied: () => void;
    onFinished: (session: VoiceTypingSession) => void;
}

interface AudioCapture {
    pipeline: PcmAudioCapture;
    context: AudioContext;
    pending: ArrayBuffer[];
    sentSamples: number;
    sendQueue: Promise<void>;
    startedAt: number;
    stopped: boolean;
    levelDurationMs: number;
}

/** Owns one dictation's channel, microphone capture, insertion and stop lifecycle. */
export class VoiceTypingSession {
    private readonly id: string;
    private readonly mode: VoiceTypingMode;
    private readonly providerDiscovery: SpeechTranscriptionProvider;
    private readonly autoStop: SpeechAutoStop;
    private readonly inserter: LiveTextInserter;
    private readonly draftUtterances = new Set<string>();
    private cancelled = false;
    private stopRequested = false;
    private finished = false;
    private resultReceived = false;
    private live = false;
    private channelReady = false;
    private providerFeatures: string[] | undefined;
    private speech: SpeechSessionClient | undefined;
    private capture: AudioCapture | undefined;
    private draft: string | undefined;
    private draftUtterance: string | undefined;
    private segmentCount = 0;
    private level = 0;
    private timer: ReturnType<typeof setInterval> | undefined;
    private releaseLease: (() => void) | undefined;

    public constructor(private readonly options: VoiceTypingSessionOptions) {
        this.id = options.id;
        this.mode = options.mode;
        this.providerDiscovery = options.providerDiscovery;
        this.inserter = new LiveTextInserter({
            insert: (text, deferClipboard) => options.insert(this.id, text, deferClipboard),
            clipboard: options.clipboard,
        });
        this.autoStop = new SpeechAutoStop({
            getSilenceDuration: options.getSilenceDuration,
            getInactivityDuration: options.getInactivityDuration,
        });
    }

    public get sessionId(): string {
        return this.id;
    }

    public get sessionMode(): VoiceTypingMode {
        return this.mode;
    }

    public start(): void {
        const releaseLease = liveSpeechSessionCoordinator.acquire("voice-typing");
        if (!releaseLease) {
            this.options.onError("session-conflict");
            this.options.onFinished(this);
            return;
        }
        this.releaseLease = releaseLease;
        this.level = 0;
        this.publishState("starting", 0);
        this.publishProcessState("starting");
        this.timer = setInterval(() => {
            const capture = this.capture;
            const status = this.finished ? "idle" : this.stopRequested ? "transcribing" : capture ? "recording" : "starting";
            this.publishState(status, capture ? Date.now() - capture.startedAt : 0);
            this.autoStop.check({
                level: this.level,
                capturing: Boolean(capture),
                live: this.live,
                segmentCount: this.segmentCount,
                hasDraft: this.draftUtterances.size > 0,
                stopRequested: this.stopRequested,
                finished: this.finished,
                cancelled: this.cancelled,
                stop: () => this.stop(),
            });
        }, SpeechAutoStop.tickIntervalMs);
        void this.openProviderAndCapture();
    }

    public stop(): void {
        if (this.finished || this.stopRequested) return;
        this.stopRequested = true;
        this.publishState("transcribing", this.captureDuration());
        this.publishProcessState("transcribing");
        if (this.capture && this.channelReady) void this.endChannel();
    }

    public async cancel(reason = "cancelled"): Promise<void> {
        if (this.finished) return;
        this.cancelled = true;
        this.clearDraft();
        if (reason === "too-long") this.options.onError(reason);
        this.speech?.cancel(reason, t(reason === "too-long" ? "voiceTyping.tooLong" : "voiceTyping.cancelled"));
        await this.finishSession();
    }

    private async openProviderAndCapture(): Promise<void> {
        // Keep capture concurrent with provider discovery/open; PCM buffers until accepted.
        const microphone = this.openMicrophone();
        try {
            const [, capture] = await Promise.all([this.openChannel(), microphone]);
            if (!this.isCurrent()) return;
            this.channelReady = true;
            if (capture) this.drainPending(capture);
            if (this.stopRequested) await this.endChannel();
        } catch (error) {
            void microphone.then((capture) => capture && this.stopCapture(capture)).catch(() => {});
            if (this.capture) await this.stopCapture(this.capture);
            if (!this.isCurrent()) return;
            this.options.onError(this.errorCode(error), error);
            await this.finishSession();
        }
    }

    private async openChannel(): Promise<void> {
        const providers = await this.providerDiscovery.list();
        if (!this.isCurrent()) return;
        const provider = providers.find((item) => item.version === 1);
        if (!provider) throw codedError("missing-provider", t("voiceTyping.missingProvider"));
        const features = await this.providerDiscovery.describeFeatures(provider, this.mode === "translate").catch((): undefined => undefined);
        this.providerFeatures = features;
        this.live = features?.includes("live") ?? false;
        if (!this.isCurrent()) return;
        this.speech = new SpeechSessionClient({
            provider: provider.provider,
            live: this.live,
            translate: this.mode === "translate",
            isCurrent: () => this.isCurrent(),
            timeoutError: () => new Error("The provider channel did not reach the app window."),
            onStatus: ({ state }) => {
                if (state === "transcribing") {
                    this.publishState("transcribing", this.captureDuration());
                    this.publishProcessState("transcribing");
                }
            },
            onDraft: ({ text, utterance: rawUtterance }) => {
                if (!this.live) return;
                const utterance = this.utteranceId(rawUtterance);
                if (utterance === undefined || !this.isCurrent()) return;
                this.autoStop.noteProviderOutput();
                this.draftUtterances.add(utterance);
                this.draftUtterance = utterance;
                this.draft = text.length > 80 ? `…${text.slice(-79)}` : text;
                this.publishState(this.stopRequested ? "transcribing" : "recording", this.captureDuration());
            },
            onSegment: ({ text, utterance: rawUtterance, startMs, endMs }) => {
                if (!this.live || !this.isCurrent()) return;
                const utterance = this.utteranceId(rawUtterance);
                if (utterance !== undefined) {
                    this.draftUtterances.delete(utterance);
                    if (this.draftUtterance === utterance) { this.draftUtterance = undefined; this.draft = undefined; }
                }
                if (typeof startMs === "number" && typeof endMs === "number") this.autoStop.recordSpeechBaseline(startMs, endMs);
                this.publishState(this.stopRequested ? "transcribing" : "recording", this.captureDuration());
                this.autoStop.noteProviderOutput();
                this.segmentCount++;
                this.inserter.queueSegment(text, () => this.isCurrent(), (error) => this.options.onError(this.errorCode(error), error));
            },
            onResult: ({ text }) => {
                if (text === undefined || !this.isCurrent()) return;
                this.resultReceived = true;
                this.clearDraft();
                void this.finishLiveResult(text);
            },
            onError: ({ code, message }) => {
                const error = Object.assign(new Error(message ?? ""), { code });
                if (code === "cancelled" && this.cancelled) return;
                this.options.onError(code ?? "failed", error);
                this.clearDraft();
                void this.inserter.drain().then(() => this.finishSession());
            },
            onClose: ({ code, message }) => {
                if (!this.finished && !this.cancelled && !this.resultReceived) {
                    const error = Object.assign(new Error(message), { code });
                    this.options.onError(code, error);
                    this.clearDraft();
                    void this.inserter.drain().then(() => this.finishSession());
                }
            },
        });
        await this.speech.open();
        if (!this.isCurrent()) return;
        await this.speech.accepted;
    }

    private async openMicrophone(): Promise<AudioCapture | undefined> {
        const captureRef: { value?: AudioCapture } = {};
        const earlyEvents: Array<{ type: "chunk"; buffer: ArrayBuffer } | { type: "level"; level: number; durationMs: number }> = [];
        const receiveChunk = (buffer: ArrayBuffer): void => {
            const capture = captureRef.value;
            if (!capture) { earlyEvents.push({ type: "chunk", buffer }); return; }
            capture.sentSamples += buffer.byteLength / 2;
            if ((capture.sentSamples / AUDIO_SAMPLE_RATE) * 1000 > MAX_AUDIO_MS) {
                void this.cancel("too-long");
                return;
            }
            capture.pending.push(buffer);
            if (this.channelReady) this.drainPending(capture);
        };
        const receiveLevel = (level: number, durationMs: number): void => {
            const capture = captureRef.value;
            if (!capture) { earlyEvents.push({ type: "level", level, durationMs }); return; }
            this.level = level;
            const startMs = capture.levelDurationMs;
            capture.levelDurationMs += durationMs;
            this.autoStop.recordLevel(startMs, capture.levelDurationMs, level);
            if (!this.stopRequested) this.publishState("recording", Date.now() - capture.startedAt);
        };
        const opened = await MicrophoneCapture.open({
            purpose: "voice-typing",
            isCurrent: () => this.isCurrent() && !this.stopRequested,
            onChunk: receiveChunk,
            onLevel: receiveLevel,
            onFailed: () => { void this.cancel("capture-failed"); },
        });
        if (!opened || !this.isCurrent()) return undefined;
        const capture: AudioCapture = {
            pipeline: opened.capture,
            context: opened.context,
            pending: [],
            sentSamples: 0,
            sendQueue: Promise.resolve(),
            startedAt: opened.startedAt,
            stopped: false,
            levelDurationMs: 0,
        };
        captureRef.value = capture;
        this.capture = capture;
        for (const event of earlyEvents) {
            if (event.type === "chunk") receiveChunk(event.buffer);
            else receiveLevel(event.level, event.durationMs);
        }
        this.autoStop.seedCaptureClock();
        if (!this.stopRequested) {
            this.publishState("recording", 0);
            this.publishProcessState("recording");
        }
        return capture;
    }

    private drainPending(capture: AudioCapture): void {
        while (capture.pending.length) {
            const buffer = capture.pending.shift();
            if (buffer) this.queuePcm(capture, buffer);
        }
    }

    private queuePcm(capture: AudioCapture, buffer: ArrayBuffer): void {
        const speech = this.speech;
        if (!buffer.byteLength || !speech) return;
        capture.sendQueue = capture.sendQueue.then(() => speech.sendAudio(buffer));
    }

    private async endChannel(): Promise<void> {
        if (this.finished || this.cancelled) return;
        const capture = this.capture;
        if (capture) {
            await capture.pipeline.flush();
            if (this.cancelled || this.finished) return;
            capture.stopped = true;
            this.drainPending(capture);
            await capture.sendQueue;
            await this.stopCapture(capture);
        }
        if (this.cancelled || this.finished) return;
        try {
            await capture?.sendQueue;
            this.speech?.end();
            this.publishState("transcribing", this.captureDuration());
            this.publishProcessState("transcribing");
        } catch (error) {
            this.options.onError(this.errorCode(error), error);
            await this.finishSession();
        }
    }

    private async stopCapture(capture: AudioCapture): Promise<void> {
        if (capture.stopped && !this.capture) return;
        capture.stopped = true;
        await capture.pipeline.stop();
        await capture.context.close().catch(() => {});
        if (this.capture === capture) this.capture = undefined;
    }

    private async finishLiveResult(text: string): Promise<void> {
        if (!this.isCurrent()) return;
        await this.inserter.drain();
        if (!this.isCurrent()) return;
        let outcome;
        if (!this.live || this.segmentCount === 0) {
            outcome = await this.inserter.insertFinalResult(text.trim(), () => this.isCurrent(), (error) => this.options.onError(this.errorCode(error), error));
        } else {
            outcome = await this.inserter.finishLiveResult(text, () => this.isCurrent(), (error) => this.options.onError(this.errorCode(error), error));
        }
        if (outcome.copied) this.options.onCopied();
        await this.finishSession();
    }

    private utteranceId(value: unknown): string | undefined {
        return typeof value === "string" || typeof value === "number" ? String(value) : undefined;
    }

    private clearDraft(): void {
        this.draft = undefined;
        this.draftUtterance = undefined;
        this.draftUtterances.clear();
        this.publishState(this.stopRequested ? "transcribing" : "recording", this.captureDuration());
    }

    private async finishSession(): Promise<void> {
        if (this.finished) return;
        this.finished = true;
        this.draft = undefined;
        this.draftUtterances.clear();
        if (this.capture) await this.stopCapture(this.capture);
        this.speech?.close();
        this.releaseLease?.();
        this.releaseLease = undefined;
        await api.clearVoiceTypingMicrophone().catch(() => {});
        if (this.timer) clearInterval(this.timer);
        this.timer = undefined;
        this.level = 0;
        this.publishState("idle", 0);
        this.publishProcessState("idle");
        this.options.onFinished(this);
    }

    private publishState(status: VoiceTypingStatus, durationMs: number): void {
        this.options.onState({
            status,
            mode: this.mode,
            translating: this.mode === "translate" && this.providerFeatures?.includes("translate") === true,
            level: this.level,
            durationMs,
        });
    }

    private publishProcessState(status: VoiceTypingStatus): void {
        this.options.onProcessState(status);
    }

    private captureDuration(): number {
        return this.capture ? Date.now() - this.capture.startedAt : 0;
    }

    private isCurrent(): boolean {
        return !this.cancelled && !this.finished && this.options.isCurrent(this);
    }

    private errorCode(error: unknown): string {
        if (error && typeof error === "object" && "code" in error && typeof error.code === "string") return error.code;
        if (error && typeof error === "object" && "name" in error && typeof error.name === "string") return error.name;
        return "failed";
    }
}
