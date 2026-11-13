interface AcousticSample {
    startMs: number;
    endMs: number;
    value: number;
}

export interface SpeechAutoStopOptions {
    getSilenceDuration: () => number;
    getInactivityDuration: () => number;
}

// Preserve the existing acoustic tuning and 150 ms tick cadence.
const QUIET_THRESHOLD_FLOOR = 0.005;
const QUIET_MEDIAN_RATIO = 0.2;
const ACOUSTIC_HISTORY_LIMIT = 30_000;
const ACOUSTIC_HISTORY_PRUNE = 10_000;
const TIMER_TICK_MS = 150;

/** Owns the acoustic baseline and provider-output driven stop timers. */
export class SpeechAutoStop {
    private readonly acousticLevels: AcousticSample[] = [];
    private readonly speechLevels: number[] = [];
    private quietThreshold: number | undefined;
    private quietSince: number | undefined;
    private lastOutputAt: number | undefined;

    public constructor(private readonly options: SpeechAutoStopOptions) {}

    public static get tickIntervalMs(): number {
        return TIMER_TICK_MS;
    }

    public recordLevel(startMs: number, endMs: number, value: number): void {
        this.acousticLevels.push({ startMs, endMs, value });
        if (this.acousticLevels.length > ACOUSTIC_HISTORY_LIMIT) this.acousticLevels.splice(0, ACOUSTIC_HISTORY_PRUNE);
    }

    public recordSpeechBaseline(startMs: number, endMs: number): void {
        for (const sample of this.acousticLevels) {
            if (sample.endMs > startMs && sample.startMs < endMs) this.speechLevels.push(sample.value);
        }
        if (!this.speechLevels.length) return;
        const ordered = [...this.speechLevels].sort((left, right) => left - right);
        const middle = Math.floor(ordered.length / 2);
        const median = ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
        this.quietThreshold = Math.max(QUIET_THRESHOLD_FLOOR, median * QUIET_MEDIAN_RATIO);
    }

    public noteProviderOutput(): void {
        this.lastOutputAt = Date.now();
    }

    public seedCaptureClock(): void {
        this.noteProviderOutput();
    }

    public check(input: {
        level: number;
        capturing: boolean;
        live: boolean;
        segmentCount: number;
        hasDraft: boolean;
        stopRequested: boolean;
        finished: boolean;
        cancelled: boolean;
        stop: () => void;
    }): void {
        if (input.finished || input.cancelled || input.stopRequested || !input.capturing) return;

        const silenceDuration = this.options.getSilenceDuration();
        if (!silenceDuration || input.segmentCount === 0 || input.hasDraft || this.quietThreshold === undefined) {
            this.quietSince = undefined;
        } else if (input.level < this.quietThreshold) {
            this.quietSince ??= Date.now();
            if (Date.now() - this.quietSince >= silenceDuration) input.stop();
        } else {
            this.quietSince = undefined;
        }

        // Non-live providers only return output after `end`, so inactivity applies to live sessions.
        if (!input.live || this.lastOutputAt === undefined) return;
        const inactivityDuration = this.options.getInactivityDuration();
        if (inactivityDuration && Date.now() - this.lastOutputAt >= inactivityDuration) input.stop();
    }
}
