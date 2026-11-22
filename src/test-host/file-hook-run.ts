import type { McpClient, Timeouts } from "./client.js";
import type { HostConfiguration, TestLauncher } from "./launcher.js";
import { createContext } from "./context.js";
import type { TestContext } from "./context.js";
import type { loadContextSetup } from "./context-setup.js";
import { invokeHook, logHookResult, logHookStart, type HookName } from "./file-hooks.js";
import { beginPageOwnership } from "./browser-helpers.js";
import { captureFailure, type FailureCapture } from "./failure-bundle.js";
import { displayPath, testFileLocation } from "./source-location.js";
import type { TestLog } from "./test-log.js";
import type { TestWindowOwner } from "./test-window.js";
import { createTestLifetime, TestTimeoutError } from "./test-timeout.js";
import { scaleTimeout } from "./timeouts.js";
import { errMessage } from "../shared/utils.js";
import { EnvironmentStopError } from "./attention-policy.js";
import type { TestResult } from "./results.js";

export interface FileHookInput {
    file: string; name: "<beforeAll>" | "<afterAll>"; hookName: HookName;
    hook?: (context: TestContext) => unknown | Promise<unknown>;
    client: McpClient; launcher: TestLauncher; timeouts: Timeouts; configuration: HostConfiguration;
    setup?: Awaited<ReturnType<typeof loadContextSetup>>; log: TestLog; outputDirectory?: string;
    testWindow: TestWindowOwner; baseline?: Awaited<ReturnType<typeof beginPageOwnership>>;
}

export async function runFileHook(input: FileHookInput): Promise<{ client: McpClient; result: TestResult; ownedPages: Set<string>; sessionPages: Set<string> }> {
    const timeout = scaleTimeout(input.configuration.testTimeout ?? 300_000, input.timeouts.scale ?? 1);
    const lifetime = createTestLifetime(timeout, input.name);
    let client = input.launcher.client ?? input.client;
    const context = createContext(client, input.launcher, input.timeouts, input.configuration.attach, input.testWindow, lifetime, input.log, { file: input.file, test: input.name, profileDirectory: input.configuration.profileDirectory });
    let baseline = input.baseline;
    const started = Date.now();
    let failure: unknown;
    let step: string | undefined;
    const hookStarted = Date.now();
    let hookResultLogged = false;
    logHookStart(input.log, { file: input.file, test: input.name }, input.hookName);
    let capture: FailureCapture = { screenshots: [], captureErrors: [] };
    try {
        await input.testWindow.assertIdentity(client);
        baseline ??= await beginPageOwnership(client, (event, details) => input.log.write({ event, file: input.file, test: input.name, ...details }), input.testWindow);
        const getClient = (): McpClient => {
            const current = input.launcher.client ?? client;
            if (!current) throw new Error("MCP client is not available during file hook setup.");
            return current;
        };
        const setup = input.setup;
        const extended = setup
            ? await lifetime.runSetup(input.name, () => setup(context, { file: input.file, name: input.name, profileDirectory: input.configuration.profileDirectory, attach: input.configuration.attach }, getClient, input.testWindow, lifetime))
            : context;
        try {
            const outcome = await lifetime.run(async () => invokeHook(input.hookName, input.hook, extended), () => context._state.step === input.hookName ? input.hookName : `${input.hookName}: ${context._state.step}`, input.name, timeout);
            failure = outcome.error;
            step = outcome.step;
            logHookResult(input.log, { file: input.file, test: input.name }, input.hookName, Date.now() - hookStarted, failure, step);
            hookResultLogged = true;
        } catch (error) {
            failure = error;
            step = error instanceof TestTimeoutError ? error.step : context._state.stepOf(error);
            logHookResult(input.log, { file: input.file, test: input.name }, input.hookName, Date.now() - hookStarted, failure, step);
            hookResultLogged = true;
        }
    } catch (error) {
        if (error instanceof EnvironmentStopError) throw error;
        failure = error;
        step ??= context._state.step === "starting" ? `${input.hookName}: setup` : `${input.hookName}: ${context._state.stepOf(error)}`;
    }
    if (failure instanceof EnvironmentStopError) throw failure;
    if (!hookResultLogged) logHookResult(input.log, { file: input.file, test: input.name }, input.hookName, Date.now() - hookStarted, failure, step);
    if (failure !== undefined && baseline && input.outputDirectory) {
        const captureErrors: string[] = [];
        try { await lifetime.waitForRestart(); }
        catch (error) {
            if (error instanceof EnvironmentStopError) throw error;
            captureErrors.push(`App restart did not finish after file hook failure: ${errMessage(error)}`);
        }
        client = input.launcher.client ?? client;
        try { capture = await captureFailure(client, baseline, input.outputDirectory, { file: input.file, name: input.name }, 1, started, context._state.pagesUnderTest(), context._state.sessionPages, input.log, input.testWindow); }
        catch (error) {
            if (error instanceof EnvironmentStopError) throw error;
            captureErrors.push(`Failure capture failed: ${errMessage(error)}`);
        }
        capture.captureErrors.push(...captureErrors);
    }
    const absolute = testFileLocation(failure, input.file);
    const line = absolute ? /:(\d+)$/.exec(absolute)?.[1] : undefined;
    const result: TestResult = {
        file: input.file, name: input.name, status: failure === undefined ? "passed" : "failed", durationMs: Date.now() - started,
        ...(step ? { step } : {}), ...(failure === undefined ? {} : { error: errMessage(failure) }),
        ...(line ? { location: `${displayPath(input.configuration.cwd, input.file)}:${line}` } : {}),
        ...(capture.failureBundle ? { failureBundle: capture.failureBundle } : {}),
        ...(capture.screenshots.length ? { screenshots: capture.screenshots } : {}),
        ...(capture.captureErrors.length ? { captureErrors: capture.captureErrors } : {}),
    };
    return { client: input.launcher.client ?? client, result, ownedPages: context._state.ownedPages, sessionPages: context._state.sessionPages };
}
