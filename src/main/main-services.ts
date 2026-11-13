import { protocol } from "electron";
import { PROFILE_SRC_SCHEME } from "../ipc/browser-network-ipc";
import { AudioBackend } from "./audio-backend";
import { APP_ASSET_SCHEME_PRIVILEGES, registerAppAssetProtocol } from "./app-asset-protocol";
import { audioService } from "./audio-service";
import { boardDownloadService } from "./board-download-service";
import { boardPipeService } from "./board-pipe-service";
import { boardTrustService } from "./board-trust-service";
import { subscribeBoardTrustConsumers } from "./board-trust-subscribers";
import {
    initializeBrowserService,
    initBrowserUserAgent,
} from "./browser-service";
import {
    createBrowserPermissionPromptHandler,
    getBrowserRegistrationKeyForWebContents,
    getBrowserWebContentsForCdp,
    sendBrowserAiVisionSignal,
} from "./browser-service-composition";
import { initializeBrowserNetworkService, registerProfileSrcProtocol } from "./browser-network-service";
import { BoardServiceBackend } from "./board-service-backend";
import { capabilityRouter } from "./capability-router";
import { resolveNetworkResponseBodies, startCdpService } from "./cdp-service";
import { killAllCommands } from "./command-runner";
import { disposeAllBoardPorts } from "./board-bridge";
import { downloadService } from "./download-service";
import { initHtmlPreviewProtocol } from "./html-preview-protocol";
import { initBoardProtocol } from "./board-protocol-service";
import { initializeRecordingService } from "./recording-service";
import { initNetworkLogger } from "./network-logger";
import { moduleServiceSupervisor } from "./module-service-supervisor";
import { shutdownClipboard } from "./clipboard-service";
import { shutdownMneme } from "./mneme-service";
import { shutdownPathWatchService } from "./path-watch-service";
import { getPrivateMcpClientCount, shutdownPrivateMcpEndpoint } from "./mcp/private-session-endpoints";
import {
    getMcpClientCount,
    getMcpUrl,
    isMcpHttpServerRunning,
    startMcpHttpServerService,
    stopMcpHttpServer,
} from "./mcp-http-server";
import { openWindows } from "./open-windows";
import { initPermissionPolicy } from "./permission-policy-service";
import { reconstructWindowsEnv } from "./windows-env";
import { registerSessionSrcProtocol } from "./session-src-protocol";
import { registerTorSrcProtocol } from "./tor-src-protocol";
import { setupTray } from "./tray-setup";
import { startPipeServer, stopPipeServer } from "./pipe-server";
import { stopVideoStreamServer } from "./video-stream-server";
import { torService } from "./tor-service";
import { versionService } from "./version-service";
import { applicationProfileName } from "./application-profile";
import { publishedBoardsService } from "./published-boards-service";
import { errMessage } from "../shared/utils";
import { appPartition, fileAccessPersistPartition } from "./constants";
import { takeBoardStartupInput, takeStartupInputsForMain } from "./launch-inputs";
import { siteExtensionTrustService } from "./site-extension-trust-service";
import { capabilityBackendRegistry, type CapabilityBackendRegistryStartDependencies } from "./capability-backend-registry";
import type { PermissionPolicyStartDependencies } from "./permission-policy-service";

export interface MainService {
    start?(): void | Promise<void>;
    dispose?(): void | Promise<void>;
}

export type MainServicePhase =
    | "setup-before-certificate"
    | "setup-after-certificate-before-ipc"
    | "setup-after-ipc"
    | "ready";
export type MainServiceDisposalPhase = "before-gate" | "quit";

interface MainServiceRow {
    readonly name: string;
    readonly service: MainService;
    readonly startPhase?: MainServicePhase;
    readonly disposalPhase?: MainServiceDisposalPhase;
}

function withStartDependencies<TDependencies>(
    start: (dependencies: TDependencies) => void | Promise<void>,
    dependencies: TDependencies,
): MainService {
    return { start: () => start(dependencies) };
}

const browserCompositionDependencies = {
    cdp: {
        getWebContents: getBrowserWebContentsForCdp,
        onAiVisionSignal: sendBrowserAiVisionSignal,
    },
    networkLogger: {
        resolveWebContentsId: getBrowserRegistrationKeyForWebContents,
        resolveResponseBodies: resolveNetworkResponseBodies,
    },
};

function broadcastMcpStatus(): void {
    openWindows.send("eMcpStatusChanged", {
        running: isMcpHttpServerRunning(),
        url: getMcpUrl(),
        clientCount: getMcpClientCount(),
        inAppAgentCount: getPrivateMcpClientCount(),
    });
}

function startBrowserComposition(dependencies: typeof browserCompositionDependencies): void {
    initializeBrowserService();
    startCdpService(dependencies.cdp);
    initNetworkLogger(dependencies.networkLogger);
}

const mainServiceTable: readonly MainServiceRow[] = [
    {
        name: "audio",
        service: { start: () => audioService.initialize(), dispose: () => audioService.dispose() },
        startPhase: "setup-before-certificate",
        disposalPhase: "quit",
    },
    {
        name: "capability routing",
        service: {
            start: () => {
                const dependencies: CapabilityBackendRegistryStartDependencies = {
                    audioBackend: new AudioBackend(audioService),
                    boardServiceBackend: new BoardServiceBackend(moduleServiceSupervisor, capabilityRouter),
                    serviceOwnerTracker: (boardRoot, onClosed) => moduleServiceSupervisor.trackServiceOwner(boardRoot, onClosed),
                };
                capabilityBackendRegistry.start(dependencies);
            },
        },
        startPhase: "setup-before-certificate",
    },
    {
        name: "module-service settings listener",
        service: { start: () => moduleServiceSupervisor.boardSettings.start() },
        startPhase: "setup-before-certificate",
    },
    {
        name: "permission policy",
        service: withStartDependencies((dependencies: PermissionPolicyStartDependencies) => initPermissionPolicy(dependencies), {
            promptHandler: createBrowserPermissionPromptHandler(),
            audioWindowTargetResolver: () => audioService.windowContents,
        }),
        startPhase: "setup-after-certificate-before-ipc",
    },
    {
        name: "browser user agent",
        service: { start: initBrowserUserAgent },
        startPhase: "setup-after-certificate-before-ipc",
    },
    {
        name: "board trust consumers",
        service: { start: subscribeBoardTrustConsumers },
        startPhase: "setup-after-certificate-before-ipc",
    },
    {
        name: "board trust initialization",
        service: {
            start: () => {
                void boardTrustService.init().catch((error: unknown) => {
                    console.error(`Board trust initialization failed: ${errMessage(error)}`);
                });
            },
        },
        startPhase: "setup-after-certificate-before-ipc",
    },
    {
        name: "site-extension trust initialization",
        service: {
            start: () => {
                void siteExtensionTrustService.init().catch((error: unknown) => {
                    console.error(`Site extension trust initialization failed: ${errMessage(error)}`);
                });
            },
        },
        startPhase: "setup-after-certificate-before-ipc",
    },
    {
        name: "Windows environment",
        service: { start: reconstructWindowsEnv },
        startPhase: "setup-after-certificate-before-ipc",
    },
    {
        name: "privileged protocol schemes",
        service: {
            start: () => {
                protocol.registerSchemesAsPrivileged([
                    APP_ASSET_SCHEME_PRIVILEGES,
                    {
                        // Tor-routed remote resources for renderer-drawn content.
                        scheme: "tor-src",
                        privileges: { standard: true, secure: true, supportFetchAPI: true },
                    },
                    {
                        // Proxied-profile routed remote resources for renderer-drawn content.
                        scheme: PROFILE_SRC_SCHEME,
                        privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
                    },
                    {
                        // Short-lived private-session capabilities for claimed browser downloads.
                        scheme: "session-src",
                        privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
                    },
                    {
                        // Board delivery is governed by the CSP set by the board handler.
                        scheme: "board",
                        privileges: { standard: true, secure: true, supportFetchAPI: true },
                    },
                    {
                        // Preview documents have their own CSP instead of inheriting the app window's.
                        scheme: "html-preview",
                        privileges: { standard: true, secure: true, supportFetchAPI: true },
                    },
                ]);
            },
        },
        startPhase: "setup-after-certificate-before-ipc",
    },
    {
        name: "browser service",
        service: withStartDependencies(startBrowserComposition, browserCompositionDependencies),
        startPhase: "setup-after-ipc",
    },
    {
        name: "browser network service",
        service: { start: initializeBrowserNetworkService },
        startPhase: "setup-after-ipc",
    },
    {
        name: "download service",
        service: { start: () => downloadService.init() },
        startPhase: "setup-after-ipc",
    },
    {
        name: "Tor",
        service: { dispose: () => torService.shutdown() },
        disposalPhase: "quit",
    },
    {
        name: "command runner",
        service: { dispose: killAllCommands },
        disposalPhase: "quit",
    },
    {
        name: "board ports",
        service: { dispose: disposeAllBoardPorts },
        disposalPhase: "quit",
    },
    {
        name: "ready protocol handlers",
        service: {
            start: () => {
                registerAppAssetProtocol(appPartition);
                registerAppAssetProtocol(fileAccessPersistPartition);
                registerTorSrcProtocol(appPartition);
                registerSessionSrcProtocol(appPartition);
                registerProfileSrcProtocol(appPartition);
                initBoardProtocol(appPartition);
                initHtmlPreviewProtocol(appPartition);
            },
        },
        startPhase: "ready",
    },
    {
        name: "recording service",
        service: {
            start: async () => {
                try {
                    await initializeRecordingService();
                } catch (error: unknown) {
                    console.error(`Recording cleanup initialization failed: ${errMessage(error)}`);
                }
            },
        },
        startPhase: "ready",
    },
    {
        name: "window restoration",
        service: {
            start: () => {
                const boardStartupInput = takeBoardStartupInput();
                openWindows.restoreState(!boardStartupInput);
                if (boardStartupInput) {
                    openWindows.openBoardWindow(boardStartupInput.path);
                    void openWindows.dispatchNormalInputs(takeStartupInputsForMain());
                }
            },
        },
        startPhase: "ready",
    },
    {
        name: "tray setup",
        service: { start: setupTray },
        startPhase: "ready",
    },
    {
        name: "pipe server",
        service: { start: startPipeServer, dispose: stopPipeServer },
        startPhase: "ready",
        disposalPhase: "quit",
    },
    {
        name: "startup maintenance",
        service: {
            start: () => {
                setTimeout(() => {
                    if (!applicationProfileName()) versionService.checkForUpdates();
                    void publishedBoardsService.getPublishedBoards();
                    void boardDownloadService.cleanDownloadsFolder();
                }, 5000);
            },
        },
        startPhase: "ready",
    },
    {
        name: "MCP HTTP server",
        service: { dispose: stopMcpHttpServer },
        disposalPhase: "quit",
    },
    {
        name: "board pipe",
        service: { dispose: () => boardPipeService.dispose() },
        disposalPhase: "quit",
    },
    {
        name: "video stream",
        service: { dispose: stopVideoStreamServer },
        disposalPhase: "quit",
    },
    {
        name: "Mneme",
        service: { dispose: shutdownMneme },
        disposalPhase: "quit",
    },
    {
        name: "clipboard",
        service: { dispose: shutdownClipboard },
        disposalPhase: "quit",
    },
    {
        name: "path watch",
        service: { dispose: shutdownPathWatchService },
        disposalPhase: "before-gate",
    },
    {
        name: "private MCP endpoint",
        service: {
            ...withStartDependencies(startMcpHttpServerService, { statusChanged: broadcastMcpStatus }),
            dispose: shutdownPrivateMcpEndpoint,
        },
        startPhase: "setup-after-certificate-before-ipc",
        disposalPhase: "before-gate",
    },
];

for (const row of mainServiceTable) {
    if (!row.service.start && !row.service.dispose) {
        throw new Error(`Main service "${row.name}" must start, dispose, or both.`);
    }
}

export function startMainServices(phase: MainServicePhase): Promise<void> {
    let pending: Promise<void> | undefined;
    for (const row of mainServiceTable) {
        if (row.startPhase !== phase || !row.service.start) continue;
        if (pending) {
            pending = pending.then(async (): Promise<void> => {
                await row.service.start?.();
            });
            continue;
        }
        const result = row.service.start();
        if (result && typeof result.then === "function") pending = Promise.resolve(result);
    }
    return pending ?? Promise.resolve();
}

export function disposeMainServices(phase: MainServiceDisposalPhase): void {
    const rows = phase === "before-gate" ? mainServiceTable : [...mainServiceTable].reverse();
    for (const row of rows) {
        if (row.disposalPhase !== phase || !row.service.dispose) continue;
        const result = row.service.dispose();
        if (result && typeof result.then === "function") void result;
    }
}
