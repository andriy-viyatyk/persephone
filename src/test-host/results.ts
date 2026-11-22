import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { HostConfiguration } from "./launcher.js";
import { errMessage } from "../shared/utils.js";
import { normalizeTestFile, testIdentityKey } from "./test-identity.js";
import { EnvironmentStopError } from "./attention-policy.js";

export interface TestResult {
    file: string;
    name: string;
    status: "passed" | "failed" | "skipped" | "expected-failure" | "unexpected-pass" | "flaky" | "not-run";
    durationMs: number;
    step?: string;
    error?: string;
    skipReason?: string;
    requirements?: string[];
    cleanupErrors?: string[];
    screenshots?: string[];
    failureBundle?: string;
    captureErrors?: string[];
    reason?: string;
    attempts?: Array<{ attempt: number; status: "passed" | "failed"; error?: string; location?: string; step?: string }>;
    location?: string;
}

export interface FailedIdentity { file: string; name: string; }
export interface RerunSelection { identities: FailedIdentity[]; }

export async function resolveLogDirectory(configuration: HostConfiguration): Promise<string> {
    if (configuration.logDirectory) return configuration.logDirectory;
    const target = await fs.stat(configuration.testPath);
    const parent = target.isDirectory() ? configuration.testPath : path.dirname(configuration.testPath);
    return path.join(parent, "test-results");
}

export async function readFailedSelection(directory: string): Promise<RerunSelection> {
    const filePath = path.join(directory, "last-failed.json");
    try {
        const value: unknown = JSON.parse(await fs.readFile(filePath, "utf8"));
        if (!value || typeof value !== "object" || !("version" in value) || value.version !== 1 || !("failed" in value) || !Array.isArray(value.failed)) throw new Error("expected version 1 and a failed array");
        const identities = value.failed.flatMap((item): FailedIdentity[] => item && typeof item === "object"
            && "file" in item && typeof item.file === "string"
            && "name" in item && typeof item.name === "string"
            ? [{ file: item.file, name: item.name }] : []);
        if (identities.length !== value.failed.length) throw new Error("failed entries must contain string file and name fields");
        return { identities };
    } catch (error) {
        if (error instanceof EnvironmentStopError) throw error;
        throw new Error(`Cannot read rerun selection ${filePath}: ${errMessage(error)}`, { cause: error });
    }
}

export async function prepareLogDirectory(directory: string, replaceDefault: boolean): Promise<void> {
    if (replaceDefault) await fs.rm(directory, { recursive: true, force: true });
    await fs.mkdir(directory, { recursive: true });
}

export function selectForRerun(
    discovered: Array<{ file: string; tests: Array<{ name: string }> }>,
    selection: RerunSelection | undefined,
): { selected: Set<string> | undefined; stale: FailedIdentity[] } {
    if (!selection) return { selected: undefined, stale: [] };
    const available = new Set(discovered.flatMap(({ file, tests }) => tests.map(({ name }) => identityKey(file, name))));
    const selected = new Set(selection.identities.map(({ file, name }) => identityKey(file, name)));
    const stale = selection.identities.filter(({ file, name }) => !available.has(identityKey(file, name)));
    return { selected, stale };
}

export function matchesSelection(file: string, name: string, selected: Set<string> | undefined): boolean {
    return selected === undefined || selected.has(identityKey(file, name));
}

export async function writeReports(
    results: TestResult[],
    options: { directory: string; target: string; startedAt: string; stale: FailedIdentity[]; setupFailure?: unknown; retainedApp?: { pid: number; url: string }; environmentStop?: string },
): Promise<void> {
    await fs.mkdir(options.directory, { recursive: true });
    const failed = results.filter((result) => result.status === "failed");
    const failedForRerun = results.filter((result) => result.status === "failed" || result.status === "unexpected-pass" || (options.environmentStop && result.status === "not-run"));
    const passed = results.filter((result) => result.status === "passed");
    const skipped = results.filter((result) => result.status === "skipped");
    const expectedFailure = results.filter((result) => result.status === "expected-failure");
    const unexpectedPass = results.filter((result) => result.status === "unexpected-pass");
    const flaky = results.filter((result) => result.status === "flaky");
    const notRun = results.filter((result) => result.status === "not-run");
    const payload = {
        runAt: options.startedAt,
        target: options.target,
        summary: { passed: passed.length, failed: failed.length + (options.setupFailure ? 1 : 0), skipped: skipped.length, expectedFailure: expectedFailure.length, unexpectedPass: unexpectedPass.length, flaky: flaky.length, notRun: notRun.length },
        ...(options.environmentStop ? { environmentStop: options.environmentStop } : {}),
        stale: options.stale,
        ...(options.setupFailure ? { setupFailure: errMessage(options.setupFailure) } : {}),
        ...(options.retainedApp ? { retainedApp: options.retainedApp } : {}),
        results,
    };
    const lines = ["# Persephone test report", "", `Run: ${markdown(options.startedAt)}`, `Target: ${markdown(options.target)}`, "", `Passed: ${passed.length}  Failed: ${failed.length + (options.setupFailure ? 1 : 0)}  Skipped: ${skipped.length}  Not run: ${notRun.length}  Expected failure: ${expectedFailure.length}  Unexpected pass: ${unexpectedPass.length}  Flaky: ${flaky.length}`, ...(options.environmentStop ? ["", `Environment stop: ${markdown(options.environmentStop)}`, "A not-run test may already have changed state."] : []), ""];
    for (const result of results) {
        lines.push(`## ${markdown(result.status.toUpperCase())}: ${markdown(result.name)}`, "", `File: \`${markdown(result.file)}\``, `Duration: ${result.durationMs} ms`);
        if (result.step) lines.push(`Step: ${markdown(result.step)}`);
        if (result.location) lines.push(`Location: \`${markdown(result.location)}\``);
        if (result.skipReason) lines.push(`Reason: ${markdown(result.skipReason)}`);
        if (result.reason) lines.push(`Expected failure reason: ${markdown(result.reason)}`);
        if (result.error) lines.push("", "Error:", "", fenced(result.error));
        if (result.attempts?.length) lines.push("", "Attempts:", ...result.attempts.map((attempt) => `- ${attempt.attempt}: ${attempt.status}${attempt.error ? ` — ${markdown(attempt.error)}` : ""}${attempt.location ? ` (${markdown(attempt.location)})` : ""}`));
        if (result.cleanupErrors?.length) lines.push("", "Cleanup errors:", ...result.cleanupErrors.map((error) => `- ${markdown(error)}`));
        if (result.failureBundle) lines.push("", `Failure bundle: [${markdown(result.failureBundle)}](${encodeURI(result.failureBundle)})`);
        if (result.captureErrors?.length) lines.push("", "Capture errors:", ...result.captureErrors.map((error) => `- ${markdown(error)}`));
        if (result.screenshots?.length) lines.push("", "Screenshots:", ...result.screenshots.map((screenshot) => `- [${markdown(screenshot)}](${encodeURI(screenshot)})`));
        lines.push("");
    }
    if (options.stale.length) {
        lines.push("## Stale rerun identities", "", ...options.stale.map((item) => `- ${markdown(item.file)} — ${markdown(item.name)}`), "");
    }
    if (options.setupFailure) lines.push("## Runner setup error", "", fenced(errMessage(options.setupFailure)), "");
    if (options.retainedApp) lines.push(`Owned app retained after failure: PID ${options.retainedApp.pid}, MCP ${markdown(options.retainedApp.url)}`, "");
    await atomicWrite(path.join(options.directory, "report.json"), `${JSON.stringify(payload, null, 2)}\n`);
    await atomicWrite(path.join(options.directory, "report.md"), `${lines.join("\n")}\n`);
    await atomicWrite(path.join(options.directory, "last-failed.json"), `${JSON.stringify({ version: 1, failed: failedForRerun.map(({ file, name }) => ({ file: normalizeTestFile(file), name })) }, null, 2)}\n`);
}

function identityKey(file: string, name: string): string {
    return testIdentityKey({ file, name });
}

function markdown(value: unknown): string {
    return String(value ?? "").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll(/\s*\n\s*/g, " ");
}

function fenced(value: unknown): string {
    const text = String(value ?? "");
    const longest = Math.max(2, ...[...text.matchAll(/`+/g)].map((match) => match[0].length));
    const fence = "`".repeat(longest + 1);
    return `${fence}\n${text}\n${fence}`;
}

async function atomicWrite(filePath: string, content: string): Promise<void> {
    const temporary = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
    await fs.writeFile(temporary, content, "utf8");
    await fs.rename(temporary, filePath);
}
