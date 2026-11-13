import * as ort from "../../../../assets/vendor/onnxruntime-web/ort.wasm.bundle.min.mjs";

const BLOCK = 512;
const HOP = 128;
const PADDING = BLOCK - HOP;

function fft(real: Float64Array, imaginary: Float64Array, inverse = false): void {
    for (let index = 1, reversed = 0; index < BLOCK; index++) {
        let bit = BLOCK >> 1;
        for (; reversed & bit; bit >>= 1) reversed ^= bit;
        reversed ^= bit;
        if (index < reversed) {
            [real[index], real[reversed]] = [real[reversed], real[index]];
            [imaginary[index], imaginary[reversed]] = [imaginary[reversed], imaginary[index]];
        }
    }
    for (let length = 2; length <= BLOCK; length *= 2) {
        const angle = (inverse ? 2 : -2) * Math.PI / length;
        for (let start = 0; start < BLOCK; start += length) {
            for (let index = 0; index < length / 2; index++) {
                const cosine = Math.cos(angle * index), sine = Math.sin(angle * index);
                const even = start + index, odd = even + length / 2;
                const re = real[odd] * cosine - imaginary[odd] * sine;
                const im = real[odd] * sine + imaginary[odd] * cosine;
                real[odd] = real[even] - re; imaginary[odd] = imaginary[even] - im;
                real[even] += re; imaginary[even] += im;
            }
        }
    }
    if (inverse) for (let index = 0; index < BLOCK; index++) { real[index] /= BLOCK; imaginary[index] /= BLOCK; }
}

function spectrum(samples: Float32Array, roundComplex: boolean): { real: Float64Array; imaginary: Float64Array; magnitude: Float32Array } {
    const real = Float64Array.from(samples), imaginary = new Float64Array(BLOCK);
    fft(real, imaginary);
    const magnitude = new Float32Array(BLOCK / 2 + 1);
    for (let index = 0; index < magnitude.length; index++) {
        if (roundComplex) { real[index] = Math.fround(real[index]); imaginary[index] = Math.fround(imaginary[index]); }
        magnitude[index] = Math.hypot(real[index], imaginary[index]);
    }
    return { real, imaginary, magnitude };
}

function maskedBlock(input: ReturnType<typeof spectrum>, mask: Float32Array): Float32Array {
    const real = new Float64Array(BLOCK), imaginary = new Float64Array(BLOCK);
    for (let index = 0; index <= BLOCK / 2; index++) {
        real[index] = Math.fround(input.real[index] * mask[index]);
        imaginary[index] = Math.fround(input.imaginary[index] * mask[index]);
        if (index > 0 && index < BLOCK / 2) { real[BLOCK - index] = real[index]; imaginary[BLOCK - index] = -imaginary[index]; }
    }
    fft(real, imaginary, true);
    return Float32Array.from(real);
}

type Session = Awaited<ReturnType<typeof ort.InferenceSession.create>>;
function zeroState(session: Session, name: string): InstanceType<typeof ort.Tensor> {
    const metadata = session.inputMetadata.find((input: { name: string }) => input.name === name);
    if (!metadata || !metadata.shape.every((dimension: number) => Number.isInteger(dimension) && dimension > 0)) throw new Error(`Invalid state shape for ${name}`);
    return new ort.Tensor("float32", new Float32Array(metadata.shape.reduce((left: number, right: number) => left * right, 1)), metadata.shape);
}

/** Persistent two-stage DTLN-aec model. One call processes one 8 ms hop. */
export class DtlnEngine {
    private state1: InstanceType<typeof ort.Tensor>;
    private state2: InstanceType<typeof ort.Tensor>;
    private readonly microphone = new Float32Array(BLOCK);
    private readonly reference = new Float32Array(BLOCK);
    private readonly overlap = new Float64Array(BLOCK);

    private constructor(private readonly first: Session, private readonly second: Session) {
        this.state1 = zeroState(first, "input_5");
        this.state2 = zeroState(second, "input_8");
    }

    public static async create(wasm: ArrayBuffer, model1: ArrayBuffer, model2: ArrayBuffer): Promise<DtlnEngine> {
        ort.env.wasm.wasmBinary = new Uint8Array(wasm);
        ort.env.wasm.numThreads = 1;
        ort.env.wasm.proxy = false;
        const first = await ort.InferenceSession.create(new Uint8Array(model1), { executionProviders: ["wasm"] });
        const second = await ort.InferenceSession.create(new Uint8Array(model2), { executionProviders: ["wasm"] });
        return new DtlnEngine(first, second);
    }

    public async process(microphone: Float32Array, reference: Float32Array): Promise<Float32Array> {
        if (microphone.length !== HOP || reference.length !== HOP) throw new Error("DTLN requires 128-sample hops");
        this.microphone.copyWithin(0, HOP); this.microphone.set(microphone, PADDING);
        this.reference.copyWithin(0, HOP); this.reference.set(reference, PADDING);
        const mic = spectrum(this.microphone, true), ref = spectrum(this.reference, false);
        const first = await this.first.run({
            input_3: new ort.Tensor("float32", mic.magnitude, [1, 1, 257]),
            input_4: new ort.Tensor("float32", ref.magnitude, [1, 1, 257]), input_5: this.state1,
        });
        this.state1 = first.Identity_1;
        const second = await this.second.run({
            input_6: new ort.Tensor("float32", maskedBlock(mic, first.Identity.data as Float32Array), [1, 1, BLOCK]),
            input_7: new ort.Tensor("float32", this.reference, [1, 1, BLOCK]), input_8: this.state2,
        });
        this.state2 = second.Identity_1;
        this.overlap.copyWithin(0, HOP); this.overlap.fill(0, PADDING);
        const values = second.Identity.data as Float32Array;
        for (let index = 0; index < BLOCK; index++) this.overlap[index] += values[index];
        return Float32Array.from(this.overlap.subarray(0, HOP));
    }
}
