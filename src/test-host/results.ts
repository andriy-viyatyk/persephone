import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { McpClient } from "./client.js";
import type { HostConfiguration } from "./launcher.js";
import { snapshotOwnedPages } from "./browser-helpers.js";
import { errMessage } from "../shared/utils.js";
import type { TestLog } from "./test-log.js";
import { normalizeTestFile, testIdentityKey } from "./test-identity.js";

export interface TestResult {
    file: string;
    name: string;
    status: "passed" | "failed" | "skipped";
    durationMs: number;
    step?: string;
    error?: string;
    skipReason?: string;
    requirements?: string[];
    cleanupErrors?: string[];
    screenshots?: string[];
    captureErrors?: string[];
}

export interface FailedIdentity { file: string; name: string; }
export interface RerunSelection { identities: FailedIdentity[]; }
export interface FailureCapture { screenshots: string[]; captureErrors: string[]; }

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

export async function captureFailure(
    client: McpClient,
    baseline: Parameters<typeof snapshotOwnedPages>[1],
    directory: string,
    identity: FailedIdentity,
    log: TestLog,
): Promise<FailureCapture> {
    const screenshots: string[] = [];
    const captureErrors: string[] = [];
    const prefix = sanitize(`${path.basename(identity.file)}-${identity.name}`);
    await captureTarget("window", "window.screen.screenshot", [], prefix, client, directory, identity, screenshots, captureErrors, log);
    try {
        const pages = await snapshotOwnedPages(client, baseline, (event, details) => log.write({ event, ...identity, ...details }));
        for (const page of pages) {
            await captureTarget(`browser-${page.id}`, `pages[${JSON.stringify(page.id)}].editor.screenshot`, [], `${prefix}-browser-${sanitize(page.id)}`, client, directory, identity, screenshots, captureErrors, log);
        }
    } catch (error) {
        const message = `Could not inspect test-opened browser pages for screenshots: ${errMessage(error)}`;
        captureErrors.push(message);
        log.write({ event: "screenshot", ...identity, target: "browser-pages", ok: false, error: message });
    }
    return { screenshots, captureErrors };
}

async function captureTarget(
    target: string,
    apiPath: string,
    args: unknown[],
    prefix: string,
    client: McpClient,
    directory: string,
    identity: FailedIdentity,
    screenshots: string[],
    captureErrors: string[],
    log: TestLog,
): Promise<void> {
    try {
        const image = await client.image(apiPath, args, client.timeouts.screenshot ?? 5000);
        if (!image) throw new Error("MCP returned no image content block.");
        const extension = image.mimeType === "image/png" ? ".png" : image.mimeType === "image/jpeg" ? ".jpg" : undefined;
        if (!extension) throw new Error(`Unsupported screenshot MIME type: ${image.mimeType}`);
        const screenshotDirectory = path.join(directory, "screenshots");
        await fs.mkdir(screenshotDirectory, { recursive: true });
        const relative = path.posix.join("screenshots", `${prefix}-${randomUUID()}${extension}`);
        const absolute = path.join(directory, relative);
        await fs.writeFile(absolute, Buffer.from(image.data, "base64"), { flag: "wx" });
        screenshots.push(relative);
        log.write({ event: "screenshot", ...identity, target, ok: true, path: relative });
    } catch (error) {
        const message = `${target} screenshot failed: ${errMessage(error)}`;
        captureErrors.push(message);
        log.write({ event: "screenshot", ...identity, target, ok: false, error: message });
    }
}

export async function writeReports(
    results: TestResult[],
    options: { directory: string; target: string; startedAt: string; stale: FailedIdentity[]; setupFailure?: unknown; retainedApp?: { pid: number; url: string } },
): Promise<void> {
    await fs.mkdir(options.directory, { recursive: true });
    const failed = results.filter((result) => result.status === "failed");
    const passed = results.filter((result) => result.status === "passed");
    const skipped = results.filter((result) => result.status === "skipped");
    const payload = {
        runAt: options.startedAt,
        target: options.target,
        summary: { passed: passed.length, failed: failed.length + (options.setupFailure ? 1 : 0), skipped: skipped.length },
        stale: options.stale,
        ...(options.setupFailure ? { setupFailure: errMessage(options.setupFailure) } : {}),
        ...(options.retainedApp ? { retainedApp: options.retainedApp } : {}),
        results,
    };
    const lines = ["# Persephone test report", "", `Run: ${markdown(options.startedAt)}`, `Target: ${markdown(options.target)}`, "", `Passed: ${passed.length}  Failed: ${failed.length + (options.setupFailure ? 1 : 0)}  Skipped: ${skipped.length}`, ""];
    for (const result of results) {
        lines.push(`## ${markdown(result.status.toUpperCase())}: ${markdown(result.name)}`, "", `File: \`${markdown(result.file)}\``, `Duration: ${result.durationMs} ms`);
        if (result.step) lines.push(`Step: ${markdown(result.step)}`);
        if (result.skipReason) lines.push(`Reason: ${markdown(result.skipReason)}`);
        if (result.error) lines.push("", "Error:", "", fenced(result.error));
        if (result.cleanupErrors?.length) lines.push("", "Cleanup errors:", ...result.cleanupErrors.map((error) => `- ${markdown(error)}`));
        if (result.captureErrors?.length) lines.push("", "Screenshot capture errors:", ...result.captureErrors.map((error) => `- ${markdown(error)}`));
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
    await atomicWrite(path.join(options.directory, "last-failed.json"), `${JSON.stringify({ version: 1, failed: failed.map(({ file, name }) => ({ file: normalizeTestFile(file), name })) }, null, 2)}\n`);
}

function identityKey(file: string, name: string): string {
    return testIdentityKey({ file, name });
}

function sanitize(value: string): string {
    return value.replaceAll(/[\\/]/g, "_").replaceAll(/[^a-zA-Z0-9_.-]/g, "_").slice(0, 120) || "test";
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
