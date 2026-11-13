import { TorChannel } from "../tor-ipc";
import { torService } from "../../main/tor-service";
import { guardedIpcHandle, guardedIpcOn } from "../../main/ipc-sender-guard";

export function initTorHandlers(): void {
    guardedIpcHandle(TorChannel.arm, (_event, socksPort: number, partition: string) => torService.armPartition(socksPort, partition));
    guardedIpcHandle(TorChannel.start, (_event, torExePath: string, socksPort: number, partition: string) => torService.startForPartition(torExePath, socksPort, partition));
    guardedIpcHandle(TorChannel.fetchAcquire, (event, torExePath: string, socksPort: number) => torService.acquireFetchForSender(event.sender, torExePath, socksPort));
    guardedIpcOn(TorChannel.fetchRelease, event => torService.releaseFetchForSender(event.sender));
    guardedIpcHandle(TorChannel.stop, (_event, partition: string) => torService.stopForPartition(partition));
    guardedIpcHandle(TorChannel.checkIp, (_event, partition: string) => torService.checkIp(partition));
    guardedIpcHandle(TorChannel.restart, (_event, partition: string) => torService.restart(partition));
}
