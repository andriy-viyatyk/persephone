import { codedError } from "../shared/coded-error";
import type { CapabilityBackendKind } from "../shared/platform-capabilities";
import type { CapabilityBackend } from "./capability-backend";

export type ServiceOwnerTracker = (boardRoot: string, onClosed: () => void) => () => void;

export interface CapabilityBackendRegistryStartDependencies {
    audioBackend: CapabilityBackend;
    boardServiceBackend: CapabilityBackend;
    serviceOwnerTracker: ServiceOwnerTracker;
}

interface ServiceInvocationLifetime {
    owner: { kind: "window" } | { kind: "service"; boardRoot: string };
    controller: AbortController;
}

class CapabilityBackendRegistry {
    private readonly backends = new Map<CapabilityBackendKind, CapabilityBackend>();
    private serviceOwnerTracker: ServiceOwnerTracker | undefined;

    start(dependencies: CapabilityBackendRegistryStartDependencies): void {
        this.registerBackend("audio", dependencies.audioBackend);
        this.registerBackend("board-service", dependencies.boardServiceBackend);
        this.serviceOwnerTracker = dependencies.serviceOwnerTracker;
    }

    getBackend(kind: CapabilityBackendKind | undefined): CapabilityBackend | undefined {
        return kind ? this.backends.get(kind) : undefined;
    }

    watchServiceOwner(invocation: ServiceInvocationLifetime): (() => void) | undefined {
        if (invocation.owner.kind !== "service") return undefined;
        if (!this.serviceOwnerTracker) throw codedError("no-handler", "Capability service owner tracking is not registered.");
        return this.serviceOwnerTracker(invocation.owner.boardRoot, () => invocation.controller.abort(codedError("handler-closed")));
    }

    private registerBackend(kind: CapabilityBackendKind, backend: CapabilityBackend): void {
        if (this.backends.has(kind)) throw new Error(`Capability backend "${kind}" is already registered.`);
        this.backends.set(kind, backend);
    }
}

export const capabilityBackendRegistry = new CapabilityBackendRegistry();
