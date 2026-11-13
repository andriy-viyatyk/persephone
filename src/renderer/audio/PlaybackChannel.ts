import { MAX_SERVICE_CHANNEL_MESSAGE_BYTES } from "../../shared/capability-limits";
import type { ServiceChannel } from "../../shared/service-channel";
import { errMessage } from "../../shared/utils";

// Playback bounds and timing stay together so this channel keeps the existing wire and schedule limits.
const MIN_SAMPLE_RATE = 8_000;
const MAX_SAMPLE_RATE = 192_000;
const MESSAGE_BYTE_ALLOWANCE = 128;
const MAX_QUEUED_SECONDS = 5;
const SCHEDULING_LEAD_SECONDS = 0.02;

interface PlaybackState {
    sampleRate: number;
    nextStartTime: number;
    queuedSeconds: number;
    sources: Set<AudioBufferSourceNode>;
    ending: boolean;
    ended: boolean;
}

/** Owns PCM scheduling and completion for one playback service channel. */
export class PlaybackChannel {
    private readonly playback: PlaybackState;

    public constructor(
        private readonly channel: ServiceChannel,
        private readonly sharedContext: AudioContext,
        private readonly epoch: number,
        sampleRate: number,
        private readonly retire: (code: string, message: string, report?: boolean) => void,
    ) {
        this.playback = { sampleRate, nextStartTime: sharedContext.currentTime, queuedSeconds: 0, sources: new Set(), ending: false, ended: false };
    }

    public static isValidSampleRate(sampleRate: unknown): sampleRate is number {
        return Number.isInteger(sampleRate) && (sampleRate as number) >= MIN_SAMPLE_RATE && (sampleRate as number) <= MAX_SAMPLE_RATE;
    }

    public receiveMessage(message: unknown): void {
        try { this.scheduleChunk(message); }
        catch (error: unknown) {
            const messageText = errMessage(error, "Invalid playback message.");
            this.channel.close({ code: "rejected", message: messageText });
            this.retire("rejected", messageText, false);
        }
    }

    public dispose(): void {
        this.stop();
    }

    private stop(): void {
        this.playback.ended = true;
        for (const source of this.playback.sources) {
            source.onended = null;
            try { source.stop(); } catch { /* already ended */ }
            source.disconnect();
        }
        this.playback.sources.clear();
        this.playback.queuedSeconds = 0;
    }

    private async finish(status: "finished" | "stopped"): Promise<void> {
        if (this.playback.ended) return;
        // Mark first: stopping sources fires their ended handlers, which must not report finished.
        this.playback.ended = true;
        if (status === "stopped") this.stop();
        try {
            if (!this.channel.writable) await this.channel.whenWritable();
            this.channel.send({ type: "ended", epoch: this.epoch, status });
        } catch { /* The caller may have disconnected while playback ended. */ }
        this.channel.close();
    }

    private scheduleChunk(message: unknown): void {
        if (!message || typeof message !== "object") throw new Error("Invalid playback message.");
        const value = message as { type?: unknown; data?: unknown };
        // Stop stays valid after end so a caller can interrupt its queued audio.
        if (value.type === "stop" && Object.keys(value).length === 1) {
            if (!this.playback.ended) void this.finish("stopped");
            return;
        }
        if (this.playback.ending || this.playback.ended) throw new Error("Playback is already ending.");
        if (value.type === "end" && Object.keys(value).length === 1) {
            this.playback.ending = true;
            if (this.playback.sources.size === 0) void this.finish("finished");
            return;
        }
        if (value.type !== "chunk" || Object.keys(value).length !== 2 || !(value.data instanceof ArrayBuffer)
            || value.data.byteLength === 0 || value.data.byteLength % 4 !== 0
            || value.data.byteLength > MAX_SERVICE_CHANNEL_MESSAGE_BYTES - MESSAGE_BYTE_ALLOWANCE) {
            throw new Error("Invalid playback PCM chunk.");
        }
        const sampleCount = value.data.byteLength / 4;
        const duration = sampleCount / this.playback.sampleRate;
        if (this.playback.queuedSeconds + duration > MAX_QUEUED_SECONDS) {
            const errorMessage = "Playback exceeded the 5-second audio queue limit.";
            this.channel.close({ code: "channel-backpressure", message: errorMessage });
            this.retire("channel-backpressure", errorMessage, false);
            return;
        }
        const view = new DataView(value.data);
        const samples = new Float32Array(sampleCount);
        for (let index = 0; index < sampleCount; index++) {
            const sample = view.getFloat32(index * 4, true);
            if (!Number.isFinite(sample)) throw new Error("Playback PCM samples must be finite.");
            samples[index] = sample;
        }
        const buffer = this.sharedContext.createBuffer(1, sampleCount, this.playback.sampleRate);
        buffer.copyToChannel(samples, 0);
        const source = this.sharedContext.createBufferSource();
        source.buffer = buffer;
        source.connect(this.sharedContext.destination);
        const startTime = Math.max(this.playback.nextStartTime, this.sharedContext.currentTime + SCHEDULING_LEAD_SECONDS);
        this.playback.nextStartTime = startTime + duration;
        this.playback.queuedSeconds += duration;
        this.playback.sources.add(source);
        source.onended = () => {
            source.disconnect();
            this.playback.sources.delete(source);
            this.playback.queuedSeconds = Math.max(0, this.playback.queuedSeconds - duration);
            if (this.playback.ending && this.playback.sources.size === 0) void this.finish("finished");
        };
        void this.sharedContext.resume().then(() => {
            if (!this.playback.ended) source.start(startTime);
        }).catch((error: unknown) => {
            this.channel.close({ code: "handler-closed", message: errMessage(error, "Audio playback failed.") });
        });
    }
}
