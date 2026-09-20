import type { CapabilityHandlerFilter, CapabilityInfo } from "../../../api/types/capabilities";
import type { IAiMember, IAiVisionDescriptor } from "ai-vision";

const CAPABILITIES_MEMBERS: readonly IAiMember[] = [
    { name: "list", kind: "method", signature: "list()", summary: "List all indexed capability candidates without opening a handler." },
    { name: "handlers", kind: "method", signature: "handlers(id: string, filter?: { mime?: string })", summary: "List candidates for one capability id without opening a handler." },
];

interface CapabilityReader {
    list(): readonly CapabilityInfo[];
    handlers(id: string, filter?: CapabilityHandlerFilter): readonly CapabilityInfo[];
}

export function describeCapabilities(instance: unknown): IAiVisionDescriptor {
    const service = instance as CapabilityReader;
    return {
        kind: "Capabilities",
        summary: `Indexed capability candidates (${service.list().length} current candidates); read-only discovery.`,
        members: CAPABILITIES_MEMBERS,
        help: "Use list() to inspect all registered platform and trusted-board capability candidates, or handlers(id, filter) to inspect one id. Discovery does not activate a handler.",
        summarize: () => ({ kind: "Capabilities", candidateCount: service.list().length }),
    };
}
