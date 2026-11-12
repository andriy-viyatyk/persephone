export const RESTART_BUDGET = 3;
export const FAILURE_WINDOW_MS = 60_000;

export class RestartBudget {
    private failureTimestamps: number[] = [];
    private frozenCount: number | undefined;

    recordFailure(now = Date.now()): number {
        this.failureTimestamps = this.failureTimestamps.filter(
            (timestamp) => now - timestamp < FAILURE_WINDOW_MS,
        );
        this.failureTimestamps.push(now);
        return this.count(now);
    }

    count(now = Date.now()): number {
        if (this.frozenCount !== undefined) return this.frozenCount;
        const inWindowCount = this.failureTimestamps.reduce(
            (count, timestamp) => count + (now - timestamp < FAILURE_WINDOW_MS ? 1 : 0),
            0,
        );
        return Math.min(RESTART_BUDGET, inWindowCount);
    }

    reset(): void {
        this.failureTimestamps = [];
        this.frozenCount = undefined;
    }

    freeze(now = Date.now()): void {
        this.frozenCount = this.count(now);
    }
}
