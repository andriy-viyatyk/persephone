import { api } from "../../../ipc/renderer/api";
import type { AudioProcessingMode } from "../../../ipc/audio-channels";
import { PcmAudioCapture, type ReopenedStream } from "../../audio/dsp/PcmAudioCapture";
import { resolveMicrophoneDevice } from "../../audio/dsp/microphone-device";
import { settings } from "../settings";
import { openPrivateLoopback } from "./private-loopback";
import { microphoneOptions, reportMicrophoneStatus, watchMicrophoneSettings } from "./microphone-settings";

/** Reopening the default microphone after its device disappears (a headset unplugged). */
const MICROPHONE_REOPEN = {
    /** Windows can take a moment to promote the next device to default, so try a few times. */
    attempts: 5,
    /** Pause between attempts. */
    delayMs: 400,
};

export interface MicrophoneCaptureOptions {
    purpose: "voice-typing" | "transcript";
    isCurrent: () => boolean;
    sharedContext?: AudioContext;
    /** The caller's own computer-audio stream to reuse as the echo reference; read each time the reference is (re)acquired. */
    borrowedLoopbackStream?: () => MediaStream | undefined;
    onChunk: (data: ArrayBuffer, captureTimeMs: number) => void;
    onLevel: (level: number, durationMs: number) => void;
    onStatus?: (mode: AudioProcessingMode, reason: string) => void;
    onFailed: (reason: string) => void;
}

export interface OpenedMicrophoneCapture {
    capture: PcmAudioCapture;
    stream: MediaStream;
    context: AudioContext;
    ownsContext: boolean;
    startedAt: number;
}

/** Opens the Windows default microphone; undefined when the caller stopped while access was being armed. */
async function requestMicrophone(isCurrent: () => boolean): Promise<MediaStream | undefined> {
    await api.armVoiceTypingMicrophone();
    try {
        if (!isCurrent()) return undefined;
        return await navigator.mediaDevices.getUserMedia({ audio: {
            channelCount: 1,
            echoCancellation: process.platform !== "win32",
            noiseSuppression: !(settings.get("microphone.clean") || process.platform === "win32"),
            autoGainControl: true,
        } });
    } finally {
        await api.clearVoiceTypingMicrophone().catch(() => {});
    }
}

/** Opens the current default microphone again, retrying while Windows switches devices. */
async function reopenMicrophone(isCurrent: () => boolean): Promise<ReopenedStream> {
    for (let attempt = 1; ; attempt++) {
        try {
            const stream = await requestMicrophone(isCurrent);
            if (!stream) throw new Error("Microphone capture ended");
            if (stream.getAudioTracks()[0]?.readyState === "live") {
                await resolveMicrophoneDevice(stream);
                return { stream, cleaning: microphoneOptions(stream) };
            }
            stream.getTracks().forEach((track) => track.stop());
            throw new Error("Microphone disconnected");
        } catch (error) {
            if (attempt >= MICROPHONE_REOPEN.attempts || !isCurrent()) throw error;
            await new Promise((resolve) => setTimeout(resolve, MICROPHONE_REOPEN.delayMs));
        }
    }
}

export class MicrophoneCapture {
    public static async open(options: MicrophoneCaptureOptions): Promise<OpenedMicrophoneCapture | undefined> {
        let stream: MediaStream | undefined;
        let capture: PcmAudioCapture | undefined;
        const ownsContext = !options.sharedContext;
        let context = options.sharedContext;
        try {
            stream = await requestMicrophone(options.isCurrent);
            if (!stream) return undefined;
            await resolveMicrophoneDevice(stream);
            if (!options.isCurrent()) { stream.getTracks().forEach((track) => track.stop()); return undefined; }
            context ??= new AudioContext();
            const captureContext = context;
            capture = new PcmAudioCapture();
            const startedAt = Date.now();
            const status = (mode: AudioProcessingMode, reason: string): void => {
                reportMicrophoneStatus(mode, reason);
                options.onStatus?.(mode, reason);
                if (mode === "failed") options.onFailed(reason);
            };
            await capture.start({
                stream,
                onChunk: options.onChunk,
                onLevel: options.onLevel,
                sharedContext: context,
                cleaning: microphoneOptions(stream),
                onStatus: status,
                referenceAcquire: process.platform === "win32"
                    ? () => openPrivateLoopback(captureContext, options.borrowedLoopbackStream?.())
                    : undefined,
                ownsStream: true,
                reopenStream: () => reopenMicrophone(options.isCurrent),
            });
            if (!options.isCurrent()) { await capture.stop(); if (ownsContext) await context.close().catch(() => {}); return undefined; }
            watchMicrophoneSettings(capture, stream);
            return { capture, stream, context, ownsContext, startedAt };
        } catch (error) {
            await api.clearVoiceTypingMicrophone().catch(() => {});
            stream?.getTracks().forEach((track) => track.stop());
            await capture?.stop();
            if (ownsContext) await context?.close().catch(() => {});
            throw error;
        }
    }
}

export class TranscriptDisplayCapture {
    public static async open(isCurrent: () => boolean): Promise<MediaStream | undefined> {
        await api.armTranscriptLoopback();
        let stream: MediaStream | undefined;
        try {
            if (!isCurrent()) return undefined;
            stream = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: true });
        } finally {
            await api.clearTranscriptLoopback().catch(() => {});
        }
        stream.getVideoTracks().forEach((track) => track.stop());
        stream.getAudioTracks().forEach((track) => { track.enabled = true; });
        return stream;
    }
}
