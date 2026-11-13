import { WorkerChannel } from "../worker-channels";
import type { IpcMainEvent } from "electron";
import * as workerHost from "../../main/worker-host";
import { guardedIpcOn } from "../../main/ipc-sender-guard";

export function initWorkerHandlers(): void {
    guardedIpcOn(WorkerChannel.start, (event: IpcMainEvent, message: Parameters<typeof workerHost.start>[1]) => workerHost.start(event, message));
    guardedIpcOn(WorkerChannel.proxyResult, (_event, message: Parameters<typeof workerHost.acceptProxyResult>[0]) => workerHost.acceptProxyResult(message));
}
