import type { CapabilityClientInvoke, CapabilityClientOptions, CapabilityClientResult, CapabilityProvider } from "./capability-bus-channels";
/**
 * Main/utility-process protocol for board module services.
 *
 * This file deliberately contains no renderer or main implementation imports so
 * so the service adapter can consume the same wire contract.
 */

import type { BoardServiceInterfaceDeclaration, BoardServiceUseDeclaration } from "../shared/board/board-service-declarations";
import type { NormalizedBoardPermissions } from "../shared/board/board-permissions";
import type { BoardCapabilityDeclaration, CapabilityCallerIdentity, CapabilityErrorCode, CapabilityJson } from "../shared/capability-contract";
import type { WireError } from "../shared/wire-error";
import { CAPABILITY_DEFAULT_TIMEOUT_MS } from "../shared/capability-limits";
import type { ProviderOperation } from "../shared/provider-operation-policy";
export { PROVIDER_OPERATION_POLICY } from "../shared/provider-operation-policy";
export type { ProviderOperation, ProviderOperationPolicy } from "../shared/provider-operation-policy";

export const SERVICE_HANDSHAKE_TIMEOUT_MS = 5000;
export const SERVICE_SHUTDOWN_TIMEOUT_MS = 2000;
export const SERVICE_RENDERER_LEASE_TIMEOUT_MS = 5000;
export const SERVICE_QUIT_GATE_TIMEOUT_MS = 5000;
export { MAX_OUTSTANDING_REQUESTS_PER_SERVICE, MAX_SERVICE_CHANNELS_PER_BOARD, MAX_SERVICE_CHANNELS_PER_SERVICE, MAX_SERVICE_CHANNEL_IN_FLIGHT, MAX_SERVICE_CHANNEL_MESSAGE_BYTES } from "../shared/capability-limits";
export const SERVICE_REQUEST_DEADLINE_MS = CAPABILITY_DEFAULT_TIMEOUT_MS;
export const HOST_SERVICE_CHANNEL_POLICIES = {
    "speech.transcribe@1": { interfaceId: "speech.transcribe", version: 1, openTypes: ["describe", "transcribe"], ownerLabel: "voice-typing" },
    "speech.synthesize@1": { interfaceId: "speech.synthesize", version: 1, openTypes: ["describe", "speak"], ownerLabel: "speech-synthesize" },
    "speech.wake@1": { interfaceId: "speech.wake", version: 1, openTypes: ["describe", "enroll", "list", "delete", "listen"], ownerLabel: "speech-wake" },
    "text.translate@1": { interfaceId: "text.translate", version: 1, openTypes: ["describe", "detect", "translate", "download"], ownerLabel: "text-translation" },
} as const;
/** How long an opened channel waits for its port to reach the board frame. */
export { CAPABILITY_DEFAULT_TIMEOUT_MS as SERVICE_CHANNEL_OPEN_TIMEOUT_MS } from "../shared/capability-limits";

export type ServiceChannelCloseReason = WireError;
export type ServiceChannelWireMessage =
    | { kind: "channel-open"; channelId: string; boardId: string; generation: number; openMessage: unknown; info: { page: { boardId: string }; interface?: { id: string; version: number }; caller?: { id: string; name: string } } }
    | { kind: "channel-close"; channelId: string; reason: ServiceChannelCloseReason };
export type ServiceChannelMainMessage =
    | { kind: "channel-message"; channelId: string; sequence: number; message: unknown }
    | { kind: "channel-ack"; channelId: string; sequence: number }
    | { kind: "channel-closed"; channelId: string; reason: ServiceChannelCloseReason };

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
export type ServiceErrorPayload = WireError;
export type ModuleServicePortResult = { ok: true } | { ok: false; error: ServiceErrorPayload };
export interface ServiceHostConfig {
    capabilityCalls: Array<{ id: string; version: number; method: string }>;
}

export interface CapabilityInvocationWireContext {
    requestId: string;
    chain: string[];
    depth: number;
    originatingWindowId?: number;
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
    capabilities?: BoardCapabilityDeclaration[];
    legacyCapabilities?: BoardCapabilityDeclaration[];
    boardRoot: string;
    /** Normalized board-relative ESM entry from the manifest contract. */
    service?: string;
    /** Whether the board passes both trust and permission checks. */
    canStartService: boolean;
    permissions: NormalizedBoardPermissions;
    /** Current normalized manifest declaration; never used for enforcement. */
    manifestPermissions: NormalizedBoardPermissions;
    manifestChanged?: boolean;
    uses?: BoardServiceUseDeclaration[];
    manifestUses?: BoardServiceUseDeclaration[];
    serviceInterfaces?: BoardServiceInterfaceDeclaration[];
    boardName?: string;
    callerId?: string;
}

export interface BoardServiceTrustSnapshot {
    trustedPaths: string[];
    boards: TrustedBoardSnapshotEntry[];
}

export type ServiceParentMessage =
    | { kind: "init"; nonce: number; config: ServiceHostConfig }
    | { kind: "probe"; nonce: number }
    | { kind: "locale-changed"; locale: string }
    | { kind: "request"; requestId: string; message: unknown }
    | { kind: "capability-call"; requestId: string; id: string; version: number; method: string; args: CapabilityJson[]; caller: CapabilityCallerIdentity; deadlineAt: number; context: CapabilityInvocationWireContext }
    | { kind: "capability-client-result"; requestId: string; result: CapabilityClientResult<CapabilityProvider[] | CapabilityProvider | CapabilityJson | null> }
    | { kind: "capability-client-port"; requestId: string }
    | { kind: "capability-cancel"; requestId: string; reason: "timeout" | "cancelled" | "untrusted" }
    | {
        /** The transferred MessagePortMain arrives in `event.ports[0]`, NOT in this body —
         *  a port is not structured-cloneable as a message value. */
        kind: "attach-renderer";
        generation: number;
        leaseNonce: string;
    }
    | { kind: "drop-renderer"; generation: number; leaseNonce: string; reason: RendererLeaseLostReason }
    | { kind: "channel-open"; channelId: string; boardId: string; generation: number; openMessage: unknown; info: { page: { boardId: string }; interface?: { id: string; version: number }; caller?: { id: string; name: string } } }
    | { kind: "channel-close"; channelId: string; reason: ServiceChannelCloseReason }
    | { kind: "shutdown"; nonce: number; reason: ServiceStopReason }
    | { kind: "storage-response"; requestId: string; result?: unknown; error?: unknown }
    | { kind: "mcp-endpoint-response"; requestId: string; result?: unknown; error?: ServiceErrorPayload }
    | { kind: "board-settings-response"; requestId: string; result?: unknown; error?: ServiceErrorPayload }
    | { kind: "board-settings-subscribe-response"; requestId: string; error?: ServiceErrorPayload }
    | { kind: "board-settings-unsubscribe-response"; requestId: string; error?: ServiceErrorPayload }
    | { kind: "board-settings-changed"; subscriptionId: string; id: string; value: unknown };

export type ServiceMainMessage =
    | { kind: "ready"; nonce: number }
    | { kind: "probe-ack"; nonce: number }
    | { kind: "renderer-attached"; generation: number; leaseNonce: string }
    | { kind: "response"; requestId: string; result: unknown }
    | { kind: "response"; requestId: string; error: ServiceErrorPayload | string }
    | { kind: "capability-client-discover"; requestId: string; id?: string }
    | { kind: "capability-client-resolve"; requestId: string; id: string; options?: CapabilityClientOptions }
    | { kind: "capability-client-invoke"; request: CapabilityClientInvoke; parentRequestId?: string }
    | { kind: "capability-client-cancel"; requestId: string }
    | { kind: "capability-result"; requestId: string; result: CapabilityJson }
    | { kind: "capability-result"; requestId: string; error: { code: CapabilityErrorCode; message: string } }
    | {
        kind: "storage-request";
        requestId: string;
        operation: ServiceStorageOperation;
        args: unknown[];
    }
    | { kind: "mcp-endpoint-request"; requestId: string; operation: "issue" | "revoke"; token?: string }
    | { kind: "board-settings-get"; requestId: string; id: string }
    | { kind: "board-settings-subscribe"; requestId: string; subscriptionId: string }
    | { kind: "board-settings-unsubscribe"; requestId: string; subscriptionId: string }
    | { kind: "channel-ended"; channelId: string };

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
 *  lease changes. This count lets the board know a read is outstanding without identifying it. */
export interface ProviderActiveContentReadCount {
    kind: "content-read-count";
    count: number;
}

export type RendererServiceMessage =
    | { kind: "hello"; generation: number; leaseNonce: string }
    | { kind: "hello-ack"; generation: number; leaseNonce: string }
    | { kind: "request"; requestId: string; message: unknown }
    /** Renderer → host only, no response expected. Frees the matching `readBinary`/`readRange`
     *  request's slot and best-effort aborts the board's implementation. Never sent for
     *  control operations (`writeBinary`/`stat`/`watch*`), which keep their 10s deadline instead. */
    | { kind: "cancel"; requestId: string }
    | { kind: "response"; requestId: string; result?: unknown; error?: ServiceErrorPayload }
    | ProviderEvent
    | ProviderStatusEvent
    | ProviderCapabilities
    | ProviderActiveContentReadCount
    | { kind: "lease-lost"; reason: RendererLeaseLostReason };
