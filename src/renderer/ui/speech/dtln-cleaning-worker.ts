import { DtlnEngine } from "./DtlnEngine";
import { errMessage } from "../../../shared/utils";
import { SerialQueue } from "../../../shared/serial-queue";
import type { MicrophoneCleaningOptions } from "../../../shared/microphone-cleaning-types";

const HOP = 128;
let engine: DtlnEngine | undefined;
let options: MicrophoneCleaningOptions;
const messageQueue = new SerialQueue();
let count = 0, misses = 0, ratio = 0, overload = 0;
const dryDelay = [new Float32Array(HOP), new Float32Array(HOP), new Float32Array(HOP)];
let x1 = 0, x2 = 0, y1 = 0, y2 = 0, gain = 1;
const coefficients = [1, 0, 0, 0, 0];
let target = [...coefficients];

function configureNotch(): void {
    const notch = options.notch;
    if (!notch?.enabled || notch.frequency >= 8000) { target = [1, 0, 0, 0, 0]; return; }
    const amplitude = 10 ** (notch.gainDb / 40), frequency = 2 * Math.PI * notch.frequency / 16000;
    const alpha = Math.sin(frequency) / (2 * notch.q), cosine = Math.cos(frequency), a0 = 1 + alpha / amplitude;
    target = [(1 + alpha * amplitude) / a0, -2 * cosine / a0, (1 - alpha * amplitude) / a0, -2 * cosine / a0, (1 - alpha / amplitude) / a0];
}

function finish(wet: Float32Array, input: Float32Array): Float32Array {
    let wetPower = 0, dryPower = 0;
    for (let index = 0; index < HOP; index++) { wetPower += wet[index] ** 2; dryPower += input[index] ** 2; }
    const wetRms = Math.sqrt(wetPower / HOP), dryRms = Math.sqrt(dryPower / HOP);
    if (options.attenuationDb !== 0) {
        const floor = dryRms * 10 ** (-options.attenuationDb / 20);
        const targetRms = Math.min(dryRms, Math.max(floor, wetRms));
        if (wetRms < 1e-12) {
            const scale = dryRms > 1e-12 ? targetRms / dryRms : 0;
            for (let index = 0; index < HOP; index++) wet[index] = input[index] * scale;
            gain = 1;
        } else {
            const desired = targetRms / wetRms;
            gain += (desired - gain) * 0.25;
            // Honor the frame bound even while smoothing.
            gain = Math.min(dryRms / wetRms, Math.max(floor / wetRms, gain));
            for (let index = 0; index < HOP; index++) wet[index] *= gain;
        }
    }
    let peak = 1;
    for (let index = 0; index < HOP; index++) {
        for (let coefficient = 0; coefficient < 5; coefficient++) coefficients[coefficient] += (target[coefficient] - coefficients[coefficient]) * 0.003;
        const [b0, b1, b2, a1, a2] = coefficients;
        const value = wet[index], output = b0 * value + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
        x2 = x1; x1 = value; y2 = y1; y1 = output;
        wet[index] = output; peak = Math.max(peak, Math.abs(output));
    }
    if (peak > 1) for (let index = 0; index < HOP; index++) wet[index] /= peak;
    return wet;
}

async function fetchBytes(path: string): Promise<ArrayBuffer> {
    const response = await fetch(`app-asset://vendor/${path}`, { signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error(`Model load failed (${response.status})`);
    return response.arrayBuffer();
}

self.onmessage = ({ data }: MessageEvent): void => {
    void messageQueue.run(async () => {
        if (data.type === "init") {
            options = data.options; configureNotch();
            const [wasm, first, second] = await Promise.all([
                fetchBytes("onnxruntime-web/ort-wasm-simd-threaded.wasm"),
                fetchBytes("dtln-aec/dtln_aec_128_1.onnx"), fetchBytes("dtln-aec/dtln_aec_128_2.onnx"),
            ]);
            engine = await DtlnEngine.create(wasm, first, second);
            for (let index = 0; index < 3; index++) await engine.process(new Float32Array(HOP), new Float32Array(HOP));
            self.postMessage({ type: "ready" });
        } else if (data.type === "settings") { options = data.options; configureNotch(); }
        else if (data.type === "pair" && engine) {
            const started = performance.now();
            const output = await engine.process(data.microphone, data.reference);
            dryDelay.push(data.microphone);
            const samples = finish(output, dryDelay.shift() ?? new Float32Array(HOP)).slice(0, data.count);
            self.postMessage({ type: "samples", samples, frame: data.frame }, { transfer: [samples.buffer] });
            const current = (performance.now() - started) / 8;
            ratio = count ? ratio * 0.99 + current * 0.01 : current;
            if (current > 1) misses++;
            overload = current > 0.9 ? overload + 1 : Math.max(0, overload - 1);
            if (overload >= 375) throw new Error("Sustained inference overload");
            if (++count % 125 === 0) self.postMessage({ type: "load", ratio, deadlineMisses: misses });
            self.postMessage({ type: "ack" });
        } else if (data.type === "flush") {
            self.postMessage({ type: "flushed" });
        }
    }).catch((error: unknown) => { self.postMessage({ type: "error", reason: errMessage(error) }); });
};
