import { MICROPHONE_TUNING, type MicrophoneCleaningOptions } from "./microphone-cleaning-types";

import { errMessage } from "../../../shared/utils";
import { DeepFilter } from "../../../../assets/vendor/deepfilternet-web/index.js";

interface Filter { frameLength: number; process(frame: Float32Array): Float32Array; setAttenuationLimit(value: number): void; destroy(): void }
let filter: Filter | undefined;
let options: MicrophoneCleaningOptions;
// Start at full boost: a quiet raw microphone must reach the model from the first word.
let rate = 48000, position = 0, frames: number[] = [], gain: number = MICROPHONE_TUNING.maxGain;
const source: number[] = [];
let x1 = 0, x2 = 0, y1 = 0, y2 = 0, discarded = 0, processed = 0, overloaded = 0;
let inputCount = 0, outputCount = 0, sourceCount = 0;
let availableCount = 0;
let attenuation = 100;
let rollingRatio = 0, deadlineMisses = 0;
const coefficients = [1, 0, 0, 0, 0];
let targetCoefficients = [1, 0, 0, 0, 0];
const HOP = 480, DELAY = MICROPHONE_TUNING.modelDelayFrames * HOP;

function configureNotch(): void {
    const n = options.notch;
    if (!n?.enabled) { targetCoefficients = [1, 0, 0, 0, 0]; return; }
    const a = 10 ** (n.gainDb / 40), w = 2 * Math.PI * n.frequency / 48000;
    const alpha = Math.sin(w) / (2 * n.q), c = Math.cos(w), a0 = 1 + alpha / a;
    targetCoefficients = [(1 + alpha * a) / a0, -2 * c / a0, (1 - alpha * a) / a0, -2 * c / a0, (1 - alpha / a) / a0];
}
function notch(value: number): number {
    for (let i = 0; i < coefficients.length; i++) coefficients[i] += (targetCoefficients[i] - coefficients[i]) * 0.001;
    const [b0, b1, b2, a1, a2] = coefficients;
    const y = b0 * value + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = value; y2 = y1; y1 = y;
    return y;
}
function report(mode: string, reason = ""): void { self.postMessage({ type: "status", mode, reason }); }
function emit(frame: Float32Array): void {
    let start = 0;
    if (filter && discarded < DELAY) { start = Math.min(frame.length, DELAY - discarded); discarded += start; }
    const count = Math.min(frame.length - start, availableCount - outputCount);
    if (count <= 0) return;
    const output = frame.slice(start, start + count); outputCount += count;
    self.postMessage({ type: "samples", samples: output }, { transfer: [output.buffer] });
}
function runFrame(frame: Float32Array, validSamples = frame.length): void {
    availableCount += validSamples;
    // Future loopback-referenced cancellation belongs here, before gain and the notch.
    let peak = 0;
    for (const sample of frame) peak = Math.max(peak, Math.abs(sample));
    if (filter) {
        // Hold the gain through silence; only speech-level frames move it. Coming back to 1x in
        // pauses made every phrase start quiet, and DeepFilterNet3 erases quiet speech.
        if (peak > MICROPHONE_TUNING.minSpeechPeak) {
            const target = Math.min(MICROPHONE_TUNING.maxGain, MICROPHONE_TUNING.targetPeak / peak);
            gain += (target - gain) * (target < gain ? MICROPHONE_TUNING.gainAttack : MICROPHONE_TUNING.gainRelease);
        }
    } else gain = 1;
    for (let i = 0; i < frame.length; i++) {
        const sample = filter ? Math.max(-MICROPHONE_TUNING.headroom, Math.min(MICROPHONE_TUNING.headroom, frame[i] * gain)) : frame[i];
        frame[i] = notch(sample);
    }
    if (!filter) { emit(frame); return; }
    const started = performance.now();
    const targetAttenuation = options.attenuationDb || 100;
    attenuation += Math.max(-0.2, Math.min(0.2, targetAttenuation - attenuation));
    filter.setAttenuationLimit(attenuation);
    try { emit(filter.process(frame)); }
    catch (error) { filter.destroy(); filter = undefined; self.postMessage({ type: "recover", reason: errMessage(error) }); return; }
    const ratio = (performance.now() - started) / 10;
    rollingRatio = processed ? rollingRatio * 0.99 + ratio * 0.01 : ratio;
    if (ratio > 1) deadlineMisses++;
    overloaded = ratio > MICROPHONE_TUNING.overloadRatio ? overloaded + 1 : Math.max(0, overloaded - 1);
    if (++processed % 100 === 0) self.postMessage({ type: "load", ratio: rollingRatio, deadlineMisses });
    if (overloaded >= MICROPHONE_TUNING.overloadFrames) {
        // Drain the model's lookahead before switching to the zero-delay notch path.
        try { for (let i = 0; i < MICROPHONE_TUNING.modelDelayFrames; i++) emit(filter.process(new Float32Array(HOP))); }
        catch { /* A failed model cannot drain; the fallback is reported below. */ }
        filter.destroy(); filter = undefined; report("notch", "Sustained inference overload");
    }
}
// Windowed-sinc interpolation provides low-pass filtering when downsampling. Retain history across blocks.
function resample(input: Float32Array, flush = false): void {
    sourceCount += input.length;
    source.push(...input);
    if (flush) source.push(...new Array<number>(16).fill(0));
    const step = rate / 48000, cutoff = Math.min(1, 48000 / rate), output: number[] = [];
    while (position + 8 < source.length) {
        const center = Math.floor(position); let sum = 0, weight = 0;
        for (let j = -7; j <= 8; j++) {
            const offset = position - (center + j), z = Math.PI * offset * cutoff;
            const sinc = Math.abs(z) < 1e-8 ? 1 : Math.sin(z) / z;
            const window = 0.5 + 0.5 * Math.cos(Math.PI * offset / 8);
            const coefficient = sinc * window * cutoff;
            sum += (source[center + j] ?? 0) * coefficient; weight += coefficient;
        }
        output.push(weight ? sum / weight : 0); position += step;
    }
    const drop = Math.max(0, Math.floor(position) - 8); source.splice(0, drop); position -= drop;
    const remaining = Math.max(0, Math.ceil(sourceCount * 48000 / rate) - inputCount);
    const accepted = output.slice(0, remaining);
    inputCount += accepted.length;
    frames.push(...accepted);
    while (frames.length >= HOP) runFrame(Float32Array.from(frames.splice(0, HOP)));
}
self.onmessage = async (event: MessageEvent): Promise<void> => {
    const data = event.data;
    if (data.type === "init") {
        options = data.options; rate = data.rate; attenuation = options.attenuationDb || 100; configureNotch();
        try {
            if (!data.bytes) throw new Error(data.loadError || "Model is unavailable");
            filter = await DeepFilter.create({ wasmBytes: data.bytes, attenuationLimit: options.attenuationDb || 100 });
            if (filter.frameLength !== HOP) throw new Error("Unexpected DeepFilterNet frame length");
            report("neural");
        } catch (error) { filter?.destroy(); filter = undefined; report("notch", errMessage(error)); }
        self.postMessage({ type: "ready" });
    } else if (data.type === "samples") {
        resample(data.samples); self.postMessage({ type: "ack", count: data.samples.length });
    } else if (data.type === "settings") {
        options = data.options; configureNotch();
    } else if (data.type === "flush") {
        resample(new Float32Array(0), true);
        if (frames.length) { const frame = new Float32Array(HOP); const count = frames.length; frame.set(frames); frames = []; runFrame(frame, count); }
        if (filter) for (let i = 0; i < MICROPHONE_TUNING.modelDelayFrames; i++) runFrame(new Float32Array(HOP), 0);
        filter?.destroy(); filter = undefined; self.postMessage({ type: "flushed" });
    }
};
