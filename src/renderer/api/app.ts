import { api } from "../../ipc/renderer/api";
import ipcRendererEvents from "../../ipc/renderer/renderer-events";
import type { PagesModel } from "./pages/PagesModel";
import { AppEvents } from "./events/AppEvents";
import { createLinkData } from "../../shared/link-data";
import type { IFetchOptions } from "./types/app";
import { errMessage } from "../../shared/utils";
import {
    appServiceDescriptors,
    type AppServiceKey,
    type AppServiceSurface,
} from "./app-service-registry";

// Note: IApp (.d.ts) is the script-facing interface for Monaco IntelliSense.
// App class has additional internal methods (init, initServices, initPages, initEvents)
// and uses rich internal types (PagesModel instead of IPageCollection).
class App {
    private _version = "";
    private _initialized = false;
    private _setupInitialized = false;
    private _servicesInitialization: Promise<void> | undefined;
    private _pagesInitialized = false;
    private _eventsInitialized = false;

    private readonly _serviceValues: Partial<
        Record<AppServiceKey, AppServiceSurface[AppServiceKey]>
    > = {};
    private readonly _serviceFailures = new Map<
        AppServiceKey,
        { phase: "load" | "initialize"; error: unknown }
    >();
    private _pages = undefined as unknown as PagesModel;
    private _events = new AppEvents();

    constructor() {
        for (const { key } of appServiceDescriptors) {
            Object.defineProperty(this, key, {
                get: () => this._serviceValues[key],
            });
        }
    }

    get version(): string {
        return this._version;
    }

    get pages(): PagesModel {
        return this._pages;
    }

    get events(): AppEvents {
        return this._events;
    }

    fetch = async (url: string, options?: IFetchOptions): Promise<Response> => {
        const { nodeFetch } = await import("./node-fetch");
        return nodeFetch(url, options);
    };

    openRawLink = async (href: string, options?: { editor?: string }): Promise<void> => {
        await this._events.openRawLink.sendAsync(
            createLinkData(href, { sourceId: "app-api", target: options?.editor }),
        );
    };

    /**
     * Initialize version. Called early in bootstrap (renderer.tsx).
     * Not exposed to scripts.
     */
    async init(): Promise<void> {
        if (this._initialized) return;
        this._initialized = true;

        this._version = await api.getAppVersion();
    }

    /**
     * Configure Monaco editor (themes, languages, keybindings, type definitions).
     * Called early in bootstrap before services or editors load.
     * Not exposed to scripts.
     */
    async initSetup(): Promise<void> {
        if (this._setupInitialized) return;
        this._setupInitialized = true;

        const { initMonaco } = await import("./setup/configure-monaco");
        await initMonaco();
    }

    /**
     * Load interface wrappers via dynamic import().
     * Must be called AFTER the main bundle has loaded (so stores are in the
     * module cache). Called during renderer bootstrap before the initial UI is built.
     * Not exposed to scripts.
     */
    async initServices(): Promise<void> {
        if (!this._servicesInitialization) {
            this._servicesInitialization = this._loadServices();
        }
        await this._servicesInitialization;
    }

    private async _loadServices(): Promise<void> {
        for (const descriptor of appServiceDescriptors) {
            let value: AppServiceSurface[AppServiceKey];
            try {
                value = await descriptor.load();
            } catch (error) {
                this._serviceFailures.set(descriptor.key, {
                    phase: "load",
                    error,
                });
                continue;
            }

            this._serviceValues[descriptor.key] = value;

            if (descriptor.initialize) {
                try {
                    await descriptor.initialize(value as never);
                } catch (error) {
                    this._serviceFailures.set(descriptor.key, {
                        phase: "initialize",
                        error,
                    });
                }
            }
        }

        const { load: loadUiPreferences } = await import("./ui-preferences");
        await loadUiPreferences();
        const { initModuleServiceStatus } = await import("./module-service-status");
        await initModuleServiceStatus();
        this._reportServiceFailures();

        // Subscribe the published-boards catalog model to main's broadcast and pull the
        // initial catalog (US-862). Fire-and-forget — no view blocks on it, and a fetch
        // failure is named but does not block startup (cached catalog / empty).
        import("./published-boards")
            .then(({ publishedBoards }) => publishedBoards.load())
            .catch((error: unknown) => this._reportBackgroundFailure("published-boards", error));

        // Load the board install registry so update checks / "already installed" filters
        // have data (US-863). Fire-and-forget; reconciles stale entries on load.
        import("./board-install-registry")
            .then(({ boardInstallRegistry }) => boardInstallRegistry.load())
            .catch((error: unknown) => this._reportBackgroundFailure("board-install-registry", error));

        // Hydrate the Agent Tools registry so the `tools` call node can answer without
        // initializing (and therefore mutating) it on a read (US-1328). Fire-and-forget,
        // like the two above: nothing blocks on it, and `registeredTools.isInitialized`
        // lets the node fail closed until it lands.
        import("./tools/registered-tools")
            .then(({ registeredTools }) => registeredTools.ensureInitialized())
            .catch((error: unknown) => this._reportBackgroundFailure("registered-tools", error));
    }

    private _reportServiceFailures(): void {
        for (const { key } of appServiceDescriptors) {
            const failure = this._serviceFailures.get(key);
            if (failure) {
                console.error(
                    `[App] Service "${key}" failed to ${failure.phase}: ${errMessage(failure.error)}`,
                    failure.error,
                );
            } else if (this._serviceValues[key] === undefined) {
                console.error(`[App] Service "${key}" is missing after initialization`);
            }
        }
    }

    private _reportBackgroundFailure(name: string, error: unknown): void {
        console.error(`[App] Background hydration "${name}" failed: ${errMessage(error)}`, error);
    }

    /**
     * Initialize pages. Called in bootstrap (renderer.tsx) after initServices().
     * Ensures filesystem is ready, then restores persisted pages and handles CLI arguments.
     * Not exposed to scripts.
     */
    async initPages(): Promise<void> {
        if (this._pagesInitialized) return;
        this._pagesInitialized = true;

        // Ensure filesystem paths are initialized before restoring pages.
        // Previously, a 100ms setTimeout in fs.ts worked around this race condition.
        // With explicit bootstrap, we properly await readiness.
        const { fs: appFs } = await import("./fs");
        await appFs.wait();

        const { pages } = await import("./pages");
        this._pages = pages;

        await pages.init();
    }

    /**
     * Initialize event handlers. Called in bootstrap (renderer.tsx) after initPages().
     * Subscribes to global events, keyboard shortcuts, IPC events, etc.
     * Not exposed to scripts.
     */
    async initEvents(): Promise<void> {
        if (this._eventsInitialized) return;
        this._eventsInitialized = true;
        const services = this as unknown as AppServiceSurface;

        // The navigation-return registry owns the sole browser URL claim subscription.
        // Initialize it after pages exist and before any browser or board view mounts.
        const { initBoardNavigationReturn } = await import("./board-navigation-return");
        initBoardNavigationReturn();

        // Error/warning toasts reach the agent event feed, so an agent sees a failure it caused
        // on its very next call instead of having to think to ask ui.alerts.list().
        const { initAlertEventFeed } = await import("../scripting/ai-vision/alert-watch");
        initAlertEventFeed();

        // Register link pipeline handlers first — they're the fallback handlers
        // (oldest in LIFO, run last). Scripts subscribe later and run first.
        // Registration order: opener first (runs last in LIFO), then resolvers, then parsers.
        const { registerOpenHandler } = await import("../content/open-handler");
        const { registerResolvers } = await import("../content/resolvers");
        const { registerRawLinkParsers } = await import("../content/parsers");
        const { registerTreeContextMenuHandlers } = await import("../content/tree-context-menus");
        registerOpenHandler();
        registerResolvers();
        registerRawLinkParsers();
        registerTreeContextMenuHandlers();
        const { initBoardPipeHandler } = await import("../editors/board/board-pipe-handler");
        initBoardPipeHandler();

        // Import and initialize all event services
        const [
            { GlobalEventService },
            { KeyboardService },
            { WindowStateService },
            { RendererEventsService },
            { initMcpHandler },
        ] = await Promise.all([
            import("./internal/GlobalEventService"),
            import("./internal/KeyboardService"),
            import("./internal/WindowStateService"),
            import("./internal/RendererEventsService"),
            import("./mcp-handler"),
        ]);

        // Create service instances
        const globalEvents = new GlobalEventService();
        const keyboard = new KeyboardService();
        const windowState = new WindowStateService();
        const rendererEvents = new RendererEventsService();

        // Initialize all services in parallel
        await Promise.all([
            globalEvents.init(),
            keyboard.init(),
            windowState.init(),
            rendererEvents.init(),
        ]);

        // Initialize MCP command handler (listens for IPC from main process)
        initMcpHandler();

        // Mirror the renderer-owned trust decision to main for module-service
        // supervision. This is process-lifetime bootstrap wiring, not an app API
        // service and it never starts a board service by itself.
        import("./board-trust-sync")
            .then(({ initBoardTrustSync }) => initBoardTrustSync())
            .catch((error: unknown) => {
                console.error(`Board service trust sync failed: ${errMessage(error)}`);
            });

        // Ensure settings are loaded from disk before checking mcp.enabled
        const { settings: settingsInstance, normalizeClipboardMaxItems } = await import("./settings");
        await settingsInstance.wait();
        api.setMainScriptsEnabled(!!services.settings.get("main.scripting.enabled"));

        // Defer MCP auto-start and autoload scripts to not block window rendering
        setTimeout(async () => {
            if (services.settings.get("mcp.enabled")) {
                const port = services.settings.get("mcp.port") as number | undefined;
                api.setMcpEnabled(true, port || undefined);
            }

            // Auto-start Mneme if enabled. Toast only on failure here (success on every
            // launch would be noisy); user-initiated toggles toast success below.
            if (services.settings.get("mneme.enabled")) {
                const mnemePort = services.settings.get("mneme.port") as number | undefined;
                api.setMnemeEnabled(true, mnemePort || undefined).then((status) => {
                    if (!status.running) {
                        services.ui.notify(`Mneme failed to start: ${status.error ?? "unknown error"}`, "error");
                    }
                });
            }

            const clipboardEnabled = !!services.settings.get("clipboard.enabled");
            const clipboardMaxItems = normalizeClipboardMaxItems(
                services.settings.get("clipboard.max-items"),
            );
            void api.setClipboardEnabled(clipboardEnabled, clipboardMaxItems).then((status) => {
                if (clipboardEnabled && status.error) {
                    services.ui.notify(`Clipboard tracker failed to start: ${status.error}`, "error");
                }
            });

            // Initialize the shared Mneme health model that drives the header
            // indicator (and is read by the Mneme config editor).
            try {
                const { mnemeStatusModel } = await import("./mneme-status");
                mnemeStatusModel.init();
                const { mnemeConnection } = await import("./mneme-connection");
                mnemeConnection.init();
            } catch (error) {
                console.error("Mneme status model init failed:", error);
            }

            // Load autoload scripts from Script Library
            try {
                const { autoloadService } = await import("./autoload-service");
                await autoloadService.loadScripts();
            } catch (error) {
                console.error("Autoload scripts failed:", error);
            }
        }, 1500);

        // App.initEvents() owns this process-lifetime wiring; it is not a view/model resource.
        // Keep these subscriptions alive until the renderer process exits.
        // Watch for mcp.enabled setting changes
        services.settings.onChanged.subscribe(({ key, value }) => {
            if (key === "main.scripting.enabled") {
                api.setMainScriptsEnabled(!!value);
            }
            if (key === "mcp.enabled") {
                const port = services.settings.get("mcp.port") as number | undefined;
                api.setMcpEnabled(!!value, port || undefined);
            }
            if (key === "mneme.enabled") {
                const mnemePort = services.settings.get("mneme.port") as number | undefined;
                api.setMnemeEnabled(!!value, mnemePort || undefined).then((status) => {
                    if (!value) return; // silent on intentional stop
                    if (status.running) {
                        services.ui.notify("Mneme started", "success");
                    } else {
                        services.ui.notify(`Mneme failed to start: ${status.error ?? "unknown error"}`, "error");
                    }
                });
            }
            if (key === "clipboard.enabled" || key === "clipboard.max-items") {
                const clipboardEnabled = !!services.settings.get("clipboard.enabled");
                const clipboardMaxItems = normalizeClipboardMaxItems(
                    services.settings.get("clipboard.max-items"),
                );
                void api.setClipboardEnabled(clipboardEnabled, clipboardMaxItems);
            }
        });

        // Toast unexpected Mneme exits (crash after a successful start).
        ipcRendererEvents.eMnemeStatusChanged.subscribe((s) => {
            if (s.error) {
                services.ui.notify(`Mneme: ${s.error}`, "error");
            }
        });
    }
}

/**
 * The root application object.
 * Available in scripts as the global `app` variable.
 */
export const app = new App() as App & AppServiceSurface;
