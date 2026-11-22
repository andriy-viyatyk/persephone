import type { McpClient, Timeouts } from "./client.js";
import type { HostConfiguration, TestLauncher } from "./launcher.js";
import { EnvironmentStopError } from "./attention-policy.js";
import { beginPageOwnership, closePagesOpenedSince } from "./browser-helpers.js";
import type { loadContextSetup } from "./context-setup.js";
import { runFileHook } from "./file-hook-run.js";
import { matchesSelection, type TestResult } from "./results.js";
import { runAttempt } from "./test-attempt.js";
import { buildTestResult } from "./test-result.js";
import type { DownloadAttachment } from "./captured-downloads.js";
import type { TestDescriptor } from "./test-api.js";
import { testIdentityKey } from "./test-identity.js";
import type { TestLog } from "./test-log.js";
import type { TestWindowOwner } from "./test-window.js";
import { runnableReason, type TestFileHooks } from "./file-hooks.js";
import { errMessage } from "../shared/utils.js";

export interface DiscoveredFile { file: string; tests: TestDescriptor[]; hooks: TestFileHooks; }
export interface FileRunState { client: McpClient; environmentStop?: string; }
export async function runSelectedFiles(input: {
    files: DiscoveredFile[]; configuration: HostConfiguration; launcher: TestLauncher; timeouts: Timeouts;
    setup?: Awaited<ReturnType<typeof loadContextSetup>>; log: TestLog; outputDirectory?: string; results: TestResult[];
    selected: Set<string> | undefined; hasOnly: boolean; testWindow: TestWindowOwner; client: McpClient;
}): Promise<FileRunState> {
    let client = input.client;
    const state: FileRunState = { client };
    const skipped = (group: DiscoveredFile, descriptor: TestDescriptor, reason: string, requirements: string[], durationMs: number): void => {
        const result: TestResult = { file: group.file, name: descriptor.name, status: "skipped", durationMs, skipReason: reason, ...(requirements.length ? { requirements } : {}) };
        input.results.push(result);
        input.log.write({ event: "test-outcome", file: group.file, test: descriptor.name, status: result.status, durationMs, reason });
    };
    for (let groupIndex = 0; groupIndex < input.files.length; groupIndex++) {
        const group = input.files[groupIndex];
        const selectedTests = group.tests.filter((descriptor) => matchesSelection(group.file, descriptor.name, input.selected) && (!input.hasOnly || descriptor.mode === "only"));
        const runnable = selectedTests.filter((descriptor) => !runnableReason(descriptor, input.configuration.attach, input.configuration.with).reason);
        if (!runnable.length) {
            for (const descriptor of selectedTests) {
                const started = Date.now();
                input.log.write({ event: "test-start", file: group.file, test: descriptor.name });
                const disposition = runnableReason(descriptor, input.configuration.attach, input.configuration.with);
                if (disposition.reason) skipped(group, descriptor, disposition.reason, disposition.requirements, Date.now() - started);
            }
            continue;
        }
        let baseline: Awaited<ReturnType<typeof beginPageOwnership>>;
        try {
            await input.testWindow.assertIdentity(client);
            baseline = await beginPageOwnership(client, (event, details) => input.log.write({ event, file: group.file, ...details }), input.testWindow);
        } catch (error) {
            if (!(error instanceof EnvironmentStopError)) throw error;
            state.environmentStop = error.message;
            markRemaining(groupIndex, selectedTests, error.message);
            break;
        }
        let beforeAllFailed = false;
        let ownedPages = new Set<string>();
        let sessionPages = new Set<string>();
        if (group.hooks.beforeAll) {
            try {
                const result = await runFileHook({ file: group.file, name: "<beforeAll>", hookName: "beforeAll", hook: group.hooks.beforeAll, client, launcher: input.launcher, timeouts: input.timeouts, configuration: input.configuration, setup: input.setup, log: input.log, outputDirectory: input.outputDirectory, testWindow: input.testWindow, baseline });
                client = result.client; ownedPages = union(ownedPages, result.ownedPages); sessionPages = union(sessionPages, result.sessionPages);
                if (result.result.status === "failed") input.results.push(result.result);
                beforeAllFailed = result.result.status === "failed";
            } catch (error) {
                if (!(error instanceof EnvironmentStopError)) throw error;
                state.environmentStop = error.message;
                markRemaining(groupIndex, selectedTests, error.message);
                break;
            }
        }
        for (const descriptor of selectedTests) {
            const started = Date.now();
            const identity = { file: group.file, test: descriptor.name };
            input.log.write({ event: "test-start", ...identity });
            const disposition = runnableReason(descriptor, input.configuration.attach, input.configuration.with);
            if (disposition.reason) { skipped(group, descriptor, disposition.reason, disposition.requirements, Date.now() - started); continue; }
            if (beforeAllFailed) {
                const result: TestResult = { file: group.file, name: descriptor.name, status: "not-run", durationMs: 0, error: "beforeAll failed", reason: "beforeAll failed" };
                input.results.push(result); input.log.write({ event: "test-outcome", ...identity, status: "not-run", durationMs: 0, reason: "beforeAll failed" }); continue;
            }
            let attemptClient = input.launcher.client ?? client;
            const attempts: NonNullable<TestResult["attempts"]> = [];
            let finalAttempt: Awaited<ReturnType<typeof runAttempt>> | undefined;
            let failureBundle: string | undefined;
            let failureScreenshots: string[] = [];
            let attachments: DownloadAttachment[] = [];
            const captureErrors: string[] = [];
            const retryLimit = input.configuration.retries ?? 0;
            for (let attemptNumber = 1; attemptNumber <= retryLimit + 1; attemptNumber++) {
                attemptClient = input.launcher.client ?? attemptClient;
                input.log.write({ event: "test-attempt-start", ...identity, attempt: attemptNumber, ...(attempts.at(-1)?.error ? { priorFailure: attempts.at(-1)?.error } : {}) });
                try {
                    finalAttempt = await runAttempt({ descriptor, file: group.file, client: attemptClient, launcher: input.launcher, timeouts: input.timeouts, configuration: input.configuration, setup: input.setup, log: input.log, outputDirectory: input.outputDirectory, attempt: attemptNumber, testWindow: input.testWindow, hooks: group.hooks });
                } catch (error) {
                    if (!(error instanceof EnvironmentStopError)) throw error;
                    state.environmentStop = error.message;
                    input.results.push({ file: group.file, name: descriptor.name, status: "not-run", durationMs: Date.now() - started, error: error.message, reason: error.message });
                    input.log.write({ event: "test-outcome", ...identity, status: "not-run", durationMs: Date.now() - started, error: error.message });
                    markRemaining(groupIndex, selectedTests, error.message);
                    break;
                }
                attemptClient = finalAttempt.client;
                attachments = finalAttempt.attachments;
                if (finalAttempt.error) { failureBundle = finalAttempt.failureBundle; failureScreenshots = finalAttempt.screenshots; }
                captureErrors.push(...finalAttempt.captureErrors);
                const failed = Boolean(finalAttempt.error || finalAttempt.cleanupErrors.length);
                const expectedFailure = descriptor.mode === "fails" && failed && finalAttempt.cleanupErrors.length === 0;
                const failedAttempt = descriptor.mode === "fails" ? !expectedFailure : failed;
                attempts.push({ attempt: attemptNumber, status: failedAttempt ? "failed" : "passed", ...(finalAttempt.error ? { error: finalAttempt.error } : {}), ...(finalAttempt.location ? { location: finalAttempt.location } : {}), ...(finalAttempt.step ? { step: finalAttempt.step } : {}) });
                input.log.write({ event: "test-attempt-result", ...identity, attempt: attemptNumber, status: failedAttempt ? "failed" : "passed", ...(finalAttempt.error ? { error: finalAttempt.error } : {}) });
                if (!failedAttempt || attemptNumber > retryLimit) break;
            }
            if (state.environmentStop) break;
            client = attemptClient;
            if (!finalAttempt) throw new Error(`Test "${descriptor.name}" completed without an attempt result.`);
            const result = buildTestResult({ file: group.file, descriptor, durationMs: Date.now() - started, finalAttempt, attempts, failureBundle, failureScreenshots, captureErrors, attachments });
            input.results.push(result);
            input.log.write({ event: "test-outcome", ...identity, status: result.status, durationMs: result.durationMs, ...(result.step ? { step: result.step } : {}), ...(result.error ? { error: result.error } : {}), ...(result.cleanupErrors?.length ? { cleanupErrors: result.cleanupErrors } : {}), ...(result.attempts ? { attempts: result.attempts } : {}) });
        }
        if (state.environmentStop) break;
        if (group.hooks.afterAll) {
            try {
                const result = await runFileHook({ file: group.file, name: "<afterAll>", hookName: "afterAll", hook: group.hooks.afterAll, client: input.launcher.client ?? client, launcher: input.launcher, timeouts: input.timeouts, configuration: input.configuration, setup: input.setup, log: input.log, outputDirectory: input.outputDirectory, testWindow: input.testWindow, baseline });
                client = result.client; ownedPages = union(ownedPages, result.ownedPages); sessionPages = union(sessionPages, result.sessionPages);
                if (result.result.status === "failed") input.results.push(result.result);
            } catch (error) {
                if (!(error instanceof EnvironmentStopError)) throw error;
                state.environmentStop = error.message;
                break;
            }
        }
        try {
            const fileOwned = ownedPages;
            const adopted = new Set([...sessionPages].filter((id) => !fileOwned.has(id)));
            const errors = await closePagesOpenedSince(input.launcher.client ?? client, baseline, (event, details) => input.log.write({ event, file: group.file, test: "<afterAll>", ...details }), input.timeouts.cleanup ?? 3000, input.testWindow.mode === "attached-selected" ? fileOwned : undefined, adopted, input.testWindow);
            if (errors.length) addCleanupResult(group.file, errors);
        } catch (error) {
            if (!(error instanceof EnvironmentStopError)) addCleanupResult(group.file, [errMessage(error)]);
            else { state.environmentStop = error.message; break; }
        }
    }
    state.client = client;
    return state;

    function markRemaining(groupIndex: number, current: TestDescriptor[], reason: string): void {
        for (let laterGroup = groupIndex; laterGroup < input.files.length; laterGroup++) {
            const group = input.files[laterGroup];
            const list = laterGroup === groupIndex ? current : group.tests;
            for (const descriptor of list) {
                const key = testIdentityKey({ file: group.file, name: descriptor.name });
                if (input.results.some((result) => testIdentityKey(result) === key) || !matchesSelection(group.file, descriptor.name, input.selected) || (input.hasOnly && descriptor.mode !== "only")) continue;
                const result: TestResult = { file: group.file, name: descriptor.name, status: "not-run", durationMs: 0, error: reason, reason };
                input.results.push(result);
            }
        }
    }
    function addCleanupResult(file: string, errors: string[]): void {
        let result = input.results.find((item) => item.file === file && item.name === "<afterAll>");
        if (!result) {
            result = { file, name: "<afterAll>", status: "failed", durationMs: 0, error: "File cleanup failed.", step: "file cleanup", cleanupErrors: [] };
            input.results.push(result);
        } else {
            result.status = "failed";
            result.error ??= "File cleanup failed.";
            result.step ??= "file cleanup";
        }
        result.cleanupErrors = [...(result.cleanupErrors ?? []), ...errors];
        input.log.write({ event: "hook-result", file, test: "<afterAll>", hook: "file cleanup", durationMs: 0, ok: false, error: errors.join("; "), step: "file cleanup" });
    }
}

function union<T>(left: Set<T>, right: Set<T>): Set<T> { return new Set([...left, ...right]); }
