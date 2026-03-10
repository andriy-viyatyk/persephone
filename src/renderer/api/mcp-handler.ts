// eslint-disable-next-line @typescript-eslint/no-var-requires
const { ipcRenderer } = require("electron");
import { scriptRunner } from "../scripting/ScriptRunner";
import { pagesModel } from "./pages";
import { isTextFileModel } from "../editors/text/TextPageModel";
import { editorRegistry } from "../editors/registry";
import { MCP_EXECUTE, MCP_RESULT } from "../../shared/constants";
import { app } from "./app";
import type { LogViewModel } from "../editors/log-view/LogViewModel";
import type { LogEntry } from "../editors/log-view/logTypes";
import { mcpLogState } from "./mcp-log-state";
import { csvToRecords } from "../core/utils/csv-utils";

// ── Types ───────────────────────────────────────────────────────────

interface McpResponse {
    result?: any;
    error?: { code: number; message: string; data?: any };
}

// ── Command Dispatcher ──────────────────────────────────────────────

async function handleCommand(method: string, params: any): Promise<McpResponse> {
    switch (method) {
        case "execute_script":
            return executeScript(params);
        case "get_pages":
            return { result: getPages() };
        case "get_page_content":
            return getPageContent(params);
        case "get_active_page":
            return { result: getActivePage() };
        case "create_page":
            return createPage(params);
        case "set_page_content":
            return setPageContent(params);
        case "get_app_info":
            return { result: getAppInfo() };
        case "ui_push":
            return handleUiPush(params);
        default:
            return { error: { code: -32601, message: `Method not found: ${method}` } };
    }
}

// ── Command Implementations ─────────────────────────────────────────

async function executeScript(params: any): Promise<McpResponse> {
    const script = params?.script;
    if (!script || typeof script !== "string") {
        return { error: { code: -32602, message: "Missing or invalid 'script' parameter" } };
    }

    const pageId = params?.pageId;
    const language = params?.language;
    const page = pageId ? pagesModel.findPage(pageId) : pagesModel.activePage;

    const result = await scriptRunner.runWithCapture(script, page, language);

    return {
        result: {
            text: result.text,
            language: result.language,
            isError: result.isError,
            consoleLogs: result.consoleLogs,
        },
    };
}

function getPages(): any[] {
    const pages = pagesModel.state.get().pages;
    return pages.map((p) => {
        const s = p.state.get();
        return {
            id: s.id,
            title: s.title,
            type: s.type,
            editor: s.editor,
            language: s.language,
            filePath: s.filePath,
            modified: s.modified,
            pinned: s.pinned,
            active: p === pagesModel.activePage,
        };
    });
}

function getPageContent(params: any): McpResponse {
    const pageId = params?.pageId;
    if (!pageId) {
        return { error: { code: -32602, message: "Missing 'pageId' parameter" } };
    }

    const page = pagesModel.findPage(pageId);
    if (!page) {
        return { error: { code: -32602, message: `Page not found: ${pageId}` } };
    }

    const content = isTextFileModel(page) ? page.state.get().content : "";

    return {
        result: {
            id: page.id,
            title: page.title,
            content,
        },
    };
}

function getActivePage(): any {
    const page = pagesModel.activePage;
    if (!page) return null;

    const s = page.state.get();
    const content = isTextFileModel(page) ? page.state.get().content : "";

    return {
        id: s.id,
        title: s.title,
        type: s.type,
        editor: s.editor,
        language: s.language,
        filePath: s.filePath,
        modified: s.modified,
        content,
    };
}

function createPage(params: any): McpResponse {
    const content = params?.content ?? "";
    const language = params?.language ?? "plaintext";
    const editor = params?.editor ?? "monaco";
    const title = params?.title ?? "Untitled";

    if (!editorRegistry.getById(editor)) {
        const all = editorRegistry.getAll().map((e) => e.id);
        return { error: { code: -32602, message: `Unknown editor '${editor}'. Valid editors: ${all.join(", ")}` } };
    }

    const page = pagesModel.addEditorPage(editor, language, title);
    if (content && isTextFileModel(page)) {
        page.changeContent(content);
        page.state.update((s) => { s.modified = false; });
    }

    const s = page.state.get();
    return {
        result: {
            id: s.id,
            title: s.title,
            editor: s.editor,
            language: s.language,
        },
    };
}

function setPageContent(params: any): McpResponse {
    const pageId = params?.pageId;
    if (!pageId) {
        return { error: { code: -32602, message: "Missing 'pageId' parameter" } };
    }

    const content = params?.content;
    if (content == null || typeof content !== "string") {
        return { error: { code: -32602, message: "Missing or invalid 'content' parameter" } };
    }

    const page = pagesModel.findPage(pageId);
    if (!page) {
        return { error: { code: -32602, message: `Page not found: ${pageId}` } };
    }

    if (!isTextFileModel(page)) {
        return {
            error: {
                code: -32602,
                message: "Page is not a text-based page. Use execute_script with page facades (asGrid, asNotebook, etc.) for structured editors.",
            },
        };
    }

    page.changeContent(content);
    return { result: { id: page.id, title: page.title, contentLength: content.length } };
}

// ── Active MCP Log Page ────────────────────────────────────────────

function formatLogTitle(): string {
    const now = new Date();
    const date = now.toISOString().slice(0, 10);
    const time = now.toTimeString().slice(0, 5);
    return `${date} ${time}.log.jsonl`;
}

async function getOrCreateMcpLogViewModel(): Promise<LogViewModel> {
    // Reuse existing active MCP log page if still valid
    if (mcpLogState.pageId) {
        const page = pagesModel.findPage(mcpLogState.pageId);
        if (page && isTextFileModel(page)) {
            const vm = page.acquireViewModelSync("log-view") as LogViewModel | undefined;
            if (vm) return vm;
        }
        mcpLogState.pageId = undefined;
    }

    // Ensure log-view editor module is loaded (async import)
    await editorRegistry.loadViewModelFactory("log-view");

    const page = pagesModel.addEditorPage("log-view", "jsonl", formatLogTitle());
    mcpLogState.pageId = page.id;

    if (!isTextFileModel(page)) {
        throw new Error("Log view page is not a text file model.");
    }
    const vm = page.acquireViewModelSync("log-view") as LogViewModel | undefined;
    if (!vm) {
        throw new Error("Log view module not loaded.");
    }
    return vm;
}

// ── ui_push Handler ────────────────────────────────────────────────

async function handleUiPush(params: any): Promise<McpResponse> {
    const entries = params?.entries;
    if (!Array.isArray(entries)) {
        return { error: { code: -32602, message: "Missing or invalid 'entries' parameter" } };
    }

    const vm = await getOrCreateMcpLogViewModel();
    const dialogPromises: Promise<LogEntry>[] = [];

    for (const raw of entries) {
        // Normalize: string shorthand → log.info
        const entry = typeof raw === "string"
            ? { type: "log.info", text: raw }
            : raw;

        if (!entry || typeof entry !== "object" || !entry.type) continue;

        const { type, ...fields } = entry;
        if (typeof type === "string" && type.startsWith("input.")) {
            // Dialog entry — addDialogEntry returns a Promise
            dialogPromises.push(vm.addDialogEntry(type, fields));
        } else if (type === "output.grid") {
            // MCP sends: { content: string, contentType?: "csv" | "json", title? }
            // Parse content to data[] before storing in the entry
            const contentType = fields.contentType ?? "json";
            let data: any[];
            if (contentType === "csv") {
                data = csvToRecords(fields.content, true, ",");
            } else {
                data = JSON.parse(fields.content);
            }
            const { content: _, contentType: _ct, ...rest } = fields;
            vm.addEntry(type, { ...rest, data });
        } else if (typeof type === "string" && type.startsWith("output.")) {
            // Output entry — pass full fields object
            vm.addEntry(type, fields);
        } else {
            // Log entry — pass text only
            vm.addEntry(type, fields.text ?? "");
        }
    }

    if (dialogPromises.length === 0) {
        return { result: {} };
    }

    // Wait for ALL dialogs to be resolved by the user
    const dialogResults = await Promise.all(dialogPromises);

    // Convert undefined → null for JSON serialization
    const results = dialogResults.map((r) => {
        const obj: Record<string, any> = { ...r };
        if (obj.button === undefined) {
            obj.button = null;
        }
        return obj;
    });

    return { result: { results } };
}

// ── App Info ───────────────────────────────────────────────────────

function getAppInfo(): any {
    const pages = pagesModel.state.get().pages;
    return {
        version: app.version,
        pageCount: pages.length,
        activePageId: pagesModel.activePage?.id ?? null,
    };
}

// ── Initialization ──────────────────────────────────────────────────

export function initMcpHandler(): void {
    ipcRenderer.on(MCP_EXECUTE, async (_event: any, requestId: string, method: string, params: any) => {
        let response: McpResponse;
        try {
            response = await handleCommand(method, params);
        } catch (err: any) {
            response = { error: { code: -32603, message: err.message || "Internal error" } };
        }
        ipcRenderer.send(MCP_RESULT, requestId, response);
    });
}
