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

export interface AttemptInput {
    descriptor: TestDescriptor;
    file: string;
    client: McpClient;
    launcher: TestLauncher;
    timeouts: Timeouts;
    configuration: HostConfiguration;
    setup?: Awaited<ReturnType<typeof loadContextSetup>>;
    log: TestLog;
    outputDirectory?: string;
    attempt: number;
    testWindow: TestWindowOwner;
}
export interface AttemptResult {
    client: McpClient;
    durationMs: number;
    error?: string;
    thrown?: unknown;
    step?: string;
    cleanupErrors: string[];
    screenshots: string[];
    captureErrors: string[];
    failureBundle?: string;
    location?: string;
}

export async function runAttempt(input: AttemptInput): Promise<AttemptResult> {
    const { descriptor, file, configuration, launcher, timeouts, log } = input;
    const identity = { file, test: descriptor.name };
    const started = Date.now();
    let client = launcher.client ?? input.client;
    const context = createContext(client, launcher, timeouts, configuration.attach, input.testWindow, log, { ...identity, profileDirectory: configuration.profileDirectory });
    let baseline: Awaited<ReturnType<typeof beginPageOwnership>> | undefined;
    let error: string | undefined;
    let thrown: unknown;
    let step: string | undefined;
    let capture: FailureCapture = { screenshots: [], captureErrors: [] };
    let cleanupErrors: string[] = [];
    try {
        await input.testWindow.assertIdentity(client);
        baseline = await beginPageOwnership(client, (event, details) => log.write({ event, ...identity, attempt: input.attempt, ...details }), input.testWindow);
        const getClient = (): McpClient => {
            const current = launcher.client ?? client;
            if (!current) throw new Error("MCP client is not available during test setup.");
            return current;
        };
        const extendedContext = input.setup ? await input.setup(context, { file, name: descriptor.name, profileDirectory: configuration.profileDirectory, attach: configuration.attach }, getClient, input.testWindow) : context;
        await descriptor.run(extendedContext);
    } catch (caught) {
        thrown = caught;
        error = errMessage(caught);
        step = context._state.stepOf(caught);
        client = launcher.client ?? client;
        if (!(caught instanceof EnvironmentStopError) && baseline && input.outputDirectory) {
            try {
                capture = await captureFailure(client, baseline, input.outputDirectory, { file, name: descriptor.name }, input.attempt, started, context._state.pagesUnderTest(), context._state.sessionPages, log, input.testWindow);
            } catch (captureError) {
                capture.captureErrors.push(`Failure capture failed: ${errMessage(captureError)}`);
            }
        }
    } finally {
        client = launcher.client ?? client;
        // A test window closed during the test is an environment stop, not a cleanup failure of this test.
        if (baseline && !(thrown instanceof EnvironmentStopError)) {
            try { await input.testWindow.assertIdentity(client); }
            catch (identityError) { if (identityError instanceof EnvironmentStopError) thrown = identityError; /* other errors surface through cleanup */ }
        }
        if (baseline && !(thrown instanceof EnvironmentStopError)) cleanupErrors = await closePagesOpenedSince(client, baseline, (event, details) => log.write({ event, ...identity, attempt: input.attempt, ...details }), timeouts.cleanup ?? 3000, input.testWindow.mode === "attached-selected" ? context._state.ownedPages : undefined, context._state.sessionPages, input.testWindow);
    }
    if (thrown instanceof EnvironmentStopError) throw thrown;
    const absoluteLocation = testFileLocation(thrown, file);
    const line = absoluteLocation ? /:(\d+)$/.exec(absoluteLocation)?.[1] : undefined;
    const location = line ? `${displayPath(configuration.cwd, file)}:${line}` : undefined;
    return { client, durationMs: Date.now() - started, ...(error !== undefined ? { error } : {}), ...(thrown !== undefined ? { thrown } : {}), ...(step ? { step } : {}), ...(location ? { location } : {}), cleanupErrors, screenshots: capture.screenshots, captureErrors: capture.captureErrors, ...(capture.failureBundle ? { failureBundle: capture.failureBundle } : {}) };
}
