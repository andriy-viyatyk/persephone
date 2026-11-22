import { Console } from "node:console";
import type { TestLogEvent } from "./test-log.js";
import { displayPath } from "./source-location.js";

type TestStatus = "passed" | "failed" | "skipped" | "expected-failure" | "unexpected-pass" | "flaky" | "not-run";

export interface RunTotals {
    passed: number;
    failed: number;
    skipped: number;
    expectedFailure: number;
    unexpectedPass: number;
    flaky: number;
    notRun: number;
}

export function redirectGlobalConsoleToStderr(): void {
    globalThis.console = new Console({ stdout: process.stderr, stderr: process.stderr });
}

export class JsonLinesReporter {
    constructor(private readonly cwd: string) {}

    runStart(startedAt: string, fileCount: number, testCount: number): void {
        this.write({ version: 1, event: "run-start", startedAt, fileCount, testCount });
    }

    testEvent(event: TestLogEvent): void {
        if (event.event === "test-start") {
            const identity = this.identity(event);
            if (identity) this.write({ version: 1, event: "test-start", ...identity });
        } else if (event.event === "test-outcome") {
            const identity = this.identity(event);
            if (!identity || !isTestStatus(event.status)) return;
            const errors = [event.error, ...(Array.isArray(event.cleanupErrors) ? event.cleanupErrors : [])];
            this.write({ version: 1, event: "test-end", ...identity, status: event.status, durationMs: finiteDuration(event.durationMs), errorSummary: errorSummary(errors), retryCount: Array.isArray(event.attempts) ? Math.max(0, event.attempts.length - 1) : 0 });
        } else if (event.event === "hook-result" && event.ok === false) {
            const identity = this.identity(event);
            const summary = errorSummary([event.error]);
            if (!identity || summary === null || !isHookName(event.hook)) return;
            this.write({ version: 1, event: "hook-failure", ...identity, hook: event.hook, durationMs: finiteDuration(event.durationMs), errorSummary: summary, ...(Number.isInteger(event.attempt) && Number(event.attempt) > 0 ? { attempt: Number(event.attempt) } : {}) });
        }
    }

    runEnd(startedAt: string, finishedAt: string, durationMs: number, totals: RunTotals, reportDirectory: string | null, error: string | undefined): void {
        this.write({ version: 1, event: "run-end", startedAt, finishedAt, durationMs: finiteDuration(durationMs), ...totals, reportDirectory, errorSummary: errorSummary([error]) });
    }

    private identity(event: TestLogEvent): { file: string; test: string } | undefined {
        if (typeof event.file !== "string" || typeof event.test !== "string") return undefined;
        return { file: displayPath(this.cwd, event.file), test: event.test };
    }

    private write(event: Record<string, unknown>): void {
        process.stdout.write(`${JSON.stringify(event)}\n`);
    }
}

function isTestStatus(value: unknown): value is TestStatus {
    return value === "passed" || value === "failed" || value === "skipped" || value === "expected-failure" || value === "unexpected-pass" || value === "flaky" || value === "not-run";
}

function isHookName(value: unknown): value is "beforeAll" | "beforeEach" | "afterEach" | "afterAll" | "file cleanup" {
    return value === "beforeAll" || value === "beforeEach" || value === "afterEach" || value === "afterAll" || value === "file cleanup";
}

function finiteDuration(value: unknown): number {
    return typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : 0;
}

function errorSummary(values: unknown[]): string | null {
    for (const value of values) {
        if (typeof value !== "string") continue;
        const line = value.split(/\r?\n/).map((part) => part.trim()).find(Boolean);
        if (line) return line;
    }
    return null;
}
