import { ECHO_TUNING } from "./microphone-cleaning-types";
import type { MicrophoneCleaningOptions } from "../../../shared/microphone-cleaning-types";
import { errMessage } from "../../../shared/utils";

/** Serial worker client with bounded in-flight hops and an unfiltered fallback. */
export class DtlnAudioPipeline {
    private worker: Worker | undefined;
    private pending = 0;
    private ready = false;
    private failed = false;
    private generation = 0;
    private flushResolve: (() => void) | undefined;
    private deadline: ReturnType<typeof setTimeout> | undefined;

    public constructor(private options: MicrophoneCleaningOptions,
        private readonly onSamples: (samples: Float32Array, frame: number) => void,
        private readonly onStatus: (mode: string, reason: string) => void,
        private readonly onDiscontinuity: () => void) {}

    public start(): void {
        const generation = ++this.generation;
        try {
            const worker = new Worker(new URL("./dtln-cleaning-worker.ts", import.meta.url), { type: "module" });
            this.worker = worker;
            this.deadline = setTimeout(() => this.fail("Audio worker initialization timed out"), 10000);
            worker.onmessage = ({ data }): void => {
                if (generation !== this.generation) return;
                if (data.type === "ready") {
                    clearTimeout(this.deadline); this.ready = true; this.onStatus("neural", "");
                    worker.postMessage({ type: "settings", options: this.options });
                } else if (data.type === "samples") this.onSamples(data.samples, data.frame);
                else if (data.type === "ack") this.pending = Math.max(0, this.pending - 1);
                else if (data.type === "load") this.onStatus("load", `${Number(data.ratio).toFixed(2)} / ${this.pending * 8} / ${data.deadlineMisses}`);
                else if (data.type === "error") this.fail(data.reason);
                else if (data.type === "flushed") this.flushResolve?.();
            };
            worker.onerror = (event): void => this.fail(event.message);
            worker.onmessageerror = (): void => this.fail("Worker message could not be read");
            worker.postMessage({ type: "init", options: this.options });
        } catch (error) { this.fail(errMessage(error)); }
    }

    public push(microphone: Float32Array, reference: Float32Array, frame: number, count = 128): void {
        if (!this.ready || this.failed) { this.onSamples(microphone.slice(0, count), frame); return; }
        if ((this.pending + 1) * 8 > ECHO_TUNING.maxPendingMs) {
            this.fail("Audio processing queue exceeded its limit");
            this.onSamples(microphone.slice(0, count), frame);
            return;
        }
        this.pending++;
        this.worker?.postMessage({ type: "pair", microphone, reference, frame, count }, [microphone.buffer, reference.buffer]);
    }

    public update(options: MicrophoneCleaningOptions): void {
        this.options = options;
        if (this.ready) this.worker?.postMessage({ type: "settings", options });
    }

    public reset(): void {
        this.stop();
        this.failed = false; this.ready = false; this.pending = 0;
        this.start();
    }

    public async flush(): Promise<void> {
        if (!this.worker || !this.ready) return;
        await new Promise<void>((resolve) => {
            const timer = setTimeout(() => { this.fail("Audio worker flush timed out"); finish(); }, 3000);
            const finish = (): void => { clearTimeout(timer); this.flushResolve = undefined; resolve(); };
            this.flushResolve = finish;
            this.worker?.postMessage({ type: "flush" });
        });
    }

    public stop(): void {
        ++this.generation;
        clearTimeout(this.deadline);
        this.worker?.terminate(); this.worker = undefined;
        this.flushResolve?.();
    }

    private fail(reason: string): void {
        if (this.failed) return;
        this.failed = true; this.ready = false;
        this.stop();
        this.onDiscontinuity();
        this.onStatus("unfiltered", reason);
    }
}
