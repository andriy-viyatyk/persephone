import { createContext } from "./context.js";
import type { McpClient, Timeouts } from "./client.js";
import type { HostConfiguration, TestLauncher } from "./launcher.js";
import type { TestDescriptor } from "./test-api.js";
import { errMessage } from "../shared/utils.js";
import { beginPageOwnership, closePagesOpenedSince } from "./browser-helpers.js";
import { captureFailure, type FailureCapture } from "./failure-bundle.js";
import type { loadContextSetup } from "./context-setup.js";
import { displayPath, testFileLocation } from "./source-location.js";
import type { TestLog } from "./test-log.js";
import type { TestWindowOwner } from "./test-window.js";
import { EnvironmentStopError } from "./attention-policy.js";
import { createTestLifetime, TestTimeoutError } from "./test-timeout.js";
import { scaleTimeout } from "./timeouts.js";
import { invokeHook, logHookResult, logHookStart } from "./file-hooks.js";
import type { DownloadAttachment } from "./captured-downloads.js";

export interface AttemptInput {
    descriptor: TestDescriptor; file: string; client: McpClient; launcher: TestLauncher; timeouts: Timeouts;
    configuration: HostConfiguration; setup?: Awaited<ReturnType<typeof loadContextSetup>>; log: TestLog;
    outputDirectory?: string; attempt: number; testWindow: TestWindowOwner;
    hooks?: { beforeEach?: (context: import("./context.js").TestContext) => unknown | Promise<unknown>; afterEach?: (context: import("./context.js").TestContext) => unknown | Promise<unknown> };
}
export interface AttemptResult {
    client: McpClient; durationMs: number; error?: string; thrown?: unknown; step?: string; cleanupErrors: string[];
    screenshots: string[]; captureErrors: string[]; failureBundle?: string; location?: string;
    attachments: DownloadAttachment[];
}

export async function runAttempt(input: AttemptInput): Promise<AttemptResult> {
    const { descriptor, file, configuration, launcher, timeouts, log } = input;
    const identity = { file, test: descriptor.name };
    const started = Date.now();
    const timeout = scaleTimeout(descriptor.timeout ?? configuration.testTimeout ?? 300_000, timeouts.scale ?? 1);
    const lifetime = createTestLifetime(timeout);
    let client = launcher.client ?? input.client;
    const context = createContext(client, launcher, timeouts, configuration.attach, input.testWindow, lifetime, log, { ...identity, profileDirectory: configuration.profileDirectory }, input.outputDirectory);
    let baseline: Awaited<ReturnType<typeof beginPageOwnership>> | undefined;
    let thrown: unknown;
    let error: string | undefined;
    let step: string | undefined;
    let phase: "beforeEach" | "body" | "afterEach" | undefined;
    let capture: FailureCapture = { screenshots: [], captureErrors: [] };
    const cleanupErrors: string[] = [];
    const capturePrimary = async (caught: unknown): Promise<void> => {
        try { await lifetime.waitForRestart(); }
        catch (restartError) {
            if (restartError instanceof EnvironmentStopError) throw restartError;
            cleanupErrors.push(`App restart did not finish after test failure: ${errMessage(restartError)}`);
        }
        client = launcher.client ?? client;
        if (!(caught instanceof EnvironmentStopError) && baseline && input.outputDirectory) {
            try { capture = await captureFailure(client, baseline, input.outputDirectory, { file, name: descriptor.name }, input.attempt, started, context._state.pagesUnderTest(), context._state.sessionPages, log, input.testWindow, context._state.attachments); }
            catch (captureError) {
                if (captureError instanceof EnvironmentStopError) throw captureError;
                capture.captureErrors.push(`Failure capture failed: ${errMessage(captureError)}`);
            }
        }
    };
    try {
        await input.testWindow.assertIdentity(client);
        baseline = await beginPageOwnership(client, (event, details) => log.write({ event, ...identity, attempt: input.attempt, ...details }), input.testWindow);
        const getClient = (): McpClient => {
            const current = launcher.client ?? client;
            if (!current) throw new Error("MCP client is not available during test setup.");
            return current;
        };
        let contextSetup = context;
        const setup = input.setup;
        try {
            if (setup) contextSetup = await lifetime.runSetup("test setup", () => setup(context, { file, name: descriptor.name, profileDirectory: configuration.profileDirectory, attach: configuration.attach }, getClient, input.testWindow, lifetime));
        } catch (caught) {
            thrown = caught; error = errMessage(caught); step = `test setup: ${context._state.stepOf(caught)}`;
            await capturePrimary(caught);
        }
        let hookStarted = 0;
        if (thrown === undefined && input.hooks?.beforeEach) { hookStarted = Date.now(); logHookStart(log, { ...identity, attempt: input.attempt }, "beforeEach"); }
        if (thrown === undefined) {
            try {
                await lifetime.run(async () => {
                    phase = "beforeEach";
                    const before = await invokeHook("beforeEach", input.hooks?.beforeEach, contextSetup);
                    if (before.error !== undefined) { step = before.step; throw before.error; }
                    // A beforeEach that finishes after the attempt timed out must not log a late success.
                    lifetime.assertActive();
                    if (hookStarted) logHookResult(log, { ...identity, attempt: input.attempt }, "beforeEach", Date.now() - hookStarted);
                    phase = "body";
                    await descriptor.run(contextSetup);
                }, () => phase === "beforeEach" && context._state.step !== "beforeEach" ? `beforeEach: ${context._state.step}` : context._state.step, "test", timeout);
            } catch (caught) {
                if (phase === "beforeEach" && hookStarted) logHookResult(log, { ...identity, attempt: input.attempt }, "beforeEach", Date.now() - hookStarted, caught, caught instanceof TestTimeoutError ? caught.step : step);
                thrown = caught;
                error = errMessage(caught);
                const innerStep = context._state.stepOf(caught);
                step = caught instanceof TestTimeoutError ? caught.step : phase === "beforeEach" && innerStep !== "beforeEach" ? `beforeEach: ${innerStep}` : innerStep;
                await capturePrimary(caught);
            }
        }
        if (!(thrown instanceof EnvironmentStopError) && input.hooks?.afterEach) {
            const previousFailure = thrown !== undefined;
            phase = "afterEach";
            hookStarted = Date.now();
            logHookStart(log, { ...identity, attempt: input.attempt }, "afterEach");
            try {
                await lifetime.run(async () => {
                    const after = await invokeHook("afterEach", input.hooks?.afterEach, contextSetup);
                    // The step of a body failure stays primary; the catch below builds the afterEach note.
                    if (after.error !== undefined) throw after.error;
                }, () => context._state.step === "afterEach" ? "afterEach" : `afterEach: ${context._state.step}`, "afterEach", timeout);
                logHookResult(log, { ...identity, attempt: input.attempt }, "afterEach", Date.now() - hookStarted);
            } catch (caught) {
                logHookResult(log, { ...identity, attempt: input.attempt }, "afterEach", Date.now() - hookStarted, caught, caught instanceof TestTimeoutError ? caught.step : `afterEach: ${context._state.stepOf(caught)}`);
                if (caught instanceof EnvironmentStopError) throw caught;
                const innerStep = context._state.stepOf(caught);
                const afterStep = caught instanceof TestTimeoutError ? caught.step : innerStep === "afterEach" ? innerStep : `afterEach: ${innerStep}`;
                const absolute = testFileLocation(caught, file);
                const location = absolute ? ` (${displayPath(configuration.cwd, file)}:${/:(\d+)$/.exec(absolute)?.[1]})` : "";
                const note = `${afterStep}: ${errMessage(caught)}${location}`;
                if (previousFailure) cleanupErrors.push(note);
                else {
                    thrown = caught; error = errMessage(caught); step = afterStep;
                    await capturePrimary(caught);
                    cleanupErrors.push(note);
                }
            }
        }
    } catch (caught) {
        if (caught instanceof EnvironmentStopError) thrown = caught;
        else if (thrown === undefined) { thrown = caught; error = errMessage(caught); step = context._state.stepOf(caught); }
    } finally {
        client = launcher.client ?? client;
        if (baseline && !(thrown instanceof EnvironmentStopError)) {
            try { await input.testWindow.assertIdentity(client); }
            catch (identityError) { if (identityError instanceof EnvironmentStopError) thrown = identityError; }
        }
        if (baseline && !(thrown instanceof EnvironmentStopError)) cleanupErrors.push(...await closePagesOpenedSince(client, baseline, (event, details) => log.write({ event, ...identity, attempt: input.attempt, ...details }), timeouts.cleanup ?? 3000, input.testWindow.mode === "attached-selected" ? context._state.ownedPages : undefined, context._state.sessionPages, input.testWindow));
    }
    if (thrown instanceof EnvironmentStopError) throw thrown;
    const absoluteLocation = testFileLocation(thrown, file);
    const line = absoluteLocation ? /:(\d+)$/.exec(absoluteLocation)?.[1] : undefined;
    const location = line ? `${displayPath(configuration.cwd, file)}:${line}` : undefined;
    return { client, durationMs: Date.now() - started, ...(error !== undefined ? { error } : {}), ...(thrown !== undefined ? { thrown } : {}), ...(step ? { step } : {}), ...(location ? { location } : {}), cleanupErrors, screenshots: capture.screenshots, captureErrors: capture.captureErrors, attachments: context._state.attachments, ...(capture.failureBundle ? { failureBundle: capture.failureBundle } : {}) };
}
