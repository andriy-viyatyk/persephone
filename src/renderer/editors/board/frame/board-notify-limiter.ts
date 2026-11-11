const BOARD_NOTIFY_LIMIT = 5;
const BOARD_NOTIFY_WINDOW_MS = 60_000;

export class BoardNotifyLimiter {
    private readonly timestamps: number[] = [];

    accept(now = Date.now()): boolean {
        while (this.timestamps[0] !== undefined && this.timestamps[0] <= now - BOARD_NOTIFY_WINDOW_MS) this.timestamps.shift();
        if (this.timestamps.length >= BOARD_NOTIFY_LIMIT) return false;
        this.timestamps.push(now);
        return true;
    }
}

/** App-lifetime limiter shared by every board frame. */
export const boardNotifyLimiter = new BoardNotifyLimiter();
