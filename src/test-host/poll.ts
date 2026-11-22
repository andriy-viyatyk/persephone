import { errMessage } from "../shared/utils.js";
import type { Timeouts } from "./client.js";
import { resultPreview, type TestLog } from "./test-log.js";
import { safePreview } from "./expect.js";
import { EnvironmentStopError } from "./attention-policy.js";

export type PollOutcome = { kind: "value"; value: unknown } | { kind: "error"; error: unknown };

export interface HostPollOptions {
    target: string;
    timeout: number;
    interval: number;
    timeouts: Timeouts;
    log?: TestLog;
    identity?: { file: string; test: string; profileDirectory?: string };
    quiet(change: 1 | -1): void;
    setStep(step: string): void;
    markFailure(error: unknown): void;
    setError?(message: string): void;
    check?(): void;
    read(): Promise<unknown>;
    match(value: unknown): boolean | Promise<boolean>;
    retryReadError?(error: unknown): boolean;
    step: string;
    timeoutError(outcome: PollOutcome, polls: number, timeout: number): Error;
}

export interface HostPollResult { outcome: PollOutcome; polls: number; }

/** The single host polling loop shared by waitFor and expect.poll. */
export async function runHostPoll(options: HostPollOptions): Promise<HostPollResult> {
    const deadline = Date.now() + options.timeout;
    let outcome: PollOutcome;
    let polls = 0;
    options.log?.write({ event: "wait-start", ...options.identity, target: options.target, timeout: options.timeout });
    options.quiet(1);
    try {
        while (true) {
            options.check?.();
            polls++;
            options.setStep(options.step);
            let value: unknown;
            try {
                value = await options.read();
            } catch (error) {
                options.check?.();
                if (!options.retryReadError?.(error)) throw error;
                outcome = { kind: "error", error };
                options.setStep(options.step);
                options.check?.();
                if (Date.now() >= deadline) break;
                options.check?.();
                await delay(Math.min(options.interval, Math.max(1, deadline - Date.now())));
                options.check?.();
                continue;
            }
            options.check?.();
            outcome = { kind: "value", value };
            options.setStep(options.step);
            const matched = await options.match(value);
            options.check?.();
            if (matched) {
                options.setStep(options.step);
                options.log?.write({ event: "wait-result", ...options.identity, target: options.target, ok: true, polls, result: resultPreview(value) });
                return { outcome, polls };
            }
            if (Date.now() >= deadline) break;
            options.check?.();
            await delay(Math.min(options.interval, Math.max(1, deadline - Date.now())));
            options.check?.();
        }
    } catch (error) {
        if (!(error instanceof EnvironmentStopError)) options.setStep(options.step);
        options.setError?.(errMessage(error));
        options.markFailure(error);
        options.log?.write({ event: "wait-error", ...options.identity, target: options.target, ok: false, polls, error: errMessage(error) });
        throw error;
    } finally {
        options.quiet(-1);
    }

    options.setStep(options.step);
    const timeoutError = options.timeoutError(outcome, polls, options.timeout);
    options.setError?.(timeoutError.message);
    options.markFailure(timeoutError);
    const details = outcome.kind === "value"
        ? { result: resultPreview(outcome.value) }
        : { lastError: safePreview(errMessage(outcome.error)) };
    options.log?.write({ event: "wait-error", ...options.identity, target: options.target, ok: false, polls, error: timeoutError.message, ...details });
    throw timeoutError;
}

function delay(milliseconds: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
