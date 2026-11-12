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
    const responseResult = "result" in outcome ? outcome.result : undefined;
    const result = responseResult && typeof responseResult === "object"
        ? Object.fromEntries(Object.entries(responseResult).filter(([key]) => key !== "_tipObservations"))
        : responseResult;
    requestHistory.push({
        type: "output.mcp-request",
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        direction: "incoming",
        method,
        params,
        result: result ?? null,
        error: "error" in outcome ? outcome.error : null,
        durationMs,
    });
    if (requestHistory.length > MAX_REQUEST_LOG_ENTRIES) {
        requestHistory.splice(0, requestHistory.length - MAX_REQUEST_LOG_ENTRIES);
    }

    const logPage = pages.query.findPage("mcp-server-log");
    const logEditor = logPage?.mainEditorInstance;
    if (logEditor instanceof LogViewEditor) {
        logEditor.addEntry("output.mcp-request", requestHistory[requestHistory.length - 1]);
    }
}

/** Show the MCP server request log page (creates if needed, backfills history). */
export async function showMcpRequestLog(): Promise<void> {
    const page = await pages.standalonePages.requireTextPage("mcp-server-log");
    const editor = page.mainEditorInstance;
    if (!(editor instanceof LogViewEditor)) return;

    if (editor.entryCount === 0 && requestHistory.length > 0) {
        for (const entry of requestHistory) {
            editor.addEntry("output.mcp-request", entry);
        }
    }
}
