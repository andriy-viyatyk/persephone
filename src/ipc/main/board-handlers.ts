import { BOARD_CDP_TAB } from "../api-types";
import type { IpcMainEvent } from "electron";
import type { BoardLogLevel, BoardsApi } from "../contracts/boards";
import type {
    BoardArchiveDownloadRequest,
    PublishedBoardsResult,
    PublishedBoardVersions,
} from "../api-param-types";
import type { BoardHostText, BoardI18nContext, BoardThemePalette } from "../board-bridge/boot";
import type { BoardSnapshot } from "../board-snapshot-channels";
import { errMessage } from "../../shared/utils";
import { boardHostService } from "../../main/board-host/BoardHostService";
import * as boardLog from "../../main/board-log";
import { getBoardStorageKey } from "../../main/board-storage";
import { publishedBoardsService } from "../../main/published-boards-service";
import { boardDownloadService } from "../../main/board-download-service";
import { boardTrustService } from "../../main/board-trust-service";
import { boardSnapshotBroadcaster } from "../../main/board-snapshot-broadcaster";
import { moduleServiceSupervisor } from "../../main/module-service-supervisor";
import { clearHtmlPreview, setHtmlPreview } from "../../main/html-preview-protocol";
import { boardFileAccess } from "../../main/board-file-access";
import { getMcpUrl } from "../../main/mcp-http-server";
import { bindSessionSourceToBoard } from "../../main/session-src-protocol";
import type { NormalizedBoardPermissions } from "../../shared/board/board-permissions";
import type { BoardServiceUseDeclaration } from "../../shared/board/board-service-declarations";
import type { BoardServiceProvider } from "../board-bridge/port-protocol";
import { bindDomain } from "./endpoint-registry";

export function initBoardHandlers(): void {
    bindDomain<BoardsApi>({
        registerBoard: async (
            event: IpcMainEvent,
            boardRoot: string,
            theme: BoardThemePalette,
            tokens: Record<string, string>,
            i18n: BoardI18nContext,
            hostText: BoardHostText,
        ): Promise<string> => {
            return boardHostService.mount(event.sender, boardRoot, theme, tokens, i18n, hostText);
        },
        appendBoardLog: async (_event, boardRoot: string, level: BoardLogLevel, message: string): Promise<void> => {
            try {
                await boardLog.append(boardRoot, level, message);
            } catch (error) {
                console.warn(`Failed to append board log: ${errMessage(error)}`);
            }
        },
        getBoardLogPath: async (_event, boardRoot: string): Promise<string> => {
            return boardLog.getBoardLogPath(boardRoot);
        },
        getBoardStorageKey: async (_event, boardRoot: string): Promise<string> => {
            return getBoardStorageKey(boardRoot);
        },
        unregisterBoard: async (_event, host: string): Promise<void> => {
            boardHostService.unregisterBoard(host);
        },
        updateBoardTheme: async (_event, theme: BoardThemePalette): Promise<void> => {
            boardHostService.setTheme(theme);
        },
        requestBoardPort: async (
            event: IpcMainEvent,
            boardId: string,
            host: string,
            ownerId: string,
            hostedPath: string | null,
            token: string,
        ): Promise<void> => {
            boardHostService.requestBoardPort(event.sender, boardId, host, ownerId, hostedPath, token);
        },
        updateBoardHostedPath: async (
            event: IpcMainEvent,
            boardId: string,
            token: string,
            hostedPath: string | null,
        ): Promise<boolean> => {
            return boardHostService.updateBoardHostedPath(event.sender, boardId, token, hostedPath);
        },
        disposeBoardPort: async (_event, boardId: string): Promise<void> => {
            boardHostService.disposeBoardPort(boardId);
        },
        setBoardBusy: async (_event, ownerId: string, busy: boolean): Promise<void> => {
            boardHostService.setBoardBusy(ownerId, busy);
        },
        setBoardCallTimeout: async (_event, timeoutMs: number): Promise<void> => {
            boardHostService.setBoardCallTimeout(timeoutMs);
        },
        reapBoardOwner: async (_event, ownerId: string): Promise<void> => {
            boardHostService.reapBoardOwner(ownerId);
        },
        registerBoardFrame: async (
            event: IpcMainEvent,
            boardId: string,
            boardHost: string,
            frameNonce?: string,
            tab: string = BOARD_CDP_TAB,
            title?: string,
            pageId?: string,
        ): Promise<void> => {
            boardHostService.registerBoardFrame(
                event.sender,
                boardId,
                boardHost,
                frameNonce,
                tab,
                title,
                pageId,
            );
        },
        unregisterBoardFrame: async (
            _event,
            boardId: string,
            tab: string = BOARD_CDP_TAB,
            frameNonce?: string,
        ): Promise<void> => {
            boardHostService.unregisterBoardFrame(boardId, tab, frameNonce);
        },
        getPublishedBoards: async (_event, force?: boolean): Promise<PublishedBoardsResult> => {
            return publishedBoardsService.getPublishedBoards(
                force,
            );
        },
        getBoardVersions: async (_event, id: string): Promise<PublishedBoardVersions | null> => {
            return publishedBoardsService.getBoardVersions(id);
        },
        downloadBoardArchive: async (_event, request: BoardArchiveDownloadRequest): Promise<string> => {
            return boardDownloadService.downloadBoardArchive(
                request,
            );
        },
        cancelBoardDownload: async (_event, installId: string): Promise<void> => {
            boardDownloadService.cancelBoardDownload(installId);
        },
        setBoardTrust: async (
            _event,
            boardRoot: string,
            trusted: boolean,
            expectedPermissions?: NormalizedBoardPermissions,
            expectedUses?: BoardServiceUseDeclaration[],
        ): Promise<string[]> => {
            return boardTrustService.setTrust(
                boardRoot,
                trusted,
                expectedPermissions,
                expectedUses,
            );
        },
        getBoardSnapshot: async (): Promise<BoardSnapshot> => {
            // refresh() re-reads manifests (agents edit them on disk) and republishes;
            // an unchanged result keeps its revision.
            await boardTrustService.refresh();
            return boardSnapshotBroadcaster.current();
        },
        getBoardServiceProviders: async (
            _event,
            interfaceId: string,
        ): Promise<BoardServiceProvider[]> => {
            if (typeof interfaceId !== "string") throw new TypeError("A service interface id is required.");
            const trust = boardTrustService;
            await trust.refresh();
            return moduleServiceSupervisor.listServiceProviders(interfaceId);
        },
        setHtmlPreview: async (event: IpcMainEvent, id: string, html: string, resourceRoot?: string) =>
            setHtmlPreview(event.sender, id, html, resourceRoot),
        clearHtmlPreview: async (_event: IpcMainEvent, id: string) =>
            clearHtmlPreview(id),
        revokeBoardFileAccessGrant: async (
            _event: IpcMainEvent,
            boardRoot: string,
            kind: "folder" | "file",
            canonicalPath: string,
        ): Promise<void> => {
            if (kind !== "folder" && kind !== "file") throw new TypeError("Invalid board file-access grant kind.");
            await boardFileAccess.revoke(boardRoot, kind, canonicalPath);
        },
        grantBoardSourceReads: async (
            _event: IpcMainEvent,
            boardRoot: string,
            sourcePaths: string[],
            contextPaths: string[] = [],
        ): Promise<void> => {
            await boardFileAccess.grantSourceReads(
                boardRoot,
                sourcePaths,
                contextPaths,
            );
        },
        getBoardMcpEndpoint: async (): Promise<string> => {
            return getMcpUrl();
        },
        authorizeBoardFilePath: async (
            _event,
            boardRoot: string,
            requestedPath: string,
            intent: "read" | "write" = "read",
        ): Promise<string> => {
            return boardFileAccess.authorize(
                boardRoot,
                requestedPath,
                intent,
            );
        },
        bindBoardSessionSource: async (_event, handle: string, boardRoot: string): Promise<string> => {
            const grant = await boardTrustService.getGrant(boardRoot);
            if (!grant) throw new Error("This board is not trusted.");
            const mcpUrl = await getMcpUrl();
            return bindSessionSourceToBoard(
                handle,
                boardRoot,
                grant,
                mcpUrl,
            );
        },
        setDisabledBundledBoards: async (_event, ids: string[]): Promise<void> => {
            await boardTrustService.setDisabledBundledBoards(ids);
        },
    });
}
