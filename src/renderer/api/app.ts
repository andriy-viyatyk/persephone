import { api } from "../../ipc/renderer/api";
import type { IApp } from "./types/app";
import type { ISettings } from "./types/settings";
import type { IEditorRegistry } from "./types/editors";
import type { IRecentFiles } from "./types/recent";
import type { IFileSystem } from "./types/fs";
import type { IWindow } from "./types/window";
import type { IShell } from "./types/shell";
import type { IUserInterface } from "./types/ui";

class App implements IApp {
    private _version = "";
    // Initialized by initServices() after main bundle loads.
    // Getters are safe: scripts only run after bootstrap completes.
    private _settings = undefined as unknown as ISettings;
    private _editors = undefined as unknown as IEditorRegistry;
    private _recent = undefined as unknown as IRecentFiles;
    private _fs = undefined as unknown as IFileSystem;
    private _window = undefined as unknown as IWindow;
    private _shell = undefined as unknown as IShell;
    private _ui = undefined as unknown as IUserInterface;

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

    /**
     * Initialize version. Called early in bootstrap (renderer.tsx).
     * Not exposed to scripts.
     */
    async init(): Promise<void> {
        this._version = await api.getAppVersion();
    }

    /**
     * Load interface wrappers via dynamic import().
     * Must be called AFTER the main bundle has loaded (so stores are in the
     * module cache). Called from bootstrap (renderer.tsx) before React renders.
     * Not exposed to scripts.
     */
    async initServices(): Promise<void> {
        const [{ settings }, { editors }, { recent }, { fs }, win, { shell }, { ui }] = await Promise.all([
            import("./settings"),
            import("./editors"),
            import("./recent"),
            import("./fs"),
            import("./window"),
            import("./shell"),
            import("./ui"),
        ]);
        this._settings = settings;
        this._editors = editors;
        this._recent = recent;
        this._fs = fs;
        this._window = win.appWindow;
        this._shell = shell;
        this._ui = ui;
    }
}

/**
 * The root application object.
 * Available in scripts as the global `app` variable.
 */
export const app = new App();
