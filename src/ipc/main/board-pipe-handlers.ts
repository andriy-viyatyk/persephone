import type { IpcMainEvent } from "electron";
import {
    BOARD_PIPE_REPLY_CHANNEL,
    type BoardPipeReadReply,
} from "../board-pipe-channels";
import { Endpoint } from "../api-types";
import { boardPipeService } from "../../main/board-pipe-service";
import { guardedIpcOn } from "../../main/ipc-sender-guard";
import { bindEndpoint } from "./endpoint-registry";

export function initBoardPipeHandlers(): void {
    bindEndpoint(
        Endpoint.registerBoardPipePage,
        async (event: IpcMainEvent, pageId: string, host?: string, boardRoot?: string, hostedDocument = false): Promise<void> => {
            if (hostedDocument && !boardRoot) throw new Error("A hosted document pipe requires its host-owned board root.");
            if (boardRoot) {
                const registeredRoot = host ? (await import("../../main/board-protocol-service")).getBoardRootForHost(host) : undefined;
                if (registeredRoot !== boardRoot) throw new Error("The board pipe host does not own this board root.");
                const permissions = await (await import("../../main/board-trust-service")).boardTrustService.getGrantedPermissions(boardRoot);
                if (!permissions) throw new Error("This board is not trusted.");
            }
            boardPipeService.registerPage(pageId, event.sender, host, boardRoot, hostedDocument);
        },
    );
    bindEndpoint(
        Endpoint.unregisterBoardPipePage,
        async (event: IpcMainEvent, pageId: string): Promise<void> => {
            boardPipeService.unregisterPage(pageId, event.sender);
        },
    );
    bindEndpoint(
        Endpoint.registerBoardPipeResource,
        async (event: IpcMainEvent, resourceId: string, host: string, boardRoot?: string, filePath?: string): Promise<void> => {
            if (filePath !== undefined && (typeof filePath !== "string" || typeof boardRoot !== "string" || boardRoot.length === 0)) {
                throw new Error("A board file pipe requires its host-owned board root.");
            }
            if (boardRoot) {
                const registeredRoot = (await import("../../main/board-protocol-service")).getBoardRootForHost(host);
                if (registeredRoot !== boardRoot) throw new Error("The board pipe host does not own this board root.");
                const { boardTrustService } = await import("../../main/board-trust-service");
                const permissions = await boardTrustService.getGrantedPermissions(boardRoot);
                if (!permissions) throw new Error("This board is not trusted.");
                if (filePath !== undefined) {
                    await (await import("../../main/board-file-access")).resolveAuthorizedPath({
                        boardRoot, requestedPath: filePath, permissions, intent: "read",
                    });
                }
            }
            boardPipeService.registerResource(resourceId, event.sender, host, boardRoot, filePath);
        },
    );
    bindEndpoint(
        Endpoint.unregisterBoardPipeResource,
        async (event: IpcMainEvent, resourceId: string): Promise<void> => {
            boardPipeService.unregisterResource(resourceId, event.sender);
        },
    );
    guardedIpcOn(BOARD_PIPE_REPLY_CHANNEL, (event, reply: BoardPipeReadReply) => {
        boardPipeService.handleReply(event.sender, reply);
    });
}
