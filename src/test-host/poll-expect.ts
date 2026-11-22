import assert from "node:assert/strict";
import { errMessage } from "../shared/utils.js";
import { prepareMatcher, matcherNames, safePreview, type ExpectMatchers, type MatcherName, type PreparedMatcher } from "./expect.js";
import { EnvironmentStopError } from "./attention-policy.js";
import { runHostPoll, type PollOutcome } from "./poll.js";
import type { Timeouts } from "./client.js";
import type { TestLog } from "./test-log.js";
import type { TestContext } from "./context.js";

export interface PollOptions { timeout?: number; interval?: number; message?: string; }
type MatcherMethods = Omit<ExpectMatchers, "not">;
export type PollMatchers = { [K in keyof MatcherMethods]: (...args: Parameters<MatcherMethods[K]>) => Promise<void> } & { readonly not: PollMatchers };

export interface Expect {
    (value: unknown, message?: string): ExpectMatchers;
    poll(callback: (ctx: TestContext) => unknown | Promise<unknown>, options?: PollOptions): PollMatchers;
}

export type PollStart = (callback: (ctx: TestContext) => unknown | Promise<unknown>, matcher: PreparedMatcher, options: PollOptions, stack: string) => Promise<void>;

export interface ContextExpectOptions {
    create(value: unknown, message?: string): ExpectMatchers;
    context: TestContext;
    timeouts: Timeouts;
    log?: TestLog;
    identity?: { file: string; test: string; profileDirectory?: string };
    quiet(change: 1 | -1): void;
    setStep(step: string): void;
    markFailure(error: unknown): void;
    setError(message: string): void;
    check(): void;
}

export function createContextExpect(dependencies: ContextExpectOptions): Expect {
    return Object.assign(dependencies.create, { poll: createPollExpect((callback, matcher, options, stack) => runPoll(dependencies, callback, matcher, options, stack)) });
}

async function runPoll(dependencies: ContextExpectOptions, callback: (ctx: TestContext) => unknown | Promise<unknown>, matcher: PreparedMatcher, options: PollOptions, stack: string): Promise<void> {
    const timeout = options.timeout === undefined ? dependencies.timeouts.wait : Math.max(1, Math.round(options.timeout * (dependencies.timeouts.scale ?? 1)));
    const interval = options.interval ?? dependencies.timeouts.poll;
    const target = `expect.poll ${matcher.expectedText}`;
    await runHostPoll({
        target, timeout, interval, timeouts: dependencies.timeouts, log: dependencies.log, identity: dependencies.identity,
        quiet: dependencies.quiet, setStep: dependencies.setStep, markFailure: dependencies.markFailure,
        setError: dependencies.setError, check: dependencies.check,
        read: async () => await callback(dependencies.context),
        retryReadError(error) { return !(error instanceof EnvironmentStopError); },
        match: (value) => matcher.evaluate(value),
        step: `assert poll ${matcher.expectedText}`,
        timeoutError(outcome: PollOutcome, _polls: number, _scaledTimeout: number) {
            const details = outcome.kind === "value"
                ? `Last actual: ${safePreview(outcome.value)}`
                : `Last error: ${safePreview(errMessage(outcome.error))}`;
            const lines = [options.message, `Expected: ${matcher.expectedText}`, details].filter((line) => line !== undefined);
            const error = new assert.AssertionError({ message: lines.join("\n"), actual: outcome.kind === "value" ? outcome.value : outcome.error, expected: matcher.expected, operator: matcher.name });
            error.stack = `${error.name}: ${error.message}\n${stack.split("\n").slice(1).join("\n")}`;
            return error;
        },
    });
}

/** Adapts the shared matcher definitions to async values read by the host poll owner. */
export function createPollExpect(start: PollStart): Expect["poll"] {
    return ((callback: (ctx: TestContext) => unknown | Promise<unknown>, rawOptions: unknown = {}) => {
        if (typeof callback !== "function") throw new TypeError("expect.poll requires a callback function.");
        if (rawOptions === null || typeof rawOptions !== "object" || Array.isArray(rawOptions)) throw new TypeError("expect.poll options must be an object with only timeout, interval, and message.");
        const supported = ["timeout", "interval", "message"];
        const unknown = Object.keys(rawOptions).find((key) => !supported.includes(key));
        if (unknown) throw new TypeError(`Unknown expect.poll option '${unknown}'. Supported options: ${supported.join(", ")}.`);
        const options = rawOptions as PollOptions;
        if (options.timeout !== undefined && (!Number.isFinite(options.timeout) || options.timeout <= 0)) throw new TypeError("expect.poll timeout must be a positive finite number.");
        if (options.interval !== undefined && (!Number.isFinite(options.interval) || options.interval <= 0)) throw new TypeError("expect.poll interval must be a positive finite number.");
        if (options.message !== undefined && typeof options.message !== "string") throw new TypeError("expect.poll message must be a string.");
        const makeSide = (negated: boolean): PollMatchers => new Proxy({ not: undefined } as unknown as PollMatchers, {
            get(_target, property) {
                if (property === "then") return undefined;
                if (property === "not") return makeSide(!negated);
                if (typeof property === "symbol") return undefined;
                if (!(matcherNames as readonly string[]).includes(property)) {
                    throw new TypeError(`Unknown matcher '${property}'. Supported matchers: ${matcherNames.join(", " )}.`);
                }
                return (...args: unknown[]) => {
                    const matcher = prepareMatcher(property as MatcherName, args, negated);
                    const stack = new Error().stack ?? "";
                    return start(callback, matcher, options, stack);
                };
            },
        });
        return makeSide(false);
    }) as Expect["poll"];
}
