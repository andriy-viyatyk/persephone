import type { ServiceChannel } from "../shared/service-channel";
import type { CapabilityJson } from "../shared/capability-contract";
import type { ChannelDelivery } from "./channel-delivery";
import type { CapabilityRegistration } from "./capability-registry";
import type { BoundCapability, MainCapabilityInvocationContext } from "./capability-router";

/** What a backend returns for an opened channel: a delivered channel record or the in-process channel. */
export type OpenedCapabilityChannel = ServiceChannel | { channelId: string; onClose: (listener: () => void) => () => void };

/** Everything the router has already decided; a backend only performs the transport. */
interface CapabilityBackendRequest {
    readonly bound: BoundCapability;
    /** The current registration, as returned by the router's `authorize`. */
    readonly registration: CapabilityRegistration;
    readonly method: string;
    /** The caller's invocation: `signal` and `controller` carry deadline, cancel and trust revocation. */
    readonly invocation: MainCapabilityInvocationContext;
    /** Throws the router's `untrusted` / `permission-denied` / `no-handler` when authorization no longer holds. */
    readonly reauthorize: () => void;
}

export interface CapabilityBackendCall extends CapabilityBackendRequest {
    /** Already JSON-checked by the router. */
    readonly args: CapabilityJson[];
    readonly deadlineAt: number;
}

export interface CapabilityBackendChannelOpen extends CapabilityBackendRequest {
    /** Already JSON-checked, an object without a `type` key. */
    readonly argument: Record<string, unknown>;
    readonly delivery: ChannelDelivery | undefined;
}

export interface CapabilityBackend {
    call(request: CapabilityBackendCall): Promise<unknown>;
    openChannel(request: CapabilityBackendChannelOpen): Promise<OpenedCapabilityChannel>;
    /** Rejects a channel call by its raw arguments, before they are JSON-checked. Optional. */
    checkChannelArguments?(method: string, args: readonly unknown[]): void;
}
