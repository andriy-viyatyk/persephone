/** Cumulative byte accounting for one provider activity burst. */
export class RateMeter {
    private loadedBytes = 0;
    private startedAt: number | undefined;

    reset(now = Date.now()): void {
        this.loadedBytes = 0;
        this.startedAt = now;
    }

    add(bytes: number, now = Date.now()): void {
        this.startedAt ??= now;
        this.loadedBytes += bytes;
    }

    get loaded(): number {
        return this.loadedBytes;
    }

    rate(now = Date.now()): number {
        if (this.loadedBytes === 0 || this.startedAt === undefined) return 0;
        return this.loadedBytes / Math.max((now - this.startedAt) / 1000, 0.001);
    }
}
