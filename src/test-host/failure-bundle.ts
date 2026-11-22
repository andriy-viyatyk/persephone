import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { McpClient } from "./client.js";
import { listBrowserPages, snapshotOwnedPages, type BrowserPage } from "./browser-helpers.js";
import { errMessage } from "../shared/utils.js";
import type { TestLog } from "./test-log.js";
import type { TestWindowOwner } from "./test-window.js";
import { EnvironmentStopError } from "./attention-policy.js";
import type { DownloadAttachment } from "./captured-downloads.js";

type PageKind = "owned" | "session";
interface CapturePage { pageId: string; kind: PageKind; url: string | null; title: string | null; pageErrors: unknown[]; consoleErrors: unknown[]; failedRequests: unknown[]; screenshot: string | null; }
export interface FailureCapture { screenshots: string[]; captureErrors: string[]; failureBundle?: string; }

export async function captureFailure(
    client: McpClient,
    baseline: Parameters<typeof snapshotOwnedPages>[1],
    directory: string,
    identity: { file: string; name: string },
    attempt: number,
    started: number,
    contextPages: ReadonlySet<string>,
    sessionPages: ReadonlySet<string>,
    log: TestLog,
    testWindow: TestWindowOwner,
    attachments: DownloadAttachment[] = [],
): Promise<FailureCapture> {
    const screenshots: string[] = [];
    const captureErrors: string[] = [];
    const prefix = sanitize(`${path.basename(identity.file)}-${identity.name}`);
    const captured: CapturePage[] = [];
    const logEvent = (event: string, details: Record<string, unknown>) => log.write({ event, file: identity.file, test: identity.name, attempt, ...details });
    if (testWindow.mode === "owned") {
        await captureTarget("window", "window.screen.screenshot", `${prefix}-window`, client, directory, identity, screenshots, captureErrors, log, testWindow);
    }
    try {
        const pages = await selectCapturePages(client, baseline, contextPages, sessionPages, testWindow);
        for (const page of pages) {
            const screenshot = await captureTarget(`browser-${page.id}`, `pages[${JSON.stringify(page.id)}].editor.screenshot`, `${prefix}-browser-${sanitize(page.id)}`, client, directory, identity, screenshots, captureErrors, log, testWindow);
            const diagnostics = await captureDiagnostics(client, page, started, captureErrors, testWindow);
            captured.push({ pageId: page.id, kind: sessionPages.has(page.id) ? "session" : "owned", ...diagnostics, screenshot });
        }
    } catch (error) {
        if (error instanceof EnvironmentStopError) throw error;
        const message = `Could not inspect test browser pages for failure capture: ${errMessage(error)}`;
        captureErrors.push(message);
        logEvent("capture", { target: "browser-pages", ok: false, error: message });
    }

    let failureBundle: string | undefined;
    try {
        const relative = path.posix.join("failures", `${prefix}-a${attempt}-${randomUUID()}.json`);
        await fs.mkdir(path.join(directory, "failures"), { recursive: true });
        await fs.writeFile(path.join(directory, relative), `${JSON.stringify(log.redactor.redact({ pages: captured, downloads: attachments }), null, 2)}\n`, { encoding: "utf8", flag: "wx" });
        failureBundle = relative;
    } catch (error) {
        const message = `Failure bundle write failed: ${errMessage(error)}`;
        captureErrors.push(message);
        logEvent("capture", { target: "failure-bundle", ok: false, error: message });
    }
    return { screenshots, captureErrors, ...(failureBundle ? { failureBundle } : {}) };
}

async function selectCapturePages(client: McpClient, baseline: Parameters<typeof snapshotOwnedPages>[1], contextPages: ReadonlySet<string>, sessionPages: ReadonlySet<string>, testWindow: TestWindowOwner): Promise<BrowserPage[]> {
    const scopedPages = await listBrowserPages(client, testWindow);
    const eligible = new Set(contextPages);
    if (testWindow.mode === "owned" || testWindow.mode === "attached-created") {
        for (const page of await snapshotOwnedPages(client, baseline, () => undefined, testWindow)) eligible.add(page.id);
    }
    return scopedPages.filter((page) => eligible.has(page.id) || sessionPages.has(page.id));
}

async function captureDiagnostics(client: McpClient, page: BrowserPage, started: number, captureErrors: string[], testWindow: TestWindowOwner): Promise<Omit<CapturePage, "pageId" | "kind" | "screenshot">> {
    const base = `pages[${JSON.stringify(page.id)}].editor`;
    const timeout = client.timeouts.request;
    const read = async (property: string, args?: unknown): Promise<unknown> => {
        try { return await testWindow.call(client, `${base}.${property}`, args, timeout); }
        catch (error) {
            if (error instanceof EnvironmentStopError) throw error;
            captureErrors.push(`${page.id} ${property} capture failed: ${errMessage(error)}`);
            return undefined;
        }
    };
    const urlValue = await read("url");
    const titleValue = await read("title");
    const errorValue = await read("pageErrors", []);
    const consoleValue = await read("consoleMessages", [{ since: started, level: "error" }]);
    const requestValue = await read("networkRequests", []);
    const pageErrors = records(errorValue).filter((entry) => timestampAtOrAfter(entry, started)).slice(-100).map((entry) => projectDiagnostic(entry, ["text", "url", "lineNumber", "columnNumber", "timestamp"], ["text", "url"]));
    const consoleErrors = records(consoleValue).filter((entry) => entry.type === "error" && timestampAtOrAfter(entry, started)).slice(-100).map((entry) => projectDiagnostic(entry, ["type", "args", "url", "lineNumber", "columnNumber", "timestamp"], ["url"]));
    const failedRequests = records(requestValue).filter((entry) => timestampAtOrAfter(entry, started) && (Boolean(entry.error) || (typeof entry.statusCode === "number" && entry.statusCode >= 400 && entry.statusCode <= 599))).slice(-100).map((entry) => ({
        method: typeof entry.method === "string" ? entry.method : null,
        url: redactUrl(entry.url),
        status: typeof entry.statusCode === "number" ? entry.statusCode : null,
        durationMs: null as null,
    }));
    return { url: redactUrl(urlValue), title: typeof titleValue === "string" ? titleValue : null, pageErrors, consoleErrors, failedRequests };
}

async function captureTarget(target: string, apiPath: string, prefix: string, client: McpClient, directory: string, identity: { file: string; name: string }, screenshots: string[], captureErrors: string[], log: TestLog, testWindow: TestWindowOwner): Promise<string | null> {
    try {
        const image = await testWindow.image(client, apiPath, [], client.timeouts.screenshot ?? 5000);
        if (!image) throw new Error("MCP returned no image content block.");
        const extension = image.mimeType === "image/png" ? ".png" : image.mimeType === "image/jpeg" ? ".jpg" : undefined;
        if (!extension) throw new Error(`Unsupported screenshot MIME type: ${image.mimeType}`);
        await fs.mkdir(path.join(directory, "screenshots"), { recursive: true });
        const relative = path.posix.join("screenshots", `${prefix}-${randomUUID()}${extension}`);
        await fs.writeFile(path.join(directory, relative), Buffer.from(image.data, "base64"), { flag: "wx" });
        screenshots.push(relative);
        log.write({ event: "screenshot", ...identity, target, ok: true, path: relative });
        return relative;
    } catch (error) {
        if (error instanceof EnvironmentStopError) throw error;
        const message = `${target} screenshot failed: ${errMessage(error)}`;
        captureErrors.push(message);
        log.write({ event: "screenshot", ...identity, target, ok: false, error: message });
        return null;
    }
}

function records(value: unknown): Array<Record<string, unknown>> {
    return Array.isArray(value) ? value.filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === "object") : [];
}
function timestampAtOrAfter(entry: Record<string, unknown>, started: number): boolean { return typeof entry.timestamp === "number" && entry.timestamp >= started; }
function projectDiagnostic(entry: Record<string, unknown>, keys: string[], urlKeys: string[]): Record<string, unknown> {
    const projected: Record<string, unknown> = {};
    for (const key of keys) {
        const value = entry[key];
        if (key === "url") projected[key] = redactUrl(value);
        else if (urlKeys.includes(key) && typeof value === "string") projected[key] = redactText(value);
        else if (key === "args" && Array.isArray(value)) projected[key] = value.map((item) => typeof item === "string" ? redactText(item) : String(item));
        else if (value === null || typeof value === "string" || typeof value === "number") projected[key] = value;
        else projected[key] = null;
    }
    return projected;
}
function redactText(value: string): string { return value.replaceAll(/https?:\/\/[^\s"'<>]+/gi, (url) => redactUrl(url)); }
function redactUrl(value: unknown): string | null {
    if (typeof value !== "string") return null;
    try {
        const url = new URL(value);
        if (url.protocol !== "http:" && url.protocol !== "https:") return "[redacted URL]";
        url.username = ""; url.password = ""; url.hash = "";
        const query = [...url.searchParams.entries()];
        url.search = "";
        for (const [key] of query) url.searchParams.append(key, "\u2026");
        return url.toString();
    } catch { return "[redacted URL]"; }
}
function sanitize(value: string): string { return value.replaceAll(/[\\/]/g, "_").replaceAll(/[^a-zA-Z0-9_.-]/g, "_").slice(0, 120) || "test"; }
