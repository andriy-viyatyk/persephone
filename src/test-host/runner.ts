import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { McpClient, Timeouts } from "./client.js";
import { TestLauncher, type HostConfiguration } from "./launcher.js";
import { errMessage } from "../shared/utils.js";
import { matchesSelection, prepareLogDirectory, readFailedSelection, resolveLogDirectory, selectForRerun, writeReports, type TestResult } from "./results.js";
import { TestLog } from "./test-log.js";
import { createHostTimeouts } from "./timeouts.js";
import { loadContextSetup } from "./context-setup.js";
import { readTestSelection, selectedByGrep, selectedByManifest } from "./test-selection.js";
import { testIdentityKey } from "./test-identity.js";
import { runAttempt } from "./test-attempt.js";
import type { TestDescriptor } from "./test-api.js";
import { displayPath } from "./source-location.js";
import { TestWindowOwner } from "./test-window.js";
import { EnvironmentStopError } from "./attention-policy.js";

type Descriptor = TestDescriptor;
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
                if (descriptor.mode !== undefined && !["skip", "only", "fails"].includes(descriptor.mode)) throw new Error(`Test '${descriptor.name}' has an invalid mode.`);
                if (descriptor.mode === "fails" && (typeof descriptor.reason !== "string" || !descriptor.reason.trim())) throw new Error(`Test '${descriptor.name}' in fails mode requires a non-empty reason.`);
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
    let testWindow: TestWindowOwner | undefined;
    let retainedApp: { pid: number; url: string } | undefined;
    let environmentStop: string | undefined;

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
                retries: configuration.retries ?? 0,
                grep: configuration.grep,
            },
        });

        const files = await discover(configuration.testPath);
        const discoveredFiles = files.map((group) => ({ file: group.file, tests: [...group.tests] }));
        const selected = configuration.testSelection ? await readTestSelection(configuration.testSelection) : undefined;
        const setup = await loadContextSetup(configuration.testSetup);
        if (configuration.testSelection) {
            const found = new Set(discoveredFiles.flatMap((group) => group.tests.map((descriptor) => testIdentityKey({ file: group.file, name: descriptor.name }))));
            const missing = [...selected].filter((key) => !found.has(key));
            if (missing.length) throw new Error(`Test selection contains ${missing.length} identities outside ${configuration.testPath}.`);
        }
        const selection = selectForRerun(discoveredFiles, rerunSelection);
        stale = selection.stale;
        for (const identity of stale) log.write({ event: "rerun-stale", ...identity });
        if (configuration.rerunFailed && selection.selected?.size === 0) {
            console.warn("No saved failed tests were discovered; see stale identities in report.md.");
        }

        const grep = configuration.grep === undefined ? undefined : new RegExp(configuration.grep);
        for (const group of files) group.tests = group.tests.filter((descriptor) => selectedByManifest(group.file, descriptor.name, selected)
            && selectedByGrep(descriptor.name, grep));
        const focusSelected = files.flatMap((group) => group.tests.filter((descriptor) => matchesSelection(group.file, descriptor.name, selection.selected)));
        const hasOnly = focusSelected.some((descriptor) => descriptor.mode === "only");
        if (hasOnly) console.log("Focused run: executing test.only descriptors only.");
        client = await launcher.start();
        const activeTestWindow = await TestWindowOwner.start(client, configuration.attach, configuration.window);
        testWindow = activeTestWindow;
        runTests: for (const group of files) {
            for (const descriptor of group.tests) {
                if (!matchesSelection(group.file, descriptor.name, selection.selected)) continue;
                if (hasOnly && descriptor.mode !== "only") continue;
                const testStarted = Date.now();
                const identity = { file: group.file, test: descriptor.name };
                log.write({ event: "test-start", ...identity });
                const requirements = descriptor.requires ?? [];
                const missing = requirements.filter((tag) => tag !== "launch" && !configuration.with.includes(tag));
                const reason = descriptor.mode === "skip" ? "test.skip" : missing.length ? `requires opt-in tags: ${missing.join(", ")}` : configuration.attach && requirements.includes("launch") ? "requires an owned app launch" : undefined;
                if (reason) {
                    const result: TestResult = { file: group.file, name: descriptor.name, status: "skipped", durationMs: Date.now() - testStarted, skipReason: reason, ...(requirements.length ? { requirements } : {}) };
                    results.push(result);
                    log.write({ event: "test-outcome", ...identity, status: result.status, durationMs: result.durationMs, reason });
                    continue;
                }

                let attemptClient = launcher.client ?? client;
                if (!attemptClient) throw new Error("MCP client was not initialized.");
                const attempts: NonNullable<TestResult["attempts"]> = [];
                let finalAttempt: Awaited<ReturnType<typeof runAttempt>> | undefined;
                let failureBundle: string | undefined;
                let failureScreenshots: string[] = [];
                const attemptCaptureErrors: string[] = [];
                const retryLimit = configuration.retries ?? 0;
                for (let attemptNumber = 1; attemptNumber <= retryLimit + 1; attemptNumber++) {
                    attemptClient = launcher.client ?? attemptClient;
                    log.write({ event: "test-attempt-start", ...identity, attempt: attemptNumber, ...(attempts.at(-1)?.error ? { priorFailure: attempts.at(-1)?.error } : {}) });
                    try { finalAttempt = await runAttempt({ descriptor, file: group.file, client: attemptClient, launcher, timeouts, configuration, setup, log, outputDirectory, attempt: attemptNumber, testWindow: activeTestWindow }); }
                    catch (error) {
                        if (!(error instanceof EnvironmentStopError)) throw error;
                        environmentStop = error.message;
                        results.push({ file: group.file, name: descriptor.name, status: "not-run", durationMs: Date.now() - testStarted, error: error.message });
                        log.write({ event: "test-outcome", ...identity, status: "not-run", durationMs: Date.now() - testStarted, error: error.message });
                        for (const remainingGroup of files) for (const remaining of remainingGroup.tests) {
                            const key = testIdentityKey({ file: remainingGroup.file, name: remaining.name });
                            if (results.some((result) => testIdentityKey(result) === key) || !matchesSelection(remainingGroup.file, remaining.name, selection.selected)) continue;
                            results.push({ file: remainingGroup.file, name: remaining.name, status: "not-run", durationMs: 0 });
                        }
                        break runTests;
                    }
                    attemptClient = finalAttempt.client;
                    if (finalAttempt.error) {
                        failureBundle = finalAttempt.failureBundle;
                        failureScreenshots = finalAttempt.screenshots;
                    }
                    attemptCaptureErrors.push(...finalAttempt.captureErrors);
                    const failed = Boolean(finalAttempt.error || finalAttempt.cleanupErrors.length);
                    const expectedFailure = descriptor.mode === "fails" && failed && finalAttempt.cleanupErrors.length === 0;
                    const failedAttempt = descriptor.mode === "fails" ? !expectedFailure : failed;
                    attempts.push({ attempt: attemptNumber, status: failedAttempt ? "failed" : "passed", ...(finalAttempt.error ? { error: finalAttempt.error } : {}), ...(finalAttempt.location ? { location: finalAttempt.location } : {}), ...(finalAttempt.step ? { step: finalAttempt.step } : {}) });
                    log.write({ event: "test-attempt-result", ...identity, attempt: attemptNumber, status: failedAttempt ? "failed" : "passed", ...(finalAttempt.error ? { error: finalAttempt.error } : {}) });
                    if (!failedAttempt || attemptNumber > retryLimit) break;
                }
                client = attemptClient;
                if (!finalAttempt) throw new Error(`Test "${descriptor.name}" completed without an attempt result.`);
                const done = finalAttempt;
                const attemptFailed = Boolean(done.error || done.cleanupErrors.length);
                let status: TestResult["status"] = attemptFailed ? "failed" : "passed";
                let errorText = done.error;
                if (descriptor.mode === "fails") {
                    if (!attemptFailed) { status = "unexpected-pass"; errorText = `Expected failure: ${descriptor.reason}`; }
                    else if (!done.cleanupErrors.length) status = "expected-failure";
                } else if (!attemptFailed && attempts.length > 1) status = "flaky";
                const durationMs = Date.now() - testStarted;
                const result: TestResult = {
                    file: group.file,
                    name: descriptor.name,
                    status,
                    durationMs,
                    ...(done.step ? { step: done.step } : done.cleanupErrors.length && !errorText ? { step: "per-test cleanup" } : attempts.findLast((attempt) => attempt.status === "failed")?.step ? { step: attempts.findLast((attempt) => attempt.status === "failed")?.step } : {}),
                    ...(errorText ? { error: errorText } : done.cleanupErrors.length ? { error: "Per-test cleanup found leftover state or failed to complete." } : {}),
                    ...(requirements.length ? { requirements } : {}),
                    ...(done.cleanupErrors.length ? { cleanupErrors: done.cleanupErrors } : {}),
                    ...(failureBundle ? { failureBundle } : {}),
                    ...(failureScreenshots.length ? { screenshots: failureScreenshots } : {}),
                    ...(attemptCaptureErrors.length ? { captureErrors: attemptCaptureErrors } : {}),
                    ...(descriptor.reason ? { reason: descriptor.reason } : {}),
                    ...(attempts.length > 1 ? { attempts } : {}),
                    ...(done.location ?? attempts.findLast((attempt) => attempt.location)?.location ? { location: done.location ?? attempts.findLast((attempt) => attempt.location)?.location } : {}),
                };
                results.push(result);
                log.write({ event: "test-outcome", ...identity, status, durationMs, ...(result.step ? { step: result.step } : {}), ...(result.error ? { error: result.error } : {}), ...(done.cleanupErrors.length ? { cleanupErrors: done.cleanupErrors } : {}), ...(result.attempts ? { attempts: result.attempts } : {}) });
            }
        }
    } catch (error) {
        if (error instanceof EnvironmentStopError) environmentStop = error.message;
        else setupFailure = error;
    } finally {
        if (testWindow && configuration.attach) {
            try {
                const attachedClient = launcher.client ?? client;
                if (!attachedClient) setupFailure ??= new Error("MCP client was not initialized during test-window teardown.");
                else if (testWindow.mode === "attached-created") await testWindow.disposeCreatedWindow(attachedClient);
                else await testWindow.assertIdentity(attachedClient);
            } catch (error) { if (error instanceof EnvironmentStopError) environmentStop ??= error.message; else setupFailure ??= error; }
        }
        try {
            if (configuration.keepOpen && !configuration.attach && (results.some((result) => result.status === "failed" || result.status === "unexpected-pass") || setupFailure)) retainedApp = await launcher.retain();
            else await launcher.stop();
        }
        catch (error) { setupFailure ??= error; }
        try { launcher.close(); }
        catch (error) { setupFailure ??= error; }
        if (outputDirectory) {
            try { await writeReports(results, { directory: outputDirectory, target: configuration.testPath, startedAt: started, stale, setupFailure, retainedApp, environmentStop }); }
            catch (error) { setupFailure ??= error; }
        }
        const passed = results.filter((result) => result.status === "passed").length;
        const failed = results.filter((result) => result.status === "failed").length + (setupFailure ? 1 : 0);
        const notRun = results.filter((result) => result.status === "not-run").length;
        const skipped = results.filter((result) => result.status === "skipped").length;
        const expectedFailure = results.filter((result) => result.status === "expected-failure").length;
        const unexpectedPass = results.filter((result) => result.status === "unexpected-pass").length;
        const flaky = results.filter((result) => result.status === "flaky").length;
        try { log?.write({ event: "run-summary", startedAt: started, passed, failed, skipped, expectedFailure, unexpectedPass, flaky, notRun, ...(environmentStop ? { environmentStop } : {}), ...(setupFailure ? { setupFailure: errMessage(setupFailure) } : {}) }); }
        finally { log?.close(); }
        console.log(`Test run ${started}: ${passed} passed, ${failed} failed, ${skipped} skipped, ${notRun} not run, ${expectedFailure} expected failure, ${unexpectedPass} unexpected passes, ${flaky} flaky.${environmentStop ? ` Environment stop: ${environmentStop}` : ""}`);
        for (const result of results.filter((item) => item.status !== "passed")) {
            console.log(`${result.status.toUpperCase()} ${displayPath(configuration.cwd, result.file)} — ${result.name}${result.step ? ` — ${result.step}` : ""}${result.error ? `\n${result.error}` : ""}`);
            for (const cleanupError of result.cleanupErrors ?? []) console.error(`CLEANUP ${cleanupError}`);
            for (const screenshot of result.screenshots ?? []) console.log(`Screenshot: ${outputDirectory ? path.join(outputDirectory, screenshot) : screenshot}`);
            for (const captureError of result.captureErrors ?? []) console.error(`CAPTURE ${captureError}`);
        }
        for (const identity of stale) console.log(`STALE ${displayPath(configuration.cwd, identity.file)} — ${identity.name} (saved as failed, no longer exists; skipped)`);
        if (outputDirectory) console.log(`Results: ${outputDirectory}`);
        else if (configuration.logFile) console.log(`Log: ${configuration.logFile}`);
        if (setupFailure) console.error(`Test runner setup failed: ${errMessage(setupFailure)}`);
        if (retainedApp) console.log(`Owned app retained after failure (PID ${retainedApp.pid}, MCP ${retainedApp.url}).`);
        const summaryResults = results.filter((result) => result.status !== "passed");
        if (summaryResults.length) {
            console.log("Summary:");
            for (const result of summaryResults) {
                const labels: Record<TestResult["status"], string> = { passed: "PASSED", failed: "FAILED", skipped: "SKIPPED", "expected-failure": "EXPECTED FAILURE", "unexpected-pass": "UNEXPECTED PASS", flaky: "FLAKY", "not-run": "NOT RUN" };
                const location = result.location ?? displayPath(configuration.cwd, result.file);
                const attemptError = result.attempts?.find((attempt) => attempt.error)?.error;
                const detail = result.status === "skipped" ? result.skipReason
                    : result.status === "expected-failure" ? result.reason
                        : firstErrorLine(result.error ?? attemptError, result.step) ?? result.reason;
                console.log(`${labels[result.status]} — ${result.name} — ${location}${detail ? ` — ${detail}` : ""}`);
            }
        }
    }

    return environmentStop ? 3 : results.some((result) => result.status === "failed" || result.status === "unexpected-pass") || setupFailure ? 1 : 0;
}

/** The first meaningful error line; a call error repeats its step on its first line, so that line is skipped. */
function firstErrorLine(error: string | undefined, step: string | undefined): string | undefined {
    return error?.split(/\r?\n/).map((line) => line.trim()).find((line) => line && line !== step);
}
