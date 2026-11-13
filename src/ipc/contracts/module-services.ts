import type { TimeoutExemptions } from "../timeout-exemptions";
import type { BoardServiceStatus, ModuleServicePortResult } from "../module-service-channels";
import type { EventObject } from "./event-object";

export interface ModuleServicesApi {
    connectHostServiceChannel: (request: HostServiceChannelRequest) => Promise<string>;
    getModuleServiceStatuses: () => Promise<BoardServiceStatus[]>;
    requestModuleServicePort: (boardRoot: string) => Promise<ModuleServicePortResult>;
    requestModuleService: (boardRoot: string, message: unknown) => Promise<unknown>;
    startModuleService: (boardRoot: string) => Promise<void>;
    stopModuleService: (boardRoot: string) => Promise<void>;
}

export interface ModuleServicesEvents {
    eModuleServiceStatusChanged: EventObject<BoardServiceStatus>;
}

export type HostServiceChannelRequest =
    { interfaceId: string; provider: string; version: number; openMessage: unknown };

export interface ModuleServicePortPayload {
    boardRoot: string;
    generation: number;
    leaseNonce: string;
}

export interface ModuleServicePortTransferMetadata {
    eModuleServicePort: {
        payload: ModuleServicePortPayload;
        transport: "webContents.postMessage";
        transferredPorts: [MessagePort];
    };
}


export const moduleServiceTimeoutExemptions = {
    requestModuleServicePort: "Trust readiness and port lease transfer are not request-bounded.",
    stopModuleService: "Process shutdown handshake has no request-level bound.",
    connectHostServiceChannel: "Trust readiness and channel lease setup are not request-bounded.",
    requestModuleService: "Service startup can precede its request deadline.",
    startModuleService: "Process startup handshake has no request-level bound.",
} satisfies TimeoutExemptions<ModuleServicesApi>;
