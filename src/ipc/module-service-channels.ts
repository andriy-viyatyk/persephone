/**
 * Main/utility-process protocol for board module services.
 *
 * This file deliberately contains no renderer or main implementation imports so
 * that the wire contract can be consumed by the service adapter and US-1468.
 */

export const SERVICE_HANDSHAKE_TIMEOUT_MS = 5000;
export const SERVICE_SHUTDOWN_TIMEOUT_MS = 2000;
export const SERVICE_RENDERER_LEASE_TIMEOUT_MS = 5000;
export const SERVICE_QUIT_GATE_TIMEOUT_MS = 5000;
export const MAX_OUTSTANDING_REQUESTS_PER_SERVICE = 32;
export const SERVICE_REQUEST_DEADLINE_MS = 10_000;
export const MAX_SERVICE_LOG_BYTES = 256 * 1024;
export const MAX_SERVICE_LOG_CHUNK_BYTES = 8 * 1024;

export type BoardServiceState = "stopped" | "starting" | "running" | "stopping" | "failed";
export type RendererLeaseState = "none" | "attaching" | "attached" | "lost";
export type ServiceStopReason = "untrusted" | "explicit" | "quit";
export type RendererLeaseLostReason =
    | "superseded"
    | "stopping"
    | "untrusted"
    | "quit"
    | "service-exited"
    | "renderer-port-attach-failed";
export type ServiceStorageOperation = "get" | "set" | "delete" | "keys";

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
}

export interface TrustedBoardSnapshot {
    generation: number;
    boards: TrustedBoardSnapshotEntry[];
}

export type ServiceParentMessage =
    | { kind: "init"; nonce: number }
    | { kind: "probe"; nonce: number }
    | { kind: "request"; requestId: string; message: unknown }
    | {
        /** The transferred MessagePortMain arrives in `event.ports[0]`, NOT in this body —
         *  a port is not structured-cloneable as a message value. */
        kind: "attach-renderer";
        generation: number;
        leaseNonce: string;
    }
    | { kind: "drop-renderer"; generation: number; leaseNonce: string }
    | { kind: "shutdown"; nonce: number; reason: ServiceStopReason }
    | { kind: "storage-response"; requestId: string; result?: unknown; error?: unknown };

export type ServiceMainMessage =
    | { kind: "ready"; nonce: number }
    | { kind: "probe-ack"; nonce: number }
    | { kind: "renderer-attached"; generation: number; leaseNonce: string }
    | { kind: "response"; requestId: string; result: unknown }
    | { kind: "response"; requestId: string; error: unknown }
    | {
        kind: "storage-request";
        requestId: string;
        operation: ServiceStorageOperation;
        args: unknown[];
    };

export type ProviderOperation =
    | "readBinary"
    | "writeBinary"
    | "stat"
    | "watchSubscribe"
    | "watchUnsubscribe";

export interface ProviderRequest {
    kind: "provider";
    operation: ProviderOperation;
    type: string;
    config: Record<string, unknown>;
    subscriptionId?: string;
    data?: Uint8Array;
}

export interface ProviderWireStat {
    exists: boolean;
    size?: number;
    mtime?: string;
}

export type ProviderWireErrorCode =
    | "provider-not-registered"
    | "provider-read-only"
    | "provider-invalid-result"
    | "provider-failed"
    | "provider-payload-too-large";

export interface ProviderWireError {
    kind: "provider-error";
    code: ProviderWireErrorCode;
    message: string;
}

export type ProviderResult =
    | { kind: "provider-result"; operation: "readBinary"; ok: true; data: Uint8Array }
    | { kind: "provider-result"; operation: "writeBinary"; ok: true }
    | { kind: "provider-result"; operation: "stat"; ok: true; stat: ProviderWireStat }
    | { kind: "provider-result"; operation: "watchSubscribe" | "watchUnsubscribe"; ok: true }
    | { kind: "provider-result"; ok: false; error: ProviderWireError };

export interface ProviderEvent {
    kind: "provider-event";
    subscriptionId: string;
    event: string;
}

export interface ProviderCapabilities {
    kind: "provider-capabilities";
    type: string;
    writable: boolean;
}

export type RendererServiceMessage =
    | { kind: "hello"; generation: number; leaseNonce: string }
    | { kind: "hello-ack"; generation: number; leaseNonce: string }
    | { kind: "request"; requestId: string; message: unknown }
    | { kind: "response"; requestId: string; result?: unknown; error?: unknown }
    | ProviderEvent
    | ProviderCapabilities
    | { kind: "lease-lost"; reason: RendererLeaseLostReason };
