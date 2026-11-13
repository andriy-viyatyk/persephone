import { IpcMainEvent } from "electron";
import {
    clearClipboardHistory as clearClipboardHistoryService,
    copyClipboardItem as copyClipboardItemService,
    getClipboardHistory as getClipboardHistoryService,
    getClipboardStatus as getClipboardStatusService,
    removeClipboardItem as removeClipboardItemService,
    restartClipboard as restartClipboardService,
    setClipboardEnabled as setClipboardEnabledService,
    setClipboardHealthMonitoring as setClipboardHealthMonitoringService,
} from "../../main/clipboard-service";
import { writeClipboardPng, writeClipboardText } from "../../main/system-clipboard";
import type { ClipboardApi } from "../contracts/clipboard";
import { bindDomain } from "./endpoint-registry";
import { startScreenSnip } from "../../main/snip-service";
import { readClipboardFiles, writeClipboardFiles } from "../../main/clip-service";
import { startOsFileDrag } from "../../main/os-drag-service";

export function initClipboardHandlers(): void {
    bindDomain<ClipboardApi>({
        setClipboardEnabled: async (_event: IpcMainEvent, enabled: boolean, maxItems: number) =>
            setClipboardEnabledService(enabled, maxItems),
        getClipboardHistory: async () => getClipboardHistoryService(),
        removeClipboardItem: async (_event: IpcMainEvent, id: string) => removeClipboardItemService(id),
        clearClipboardHistory: async () => clearClipboardHistoryService(),
        copyClipboardItem: async (_event: IpcMainEvent, id: string) => copyClipboardItemService(id),
        getClipboardStatus: async () => getClipboardStatusService(),
        setClipboardHealthMonitoring: async (event: IpcMainEvent, active: boolean) =>
            setClipboardHealthMonitoringService(event.sender.id, active),
        restartClipboard: async (_event: IpcMainEvent, maxItems: number) => restartClipboardService(maxItems),
        startScreenSnip: async (_event: IpcMainEvent, hideWindows: boolean) =>
            startScreenSnip(hideWindows),
        clipboardWriteText: async (_event: IpcMainEvent, text: string) => writeClipboardText(text),
        clipboardWritePng: async (_event: IpcMainEvent, bytes: Uint8Array) => writeClipboardPng(bytes),
        clipboardReadFilePaths: async () => readClipboardFiles(),
        clipboardWriteFilePaths: async (_event: IpcMainEvent, paths: string[], cut: boolean) =>
            writeClipboardFiles(paths, cut),
        startOsFileDrag: async (event: IpcMainEvent, paths: string[]) =>
            startOsFileDrag(event.sender, paths),
    });
}

