import type { IpcMainEvent } from "electron";
import { BOARD_CDP_TAB, Endpoint, type BoardLogLevel } from "../api-types";
import type {
    BoardArchiveDownloadRequest,
    PublishedBoardsResult,
    PublishedBoardVersions,
} from "../api-param-types";
import type { BoardThemePalette } from "../board-bridge-channels";
import type { BoardServiceStatus, ModuleServicePortResult } from "../module-service-channels";
import { bindEndpoint } from "./endpoint-registry";
import { errMessage } from "../../shared/utils";
import { boardPermissionError } from "../../shared/board-manifest-utils";

export type BoardEndpoint =
    | Endpoint.registerBoard
    | Endpoint.appendBoardLog
    | Endpoint.getBoardLogPath
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
    | Endpoint.registerBoardPipeResource
    | Endpoint.unregisterBoardPipeResource
    | Endpoint.getPublishedBoards
    | Endpoint.getBoardVersions
    | Endpoint.downloadBoardArchive
    | Endpoint.cancelBoardDownload
    | Endpoint.setBoardTrust
    | Endpoint.getBoardTrustPaths
    | Endpoint.getBoardPermissionGrants
    | Endpoint.getBoardMcpEndpoint
    | Endpoint.authorizeBoardFilePath
    | Endpoint.bindBoardSessionSource
    | Endpoint.setDisabledBundledBoards
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
    bindEndpoint(Endpoint.appendBoardLog, async (_event, boardRoot: string, level: BoardLogLevel, message: string): Promise<void> => {
        try {
            await (await import("../../main/board-log")).append(boardRoot, level, message);
        } catch (error) {
            console.warn(`Failed to append board log: ${errMessage(error)}`);
        }
    });
    bindEndpoint(Endpoint.getBoardLogPath, async (_event, boardRoot: string): Promise<string> => {
        return (await import("../../main/board-log")).getBoardLogPath(boardRoot);
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
    bindEndpoint(Endpoint.setBoardTrust, async (_event, boardRoot: string, trusted: boolean, expectedPermissions?: import("../../shared/board-manifest-utils").NormalizedBoardPermissions): Promise<string[]> => {
        return (await import("../../main/board-trust-service")).boardTrustService.setTrust(boardRoot, trusted, expectedPermissions);
    });
    bindEndpoint(Endpoint.getBoardTrustPaths, async (): Promise<string[]> => {
        return (await import("../../main/board-trust-service")).boardTrustService.getPaths();
    });
    bindEndpoint(Endpoint.getBoardPermissionGrants, async (): Promise<import("../module-service-channels").TrustedBoardSnapshotEntry[]> => {
        const grants = await (await import("../../main/board-trust-service")).boardTrustService.getPermissionGrants();
        return grants.map(({ root, permissions, manifestPermissions, manifestChanged }) => ({
            boardRoot: root,
            permissions,
            manifestPermissions,
            ...(manifestChanged ? { manifestChanged: true } : {}),
            canStartService: permissions.kind === "legacy" ? permissions.service : permissions.flags.service,
        }));
    });
    bindEndpoint(Endpoint.getBoardMcpEndpoint, async (): Promise<string> => {
        return (await import("../../main/mcp-http-server")).getMcpUrl();
    });
    bindEndpoint(Endpoint.authorizeBoardFilePath, async (_event, boardRoot: string, requestedPath: string, intent: "read" | "write" = "read"): Promise<string> => {
        const { boardTrustService } = await import("../../main/board-trust-service");
        const permissions = await boardTrustService.getGrantedPermissions(boardRoot);
        if (!permissions) throw boardPermissionError("fileSystem");
        return (await import("../../main/board-file-access")).resolveAuthorizedPath({
            boardRoot, requestedPath, permissions, intent,
        });
    });
    bindEndpoint(Endpoint.bindBoardSessionSource, async (_event, handle: string, boardRoot: string): Promise<string> => {
        const { boardTrustService } = await import("../../main/board-trust-service");
        const permissions = await boardTrustService.getGrantedPermissions(boardRoot);
        if (!permissions) throw new Error("This board is not trusted.");
        const mcpUrl = await (await import("../../main/mcp-http-server")).getMcpUrl();
        return (await import("../../main/session-src-protocol")).bindSessionSourceToBoard(handle, boardRoot, permissions, mcpUrl);
    });
    bindEndpoint(Endpoint.setDisabledBundledBoards, async (_event, ids: string[]): Promise<void> => {
        await (await import("../../main/board-trust-service")).boardTrustService.setDisabledBundledBoards(ids);
    });
    bindEndpoint(Endpoint.getModuleServiceStatuses, async (): Promise<BoardServiceStatus[]> => {
        return (await import("../../main/module-service-supervisor")).moduleServiceSupervisor.getStatuses();
    });
    bindEndpoint(Endpoint.requestModuleServicePort, async (event: IpcMainEvent, boardRoot: string): Promise<ModuleServicePortResult> => {
        try {
            await (await import("../../main/module-service-supervisor")).moduleServiceSupervisor.transferRendererPort(
                boardRoot,
                event.sender,
            );
            return { ok: true };
        } catch (error) {
            const candidate = error as { code?: unknown };
            const isServiceError = (error as { name?: unknown } | null)?.name === "ServiceError";
            return {
                ok: false,
                error: {
                    code: isServiceError && typeof candidate?.code === "string" && candidate.code.length > 0
                        ? candidate.code
                        : "service-error",
                    message: errMessage(error, "Service port acquisition failed"),
                },
            };
        }
    });
    bindEndpoint(Endpoint.requestModuleService, async (_event, boardRoot: string, message: unknown): Promise<unknown> => {
        const { moduleServiceSupervisor } = await import("../../main/module-service-supervisor");
        const requestId = `main-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
        return moduleServiceSupervisor.request(boardRoot, requestId, message);
    });
    bindEndpoint(Endpoint.startModuleService, async (_event, boardRoot: string): Promise<void> => {
        await (await import("../../main/module-service-supervisor")).moduleServiceSupervisor.start(boardRoot, "explicit");
    });
    bindEndpoint(Endpoint.stopModuleService, async (_event, boardRoot: string): Promise<void> => {
        await (await import("../../main/module-service-supervisor")).moduleServiceSupervisor.stop(boardRoot, "explicit");
    });
}
