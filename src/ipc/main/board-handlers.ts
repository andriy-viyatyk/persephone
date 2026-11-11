import { BrowserWindow, type IpcMainEvent } from "electron";
import { BOARD_CDP_TAB, Endpoint, type BoardLogLevel, type HostServiceChannelRequest } from "../api-types";
import type {
    BoardArchiveDownloadRequest,
    PublishedBoardsResult,
    PublishedBoardVersions,
} from "../api-param-types";
import type { BoardHostText, BoardI18nContext, BoardThemePalette } from "../board-bridge-channels";
import type { BoardSnapshot } from "../board-snapshot-channels";
import type { BoardServiceStatus, ModuleServicePortResult } from "../module-service-channels";
import { bindEndpoint } from "./endpoint-registry";
import { capabilityClientForWindow } from "../../main/capability-client";
import { errMessage } from "../../shared/utils";

export type BoardEndpoint =
    | Endpoint.connectHostServiceChannel
    | Endpoint.insertVoiceTypingText
    | Endpoint.registerBoard
    | Endpoint.appendBoardLog
    | Endpoint.getBoardLogPath
    | Endpoint.getBoardStorageKey
    | Endpoint.unregisterBoard
    | Endpoint.updateBoardTheme
    | Endpoint.requestBoardPort
    | Endpoint.updateBoardHostedPath
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
    | Endpoint.getBoardSnapshot
    | Endpoint.getBoardServiceProviders
    | Endpoint.revokeBoardFileAccessGrant
    | Endpoint.grantBoardSourceReads
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
    bindEndpoint(Endpoint.registerBoard, async (event: IpcMainEvent, boardRoot: string, theme: BoardThemePalette, tokens: Record<string, string>, i18n: BoardI18nContext, hostText: BoardHostText): Promise<string> => {
        const { registerBoard } = await import("../../main/board-protocol-service");
        let hostOrigin = "";
        try {
            hostOrigin = new URL(event.sender.getURL()).origin;
        } catch {
            // Leave empty: the shim falls back to its parent-frame check.
        }
        const host = registerBoard(boardRoot, theme, tokens, i18n, hostText, hostOrigin);
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
    bindEndpoint(Endpoint.getBoardStorageKey, async (_event, boardRoot: string): Promise<string> => {
        return (await import("../../main/board-storage")).getBoardStorageKey(boardRoot);
    });
    bindEndpoint(Endpoint.unregisterBoard, async (_event, host: string): Promise<void> => {
        (await import("../../main/board-protocol-service")).unregisterBoard(host);
    });
    bindEndpoint(Endpoint.updateBoardTheme, async (_event, theme: BoardThemePalette): Promise<void> => {
        (await import("../../main/board-protocol-service")).updateAllBoardThemes(theme);
        (await import("../../main/board-bridge")).pushThemeToBoards(theme);
    });
    bindEndpoint(Endpoint.requestBoardPort, async (event: IpcMainEvent, boardId: string, host: string, ownerId: string, hostedPath: string | null, token: string): Promise<void> => {
        (await import("../../main/board-bridge")).createBoardPort(event.sender, boardId, host, ownerId, hostedPath, token);
    });
    bindEndpoint(Endpoint.updateBoardHostedPath, async (event: IpcMainEvent, boardId: string, token: string, hostedPath: string | null): Promise<boolean> => {
        return (await import("../../main/board-bridge")).updateBoardHostedPath(event.sender, boardId, token, hostedPath);
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
    bindEndpoint(Endpoint.registerBoardFrame, async (event: IpcMainEvent, boardId: string, boardHost: string, frameNonce?: string, tab: string = BOARD_CDP_TAB, title?: string, pageId?: string): Promise<void> => {
        (await import("../../main/cdp-service")).registerBoardFrame(`${boardId}/${tab}`, event.sender, boardHost, frameNonce, title, pageId);
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
    bindEndpoint(Endpoint.setBoardTrust, async (_event, boardRoot: string, trusted: boolean, expectedPermissions?: import("../../shared/board/board-permissions").NormalizedBoardPermissions, expectedUses?: import("../../shared/board/board-service-declarations").BoardServiceUseDeclaration[]): Promise<string[]> => {
        return (await import("../../main/board-trust-service")).boardTrustService.setTrust(boardRoot, trusted, expectedPermissions, expectedUses);
    });
    bindEndpoint(Endpoint.getBoardSnapshot, async (): Promise<BoardSnapshot> => {
        // refresh() re-reads manifests (agents edit them on disk) and republishes; an unchanged result keeps its revision.
        await (await import("../../main/board-trust-service")).boardTrustService.refresh();
        return (await import("../../main/board-snapshot-broadcaster")).boardSnapshotBroadcaster.current();
    });
    bindEndpoint(Endpoint.getBoardServiceProviders, async (_event, interfaceId: string): Promise<import("../board-bridge-channels").BoardServiceProvider[]> => {
        if (typeof interfaceId !== "string") throw new TypeError("A service interface id is required.");
        const trust = (await import("../../main/board-trust-service")).boardTrustService;
        await trust.refresh();
        return (await import("../../main/module-service-supervisor")).moduleServiceSupervisor.listServiceProviders(interfaceId);
    });
    bindEndpoint(Endpoint.connectHostServiceChannel, async (event: IpcMainEvent, request: HostServiceChannelRequest): Promise<string> => {
        if (event.senderFrame !== event.sender.mainFrame) throw new Error("permission-denied");
        const window = BrowserWindow.fromWebContents(event.sender);
        if (!window || !(await import("../../main/open-windows")).openWindows.findByWindow(window)) throw new Error("permission-denied");
        if (request && "kind" in request) {
            const opened = await capabilityClientForWindow(event.sender).invoke(request.kind === "capability" ? request.request : undefined,
                { methods: "channel", agentCallers: false, delivery: () => ({ kind: "renderer" as const, webContents: event.sender }) });
            return JSON.stringify(opened.ok ? { ok: true, value: opened.value.channelId } : opened);
        }
        if (!request || !("interfaceId" in request) || typeof request.interfaceId !== "string" || typeof request.provider !== "string" || request.version !== 1) throw new TypeError("Invalid host service selector.");
        return (await import("../../main/module-service-supervisor")).moduleServiceSupervisor.connectHostServiceChannel(event.sender, request, request.openMessage);
    });
    bindEndpoint(Endpoint.insertVoiceTypingText, async (event: IpcMainEvent, request: { sessionId: string; text: string; deferClipboard?: boolean }): Promise<{ copied: boolean }> => {
        if (event.senderFrame !== event.sender.mainFrame) throw new Error("permission-denied");
        const window = BrowserWindow.fromWebContents(event.sender);
        const openWindow = window && (await import("../../main/open-windows")).openWindows.findByWindow(window);
        if (!openWindow) throw new Error("permission-denied");
        if (!request || typeof request.sessionId !== "string" || typeof request.text !== "string") throw new TypeError("Invalid voice typing result.");
        return openWindow.insertVoiceTypingText(request.sessionId, request.text, request.deferClipboard);
    });
    bindEndpoint(Endpoint.revokeBoardFileAccessGrant, async (_event: IpcMainEvent, boardRoot: string, kind: "folder" | "file", canonicalPath: string): Promise<void> => {
        if (kind !== "folder" && kind !== "file") throw new TypeError("Invalid board file-access grant kind.");
        await (await import("../../main/board-file-access")).boardFileAccess.revoke(boardRoot, kind, canonicalPath);
    });
    bindEndpoint(Endpoint.grantBoardSourceReads, async (_event: IpcMainEvent, boardRoot: string, sourcePaths: string[], contextPaths: string[] = []): Promise<void> => {
        await (await import("../../main/board-file-access")).boardFileAccess.grantSourceReads(boardRoot, sourcePaths, contextPaths);
    });
    bindEndpoint(Endpoint.getBoardMcpEndpoint, async (): Promise<string> => {
        return (await import("../../main/mcp-http-server")).getMcpUrl();
    });
    bindEndpoint(Endpoint.authorizeBoardFilePath, async (_event, boardRoot: string, requestedPath: string, intent: "read" | "write" = "read"): Promise<string> => {
        return (await import("../../main/board-file-access")).boardFileAccess.authorize(boardRoot, requestedPath, intent);
    });
    bindEndpoint(Endpoint.bindBoardSessionSource, async (_event, handle: string, boardRoot: string): Promise<string> => {
        const { boardTrustService } = await import("../../main/board-trust-service");
        const grant = await boardTrustService.getGrant(boardRoot);
        if (!grant) throw new Error("This board is not trusted.");
        const mcpUrl = await (await import("../../main/mcp-http-server")).getMcpUrl();
        return (await import("../../main/session-src-protocol")).bindSessionSourceToBoard(handle, boardRoot, grant, mcpUrl);
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
