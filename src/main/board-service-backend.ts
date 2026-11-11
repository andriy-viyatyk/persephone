import { randomUUID } from "node:crypto";
import type { CapabilityInvocationWireContext, ServiceParentMessage } from "../ipc/module-service-channels";
import { codedError } from "../shared/coded-error";
import { capabilityRegistry } from "./capability-registry";
import type { CapabilityBackend, CapabilityBackendCall, CapabilityBackendChannelOpen, OpenedCapabilityChannel } from "./capability-backend";
import type { MainCapabilityInvocationContext } from "./capability-router";
import type { moduleServiceSupervisor } from "./module-service-supervisor";

interface InvocationTracker { trackInvocation(context: MainCapabilityInvocationContext & { requestId: string }): () => void }

export class BoardServiceBackend implements CapabilityBackend {
    constructor(
        private readonly supervisor: Pick<typeof moduleServiceSupervisor, "callCapability" | "openCapabilityChannel">,
        private readonly invocations: InvocationTracker,
    ) {}

    async call({ registration, method, args, invocation, deadlineAt, reauthorize }: CapabilityBackendCall): Promise<unknown> {
        const provider = capabilityRegistry.board(registration.provider);
        if (!provider) throw codedError("untrusted");
        const requestId = randomUUID();
        const callContext: MainCapabilityInvocationContext & { requestId: string } = {
            caller: invocation.caller,
            owner: { kind: "service", boardRoot: provider.boardRoot },
            signal: invocation.signal,
            controller: invocation.controller,
            chain: [...invocation.chain, registration.handlerKey],
            depth: invocation.chain.length + 1,
            ...(invocation.originatingWindowId !== undefined ? { originatingWindowId: invocation.originatingWindowId } : {}),
            requestId,
            dispose: () => undefined,
        };
        const wireContext: CapabilityInvocationWireContext = {
            requestId,
            chain: [...invocation.chain, registration.handlerKey],
            depth: invocation.depth + 1,
            ...(invocation.originatingWindowId !== undefined ? { originatingWindowId: invocation.originatingWindowId } : {}),
        };
        const untrackInvocation = this.invocations.trackInvocation(callContext);
        try {
            return await this.supervisor.callCapability(provider.boardRoot, {
                kind: "capability-call", requestId, id: registration.id, version: registration.version,
                method, args, caller: invocation.caller, deadlineAt, context: wireContext,
            } as Extract<ServiceParentMessage, { kind: "capability-call" }>, invocation.signal, reauthorize);
        } finally { untrackInvocation(); }
    }

    async openChannel({ bound, registration, method, argument, invocation, delivery, reauthorize }: CapabilityBackendChannelOpen): Promise<OpenedCapabilityChannel> {
        const provider = capabilityRegistry.board(registration.provider);
        if (!provider) throw codedError("untrusted");
        const consumer = "provider" in bound.caller ? capabilityRegistry.board(bound.caller.provider) : undefined;
        const owner = "provider" in bound.caller ? `${bound.caller.kind}:${bound.caller.provider}` : "platform";
        return this.supervisor.openCapabilityChannel(provider.boardRoot, owner,
            bound.caller.kind === "board-service" ? consumer?.boardRoot : undefined, { ...argument, type: method },
            { interface: { id: registration.id, version: registration.version }, caller: invocation.caller }, invocation.signal,
            reauthorize, delivery);
    }
}
