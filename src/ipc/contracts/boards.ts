import type { TimeoutExemptions } from "../timeout-exemptions";
import type {
    BoardArchiveDownloadRequest,
    PublishedBoardsCatalog,
    PublishedBoardsResult,
    PublishedBoardVersions,
} from "../api-param-types";
import type { BoardHostText, BoardI18nContext, BoardThemePalette } from "../board-bridge/boot";
import type { BoardNotifyMsg } from "../board-bridge/port-protocol";
import type { NormalizedBoardPermissions } from "../../shared/board/board-permissions";
import type { EventObject } from "./event-object";

export interface BoardsApi {
    registerBoard: (
        boardRoot: string,
        theme: BoardThemePalette,
        tokens: Record<string, string>,
        i18n: BoardI18nContext,
        hostText: BoardHostText,
    ) => Promise<string>;
    setHtmlPreview: (id: string, html: string, resourceRoot?: string) => Promise<void>;
    clearHtmlPreview: (id: string) => Promise<void>;
    appendBoardLog: (boardRoot: string, level: BoardLogLevel, message: string) => Promise<void>;
    getBoardLogPath: (boardRoot: string) => Promise<string>;
    getBoardStorageKey: (boardRoot: string) => Promise<string>;
    unregisterBoard: (host: string) => Promise<void>;
    updateBoardTheme: (theme: BoardThemePalette) => Promise<void>;
    requestBoardPort: (
        boardId: string,
        host: string,
        ownerId: string,
        hostedPath: string | null,
        token: string,
    ) => Promise<void>;
    updateBoardHostedPath: (boardId: string, token: string, hostedPath: string | null) => Promise<boolean>;
    disposeBoardPort: (boardId: string) => Promise<void>;
    setBoardBusy: (ownerId: string, busy: boolean) => Promise<void>;
    setBoardCallTimeout: (timeoutMs: number) => Promise<void>;
    reapBoardOwner: (ownerId: string) => Promise<void>;
    registerBoardFrame: (
        boardId: string,
        boardHost: string,
        frameNonce?: string,
        tab?: string,
        title?: string,
        pageId?: string,
    ) => Promise<void>;
    unregisterBoardFrame: (boardId: string, tab?: string, frameNonce?: string) => Promise<void>;
    getPublishedBoards: (force?: boolean) => Promise<PublishedBoardsResult>;
    getBoardVersions: (id: string) => Promise<PublishedBoardVersions | null>;
    downloadBoardArchive: (req: BoardArchiveDownloadRequest) => Promise<string>;
    cancelBoardDownload: (installId: string) => Promise<void>;
    setBoardTrust: (
        boardRoot: string,
        trusted: boolean,
        expectedPermissions?: NormalizedBoardPermissions,
        expectedUses?: import("../../shared/board/board-service-declarations").BoardServiceUseDeclaration[],
    ) => Promise<string[]>;
    getBoardSnapshot: () => Promise<import("../board-snapshot-channels").BoardSnapshot>;
    getBoardServiceProviders: (interfaceId: string) => Promise<
        import("../board-bridge/port-protocol").BoardServiceProvider[]
    >;
    revokeBoardFileAccessGrant: (boardRoot: string, kind: "folder" | "file", canonicalPath: string) => Promise<void>;
    grantBoardSourceReads: (boardRoot: string, sourcePaths: string[], contextPaths?: string[]) => Promise<void>;
    getBoardMcpEndpoint: () => Promise<string>;
    authorizeBoardFilePath: (boardRoot: string, requestedPath: string, intent?: "read" | "write") => Promise<string>;
    bindBoardSessionSource: (handle: string, boardRoot: string) => Promise<string>;
    setDisabledBundledBoards: (ids: string[]) => Promise<void>;
}

export interface BoardsEvents {
    eBoardNotify: EventObject<BoardNotifyMsg>;
    ePublishedBoardsUpdated: EventObject<PublishedBoardsCatalog>;
    eBoardInstallProgress: EventObject<{ installId: string; receivedBytes: number; totalBytes: number }>;
    eBoardSnapshotChanged: EventObject<import("../board-snapshot-channels").BoardSnapshot>;
}

export type BoardLogLevel = "info" | "warn" | "warning" | "error" | "stdout" | "stderr";

export interface BoardPortTransferMetadata {
    eBoardPort: {
        payload: { boardId: string };
        transport: "webContents.postMessage";
        transferredPorts: [MessagePort];
    };
    eBoardServiceChannel: {
        payload: import("../../shared/service-channel-target").ServiceChannelDelivery;
        transport: "webContents.postMessage";
        transferredPorts: [MessagePort];
    };
}


export const boardTimeoutExemptions = {
    authorizeBoardFilePath: "Canonicalization, stats, and path checks are not request-bounded.",
    getBoardVersions: "Remote catalog fetch has no request-level bound.",
    setBoardTrust: "Trust queue, persistence, rebuild, and notification are not request-bounded.",
    downloadBoardArchive: "Archive streams and hashes until completion or cancellation.",
    getPublishedBoards: "Remote catalog fetch has no request-level bound.",
    grantBoardSourceReads: "Canonicalization, stats, and per-path checks are not request-bounded.",
    getBoardSnapshot: "Snapshot refresh reads manifests from disk.",
} satisfies TimeoutExemptions<BoardsApi>;
