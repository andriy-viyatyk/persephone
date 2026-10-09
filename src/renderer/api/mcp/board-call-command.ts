import { pagesModel } from "../pages";
import { isBoardPermitted } from "../../editors/board/board-access";
import { ScriptContext } from "../../scripting/ScriptContext";
import { resolveAiCall } from "../../scripting/ai-vision/call";
import { UNBOUNDED_CALL_MAX_LENGTH } from "../../scripting/ai-vision/call-limits";
import { errMessage } from "../../../shared/utils";
import type { McpParams, McpResponse } from "./types";
import { isPositiveIntegerTimeout } from "../../../shared/ai-vision-timeout";
import { boardTrust } from "../board-trust";
import { boardPermissionError } from "../../../shared/board-manifest-utils";
import { app } from "../app";
import { getPreviewGeneration } from "../../theme/themes";
import type { BoardEditorModel } from "../../editors/board/BoardEditorModel";

const BOARD_THEME_METHODS = new Set([
    "list", "get", "current", "derive", "contrast", "fork", "file", "save", "rename", "delete", "apply", "preview", "endPreview",
]);

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

/** Internal renderer command used only by the Board MessagePort call envelope. */
export async function handleBoardCall(params: McpParams): Promise<McpResponse> {
    const ownerId = typeof params?.ownerId === "string" ? params.ownerId : "";
    const rawRequest = params?.request;
    if (!ownerId || !rawRequest || typeof rawRequest !== "object") {
        return { error: { code: -32602, message: "Board call needs an ownerId and request." } };
    }

    const requestData = rawRequest as Record<string, unknown>;
    if (typeof requestData.path !== "string" || !requestData.path) {
        return { error: { code: -32602, message: "Board call needs a non-empty path." } };
    }
    if (requestData.args !== undefined && !Array.isArray(requestData.args)) {
        return { error: { code: -32602, message: "Board call args must be an array." } };
    }
    if (requestData.timeoutMs !== undefined && !isPositiveIntegerTimeout(requestData.timeoutMs)) {
        return { error: { code: -32602, message: "Board call timeoutMs must be a positive integer." } };
    }

    const request = {
        path: requestData.path,
        hints: "never" as const,
        ...(requestData.args !== undefined ? { args: requestData.args as unknown[] } : {}),
        ...(Object.prototype.hasOwnProperty.call(requestData, "value") ? { value: requestData.value } : {}),
        // A board receives this value in JavaScript, not as text an agent reads, so it is not
        // subject to the agent-facing 20,000-character default. See UNBOUNDED_CALL_MAX_LENGTH.
        maxLength: typeof requestData.maxLength === "number"
            ? requestData.maxLength
            : UNBOUNDED_CALL_MAX_LENGTH,
        ...(requestData.timeoutMs !== undefined ? { timeoutMs: requestData.timeoutMs } : {}),
    };
    const page = pagesModel.findPage(ownerId);
    if (!page) {
        return { error: { code: -32603, message: "The Board's hosting page is no longer open." } };
    }

    const boardEditor = page.editors.find((editor) => editor.id === ownerId);
    const boardRoot = (boardEditor?.state.get() as { boardRoot?: unknown } | undefined)?.boardRoot;
    const contextEditor = page.mainEditor;
    if (!boardEditor || typeof boardRoot !== "string" || !boardRoot || !contextEditor || contextEditor.page !== page) {
        return { error: { code: -32603, message: "The Board is no longer attached to its hosting page." } };
    }

    const context = new ScriptContext(contextEditor);
    try {
        const themeMatch = /^themes\.([a-zA-Z]+)$/.exec(request.path);
        if (themeMatch) {
            const method = themeMatch[1];
            if (!BOARD_THEME_METHODS.has(method)) return { error: { code: -32603, message: `Unknown board themes method: ${method}` } };
            if (!(await boardTrust.allows(boardRoot, "themes"))) {
                return { error: { code: -32603, message: boardPermissionError("themes").message } };
            }
            const boardId = typeof params?.boardId === "string" ? params.boardId : "";
            const args = cloneJson(request.args ?? []) as unknown[];
            const value = Object.prototype.hasOwnProperty.call(request, "value") ? cloneJson(request.value) : undefined;
            let result: unknown;
            if (method === "current") result = app.themes.current;
            else {
                const service = app.themes as unknown as Record<string, (...values: unknown[]) => unknown>;
                result = await service[method](...(value !== undefined ? [value] : args));
            }
            if (method === "preview" && boardId) {
                (boardEditor as BoardEditorModel).recordBoardThemePreview(boardId, getPreviewGeneration());
            }
            const safeResult = cloneJson(result === undefined ? null : result);
            return { result: safeResult };
        }
        if (!(await boardTrust.allows(boardRoot, "appScripting"))) {
            return { error: { code: -32603, message: boardPermissionError("appScripting").message } };
        }
        const result = await resolveAiCall(context, request, undefined, {
            page: context.page,
            restricted: () => isBoardPermitted(boardRoot)
                ? undefined
                : "This Board is not permitted to use persephone.call().",
        });
        if (result.error) return { error: { code: -32603, message: result.error } };
        return { result: result.result };
    } catch (error) {
        return { error: { code: -32603, message: errMessage(error, "Board call failed.") } };
    } finally {
        context.dispose();
    }
}
