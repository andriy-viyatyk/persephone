/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { app, components, net, protocol, session } from "electron";
import path from "node:path";
import { appPartition, fileAccessPersistPartition } from "./constants";
import { controller } from "../ipc/main/controller";
import { getAssetPath, launchOperands, parseLaunchArguments } from "./utils";
import { pathToFileURL } from "node:url";
import { openWindows } from "./open-windows";
import { setupTray } from "./tray-setup";
import { versionService } from "./version-service";
import { initSearchHandlers } from "./search-service";
import { initBrowserHandlers, initBrowserUserAgent } from "./browser-service";
import { initTorHandlers, torService } from "./tor-service";
import { registerTorSrcProtocol } from "./tor-src-protocol";
import { registerSessionSrcProtocol } from "./session-src-protocol";
import { initBrowserNetworkHandlers, registerProfileSrcProtocol } from "./browser-network-service";
import { PROFILE_SRC_SCHEME } from "../ipc/browser-network-ipc";
import { initWorkerHost } from "./worker-host";
import { initCommandRunner, killAllCommands } from "./command-runner";
import { disposeAllBoardPorts } from "./board-bridge";
import { startPipeServer, stopPipeServer } from "./pipe-server";
import { stopMcpHttpServer } from "./mcp-http-server";
import { shutdownMneme } from "./mneme-service";
import { shutdownClipboard } from "./clipboard-service";
import { stopVideoStreamServer } from "./video-stream-server";
import { downloadService } from "./download-service";
import { reconstructWindowsEnv } from "./windows-env";
import { moduleServiceSupervisor } from "./module-service-supervisor";
import { boardTrustService } from "./board-trust-service";
import { boardPipeService } from "./board-pipe-service";
import { SERVICE_QUIT_GATE_TIMEOUT_MS } from "../ipc/module-service-channels";
import { errMessage } from "../shared/utils";
import { initPermissionPolicy } from "./permission-policy-service";

export function setupMainProcess() {
    // Permission handlers must be present before any renderer or webview session is created.
    initPermissionPolicy();
    // Likewise the fallback User-Agent: a renderer process reads it when it starts.
    initBrowserUserAgent();
    // Load the main-owned board trust state before restored renderer windows can request services.
    void boardTrustService.init().catch((error: unknown) => {
        console.error(`Board trust initialization failed: ${errMessage(error)}`);
    });

    // US-800: recover standard Windows folder/system env vars before any child
    // process is spawned, in case the app was launched from a degraded shell.
    reconstructWindowsEnv();

    protocol.registerSchemesAsPrivileged([
        {
            scheme: "app-asset",
            privileges: {
                standard: true,
                secure: true,
                supportFetchAPI: true,
                bypassCSP: true,
                // Fetched cross-origin from the renderer (editor-type .d.ts,
                // libarchive.wasm). Electron 43 / Chromium requires explicit
                // corsEnabled for custom-scheme cross-origin fetch — without it
                // the dev origin (http://localhost:5273) is blocked by CORS.
                corsEnabled: true,
            },
        },
        {
            // Tor-routed remote resources for renderer-drawn content (US-896).
            // The app renderer is not covered by a Tor page's session proxy, so
            // e.g. the Link editor's bookmark images opt in via this scheme.
            scheme: "tor-src",
            privileges: {
                standard: true,
                secure: true,
                supportFetchAPI: true,
            },
        },
        {
            // Proxied-profile routed remote resources for renderer-drawn content (US-1557):
            // the `tor-src` counterpart for browser profiles behind a proxy.
            scheme: PROFILE_SRC_SCHEME,
            privileges: {
                standard: true,
                secure: true,
                supportFetchAPI: true,
                // The favicon cache reads routed bytes with renderer fetch(), cross-origin.
                corsEnabled: true,
            },
        },
        {
            // Short-lived private-session capabilities for claimed browser downloads (US-1531).
            scheme: "session-src",
            privileges: {
                standard: true,
                secure: true,
                supportFetchAPI: true,
                // HttpProvider fetches it from the renderer origin, which is cross-origin.
                corsEnabled: true,
            },
        },
        {
            // Board frontend delivery (EPIC-034 / US-723). NOT bypassCSP — board
            // pages are governed by the CSP the board:// handler sets (forbids remote).
            scheme: "board",
            privileges: {
                standard: true,
                secure: true,
                supportFetchAPI: true,
            },
        },
        {
            // Native HTML preview documents (US-1590). A srcdoc frame would inherit the main window's
            // strict CSP; this scheme serves each preview with its own (the pre-US-1590 policy).
            scheme: "html-preview",
            privileges: { standard: true, secure: true },
        },
    ]);

    controller.init();
    initSearchHandlers();
    initBrowserHandlers();
    initTorHandlers();
    initBrowserNetworkHandlers();
    initWorkerHost();
    initCommandRunner();
    downloadService.init();

    function registerAssetProtocol(partition: string) {
        const customSession = session.fromPartition(partition);

        customSession.protocol.handle("app-asset", (request) => {
            const parsedUrl = new URL(request.url);

            let relativePath = path.join(parsedUrl.host, parsedUrl.pathname);

            if (
                relativePath.startsWith(path.sep) ||
                relativePath.startsWith("/")
            ) {
                relativePath = relativePath.substring(1);
            }

            const file = path.join(getAssetPath(), relativePath);
            const fileUrl = pathToFileURL(file).toString();

            return net.fetch(fileUrl, { bypassCustomProtocolHandlers: true });
        });
    }

    app.on("ready", async () => {
        // Ensure Widevine CDM is available (Castlabs Electron downloads it automatically)
        try {
            await components.whenReady();
            console.log("Widevine CDM ready:", components.status());
        } catch (err) {
            console.warn("Widevine CDM initialization failed:", err);
        }

        registerAssetProtocol(appPartition);
        registerAssetProtocol(fileAccessPersistPartition);
        // US-896 — lets renderer-drawn content (the Link editor's bookmark images on
        // a Tor page's blank tab) fetch a remote URL through that page's Tor session.
        // Only the app window's session needs it — do not widen to other partitions.
        registerTorSrcProtocol(appPartition);
        registerSessionSrcProtocol(appPartition);
        registerProfileSrcProtocol(appPartition);
        // Single host-routed board:// handler on the main window's session (EPIC-037 /
        // US-770) — boards load board://<host> iframes in this session, routed by host.
        const { initBoardProtocol } = await import("./board-protocol-service");
        initBoardProtocol(appPartition);
        const { initHtmlPreviewProtocol } = await import("./html-preview-protocol");
        initHtmlPreviewProtocol(appPartition);
        openWindows.restoreState();
        setupTray();
        startPipeServer();

        // Check for updates after a short delay to not slow down startup
        setTimeout(() => {
            versionService.checkForUpdates();
            // Refresh the published-boards catalog on the same 24h-gated cadence (US-862).
            import("./published-boards-service").then(({ publishedBoardsService }) =>
                publishedBoardsService.getPublishedBoards(),
            );
            // Sweep any board-download ZIP orphaned by a crash mid-download (US-863).
            import("./board-download-service").then(({ boardDownloadService }) =>
                boardDownloadService.cleanDownloadsFolder(),
            );
        }, 5000);
    });

    let serviceQuitGateStarted = false;
    let serviceQuitGateReleased = false;

    app.on("will-quit", (event) => {
        if (!serviceQuitGateReleased) {
            event.preventDefault();
            if (!serviceQuitGateStarted) {
                serviceQuitGateStarted = true;
                void (async () => {
                    try {
                        const disposal = moduleServiceSupervisor.disposeAll().catch((error: unknown) => {
                            console.warn(`Module service disposal failed: ${errMessage(error)}`);
                        });
                        await Promise.race([
                            disposal,
                            new Promise<void>((resolve) => setTimeout(resolve, SERVICE_QUIT_GATE_TIMEOUT_MS)),
                        ]);
                    } finally {
                        // `app.quit()` must run on every path. A throw here would leave the gate
                        // latched and the app unquittable, which is worse than an orphaned child.
                        try {
                            moduleServiceSupervisor.forceKillAllSync();
                        } catch (error: unknown) {
                            console.warn(`Module service force-kill failed: ${errMessage(error)}`);
                        }
                        serviceQuitGateReleased = true;
                        app.quit();
                    }
                })();
            }
        }
        torService.shutdown();
        killAllCommands();
        disposeAllBoardPorts();
        stopPipeServer();
        stopMcpHttpServer();
        stopVideoStreamServer();
        boardPipeService.dispose();
        shutdownMneme();
        shutdownClipboard();
    });

    app.on("window-all-closed", () => {
        if (process.platform !== "darwin") {
            app.quit();
        }
    });

    app.on("second-instance", (event, commandLine, workingDirectory) => {
        openWindows.bringToFront();
        const inputs = parseLaunchArguments(launchOperands(commandLine), workingDirectory);
        inputs.forEach((input) => openWindows.handleLaunchInput(input));
    });
}
