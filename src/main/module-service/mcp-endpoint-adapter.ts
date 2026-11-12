import type { ServiceMainMessage, ServiceParentMessage } from "../../ipc/module-service-channels";
import { ServiceError, type ServiceRecord } from "./record";
import { errMessage } from "../../shared/utils";
import type { ModuleServiceProcess } from "./process";

export interface McpEndpointAdapterContext {
    isRunningAndTrusted(record: ServiceRecord): boolean;
    appScriptingAllowed(record: ServiceRecord): boolean;
    issue(boardRoot: string): Promise<{ url: string; headers: { Authorization: string }; token: string }>;
    revoke(boardRoot: string, token?: string): Promise<void>;
}

type McpEndpointRequest = Extract<ServiceMainMessage, { kind: "mcp-endpoint-request" }>;

export class ServiceMcpEndpointAdapter {
    constructor(private readonly context: McpEndpointAdapterContext) {}

    handle(record: ServiceRecord, process: ModuleServiceProcess, message: McpEndpointRequest): void {
        void this.handleRequest(record, process, message);
    }

    private async handleRequest(record: ServiceRecord, process: ModuleServiceProcess, message: McpEndpointRequest): Promise<void> {
        try {
            if (record.current !== process || record.state !== "running" || record.stopRequested) throw new ServiceError("service-exited");
            if (!this.context.isRunningAndTrusted(record)) throw new ServiceError("untrusted");
            if (!this.context.appScriptingAllowed(record)) throw new ServiceError("permission-denied");
            let result: unknown;
            if (message.operation === "issue") {
                const issued = await this.context.issue(record.boardRoot);
                if (record.current !== process || record.state !== "running" || record.stopRequested
                    || !this.context.isRunningAndTrusted(record) || !this.context.appScriptingAllowed(record)) {
                    await this.context.revoke(record.boardRoot, issued.token);
                    throw new ServiceError("permission-denied");
                }
                result = issued;
            } else if (typeof message.token === "string") {
                await this.context.revoke(record.boardRoot, message.token);
            }
            process.postMessage({ kind: "mcp-endpoint-response", requestId: message.requestId, result } satisfies ServiceParentMessage);
        } catch (error: unknown) {
            const serviceError = error instanceof ServiceError ? error : new ServiceError("service-error", errMessage(error, "service-error"));
            try {
                process.postMessage({ kind: "mcp-endpoint-response", requestId: message.requestId,
                    error: { code: serviceError.code, message: serviceError.message } } satisfies ServiceParentMessage);
            } catch { /* Service exited before the reply. */ }
        }
    }
}
