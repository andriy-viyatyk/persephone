import type { IpcMainEvent } from "electron";
import { BOARD_PIPE_REPLY_CHANNEL, type BoardPipeReadReply } from "../board-pipe-channels";
import { boardPipeService } from "../../main/board-pipe-service";
import { guardedIpcOn } from "../../main/ipc-sender-guard";
import { BoardRoot } from "../../shared/board/board-root";
import type { BoardPipesApi } from "../contracts/board-pipes";
import { bindDomain } from "./endpoint-registry";
import { getBoardRootForHost } from "../../main/board-protocol-service";
import { boardTrustService } from "../../main/board-trust-service";
import { boardFileAccess } from "../../main/board-file-access";
export function initBoardPipeHandlers(): void {
    bindDomain<BoardPipesApi>({
        registerBoardPipePage: async (
            event: IpcMainEvent,
            pageId: string,
            host?: string,
            boardRoot?: string,
            hostedDocument = false,
        ): Promise<void> => {
            if (hostedDocument && !boardRoot) {
                throw new Error("A hosted document pipe requires its host-owned board root.");
            }
            if (boardRoot) {
                const registeredRoot = host
                    ? getBoardRootForHost(host)
                    : undefined;
                if (!registeredRoot || !BoardRoot.from(registeredRoot).equals(boardRoot)) {
                    throw new Error("The board pipe host does not own this board root.");
                }
                const permissions = await boardTrustService.getGrant(boardRoot);
                if (!permissions) throw new Error("This board is not trusted.");
            }
            boardPipeService.registerPage(pageId, event.sender, host, boardRoot, hostedDocument);
        },
        unregisterBoardPipePage: async (event: IpcMainEvent, pageId: string): Promise<void> => {
            boardPipeService.unregisterPage(pageId, event.sender);
        },
        registerBoardPipeResource: async (
            event: IpcMainEvent,
            resourceId: string,
            host: string,
            boardRoot?: string,
            filePath?: string,
        ): Promise<void> => {
            if (
                filePath !== undefined &&
                (typeof filePath !== "string" || typeof boardRoot !== "string" || boardRoot.length === 0)
            ) {
                throw new Error("A board file pipe requires its host-owned board root.");
            }
            if (boardRoot) {
                const registeredRoot = getBoardRootForHost(host);
                if (!registeredRoot || !BoardRoot.from(registeredRoot).equals(boardRoot)) {
                    throw new Error("The board pipe host does not own this board root.");
                }
                const permissions = await boardTrustService.getGrant(boardRoot);
                if (!permissions) throw new Error("This board is not trusted.");
                if (filePath !== undefined) {
                    await boardFileAccess.authorize(
                        boardRoot,
                        filePath,
                        "read",
                    );
                }
            }
            boardPipeService.registerResource(resourceId, event.sender, host, boardRoot, filePath);
        },
        unregisterBoardPipeResource: async (event: IpcMainEvent, resourceId: string): Promise<void> => {
            boardPipeService.unregisterResource(resourceId, event.sender);
        }
    });
}

export function initBoardPipeReplyHandler(): void {
    guardedIpcOn(BOARD_PIPE_REPLY_CHANNEL, (event, reply: BoardPipeReadReply) => {
        boardPipeService.handleReply(event.sender, reply);
    });
}
