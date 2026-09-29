import type { IAiMember, IAiVisionDescriptor } from "ai-vision";
import type { IContentPipe } from "../../api/types/io.pipe";

const CONTENT_PIPE_MEMBERS: readonly IAiMember[] = [
    { name: "stages", kind: "property", summary: "Provider and transformer stages in read order, with bounded current status snapshots." },
    { name: "summary", kind: "property", summary: "The current error status, or the most recently updated stage status; undefined when no stage reports status." },
];

/** Describe only the bounded status data exposed by a page's content pipe. */
export function describeContentPipe(pipe: IContentPipe): IAiVisionDescriptor {
    return {
        kind: "ContentPipe",
        summary: "Read-only status for the page's provider and ordered content transformers.",
        members: CONTENT_PIPE_MEMBERS,
        help: "stages lists the provider followed by transformers. Each stage exposes its role, type, display name, and current status; progress uses bytes and rate uses bytes per second. summary selects an error first, then the most recently updated stage status. Status is transient and is not persisted with the pipe descriptor.",
        summarize: () => ({ stages: pipe.stages, summary: pipe.summary }),
    };
}
