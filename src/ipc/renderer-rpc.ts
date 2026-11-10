import type { HintMode } from "ai-vision";
import type { BoardCallRequest } from "./board-bridge-channels";
import type { BoardServiceSettingValue } from "./board-service-settings-channels";
import type { WireError } from "../shared/wire-error";

export const RendererRpcChannel = {
    request: "renderer-rpc:request",
    reply: "renderer-rpc:reply",
} as const;

export type RendererRpcReply =
    | { ok: true; result: unknown }
    | { ok: false; error: WireError };

export interface McpCallParams {
    path: string;
    args?: unknown[];
    hints?: HintMode;
    maxLength?: number;
    timeoutMs?: number;
    value?: unknown;
    seenKinds?: string[];
    eventCursor?: number;
    collectAgentTips?: boolean;
}

/** Renderer-only codes are method-not-found and invalid-params; main may also send timeout,
 * window-unavailable, and cancelled. Settings handlers may send untrusted, service-exited, and
 * service-error. Uncoded failures use the shared default error code. */
export interface RendererRpcMethods {
    mcpCall: { params: McpCallParams; result: unknown };
    boardCall: { params: { ownerId: string; boardId: string; request: BoardCallRequest }; result: unknown };
    boardThemes: { params: { ownerId: string; boardId: string; method: string; args: unknown[]; value?: unknown }; result: unknown };
    openRawLink: { params: { target: string; boardRoot: string; editor?: string; revealLine?: number; highlightText?: string; reuseKey?: string }; result: null };
    openBoard: { params: { folder: string }; result: null };
    registerTsProject: { params: { root: string; owner: string }; result: null };
    unregisterTsProject: { params: { root: string; owner: string }; result: null };
    releaseTsProjects: { params: { owner: string }; result: null };
    serviceSettingsGet: { params: { boardRoot: string; id: string }; result: BoardServiceSettingValue };
    serviceSettingsSubscribe: { params: { boardRoot: string; subscriptionId: string }; result: null };
    serviceSettingsUnsubscribe: { params: { boardRoot: string; subscriptionId: string }; result: null };
}

export type RendererRpcMethod = keyof RendererRpcMethods;
