import { api } from "../../ipc/renderer/api";
import type { ISettings } from "./types/settings";
import type { IEditorRegistry } from "./types/editors";
import type { IRecentFiles } from "./types/recent";
import type { IFileSystem } from "./types/fs";
import type { IWindow } from "./types/window";
import type { IShell } from "./types/shell";
import type { IUserInterface } from "./types/ui";
import type { IDownloads } from "./types/downloads";
import type { PagesModel } from "./pages/PagesModel";

// Note: IApp (.d.ts) is the script-facing interface for Monaco IntelliSense.
// App class has additional internal methods (init, initServices, initPages, initEvents)
// and uses rich internal types (PagesModel instead of IPageCollection).
class App {
    private _version = "";
    private _initialized = false;
    private _servicesInitialized = false;
    private _pagesInitialized = false;
    private _eventsInitialized = false;

    // Initialized by initServices() after main bundle loads.
    // Getters are safe: scripts only run after bootstrap completes.
    private _settings = undefined as unknown as ISettings;
    private _editors = undefined as unknown as IEditorRegistry;
    private _recent = undefined as unknown as IRecentFiles;
    private _fs = undefined as unknown as IFileSystem;
    private _window = undefined as unknown as IWindow;
    private _shell = undefined as unknown as IShell;
    private _ui = undefined as unknown as IUserInterface;
    private _downloads = undefined as unknown as IDownloads;
    private _pages = undefined as unknown as PagesModel;

    get version(): string {
        return this._version;
    }

    get settings(): ISettings {
        return this._settings;
    }

    get editors(): IEditorRegistry {
        return this._editors;
    }

    get recent(): IRecentFiles {
        return this._recent;
    }

    get fs(): IFileSystem {
        return this._fs;
    }

    get window(): IWindow {
        return this._window;
    }

    get shell(): IShell {
        return this._shell;
    }

    get ui(): IUserInterface {
        return this._ui;
    }

    get downloads(): IDownloads {
        return this._downloads;
    }

    get pages(): PagesModel {
        return this._pages;
    }

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
     * Load interface wrappers via dynamic import().
     * Must be called AFTER the main bundle has loaded (so stores are in the
     * module cache). Called from bootstrap (renderer.tsx) before React renders.
     * Not exposed to scripts.
     */
    async initServices(): Promise<void> {
        if (this._servicesInitialized) return;
        this._servicesInitialized = true;

        const [{ settings }, { editors }, { recent }, { fs }, win, { shell }, { ui }, { downloads }] = await Promise.all([
            import("./settings"),
            import("./editors"),
            import("./recent"),
            import("./fs"),
            import("./window"),
            import("./shell"),
            import("./ui"),
            import("./downloads"),
        ]);
        this._settings = settings;
        this._editors = editors;
        this._recent = recent;
        this._fs = fs;
        this._window = win.appWindow;
        this._shell = shell;
        this._ui = ui;
        this._downloads = downloads;

        // Initialize downloads tracking
        await this._downloads.init();
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

        // Import and initialize all event services
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
    }
}

/**
 * The root application object.
 * Available in scripts as the global `app` variable.
 */
export const app = new App();
