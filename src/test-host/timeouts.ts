import type { Timeouts } from "./client.js";

export function createHostTimeouts(scale = 1): Timeouts & { screenshot: number; secondInstance: number } {
    if (!Number.isFinite(scale) || scale <= 0) throw new TypeError("--timeout-scale must be a positive finite number.");
    const scaled = (milliseconds: number): number => Math.min(2_147_483_647, Math.max(1, Math.round(milliseconds * scale)));
    return { startup: scaled(30_000), request: scaled(30_000), wait: scaled(10_000), poll: scaled(200), cleanup: scaled(3_000), shutdown: scaled(5_000), scale, screenshot: scaled(5_000), secondInstance: scaled(15_000) };
}
