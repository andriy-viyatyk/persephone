// eslint-disable-next-line @typescript-eslint/no-var-requires
const { ipcRenderer } = require("electron");
import { scriptRunner } from "../scripting/ScriptRunner";
import { pagesModel } from "./pages";
import { isTextFileModel } from "../editors/text/TextPageModel";
import { MCP_EXECUTE, MCP_RESULT } from "../../shared/constants";
import { app } from "./app";

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
    const page = pageId ? pagesModel.findPage(pageId) : pagesModel.activePage;

    const result = await scriptRunner.runWithCapture(script, page);

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
