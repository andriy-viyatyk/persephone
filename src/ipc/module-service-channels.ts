/**
 * Main/utility-process protocol for board module services.
 *
 * This file deliberately contains no renderer or main implementation imports so
 * that the wire contract can be consumed by the service adapter and US-1468.
 */

import type { NormalizedBoardPermissions } from "../shared/board-manifest-utils";

export const SERVICE_HANDSHAKE_TIMEOUT_MS = 5000;
export const SERVICE_SHUTDOWN_TIMEOUT_MS = 2000;
export const SERVICE_RENDERER_LEASE_TIMEOUT_MS = 5000;
export const SERVICE_QUIT_GATE_TIMEOUT_MS = 5000;
export const MAX_OUTSTANDING_REQUESTS_PER_SERVICE = 32;
export const SERVICE_REQUEST_DEADLINE_MS = 10_000;

export type BoardServiceState = "stopped" | "starting" | "running" | "stopping" | "failed";
export type ServiceStopReason = "untrusted" | "explicit" | "quit";
export type RendererLeaseLostReason =
    | "superseded"
    | "stopping"
    | "untrusted"
    | "quit"
    | "service-exited"
    | "renderer-port-attach-failed";

export const STOP_REASON_CODE: Readonly<Record<ServiceStopReason, string>> = {
    untrusted: "untrusted",
    explicit: "service-exited",
    quit: "quit",
};

export const LEASE_LOST_CODE: Readonly<Record<RendererLeaseLostReason, string>> = {
    superseded: "renderer-reloaded",
    stopping: "service-exited",
    untrusted: "untrusted",
    quit: "quit",
    "service-exited": "service-exited",
    "renderer-port-attach-failed": "service-exited",
};

export const STOP_REASON_LEASE_REASON: Readonly<Record<ServiceStopReason, RendererLeaseLostReason>> = {
    explicit: "stopping",
    untrusted: "untrusted",
    quit: "quit",
};
export type ServiceStorageOperation = "get" | "set" | "delete" | "keys";
export interface ServiceErrorPayload { code: string; message: string }
export type ModuleServicePortResult = { ok: true } | { ok: false; error: ServiceErrorPayload };
export interface ServiceHostConfig {
    serviceRequestDeadlineMs: number;
    maxOutstandingRequestsPerService: number;
    maxBufferedPipeBytes: number;
    maxBoardPipeChunkBytes: number;
    providerRequestClasses: Record<ProviderOperation, "content-read" | "control">;
}

export interface BoardServiceStatus {
    boardRoot: string;
    state: BoardServiceState;
    reason?: string;
    pid?: number;
    startedAt?: number;
    restartCount: number;
}

export interface StartResult {
    boardRoot: string;
    pid?: number;
    startedAt: number;
}

export interface TrustedBoardSnapshotEntry {
    boardRoot: string;
    /** Normalized board-relative ESM entry from the US-1466 manifest contract. */
    service?: string;
    /** Result of the US-1466 trusted-plus-permission predicate. */
    canStartService: boolean;
    permissions: NormalizedBoardPermissions;
    /** Current normalized manifest declaration; never used for enforcement. */
    manifestPermissions: NormalizedBoardPermissions;
    manifestChanged?: boolean;
}

export interface BoardServiceTrustSnapshot {
    trustedPaths: string[];
    boards: TrustedBoardSnapshotEntry[];
}

export type ServiceParentMessage =
    | { kind: "init"; nonce: number; config: ServiceHostConfig }
    | { kind: "probe"; nonce: number }
    | { kind: "request"; requestId: string; message: unknown }
    | {
        /** The transferred MessagePortMain arrives in `event.ports[0]`, NOT in this body —
         *  a port is not structured-cloneable as a message value. */
        kind: "attach-renderer";
        generation: number;
        leaseNonce: string;
    }
    | { kind: "drop-renderer"; generation: number; leaseNonce: string; reason: RendererLeaseLostReason }
    | { kind: "shutdown"; nonce: number; reason: ServiceStopReason }
    | { kind: "storage-response"; requestId: string; result?: unknown; error?: unknown };

export type ServiceMainMessage =
    | { kind: "ready"; nonce: number }
    | { kind: "probe-ack"; nonce: number }
    | { kind: "renderer-attached"; generation: number; leaseNonce: string }
    | { kind: "response"; requestId: string; result: unknown }
    | { kind: "response"; requestId: string; error: ServiceErrorPayload | string }
    | {
        kind: "storage-request";
        requestId: string;
        operation: ServiceStorageOperation;
        args: unknown[];
    };

export type ProviderOperation =
    | "readBinary"
    | "readRange"
    | "writeBinary"
    | "stat"
    | "watchSubscribe"
    | "watchUnsubscribe"
    | "statusSubscribe"
    | "statusUnsubscribe";

export interface ProviderOperationPolicy {
    /** End-to-end deadline, owned by the renderer client (`module-service.request`); absent =
     *  unbounded, released only by cancellation (EPIC-113 D6). The host runs no provider timer. */
    readonly deadlineMs?: number;
    /** `content-read` is exempt from MAX_OUTSTANDING_REQUESTS_PER_SERVICE and counted as an
     *  outstanding content read; `control` competes for that cap. */
    readonly requestClass: "content-read" | "control";
}

/**
 * The one provider-operation policy table (US-1544). `assets/module-service-host.mjs` cannot
 * import TypeScript; US-1543 delivers the request classes to the host in its `init` message.
 * Note `stat` is unbounded but still a
 * control request: it sits on content.open()'s eager-sizing path, but must not erode the cap.
 */
export const PROVIDER_OPERATION_POLICY: Readonly<Record<ProviderOperation, ProviderOperationPolicy>> = {
    readBinary: { requestClass: "content-read" },
    readRange: { requestClass: "content-read" },
    writeBinary: { deadlineMs: SERVICE_REQUEST_DEADLINE_MS, requestClass: "control" },
    stat: { requestClass: "control" },
    watchSubscribe: { deadlineMs: SERVICE_REQUEST_DEADLINE_MS, requestClass: "control" },
    watchUnsubscribe: { deadlineMs: SERVICE_REQUEST_DEADLINE_MS, requestClass: "control" },
    statusSubscribe: { deadlineMs: SERVICE_REQUEST_DEADLINE_MS, requestClass: "control" },
    statusUnsubscribe: { deadlineMs: SERVICE_REQUEST_DEADLINE_MS, requestClass: "control" },
};

export interface ProviderRequest {
    kind: "provider";
    operation: ProviderOperation;
    type: string;
    config: Record<string, unknown>;
    subscriptionId?: string;
    data?: Uint8Array;
    range?: { start: number; end: number };
}

export interface ProviderWireStat {
    exists: boolean;
    size?: number;
    mtime?: string;
}

export type ProviderWireErrorCode =
    | "provider-not-registered"
    | "provider-read-only"
    | "provider-range-unsupported"
    | "provider-invalid-result"
    | "provider-failed"
    | "provider-payload-too-large";

export interface ProviderWireStatus {
    state: "idle" | "connecting" | "active" | "done" | "error";
    text?: string;
    detail?: string;
    progress?: { loaded: number; total?: number };
    rate?: number;
}

export interface ProviderWireError {
    kind: "provider-error";
    code: ProviderWireErrorCode;
    message: string;
}

export type ProviderResult =
    | { kind: "provider-result"; operation: "readBinary"; ok: true; data: Uint8Array }
    | { kind: "provider-result"; operation: "readRange"; ok: true; data: Uint8Array }
    | { kind: "provider-result"; operation: "writeBinary"; ok: true }
    | { kind: "provider-result"; operation: "stat"; ok: true; stat: ProviderWireStat }
    | { kind: "provider-result"; operation: "watchSubscribe" | "watchUnsubscribe" | "statusSubscribe" | "statusUnsubscribe"; ok: true }
    | { kind: "provider-result"; ok: false; error: ProviderWireError };

export interface ProviderEvent {
    kind: "provider-event";
    subscriptionId: string;
    event: string;
}

export interface ProviderStatusEvent {
    kind: "provider-status-event";
    subscriptionId: string;
    status: ProviderWireStatus | null;
}

export interface ProviderCapabilities {
    kind: "provider-capabilities";
    type: string;
    writable: boolean;
    rangeReadable: boolean;
}

/** Pushed by the host whenever the number of in-flight `readBinary`/`readRange` requests for a
 *  lease changes (US-1518 decision 10). A count, not a per-resource breakdown — D6 only requires
 *  that "a board can know a read is outstanding," not which one. */
export interface ProviderActiveContentReadCount {
    kind: "content-read-count";
    count: number;
}

export type RendererServiceMessage =
    | { kind: "hello"; generation: number; leaseNonce: string }
    | { kind: "hello-ack"; generation: number; leaseNonce: string }
    | { kind: "request"; requestId: string; message: unknown }
    /** Renderer → host only, no response expected. Frees the matching `readBinary`/`readRange`
     *  request's slot and best-effort aborts the board's implementation (US-1518). Never sent for
     *  control operations (`writeBinary`/`stat`/`watch*`), which keep their 10s deadline instead. */
    | { kind: "cancel"; requestId: string }
    | { kind: "response"; requestId: string; result?: unknown; error?: ServiceErrorPayload }
    | ProviderEvent
    | ProviderStatusEvent
    | ProviderCapabilities
    | ProviderActiveContentReadCount
    | { kind: "lease-lost"; reason: RendererLeaseLostReason };
