import type { RendererRpcMethods } from "../../../ipc/renderer-rpc";
import { BoardGrant } from "../../../shared/board/board-grant";
import { BOARD_THEME_METHODS } from "../../../shared/board/board-call-route";
import { isPositiveIntegerTimeout } from "../../../shared/ai-vision-timeout";
import { errMessage } from "../../../shared/utils";
import { UNBOUNDED_CALL_MAX_LENGTH } from "../../scripting/ai-vision/call-limits";
import { resolveAiCall } from "../../scripting/ai-vision/call";
import { ScriptContext } from "../../scripting/ScriptContext";
import { getPreviewGeneration } from "../../theme/themes";
import { app } from "../app";
import { isBoardPermitted } from "./board-access";
import { asBoardHostEditor } from "./board-host-editor";
import { boardTrust } from "./board-trust";
import { pagesModel } from "../pages";
import { tsProjectRegistry } from "../ts-project-registry";
import { createLinkData } from "../../../shared/link-data";
import { t } from "../../../shared/i18n/t";
import { ui } from "../ui";
import type { RendererRpcServer } from "../renderer-rpc";

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
    const page = pagesModel.findPage(ownerId);
    if (!page) throw new Error("The Board's hosting page is no longer open.");
    const boardEditor = page.editors.find((editor) => editor.id === ownerId);
    const boardRoot = (boardEditor?.state.get() as { boardRoot?: unknown } | undefined)?.boardRoot;
    const contextEditor = page.mainEditor;
    if (!boardEditor || typeof boardRoot !== "string" || !boardRoot || !contextEditor || contextEditor.page !== page) {
        throw new Error("The Board is no longer attached to its hosting page.");
    }
    return { boardEditor, boardRoot, contextEditor };
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
    const { boardRoot, contextEditor } = resolveBoardHost(ownerId);
    const context = new ScriptContext(contextEditor);
    try {
        if (!(await boardTrust.allows(boardRoot, "appScripting"))) throw new Error(BoardGrant.deny("appScripting").message);
        const result = await resolveAiCall(context, request, undefined, {
            page: context.page,
            restricted: () => isBoardPermitted(boardRoot) ? undefined : "This Board is not permitted to use persephone.call().",
        });
        if (result.error) throw new Error(result.error);
        return result.result;
    } catch (error: unknown) {
        throw new Error(errMessage(error, "Board call failed."));
    } finally {
        context.dispose();
    }
}

async function handleBoardThemes(params: RendererRpcMethods["boardThemes"]["params"]): Promise<unknown> {
    try {
        const { boardRoot, boardEditor } = resolveBoardHost(params.ownerId);
        const method = params.method;
        if (!BOARD_THEME_METHODS.has(method)) throw new Error(`Unknown board themes method: ${method}`);
        if (!(await boardTrust.allows(boardRoot, "themes"))) throw new Error(BoardGrant.deny("themes").message);
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
        throw new Error(errMessage(error, "Board call failed."));
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
        try {
            if (editor === "image-view" && target.startsWith("data:image/")) {
                const blob = await (await fetch(target)).blob();
                await pagesModel.openImageInNewTab(URL.createObjectURL(blob), "Image");
                return null;
            }
            if (editor === "browser-view" && reuseKey !== undefined) {
                await pagesModel.lifecycle.openBoardRunPage(boardRoot, reuseKey, target);
                return null;
            }
            await app.events.openRawLink.sendAsync(createLinkData(target, {
                sourceId: "board", boardRoot, target: editor, revealLine, highlightText, waitForPageReady: true,
            }));
            return null;
        } catch (error: unknown) {
            const action = editor === "image-view" ? t("api.failedToOpenImage") : t("api.failedToOpenLink");
            void ui.notify(t("api.actionFailed", { action, error: errMessage(error) }), "error");
            throw error;
        }
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

