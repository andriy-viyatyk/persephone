import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createContext, type TestContext } from "./context.js";
import type { McpClient, Timeouts } from "./client.js";
import { TestLauncher, type HostConfiguration } from "./launcher.js";
import { errMessage } from "../shared/utils.js";
import { beginPageOwnership, closePagesOpenedSince } from "./browser-helpers.js";
import { captureFailure, matchesSelection, prepareLogDirectory, readFailedSelection, resolveLogDirectory, selectForRerun, writeReports, type TestResult } from "./results.js";
import { TestLog } from "./test-log.js";
import { createHostTimeouts } from "./timeouts.js";
import { loadContextSetup } from "./context-setup.js";
import { readTestSelection, selectedByManifest } from "./test-selection.js";
import { testIdentityKey } from "./test-identity.js";

interface Descriptor { name: string; run: (context: TestContext) => Promise<void>; requires?: string[]; }
type DiscoveredFile = { file: string; tests: Descriptor[] };

async function discover(target: string): Promise<DiscoveredFile[]> {
    const stat = await fs.stat(target);
    const files: string[] = [];
    if (stat.isFile()) {
        if (!target.endsWith(".test.mjs")) throw new Error("Test file must end with .test.mjs.");
        files.push(target);
    }
    else {
        const walk = async (directory: string): Promise<void> => {
            const entries = await fs.readdir(directory, { withFileTypes: true });
            for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
                const current = path.join(directory, entry.name);
                if (entry.isDirectory()) await walk(current);
                else if (entry.isFile() && entry.name.endsWith(".test.mjs")) files.push(current);
            }
        };
        await walk(target);
    }
    files.sort((a, b) => a.localeCompare(b));
    if (!files.length) throw new Error(`No .test.mjs files found in ${target}.`);
    const discovered: DiscoveredFile[] = [];
    for (const file of files) {
        try {
            const imported = await import(pathToFileURL(file).href);
            const moduleDefault = imported.default as Descriptor | Descriptor[];
            const exported: Descriptor[] = Array.isArray(moduleDefault) ? moduleDefault : [moduleDefault];
            if (!exported.length || exported.some((test) => !test || typeof test.name !== "string" || typeof test.run !== "function")) throw new Error("Expected a default test descriptor or a non-empty array of descriptors.");
            for (const descriptor of exported) {
                const requires = descriptor.requires ?? [];
                if (!Array.isArray(requires) || requires.some((tag) => typeof tag !== "string" || !tag.trim()) || new Set(requires).size !== requires.length) throw new Error(`Test '${descriptor.name}' requires unique non-empty tag strings.`);
            }
            discovered.push({ file, tests: exported });
        } catch (error) {
            discovered.push({ file, tests: [{ name: "<module import>", requires: [], run: async () => { throw error; } }] });
        }
    }
    return discovered;
}

export async function run(configuration: HostConfiguration, attachPort?: number): Promise<number> {
    const timeouts: Timeouts = createHostTimeouts(configuration.timeoutScale);
    const launcher = new TestLauncher(configuration, timeouts);
    const started = new Date().toISOString();
    const results: TestResult[] = [];
    let outputDirectory: string | undefined;
    let log: TestLog | undefined;
    let setupFailure: unknown;
    let stale: Array<{ file: string; name: string }> = [];
    let client: McpClient | undefined;
    let retainedApp: { pid: number; url: string } | undefined;

    try {
        if (attachPort !== undefined) configuration.port = attachPort;
        let rerunSelection;
        if (!configuration.logFile) {
            outputDirectory = await resolveLogDirectory(configuration);
            if (configuration.rerunFailed) rerunSelection = await readFailedSelection(outputDirectory);
            await prepareLogDirectory(outputDirectory, !configuration.logDirectory);
            if (!configuration.attach) {
                for (const name of ["app-main.log", "app-console.log", "site-console.log", "network.log"]) {
                    await fs.writeFile(path.join(outputDirectory, name), "", "utf8");
                }
                configuration.logDirectory = outputDirectory;
            }
            log = new TestLog(path.join(outputDirectory, "tests.log"));
        } else {
            log = new TestLog(configuration.logFile);
        }
        log.write({
            event: "run-start",
            startedAt: started,
            outputDirectory: outputDirectory ?? configuration.logFile,
            configuration: {
                testPath: configuration.testPath,
                cwd: configuration.cwd,
                attach: configuration.attach,
                profile: configuration.profile,
                logFile: configuration.logFile,
                logDirectory: configuration.logDirectory,
                rerunFailed: configuration.rerunFailed,
            },
        });

        const files = await discover(configuration.testPath);
        const selected = configuration.testSelection ? await readTestSelection(configuration.testSelection) : undefined;
        const setup = await loadContextSetup(configuration.testSetup);
        for (const group of files) group.tests = group.tests.filter((descriptor) => selectedByManifest(group.file, descriptor.name, selected));
        if (configuration.testSelection) {
            const found = new Set(files.flatMap((group) => group.tests.map((descriptor) => testIdentityKey({ file: group.file, name: descriptor.name }))));
            const missing = [...selected].filter((key) => !found.has(key));
            if (missing.length) throw new Error(`Test selection contains ${missing.length} identities outside ${configuration.testPath}.`);
        }
        const selection = selectForRerun(files, rerunSelection);
        stale = selection.stale;
        for (const identity of stale) log.write({ event: "rerun-stale", ...identity });
        if (configuration.rerunFailed && selection.selected?.size === 0) {
            console.warn("No saved failed tests were discovered; see stale identities in report.md.");
        }

        client = await launcher.start();
        for (const group of files) {
            for (const descriptor of group.tests) {
                if (!matchesSelection(group.file, descriptor.name, selection.selected)) continue;
                const testStarted = Date.now();
                const identity = { file: group.file, test: descriptor.name };
                log.write({ event: "test-start", ...identity });
                const requirements = descriptor.requires ?? [];
                const missing = requirements.filter((tag) => tag !== "launch" && !configuration.with.includes(tag));
                const reason = missing.length ? `requires opt-in tags: ${missing.join(", ")}` : configuration.attach && requirements.includes("launch") ? "requires an owned app launch" : undefined;
                if (reason) {
                    const result: TestResult = { file: group.file, name: descriptor.name, status: "skipped", durationMs: Date.now() - testStarted, skipReason: reason, ...(requirements.length ? { requirements } : {}) };
                    results.push(result);
                    log.write({ event: "test-outcome", ...identity, status: result.status, durationMs: result.durationMs, reason });
                    continue;
                }

                client = launcher.client ?? client;
                if (!client) throw new Error("MCP client was not initialized.");
                const context = createContext(client, launcher, timeouts, configuration.attach, log, { ...identity, profileDirectory: configuration.profileDirectory });
                let baseline;
                let errorText: string | undefined;
                let failingStep: string | undefined;
                let capture = { screenshots: [] as string[], captureErrors: [] as string[] };
                let cleanupErrors: string[] = [];
                try {
                    baseline = await beginPageOwnership(client, (event, details) => log?.write({ event, ...identity, ...details }));
                    const getClient = (): McpClient => {
                        const current = launcher.client ?? client;
                        if (!current) throw new Error("MCP client is not available during test setup.");
                        return current;
                    };
                    const extendedContext = setup ? await setup(context, { file: group.file, name: descriptor.name, profileDirectory: configuration.profileDirectory, attach: configuration.attach }, getClient) : context;
                    await descriptor.run(extendedContext);
                } catch (error) {
                    errorText = errMessage(error);
                    failingStep = context._state.stepOf(error);
                    client = launcher.client ?? client;
                    if (baseline && outputDirectory) capture = await captureFailure(client, baseline, outputDirectory, { file: group.file, name: descriptor.name }, log);
                } finally {
                    client = launcher.client ?? client;
                    if (baseline) cleanupErrors = await closePagesOpenedSince(client, baseline, (event, details) => log?.write({ event, ...identity, ...details }), timeouts.cleanup ?? 3000);
                }

                const durationMs = Date.now() - testStarted;
                const status = errorText || cleanupErrors.length ? "failed" : "passed";
                const result: TestResult = {
                    file: group.file,
                    name: descriptor.name,
                    status,
                    durationMs,
                    ...(failingStep ? { step: failingStep } : cleanupErrors.length && !errorText ? { step: "per-test cleanup" } : {}),
                    ...(errorText ? { error: errorText } : cleanupErrors.length ? { error: "Per-test cleanup found leftover state or failed to complete." } : {}),
                    ...(requirements.length ? { requirements } : {}),
                    ...(cleanupErrors.length ? { cleanupErrors } : {}),
                    ...(capture.screenshots.length ? { screenshots: capture.screenshots } : {}),
                    ...(capture.captureErrors.length ? { captureErrors: capture.captureErrors } : {}),
                };
                results.push(result);
                log.write({ event: "test-outcome", ...identity, status, durationMs, ...(result.step ? { step: result.step } : {}), ...(result.error ? { error: result.error } : {}), ...(cleanupErrors.length ? { cleanupErrors } : {}) });
            }
        }
    } catch (error) {
        setupFailure = error;
    } finally {
        try {
            if (configuration.keepOpen && !configuration.attach && (results.some((result) => result.status === "failed") || setupFailure)) retainedApp = await launcher.retain();
            else await launcher.stop();
        }
        catch (error) { setupFailure ??= error; }
        try { launcher.close(); }
        catch (error) { setupFailure ??= error; }
        if (outputDirectory) {
            try { await writeReports(results, { directory: outputDirectory, target: configuration.testPath, startedAt: started, stale, setupFailure, retainedApp }); }
            catch (error) { setupFailure ??= error; }
        }
        const passed = results.filter((result) => result.status === "passed").length;
        const failed = results.filter((result) => result.status === "failed").length + (setupFailure ? 1 : 0);
        const skipped = results.filter((result) => result.status === "skipped").length;
        try { log?.write({ event: "run-summary", startedAt: started, passed, failed, skipped, ...(setupFailure ? { setupFailure: errMessage(setupFailure) } : {}) }); }
        finally { log?.close(); }
        console.log(`Test run ${started}: ${passed} passed, ${failed} failed, ${skipped} skipped.`);
        for (const result of results.filter((item) => item.status !== "passed")) {
            console.log(`${result.status.toUpperCase()} ${displayPath(configuration.cwd, result.file)} — ${result.name}${result.step ? ` — ${result.step}` : ""}${result.error ? `\n${result.error}` : ""}`);
            for (const cleanupError of result.cleanupErrors ?? []) console.error(`CLEANUP ${cleanupError}`);
            for (const screenshot of result.screenshots ?? []) console.log(`Screenshot: ${outputDirectory ? path.join(outputDirectory, screenshot) : screenshot}`);
            for (const captureError of result.captureErrors ?? []) console.error(`SCREENSHOT ${captureError}`);
        }
        for (const identity of stale) console.log(`STALE ${displayPath(configuration.cwd, identity.file)} — ${identity.name} (saved as failed, no longer exists; skipped)`);
        if (outputDirectory) console.log(`Results: ${outputDirectory}`);
        else if (configuration.logFile) console.log(`Log: ${configuration.logFile}`);
        if (setupFailure) console.error(`Test runner setup failed: ${errMessage(setupFailure)}`);
        if (retainedApp) console.log(`Owned app retained after failure (PID ${retainedApp.pid}, MCP ${retainedApp.url}).`);
    }

    return results.some((result) => result.status === "failed") || setupFailure ? 1 : 0;
}

/** Relative to the caller's cwd when the file is inside it; otherwise the absolute path. */
function displayPath(cwd: string, file: string): string {
    const relative = path.relative(cwd, file);
    return relative && !relative.startsWith("..") && !path.isAbsolute(relative) ? relative : file;
}
