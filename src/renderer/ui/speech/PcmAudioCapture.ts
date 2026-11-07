const OUTPUT_SAMPLE_RATE = 16_000;
const CHUNK_SAMPLES = 3_200;
const WORKLET_SOURCE = `class PersephoneSpeechProcessor extends AudioWorkletProcessor {
    constructor() { super(); this.flushRequested = false; this.port.onmessage = ({ data }) => { if (data?.type === "flush") this.flushRequested = true; }; }
    process(inputs) {
        const channels = inputs[0];
        if (!channels || !channels.length) { if (this.flushRequested) { this.port.postMessage({ type: "flushed" }); return false; } return true; }
        const mono = new Float32Array(channels[0].length); let energy = 0;
        for (let i = 0; i < mono.length; i++) { let sum = 0; for (const channel of channels) sum += channel[i] || 0; mono[i] = sum / channels.length; energy += mono[i] * mono[i]; }
        this.port.postMessage({ type: "level", value: Math.sqrt(energy / Math.max(1, mono.length)), durationMs: mono.length / sampleRate * 1000 });
        this.port.postMessage({ type: "samples", data: mono, frame: currentFrame }, [mono.buffer]);
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

    public async start(stream: MediaStream, onChunk: (data: ArrayBuffer, captureTimeMs: number) => void, onLevel: (level: number, durationMs: number) => void, sharedContext?: AudioContext): Promise<void> {
        this.stream = stream;
        this.onChunk = onChunk;
        this.ownsContext = !sharedContext;
        try {
            this.context = sharedContext ?? new AudioContext({ sampleRate: OUTPUT_SAMPLE_RATE });
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
        this.source = this.context.createMediaStreamSource(stream);
        this.node = new AudioWorkletNode(this.context, "persephone-speech-capture", { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
        this.mute = this.context.createGain();
        this.mute.gain.value = 0;
        this.source.connect(this.node);
        this.node.connect(this.mute);
        this.mute.connect(this.context.destination);
        this.node.port.onmessage = ({ data }: MessageEvent<{ type: string; value?: number; data?: Float32Array; durationMs?: number; frame?: number }>): void => {
            if (data.type === "flushed") { this.flushResolve?.(); this.flushResolve = undefined; return; }
            if (data.type === "level" && typeof data.value === "number") onLevel(data.value, data.durationMs ?? 0);
            if (data.type === "samples" && data.data && !this.stopped) {
                if (this.originMs === undefined && data.frame !== undefined && this.context) {
                    const timestamp = this.context.getOutputTimestamp();
                    this.originMs = timestamp.performanceTime + (data.frame / this.context.sampleRate - timestamp.contextTime) * 1000;
                }
                this.consume(data.data, onChunk);
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
        if (this.remainder.length) this.emit(this.onChunk ?? (() => {}), this.remainder.length);
    }

    public async stop(): Promise<void> {
        if (this.stopped) return;
        this.stopped = true;
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
        this.samples = new Float32Array(0);
        this.remainder = [];
    }

    private consume(input: Float32Array, onChunk: (data: ArrayBuffer, captureTimeMs: number) => void): void {
        const context = this.context;
        if (!context) return;
        const merged = new Float32Array(this.samples.length + input.length);
        merged.set(this.samples);
        merged.set(input, this.samples.length);
        const end = this.sampleBase + merged.length;
        const ratio = context.sampleRate / OUTPUT_SAMPLE_RATE;
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
