export interface TimedPcmChunk { data: ArrayBuffer; time: number }

/** Suppress quiet computer audio while retaining its original capture timestamps. */
export class ComputerAudioGate {
    private preroll: TimedPcmChunk[] = [];
    private open = false;
    private quietMs = 0;

    public push(chunk: TimedPcmChunk): { chunk: TimedPcmChunk; start: boolean }[] {
        const samples = new DataView(chunk.data);
        let energy = 0;
        for (let offset = 0; offset < samples.byteLength; offset += 2) {
            const value = samples.getInt16(offset, true) / 32768;
            energy += value * value;
        }
        const level = Math.sqrt(energy / Math.max(1, samples.byteLength / 2));
        const duration = samples.byteLength / 2 / 16000 * 1000;
        if (!this.open) {
            this.preroll.push(chunk);
            while (this.preroll.length > 1 && chunk.time - this.preroll[0].time >= 400) this.preroll.shift();
            if (level < 0.01) return [];
            this.open = true;
            this.quietMs = 0;
            return this.preroll.splice(0).map((item, index) => ({ chunk: item, start: index === 0 }));
        }
        this.quietMs = level < 0.006 ? this.quietMs + duration : 0;
        if (this.quietMs >= 500) this.open = false;
        return [{ chunk, start: false }];
    }
}
