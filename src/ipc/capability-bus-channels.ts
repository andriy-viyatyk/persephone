import type { CapabilityErrorCode as ClientErrorCode, CapabilityMethod } from "../shared/capability-contract";

export { MAX_INTENT_PAYLOAD_BYTES, MAX_INTENT_DEPTH, MAX_OUTSTANDING_INTENTS_PER_HANDLER } from "../shared/capability-limits";
export { CAPABILITY_DEFAULT_TIMEOUT_MS as INTENT_DEADLINE_MS } from "../shared/capability-limits";

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
    representation?: string;
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

export interface BoundOpenDispatch {
    registration: CapabilityRegistration;
    request: IntentRequest;
}

export interface BoundOpenSettlement {
    requestId: string;
    result?: unknown;
    error?: { code: string; message: string };
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

export interface CapabilityKey { id: string; version: number; provider: string; handlerKey: string }
export interface CapabilityClientOptions { version?: number; provider?: string; filter?: { mime?: string; representation?: string }; asAgent?: boolean }
export type CapabilityProvider = CapabilityKey & { name: string; origin: "board" | "platform"; title?: string; priority: number; accepts?: readonly string[]; representation?: string; methods: Readonly<Record<string, CapabilityMethod>> };
export interface CapabilityClientInvoke { requestId: string; key: CapabilityKey; method: string; args: unknown[]; filter?: CapabilityClientOptions["filter"]; asAgent?: boolean }
export type CapabilityClientResult<T> = { ok: true; value: T } | { ok: false; error: { code: ClientErrorCode; message: string } };
