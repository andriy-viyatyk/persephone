import type { TestDescriptor } from "./test-api.js";
import type { TestResult } from "./results.js";
import type { AttemptResult } from "./test-attempt.js";
import type { DownloadAttachment } from "./captured-downloads.js";

export function buildTestResult(input: {
    file: string; descriptor: TestDescriptor; durationMs: number; finalAttempt: AttemptResult;
    attempts: NonNullable<TestResult["attempts"]>; failureBundle?: string; failureScreenshots: string[]; captureErrors: string[]; attachments: DownloadAttachment[];
}): TestResult {
    const { descriptor, finalAttempt: done } = input;
    const attemptFailed = Boolean(done.error || done.cleanupErrors.length);
    let status: TestResult["status"] = attemptFailed ? "failed" : "passed";
    let errorText = done.error;
    if (descriptor.mode === "fails") {
        if (!attemptFailed) { status = "unexpected-pass"; errorText = `Expected failure: ${descriptor.reason}`; }
        else if (!done.cleanupErrors.length) status = "expected-failure";
    } else if (!attemptFailed && input.attempts.length > 1) status = "flaky";
    const failedAttempt = [...input.attempts].reverse().find((attempt) => attempt.status === "failed");
    const requirements = descriptor.requires ?? [];
    return {
        file: input.file, name: descriptor.name, status, durationMs: input.durationMs,
        ...(done.step ? { step: done.step } : done.cleanupErrors.length && !errorText ? { step: "per-test cleanup" } : failedAttempt?.step ? { step: failedAttempt.step } : {}),
        ...(errorText ? { error: errorText } : done.cleanupErrors.length ? { error: "Per-test cleanup found leftover state or failed to complete." } : {}),
        ...(requirements.length ? { requirements } : {}), ...(done.cleanupErrors.length ? { cleanupErrors: done.cleanupErrors } : {}),
        ...(input.failureBundle ? { failureBundle: input.failureBundle } : {}), ...(input.failureScreenshots.length ? { screenshots: input.failureScreenshots } : {}),
        ...(input.captureErrors.length ? { captureErrors: input.captureErrors } : {}), ...(descriptor.reason ? { reason: descriptor.reason } : {}),
        ...(input.attachments.length ? { attachments: input.attachments } : {}),
        ...(input.attempts.length > 1 ? { attempts: input.attempts } : {}),
        ...(done.location ?? failedAttempt?.location ? { location: done.location ?? failedAttempt?.location } : {}),
    };
}
