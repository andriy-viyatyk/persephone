import { CONTROL_CHANNEL, ARM_CHANNEL, CLEAR_CHANNEL, OPEN_CHANNEL, CLOSE_CHANNEL } from "../../ipc/audio-channels";
import { isCapabilityErrorCode } from "../../shared/capability-constants";
import { createRendererCapabilityChannel } from "../api/renderer-capability-channel";
import { errMessage } from "../../shared/utils";
import { PcmAudioCapture } from "../ui/speech/PcmAudioCapture";
import { ComputerAudioGate } from "../ui/speech/ComputerAudioGate";
import type { CapabilityChannel, CapabilityErrorCode } from "../api/types/capabilities";
import { MAX_SERVICE_CHANNEL_MESSAGE_BYTES } from "../../shared/capability-limits";
import { AUDIO_DEVICES_REQUEST, AUDIO_DEVICES_REPLY, AUDIO_SETTINGS_GET, AUDIO_SETTINGS_UPDATE, AUDIO_STATUS, AUDIO_RETRY, type AudioDevicesRequest, type AudioDevicesReply } from "../../ipc/audio-channels";
import { microphoneDeviceId, resolveMicrophoneDevice } from "../ui/speech/microphone-device";
import { MICROPHONE_TUNING, type MicrophoneNotch, type MicrophoneCleaningOptions } from "../ui/speech/microphone-cleaning-types";
import type { LoopbackLease } from "../ui/speech/LoopbackReference";

const { ipcRenderer } = require("electron") as typeof import("electron");
const epoch = Number(new URL(location.href).searchParams.get("epoch"));

interface CaptureOptions {
    source: "microphone" | "computer";
    deviceId?: string;
    echoCancel?: boolean;
    processing?: "default" | "raw";
    cancelComputerAudio?: boolean;
}

interface SharedSource {
    key: string;
    source: CaptureOptions["source"];
    capture: PcmAudioCapture;
    subscribers: Set<ActiveChannel>;
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

interface PlaybackState {
    sampleRate: number;
    nextStartTime: number;
    queuedSeconds: number;
    sources: Set<AudioBufferSourceNode>;
    ending: boolean;
    ended: boolean;
}
interface OpenChannelMessage { channelId: string; kind: "capture" | "play"; open: CaptureOptions | { sampleRate: number }; epoch: number }
interface ActiveChannel { channelId: string; channel: CapabilityChannel; kind: "capture" | "play"; source?: SharedSource; playback?: PlaybackState; closed: boolean; queue: unknown[]; draining: boolean }

const sources = new Map<string, SharedSource>();
const channels = new Map<string, ActiveChannel>();
const sharedContext = new AudioContext();
interface SettingsSnapshot { enabled: boolean; attenuationDb: number; notches: Record<string, MicrophoneNotch> }
let microphoneSettings: SettingsSnapshot = { enabled: true, attenuationDb: MICROPHONE_TUNING.attenuationDb, notches: {} };
const settingsReady = ipcRenderer.invoke(AUDIO_SETTINGS_GET).then((value: SettingsSnapshot | undefined) => { if (value) microphoneSettings = value; }).catch(() => {});
ipcRenderer.on(AUDIO_SETTINGS_UPDATE, (_event, value: SettingsSnapshot) => {
    microphoneSettings = value;
    for (const source of sources.values()) {
        if (source.source !== "microphone" || source.options.processing === "raw") continue;
        if (source.restarting) { source.restartPending = true; continue; }
        if (!source.stream || (!source.options.cancelComputerAudio && source.cleaning?.enabled !== value.enabled)) { void restartSource(source); continue; }
        source.cleaning = cleaningOptions(source.stream);
        source.capture.updateCleaning(source.cleaning);
    }
});
ipcRenderer.on(AUDIO_RETRY, () => {
    for (const source of sources.values()) if (source.source === "microphone" && source.options.processing !== "raw") void restartSource(source);
});
let deviceChangeTimer: ReturnType<typeof setTimeout> | undefined;
navigator.mediaDevices.addEventListener("devicechange", () => {
    clearTimeout(deviceChangeTimer);
    deviceChangeTimer = setTimeout(() => {
        for (const source of sources.values()) {
            if (source.source === "computer" || (source.source === "microphone" && !source.options.deviceId && source.options.processing !== "raw")) void restartSource(source);
        }
    }, 300);
});

function cleaningOptions(stream: MediaStream): MicrophoneCleaningOptions {
    const id = microphoneDeviceId(stream);
    return { enabled: microphoneSettings.enabled, attenuationDb: microphoneSettings.attenuationDb,
        notch: id ? microphoneSettings.notches[id] : undefined };
}

ipcRenderer.on(AUDIO_DEVICES_REQUEST, (_event: Electron.IpcRendererEvent, request: AudioDevicesRequest) => {
    if (!request || typeof request.requestId !== "string" || request.epoch !== epoch) return;
    void enumerateDevices().then((devices) => {
        const reply: AudioDevicesReply = { requestId: request.requestId, epoch, devices: devices
            .filter((device) => device.kind === "audioinput")
            .map((device) => ({ deviceId: device.deviceId, label: device.label || "", isDefault: device.deviceId === "default" })) };
        ipcRenderer.send(AUDIO_DEVICES_REPLY, reply);
    }).catch((error: unknown) => {
        const reply: AudioDevicesReply = { requestId: request.requestId, epoch, error: errMessage(error, "Device enumeration failed.") };
        ipcRenderer.send(AUDIO_DEVICES_REPLY, reply);
    });
});

function sourceKey(options: CaptureOptions): string {
    return options.source === "computer"
        ? "computer\u0000default\u0000na"
        : `microphone\u0000${options.deviceId ?? "default"}\u0000${options.processing ?? "default"}\u0000${options.processing === "raw" ? false : options.echoCancel ?? true}\u0000${options.cancelComputerAudio ?? false}`;
}

function publishCaptureCount(): void {
    ipcRenderer.send(CONTROL_CHANNEL, { type: "capture-count", count: [...sources.values()].filter((source) => source.active).length });
}

function publishChunk(source: SharedSource, data: ArrayBuffer, timeMs: number): void {
    const chunk = { type: "chunk", epoch, timeMs, sampleRate: 16000, data };
    for (const record of source.subscribers) {
        if (record.closed) continue;
        if (record.queue.length >= 32) {
            record.channel.close({ code: "channel-backpressure", message: "Audio consumer is too slow." });
            continue;
        }
        record.queue.push(chunk);
        void drain(record);
    }
}

async function drain(record: ActiveChannel): Promise<void> {
    if (record.draining || record.closed) return;
    record.draining = true;
    try {
        while (record.queue.length && !record.closed) {
            if (!record.channel.writable) await record.channel.whenWritable();
            record.channel.send(record.queue.shift());
        }
    } catch (error) {
        record.channel.close({ code: "channel-backpressure", message: errMessage(error, "Audio consumer is too slow.") });
    } finally {
        record.draining = false;
        if (record.queue.length && !record.closed) void drain(record);
    }
}

function onCaptureChunk(source: SharedSource, data: ArrayBuffer, timeMs: number): void {
    if (source.source === "microphone") {
        publishChunk(source, data, timeMs);
        return;
    }
    for (const gated of source.gate?.push({ data, time: timeMs }) ?? []) publishChunk(source, gated.chunk.data, gated.chunk.time);
}

function reportSourceStatus(source: SharedSource, mode: string, reason: string): void {
    ipcRenderer.send(AUDIO_STATUS, { mode, reason });
    if (mode === "failed") for (const record of [...source.subscribers]) record.channel.close({ code: "handler-closed", message: reason });
}

// Each request arms and then clears a one-use grant in main, so requests must not overlap:
// a concurrent request would consume or clear the other's grant.
let streamRequests: Promise<unknown> = Promise.resolve();

function requestStream(options: CaptureOptions): Promise<MediaStream> {
    const request = streamRequests.then(() => requestStreamNow(options));
    streamRequests = request.catch((): undefined => undefined);
    return request;
}

// Chromium hides device ids and labels unless the media permission check passes, which it does
// only while main has armed the microphone grant; queued with stream requests so grants never overlap.
function enumerateDevices(): Promise<MediaDeviceInfo[]> {
    const request = streamRequests.then(async () => {
        try {
            await ipcRenderer.invoke(ARM_CHANNEL, "microphone");
            return await navigator.mediaDevices.enumerateDevices();
        } finally {
            await ipcRenderer.invoke(CLEAR_CHANNEL).catch(() => {});
        }
    });
    streamRequests = request.catch((): undefined => undefined);
    return request;
}

async function requestStreamNow(options: CaptureOptions): Promise<MediaStream> {
    try {
        await ipcRenderer.invoke(ARM_CHANNEL, options.source);
        if (options.source === "microphone") {
            return await navigator.mediaDevices.getUserMedia({ audio: {
                channelCount: 1,
                noiseSuppression: options.processing === "raw" ? false : !(microphoneSettings.enabled || options.cancelComputerAudio),
                autoGainControl: options.processing !== "raw",
                echoCancellation: options.processing === "raw" || options.cancelComputerAudio ? false : options.echoCancel ?? true,
                ...(options.deviceId ? { deviceId: { exact: options.deviceId } } : {}),
            } });
        }
        if (process.platform !== "win32") throw new Error("Computer audio capture is supported on Windows only.");
        const stream = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: true });
        stream.getVideoTracks().forEach((track) => track.stop());
        if (!stream.getAudioTracks().length) {
            stream.getTracks().forEach((track) => track.stop());
            throw new Error("Windows did not provide an audio track.");
        }
        return stream;
    } finally {
        await ipcRenderer.invoke(CLEAR_CHANNEL).catch(() => {});
    }
}

async function acquireSource(options: CaptureOptions, reservation?: symbol): Promise<SharedSource> {
    await settingsReady;
    const key = sourceKey(options);
    const existing = sources.get(key);
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
    sources.set(key, source);
    source.starting = (async () => {
        const stream = await requestStream(options);
        if (options.source === "microphone") await resolveMicrophoneDevice(stream, enumerateDevices);
        source.stream = stream;
        source.cleaning = options.source === "microphone" && options.processing !== "raw" ? cleaningOptions(stream) : undefined;
        try {
            await source.capture.start(stream, (data, timeMs) => onCaptureChunk(source, data, timeMs), () => undefined, sharedContext,
                source.cleaning,
                (mode, reason) => reportSourceStatus(source, mode, reason), options.cancelComputerAudio ? acquireReference : undefined);
            watchComputerTrack(source, stream);
            source.active = true;
            publishCaptureCount();
        } catch (error) {
            await source.capture.stop();
            stream.getTracks().forEach((track) => track.stop());
            throw error;
        }
    })();
    try {
        await source.starting;
        return source;
    } catch (error) {
        if (sources.get(key) === source) sources.delete(key);
        publishCaptureCount();
        throw error;
    }
}

async function restartSource(source: SharedSource): Promise<void> {
    if (source.restarting) { source.restartPending = true; await source.restarting; return; }
    source.restarting = (async () => {
        await source.starting;
        if (sources.get(source.key) !== source) return;
        if (source.source === "microphone") ipcRenderer.send(AUDIO_STATUS, { mode: "restart", reason: "" });
        await source.capture.flush();
        await source.capture.stop();
        if (sources.get(source.key) !== source) return;
        const stream = await requestStream(source.options);
        if (sources.get(source.key) !== source) { stream.getTracks().forEach((track) => track.stop()); return; }
        source.capture = new PcmAudioCapture();
        if (source.source === "microphone") await resolveMicrophoneDevice(stream, enumerateDevices);
        source.stream = stream;
        source.cleaning = source.source === "microphone" ? cleaningOptions(stream) : undefined;
        if (source.source === "computer") source.gate = new ComputerAudioGate();
        await source.capture.start(stream, (data, timeMs) => onCaptureChunk(source, data, timeMs), () => undefined, sharedContext, source.cleaning,
            (mode, reason) => reportSourceStatus(source, mode, reason), source.options.cancelComputerAudio ? acquireReference : undefined);
        watchComputerTrack(source, stream);
    })().catch(async (error: unknown) => {
        await source.capture.stop();
        source.active = false;
        publishCaptureCount();
        for (const record of source.subscribers) record.channel.close({ code: "handler-closed", message: errMessage(error, "Microphone restart failed.") });
    }).finally(() => {
        source.restarting = undefined;
        if (source.restartPending && sources.get(source.key) === source) { source.restartPending = false; void restartSource(source); }
    });
    await source.restarting;
}

function watchComputerTrack(source: SharedSource, stream: MediaStream): void {
    if (source.source !== "computer") return;
    stream.getAudioTracks()[0]?.addEventListener("ended", () => {
        if (sources.get(source.key) === source && source.stream === stream) void restartSource(source);
    }, { once: true });
}

async function attach(record: ActiveChannel, options: CaptureOptions): Promise<void> {
    let source: SharedSource;
    try { source = await acquireSource(options); }
    catch (error) {
        if (!record.closed) {
            try { record.channel.send({ type: "error", epoch, code: "permission-denied", message: errMessage(error, "Audio capture failed.") }); }
            catch { /* Caller may have closed while capture permission was pending. */ }
            record.channel.close({ code: "permission-denied", message: errMessage(error, "Audio capture failed.") });
        }
        return;
    }
    if (record.closed) {
        if (source.subscribers.size === 0) await releaseSource(source);
        return;
    }
    record.source = source;
    source.subscribers.add(record);
}

async function releaseSource(source: SharedSource): Promise<void> {
    if (source.subscribers.size || source.referenceLeases.size) return;
    if (sources.get(source.key) === source) sources.delete(source.key);
    await source.starting.catch(() => {});
    await source.capture.stop();
    source.active = false;
    publishCaptureCount();
}

async function acquireReference(): Promise<LoopbackLease> {
    const token = Symbol("loopback reference");
    const source = await acquireSource({ source: "computer" }, token);
    if (source.stream?.getAudioTracks()[0]?.readyState !== "live") {
        source.referenceLeases.delete(token);
        void releaseSource(source);
        throw new Error("Computer audio is unavailable");
    }
    let released = false;
    return {
        context: sharedContext,
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
            void releaseSource(source);
        },
    };
}

function stopPlayback(record: ActiveChannel): void {
    const playback = record.playback;
    if (!playback) return;
    playback.ended = true;
    for (const source of playback.sources) {
        source.onended = null;
        try { source.stop(); } catch { /* already ended */ }
        source.disconnect();
    }
    playback.sources.clear();
    playback.queuedSeconds = 0;
}

async function finishPlayback(record: ActiveChannel, status: "finished" | "stopped"): Promise<void> {
    const playback = record.playback;
    if (!playback || playback.ended || record.closed) return;
    // Mark first: stopping sources fires their "ended" handlers, which must not report "finished".
    playback.ended = true;
    if (status === "stopped") stopPlayback(record);
    try {
        if (!record.channel.writable) await record.channel.whenWritable();
        record.channel.send({ type: "ended", epoch, status });
    }
    catch { /* The caller may have disconnected while playback ended. */ }
    record.channel.close();
}

function schedulePlaybackChunk(record: ActiveChannel, message: unknown): void {
    const playback = record.playback;
    if (!message || typeof message !== "object") throw new Error("Invalid playback message.");
    const value = message as { type?: unknown; data?: unknown };
    // Stop stays valid after "end": a caller sends all its audio and "end", then interrupts it.
    if (value.type === "stop" && Object.keys(value).length === 1) {
        if (playback && !playback.ended) void finishPlayback(record, "stopped");
        return;
    }
    if (!playback || playback.ending || playback.ended) throw new Error("Playback is already ending.");
    if (value.type === "end" && Object.keys(value).length === 1) {
        playback.ending = true;
        if (playback.sources.size === 0) void finishPlayback(record, "finished");
        return;
    }
    if (value.type !== "chunk" || Object.keys(value).length !== 2 || !(value.data instanceof ArrayBuffer)
        || value.data.byteLength === 0 || value.data.byteLength % 4 !== 0
        || value.data.byteLength > MAX_SERVICE_CHANNEL_MESSAGE_BYTES - 128) throw new Error("Invalid playback PCM chunk.");
    const sampleCount = value.data.byteLength / 4;
    const duration = sampleCount / playback.sampleRate;
    if (playback.queuedSeconds + duration > 5) {
        record.channel.close({ code: "channel-backpressure", message: "Playback exceeded the 5-second audio queue limit." });
        finish(record, "channel-backpressure", "Playback exceeded the 5-second audio queue limit.", false);
        return;
    }
    const view = new DataView(value.data);
    const samples = new Float32Array(sampleCount);
    for (let index = 0; index < sampleCount; index++) {
        const sample = view.getFloat32(index * 4, true);
        if (!Number.isFinite(sample)) throw new Error("Playback PCM samples must be finite.");
        samples[index] = sample;
    }
    const buffer = sharedContext.createBuffer(1, sampleCount, playback.sampleRate);
    buffer.copyToChannel(samples, 0);
    const source = sharedContext.createBufferSource();
    source.buffer = buffer;
    source.connect(sharedContext.destination);
    const startTime = Math.max(playback.nextStartTime, sharedContext.currentTime + 0.02);
    playback.nextStartTime = startTime + duration;
    playback.queuedSeconds += duration;
    playback.sources.add(source);
    source.onended = () => {
        source.disconnect();
        playback.sources.delete(source);
        playback.queuedSeconds = Math.max(0, playback.queuedSeconds - duration);
        if (playback.ending && playback.sources.size === 0) void finishPlayback(record, "finished");
    };
    void sharedContext.resume().then(() => { if (!playback.ended) source.start(startTime); }).catch((error: unknown) => {
        record.channel.close({ code: "handler-closed", message: errMessage(error, "Audio playback failed.") });
    });
}

function receivePlaybackMessage(record: ActiveChannel, message: unknown): void {
    const playback = record.playback;
    if (!playback) return;
    try { schedulePlaybackChunk(record, message); }
    catch (error: unknown) {
        if (!record.closed) {
            record.channel.close({ code: "rejected", message: errMessage(error, "Invalid playback message.") });
            finish(record, "rejected", errMessage(error, "Invalid playback message."), false);
        }
    }
}

function finish(record: ActiveChannel, code: CapabilityErrorCode, message: string, report = true): void {
    if (record.closed) return;
    record.closed = true;
    stopPlayback(record);
    channels.delete(record.channelId);
    if (record.source) {
        record.source.subscribers.delete(record);
        record.queue = [];
        void releaseSource(record.source);
    }
    if (report) ipcRenderer.send(CONTROL_CHANNEL, { type: "channel-closed", channelId: record.channelId, code, message });
}

ipcRenderer.on(OPEN_CHANNEL, (event: Electron.IpcRendererEvent, message: OpenChannelMessage) => {
    const port = event.ports[0];
    if (!port || !message || typeof message.channelId !== "string" || message.epoch !== epoch
        || !message.open || (message.kind !== "capture" && message.kind !== "play")) {
        port?.close();
        return;
    }
    const channel = createRendererCapabilityChannel(port);
    const record: ActiveChannel = { channelId: message.channelId, channel, kind: message.kind, closed: false, queue: [], draining: false };
    channels.set(message.channelId, record);
    channel.onClose((reason) => finish(record, reason.code, reason.message));
    if (message.kind === "play") {
        const sampleRate = (message.open as { sampleRate?: unknown }).sampleRate;
        if (!Number.isInteger(sampleRate) || (sampleRate as number) < 8000 || (sampleRate as number) > 192000) {
            channel.close({ code: "rejected", message: "Invalid playback sample rate." });
            finish(record, "rejected", "Invalid playback sample rate.");
            return;
        }
        record.playback = { sampleRate: sampleRate as number, nextStartTime: sharedContext.currentTime, queuedSeconds: 0,
            sources: new Set(), ending: false, ended: false };
        channel.onMessage((value) => receivePlaybackMessage(record, value));
    }
    // The listener and channel state exist before main is told the transferred port is usable.
    ipcRenderer.send(CONTROL_CHANNEL, { type: "channel-ready", channelId: message.channelId });
    if (message.kind === "capture" && (message.open as CaptureOptions).source) void attach(record, message.open as CaptureOptions);
    else if (message.kind === "capture") {
        channel.close({ code: "rejected", message: "Invalid capture options." });
        finish(record, "rejected", "Invalid capture options.");
    }
});

ipcRenderer.on(CLOSE_CHANNEL, (_event: Electron.IpcRendererEvent, message: { channelId?: unknown; code?: unknown; message?: unknown }) => {
    if (typeof message?.channelId !== "string") return;
    const record = channels.get(message.channelId);
    if (!record) return;
    const code = isCapabilityErrorCode(message.code)
        ? message.code as CapabilityErrorCode : "cancelled";
    const reason = typeof message.message === "string" ? message.message : "Audio channel closed.";
    record.channel.close({ code, message: reason });
    finish(record, code, reason);
});

ipcRenderer.send(CONTROL_CHANNEL, { type: "ready", epoch });

window.addEventListener("beforeunload", () => {
    for (const record of channels.values()) finish(record, "handler-closed", "Audio window closed.", false);
    for (const source of sources.values()) void source.capture.stop();
    sources.clear();
    publishCaptureCount();
    void sharedContext.close().catch(() => {});
});
