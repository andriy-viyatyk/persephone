import {
    AUDIO_DEVICES_REPLY, AUDIO_DEVICES_REQUEST, AUDIO_RETRY, AUDIO_SETTINGS_UPDATE,
    CLOSE_CHANNEL, CONTROL_CHANNEL, OPEN_CHANNEL, type AudioDevicesReply, type AudioDevicesRequest,
} from "../../ipc/audio-channels";
import { isCapabilityErrorCode, type CapabilityErrorCode } from "../../shared/capability-constants";
import { openDomServiceChannel } from "../../shared/service-channel-node";
import { toWireError } from "../../shared/wire-error";
import { CaptureSourcePool, type CaptureConsumer, type CaptureOptions } from "./CaptureSourcePool";
import { PlaybackChannel } from "./PlaybackChannel";

const { ipcRenderer } = require("electron") as typeof import("electron");
const epoch = Number(new URL(location.href).searchParams.get("epoch"));
const sharedContext = new AudioContext();
const capturePool = new CaptureSourcePool({
    invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
    send: (channel, value) => ipcRenderer.send(channel, value),
    mediaDevices: navigator.mediaDevices,
    sharedContext,
    epoch,
    publishCaptureCount: (count) => ipcRenderer.send(CONTROL_CHANNEL, { type: "capture-count", count }),
});

interface OpenChannelMessage { channelId: string; kind: "capture" | "play"; open: CaptureOptions | { sampleRate: number }; epoch: number }
interface ActiveChannel extends CaptureConsumer {
    kind: "capture" | "play";
    playback?: PlaybackChannel;
}

const channels = new Map<string, ActiveChannel>();

function finish(record: ActiveChannel, code: string, message: string, report = true): void {
    if (record.isClosed()) return;
    record.closed = true;
    record.queue.length = 0;
    channels.delete(record.channelId);
    record.playback?.dispose();
    capturePool.detach(record.channelId);
    if (report) ipcRenderer.send(CONTROL_CHANNEL, { type: "channel-closed", channelId: record.channelId, code, message });
}

function openChannel(event: Electron.IpcRendererEvent, message: OpenChannelMessage): void {
    const port = event.ports[0];
    if (!port || !message || typeof message.channelId !== "string" || message.epoch !== epoch
        || !message.open || (message.kind !== "capture" && message.kind !== "play")) {
        port?.close();
        return;
    }
    const channel = openDomServiceChannel(port, "capability");
    const record: ActiveChannel = {
        channelId: message.channelId, channel, kind: message.kind, closed: false, queue: [], draining: false,
        isClosed() { return this.closed; },
    };
    channels.set(message.channelId, record);
    channel.onClose((reason) => finish(record, reason.code, reason.message));
    if (message.kind === "play") {
        const sampleRate = (message.open as { sampleRate?: unknown }).sampleRate;
        if (!PlaybackChannel.isValidSampleRate(sampleRate)) {
            channel.close({ code: "rejected", message: "Invalid playback sample rate." });
            finish(record, "rejected", "Invalid playback sample rate.");
            return;
        }
        record.playback = new PlaybackChannel(channel, sharedContext, epoch, sampleRate,
            (code, reason, report) => finish(record, code, reason, report));
        channel.onMessage((value) => record.playback?.receiveMessage(value));
    }
    // Channel state and listeners exist before main is told that the transferred port is ready.
    ipcRenderer.send(CONTROL_CHANNEL, { type: "channel-ready", channelId: message.channelId });
    if (message.kind === "capture" && (message.open as CaptureOptions).source) {
        void capturePool.attach(record, message.open as CaptureOptions);
    } else if (message.kind === "capture") {
        channel.close({ code: "rejected", message: "Invalid capture options." });
        finish(record, "rejected", "Invalid capture options.");
    }
}

ipcRenderer.on(OPEN_CHANNEL, openChannel);
ipcRenderer.on(CLOSE_CHANNEL, (_event: Electron.IpcRendererEvent, message: { channelId?: unknown; code?: unknown; message?: unknown }) => {
    if (typeof message?.channelId !== "string") return;
    const record = channels.get(message.channelId);
    if (!record) return;
    const code: CapabilityErrorCode = isCapabilityErrorCode(message.code) ? message.code : "cancelled";
    const reason = typeof message.message === "string" ? message.message : "Audio channel closed.";
    record.channel.close({ code, message: reason });
    finish(record, code, reason);
});
ipcRenderer.on(AUDIO_DEVICES_REQUEST, (_event: Electron.IpcRendererEvent, request: AudioDevicesRequest) => {
    if (!request || typeof request.requestId !== "string" || request.epoch !== epoch) return;
    void capturePool.enumerateDevices().then((devices) => {
        const reply: AudioDevicesReply = { requestId: request.requestId, epoch, devices: devices
            .filter((device) => device.kind === "audioinput")
            .map((device) => ({ deviceId: device.deviceId, label: device.label || "", isDefault: device.deviceId === "default" })) };
        ipcRenderer.send(AUDIO_DEVICES_REPLY, reply);
    }).catch((error: unknown) => {
        const reply: AudioDevicesReply = { requestId: request.requestId, epoch, error: toWireError(error, "Device enumeration failed.") };
        ipcRenderer.send(AUDIO_DEVICES_REPLY, reply);
    });
});
ipcRenderer.on(AUDIO_SETTINGS_UPDATE, (_event: Electron.IpcRendererEvent, value: Parameters<CaptureSourcePool["updateSettings"]>[0]) => capturePool.updateSettings(value));
ipcRenderer.on(AUDIO_RETRY, () => capturePool.retryMicrophones());
ipcRenderer.send(CONTROL_CHANNEL, { type: "ready", epoch });

window.addEventListener("beforeunload", () => {
    for (const record of [...channels.values()]) finish(record, "handler-closed", "Audio window closed.", false);
    capturePool.stopAll();
    void sharedContext.close().catch(() => {});
});
