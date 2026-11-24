import { UNBOUNDED_CALL_MAX_LENGTH } from "../shared/ai-vision-call-limits.js";

/** Runner calls are programmatic reads, so they default to an unbounded reply. */
export function runnerCallMaxLength(explicitMaxLength: number | undefined): number {
    return explicitMaxLength ?? UNBOUNDED_CALL_MAX_LENGTH;
}
