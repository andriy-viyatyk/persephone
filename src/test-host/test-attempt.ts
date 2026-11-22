import { createContext } from "./context.js";
import type { McpClient, Timeouts } from "./client.js";
import type { HostConfiguration, TestLauncher } from "./launcher.js";
import type { TestDescriptor } from "./test-api.js";
import { errMessage } from "../shared/utils.js";
import { beginPageOwnership, closePagesOpenedSince } from "./browser-helpers.js";
import { captureFailure } from "./results.js";
import type { loadContextSetup } from "./context-setup.js";
import { displayPath, testFileLocation } from "./source-location.js";
import type { TestLog } from "./test-log.js";

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
    location?: string;
}

export async function runAttempt(input: AttemptInput): Promise<AttemptResult> {
    const { descriptor, file, configuration, launcher, timeouts, log } = input;
    const identity = { file, test: descriptor.name };
    const started = Date.now();
    let client = launcher.client ?? input.client;
    const context = createContext(client, launcher, timeouts, configuration.attach, log, { ...identity, profileDirectory: configuration.profileDirectory });
    let baseline: Awaited<ReturnType<typeof beginPageOwnership>> | undefined;
    let error: string | undefined;
    let thrown: unknown;
    let step: string | undefined;
    let capture = { screenshots: [] as string[], captureErrors: [] as string[] };
    let cleanupErrors: string[] = [];
    try {
        baseline = await beginPageOwnership(client, (event, details) => log.write({ event, ...identity, attempt: input.attempt, ...details }));
        const getClient = (): McpClient => {
            const current = launcher.client ?? client;
            if (!current) throw new Error("MCP client is not available during test setup.");
            return current;
        };
        const extendedContext = input.setup ? await input.setup(context, { file, name: descriptor.name, profileDirectory: configuration.profileDirectory, attach: configuration.attach }, getClient) : context;
        await descriptor.run(extendedContext);
    } catch (caught) {
        thrown = caught;
        error = errMessage(caught);
        step = context._state.stepOf(caught);
        client = launcher.client ?? client;
        if (baseline && input.outputDirectory) capture = await captureFailure(client, baseline, input.outputDirectory, { file, name: descriptor.name }, log);
    } finally {
        client = launcher.client ?? client;
        if (baseline) cleanupErrors = await closePagesOpenedSince(client, baseline, (event, details) => log.write({ event, ...identity, attempt: input.attempt, ...details }), timeouts.cleanup ?? 3000, configuration.attach ? context._state.ownedPages : undefined);
    }
    const absoluteLocation = testFileLocation(thrown, file);
    const line = absoluteLocation ? /:(\d+)$/.exec(absoluteLocation)?.[1] : undefined;
    const location = line ? `${displayPath(configuration.cwd, file)}:${line}` : undefined;
    return { client, durationMs: Date.now() - started, ...(error !== undefined ? { error } : {}), ...(thrown !== undefined ? { thrown } : {}), ...(step ? { step } : {}), ...(location ? { location } : {}), cleanupErrors, screenshots: capture.screenshots, captureErrors: capture.captureErrors };
}
