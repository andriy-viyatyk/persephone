export function toBytes(data: unknown, requirement = 'writeFile with encoding "binary"'): Uint8Array {
    if (data instanceof Uint8Array) return data;
    if (data instanceof ArrayBuffer) return new Uint8Array(data);
    if (ArrayBuffer.isView(data)) {
        return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    }
    throw new Error(`${requirement} needs a Uint8Array or ArrayBuffer.`);
}
