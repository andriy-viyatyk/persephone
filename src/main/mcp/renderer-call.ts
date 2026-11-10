import { isCoded } from "../../shared/coded-error";
import { errMessage } from "../../shared/utils";
import { requestRenderer } from "../renderer-rpc";
import type { McpCallParams } from "../../ipc/renderer-rpc";
import type { McpResponse } from "./types";

export async function callRendererForMcp(
    params: McpCallParams,
    windowIndex: number | undefined,
    timeoutMs: number | undefined,
): Promise<McpResponse> {
    try {
        return { result: await requestRenderer("mcpCall", params, { windowIndex }, timeoutMs) };
    } catch (error: unknown) {
        const code = isCoded(error) && error.code === "invalid-params" ? -32602 : -32603;
        return { error: { code, message: errMessage(error) } };
    }
}
