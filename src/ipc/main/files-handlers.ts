import { app, BrowserWindow, shell, IpcMainEvent } from "electron";
import { CommonFolder, OpenFileDialogParams, SaveFileDialogParams } from "../api-param-types";
import { showOpenFileDialog, showOpenFolderDialog, showSaveFileDialog } from "../../main/native-dialogs";
import { fileIconCache } from "../../main/fileIconCache";
import { getStartupInputs } from "../../main/launch-inputs";
import { openPath as openBoardAwarePath } from "../../main/board-aware-open-path";
import type { FilesApi } from "../contracts/files";
import { bindDomain } from "./endpoint-registry";

export function initFilesHandlers(): void {
    bindDomain<FilesApi>({
        showOpenFileDialog: async (event: IpcMainEvent, params: OpenFileDialogParams) =>
            showOpenFileDialog(BrowserWindow.fromWebContents(event.sender), params),
        showSaveFileDialog: async (event: IpcMainEvent, params: SaveFileDialogParams) =>
            showSaveFileDialog(BrowserWindow.fromWebContents(event.sender), params),
        showOpenFolderDialog: async (event: IpcMainEvent, params: OpenFileDialogParams) =>
            showOpenFolderDialog(BrowserWindow.fromWebContents(event.sender), params),
        getCommonFolder: async (_event: IpcMainEvent, folder: CommonFolder) =>
            app.getPath(folder as Parameters<typeof app.getPath>[0]),
        showItemInFolder: async (_event: IpcMainEvent, path: string) => { shell.showItemInFolder(path); },
        showFolder: async (_event: IpcMainEvent, path: string) => { await shell.openPath(path); },
        openPath: async (_event: IpcMainEvent, path: string, boardRoot?: string) => openBoardAwarePath(path, boardRoot),
        getStartupInputs: async () => getStartupInputs(),
        getFileIcon: async (_event: IpcMainEvent, filePath: string) => fileIconCache.getFileIcon(filePath)
    });
}

