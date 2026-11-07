import { createRendererCapabilityChannel } from "../api/renderer-capability-channel";
import { errMessage } from "../../shared/utils";
import { PcmAudioCapture } from "../ui/speech/PcmAudioCapture";
import { ComputerAudioGate } from "../ui/speech/ComputerAudioGate";
import type { CapabilityChannel, CapabilityErrorCode } from "../api/types/capabilities";
import { MAX_SERVICE_CHANNEL_MESSAGE_BYTES } from "../../shared/capability-limits";
import { AUDIO_DEVICES_REQUEST, AUDIO_DEVICES_REPLY, type AudioDevicesRequest, type AudioDevicesReply } from "../../ipc/audio-channels";

const { ipcRenderer } = require("electron") as typeof import("electron");
const CONTROL_CHANNEL = "persephone:audio-control";
const ARM_CHANNEL = "persephone:audio-arm-capture";
const CLEAR_CHANNEL = "persephone:audio-clear-capture";
const OPEN_CHANNEL = "persephone:audio-open-channel";
const CLOSE_CHANNEL = "persephone:audio-close-channel";
const epoch = Number(new URL(location.href).searchParams.get("epoch"));

interface CaptureOptions {
    source: "microphone" | "computer";
    deviceId?: string;
    echoCancel?: boolean;
}

interface SharedSource {
    key: string;
    source: CaptureOptions["source"];
    capture: PcmAudioCapture;
    subscribers: Set<ActiveChannel>;
    gate?: ComputerAudioGate;
    starting: Promise<void>;
    active: boolean;
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
        : `microphone\u0000${options.deviceId ?? "default"}\u0000${options.echoCancel ?? true}`;
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
                noiseSuppression: true,
                echoCancellation: options.echoCancel ?? true,
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

async function acquireSource(options: CaptureOptions): Promise<SharedSource> {
    const key = sourceKey(options);
    const existing = sources.get(key);
    if (existing) {
        await existing.starting;
        return existing;
    }
    const source: SharedSource = {
        key, source: options.source, capture: new PcmAudioCapture(), subscribers: new Set(),
        ...(options.source === "computer" ? { gate: new ComputerAudioGate() } : {}),
        starting: Promise.resolve(), active: false,
    };
    sources.set(key, source);
    source.starting = (async () => {
        const stream = await requestStream(options);
        try {
            await source.capture.start(stream, (data, timeMs) => onCaptureChunk(source, data, timeMs), () => undefined, sharedContext);
            source.active = true;
            publishCaptureCount();
        } catch (error) {
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
    if (source.subscribers.size) return;
    if (sources.get(source.key) === source) sources.delete(source.key);
    await source.starting.catch(() => {});
    await source.capture.stop();
    source.active = false;
    publishCaptureCount();
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
    void ipcRenderer.invoke(CLEAR_CHANNEL).catch(() => {});
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
    const code = typeof message.code === "string" && ["no-handler", "untrusted", "handler-closed", "crashed", "cancelled", "timeout", "cycle", "payload-too-large", "busy", "rejected", "permission-denied", "channel-backpressure", "channel-closed"].includes(message.code)
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
