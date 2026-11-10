import type { CapabilityClientInvoke, CapabilityClientOptions, CapabilityClientResult, CapabilityProvider } from "../capability-bus-channels";
import type { CapabilityJson } from "../../shared/capability-contract";
import { isServiceChannelTarget, type ServiceChannelDelivery, type ServiceChannelTarget } from "../../shared/service-channel-target";
import { PageDragData, WindowPages } from "../../shared/types";
import type { LaunchInput } from "../../shared/launch-input";
import {
    BoardArchiveDownloadRequest,
    CommonFolder,
    DownloadEntry,
    OpenFileDialogParams,
    OpenFolderDialogParams,
    PublishedBoardsResult,
    PublishedBoardVersions,
    RuntimeVersions,
    RecordingRegion,
    RecordingSessionStartResult,
    SaveFileDialogParams,
    UpdateCheckResult,
    VideoStreamSessionConfig,
    VideoStreamSessionResult,
} from "../api-param-types";
import {
    Api,
    CaptureRect,
    type CreateBoardShortcutRequest,
    type HostServiceChannelRequest,
    Endpoint,
    ENDPOINT_REPLY_CHANNEL,
    type EndpointReply,
    EventEndpoint,
    McpStatus,
    MnemeStatus,
    type PathWatchSubscribeRequest,
    type PathWatchUnsubscribeRequest,
    type BeginPathMoveRequest,
    type CompletePathMoveRequest,
    type BoardLogLevel,
    type ModuleServicePortPayload,
} from "../api-types";
import { GitAheadBehind, GitCommit, GitFetchOptions, GitFileChange, GitIdentity, GitLogOptions, GitMutationResult, GitProbeResult, GitPullOptions, GitPullResult, GitPushOptions, GitPushResult, GitRefs, GitRepoInfo, GitStatusResult, GitSwitchTarget } from "../git-ipc";
import type { BoardHostText, BoardI18nContext, BoardThemePalette } from "../board-bridge-channels";
import type {
    ClipboardFileList,
    ClipboardHistorySnapshot,
    ClipboardStatus,
} from "../clipboard-ipc";
import type { BoardServiceStatus, ModuleServicePortResult } from "../module-service-channels";
import { PendingRequests } from "../../shared/pending-requests";
import { fromWireError } from "../../shared/wire-error";

const pendingEndpointCalls = new PendingRequests<unknown>();
let replyListenerInstalled = false;

function installReplyListener(): void {
    if (replyListenerInstalled) return;
    replyListenerInstalled = true;
    window.electron.ipcRenderer.on(ENDPOINT_REPLY_CHANNEL, (payload) => {
        const reply = payload as EndpointReply;
        if (reply.ok === true) pendingEndpointCalls.settle(reply.id, reply.result);
        else pendingEndpointCalls.fail(reply.id, fromWireError(reply.error, "Unknown error"));
    });
}

function executeOnce<T = unknown>(command: Endpoint, ...args: unknown[]): Promise<T> {
    if (!window.electron) {
        return Promise.reject(new Error("window.electron is undefined"));
    }

    if (!window.electron.ipcRenderer) {
        return Promise.reject(
            new Error("window.electron.ipcRenderer is undefined")
        );
    }

    installReplyListener();
    const { id, promise } = pendingEndpointCalls.create();
    window.electron.ipcRenderer.sendMessage(command, args, id);
    return promise as Promise<T>;
}

class ApiCalls implements Api {
    subscribePathWatch = async (request: PathWatchSubscribeRequest) => {
        return executeOnce<void>(Endpoint.subscribePathWatch, request);
    };

    unsubscribePathWatch = async (request: PathWatchUnsubscribeRequest) => {
        return executeOnce<void>(Endpoint.unsubscribePathWatch, request);
    };

    beginPathMove = async (request: BeginPathMoveRequest) => {
        return executeOnce<string>(Endpoint.beginPathMove, request);
    };

    completePathMove = async (request: CompletePathMoveRequest) => {
        return executeOnce<void>(Endpoint.completePathMove, request);
    };

    getAppRootPath = async () => {
        return executeOnce<string>(Endpoint.getAppRootPath);
    };

    getAssetsPath = async (fileName: string) => {
        return executeOnce<string>(Endpoint.getAssetsPath, fileName);
    };

    getDataFolder = async () => {
        return executeOnce<string>(Endpoint.getDataFolder);
    };

    setActiveLocale = async (code: string) => {
        return executeOnce<void>(Endpoint.setActiveLocale, code);
    };

    reloadAllWindows = async () => {
        return executeOnce<void>(Endpoint.reloadAllWindows);
    };

    getUiPreferences = async () => {
        return executeOnce<Record<string, string | number | boolean>>(Endpoint.getUiPreferences);
    };

    setUiPreference = async (key: string, value: string | number | boolean) => {
        return executeOnce<string | number | boolean>(Endpoint.setUiPreference, key, value);
    };

    setBoardWindowIdentity = async (request: { displayName: string; iconDataUrl: string }) => {
        return executeOnce<void>(Endpoint.setBoardWindowIdentity, request);
    };

    createBoardShortcut = async (request: CreateBoardShortcutRequest) => {
        return executeOnce<boolean>(Endpoint.createBoardShortcut, request);
    };

    openBoardWindow = async (boardRoot: string) => {
        return executeOnce<void>(Endpoint.openBoardWindow, boardRoot);
    };

    maximizeWindow = async () => {
        return executeOnce<void>(Endpoint.maximizeWindow);
    };

    getDisplays = async () => {
        return executeOnce<readonly import("../../renderer/api/types/window").IWindowDisplay[]>(Endpoint.getDisplays);
    };
    moveToDisplay = (target: import("../../renderer/api/types/window").WindowDisplayTarget, options?: { maximize?: boolean; fullscreen?: boolean }) =>
        executeOnce<import("../../renderer/api/types/window").IWindowMoveResult>(Endpoint.moveToDisplay, target, options);
    setFullScreen = (on: boolean) => executeOnce<{ fullscreen: boolean }>(Endpoint.setFullScreen, on);
    getFullScreen = () => executeOnce<boolean>(Endpoint.getFullScreen);

    minimizeWindow = async () => {
        return executeOnce<void>(Endpoint.minimizeWindow);
    };

    restoreWindow = async () => {
        return executeOnce<void>(Endpoint.restoreWindow);
    };

    closeWindow = async () => {
        return executeOnce<void>(Endpoint.closeWindow);
    };

    setCanQuit = async (canQuit: boolean) => {
        return executeOnce<void>(Endpoint.setCanQuit, canQuit);
    };

    resolveWindowClose = async (result: import("../api-types").WindowCloseResolution) => {
        return executeOnce<void>(Endpoint.resolveWindowClose, result);
    };

    showOpenFileDialog = async (params: OpenFileDialogParams) => {
        return executeOnce<string[] | undefined>(
            Endpoint.showOpenFileDialog,
            params
        );
    };

    showSaveFileDialog = async (params: SaveFileDialogParams) => {
        return executeOnce<string | undefined>(
            Endpoint.showSaveFileDialog,
            params
        );
    };

    showOpenFolderDialog = async (params: OpenFolderDialogParams) => {
        return executeOnce<string[] | undefined>(
            Endpoint.showOpenFolderDialog,
            params
        );
    };

    inspectElement = async (x: number, y: number) => {
        return executeOnce<void>(Endpoint.inspectElement, x, y);
    };

    openDevTools = async () => {
        return executeOnce<void>(Endpoint.openDevTools);
    };

    getCommonFolder = async (folder: CommonFolder) => {
        return executeOnce<string>(Endpoint.getCommonFolder, folder);
    };

    getSiteExtensionRuntime = async () => {
        return executeOnce<string>(Endpoint.getSiteExtensionRuntime);
    };

    zoom = async (delta: number) => {
        return executeOnce<void>(Endpoint.zoom, delta);
    };

    resetZoom = async () => {
        return executeOnce<void>(Endpoint.resetZoom);
    };

    showItemInFolder = async (path: string) => {
        return executeOnce<void>(Endpoint.showItemInFolder, path);
    };

    showFolder = async (path: string) => {
        return executeOnce<void>(Endpoint.showFolder, path);
    }

    /** Open a file or folder with the OS default application. Resolves to Electron's
     *  error string — empty when the shell accepted the path. */
    openPath = async (path: string, boardRoot?: string) => {
        return executeOnce<string>(Endpoint.openPath, path, boardRoot);
    }

    windowReady = async () => {
        return executeOnce<void>(Endpoint.windowReady);
    };

    getStartupInputs = async () => {
        return executeOnce<LaunchInput[]>(Endpoint.getStartupInputs);
    };

    getWindowIndex = async () => {
        return executeOnce<number>(Endpoint.getWindowIndex);
    };

    openNewWindow = async (filePath?: string) => {
        return executeOnce<number>(Endpoint.openNewWindow, filePath);
    };

    getWindowPages = async () => {
        return executeOnce<WindowPages[]>(Endpoint.getWindowPages);
    };

    showWindowPage = async (windowIndex: number, pageId: string) => {
        return executeOnce<void>(Endpoint.showWindowPage, windowIndex, pageId);
    };

    addDragEvent = async (event: PageDragData) => {
        return executeOnce<void>(Endpoint.addDragEvent, event);
    };

    getFileIcon = async (filePath: string) => {
        return executeOnce<string>(Endpoint.getFileIcon, filePath);
    }

    checkForUpdates = async (force?: boolean) => {
        return executeOnce<UpdateCheckResult>(Endpoint.checkForUpdates, force);
    }

    getAppVersion = async () => {
        return executeOnce<string>(Endpoint.getAppVersion);
    }

    getRuntimeVersions = async () => {
        return executeOnce<RuntimeVersions>(Endpoint.getRuntimeVersions);
    }

    setNativeTheme = async (mode: "light" | "dark") => {
        return executeOnce<void>(Endpoint.setNativeTheme, mode);
    }

    registerAsDefaultBrowser = async () => {
        return executeOnce<void>(Endpoint.registerAsDefaultBrowser);
    }

    unregisterAsDefaultBrowser = async () => {
        return executeOnce<void>(Endpoint.unregisterAsDefaultBrowser);
    }

    isRegisteredAsDefaultBrowser = async () => {
        return executeOnce<boolean>(Endpoint.isRegisteredAsDefaultBrowser);
    }

    openDefaultAppsSettings = async () => {
        return executeOnce<void>(Endpoint.openDefaultAppsSettings);
    }

    getDownloads = async () => {
        return executeOnce<DownloadEntry[]>(Endpoint.getDownloads);
    }

    cancelDownload = async (id: string) => {
        return executeOnce<void>(Endpoint.cancelDownload, id);
    }

    openDownload = async (id: string) => {
        return executeOnce<void>(Endpoint.openDownload, id);
    }

    showDownloadInFolder = async (id: string) => {
        return executeOnce<void>(Endpoint.showDownloadInFolder, id);
    }

    clearCompletedDownloads = async () => {
        return executeOnce<void>(Endpoint.clearCompletedDownloads);
    }

    setMcpEnabled = async (enabled: boolean, port?: number) => {
        return executeOnce<void>(Endpoint.setMcpEnabled, enabled, port);
    }

    setMainScriptsEnabled = async (enabled: boolean) => {
        return executeOnce<void>(Endpoint.setMainScriptsEnabled, enabled);
    }
    capabilityList = (asAgent?: boolean) => executeOnce<CapabilityClientResult<CapabilityProvider[]>>(Endpoint.capabilityList, asAgent);
    capabilityProviders = (id: string, asAgent?: boolean) => executeOnce<CapabilityClientResult<CapabilityProvider[]>>(Endpoint.capabilityProviders, id, asAgent);
    capabilityGet = (id: string, options?: CapabilityClientOptions) => executeOnce<CapabilityClientResult<CapabilityProvider | null>>(Endpoint.capabilityGet, id, options);
    capabilityLegacyResolve = (id: string, options: { version?: number; filter?: CapabilityClientOptions["filter"] }) => executeOnce<CapabilityClientResult<import("../capability-bus-channels").CapabilityRegistration | null>>(Endpoint.capabilityLegacyResolve, id, options);
    capabilityInvoke = (request: CapabilityClientInvoke) => executeOnce<CapabilityClientResult<CapabilityJson>>(Endpoint.capabilityInvoke, request);
    capabilityCancel = (requestId: string) => executeOnce<void>(Endpoint.capabilityCancel, requestId);
    getCapabilityIndex = async () => executeOnce<ReturnType<typeof import("../../main/capability-registry").capabilityRegistry.snapshot>>(Endpoint.getCapabilityIndex);
    setCapabilityPreferences = async (preferences: Record<string, string>) => executeOnce<void>(Endpoint.setCapabilityPreferences, preferences);
    onCapabilityIndexChanged = (callback: (revision: number) => void) => window.electron.ipcRenderer.on(EventEndpoint.eCapabilityIndexChanged, callback as (...args: unknown[]) => void);

    setWindowsSsoEnabled = async (enabled: boolean) => {
        return executeOnce<void>(Endpoint.setWindowsSsoEnabled, enabled);
    }

    getMcpStatus = async () => {
        return executeOnce<McpStatus>(Endpoint.getMcpStatus);
    }

    setMnemeEnabled = async (enabled: boolean, port?: number) => {
        return executeOnce<MnemeStatus>(Endpoint.setMnemeEnabled, enabled, port);
    }

    restartMneme = async (port?: number) => {
        return executeOnce<MnemeStatus>(Endpoint.restartMneme, port);
    }

    getMnemeStatus = async () => {
        return executeOnce<MnemeStatus>(Endpoint.getMnemeStatus);
    }

    getAudioCaptureCount = async () => executeOnce<{ count: number; revision: number }>(Endpoint.getAudioCaptureCount);

    setClipboardEnabled = async (enabled: boolean, maxItems: number): Promise<ClipboardStatus> => {
        return executeOnce<ClipboardStatus>(Endpoint.setClipboardEnabled, enabled, maxItems);
    }

    getClipboardHistory = async (): Promise<ClipboardHistorySnapshot> => {
        return executeOnce<ClipboardHistorySnapshot>(Endpoint.getClipboardHistory);
    }

    removeClipboardItem = async (id: string): Promise<void> => {
        return executeOnce<void>(Endpoint.removeClipboardItem, id);
    }

    clearClipboardHistory = async (): Promise<void> => {
        return executeOnce<void>(Endpoint.clearClipboardHistory);
    }

    copyClipboardItem = async (id: string): Promise<boolean> => {
        return executeOnce<boolean>(Endpoint.copyClipboardItem, id);
    }

    getClipboardStatus = async (): Promise<ClipboardStatus> => {
        return executeOnce<ClipboardStatus>(Endpoint.getClipboardStatus);
    }

    setClipboardHealthMonitoring = async (active: boolean): Promise<ClipboardStatus> => {
        return executeOnce<ClipboardStatus>(Endpoint.setClipboardHealthMonitoring, active);
    }

    restartClipboard = async (maxItems: number): Promise<ClipboardStatus> => {
        return executeOnce<ClipboardStatus>(Endpoint.restartClipboard, maxItems);
    }

    startScreenSnip = async (hideWindows: boolean): Promise<string | null> => {
        return executeOnce<string | null>(Endpoint.startScreenSnip, hideWindows);
    }

    startWindowRecording = async (request: { region: RecordingRegion }): Promise<RecordingSessionStartResult> => {
        return executeOnce<RecordingSessionStartResult>(Endpoint.startWindowRecording, request);
    }

    appendWindowRecordingChunk = async (request: { recordingId: string; chunk: Uint8Array }): Promise<void> => {
        return executeOnce<void>(Endpoint.appendWindowRecordingChunk, request);
    }

    finalizeWindowRecording = async (request: { recordingId: string; extension: "mp4" | "webm" }): Promise<string> => {
        return executeOnce<string>(Endpoint.finalizeWindowRecording, request);
    }

    cancelWindowRecording = async (recordingId: string): Promise<void> => {
        return executeOnce<void>(Endpoint.cancelWindowRecording, recordingId);
    }

    clipboardWriteText = async (text: string): Promise<void> => {
        return executeOnce<void>(Endpoint.clipboardWriteText, text);
    }

    clipboardWritePng = async (bytes: Uint8Array): Promise<void> => {
        return executeOnce<void>(Endpoint.clipboardWritePng, bytes);
    }

    clipboardReadFilePaths = async (): Promise<ClipboardFileList> => {
        return executeOnce<ClipboardFileList>(Endpoint.clipboardReadFilePaths);
    }

    clipboardWriteFilePaths = async (paths: string[], cut: boolean): Promise<boolean> => {
        return executeOnce<boolean>(Endpoint.clipboardWriteFilePaths, paths, cut);
    }

    startOsFileDrag = async (paths: string[]): Promise<void> => {
        return executeOnce<void>(Endpoint.startOsFileDrag, paths);
    }

    createVideoStreamSession = async (config: VideoStreamSessionConfig, port?: number) => {
        return executeOnce<VideoStreamSessionResult>(Endpoint.createVideoStreamSession, config, port);
    };

    deleteVideoStreamSession = async (sessionId: string) => {
        return executeOnce<void>(Endpoint.deleteVideoStreamSession, sessionId);
    };

    deleteVideoStreamSessionsByPage = async (pageId: string) => {
        return executeOnce<void>(Endpoint.deleteVideoStreamSessionsByPage, pageId);
    };

    openTerminal = async (path: string, command: string) => {
        return executeOnce<void>(Endpoint.openTerminal, path, command);
    };

    detectTerminal = async () => {
        return executeOnce<string>(Endpoint.detectTerminal);
    };

    openInVlc = async (url: string, vlcPath?: string) => {
        return executeOnce<void>(Endpoint.openInVlc, url, vlcPath);
    };

    gitProbe = async () => {
        return executeOnce<GitProbeResult>(Endpoint.gitProbe);
    };

    gitDetectRepo = async (dir: string) => {
        return executeOnce<GitRepoInfo | null>(Endpoint.gitDetectRepo, dir);
    };

    gitLog = async (dir: string, opts: GitLogOptions = {}) => {
        return executeOnce<GitCommit[]>(Endpoint.gitLog, dir, opts);
    };

    gitShow = async (dir: string, rev: string, path: string) => {
        return executeOnce<string>(Endpoint.gitShow, dir, rev, path);
    };

    gitStatus = async (dir: string) => {
        return executeOnce<GitStatusResult>(Endpoint.gitStatus, dir);
    };

    gitCommitMessage = async (dir: string, hash: string) => {
        return executeOnce<string>(Endpoint.gitCommitMessage, dir, hash);
    };

    gitCommitFiles = async (dir: string, hash: string) => {
        return executeOnce<GitFileChange[]>(Endpoint.gitCommitFiles, dir, hash);
    };

    gitStage = async (dir: string, paths: string[]) => {
        return executeOnce<GitMutationResult>(Endpoint.gitStage, dir, paths);
    };

    gitUnstage = async (dir: string, paths: string[]) => {
        return executeOnce<GitMutationResult>(Endpoint.gitUnstage, dir, paths);
    };

    gitDiscard = async (dir: string, trackedPaths: string[], untrackedPaths: string[]) => {
        return executeOnce<GitMutationResult>(Endpoint.gitDiscard, dir, trackedPaths, untrackedPaths);
    };

    gitCommit = async (dir: string, message: string, identity?: GitIdentity) => {
        return executeOnce<GitMutationResult>(Endpoint.gitCommit, dir, message, identity);
    };

    gitIdentity = async (dir: string) => {
        return executeOnce<GitIdentity>(Endpoint.gitIdentity, dir);
    };

    gitRefs = async (dir: string) => {
        return executeOnce<GitRefs>(Endpoint.gitRefs, dir);
    };

    gitSwitch = async (dir: string, target: GitSwitchTarget) => {
        return executeOnce<GitMutationResult>(Endpoint.gitSwitch, dir, target);
    };

    gitCreateBranch = async (dir: string, name: string, startPoint?: string, checkout?: boolean) => {
        return executeOnce<GitMutationResult>(Endpoint.gitCreateBranch, dir, name, startPoint, checkout);
    };

    gitFetch = async (dir: string, opts?: GitFetchOptions) => {
        return executeOnce<GitMutationResult>(Endpoint.gitFetch, dir, opts);
    };

    gitAheadBehind = async (dir: string) => {
        return executeOnce<GitAheadBehind>(Endpoint.gitAheadBehind, dir);
    };

    gitPush = async (dir: string, opts?: GitPushOptions) => {
        return executeOnce<GitPushResult>(Endpoint.gitPush, dir, opts);
    };

    gitPull = async (dir: string, opts?: GitPullOptions) => {
        return executeOnce<GitPullResult>(Endpoint.gitPull, dir, opts);
    };

    gitRemoteUrl = async (dir: string, remote: string) => {
        return executeOnce<string>(Endpoint.gitRemoteUrl, dir, remote);
    };

    capturePageRegion = async (rect: CaptureRect) => {
        return executeOnce<Uint8Array>(Endpoint.capturePageRegion, rect);
    };

    // Map a board into the host-routed board:// registry; resolves to its stable
    // board:// host. Must complete before the iframe navigates board://<host>.
    registerBoard = async (
        boardRoot: string,
        theme: BoardThemePalette,
        tokens: Record<string, string>,
        i18n: BoardI18nContext,
        hostText: BoardHostText,
    ) => {
        return executeOnce<string>(Endpoint.registerBoard, boardRoot, theme, tokens, i18n, hostText);
    };

    setHtmlPreview = async (id: string, html: string, resourceRoot?: string) => {
        return executeOnce<void>(Endpoint.setHtmlPreview, id, html, resourceRoot);
    };

    clearHtmlPreview = async (id: string) => {
        return executeOnce<void>(Endpoint.clearHtmlPreview, id);
    };

    appendBoardLog = async (boardRoot: string, level: BoardLogLevel, message: string) => {
        return executeOnce<void>(Endpoint.appendBoardLog, boardRoot, level, message);
    };

    getBoardLogPath = async (boardRoot: string) => {
        return executeOnce<string>(Endpoint.getBoardLogPath, boardRoot);
    };

    getBoardStorageKey = async (boardRoot: string) => {
        return executeOnce<string>(Endpoint.getBoardStorageKey, boardRoot);
    };

    unregisterBoard = async (host: string) => {
        return executeOnce<void>(Endpoint.unregisterBoard, host);
    };

    // Refresh the palette stored for live boards on a theme switch, so a board that
    // reloads after the switch is served the current theme by the board:// handler.
    // Main also fans the palette out to every live board port for a live retint.
    updateBoardTheme = async (theme: BoardThemePalette) => {
        return executeOnce<void>(Endpoint.updateBoardTheme, theme);
    };

    // Ask main to mint a per-board MessagePort. The port arrives
    // asynchronously on `eBoardPort` — subscribe via `onBoardPort` before requesting.
    // `ownerId` = the owning BoardEditorModel id, the stable job-retention key.
    requestBoardPort = async (boardId: string, host: string, ownerId: string, hostedPath: string | null, token: string) => {
        return executeOnce<void>(Endpoint.requestBoardPort, boardId, host, ownerId, hostedPath, token);
    };

    updateBoardHostedPath = async (boardId: string, token: string, hostedPath: string | null) => {
        return executeOnce<boolean>(Endpoint.updateBoardHostedPath, boardId, token, hostedPath);
    };

    disposeBoardPort = async (boardId: string) => {
        return executeOnce<void>(Endpoint.disposeBoardPort, boardId);
    };

    // Busy retention: mirror the board model's busy flag to main so a busy
    // owner's jobs survive port disposal; reap everything on final teardown.
    setBoardBusy = async (ownerId: string, busy: boolean) => {
        return executeOnce<void>(Endpoint.setBoardBusy, ownerId, busy);
    };

    setBoardCallTimeout = async (timeoutMs: number) => {
        return executeOnce<void>(Endpoint.setBoardCallTimeout, timeoutMs);
    };

    reapBoardOwner = async (ownerId: string) => {
        return executeOnce<void>(Endpoint.reapBoardOwner, ownerId);
    };

    // Receive the per-board MessagePort delivered by main. Uses the ports-aware
    // preload listener (the typed event system drops `event.ports`). Returns an
    // unsubscribe fn.
    onBoardPort = (cb: (boardId: string, port: MessagePort) => void): (() => void) => {
        return window.electron.ipcRenderer.onPort(EventEndpoint.eBoardPort, (payload, ports) => {
            const boardId = (payload as { boardId: string } | undefined)?.boardId;
            if (boardId && ports[0]) cb(boardId, ports[0]);
        });
    };

    onBoardServiceChannel = (cb: (target: ServiceChannelTarget, channelId: string, port: MessagePort) => void): (() => void) => {
        return window.electron.ipcRenderer.onPort(EventEndpoint.eBoardServiceChannel, (payload, ports) => {
            const value = payload as Partial<ServiceChannelDelivery> | undefined;
            const port = ports[0];
            if (!port) return;
            if (!value || typeof value.channelId !== "string" || !isServiceChannelTarget(value.target)) { port.close(); return; }
            cb(value.target, value.channelId, port);
        });
    };

    // Register a board's board:// frame for CDP automation. Main
    // attaches the debugger to the calling window's webContents and routes commands to
    // the board frame. Call on each iframe load (a reload recreates the frame).
    registerBoardFrame = async (boardId: string, boardHost: string, frameNonce?: string, tab?: string, title?: string, pageId?: string) => {
        return executeOnce<void>(Endpoint.registerBoardFrame, boardId, boardHost, frameNonce, tab, title, pageId);
    };

    unregisterBoardFrame = async (boardId: string, tab?: string, frameNonce?: string) => {
        return executeOnce<void>(Endpoint.unregisterBoardFrame, boardId, tab, frameNonce);
    };

    registerBoardPipePage = async (pageId: string, host?: string, boardRoot?: string, hostedDocument?: boolean) => {
        return executeOnce<void>(Endpoint.registerBoardPipePage, pageId, host, boardRoot, hostedDocument);
    };

    unregisterBoardPipePage = async (pageId: string) => {
        return executeOnce<void>(Endpoint.unregisterBoardPipePage, pageId);
    };

    registerBoardPipeResource = async (resourceId: string, host: string, boardRoot?: string, filePath?: string) => {
        return executeOnce<void>(Endpoint.registerBoardPipeResource, resourceId, host, boardRoot, filePath);
    };

    unregisterBoardPipeResource = async (resourceId: string) => {
        return executeOnce<void>(Endpoint.unregisterBoardPipeResource, resourceId);
    };

    getPublishedBoards = async (force?: boolean) => {
        return executeOnce<PublishedBoardsResult>(Endpoint.getPublishedBoards, force);
    };

    getBoardVersions = async (id: string) => {
        return executeOnce<PublishedBoardVersions | null>(Endpoint.getBoardVersions, id);
    };

    downloadBoardArchive = async (req: BoardArchiveDownloadRequest) => {
        return executeOnce<string>(Endpoint.downloadBoardArchive, req);
    };

    cancelBoardDownload = async (installId: string) => {
        return executeOnce<void>(Endpoint.cancelBoardDownload, installId);
    };

    setBoardTrust = async (boardRoot: string, trusted: boolean, expectedPermissions?: import("../../shared/board/board-permissions").NormalizedBoardPermissions, expectedUses?: import("../../shared/board/board-service-declarations").BoardServiceUseDeclaration[]) => {
        return executeOnce<string[]>(Endpoint.setBoardTrust, boardRoot, trusted, expectedPermissions, expectedUses);
    };

    getBoardSnapshot = async () => {
        return executeOnce<import("../board-snapshot-channels").BoardSnapshot>(Endpoint.getBoardSnapshot);
    };

    getBoardServiceProviders = async (interfaceId: string) =>
        executeOnce<import("../board-bridge-channels").BoardServiceProvider[]>(Endpoint.getBoardServiceProviders, interfaceId);

    connectHostServiceChannel = async (request: HostServiceChannelRequest) =>
        executeOnce<string>(Endpoint.connectHostServiceChannel, request);

    insertVoiceTypingText = async (request: { sessionId: string; text: string; deferClipboard?: boolean }) =>
        executeOnce<{ copied: boolean }>(Endpoint.insertVoiceTypingText, request);

    armVoiceTypingMicrophone = async () => executeOnce<void>(Endpoint.armVoiceTypingMicrophone);
    clearVoiceTypingMicrophone = async () => executeOnce<void>(Endpoint.clearVoiceTypingMicrophone);
    armTranscriptLoopback = async () => executeOnce<void>(Endpoint.armTranscriptLoopback);
    clearTranscriptLoopback = async () => executeOnce<void>(Endpoint.clearTranscriptLoopback);
    setVoiceTypingConfig = async (request: { shortcut: string; translateShortcut: string }) => executeOnce<void>(Endpoint.setVoiceTypingConfig, request);
    setVoiceTypingState = async (request: { state: "idle" | "recording" | "transcribing" }) => executeOnce<void>(Endpoint.setVoiceTypingState, request);

    onVoiceTypingShortcut = (callback: (event: import("../api-types").EventApi[EventEndpoint.eVoiceTypingShortcut] extends import("../api-types").EventObject<infer T> ? T : never) => void) =>
        window.electron.ipcRenderer.on(EventEndpoint.eVoiceTypingShortcut, callback as (...args: unknown[]) => void);

    revokeBoardFileAccessGrant = async (boardRoot: string, kind: "folder" | "file", canonicalPath: string) =>
        executeOnce<void>(Endpoint.revokeBoardFileAccessGrant, boardRoot, kind, canonicalPath);
    grantBoardSourceReads = async (boardRoot: string, sourcePaths: string[], contextPaths: string[] = []) =>
        executeOnce<void>(Endpoint.grantBoardSourceReads, boardRoot, sourcePaths, contextPaths);

    fetchSiteExtensionText = async (tab: string, id: string, url: string) => executeOnce<{ text?: string; error?: string }>(Endpoint.fetchSiteExtensionText, tab, id, url);
    cancelSiteExtensionFetches = async (tab: string) => executeOnce<void>(Endpoint.cancelSiteExtensionFetches, tab);
    getSiteExtensionTrust = async () => executeOnce<import("../api-types").SiteExtensionTrustSnapshot>(Endpoint.getSiteExtensionTrust);
    bindSiteExtensionFolder = async (folder: string) => executeOnce<import("../api-types").SiteExtensionTrustSnapshot>(Endpoint.bindSiteExtensionFolder, folder);
    trustSiteExtension = async (id: string, hosts: string[], fetchHosts: string[], folder: string) => executeOnce<import("../api-types").SiteExtensionTrustSnapshot>(Endpoint.trustSiteExtension, id, hosts, fetchHosts, folder);
    revokeSiteExtensionTrust = async (id: string) => executeOnce<import("../api-types").SiteExtensionTrustSnapshot>(Endpoint.revokeSiteExtensionTrust, id);
    setSiteExtensionEnabled = async (id: string, enabled: boolean) => executeOnce<import("../api-types").SiteExtensionTrustSnapshot>(Endpoint.setSiteExtensionEnabled, id, enabled);

    getBoardMcpEndpoint = async () => executeOnce<string>(Endpoint.getBoardMcpEndpoint);

    authorizeBoardFilePath = async (boardRoot: string, requestedPath: string, intent: "read" | "write" = "read") =>
        executeOnce<string>(Endpoint.authorizeBoardFilePath, boardRoot, requestedPath, intent);

    bindBoardSessionSource = async (handle: string, boardRoot: string) =>
        executeOnce<string>(Endpoint.bindBoardSessionSource, handle, boardRoot);

    setDisabledBundledBoards = async (ids: string[]) => {
        return executeOnce<void>(Endpoint.setDisabledBundledBoards, ids);
    };

    getModuleServiceStatuses = async () => {
        return executeOnce<BoardServiceStatus[]>(Endpoint.getModuleServiceStatuses);
    };

    requestModuleServicePort = async (boardRoot: string): Promise<ModuleServicePortResult> => {
        return executeOnce<ModuleServicePortResult>(Endpoint.requestModuleServicePort, boardRoot);
    };

    requestModuleService = async (boardRoot: string, message: unknown) => {
        return executeOnce<unknown>(Endpoint.requestModuleService, boardRoot, message);
    };

    startModuleService = async (boardRoot: string) => {
        return executeOnce<void>(Endpoint.startModuleService, boardRoot);
    };

    stopModuleService = async (boardRoot: string) => {
        return executeOnce<void>(Endpoint.stopModuleService, boardRoot);
    };

    onModuleServicePort = (
        cb: (payload: ModuleServicePortPayload, port: MessagePort) => void,
    ): (() => void) => {
        return window.electron.ipcRenderer.onPort(EventEndpoint.eModuleServicePort, (rawPayload, ports) => {
            const payload = rawPayload as Partial<ModuleServicePortPayload> | undefined;
            if (typeof payload?.boardRoot !== "string" || payload.boardRoot.length === 0) return;
            if (!Number.isInteger(payload.generation) || payload.generation < 0) return;
            if (typeof payload.leaseNonce !== "string" || payload.leaseNonce.length === 0) return;
            const port = ports[0];
            if (!port || typeof port.start !== "function" || typeof port.postMessage !== "function") return;
            cb({
                boardRoot: payload.boardRoot,
                generation: payload.generation,
                leaseNonce: payload.leaseNonce,
            }, port);
        });
    };
}

export const api = new ApiCalls();
