import { EditorId } from "../../../shared/editor-ids";
import type { RendererRpcMethods } from "../../../ipc/renderer-rpc";
import { BoardGrant } from "../../../shared/board/board-grant";
import { BOARD_THEME_METHODS } from "../../../shared/board/board-call-route";
import { isPositiveIntegerTimeout } from "../../../shared/ai-vision-timeout";
import { errMessage } from "../../../shared/utils";
import { UNBOUNDED_CALL_MAX_LENGTH } from "../../../shared/ai-vision-call-limits";
import { resolveAiCall } from "../../scripting/ai-vision/call";
import { eventLog } from "../../scripting/ai-vision/event-log";
import { ScriptContext } from "../../scripting/ScriptContext";
import { getPreviewGeneration } from "../../theme/themes";
import { app } from "../app";
import { asBoardHostEditor } from "./board-host-editor";
import { boardRegistry } from "./board-registry";
import { pages } from "../pages";
import { tsProjectRegistry } from "../ts-project-registry";
import { createLinkData } from "../../../shared/link-data";
import { t } from "../../../shared/i18n/t";
import { ui } from "../ui";
import type { RendererRpcServer } from "../renderer-rpc";
import { openBoardTreePage, refreshBoardTreePages } from "./board-tree-page";
import { isBoardRefreshTreeRequest } from "../../../shared/board/board-tree-request";
import { isAcceptedBoardSchemeForRoot, schemeOf } from "../../content/scheme-registry";
import { fpIsAbsolute } from "../../core/utils/file-path";

function cloneJson(value: unknown): unknown {
    const seen = new Set<object>();
    const validate = (item: unknown): void => {
        if (item === null || typeof item === "string" || typeof item === "boolean") return;
        if (typeof item === "number" && Number.isFinite(item)) return;
        if (typeof item !== "object") throw new Error("Theme bridge accepts JSON values only.");
        if (seen.has(item)) throw new Error("Theme bridge accepts JSON values only.");
        seen.add(item);
        if (Array.isArray(item)) {
            for (let index = 0; index < item.length; index++) {
                if (!Object.prototype.hasOwnProperty.call(item, index)) throw new Error("Theme bridge accepts JSON arrays only.");
                validate(item[index]);
            }
            if (Reflect.ownKeys(item).some((key) => key !== "length" && (typeof key !== "string" || !/^\d+$/.test(key)))) {
                throw new Error("Theme bridge accepts JSON arrays only.");
            }
        } else {
            const prototype = Object.getPrototypeOf(item);
            if (prototype !== Object.prototype && prototype !== null) throw new Error("Theme bridge accepts plain JSON objects only.");
            for (const key of Reflect.ownKeys(item)) {
                if (typeof key !== "string") throw new Error("Theme bridge accepts plain JSON objects only.");
                const descriptor = Object.getOwnPropertyDescriptor(item, key);
                if (!descriptor?.enumerable || !("value" in descriptor)) throw new Error("Theme bridge accepts plain JSON objects only.");
                validate(descriptor.value);
            }
        }
        seen.delete(item);
    };
    validate(value);
    const encoded = JSON.stringify(value);
    if (encoded === undefined) throw new Error("Theme bridge accepts JSON values only.");
    return JSON.parse(encoded) as unknown;
}

function resolveBoardHost(ownerId: string) {
    const page = pages.query.findPage(ownerId);
    if (!page) throw new Error("The Board's hosting page is no longer open.");
    const boardEditor = page.editors.find((editor) => editor.id === ownerId);
    const boardRoot = (boardEditor?.state.get() as { boardRoot?: unknown } | undefined)?.boardRoot;
    const contextEditor = page.mainEditor;
    if (!boardEditor || typeof boardRoot !== "string" || !boardRoot || !contextEditor || contextEditor.page !== page) {
        throw new Error("The Board is no longer attached to its hosting page.");
    }
    return { page, boardEditor, boardRoot, contextEditor };
}

function isAllowedBoardLinkTarget(target: string, boardRoot: string): boolean {
    if (fpIsAbsolute(target) || /^data:image\/png;base64,/i.test(target)) return true;
    const scheme = schemeOf(target);
    if (!scheme) return false;
    if (["file", "http", "https", "mailto"].includes(scheme)) return true;
    return isAcceptedBoardSchemeForRoot(target, boardRoot);
}

function invokeThemeMethod(method: string, callArgs: unknown[]): unknown {
    switch (method) {
        case "list": return Reflect.apply(app.themes.list, app.themes, callArgs);
        case "get": return Reflect.apply(app.themes.get, app.themes, callArgs);
        case "derive": return Reflect.apply(app.themes.derive, app.themes, callArgs);
        case "contrast": return Reflect.apply(app.themes.contrast, app.themes, callArgs);
        case "fork": return Reflect.apply(app.themes.fork, app.themes, callArgs);
        case "file": return Reflect.apply(app.themes.file, app.themes, callArgs);
        case "save": return Reflect.apply(app.themes.save, app.themes, callArgs);
        case "rename": return Reflect.apply(app.themes.rename, app.themes, callArgs);
        case "delete": return Reflect.apply(app.themes.delete, app.themes, callArgs);
        case "apply": return Reflect.apply(app.themes.apply, app.themes, callArgs);
        case "preview": return Reflect.apply(app.themes.preview, app.themes, callArgs);
        case "endPreview": return Reflect.apply(app.themes.endPreview, app.themes, callArgs);
        default: throw new Error(`Unknown board themes method: ${method}`);
    }
}

type BoardCallParams = RendererRpcMethods["boardCall"]["params"];

/**
 * `events.wait()` cursor per board frame. A board call returns the plain value, without the events
 * envelope that advances an MCP session's cursor, so without this every wait started at 0 and
 * replayed the oldest retained event: a board never saw a new one. A frame starts at the log's
 * position on its first call (history comes from `events.recent()`) and moves to each event a wait
 * hands it.
 */
const boardEventCursors = new WeakMap<object, number>();
const EVENTS_WAIT_PATH = /^events\.wait(?:\(\))?$/;

function boardEventCursor(boardEditor: object): number {
    let cursor = boardEventCursors.get(boardEditor);
    if (cursor === undefined || cursor > eventLog.lastSeq) {
        cursor = eventLog.lastSeq;
        boardEventCursors.set(boardEditor, cursor);
    }
    return cursor;
}

function advanceBoardEventCursor(boardEditor: object, path: string, result: unknown): void {
    if (!EVENTS_WAIT_PATH.test(path)) return;
    const seq = (result as { event?: { seq?: unknown } } | undefined)?.event?.seq;
    if (typeof seq === "number" && Number.isFinite(seq)) boardEventCursors.set(boardEditor, seq);
}

async function handleBoardCall(params: BoardCallParams): Promise<unknown> {
    const ownerId = typeof params?.ownerId === "string" ? params.ownerId : "";
    const rawRequest: unknown = params?.request;
    if (!ownerId || !rawRequest || typeof rawRequest !== "object") {
        throw new Error("Board call needs an ownerId and request.");
    }
    const requestData = rawRequest as Record<string, unknown>;
    if (typeof requestData.path !== "string" || !requestData.path) throw new Error("Board call needs a non-empty path.");
    if (requestData.args !== undefined && !Array.isArray(requestData.args)) throw new Error("Board call args must be an array.");
    if (requestData.timeoutMs !== undefined && !isPositiveIntegerTimeout(requestData.timeoutMs)) {
        throw new Error("Board call timeoutMs must be a positive integer.");
    }

    const request = {
        path: requestData.path,
        hints: "never" as const,
        ...(requestData.args !== undefined ? { args: requestData.args as unknown[] } : {}),
        ...(Object.prototype.hasOwnProperty.call(requestData, "value") ? { value: requestData.value } : {}),
        maxLength: typeof requestData.maxLength === "number" ? requestData.maxLength : UNBOUNDED_CALL_MAX_LENGTH,
        ...(requestData.timeoutMs !== undefined ? { timeoutMs: requestData.timeoutMs } : {}),
    };
    const { boardRoot, boardEditor, contextEditor } = resolveBoardHost(ownerId);
    const context = new ScriptContext({ page: contextEditor, origin: "board" });
    try {
        if (!boardRegistry.grant(boardRoot)?.allows("appScripting")) throw new Error(BoardGrant.deny("appScripting").message);
        const result = await resolveAiCall(context, request, undefined, {
            page: context.page,
            restricted: () => boardRegistry.isPermitted(boardRoot) ? undefined : "This Board is not permitted to use persephone.call().",
            callContext: { eventCursor: boardEventCursor(boardEditor), maxLength: request.maxLength },
        });
        if (result.error) throw new Error(result.error);
        advanceBoardEventCursor(boardEditor, request.path, result.result);
        return result.result;
    } catch (error: unknown) {
        throw new Error(errMessage(error, "Board call failed."), { cause: error });
    } finally {
        context.dispose();
    }
}

async function handleBoardThemes(params: RendererRpcMethods["boardThemes"]["params"]): Promise<unknown> {
    try {
        const { boardRoot, boardEditor } = resolveBoardHost(params.ownerId);
        const method = params.method;
        if (!BOARD_THEME_METHODS.has(method)) throw new Error(`Unknown board themes method: ${method}`);
        if (!boardRegistry.grant(boardRoot)?.allows("themes")) throw new Error(BoardGrant.deny("themes").message);
        const clonedArgs = cloneJson(params.args);
        if (!Array.isArray(clonedArgs)) throw new Error("Theme bridge accepts JSON arrays only.");
        const args: unknown[] = clonedArgs;
        const value = Object.prototype.hasOwnProperty.call(params, "value") ? cloneJson(params.value) : undefined;
        const callArgs = value !== undefined ? [value] : args;
        const result = method === "current" ? app.themes.current : await invokeThemeMethod(method, callArgs);
        if (method === "preview" && params.boardId) {
            asBoardHostEditor(boardEditor)?.recordBoardThemePreview(params.boardId, getPreviewGeneration());
        }
        return cloneJson(result === undefined ? null : result);
    } catch (error: unknown) {
        throw new Error(errMessage(error, "Board call failed."), { cause: error });
    }
}

function requireString(params: unknown, key: "root" | "owner"): string {
    const value = typeof params === "object" && params !== null ? (params as Record<string, unknown>)[key] : undefined;
    if (typeof value !== "string" || !value) throw new Error(`Invalid TypeScript project request: ${key} is required.`);
    return value;
}

export function registerBoardHostRpc(server: RendererRpcServer): void {
    server.register("boardCall", handleBoardCall);
    server.register("boardThemes", handleBoardThemes);
    server.register("openRawLink", async (params): Promise<null> => {
        if (!params || typeof params.target !== "string" || !params.target.trim()
            || typeof params.boardRoot !== "string" || !params.boardRoot) throw new Error("Invalid board openRawLink request.");
        const { target, boardRoot } = params;
        const editor = typeof params.editor === "string" ? params.editor : undefined;
        const revealLine = typeof params.revealLine === "number" ? params.revealLine : undefined;
        const highlightText = typeof params.highlightText === "string" ? params.highlightText : undefined;
        const reuseKey = typeof params.reuseKey === "string" ? params.reuseKey : undefined;
        if (params.inPlace !== undefined && typeof params.inPlace !== "boolean") {
            throw new Error("Invalid board openRawLink inPlace option.");
        }
        const inPlace = params.inPlace === true;
        try {
            if (!isAllowedBoardLinkTarget(target, boardRoot)) {
                throw new Error("The Board does not own this link scheme.");
            }
            const page = inPlace
                ? resolveBoardHost(typeof params.ownerId === "string" ? params.ownerId : "").page
                : undefined;
            if (!inPlace && editor === EditorId.imageView && target.startsWith("data:image/")) {
                const blob = await (await fetch(target)).blob();
                await pages.openImageInNewTab(URL.createObjectURL(blob), "Image");
                return null;
            }
            if (!inPlace && editor === EditorId.browserView && reuseKey !== undefined) {
                await pages.boardPageRouter.openBoardRunPage(boardRoot, reuseKey, target);
                return null;
            }
            await app.events.openRawLink.sendAsync(createLinkData(target, {
                sourceId: "board", boardRoot, target: editor, revealLine, highlightText, waitForPageReady: true,
                ...(page ? { pageId: page.id } : {}),
            }));
            return null;
        } catch (error: unknown) {
            const action = editor === EditorId.imageView ? t("api.failedToOpenImage") : t("api.failedToOpenLink");
            void ui.notify(t("api.actionFailed", { action, error: errMessage(error) }), "error");
            throw error;
        }
    });
    server.register("openTree", async (params): Promise<null> => {
        if (!params || typeof params.boardRoot !== "string" || !params.boardRoot) {
            throw new Error("Invalid board openTree request.");
        }
        await openBoardTreePage(pages, params, params.boardRoot);
        return null;
    });
    server.register("refreshTree", async (params): Promise<number> => {
        if (!isBoardRefreshTreeRequest(params) || typeof params.boardRoot !== "string" || !params.boardRoot) {
            throw new Error("Invalid board refreshTree request.");
        }
        return refreshBoardTreePages(pages, params, params.boardRoot);
    });
    server.register("openBoard", async (params): Promise<null> => {
        if (!params || typeof params.folder !== "string" || !params.folder.trim()) throw new Error("Invalid board openBoard request.");
        await app.boards.openBoard(params.folder);
        return null;
    });
    server.register("registerTsProject", async (params): Promise<null> => {
        await tsProjectRegistry.register(requireString(params, "root"), requireString(params, "owner"));
        return null;
    });
    server.register("unregisterTsProject", (params): null => {
        tsProjectRegistry.unregister(requireString(params, "root"), requireString(params, "owner"));
        return null;
    });
    server.register("releaseTsProjects", (params): null => {
        tsProjectRegistry.releaseOwner(requireString(params, "owner"));
        return null;
    });
}

