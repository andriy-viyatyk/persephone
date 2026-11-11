import type { CapabilityErrorCode as ClientErrorCode, CapabilityMethod } from "../shared/capability-contract";

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

export interface CapabilityKey { id: string; version: number; provider: string; handlerKey: string }
export interface CapabilityClientOptions {
    version?: number;
    provider?: string;
    filter?: { mime?: string; representation?: string };
    asAgent?: boolean;
    /** Internal to app.capabilities.invoke: only open methods, any major unless version is given. */
    forOpen?: boolean;
}
export interface CapabilityInvokeContext { parentRequestId?: string; deadlineMs?: number }
export type CapabilityProvider = CapabilityKey & { name: string; origin: "board" | "platform"; title?: string; priority: number; accepts?: readonly string[]; representation?: string; methods: Readonly<Record<string, CapabilityMethod>> };
export interface CapabilityClientInvoke { requestId: string; key: CapabilityKey; method: string; args: unknown[]; filter?: CapabilityClientOptions["filter"]; asAgent?: boolean }
export type CapabilityClientResult<T> = { ok: true; value: T } | { ok: false; error: { code: ClientErrorCode; message: string } };
