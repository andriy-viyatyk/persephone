import { resolveTimeoutMs } from "ai-vision";

export type BoardCallTimeoutLevel = 1 | 2 | 3 | 4;

export interface BoardCallTimeout {
    ms: number;
    level: BoardCallTimeoutLevel;
    label: string;
}

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
