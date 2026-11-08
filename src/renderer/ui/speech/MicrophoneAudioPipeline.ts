import { MICROPHONE_TUNING, type MicrophoneCleaningOptions } from "./microphone-cleaning-types";

import { errMessage } from "../../../shared/utils";

/** Owns the worker and bounds the audio waiting on its message port. */
export class MicrophoneAudioPipeline {
    private worker: Worker | undefined;
    private pendingSamples = 0;
    private ready = false;
    private failed = false;
    private finishFlush: (() => void) | undefined;
    private waiting: Float32Array[] = [];
    private readyResolve: (() => void) | undefined;
    private droppedSamples = 0;
    private notchOnly = false;
    private flushPending = false;

    public constructor(private readonly sampleRate: number, private options: MicrophoneCleaningOptions,
        private readonly onSamples: (samples: Float32Array, rate: number) => void,
        private readonly onStatus: (mode: string, reason: string) => void = () => {},
        private readonly onDiscontinuity: () => void = () => {}) {}

    public async start(): Promise<void> {
        try {
            const worker = new Worker(new URL("./microphone-cleaning-worker.ts", import.meta.url), { type: "module" });
            this.attachWorker(worker);
            let bytes: ArrayBuffer | undefined;
            let loadError = "";
            try {
                const response = await fetch("app-asset://vendor/deepfilternet-web/df_bg.wasm", { signal: AbortSignal.timeout(10000) });
                if (!response.ok) throw new Error(`Model load failed (${response.status})`);
                bytes = await response.arrayBuffer();
            } catch (error) { loadError = errMessage(error); }
            if (!this.worker) return;
            worker.postMessage({ type: "init", rate: this.sampleRate, options: this.options, bytes, loadError }, bytes ? [bytes] : []);
            await new Promise<void>((resolve) => {
                const timer = setTimeout(() => { this.fail("Audio worker initialization timed out"); finish(); }, 10000);
                const finish = (): void => { clearTimeout(timer); this.readyResolve = undefined; resolve(); };
                this.readyResolve = finish;
            });
        } catch (error) { this.fail(errMessage(error)); }
    }

    public push(samples: Float32Array): void {
        if (this.failed) { this.onSamples(samples, this.sampleRate); return; }
        if (this.pendingSamples + samples.length > this.sampleRate * MICROPHONE_TUNING.maxPendingMs / 1000) {
            this.droppedSamples += this.pendingSamples;
            this.fallbackToNotch("Audio processing queue exceeded its limit");
            if (this.failed) { this.onSamples(samples, this.sampleRate); return; }
        }
        this.pendingSamples += samples.length;
        if (this.ready) this.post(samples); else this.waiting.push(samples);
    }

    public update(options: MicrophoneCleaningOptions): void { this.options = options; if (this.ready) this.worker?.postMessage({ type: "settings", options }); }

    public fallbackToNotch(reason: string): void {
        if (this.notchOnly) { this.fail(reason); return; }
        try {
            if (this.worker) this.worker.onmessage = null;
            this.worker?.terminate(); this.pendingSamples = 0; this.waiting = []; this.ready = false; this.notchOnly = true;
            this.onDiscontinuity();
            const worker = new Worker(new URL("./microphone-cleaning-worker.ts", import.meta.url), { type: "module" });
            this.attachWorker(worker);
            worker.postMessage({ type: "init", rate: this.sampleRate, options: this.options, loadError: reason });
        } catch (error) { this.fail(errMessage(error)); }
    }

    public async flush(): Promise<void> {
        if (!this.worker || this.failed) return;
        await new Promise<void>((resolve) => {
            const timer = setTimeout(() => { this.fail("Audio worker flush timed out"); finish(); }, MICROPHONE_TUNING.flushTimeoutMs);
            const finish = (): void => { clearTimeout(timer); this.finishFlush = undefined; resolve(); };
            this.finishFlush = finish;
            if (this.ready) this.worker?.postMessage({ type: "flush" }); else this.flushPending = true;
        });
    }

    public stop(): void { if (this.worker) this.worker.onmessage = null; this.worker?.terminate(); this.worker = undefined; this.waiting = []; this.readyResolve?.(); this.finishFlush?.(); }
    private attachWorker(worker: Worker): void {
        this.worker = worker;
        worker.onmessage = ({ data }): void => {
            if (data.type === "ready") {
                this.ready = true; worker.postMessage({ type: "settings", options: this.options });
                for (const samples of this.waiting) this.post(samples); this.waiting = []; this.readyResolve?.();
                if (this.flushPending) { this.flushPending = false; worker.postMessage({ type: "flush" }); }
            } else if (data.type === "samples") this.onSamples(data.samples, 48000);
            else if (data.type === "ack") this.pendingSamples -= data.count;
            else if (data.type === "status") this.onStatus(data.mode, data.reason);
            else if (data.type === "recover") this.fallbackToNotch(data.reason);
            else if (data.type === "load") this.onStatus("load", `${Number(data.ratio).toFixed(2)} / ${Math.round(this.pendingSamples * 1000 / this.sampleRate)} / ${data.deadlineMisses} / ${this.droppedSamples}`);
            else if (data.type === "flushed") this.finishFlush?.();
        };
        worker.onerror = (event): void => this.fail(event.message);
        worker.onmessageerror = (): void => this.fail("Worker message could not be read");
    }
    private post(samples: Float32Array): void { this.worker?.postMessage({ type: "samples", samples }, [samples.buffer]); }
    private fail(reason: string): void {
        if (this.failed) return;
        this.failed = true; if (this.worker) this.worker.onmessage = null; this.worker?.terminate(); this.worker = undefined;
        this.onDiscontinuity();
        this.onStatus("unfiltered", reason);
        for (const samples of this.waiting) this.onSamples(samples, this.sampleRate);
        this.waiting = []; this.readyResolve?.(); this.finishFlush?.();
    }
}
