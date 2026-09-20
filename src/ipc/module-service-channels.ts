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
export const MAX_SERVICE_LOG_BYTES = 256 * 1024;
export const MAX_SERVICE_LOG_CHUNK_BYTES = 8 * 1024;

export type BoardServiceState = "stopped" | "starting" | "running" | "stopping" | "failed";
export type RendererLeaseState = "none" | "attaching" | "attached" | "lost";
export type ServiceStopReason = "untrusted" | "explicit" | "quit";

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
        kind: "attach-renderer";
        generation: number;
        leaseNonce: string;
        rendererPort: unknown;
    }
    | { kind: "drop-renderer"; generation: number; leaseNonce: string }
    | { kind: "shutdown"; nonce: number; reason: ServiceStopReason };

export type ServiceMainMessage =
    | { kind: "ready"; nonce: number }
    | { kind: "probe-ack"; nonce: number }
    | { kind: "renderer-attached"; generation: number; leaseNonce: string }
    | { kind: "response"; requestId: string; result: unknown }
    | { kind: "response"; requestId: string; error: unknown };

export type RendererServiceMessage =
    | { kind: "hello"; generation: number; leaseNonce: string }
    | { kind: "hello-ack"; generation: number; leaseNonce: string }
    | { kind: "request"; requestId: string; message: unknown }
    | { kind: "response"; requestId: string; result?: unknown; error?: unknown };

