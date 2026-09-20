import {
    INTENT_DEADLINE_MS,
    MAX_INTENT_DEPTH,
    MAX_INTENT_PAYLOAD_BYTES,
    MAX_OUTSTANDING_INTENTS_PER_HANDLER,
} from "../../ipc/capability-bus-channels";
import type {
    CapabilityErrorCode,
    CapabilityRegistration,
    CapabilityTransport,
    IntentRequest,
} from "../../ipc/capability-bus-channels";
import { errMessage } from "../../shared/utils";
import { boardTrust } from "./board-trust";
import { pagesModel } from "./pages";
import type { CapabilityInvokeOptions } from "./types/capabilities";
import { windowClosing } from "../core/state/events";

const capabilityErrorCodes = new Set<CapabilityErrorCode>([
    "no-handler",
    "untrusted",
    "handler-closed",
    "crashed",
    "cancelled",
    "timeout",
    "cycle",
    "payload-too-large",
    "busy",
    "rejected",
]);

/** A typed failure from a capability invocation. */
export class CapabilityError extends Error {
    readonly name = "CapabilityError";
    readonly cause?: unknown;

    constructor(
        readonly code: CapabilityErrorCode,
        message: string,
        readonly requestId?: string,
        cause?: unknown,
    ) {
        super(message);
        this.cause = cause;
    }
}

interface PendingIntent {
    readonly registration: CapabilityRegistration;
    readonly request: IntentRequest;
    readonly pageId?: string;
    readonly resolve: (value: unknown) => void;
    readonly reject: (error: CapabilityError) => void;
    timer?: ReturnType<typeof setTimeout>;
    pageUnsubscribe?: () => void;
    abortUnsubscribe?: () => void;
    dispatched: boolean;
    cancellationSent: boolean;
    settled: boolean;
}

interface PayloadEstimateState {
    bytes: number;
    readonly visited: WeakSet<object>;
}

function addPayloadBytes(state: PayloadEstimateState, bytes: number): void {
    state.bytes += bytes;
}

function stringByteLength(value: string): number {
    return new TextEncoder().encode(value).byteLength;
}

/**
 * Estimate structured-clone size without serializing the value. The traversal is deliberately
 * conservative and bounded by the inline payload ceiling, so a large graph cannot monopolize the
 * renderer while it is being rejected.
 */
function estimatePayloadSize(payload: unknown): number {
    const state: PayloadEstimateState = { bytes: 0, visited: new WeakSet<object>() };

    const visit = (value: unknown): void => {
        if (state.bytes > MAX_INTENT_PAYLOAD_BYTES) return;

        switch (typeof value) {
            case "undefined":
                addPayloadBytes(state, 8);
                return;
            case "boolean":
                addPayloadBytes(state, 8);
                return;
            case "number":
                addPayloadBytes(state, 8);
                return;
            case "bigint":
                addPayloadBytes(state, 16);
                return;
            case "string":
                addPayloadBytes(state, 8 + stringByteLength(value));
                return;
            case "symbol":
            case "function":
                throw new TypeError("Capability payload contains a value that cannot be structured-cloned.");
            case "object":
                break;
            default:
                throw new TypeError("Capability payload contains a value that cannot be structured-cloned.");
        }

        if (value === null) {
            addPayloadBytes(state, 8);
            return;
        }
        if (state.visited.has(value)) return;
        state.visited.add(value);

        if (value instanceof ArrayBuffer) {
            addPayloadBytes(state, 16 + value.byteLength);
            return;
        }
        if (typeof SharedArrayBuffer !== "undefined" && value instanceof SharedArrayBuffer) {
            addPayloadBytes(state, 16 + value.byteLength);
            return;
        }
        if (ArrayBuffer.isView(value)) {
            addPayloadBytes(state, 16 + value.byteLength);
            return;
        }
        if (typeof Blob !== "undefined" && value instanceof Blob) {
            addPayloadBytes(state, 16 + value.size);
            return;
        }
        if (value instanceof Map) {
            addPayloadBytes(state, 24);
            for (const [key, entry] of value) {
                visit(key);
                visit(entry);
                if (state.bytes > MAX_INTENT_PAYLOAD_BYTES) return;
            }
            return;
        }
        if (value instanceof Set) {
            addPayloadBytes(state, 24);
            for (const entry of value) {
                visit(entry);
                if (state.bytes > MAX_INTENT_PAYLOAD_BYTES) return;
            }
            return;
        }
        if (value instanceof Date || value instanceof RegExp) {
            addPayloadBytes(state, 32);
            return;
        }
        if (Array.isArray(value)) {
            addPayloadBytes(state, 24);
            for (const key of Object.keys(value)) {
                addPayloadBytes(state, 4 + stringByteLength(key));
                visit(value[key as keyof typeof value]);
                if (state.bytes > MAX_INTENT_PAYLOAD_BYTES) return;
            }
            return;
        }

        addPayloadBytes(state, 24);
        for (const key of Object.keys(value)) {
            addPayloadBytes(state, 8 + stringByteLength(key));
            visit((value as Record<string, unknown>)[key]);
            if (state.bytes > MAX_INTENT_PAYLOAD_BYTES) return;
        }
    };

    visit(payload);
    return state.bytes;
}

function isCapabilityErrorCode(value: unknown): value is CapabilityErrorCode {
    return typeof value === "string" && capabilityErrorCodes.has(value as CapabilityErrorCode);
}

function transportError(error: unknown, requestId: string): CapabilityError {
    if (error instanceof CapabilityError) {
        return new CapabilityError(error.code, error.message, requestId, error.cause ?? error);
    }
    const candidate = error as { code?: unknown; message?: unknown } | null | undefined;
    if (isCapabilityErrorCode(candidate?.code)) {
        const message = typeof candidate.message === "string"
            ? candidate.message
            : errMessage(error, "Capability handler failed.");
        return new CapabilityError(candidate.code, message, requestId, error);
    }
    return new CapabilityError(
        "rejected",
        errMessage(error, "Capability handler rejected the request."),
        requestId,
        error,
    );
}

class CapabilityBus {
    private readonly pending = new Map<string, PendingIntent>();
    private readonly outstandingByHandler = new Map<string, number>();
    private transport: CapabilityTransport | undefined;

    constructor() {
        boardTrust.subscribePaths(() => this.settleUntrustedRequests());
        windowClosing.subscribe(() => this.settleAll("cancelled", true));
    }

    setTransport(transport: CapabilityTransport): void {
        this.transport = transport;
    }

    invoke(
        registration: CapabilityRegistration,
        payload: unknown,
        options?: CapabilityInvokeOptions,
    ): Promise<unknown> {
        const requestId = crypto.randomUUID();
        if (registration.origin === "board"
            && (!registration.boardRoot || !boardTrust.isTrusted(registration.boardRoot))) {
            return Promise.reject(new CapabilityError(
                "untrusted",
                `Capability handler "${registration.handlerKey}" is not trusted.`,
                requestId,
            ));
        }
        const transport = this.transport;
        if (!transport) {
            return Promise.reject(new CapabilityError(
                "handler-closed",
                "Capability transport is not available.",
                requestId,
            ));
        }

        const deadlineMs = options?.deadlineMs ?? INTENT_DEADLINE_MS;
        if (!Number.isFinite(deadlineMs) || deadlineMs <= 0) {
            return Promise.reject(new CapabilityError(
                "rejected",
                "Capability deadlineMs must be a positive finite number.",
                requestId,
            ));
        }

        let chainState: { chain: readonly string[]; depth: number };
        try {
            chainState = transport.chainForPage(options?.pageId);
        } catch (error) {
            return Promise.reject(transportError(error, requestId));
        }
        if (chainState.depth >= MAX_INTENT_DEPTH || chainState.chain.includes(registration.handlerKey)) {
            return Promise.reject(new CapabilityError(
                "cycle",
                `Capability handler "${registration.handlerKey}" would exceed MAX_INTENT_DEPTH (${MAX_INTENT_DEPTH}) or re-enter its chain.`,
                requestId,
            ));
        }

        let payloadBytes: number;
        try {
            payloadBytes = estimatePayloadSize(payload);
        } catch (error) {
            return Promise.reject(new CapabilityError(
                "rejected",
                errMessage(error, "Capability payload cannot be structured-cloned."),
                requestId,
                error,
            ));
        }
        if (payloadBytes > MAX_INTENT_PAYLOAD_BYTES) {
            return Promise.reject(new CapabilityError(
                "payload-too-large",
                `Capability payload exceeds MAX_INTENT_PAYLOAD_BYTES (${MAX_INTENT_PAYLOAD_BYTES} bytes).`,
                requestId,
            ));
        }

        const outstanding = this.outstandingByHandler.get(registration.handlerKey) ?? 0;
        if (outstanding >= MAX_OUTSTANDING_INTENTS_PER_HANDLER) {
            return Promise.reject(new CapabilityError(
                "busy",
                `Capability handler "${registration.handlerKey}" has reached MAX_OUTSTANDING_INTENTS_PER_HANDLER (${MAX_OUTSTANDING_INTENTS_PER_HANDLER}).`,
                requestId,
            ));
        }

        const deadlineAt = Date.now() + deadlineMs;
        const request: IntentRequest = {
            requestId,
            id: registration.id,
            ...(options?.version === undefined ? {} : { version: options.version }),
            payload,
            chain: [...chainState.chain],
            depth: chainState.depth,
            deadlineAt,
        };

        if (options?.signal?.aborted) {
            return Promise.reject(new CapabilityError(
                "cancelled",
                "Capability invocation was cancelled.",
                requestId,
            ));
        }

        return new Promise<unknown>((resolve, reject) => {
            const pending: PendingIntent = {
                registration,
                request,
                pageId: options?.pageId,
                resolve,
                reject,
                dispatched: false,
                cancellationSent: false,
                settled: false,
            };
            this.pending.set(requestId, pending);
            this.outstandingByHandler.set(registration.handlerKey, outstanding + 1);

            const page = options?.pageId ? pagesModel.findPage(options.pageId) : undefined;
            if (page) {
                pending.pageUnsubscribe = page.disposed.subscribe(() => {
                    this.settlePageRequests(options.pageId as string);
                });
            }
            if (options?.signal) {
                const onAbort = () => this.settle(
                    requestId,
                    new CapabilityError("cancelled", "Capability invocation was cancelled.", requestId),
                    true,
                );
                options.signal.addEventListener("abort", onAbort, { once: true });
                pending.abortUnsubscribe = () => options.signal?.removeEventListener("abort", onAbort);
            }

            pending.timer = setTimeout(() => {
                this.settle(
                    requestId,
                    new CapabilityError("timeout", "Capability invocation deadline elapsed.", requestId),
                    true,
                );
            }, Math.max(0, deadlineAt - Date.now()));

            if (options?.signal?.aborted) {
                this.settle(
                    requestId,
                    new CapabilityError("cancelled", "Capability invocation was cancelled.", requestId),
                    true,
                );
                return;
            }

            pending.dispatched = true;
            let dispatchResult: Promise<unknown>;
            try {
                dispatchResult = transport.dispatch(registration, request);
            } catch (error) {
                this.settle(requestId, transportError(error, requestId), false);
                return;
            }
            Promise.resolve(dispatchResult).then(
                (result) => this.settleSuccess(requestId, result),
                (error: unknown) => this.settle(requestId, transportError(error, requestId), false),
            );
        });
    }

    private settleSuccess(requestId: string, result: unknown): void {
        const pending = this.pending.get(requestId);
        if (!pending || pending.settled) return;
        this.settleRecord(pending);
        pending.resolve(result);
    }

    private settle(requestId: string, error: CapabilityError, deliverCancel: boolean): void {
        const pending = this.pending.get(requestId);
        if (!pending || pending.settled) return;
        this.settleRecord(pending);
        pending.reject(error);
        if (deliverCancel) this.cancelTransport(pending);
    }

    private settleRecord(pending: PendingIntent): void {
        if (pending.settled) return;
        pending.settled = true;
        this.pending.delete(pending.request.requestId);
        if (pending.timer !== undefined) clearTimeout(pending.timer);
        pending.pageUnsubscribe?.();
        pending.abortUnsubscribe?.();

        const outstanding = this.outstandingByHandler.get(pending.registration.handlerKey) ?? 0;
        if (outstanding <= 1) this.outstandingByHandler.delete(pending.registration.handlerKey);
        else this.outstandingByHandler.set(pending.registration.handlerKey, outstanding - 1);
    }

    private cancelTransport(pending: PendingIntent): void {
        if (pending.cancellationSent) return;
        pending.cancellationSent = true;
        try {
            this.transport?.cancel(pending.registration, pending.request.requestId);
        } catch (error) {
            console.error(`Failed to cancel capability request: ${errMessage(error)}`);
        }
    }

    private settlePageRequests(pageId: string): void {
        for (const pending of [...this.pending.values()]) {
            if (pending.pageId !== pageId) continue;
            this.settle(
                pending.request.requestId,
                new CapabilityError("cancelled", "The caller page was disposed.", pending.request.requestId),
                true,
            );
        }
    }

    private settleUntrustedRequests(): void {
        for (const pending of [...this.pending.values()]) {
            const { registration } = pending;
            if (registration.origin !== "board" || !registration.boardRoot) continue;
            if (boardTrust.isTrusted(registration.boardRoot)) continue;
            this.settle(
                pending.request.requestId,
                new CapabilityError("untrusted", "The capability handler board is no longer trusted.", pending.request.requestId),
                true,
            );
        }
    }

    private settleAll(code: "cancelled", deliverCancel: boolean): void {
        for (const pending of [...this.pending.values()]) {
            this.settle(
                pending.request.requestId,
                new CapabilityError(code, "The renderer window is closing.", pending.request.requestId),
                deliverCancel,
            );
        }
    }
}

export const capabilityBus = new CapabilityBus();

/** Register the renderer-local board transport during renderer startup. */
export function registerCapabilityTransport(transport: CapabilityTransport): void {
    capabilityBus.setTransport(transport);
}
