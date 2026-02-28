import type { ISettings } from "./settings";
import type { IEditorRegistry } from "./editors";
import type { IRecentFiles } from "./recent";
import type { IFileSystem } from "./fs";
import type { IWindow } from "./window";

/**
 * Root application object. Entry point to all app functionality.
 *
 * Available in scripts as the global `app` variable.
 *
 * @example
 * console.log(app.version);
 * app.settings.set("theme", "monokai");
 * app.editors.getAll().forEach(e => console.log(e.name));
 * await app.recent.load();
 * const text = await app.fs.read("C:/file.txt");
 * app.window.maximize();
 */
export interface IApp {
    /** Application version string (e.g. "1.0.17"). */
    readonly version: string;

    /** Application configuration. */
    readonly settings: ISettings;

    /** Read-only registry of all editors. */
    readonly editors: IEditorRegistry;

    /** Recently opened files. Call `load()` before reading `files`. */
    readonly recent: IRecentFiles;

    /** File system operations, dialogs, and OS integration. */
    readonly fs: IFileSystem;

    /** Window management: minimize, maximize, zoom, multi-window. */
    readonly window: IWindow;

    // Phase 3+: ui, shell, pages
}
