import { pages } from "../pages";
import { LogViewEditor } from "../../editors/log-view";
import type { McpRequestEntry } from "../../editors/log-view/logTypes";

type McpCallOutcome = { result: unknown } | { error: string };

const MAX_REQUEST_LOG_ENTRIES = 200;
const requestHistory: McpRequestEntry[] = [];

export function logIncomingRequest(
    method: string,
    params: unknown,
    outcome: McpCallOutcome,
    durationMs: number,
): void {
    const sensitive = classify(params);
    const responseResult = "result" in outcome ? outcome.result : undefined;
    const projectedResult = responseResult && typeof responseResult === "object"
        ? Object.fromEntries(Object.entries(responseResult).filter(([key]) => key !== "_tipObservations"))
        : responseResult;
    const result = sensitive === "storage-set" ? projectedResult
        : sensitive ? summary(projectedResult)
            : projectedResult;
    const safeParams = sanitizeParams(params, sensitive);
    const safeError = "error" in outcome && sensitive ? "[sensitive operation failed]" : "error" in outcome ? outcome.error : null;
    requestHistory.push({
        type: "output.mcp-request",
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        direction: "incoming",
        method,
        params: safeParams,
        result: result ?? null,
        error: safeError,
        durationMs,
    });
    if (requestHistory.length > MAX_REQUEST_LOG_ENTRIES) {
        requestHistory.splice(0, requestHistory.length - MAX_REQUEST_LOG_ENTRIES);
    }

    const logPage = pages.query.findPage("mcp-server-log");
    const logEditor = logPage?.mainEditor;
    if (logEditor instanceof LogViewEditor) {
        logEditor.addEntry("output.mcp-request", requestHistory[requestHistory.length - 1]);
    }
}

function classify(params: unknown): "storage-state" | "storage-set" | "clipboard-read" | "clipboard-write" | "clipboard-reset" | "sensitive" | undefined {
    if (!params || typeof params !== "object" || !("path" in params) || typeof params.path !== "string") return undefined;
    // Match the trailing member after `editor` whatever prefix addresses the page:
    // `pages["id"].editor.x`, `windows[1].pages[2].editor.x`, `page.editor.x`.
    const path = params.path.trim();
    if (/(?:^|[.\]])editor\.storage\.set$/.test(path)) return "storage-set";
    if (/(?:^|[.\]])editor\.clipboard\.readText$/.test(path)) return "clipboard-read";
    if (/(?:^|[.\]])editor\.clipboard\.writeText$/.test(path)) return "clipboard-write";
    if (/(?:^|[.\]])editor\.clearClipboardForTestRun$/.test(path)) return "clipboard-reset";
    if (/(?:^|[.\]])editor\.(?:storageState|applyStorageStateForTestRun|addInitScript)$/.test(path)) return "storage-state";
    return undefined;
}

function sanitizeParams(params: unknown, kind: ReturnType<typeof classify>): unknown {
    if (!params || typeof params !== "object" || !kind) return params;
    const source = params as Record<string, unknown>;
    const result = { ...source };
    if (kind === "storage-set") {
        if ("args" in result) result.args = "[sensitive storage arguments omitted]";
        if ("value" in result) result.value = "[sensitive storage value omitted]";
    } else if (kind === "clipboard-write") {
        if ("args" in result) result.args = "[sensitive clipboard arguments omitted]";
        if ("value" in result) result.value = "[sensitive clipboard value omitted]";
    } else {
        if ("args" in result) result.args = summary(result.args);
        if ("value" in result) result.value = summary(result.value);
    }
    return result;
}

function summary(value: unknown): string {
    let serialized = "";
    try { serialized = JSON.stringify(value) ?? ""; } catch { /* retain only the fallback summary */ }
    const counts = countItems(value);
    return `[sensitive data omitted: ${counts} items, ${serialized.length} characters]`;
}

function countItems(value: unknown): number {
    if (Array.isArray(value)) return value.reduce((total, item) => total + countItems(item), 0);
    if (value && typeof value === "object") return Object.values(value).reduce((total, item) => total + countItems(item), 0);
    return value === undefined ? 0 : 1;
}

/** Show the MCP server request log page (creates if needed, backfills history). */
export async function showMcpRequestLog(): Promise<void> {
    const page = await pages.standalonePages.requireTextPage("mcp-server-log");
    const editor = page.mainEditor;
    if (!(editor instanceof LogViewEditor)) return;

    if (editor.entryCount === 0 && requestHistory.length > 0) {
        for (const entry of requestHistory) {
            editor.addEntry("output.mcp-request", entry);
        }
    }
}
