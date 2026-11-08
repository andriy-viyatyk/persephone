export class DeepFilter {
    static create(options: { wasmBytes: ArrayBuffer | WebAssembly.Module; attenuationLimit?: number }): Promise<DeepFilter>;
    readonly frameLength: number;
    process(frame: Float32Array): Float32Array;
    setAttenuationLimit(value: number): void;
    destroy(): void;
}
