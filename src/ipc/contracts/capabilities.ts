import type { TimeoutExemptions } from "../timeout-exemptions";
import type {
    CapabilityClientInvoke,
    CapabilityClientOptions,
    CapabilityClientResult,
    CapabilityInvokeContext,
    CapabilityProvider,
} from "../capability-bus-channels";
import type { CapabilityJson } from "../../shared/capability-contract";
import type { EventObject } from "./event-object";

export interface CapabilitiesApi {
    capabilityList: (asAgent?: boolean) => Promise<CapabilityClientResult<CapabilityProvider[]>>;
    capabilityProviders: (id: string, asAgent?: boolean) => Promise<CapabilityClientResult<CapabilityProvider[]>>;
    capabilityGet: (
        id: string,
        options?: CapabilityClientOptions,
    ) => Promise<CapabilityClientResult<CapabilityProvider | null>>;
    capabilityInvoke: (
        request: CapabilityClientInvoke,
        context?: CapabilityInvokeContext,
    ) => Promise<CapabilityClientResult<CapabilityJson>>;
    capabilityCancel: (requestId: string) => Promise<void>;
    getCapabilityIndex: () => Promise<
        ReturnType<typeof import("../../main/capability-registry").capabilityRegistry.snapshot>
    >;
    setCapabilityPreferences: (preferences: Record<string, string>) => Promise<void>;
    connectCapabilityChannel: (request: CapabilityClientInvoke) => Promise<CapabilityClientResult<string>>;
}

export interface CapabilitiesEvents {
    eCapabilityIndexSnapshot: EventObject<
        ReturnType<typeof import("../../main/capability-registry").capabilityRegistry.snapshot>
    >;
    eCapabilityIndexChanged: EventObject<number>;
}


export const capabilityTimeoutExemptions = {
    capabilityInvoke: "Registered capability code owns its optional deadline.",
    connectCapabilityChannel: "Registered capability code owns its optional deadline.",
} satisfies TimeoutExemptions<CapabilitiesApi>;
