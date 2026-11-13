import { MessageChannelMain, type MessagePortMain, type WebContents } from "electron";
import {
    LEASE_LOST_CODE,
    SERVICE_RENDERER_LEASE_TIMEOUT_MS,
    type RendererLeaseLostReason,
    type ServiceParentMessage,
} from "../../ipc/module-service-channels";
import { errMessage } from "../../shared/utils";
import { ServiceError, type RendererLease, type ServiceRecord } from "./record";
import { onWebContentsGone } from "../webcontents-lifetime";
import type { ModuleServiceProcess } from "./process";

export interface LeaseCallbacks {
    getProcess: (record: ServiceRecord) => ModuleServiceProcess | undefined;
    postMessage: (process: ModuleServiceProcess, message: ServiceParentMessage, ports?: MessagePortMain[]) => void;
}

export async function transferRendererLease(
    record: ServiceRecord,
    target: WebContents,
    callbacks: LeaseCallbacks,
): Promise<void> {
    const process = callbacks.getProcess(record);
    if (!process || record.state !== "running") throw new ServiceError("service-exited");

    const oldLease = record.leases.get(target.id);
    if (oldLease) failLease(record, oldLease, "superseded", callbacks, process);

    const { port1, port2 } = new MessageChannelMain();
    const generation = process.generation;
    const leaseNonce = `${generation}:${++record.leaseCounter}`;
    let lease: RendererLease;
    const leasePromise = new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
            if (record.leases.get(target.id) !== lease) return;
            failLease(record, lease, "renderer-port-attach-failed", callbacks);
        }, SERVICE_RENDERER_LEASE_TIMEOUT_MS);
        lease = {
            state: "attaching",
            ownerId: target.id,
            owner: target,
            generation,
            leaseNonce,
            rendererPort: port1,
            transferred: false,
            timer,
            resolve,
            reject,
        };
        record.leases.set(target.id, lease);
        listenForLeaseLifecycle(record, lease, callbacks);
    });

    try {
        callbacks.postMessage(
            process,
            { kind: "attach-renderer", generation, leaseNonce } satisfies ServiceParentMessage,
            [port2],
        );
        if (target.isDestroyed()) throw new ServiceError("renderer-port-attach-failed");
        target.postMessage(
            "eModuleServicePort",
            { boardRoot: record.boardRoot, generation, leaseNonce },
            [port1],
        );
        if (record.leases.get(target.id) === lease) lease.transferred = true;
    } catch (error) {
        if (record.leases.get(target.id) === lease) {
            failLease(record, lease, "renderer-port-attach-failed", callbacks);
        }
        throw new ServiceError("renderer-port-attach-failed", errMessage(error));
    }

    return leasePromise;
}

export function acknowledgeRendererLease(
    record: ServiceRecord,
    generation: number,
    leaseNonce: string,
): void {
    const lease = [...record.leases.values()].find((candidate) =>
        candidate.state === "attaching"
        && candidate.generation === generation
        && candidate.leaseNonce === leaseNonce,
    );
    if (!lease) return;
    clearTimeout(lease.timer);
    lease.state = "attached";
    lease.resolve();
}

export function failLease(
    record: ServiceRecord,
    lease: RendererLease,
    reason: RendererLeaseLostReason,
    callbacks: LeaseCallbacks,
    process: ModuleServiceProcess | undefined = callbacks.getProcess(record),
): void {
    if (record.leases.get(lease.ownerId) !== lease) return;
    clearTimeout(lease.timer);
    lease.state = "lost";
    record.leases.delete(lease.ownerId);
    removeLeaseLifecycleListeners(lease);
    if (process) {
        try {
            callbacks.postMessage(process, {
                kind: "drop-renderer",
                generation: lease.generation,
                leaseNonce: lease.leaseNonce,
                reason,
            } satisfies ServiceParentMessage);
        } catch {
            // The host may already have exited; its peer close notifies the renderer.
        }
    }
    if (!lease.transferred) {
        try {
            lease.rendererPort.close();
        } catch {
            // Already closed locally.
        }
    }
    const code = reason === "renderer-port-attach-failed"
        ? reason
        : LEASE_LOST_CODE[reason];
    lease.reject(new ServiceError(code));
}

function listenForLeaseLifecycle(record: ServiceRecord, lease: RendererLease, callbacks: LeaseCallbacks): void {
    const release = (reason: RendererLeaseLostReason): void => {
        if (record.leases.get(lease.ownerId) === lease) failLease(record, lease, reason, callbacks);
    };
    lease.stopLifecycle = onWebContentsGone(
        lease.owner,
        (event) => release(event === "did-navigate" ? "superseded" : "service-exited"),
        { repeat: true },
    );
}

function removeLeaseLifecycleListeners(lease: RendererLease): void {
    lease.stopLifecycle?.();
    lease.stopLifecycle = undefined;
}
