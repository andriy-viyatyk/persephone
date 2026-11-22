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
import type { TestDescriptor } from "./test-api.js";
import { displayPath } from "./source-location.js";
import { TestWindowOwner } from "./test-window.js";
import { EnvironmentStopError } from "./attention-policy.js";
import { validateTestDescriptors } from "./test-descriptor-validation.js";
import { readFileHooks } from "./file-hooks.js";
import { runSelectedFiles, type DiscoveredFile } from "./test-file-run.js";

async function discover(target: string): Promise<DiscoveredFile[]> {
    const stat = await fs.stat(target);
    const files: string[] = [];
    if (stat.isFile()) {
        if (!target.endsWith(".test.mjs")) throw new Error("Test file must end with .test.mjs.");
        files.push(target);
    } else {
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
            const imported = await import(pathToFileURL(file).href) as Record<string, unknown>;
            const moduleDefault = imported.default as TestDescriptor | TestDescriptor[];
            validateTestDescriptors(moduleDefault);
            discovered.push({ file, tests: Array.isArray(moduleDefault) ? moduleDefault : [moduleDefault], hooks: readFileHooks(imported) });
        } catch (error) {
            discovered.push({ file, tests: [{ name: "<module import>", requires: [], run: async () => { throw error; } }], hooks: {} });
        }
    }
    return discovered;
}

export async function run(configuration: HostConfiguration, attachPort?: number): Promise<number> {
    const timeouts: Timeouts = createHostTimeouts(configuration.timeoutScale);
    const launcher = new TestLauncher(configuration, timeouts);
    const started = new Date().toISOString();
    const results: TestResult[] = [];
    let outputDirectory: string | undefined, log: TestLog | undefined, setupFailure: unknown;
    let stale: Array<{ file: string; name: string }> = [], client: McpClient | undefined;
    let testWindow: TestWindowOwner | undefined, retainedApp: { pid: number; url: string } | undefined, environmentStop: string | undefined;
    try {
        if (attachPort !== undefined) configuration.port = attachPort;
        let rerunSelection;
        if (!configuration.logFile) {
            outputDirectory = await resolveLogDirectory(configuration);
            if (configuration.rerunFailed) rerunSelection = await readFailedSelection(outputDirectory);
            await prepareLogDirectory(outputDirectory, !configuration.logDirectory);
            if (!configuration.attach) {
                for (const name of ["app-main.log", "app-console.log", "site-console.log", "network.log"]) await fs.writeFile(path.join(outputDirectory, name), "", "utf8");
                configuration.logDirectory = outputDirectory;
            }
            log = new TestLog(path.join(outputDirectory, "tests.log"));
        } else log = new TestLog(configuration.logFile);
        log.write({ event: "run-start", startedAt: started, outputDirectory: outputDirectory ?? configuration.logFile, configuration: { testPath: configuration.testPath, cwd: configuration.cwd, attach: configuration.attach, profile: configuration.profile, logFile: configuration.logFile, logDirectory: configuration.logDirectory, rerunFailed: configuration.rerunFailed, retries: configuration.retries ?? 0, testTimeout: configuration.testTimeout ?? 300_000, grep: configuration.grep } });

        const files = await discover(configuration.testPath);
        const selected = configuration.testSelection ? await readTestSelection(configuration.testSelection) : undefined;
        const setup = await loadContextSetup(configuration.testSetup);
        if (selected) {
            const found = new Set(files.flatMap((group) => group.tests.map((descriptor) => testIdentityKey({ file: group.file, name: descriptor.name }))));
            const missing = [...selected].filter((key) => !found.has(key));
            if (missing.length) throw new Error(`Test selection contains ${missing.length} identities outside ${configuration.testPath}.`);
        }
        const rerun = selectForRerun(files, rerunSelection);
        stale = rerun.stale;
        for (const identity of stale) log.write({ event: "rerun-stale", ...identity });
        if (configuration.rerunFailed && rerun.selected?.size === 0) console.warn("No saved failed tests were discovered; see stale identities in report.md.");
        const grep = configuration.grep === undefined ? undefined : new RegExp(configuration.grep);
        for (const group of files) group.tests = group.tests.filter((descriptor) => selectedByManifest(group.file, descriptor.name, selected) && selectedByGrep(descriptor.name, grep));
        const focusSelected = files.flatMap((group) => group.tests.filter((descriptor) => matchesSelection(group.file, descriptor.name, rerun.selected)));
        const hasOnly = focusSelected.some((descriptor) => descriptor.mode === "only");
        if (hasOnly) console.log("Focused run: executing test.only descriptors only.");
        client = await launcher.start();
        if (log) client.setStorageStateRedactor(log.redactor);
        testWindow = await TestWindowOwner.start(client, configuration.attach, configuration.window);
        const fileState = await runSelectedFiles({ files, configuration, launcher, timeouts, setup, log, outputDirectory, results, selected: rerun.selected, hasOnly, testWindow, client });
        client = fileState.client;
        environmentStop = fileState.environmentStop;
    } catch (error) {
        if (error instanceof EnvironmentStopError) environmentStop = error.message;
        else setupFailure = error;
    } finally {
        const scrub = (value: string | undefined): string | undefined => value === undefined ? undefined : log?.redactor.scrub(value) ?? value;
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
        } catch (error) { setupFailure ??= error; }
        try { launcher.close(); } catch (error) { setupFailure ??= error; }
        if (outputDirectory) {
            try { await writeReports(results, { directory: outputDirectory, target: configuration.testPath, startedAt: started, stale, setupFailure, retainedApp, environmentStop, redactor: log?.redactor }); }
            catch (error) { setupFailure ??= error; }
        }
        const count = (status: TestResult["status"]) => results.filter((result) => result.status === status).length;
        try { log?.write({ event: "run-summary", startedAt: started, passed: count("passed"), failed: count("failed") + (setupFailure ? 1 : 0), skipped: count("skipped"), expectedFailure: count("expected-failure"), unexpectedPass: count("unexpected-pass"), flaky: count("flaky"), notRun: count("not-run"), ...(environmentStop ? { environmentStop } : {}), ...(setupFailure ? { setupFailure: errMessage(setupFailure) } : {}) }); }
        finally { log?.close(); }
        console.log(`Test run ${started}: ${count("passed")} passed, ${count("failed") + (setupFailure ? 1 : 0)} failed, ${count("skipped")} skipped, ${count("not-run")} not run, ${count("expected-failure")} expected failure, ${count("unexpected-pass")} unexpected passes, ${count("flaky")} flaky.${environmentStop ? ` Environment stop: ${scrub(environmentStop)}` : ""}`);
        for (const result of results.filter((item) => item.status !== "passed")) {
            console.log(`${result.status.toUpperCase()} ${displayPath(configuration.cwd, result.file)} — ${result.name}${result.step ? ` — ${scrub(result.step)}` : ""}${result.reason ? ` — ${scrub(result.reason)}` : ""}${result.error ? `\n${scrub(result.error)}` : ""}`);
            for (const cleanupError of result.cleanupErrors ?? []) console.error(`CLEANUP ${scrub(cleanupError)}`);
            for (const screenshot of result.screenshots ?? []) console.log(`Screenshot: ${outputDirectory ? path.join(outputDirectory, screenshot) : screenshot}`);
            for (const captureError of result.captureErrors ?? []) console.error(`CAPTURE ${scrub(captureError)}`);
        }
        for (const identity of stale) console.log(`STALE ${displayPath(configuration.cwd, identity.file)} — ${identity.name} (saved as failed, no longer exists; skipped)`);
        if (outputDirectory) console.log(`Results: ${outputDirectory}`); else if (configuration.logFile) console.log(`Log: ${configuration.logFile}`);
        if (setupFailure) console.error(`Test runner setup failed: ${scrub(errMessage(setupFailure))}`);
        if (retainedApp) console.log(`Owned app retained after failure (PID ${retainedApp.pid}, MCP ${retainedApp.url}).`);
        const summary = results.filter((result) => result.status !== "passed");
        if (summary.length) {
            console.log("Summary:");
            const labels: Record<TestResult["status"], string> = { passed: "PASSED", failed: "FAILED", skipped: "SKIPPED", "expected-failure": "EXPECTED FAILURE", "unexpected-pass": "UNEXPECTED PASS", flaky: "FLAKY", "not-run": "NOT RUN" };
            for (const result of summary) {
                const location = result.location ?? displayPath(configuration.cwd, result.file);
                const attemptError = result.attempts?.find((attempt) => attempt.error)?.error;
                const detail = result.status === "skipped" ? result.skipReason : result.status === "expected-failure" ? result.reason : firstErrorLine(result.error ?? attemptError, result.step) ?? result.reason;
                console.log(`${labels[result.status]} — ${result.name} — ${location}${detail ? ` — ${scrub(detail)}` : ""}`);
            }
        }
    }
    return environmentStop ? 3 : results.some((result) => result.status === "failed" || result.status === "unexpected-pass") || setupFailure ? 1 : 0;
}

function firstErrorLine(error: string | undefined, step: string | undefined): string | undefined {
    return error?.split(/\r?\n/).map((line) => line.trim()).find((line) => line && line !== step);
}
