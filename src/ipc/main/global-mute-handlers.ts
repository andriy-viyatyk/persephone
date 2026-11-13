import { GLOBAL_MUTE_RELEASE_ALL, GLOBAL_MUTE_SNAPSHOT } from "../global-mute-channels";
import { globalMuteService } from "../../main/global-mute-service";
import { guardedIpcHandle } from "../../main/ipc-sender-guard";

export function initGlobalMuteHandlers(): void {
    guardedIpcHandle(GLOBAL_MUTE_SNAPSHOT, () => globalMuteService.snapshot());
    guardedIpcHandle(GLOBAL_MUTE_RELEASE_ALL, () => globalMuteService.releaseAllAndSnapshot());
}
