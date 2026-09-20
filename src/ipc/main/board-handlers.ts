import type { IpcMainEvent } from "electron";
import { BOARD_CDP_TAB, Endpoint } from "../api-types";
import type { BoardArchiveDownloadRequest, PublishedBoardsResult, PublishedBoardVersions } from "../api-param-types";
import type { BoardThemePalette } from "../board-bridge-channels";
import type { BoardServiceStatus, TrustedBoardSnapshot } from "../module-service-channels";
import { bindEndpoint } from "./endpoint-registry";

export type BoardEndpoint =
    | Endpoint.registerBoard
    | Endpoint.unregisterBoard
    | Endpoint.updateBoardTheme
    | Endpoint.requestBoardPort
    | Endpoint.disposeBoardPort
    | Endpoint.setBoardBusy
    | Endpoint.setBoardCallTimeout
    | Endpoint.reapBoardOwner
    | Endpoint.registerBoardFrame
    | Endpoint.unregisterBoardFrame
    | Endpoint.registerBoardPipePage
    | Endpoint.unregisterBoardPipePage
    | Endpoint.getPublishedBoards
    | Endpoint.getBoardVersions
    | Endpoint.downloadBoardArchive
    | Endpoint.cancelBoardDownload
    | Endpoint.syncTrustedBoardSnapshot
    | Endpoint.getModuleServiceStatuses
    | Endpoint.requestModuleServicePort
    | Endpoint.requestModuleService
    | Endpoint.startModuleService
    | Endpoint.stopModuleService;

/** Register Board lifecycle, bridge, automation, and catalog endpoints. Each
 * handler keeps its service dynamic import so Board infrastructure stays lazy. */
export function initBoardHandlers(): void {
    bindEndpoint(Endpoint.registerBoard, async (event: IpcMainEvent, boardRoot: string, theme: BoardThemePalette, tokens: Record<string, string>): Promise<string> => {
        const { registerBoard } = await import("../../main/board-protocol-service");
        let hostOrigin = "";
        try {
            hostOrigin = new URL(event.sender.getURL()).origin;
        } catch {
            // Leave empty: the shim falls back to its parent-frame check.
        }
        const host = registerBoard(boardRoot, theme, tokens, hostOrigin);
        const { ensureHostWired } = await import("../../main/board-bridge");
        ensureHostWired(event.sender);
        return host;
    });
    bindEndpoint(Endpoint.unregisterBoard, async (_event, host: string): Promise<void> => {
        (await import("../../main/board-protocol-service")).unregisterBoard(host);
    });
    bindEndpoint(Endpoint.updateBoardTheme, async (_event, theme: BoardThemePalette): Promise<void> => {
        (await import("../../main/board-protocol-service")).updateAllBoardThemes(theme);
        (await import("../../main/board-bridge")).pushThemeToBoards(theme);
    });
    bindEndpoint(Endpoint.requestBoardPort, async (event: IpcMainEvent, boardId: string, host: string, ownerId: string): Promise<void> => {
        (await import("../../main/board-bridge")).createBoardPort(event.sender, boardId, host, ownerId);
    });
    bindEndpoint(Endpoint.disposeBoardPort, async (_event, boardId: string): Promise<void> => {
        (await import("../../main/board-bridge")).disposeBoardPort(boardId);
    });
    bindEndpoint(Endpoint.setBoardBusy, async (_event, ownerId: string, busy: boolean): Promise<void> => {
        (await import("../../main/board-bridge")).setBoardBusy(ownerId, busy);
    });
    bindEndpoint(Endpoint.setBoardCallTimeout, async (_event, timeoutMs: number): Promise<void> => {
        (await import("../../main/board-bridge")).setBoardCallTimeout(timeoutMs);
    });
    bindEndpoint(Endpoint.reapBoardOwner, async (_event, ownerId: string): Promise<void> => {
        (await import("../../main/board-bridge")).reapBoardOwner(ownerId);
    });
    bindEndpoint(Endpoint.registerBoardFrame, async (event: IpcMainEvent, boardId: string, boardHost: string, frameNonce?: string, tab: string = BOARD_CDP_TAB): Promise<void> => {
        (await import("../../main/cdp-service")).registerBoardFrame(`${boardId}/${tab}`, event.sender, boardHost, frameNonce);
    });
    bindEndpoint(Endpoint.unregisterBoardFrame, async (_event, boardId: string, tab: string = BOARD_CDP_TAB, frameNonce?: string): Promise<void> => {
        (await import("../../main/cdp-service")).unregisterBoardFrame(`${boardId}/${tab}`, frameNonce);
    });
    bindEndpoint(Endpoint.getPublishedBoards, async (_event, force?: boolean): Promise<PublishedBoardsResult> => {
        return (await import("../../main/published-boards-service")).publishedBoardsService.getPublishedBoards(force);
    });
    bindEndpoint(Endpoint.getBoardVersions, async (_event, id: string): Promise<PublishedBoardVersions | null> => {
        return (await import("../../main/published-boards-service")).publishedBoardsService.getBoardVersions(id);
    });
    bindEndpoint(Endpoint.downloadBoardArchive, async (_event, request: BoardArchiveDownloadRequest): Promise<string> => {
        return (await import("../../main/board-download-service")).boardDownloadService.downloadBoardArchive(request);
    });
    bindEndpoint(Endpoint.cancelBoardDownload, async (_event, installId: string): Promise<void> => {
        (await import("../../main/board-download-service")).boardDownloadService.cancelBoardDownload(installId);
    });
    bindEndpoint(Endpoint.syncTrustedBoardSnapshot, async (_event, snapshot: TrustedBoardSnapshot): Promise<void> => {
        (await import("../../main/module-service-supervisor")).moduleServiceSupervisor.syncTrustedBoardSnapshot(snapshot);
    });
    bindEndpoint(Endpoint.getModuleServiceStatuses, async (): Promise<BoardServiceStatus[]> => {
        return (await import("../../main/module-service-supervisor")).moduleServiceSupervisor.getStatuses();
    });
    bindEndpoint(Endpoint.requestModuleServicePort, async (event: IpcMainEvent, boardRoot: string): Promise<void> => {
        await (await import("../../main/module-service-supervisor")).moduleServiceSupervisor.transferRendererPort(
            boardRoot,
            event.sender,
        );
    });
    bindEndpoint(Endpoint.requestModuleService, async (_event, boardRoot: string, message: unknown): Promise<unknown> => {
        const { moduleServiceSupervisor } = await import("../../main/module-service-supervisor");
        const { SERVICE_REQUEST_DEADLINE_MS } = await import("../module-service-channels");
        const requestId = `main-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
        return moduleServiceSupervisor.request(boardRoot, requestId, message, SERVICE_REQUEST_DEADLINE_MS);
    });
    bindEndpoint(Endpoint.startModuleService, async (_event, boardRoot: string): Promise<void> => {
        await (await import("../../main/module-service-supervisor")).moduleServiceSupervisor.start(boardRoot, "explicit");
    });
    bindEndpoint(Endpoint.stopModuleService, async (_event, boardRoot: string): Promise<void> => {
        await (await import("../../main/module-service-supervisor")).moduleServiceSupervisor.stop(boardRoot, "explicit");
    });
}
