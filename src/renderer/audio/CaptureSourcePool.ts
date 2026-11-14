import { ARM_CHANNEL, AUDIO_SETTINGS_GET, AUDIO_STATUS, CLEAR_CHANNEL } from "../../ipc/audio-channels";
import type { AudioProcessingMode } from "../../ipc/audio-channels";
import { SerialQueue } from "../../shared/serial-queue";
import type { ServiceChannel } from "../../shared/service-channel";
import { errMessage } from "../../shared/utils";
import { ComputerAudioGate } from "./dsp/ComputerAudioGate";
import { PcmAudioCapture } from "./dsp/PcmAudioCapture";
import { microphoneDeviceId, resolveMicrophoneDevice } from "./dsp/microphone-device";
import type { LoopbackLease } from "./dsp/LoopbackReference";
import { MICROPHONE_TUNING, type MicrophoneCleaningOptions, type MicrophoneNotch } from "../../shared/microphone-cleaning-types";

export interface CaptureOptions {
    source: "microphone" | "computer";
    deviceId?: string;
    echoCancel?: boolean;
    processing?: "default" | "raw";
    cancelComputerAudio?: boolean;
}

export interface SettingsSnapshot { enabled: boolean; attenuationDb: number; notches: Record<string, MicrophoneNotch> }
export interface CaptureConsumer {
    channelId: string;
    channel: ServiceChannel;
    closed: boolean;
    queue: unknown[];
    draining: boolean;
    isClosed(): boolean;
}
interface SharedSource {
    key: string;
    source: CaptureOptions["source"];
    capture: PcmAudioCapture;
    subscribers: Set<CaptureConsumer>;
    referenceLeases: Set<symbol>;
    gate?: ComputerAudioGate;
    starting: Promise<void>;
    active: boolean;
    options: CaptureOptions;
    restarting?: Promise<void>;
    cleaning?: MicrophoneCleaningOptions;
    stream?: MediaStream;
    restartPending?: boolean;
}
interface CaptureSourcePoolOptions {
    invoke(channel: string, ...args: unknown[]): Promise<unknown>;
    send(channel: string, value: unknown): void;
    mediaDevices: MediaDevices;
    sharedContext: AudioContext;
    epoch: number;
    publishCaptureCount(count: number): void;
}
const DEVICE_CHANGE_DEBOUNCE_MS = 300;
const CAPTURE_QUEUE_LIMIT = 32;
const CAPTURE_SAMPLE_RATE = 16_000;

/** Owns shared microphone and computer audio captures for this audio window. */
export class CaptureSourcePool {
    private readonly sources = new Map<string, SharedSource>();
    private readonly streamQueue = new SerialQueue();
    private readonly settingsReady: Promise<void>;
    private microphoneSettings: SettingsSnapshot = { enabled: true, attenuationDb: MICROPHONE_TUNING.attenuationDb, notches: {} };
    private deviceChangeTimer: ReturnType<typeof setTimeout> | undefined;
    public constructor(private readonly options: CaptureSourcePoolOptions) {
        this.settingsReady = options.invoke(AUDIO_SETTINGS_GET).then((value: unknown) => {
            if (value) this.microphoneSettings = value as SettingsSnapshot;
        }).catch(() => {});
        options.mediaDevices.addEventListener("devicechange", this.handleDeviceChange);
    }
    public updateSettings(value: SettingsSnapshot): void {
        this.microphoneSettings = value;
        for (const source of this.sources.values()) {
            if (source.source !== "microphone" || source.options.processing === "raw") continue;
            if (source.restarting) { source.restartPending = true; continue; }
            if (!source.stream || (!source.options.cancelComputerAudio && source.cleaning?.enabled !== value.enabled)) {
                void this.restartSource(source);
                continue;
            }
            source.cleaning = this.cleaningOptions(source.stream);
            source.capture.updateCleaning(source.cleaning);
        }
    }
    public retryMicrophones(): void {
        for (const source of this.sources.values()) {
            if (source.source === "microphone" && source.options.processing !== "raw") void this.restartSource(source);
        }
    }
    public async enumerateDevices(): Promise<MediaDeviceInfo[]> {
        return this.streamQueue.run(async () => {
            try {
                await this.options.invoke(ARM_CHANNEL, "microphone");
                return await this.options.mediaDevices.enumerateDevices();
            } finally {
                await this.options.invoke(CLEAR_CHANNEL).catch(() => {});
            }
        });
    }
    public async attach(consumer: CaptureConsumer, captureOptions: CaptureOptions): Promise<void> {
        let source: SharedSource;
        try { source = await this.acquireSource(captureOptions); }
        catch (error) {
            if (!consumer.isClosed()) {
                const message = errMessage(error, "Audio capture failed.");
                try { consumer.channel.send({ type: "error", epoch: this.options.epoch, code: "permission-denied", message }); }
                catch { /* Caller may have closed while capture permission was pending. */ }
                consumer.channel.close({ code: "permission-denied", message });
            }
            return;
        }
        if (consumer.isClosed()) {
            if (source.subscribers.size === 0) await this.releaseSource(source);
            return;
        }
        source.subscribers.add(consumer);
    }
    public detach(channelId: string): void {
        for (const source of this.sources.values()) {
            const consumer = [...source.subscribers].find((entry) => entry.channelId === channelId);
            if (!consumer) continue;
            source.subscribers.delete(consumer);
            consumer.queue.length = 0;
            void this.releaseSource(source);
        }
    }
    public stopAll(): void {
        this.options.mediaDevices.removeEventListener("devicechange", this.handleDeviceChange);
        clearTimeout(this.deviceChangeTimer);
        const sources = [...this.sources.values()];
        this.sources.clear();
        for (const source of sources) void source.capture.stop();
        this.options.publishCaptureCount(0);
    }
    private readonly handleDeviceChange = (): void => {
        clearTimeout(this.deviceChangeTimer);
        this.deviceChangeTimer = setTimeout(() => {
            for (const source of this.sources.values()) {
                if (source.source === "computer" || (source.source === "microphone" && !source.options.deviceId && source.options.processing !== "raw")) {
                    void this.restartSource(source);
                }
            }
        }, DEVICE_CHANGE_DEBOUNCE_MS);
    };
    private cleaningOptions(stream: MediaStream): MicrophoneCleaningOptions {
        const id = microphoneDeviceId(stream);
        return { enabled: this.microphoneSettings.enabled, attenuationDb: this.microphoneSettings.attenuationDb,
            notch: id ? this.microphoneSettings.notches[id] : undefined };
    }
    private sourceKey(options: CaptureOptions): string {
        return options.source === "computer"
            ? "computer\u0000default\u0000na"
            : `microphone\u0000${options.deviceId ?? "default"}\u0000${options.processing ?? "default"}\u0000${options.processing === "raw" ? false : options.echoCancel ?? true}\u0000${options.cancelComputerAudio ?? false}`;
    }
    private publishCaptureCount(): void {
        this.options.publishCaptureCount([...this.sources.values()].filter((source) => source.active).length);
    }
    private publishChunk(source: SharedSource, data: ArrayBuffer, timeMs: number): void {
        const chunk = { type: "chunk", epoch: this.options.epoch, timeMs, sampleRate: CAPTURE_SAMPLE_RATE, data };
        for (const consumer of source.subscribers) {
            if (consumer.isClosed()) continue;
            if (consumer.queue.length >= CAPTURE_QUEUE_LIMIT) {
                consumer.channel.close({ code: "channel-backpressure", message: "Audio consumer is too slow." });
                continue;
            }
            consumer.queue.push(chunk);
            void this.drain(consumer);
        }
    }
    private async drain(consumer: CaptureConsumer): Promise<void> {
        if (consumer.draining || consumer.isClosed()) return;
        consumer.draining = true;
        try {
            while (consumer.queue.length && !consumer.isClosed()) {
                if (!consumer.channel.writable) await consumer.channel.whenWritable();
                consumer.channel.send(consumer.queue.shift());
            }
        } catch (error) {
            consumer.channel.close({ code: "channel-backpressure", message: errMessage(error, "Audio consumer is too slow.") });
        } finally {
            consumer.draining = false;
            if (consumer.queue.length && !consumer.isClosed()) void this.drain(consumer);
        }
    }
    private onCaptureChunk(source: SharedSource, data: ArrayBuffer, timeMs: number): void {
        if (source.source === "microphone") { this.publishChunk(source, data, timeMs); return; }
        for (const gated of source.gate?.push({ data, time: timeMs }) ?? []) this.publishChunk(source, gated.chunk.data, gated.chunk.time);
    }
    private reportSourceStatus(source: SharedSource, mode: AudioProcessingMode, reason: string): void {
        this.options.send(AUDIO_STATUS, { mode, reason });
        if (mode === "failed") for (const consumer of [...source.subscribers]) consumer.channel.close({ code: "handler-closed", message: reason });
    }
    private requestStream(options: CaptureOptions): Promise<MediaStream> {
        return this.streamQueue.run(() => this.requestStreamNow(options));
    }
    private async requestStreamNow(options: CaptureOptions): Promise<MediaStream> {
        try {
            await this.options.invoke(ARM_CHANNEL, options.source);
            if (options.source === "microphone") {
                return await this.options.mediaDevices.getUserMedia({ audio: {
                    channelCount: 1,
                    noiseSuppression: options.processing === "raw" ? false : !(this.microphoneSettings.enabled || options.cancelComputerAudio),
                    autoGainControl: options.processing !== "raw",
                    echoCancellation: options.processing === "raw" || options.cancelComputerAudio ? false : options.echoCancel ?? true,
                    ...(options.deviceId ? { deviceId: { exact: options.deviceId } } : {}),
                } });
            }
            if (process.platform !== "win32") throw new Error("Computer audio capture is supported on Windows only.");
            const stream = await this.options.mediaDevices.getDisplayMedia({ audio: true, video: true });
            stream.getVideoTracks().forEach((track) => track.stop());
            if (!stream.getAudioTracks().length) {
                stream.getTracks().forEach((track) => track.stop());
                throw new Error("Windows did not provide an audio track.");
            }
            return stream;
        } finally {
            await this.options.invoke(CLEAR_CHANNEL).catch(() => {});
        }
    }
    private async acquireSource(options: CaptureOptions, reservation?: symbol): Promise<SharedSource> {
        await this.settingsReady;
        const key = this.sourceKey(options);
        const existing = this.sources.get(key);
        if (existing) {
            if (reservation) existing.referenceLeases.add(reservation);
            try { await existing.starting; }
            catch (error) { if (reservation) existing.referenceLeases.delete(reservation); throw error; }
            return existing;
        }
        const source: SharedSource = {
            key, source: options.source, capture: new PcmAudioCapture(), subscribers: new Set(), referenceLeases: new Set(),
            ...(options.source === "computer" ? { gate: new ComputerAudioGate() } : {}),
            starting: Promise.resolve(), active: false, options,
        };
        if (reservation) source.referenceLeases.add(reservation);
        this.sources.set(key, source);
        source.starting = (async () => {
            const stream = await this.requestStream(options);
            if (options.source === "microphone") await resolveMicrophoneDevice(stream, () => this.enumerateDevices());
            source.stream = stream;
            source.cleaning = options.source === "microphone" && options.processing !== "raw" ? this.cleaningOptions(stream) : undefined;
            try {
                await source.capture.start({ stream, onChunk: (data, timeMs) => this.onCaptureChunk(source, data, timeMs), onLevel: () => undefined,
                    sharedContext: this.options.sharedContext, cleaning: source.cleaning,
                    onStatus: (mode, reason) => this.reportSourceStatus(source, mode, reason),
                    referenceAcquire: options.cancelComputerAudio ? () => this.acquireReference() : undefined, ownsStream: true });
                this.watchComputerTrack(source, stream);
                source.active = true;
                this.publishCaptureCount();
            } catch (error) {
                await source.capture.stop();
                stream.getTracks().forEach((track) => track.stop());
                throw error;
            }
        })();
        try { await source.starting; return source; }
        catch (error) {
            if (this.sources.get(key) === source) this.sources.delete(key);
            this.publishCaptureCount();
            throw error;
        }
    }
    private async restartSource(source: SharedSource): Promise<void> {
        if (source.restarting) { source.restartPending = true; await source.restarting; return; }
        source.restarting = (async () => {
            await source.starting;
            if (this.sources.get(source.key) !== source) return;
            if (source.source === "microphone") this.options.send(AUDIO_STATUS, { mode: "restart", reason: "" });
            await source.capture.flush();
            await source.capture.stop();
            if (this.sources.get(source.key) !== source) return;
            const stream = await this.requestStream(source.options);
            if (this.sources.get(source.key) !== source) { stream.getTracks().forEach((track) => track.stop()); return; }
            source.capture = new PcmAudioCapture();
            if (source.source === "microphone") await resolveMicrophoneDevice(stream, () => this.enumerateDevices());
            source.stream = stream;
            source.cleaning = source.source === "microphone" ? this.cleaningOptions(stream) : undefined;
            if (source.source === "computer") source.gate = new ComputerAudioGate();
            await source.capture.start({ stream, onChunk: (data, timeMs) => this.onCaptureChunk(source, data, timeMs), onLevel: () => undefined,
                sharedContext: this.options.sharedContext, cleaning: source.cleaning,
                onStatus: (mode, reason) => this.reportSourceStatus(source, mode, reason),
                referenceAcquire: source.options.cancelComputerAudio ? () => this.acquireReference() : undefined, ownsStream: true });
            this.watchComputerTrack(source, stream);
        })().catch(async (error: unknown) => {
            await source.capture.stop();
            source.active = false;
            this.publishCaptureCount();
            for (const consumer of source.subscribers) consumer.channel.close({ code: "handler-closed", message: errMessage(error, "Microphone restart failed.") });
        }).finally(() => {
            source.restarting = undefined;
            if (source.restartPending && this.sources.get(source.key) === source) { source.restartPending = false; void this.restartSource(source); }
        });
        await source.restarting;
    }
    private watchComputerTrack(source: SharedSource, stream: MediaStream): void {
        if (source.source !== "computer") return;
        stream.getAudioTracks()[0]?.addEventListener("ended", () => {
            if (this.sources.get(source.key) === source && source.stream === stream) void this.restartSource(source);
        }, { once: true });
    }
    private async releaseSource(source: SharedSource): Promise<void> {
        if (source.subscribers.size || source.referenceLeases.size) return;
        if (this.sources.get(source.key) === source) this.sources.delete(source.key);
        await source.starting.catch(() => {});
        await source.capture.stop();
        source.active = false;
        this.publishCaptureCount();
    }
    private async acquireReference(): Promise<LoopbackLease> {
        const token = Symbol("loopback reference");
        const source = await this.acquireSource({ source: "computer" }, token);
        if (source.stream?.getAudioTracks()[0]?.readyState !== "live") {
            source.referenceLeases.delete(token);
            void this.releaseSource(source);
            throw new Error("Computer audio is unavailable");
        }
        let released = false;
        return {
            context: this.options.sharedContext,
            subscribe: (callback, ended) => {
                const unsubscribe = source.capture.subscribeRaw(callback);
                const track = source.stream?.getAudioTracks()[0];
                track?.addEventListener("ended", ended);
                return () => { unsubscribe(); track?.removeEventListener("ended", ended); };
            },
            release: () => {
                if (released) return;
                released = true;
                source.referenceLeases.delete(token);
                void this.releaseSource(source);
            },
        };
    }
}
