import type { PagesModel } from "./pages/PagesModel";
import type { LaunchInput } from "../../shared/launch-input";
import type { ILinkData } from "./types/io.link-data";

/** Startup phases run in this order; entries within a phase run in table order. */
export type AppStartupPhase =
    | "bootstrap"
    | "services"
    | "before-pages"
    | "events"
    | "deferred"
    | "before-mount";

/** Values and callbacks the startup table needs from the App composition owner. */
export interface AppStartupContext {
    readonly rendererIndex: Promise<unknown>;
    init(): Promise<void>;
    initSetup(): Promise<void>;
    loadAppServices(): Promise<void>;
    reportServiceFailures(): void;
    reportBackgroundFailure(name: string, error: unknown): void;
    setPages(pages: PagesModel): void;
    getPages(): PagesModel;
    setRendererEventsService(service: { openLaunchInput(input: LaunchInput): Promise<void> }): void;
    openStartupInput(input: LaunchInput): Promise<void>;
    checkEmptyPage(): void;
    notifyMnemeExited(error: string): void;
    openRawLink(link: ILinkData): Promise<void>;
}

/** One operation in the ordered renderer startup table. */
export interface AppStartupEntry {
    readonly name: string;
    readonly phase: AppStartupPhase;
    readonly start: (context: AppStartupContext) => Promise<void> | void;
    readonly background?: true;
    readonly delayMs?: number;
}

export const appStartupEntries: readonly AppStartupEntry[] = [
    {
        name: "bootstrap",
        phase: "bootstrap",
        start: async (context) => {
            await Promise.all([context.rendererIndex, context.init(), context.initSetup()]);
        },
    },
    {
        name: "app-services",
        phase: "services",
        start: (context) => context.loadAppServices(),
    },
    {
        name: "app-service-failures",
        phase: "services",
        start: (context) => context.reportServiceFailures(),
    },
    {
        name: "ui-preferences",
        phase: "services",
        start: async () => {
            const { load } = await import("./ui-preferences");
            await load();
        },
    },
    {
        name: "module-service-status",
        phase: "services",
        start: async () => {
            const { moduleServiceStatus } = await import("./module-service-status");
            await moduleServiceStatus.load();
        },
    },
    {
        name: "filesystem-and-settings-ready",
        phase: "services",
        start: async () => {
            const [{ fs }, { settings }] = await Promise.all([import("./fs"), import("./settings")]);
            await Promise.all([fs.wait(), settings.wait()]);
        },
    },
    {
        name: "board-vars-watch",
        phase: "services",
        start: async () => {
            const { boardVars } = await import("./board-vars/BoardEnvStore");
            boardVars.start();
        },
    },
    {
        name: "theme-service",
        phase: "services",
        start: async () => {
            const [{ themeService }, { settings }] = await Promise.all([
                import("./theme-service"),
                import("./settings"),
            ]);
            themeService.start(settings);
        },
    },
    {
        name: "custom-theme-storage",
        phase: "services",
        start: async () => {
            const { initCustomThemeStorage } = await import("./custom-theme-storage");
            await initCustomThemeStorage();
        },
    },
    {
        name: "published-boards",
        phase: "services",
        background: true,
        start: async () => {
            const { publishedBoards } = await import("./boards/published-boards");
            await publishedBoards.load();
        },
    },
    {
        name: "board-install-registry",
        phase: "services",
        background: true,
        start: async () => {
            const { boardInstallRegistry } = await import("./boards/board-install-registry");
            await boardInstallRegistry.load();
        },
    },
    {
        name: "registered-tools",
        phase: "services",
        background: true,
        start: async () => {
            const { registeredTools } = await import("./tools/registered-tools");
            await registeredTools.ensureInitialized();
        },
    },
    // The renderer trust snapshot and editor registry must be ready before persisted boards restore.
    {
        name: "board-and-editor-registries",
        phase: "before-pages",
        start: async () => {
            const { settings } = await import("./settings");
            await settings.wait();
            const { boardRegistry } = await import("./boards/board-registry");
            await boardRegistry.load();
            await import("./editor-categories");
            const { customEditorRegistry } = await import("./boards/custom-editor-registry");
            await customEditorRegistry.ensureInitialized();
        },
    },
    {
        name: "restore-pages",
        phase: "before-pages",
        start: async (context) => {
            const [{ fs }, { initRendererRpc }] = await Promise.all([
                import("./fs"),
                import("./renderer-rpc-bootstrap"),
            ]);
            await fs.wait();
            // Restored boards may call the renderer bridge immediately; install its queue first.
            initRendererRpc();
            const { pages } = await import("./pages");
            context.setPages(pages);
            await pages.persistence.init();
        },
    },
    {
        name: "event-registrations",
        phase: "events",
        start: async () => {
            const { siteExtensionTrust } = await import("./site-extension-trust");
            siteExtensionTrust.start();
            const { initBoardNavigationReturn } = await import("./board-navigation-return");
            initBoardNavigationReturn();
            const { initAlertEventFeed } = await import("../scripting/ai-vision/alert-watch");
            initAlertEventFeed();

            // EventChannel runs subscribers LIFO, so register the fallback opener first.
            const { registerOpenHandler } = await import("../content/open-handler");
            const { registerResolvers } = await import("../content/resolvers");
            const { registerRawLinkParsers } = await import("../content/parsers");
            const { registerTreeContextMenuHandlers } = await import("../ui/link-menus/tree-context-menus");
            registerOpenHandler();
            registerResolvers();
            registerRawLinkParsers();
            registerTreeContextMenuHandlers();
            const { initPipeResourceServer } = await import("../content/pipe-resource-server");
            const { resolveBoardPagePipe } = await import("./boards/board-page-pipe");
            initPipeResourceServer({ resolvePagePipe: resolveBoardPagePipe });
        },
    },
    {
        name: "event-services",
        phase: "events",
        start: async (context) => {
            const [
                { GlobalEventService },
                { KeyboardService },
                { WindowStateService },
                { RendererEventsService },
            ] = await Promise.all([
                import("./internal/GlobalEventService"),
                import("./internal/KeyboardService"),
                import("./internal/WindowStateService"),
                import("./internal/RendererEventsService"),
            ]);
            const globalEvents = new GlobalEventService();
            const keyboard = new KeyboardService();
            const windowState = new WindowStateService();
            const rendererEvents = new RendererEventsService();
            context.setRendererEventsService(rendererEvents);
            await Promise.all([
                globalEvents.init(),
                keyboard.init(),
                windowState.init(),
                rendererEvents.init(),
            ]);
        },
    },
    {
        name: "renderer-rpc-ready",
        phase: "events",
        // Release requests only after every event-service handler is initialized.
        start: async () => {
            const { markRendererRpcReady } = await import("./renderer-rpc-bootstrap");
            markRendererRpcReady();
        },
    },
    {
        name: "settings-effects",
        phase: "events",
        // Settings subscriptions must start before any startup input can change settings.
        start: async () => {
            const { settings } = await import("./settings");
            await settings.wait();
            const { startSettingsEffects } = await import("./settings-effects");
            startSettingsEffects(settings);
        },
    },
    {
        name: "mneme-exit-notification",
        phase: "events",
        start: async (context) => {
            const ipcRendererEvents = (await import("../../ipc/renderer/renderer-events")).default;
            ipcRendererEvents.eMnemeStatusChanged.subscribe((status) => {
                if (status.error) context.notifyMnemeExited(status.error);
            });
        },
    },
    {
        name: "mneme-and-autoload-startup",
        phase: "deferred",
        delayMs: 1500,
        background: true,
        start: async (context) => {
            try {
                const { mnemeStatusModel } = await import("./mneme-status");
                mnemeStatusModel.init();
                const { mnemeConnection } = await import("./mneme-connection");
                mnemeConnection.init();
            } catch (error) {
                context.reportBackgroundFailure("mneme-startup", error);
            }
            try {
                const { autoloadService } = await import("./autoload-service");
                await autoloadService.loadScripts();
            } catch (error) {
                context.reportBackgroundFailure("autoload-startup", error);
            }
        },
    },
    {
        name: "launch-board-window",
        phase: "before-mount",
        // Resolve and lock the board page before startup inputs can navigate elsewhere.
        start: async (context) => {
            const { appWindow } = await import("./window");
            if (!appWindow.boardRoot) return;
            const { encodePersephoneBoardLink } = await import("../content/persephone-board-link");
            const { createLinkData } = await import("../../shared/link-data");
            await context.openRawLink(createLinkData(encodePersephoneBoardLink(appWindow.boardRoot)));
            const pages = context.getPages();
            const launchedBoardPage = pages.boardPageRouter.findPageByBoardRoot(appWindow.boardRoot);
            if (launchedBoardPage) pages.layout.markLockedBoardPage(launchedBoardPage, appWindow.boardRoot);
        },
    },
    {
        name: "startup-inputs",
        phase: "before-mount",
        start: async (context) => {
            const { api } = await import("../../ipc/renderer/api");
            const startupInputs = await api.getStartupInputs();
            for (const input of startupInputs) {
                await context.openStartupInput(input);
            }
            context.checkEmptyPage();
        },
    },
];

/** Runs one contiguous phase; background work is reported and never blocks its caller. */
export async function runAppStartupPhase(
    phase: AppStartupPhase,
    context: AppStartupContext,
): Promise<void> {
    for (const entry of appStartupEntries) {
        if (entry.phase !== phase) continue;
        if (entry.delayMs !== undefined) {
            setTimeout(() => runBackgroundEntry(entry, context), entry.delayMs);
        } else if (entry.background) {
            void runBackgroundEntry(entry, context);
        } else {
            try {
                await entry.start(context);
            } catch (error) {
                context.reportBackgroundFailure(entry.name, error);
                throw error;
            }
        }
    }
}

async function runBackgroundEntry(entry: AppStartupEntry, context: AppStartupContext): Promise<void> {
    try {
        await entry.start(context);
    } catch (error) {
        context.reportBackgroundFailure(entry.name, error);
    }
}
