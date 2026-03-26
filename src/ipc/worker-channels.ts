/** IPC channels for the async worker system. */
export enum WorkerChannel {
    start = "worker:start",
    result = "worker:result",
    error = "worker:error",
    proxyCall = "worker:proxy-call",
    proxySet = "worker:proxy-set",
    proxyResult = "worker:proxy-result",
}
