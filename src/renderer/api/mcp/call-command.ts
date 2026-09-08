import type { McpParams, McpResponse } from "./types";
import { isPositiveIntegerTimeout } from "../../../shared/ai-vision-timeout";
import type { HintMode } from "ai-vision";

/**
 * The `call` MCP command — one path into the live object model (EPIC-083).
 * The main process peels `windows[i]` off the path before forwarding and passes the kinds whose
 * member lists this session has already seen, so hint dedupe survives the process boundary.
 */
export async function handleCall(params: McpParams): Promise<McpResponse> {
    const path = typeof params?.path === "string" ? params.path : "";
    const args = Array.isArray(params?.args) ? (params.args as unknown[]) : undefined;
    const hints = params?.hints as HintMode | undefined;
    const maxLength = typeof params?.maxLength === "number" ? params.maxLength : undefined;
    const timeoutMs = params?.timeoutMs === undefined ? undefined : params.timeoutMs;
    if (timeoutMs !== undefined && !isPositiveIntegerTimeout(timeoutMs)) {
        return { error: { code: -32602, message: "timeoutMs must be a positive integer." } };
    }
    const seenKinds = new Set(Array.isArray(params?.seenKinds) ? (params.seenKinds as string[]) : []);
    const request = { path, args, hints, maxLength, timeoutMs, ...(params && "value" in params ? { value: params.value } : {}) };

    const { aiCall } = await import("../../scripting/ai-vision/call");
    const result = await aiCall(request, seenKinds);
    return { result };
}
