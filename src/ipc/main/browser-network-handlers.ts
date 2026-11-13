import { BrowserNetworkChannel } from "../browser-network-ipc";
import { browserNetworkService } from "../../main/browser-network-service";
import { guardedIpcHandle } from "../../main/ipc-sender-guard";
import type { BrowserNetwork } from "../browser-network-ipc";

export function initBrowserNetworkHandlers(): void {
    guardedIpcHandle(BrowserNetworkChannel.apply, (_event, partition: string, network: BrowserNetwork) => browserNetworkService.apply(partition, network));
    guardedIpcHandle(BrowserNetworkChannel.checkIp, (_event, partition: string) => browserNetworkService.checkIp(partition));
    guardedIpcHandle(BrowserNetworkChannel.release, (_event, partition: string) => browserNetworkService.release(partition));
    guardedIpcHandle(BrowserNetworkChannel.sessionSource, (_event, partition: string, url: string) => browserNetworkService.sessionSource(partition, url));
}
