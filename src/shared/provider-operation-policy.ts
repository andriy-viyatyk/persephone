import { CAPABILITY_DEFAULT_TIMEOUT_MS } from "./capability-limits";

export type ProviderOperation =
    | "readBinary"
    | "readRange"
    | "writeBinary"
    | "stat"
    | "watchSubscribe"
    | "watchUnsubscribe"
    | "statusSubscribe"
    | "statusUnsubscribe";

export interface ProviderOperationPolicy {
    /** End-to-end deadline, owned by the renderer client (`module-service.request`); absent =
     *  unbounded, released only by cancellation. The host runs no provider timer. */
    readonly deadlineMs?: number;
    /** `content-read` is exempt from MAX_OUTSTANDING_REQUESTS_PER_SERVICE and counted as an
     *  outstanding content read; `control` competes for that cap. */
    readonly requestClass: "content-read" | "control";
}

/** Single owner for provider dispatch classification shared by main and utility processes. */
export const PROVIDER_OPERATION_POLICY: Readonly<Record<ProviderOperation, ProviderOperationPolicy>> = {
    readBinary: { requestClass: "content-read" },
    readRange: { requestClass: "content-read" },
    writeBinary: { deadlineMs: CAPABILITY_DEFAULT_TIMEOUT_MS, requestClass: "control" },
    stat: { requestClass: "control" },
    watchSubscribe: { deadlineMs: CAPABILITY_DEFAULT_TIMEOUT_MS, requestClass: "control" },
    watchUnsubscribe: { deadlineMs: CAPABILITY_DEFAULT_TIMEOUT_MS, requestClass: "control" },
    statusSubscribe: { deadlineMs: CAPABILITY_DEFAULT_TIMEOUT_MS, requestClass: "control" },
    statusUnsubscribe: { deadlineMs: CAPABILITY_DEFAULT_TIMEOUT_MS, requestClass: "control" },
};
