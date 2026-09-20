export const MAX_INTENT_PAYLOAD_BYTES = 8 * 1024 * 1024;
export const MAX_INTENT_DEPTH = 8;
export const INTENT_DEADLINE_MS = 10_000;
export const MAX_OUTSTANDING_INTENTS_PER_HANDLER = 32;

export type CapabilityErrorCode =
    | "no-handler"
    | "untrusted"
    | "handler-closed"
    | "crashed"
    | "cancelled"
    | "timeout"
    | "cycle"
    | "payload-too-large"
    | "busy"
    | "rejected";

export type CapabilityOrigin = "platform" | "board" | "script";

export interface CapabilityDeclaration {
    id: string;
    version: number;
    priority: number;
    accepts?: string[];
    payloadSchema?: unknown;
    title?: string;
    /** A winning headless declaration is out of scope here and settles as no-handler; service-backed
     *  headless routing belongs to a later phase. */
    headless?: boolean;
}

export type CapabilityRegistration = CapabilityDeclaration & {
    handlerKey: string;
    origin: CapabilityOrigin;
    boardRoot?: string;
};

export interface IntentRequest {
    requestId: string;
    id: string;
    version?: number;
    payload: unknown;
    chain: string[];
    depth: number;
    deadlineAt: number;
}

export interface IntentSettlement {
    requestId: string;
    result?: unknown;
    error?: { code: CapabilityErrorCode; message: string };
}

export interface CapabilityTransport {
    /** Dispatch to a board handler; resolves when the board settles, rejects with a typed code. */
    dispatch(registration: CapabilityRegistration, request: IntentRequest): Promise<unknown>;
    /** Best-effort cancel for a request already dispatched. Never throws. */
    cancel(registration: CapabilityRegistration, requestId: string): void;
    /** The chain/depth currently in force for a page, for D6. 0-length when idle. */
    chainForPage(pageId: string | undefined): { chain: readonly string[]; depth: number };
}
