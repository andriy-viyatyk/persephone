import type { CapabilityClientResult } from "../../ipc/capability-bus-channels";
import { MAX_OUTSTANDING_REQUESTS_PER_SERVICE, type ServiceMainMessage, type ServiceParentMessage, type StartResult } from "../../ipc/module-service-channels";
import type { CapabilityJson } from "../../shared/capability-contract";
import type { CapabilityCaller } from "../capability-router";
import { CapabilityClient } from "../capability-client";
import { ServiceError, type ServiceRecord } from "./record";
import type { ModuleServiceProcess } from "./process";

export interface CapabilityClientAdapterContext {
    start(record: ServiceRecord, mode: "request"): Promise<StartResult>;
    getCurrentProcess(record: ServiceRecord): ModuleServiceProcess | undefined;
    callerFor(record: ServiceRecord): CapabilityCaller;
}

type CapabilityClientRequest = Extract<ServiceMainMessage, { kind: "capability-client-discover" | "capability-client-resolve" | "capability-client-invoke" | "capability-client-cancel" }>;
interface PendingCapabilityRequest {
    record: ServiceRecord;
    process?: ModuleServiceProcess;
    reject(error: unknown): void;
    resolve(value: unknown): void;
}

export class ServiceCapabilityClientAdapter {
    private readonly requests = new Map<string, PendingCapabilityRequest>();
    private readonly clients = new WeakMap<ServiceRecord, CapabilityClient>();

    constructor(private readonly context: CapabilityClientAdapterContext) {}

    call(record: ServiceRecord, message: Extract<ServiceParentMessage, { kind: "capability-call" }>, signal: AbortSignal,
        reauthorize: () => void): Promise<unknown> {
        reauthorize();
        if (record.pendingRequestSlots + record.requests.size >= MAX_OUTSTANDING_REQUESTS_PER_SERVICE) throw new ServiceError("busy");
        if (signal.aborted) throw signal.reason;
        record.pendingRequestSlots++;
        return new Promise((resolve, reject) => {
            let settled = false;
            const finish = (error?: unknown, result?: unknown): void => {
                if (settled) return;
                settled = true;
                signal.removeEventListener("abort", abort);
                this.requests.delete(message.requestId);
                record.pendingRequestSlots--;
                if (error !== undefined) reject(error); else resolve(result);
            };
            const pending: PendingCapabilityRequest = { record, reject: (error) => finish(error), resolve: (result) => finish(undefined, result) };
            const abort = (): void => {
                if (pending.process && record.current === pending.process) {
                    const reason = (signal.reason as { code?: string } | undefined)?.code;
                    try { pending.process.postMessage({ kind: "capability-cancel", requestId: message.requestId,
                        reason: reason === "timeout" || reason === "untrusted" ? reason : "cancelled" } satisfies ServiceParentMessage); }
                    catch { /* Service exited. */ }
                }
                finish(signal.reason ?? new ServiceError("cancelled"));
            };
            this.requests.set(message.requestId, pending);
            signal.addEventListener("abort", abort, { once: true });
            void (async () => {
                try {
                    await this.context.start(record, "request");
                    if (settled) return;
                    reauthorize();
                    const process = this.context.getCurrentProcess(record);
                    if (!process || record.state !== "running") throw new ServiceError("handler-closed");
                    pending.process = process;
                    process.postMessage(message);
                } catch (error: unknown) { finish(error); }
            })();
        });
    }

    handleClient(record: ServiceRecord, process: ModuleServiceProcess, message: CapabilityClientRequest): void {
        if (record.current !== process || record.stopRequested) return;
        void this.handleClientRequest(record, process, message);
    }

    handleResult(record: ServiceRecord, process: ModuleServiceProcess,
        message: Extract<ServiceMainMessage, { kind: "capability-result" }>): void {
        const pending = this.requests.get(message.requestId);
        if (!pending || pending.record !== record || pending.process !== process || record.current !== process) return;
        if ("error" in message) {
            const error = message.error;
            if (!error || typeof error.code !== "string" || typeof error.message !== "string") pending.reject(new ServiceError("rejected"));
            else pending.reject(new ServiceError(error.code, error.message));
        } else pending.resolve(message.result);
    }

    rejectRecord(record: ServiceRecord, code: string): void {
        this.clients.get(record)?.dispose(new ServiceError(code));
        const requestCode = code === "untrusted" ? "untrusted" : code === "service-exited" ? "crashed" : "handler-closed";
        for (const pending of [...this.requests.values()]) if (pending.record === record) pending.reject(new ServiceError(requestCode));
    }

    private async handleClientRequest(record: ServiceRecord, process: ModuleServiceProcess, message: CapabilityClientRequest): Promise<void> {
        const client = this.clientFor(record);
        if (message.kind === "capability-client-cancel") { client.cancel(message.requestId); return; }
        const requestId = message.kind === "capability-client-invoke" ? message.request?.requestId : message.requestId;
        if (typeof requestId !== "string" || !requestId || (message.kind === "capability-client-invoke" && client.isActive(requestId))) return;
        const parentRequestId = message.kind === "capability-client-invoke" ? message.parentRequestId : undefined;
        const result = message.kind === "capability-client-discover"
            ? await (message.id === undefined ? client.list() : client.providers(message.id))
            : message.kind === "capability-client-resolve" ? await client.get(message.id, message.options)
                : await client.invoke(message.request, { methods: "any", channelReply: "none",
                    delivery: (id) => ({ kind: "service", process, requestId: id }),
                    ...(parentRequestId === undefined ? {} : { parent: { requestId: parentRequestId,
                        isActive: () => this.isParentCallActive(record, process, parentRequestId) } }) }) as CapabilityClientResult<CapabilityJson | null>;
        if (record.current === process) {
            try { process.postMessage({ kind: "capability-client-result", requestId, result } satisfies ServiceParentMessage); }
            catch { /* Service exited. */ }
        }
    }

    private clientFor(record: ServiceRecord): CapabilityClient {
        let client = this.clients.get(record);
        if (!client) {
            client = new CapabilityClient({ caller: () => this.context.callerFor(record) });
            this.clients.set(record, client);
        }
        return client;
    }

    private isParentCallActive(record: ServiceRecord, process: ModuleServiceProcess, id: string): boolean {
        const parent = this.requests.get(id);
        return !!parent && parent.record === record && parent.process === process && record.current === process;
    }
}
