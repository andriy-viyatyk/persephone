export const MAX_INTENT_PAYLOAD_BYTES = 8 * 1024 * 1024;
export const MAX_INTENT_DEPTH = 8;
export const INTENT_DEADLINE_MS = 10_000;
export const MAX_OUTSTANDING_INTENTS_PER_HANDLER = 32;

export const CAPABILITY_ERROR_CODES = [
    "no-handler", "untrusted", "handler-closed", "crashed", "cancelled",
    "timeout", "cycle", "payload-too-large", "busy", "rejected",
] as const;

export type CapabilityErrorCode = (typeof CAPABILITY_ERROR_CODES)[number];

const capabilityErrorCodeSet: ReadonlySet<string> = new Set(CAPABILITY_ERROR_CODES);

export function isCapabilityErrorCode(value: unknown): value is CapabilityErrorCode {
    return typeof value === "string" && capabilityErrorCodeSet.has(value);
}

export interface IntentEnvelope {
    id: string;
    version?: number;
    requestId: string;
    payload: unknown;
}

export interface CapabilityOutcome {
    pageId?: string;
    result?: unknown;
    discardPage?: boolean;
}

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
    alwaysOpensNewPage?: boolean;
}

export type CapabilityRegistration = CapabilityDeclaration & {
    handlerKey: string;
    origin: CapabilityOrigin;
    boardRoot?: string;
    boardName?: string;
};

export interface IntentRequest extends IntentEnvelope {
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
