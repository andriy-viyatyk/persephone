import { ECHO_TUNING } from "./echo-tuning";
import { errMessage } from "../../../shared/utils";
import type { AudioProcessingMode } from "../../../ipc/audio-channels";

const RATE = 16_000;
const HOP = 128;
const LEAD = ECHO_TUNING.referenceLeadMs * RATE / 1000;
const MAX_SAMPLES = ECHO_TUNING.maxPendingMs * RATE / 1000;

export interface LoopbackLease {
    context: AudioContext;
    subscribe(callback: (samples: Float32Array, frame: number) => void, ended: () => void): () => void;
    release(): void;
}

/** Streaming, low-pass resampler aligned to the AudioContext's frame clock. */
class ClockResampler {
    private samples: number[] = [];
    private base = 0;
    private next: number | undefined;
    private end: number | undefined;

    public constructor(private readonly rate: number) {}

    public reset(): void { this.samples = []; this.next = undefined; this.end = undefined; }

    public push(input: Float32Array, frame: number): { start: number; samples: number[]; gap: boolean } {
        const gap = this.end !== undefined && frame !== this.end;
        if (this.end === undefined || gap) {
            this.samples = [];
            this.base = frame;
            this.next = Math.ceil(frame * RATE / this.rate);
        }
        this.end = frame + input.length;
        for (const value of input) this.samples.push(value);
        const start = this.next ?? 0;
        const output: number[] = [];
        const cutoff = Math.min(1, RATE / this.rate);
        while ((this.next ?? 0) * this.rate / RATE + 8 < this.end) {
            const position = (this.next ?? 0) * this.rate / RATE;
            const center = Math.floor(position);
            let sum = 0, weight = 0;
            for (let index = -7; index <= 8; index++) {
                const offset = position - center - index;
                const argument = Math.PI * offset * cutoff;
                const sinc = Math.abs(argument) < 1e-8 ? 1 : Math.sin(argument) / argument;
                const coefficient = sinc * (0.5 + 0.5 * Math.cos(Math.PI * offset / 8)) * cutoff;
                sum += (this.samples[center + index - this.base] ?? 0) * coefficient;
                weight += coefficient;
            }
            output.push(weight ? sum / weight : 0);
            this.next = (this.next ?? 0) + 1;
        }
        const discard = Math.max(0, Math.floor((this.next ?? 0) * this.rate / RATE) - this.base - 8);
        this.samples.splice(0, discard);
        this.base += discard;
        return { start, samples: output, gap };
    }
}

interface LoopbackReferenceOptions {
    context: AudioContext;
    acquire?: () => Promise<LoopbackLease>;
    onPair: (microphone: Float32Array, reference: Float32Array, frame: number, count: number) => void;
    onStatus: (mode: AudioProcessingMode, reason: string) => void;
    onReset: () => void;
}

/** Aligns independent context-rate taps on their shared AudioContext clock. */
export class LoopbackReference {
    private readonly microphone: ClockResampler;
    private readonly reference: ClockResampler;
    private readonly microphoneSamples = new Map<number, number>();
    private readonly referenceSamples = new Map<number, number>();
    private next: number | undefined;
    private lastReference = 0;
    private lease: LoopbackLease | undefined;
    private unsubscribe: (() => void) | undefined;
    private timer: ReturnType<typeof setInterval> | undefined;
    private stopped = false;
    private referenceActive = false;
    private acquiring = false;
    private retryAt = 0;

    private constructor(private readonly options: LoopbackReferenceOptions) {
        this.microphone = new ClockResampler(options.context.sampleRate);
        this.reference = new ClockResampler(options.context.sampleRate);
    }

    public static start(options: LoopbackReferenceOptions): LoopbackReference {
        const instance = new LoopbackReference(options);
        if (!options.acquire) return instance;
        instance.timer = setInterval(() => {
            if (instance.referenceActive && performance.now() - instance.lastReference > ECHO_TUNING.referenceStallMs) instance.fail("Loopback stalled");
            if (!instance.referenceActive && !instance.acquiring && performance.now() >= instance.retryAt) void instance.acquire();
        }, 100);
        void instance.acquire();
        return instance;
    }

    private async acquire(): Promise<void> {
        if (!this.options.acquire || this.stopped || this.acquiring) return;
        this.acquiring = true;
        try {
            const lease = await this.options.acquire();
            if (this.stopped) { lease.release(); return; }
            if (lease.context !== this.options.context) { lease.release(); throw new Error("Loopback and microphone must share an AudioContext"); }
            this.lease = lease;
            this.reset();
            this.referenceActive = true;
            this.lastReference = performance.now();
            this.unsubscribe = lease.subscribe((samples, frame) => this.pushReference(samples, frame), () => this.fail("Loopback disconnected"));
            this.options.onStatus("reference-ready", "");
        } catch (error) { if (!this.stopped) this.fail(errMessage(error, "Loopback unavailable")); }
        finally { this.acquiring = false; }
    }

    public pushMicrophone(samples: Float32Array, frame: number): void {
        if (this.stopped) return;
        const result = this.microphone.push(samples, frame);
        if (result.gap) this.reset("microphone");
        this.next ??= result.start;
        result.samples.forEach((sample, index) => this.microphoneSamples.set(result.start + index, sample));
        if (this.microphoneSamples.size > MAX_SAMPLES) this.fail("Loopback alignment queue exceeded its limit");
        this.drain();
    }

    public pushReference(samples: Float32Array, frame: number): void {
        if (this.stopped) return;
        const result = this.reference.push(samples, frame);
        if (result.gap) this.reset("reference");
        this.lastReference = performance.now();
        result.samples.forEach((sample, index) => this.referenceSamples.set(result.start + index, sample));
        if (this.referenceSamples.size > MAX_SAMPLES) {
            const oldest = result.start + result.samples.length - MAX_SAMPLES;
            for (const key of this.referenceSamples.keys()) if (key < oldest) this.referenceSamples.delete(key);
        }
        this.drain();
    }

    public stop(): void {
        if (this.stopped) return;
        this.stopped = true;
        if (this.timer) clearInterval(this.timer);
        this.unsubscribe?.();
        this.lease?.release();
        this.microphoneSamples.clear();
        this.referenceSamples.clear();
    }

    public retry(): void {
        if (!this.options.acquire || this.stopped) return;
        if (this.referenceActive) this.fail("Restarting computer audio reference");
        this.retryAt = 0;
        void this.acquire();
    }

    public async flush(): Promise<void> {
        if (this.referenceActive && this.microphoneSamples.size) await new Promise<void>((resolve) => setTimeout(resolve, ECHO_TUNING.referenceLeadMs + 30));
        this.drain();
        if (this.next === undefined || !this.microphoneSamples.size) return;
        if (this.referenceActive && !this.referenceSamples.has(this.next + LEAD)) this.fail("Loopback ended before the final microphone samples");
        this.drain();
        if (this.next === undefined || !this.microphoneSamples.size) return;
        const frame = this.next, microphone = new Float32Array(HOP), reference = new Float32Array(HOP);
        let count = 0;
        while (count < HOP && this.microphoneSamples.has(frame + count)) {
            microphone[count] = this.microphoneSamples.get(frame + count) ?? 0;
            reference[count] = this.referenceSamples.get(frame + count + LEAD) ?? 0;
            this.microphoneSamples.delete(frame + count);
            this.referenceSamples.delete(frame + count + LEAD);
            count++;
        }
        if (count) this.options.onPair(microphone, reference, frame, count);
        this.next += count;
    }

    private fail(reason: string): void {
        if (this.stopped) return;
        this.referenceActive = false;
        this.retryAt = performance.now() + 3000;
        this.unsubscribe?.(); this.unsubscribe = undefined;
        this.lease?.release(); this.lease = undefined;
        this.referenceSamples.clear();
        this.options.onStatus("reference-unavailable", reason);
        this.options.onReset();
        this.drain();
    }

    private reset(preserve?: "microphone" | "reference"): void {
        this.microphoneSamples.clear(); this.referenceSamples.clear(); this.next = undefined;
        if (preserve !== "microphone") this.microphone.reset();
        if (preserve !== "reference") this.reference.reset();
        this.options.onReset();
    }

    private drain(): void {
        while (this.next !== undefined && this.microphoneSamples.has(this.next + HOP - 1)) {
            if (this.referenceActive && !this.referenceSamples.has(this.next + LEAD + HOP - 1)) return;
            const mic = new Float32Array(HOP), ref = new Float32Array(HOP);
            for (let index = 0; index < HOP; index++) {
                const time = this.next + index;
                mic[index] = this.microphoneSamples.get(time) ?? 0;
                ref[index] = this.referenceActive ? this.referenceSamples.get(time + LEAD) ?? 0 : 0;
                this.microphoneSamples.delete(time);
                this.referenceSamples.delete(time + LEAD);
            }
            this.options.onPair(mic, ref, this.next, HOP);
            this.next += HOP;
        }
    }
}
