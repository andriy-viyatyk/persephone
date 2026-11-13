import { api } from "../../../ipc/renderer/api";
import { PcmAudioCapture } from "../../audio/dsp/PcmAudioCapture";
import { resolveMicrophoneDevice } from "../../audio/dsp/microphone-device";
import { settings } from "../settings";
import { openPrivateLoopback } from "./private-loopback";
import { microphoneOptions, reportMicrophoneStatus, watchMicrophoneSettings } from "./microphone-settings";

export interface MicrophoneCaptureOptions {
    purpose: "voice-typing" | "transcript";
    isCurrent: () => boolean;
    sharedContext?: AudioContext;
    borrowedLoopbackStream?: MediaStream;
    onChunk: (data: ArrayBuffer, captureTimeMs: number) => void;
    onLevel: (level: number, durationMs: number) => void;
    onStatus?: (mode: string, reason: string) => void;
    onFailed: (reason: string) => void;
}

export interface OpenedMicrophoneCapture {
    capture: PcmAudioCapture;
    stream: MediaStream;
    context: AudioContext;
    ownsContext: boolean;
    startedAt: number;
}

export class MicrophoneCapture {
    public static async open(options: MicrophoneCaptureOptions): Promise<OpenedMicrophoneCapture | undefined> {
        let stream: MediaStream | undefined;
        let capture: PcmAudioCapture | undefined;
        const ownsContext = !options.sharedContext;
        let context = options.sharedContext;
        try {
            await api.armVoiceTypingMicrophone();
            try {
                if (!options.isCurrent()) return undefined;
                stream = await navigator.mediaDevices.getUserMedia({ audio: {
                    channelCount: 1,
                    echoCancellation: process.platform !== "win32",
                    noiseSuppression: !(settings.get("microphone.clean") || process.platform === "win32"),
                    autoGainControl: true,
                } });
            } finally {
                await api.clearVoiceTypingMicrophone().catch(() => {});
            }
            if (!stream) return undefined;
            await resolveMicrophoneDevice(stream);
            if (!options.isCurrent()) { stream.getTracks().forEach((track) => track.stop()); return undefined; }
            context ??= new AudioContext();
            const captureContext = context;
            capture = new PcmAudioCapture();
            const startedAt = Date.now();
            const status = (mode: string, reason: string): void => {
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
                    ? () => openPrivateLoopback(captureContext, options.borrowedLoopbackStream)
                    : undefined,
                ownsStream: true,
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
