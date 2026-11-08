import { MicrophoneAudioPipeline } from "./MicrophoneAudioPipeline";
import type { MicrophoneCleaningOptions } from "./microphone-cleaning-types";
import { errMessage } from "../../../shared/utils";

const OUTPUT_SAMPLE_RATE = 16_000;
const CHUNK_SAMPLES = 3_200;
const WORKLET_SOURCE = `class PersephoneSpeechProcessor extends AudioWorkletProcessor {
    constructor() { super(); this.flushRequested = false; this.pending = 0; this.dropped = 0; this.port.onmessage = ({ data }) => { if (data?.type === "flush") this.flushRequested = true; else if (data?.type === "ack") this.pending = Math.max(0, this.pending - 1); }; }
    process(inputs) {
        const channels = inputs[0];
        if (!channels || !channels.length) { if (this.flushRequested) { this.port.postMessage({ type: "flushed" }); return false; } return true; }
        const mono = new Float32Array(channels[0].length); let energy = 0;
        for (let i = 0; i < mono.length; i++) { let sum = 0; for (const channel of channels) sum += channel[i] || 0; mono[i] = sum / channels.length; energy += mono[i] * mono[i]; }
        if (this.pending < 16) {
            if (this.dropped) { this.port.postMessage({ type: "discontinuity", dropped: this.dropped }); this.dropped = 0; }
            this.port.postMessage({ type: "level", value: Math.sqrt(energy / Math.max(1, mono.length)), durationMs: mono.length / sampleRate * 1000 });
            this.pending++; this.port.postMessage({ type: "samples", data: mono, frame: currentFrame }, [mono.buffer]);
        } else this.dropped += mono.length;
        if (this.flushRequested) { this.port.postMessage({ type: "flushed" }); return false; } return true;
    }
}
registerProcessor("persephone-speech-capture", PersephoneSpeechProcessor);`;

const workletModules = new WeakMap<AudioContext, Promise<void>>();

function loadWorklet(context: AudioContext): Promise<void> {
    let loading = workletModules.get(context);
    if (!loading) {
        const url = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: "text/javascript" }));
        loading = context.audioWorklet.addModule(url).catch((error: unknown) => {
            workletModules.delete(context);
            throw error;
        }).finally(() => URL.revokeObjectURL(url));
        workletModules.set(context, loading);
    }
    return loading;
}

/** Captures one source, downmixes it and emits bounded mono s16le chunks at 16 kHz. */
export class PcmAudioCapture {
    private context: AudioContext | undefined;
    private source: MediaStreamAudioSourceNode | undefined;
    private node: AudioWorkletNode | undefined;
    private mute: GainNode | undefined;
    private stream: MediaStream | undefined;
    private samples = new Float32Array(0);
    private sampleBase = 0;
    private nextSample = 0;
    private remainder: number[] = [];
    private stopped = false;
    private flushResolve: (() => void) | undefined;
    private onChunk: ((data: ArrayBuffer, captureTimeMs: number) => void) | undefined;
    private originMs: number | undefined;
    private emittedSamples = 0;
    private ownsContext = true;
    private cleaning: MicrophoneAudioPipeline | undefined;
    private inputRate = 0;
    private disposers: Array<() => void> = [];
    private onLevel: ((level: number, durationMs: number) => void) | undefined;
    private status: ((mode: string, reason: string) => void) | undefined;
    private requestedCleaning: MicrophoneCleaningOptions | undefined;
    private reconfiguring = false;
    private removeTrackListener: (() => void) | undefined;
    private discontinuity = false;
    private currentInputFrame: number | undefined;

    public async start(stream: MediaStream, onChunk: (data: ArrayBuffer, captureTimeMs: number) => void, onLevel: (level: number, durationMs: number) => void, sharedContext?: AudioContext, cleaning?: MicrophoneCleaningOptions, onStatus?: (mode: string, reason: string) => void): Promise<void> {
        this.stream = stream;
        this.onChunk = onChunk;
        this.onLevel = onLevel;
        this.status = onStatus;
        this.ownsContext = !sharedContext;
        this.removeTrackListener?.();
        const track = stream.getAudioTracks()[0];
        if (track && cleaning) {
            const effective = track.getSettings();
            console.info("Microphone capture settings", { echoCancellation: effective.echoCancellation, noiseSuppression: effective.noiseSuppression, autoGainControl: effective.autoGainControl, sampleRate: effective.sampleRate });
            const ended = (): void => { this.status?.("failed", "Microphone disconnected"); void this.stop(); };
            track.addEventListener("ended", ended);
            this.removeTrackListener = () => track.removeEventListener("ended", ended);
        }
        try {
            this.context = sharedContext ?? new AudioContext({ sampleRate: cleaning?.enabled ? 48_000 : OUTPUT_SAMPLE_RATE });
            await loadWorklet(this.context);
            await this.context.resume();
        } catch (error) {
            if (sharedContext) throw error;
            await this.context?.close().catch(() => {});
            this.context = new AudioContext();
            try { await loadWorklet(this.context); }
            catch (error: unknown) { await this.context.close().catch(() => {}); throw error; }
        }
        if (this.stopped) {
            stream.getTracks().forEach((track) => track.stop());
            if (this.ownsContext) await this.context.close().catch(() => {});
            this.context = undefined;
            return;
        }
        if (cleaning?.enabled) {
            this.cleaning = new MicrophoneAudioPipeline(this.context.sampleRate, cleaning, (samples, rate) => {
                this.resetAfterDiscontinuity(this.currentInputFrame, onChunk);
                this.consume(samples, onChunk, rate);
            }, onStatus, () => { this.discontinuity = true; });
            await this.cleaning.start();
            if (this.stopped) { this.cleaning.stop(); return; }
        }
        this.source = this.context.createMediaStreamSource(stream);
        this.node = new AudioWorkletNode(this.context, "persephone-speech-capture", { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
        this.mute = this.context.createGain();
        this.mute.gain.value = 0;
        this.source.connect(this.node);
        this.node.connect(this.mute);
        this.mute.connect(this.context.destination);
        this.node.port.onmessage = ({ data }: MessageEvent<{ type: string; value?: number; data?: Float32Array; durationMs?: number; frame?: number }>): void => {
            if (data.type === "flushed") { this.flushResolve?.(); this.flushResolve = undefined; return; }
            if (data.type === "discontinuity") {
                this.discontinuity = true;
                this.cleaning?.fallbackToNotch("Microphone input queue overflow; audio was dropped");
                return;
            }
            if (data.type === "level" && typeof data.value === "number") onLevel(data.value, data.durationMs ?? 0);
            if (data.type === "samples" && data.data && !this.stopped) {
                this.node?.port.postMessage({ type: "ack" });
                this.currentInputFrame = data.frame;
                if (this.originMs === undefined && data.frame !== undefined && this.context) {
                    const timestamp = this.context.getOutputTimestamp();
                    this.originMs = timestamp.performanceTime + (data.frame / this.context.sampleRate - timestamp.contextTime) * 1000 - this.emittedSamples * 1000 / OUTPUT_SAMPLE_RATE;
                }
                if (this.cleaning) { this.cleaning.push(data.data); this.resetAfterDiscontinuity(data.frame, onChunk); }
                else { this.resetAfterDiscontinuity(data.frame, onChunk); this.consume(data.data, onChunk, this.context?.sampleRate ?? OUTPUT_SAMPLE_RATE); }
                this.currentInputFrame = undefined;
            }
        };
    }

    public async flush(): Promise<void> {
        if (!this.node || this.stopped) return;
        await new Promise<void>((resolve) => {
            let settled = false;
            const finish = (): void => { if (settled) return; settled = true; clearTimeout(timer); this.flushResolve = undefined; resolve(); };
            const timer = setTimeout(finish, 150);
            this.flushResolve = finish;
            try { this.node?.port.postMessage({ type: "flush" }); } catch { finish(); }
        });
        await this.cleaning?.flush();
        if (this.remainder.length) this.emit(this.onChunk ?? (() => {}), this.remainder.length);
    }

    public updateCleaning(options: MicrophoneCleaningOptions): void {
        if (this.reconfiguring) this.requestedCleaning = options;
        else this.cleaning?.update(options);
    }

    private resetAfterDiscontinuity(frame: number | undefined, onChunk: (data: ArrayBuffer, captureTimeMs: number) => void): void {
        if (!this.discontinuity || frame === undefined || !this.context) return;
        if (this.remainder.length) this.emit(onChunk, this.remainder.length);
        this.samples = new Float32Array(0); this.sampleBase = 0; this.nextSample = 0; this.inputRate = 0;
        const timestamp = this.context.getOutputTimestamp();
        this.originMs = timestamp.performanceTime + (frame / this.context.sampleRate - timestamp.contextTime) * 1000 - this.emittedSamples * 1000 / OUTPUT_SAMPLE_RATE;
        this.discontinuity = false;
    }

    public onStop(dispose: () => void): void { if (this.stopped) dispose(); else this.disposers.push(dispose); }

    /** Restart a private microphone capture while preserving the stream and consumer callbacks. */
    public async reconfigureMicrophone(options: MicrophoneCleaningOptions): Promise<void> {
        this.requestedCleaning = options;
        if (this.reconfiguring || this.stopped) return;
        this.reconfiguring = true;
        try {
            while (this.requestedCleaning && !this.stopped) {
                const next = this.requestedCleaning;
                this.requestedCleaning = undefined;
                const stream = this.stream, chunk = this.onChunk, level = this.onLevel;
                if (!stream || !chunk || !level || !this.ownsContext) return;
                this.status?.("restart", "");
                await this.flush();
                if (this.stopped) return;
                try { this.node?.port.close(); } catch { /* already closed */ }
                this.source?.disconnect(); this.node?.disconnect(); this.mute?.disconnect();
                this.cleaning?.stop(); this.cleaning = undefined;
                await this.context?.close().catch(() => {});
                this.context = undefined; this.source = undefined; this.node = undefined; this.mute = undefined;
                this.samples = new Float32Array(0); this.sampleBase = 0; this.nextSample = 0; this.inputRate = 0; this.originMs = undefined;
                if (this.stopped) return;
                await stream.getAudioTracks()[0]?.applyConstraints({ channelCount: 1, echoCancellation: true, noiseSuppression: !next.enabled, autoGainControl: true });
                if (this.stopped) return;
                await this.start(stream, chunk, level, undefined, next, this.status);
            }
        } catch (error) {
            this.status?.("failed", errMessage(error, "Microphone restart failed"));
            await this.stop();
        } finally { this.reconfiguring = false; }
    }

    public async stop(): Promise<void> {
        if (this.stopped) return;
        this.stopped = true;
        this.removeTrackListener?.(); this.removeTrackListener = undefined;
        for (const dispose of this.disposers.splice(0)) dispose();
        this.cleaning?.stop();
        this.cleaning = undefined;
        try { this.node?.port.close(); } catch { /* already closed */ }
        this.source?.disconnect();
        this.node?.disconnect();
        this.mute?.disconnect();
        this.stream?.getTracks().forEach((track) => track.stop());
        if (this.ownsContext) await this.context?.close().catch(() => {});
        this.source = undefined;
        this.node = undefined;
        this.mute = undefined;
        this.context = undefined;
        this.stream = undefined;
        this.onChunk = undefined;
        this.onLevel = undefined;
        this.samples = new Float32Array(0);
        this.remainder = [];
    }

    private consume(input: Float32Array, onChunk: (data: ArrayBuffer, captureTimeMs: number) => void, inputRate: number): void {
        if (this.inputRate !== inputRate) { this.inputRate = inputRate; this.samples = new Float32Array(0); this.sampleBase = 0; this.nextSample = 0; }
        const merged = new Float32Array(this.samples.length + input.length);
        merged.set(this.samples);
        merged.set(input, this.samples.length);
        const end = this.sampleBase + merged.length;
        const ratio = inputRate / OUTPUT_SAMPLE_RATE;
        while (this.nextSample + 1 < end) {
            const left = Math.floor(this.nextSample);
            const offset = left - this.sampleBase;
            const fraction = this.nextSample - left;
            this.remainder.push(merged[offset] * (1 - fraction) + merged[offset + 1] * fraction);
            this.nextSample += ratio;
            if (this.remainder.length >= CHUNK_SAMPLES) this.emit(onChunk, CHUNK_SAMPLES);
        }
        const discard = Math.max(0, Math.floor(this.nextSample) - this.sampleBase);
        this.samples = merged.slice(discard);
        this.sampleBase += discard;
    }

    private emit(onChunk: (data: ArrayBuffer, captureTimeMs: number) => void, count: number): void {
        const data = this.remainder.splice(0, count);
        const buffer = new ArrayBuffer(data.length * 2);
        const view = new DataView(buffer);
        data.forEach((sample, index) => {
            const bounded = Math.max(-1, Math.min(1, sample));
            view.setInt16(index * 2, bounded < 0 ? bounded * 0x8000 : bounded * 0x7fff, true);
        });
        const captureTimeMs = (this.originMs ?? performance.now()) + this.emittedSamples * 1000 / OUTPUT_SAMPLE_RATE;
        this.emittedSamples += data.length;
        onChunk(buffer, captureTimeMs);
    }
}
