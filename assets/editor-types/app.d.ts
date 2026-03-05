import type { ISettings } from "./settings";
import type { IEditorRegistry } from "./editors";
import type { IRecentFiles } from "./recent";
import type { IFileSystem } from "./fs";
import type { IWindow } from "./window";
import type { IShell } from "./shell";
import type { IUserInterface } from "./ui";
import type { IDownloads } from "./downloads";
import type { IMenuFolders } from "./menu-folders";
import type { IPageCollection } from "./pages";

/**
 * Root application object. Entry point to all app functionality.
 *
 * Available in scripts as the global `app` variable.
 *
 * @example
 * console.log(app.version);
 * app.settings.set("theme", "monokai");
 * app.pages.all.forEach(p => console.log(p.title));
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

    /** OS integration: open URLs, encryption, version info. */
    readonly shell: IShell;

    /** Dialogs and notifications. */
    readonly ui: IUserInterface;

    /** Global download tracking. */
    readonly downloads: IDownloads;

    /** User-configured sidebar folders. */
    readonly menuFolders: IMenuFolders;

    /** Open pages (tabs) in the current window. */
    readonly pages: IPageCollection;
}
