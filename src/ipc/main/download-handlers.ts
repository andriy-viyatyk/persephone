import type { IpcMainEvent } from "electron";
import { downloadService } from "../../main/download-service";
import type { DownloadsApi } from "../contracts/downloads";
import { bindDomain } from "./endpoint-registry";

export function initDownloadHandlers(): void {
    bindDomain<DownloadsApi>({
        getDownloads: async () => downloadService.getDownloads(),
        cancelDownload: async (_event: IpcMainEvent, id: string) => downloadService.cancelDownload(id),
        openDownload: async (_event: IpcMainEvent, id: string) => downloadService.openDownload(id),
        showDownloadInFolder: async (_event: IpcMainEvent, id: string) => downloadService.showInFolder(id),
        clearCompletedDownloads: async () => downloadService.clearCompleted()
    });
}


