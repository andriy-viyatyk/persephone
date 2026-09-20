import type { IpcMainEvent } from "electron";
import {
    BOARD_PIPE_REPLY_CHANNEL,
    type BoardPipeReadReply,
} from "../board-pipe-channels";
import { Endpoint } from "../api-types";
import { boardPipeService } from "../../main/board-pipe-service";
import { bindEndpoint } from "./endpoint-registry";
import { ipcMain } from "electron";

export function initBoardPipeHandlers(): void {
    bindEndpoint(
        Endpoint.registerBoardPipePage,
        async (event: IpcMainEvent, pageId: string, host?: string): Promise<void> => {
            boardPipeService.registerPage(pageId, event.sender, host);
        },
    );
    bindEndpoint(
        Endpoint.unregisterBoardPipePage,
        async (event: IpcMainEvent, pageId: string): Promise<void> => {
            boardPipeService.unregisterPage(pageId, event.sender);
        },
    );
    ipcMain.on(BOARD_PIPE_REPLY_CHANNEL, (event, reply: BoardPipeReadReply) => {
        boardPipeService.handleReply(event.sender, reply);
    });
}
