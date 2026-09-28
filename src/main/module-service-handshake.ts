import type { UtilityProcess } from "electron";
import type { ServiceMainMessage, ServiceParentMessage } from "../ipc/module-service-channels";
import type { PendingRequest, ServiceRecord } from "./module-service-record";
import { acknowledgeRendererLease } from "./module-service-leases";
import { ServiceError, isCurrent } from "./module-service-record";
import { errMessage } from "../shared/utils";

export class Handshake {
    ready = false;
    probeSent = false;
    settled = false;
    timer: ReturnType<typeof setTimeout> | undefined;

    constructor(readonly nonce: number) {}

    settle(): void {
        this.settled = true;
        if (this.timer) clearTimeout(this.timer);
    }
}

export interface ProcessMessageCallbacks {
    isTrusted: (boardRoot: string) => boolean;
    onStorageRequest: (message: Extract<ServiceMainMessage, { kind: "storage-request" }>) => void;
    onResponse: (pending: PendingRequest, message: Extract<ServiceMainMessage, { kind: "response" }>) => void;
    onReady: (process: UtilityProcess) => void;
    fail: (error: ServiceError) => void;
}

export function routeProcessMessage(
    record: ServiceRecord,
    process: UtilityProcess,
    generation: number,
    rawMessage: unknown,
    handshake: Handshake,
    callbacks: ProcessMessageCallbacks,
): void {
    if (!isCurrent(record, process, generation)) return;
    const message = rawMessage as ServiceMainMessage;
    if (message.kind === "storage-request") {
        callbacks.onStorageRequest(message);
        return;
    }
    if (message.kind === "renderer-attached") {
        acknowledgeRendererLease(record, message.generation, message.leaseNonce);
        return;
    }
    if (message.kind === "response") {
        const pending = record.requests.get(message.requestId);
        if (!pending) return;
        callbacks.onResponse(pending, message);
        return;
    }
    if (handshake.settled) return;
    if (message.kind === "ready" && message.nonce === handshake.nonce) {
        if (handshake.probeSent) return;
        handshake.ready = true;
        handshake.probeSent = true;
        try {
            process.postMessage({ kind: "probe", nonce: handshake.nonce } satisfies ServiceParentMessage);
        } catch (error) {
            callbacks.fail(new ServiceError("port-not-listening", errMessage(error)));
        }
        return;
    }
    if (message.kind === "probe-ack" && message.nonce === handshake.nonce && handshake.ready) {
        if (!callbacks.isTrusted(record.boardRoot)) {
            callbacks.fail(new ServiceError("untrusted"));
            return;
        }
        handshake.settle();
        callbacks.onReady(process);
    }
}
