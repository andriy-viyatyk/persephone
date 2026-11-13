import { BrowserChannel, type NetworkLogOptions } from "../browser-ipc";
import { getNetworkLog } from "../../main/network-logger";
import { guardedIpcHandle } from "../../main/ipc-sender-guard";

export function initNetworkLoggerHandlers(): void {
    guardedIpcHandle(BrowserChannel.getNetworkLog, (_event, key: string, options: NetworkLogOptions = {}) => getNetworkLog(key, options));
}
