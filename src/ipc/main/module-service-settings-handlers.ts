import { BoardServiceSettingsChannel } from "../board-service-settings-channels";
import { moduleServiceSupervisor } from "../../main/module-service-supervisor";
import { guardedIpcOn } from "../../main/ipc-sender-guard";

export function initModuleServiceSettingsHandlers(): void {
    guardedIpcOn(BoardServiceSettingsChannel.changed, (event, change: { subscriptionId: string; id: string; value: unknown }) =>
        moduleServiceSupervisor.boardSettings.handleChanged(event, change));
}
