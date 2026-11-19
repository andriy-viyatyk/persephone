import type { IAiMember, IAiVisionDescriptor } from "ai-vision";

const PROCESS_MEMBERS: readonly IAiMember[] = [
    { name: "execute", kind: "method", signature: "execute(command: string, options?: IExecuteOptions) -> { jobId: string }", summary: "Spawn a shell or direct child process. Through call, the plain result contains jobId; function-valued members are omitted. The script-only handle members on, getText, getJson, getBytes, write, endStdin, and kill are unavailable through call; use script.execute for handle work.", caution: "runs an external process with the user's privileges" },
];

export function describeProcess(_instance: unknown): IAiVisionDescriptor {
    return {
        kind: "Process",
        summary: "Spawn and manage child processes.",
        members: PROCESS_MEMBERS,
        help: "Use execute only when running an external process with the user's privileges is intended. Through call, execute(command, options) returns { jobId }; its script-only handle members (on, getText, getJson, getBytes, write, endStdin, kill) are not available there. Use script.execute when the script needs to work with the handle.",
        summarize: () => ({ kind: "Process" }),
    };
}
