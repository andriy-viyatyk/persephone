import { resolveTimeoutMs } from "ai-vision";

export type BoardCallTimeoutLevel = 1 | 2 | 3 | 4;

export interface BoardCallTimeout {
    ms: number;
    level: BoardCallTimeoutLevel;
    label: string;
}

export const APP_CALL_TIMEOUT_MIN_MS = 1_000;
export const APP_CALL_TIMEOUT_MAX_MS = 3_600_000;

export function isValidAppCallTimeout(value: unknown): value is number {
    return isPositiveIntegerTimeout(value) && value >= APP_CALL_TIMEOUT_MIN_MS && value <= APP_CALL_TIMEOUT_MAX_MS;
}

export const appCallTimeoutRangeMessage =
    `boards.callTimeoutMs must be an integer from ${APP_CALL_TIMEOUT_MIN_MS} to ${APP_CALL_TIMEOUT_MAX_MS}.`;

export function isPositiveIntegerTimeout(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value) && Number.isInteger(value) && value > 0;
}

export function resolveBoardCallTimeout(
    perCall: number | undefined,
    declared: number | undefined,
    runtime: number | undefined,
): BoardCallTimeout {
    const level: BoardCallTimeoutLevel = perCall !== undefined ? 1
        : declared !== undefined ? 2
        : runtime !== undefined ? 3
        : 4;
    const ms = resolveTimeoutMs(perCall, declared, runtime, 30_000);
    const label = ["", "per-call timeoutMs", "remote-declared timeoutMs",
        "boards.callTimeoutMs", "built-in 30-second fallback"][level];
    return { ms, level, label };
}
