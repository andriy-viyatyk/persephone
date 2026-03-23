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
import type { IAppEvents } from "./events";

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

    /** Application event channels for scripting integration. */
    readonly events: IAppEvents;

    /**
     * Make an HTTP request using Node.js (bypasses Chromium headers).
     * Full header control — no automatic Origin, User-Agent, Sec-Fetch-*, etc.
     * Returns a standard web Response object.
     *
     * @example
     * const res = await app.fetch("https://api.example.com/users");
     * const data = await res.json();
     *
     * @example
     * const res = await app.fetch("https://api.example.com/users", {
     *     method: "POST",
     *     headers: {
     *         "Content-Type": "application/json",
     *         "Authorization": "Bearer token123",
     *     },
     *     body: JSON.stringify({ name: "John" }),
     * });
     */
    fetch(url: string, options?: IFetchOptions): Promise<Response>;
}

/**
 * Options for `app.fetch()`.
 */
export interface IFetchOptions {
    /** HTTP method. Default: "GET". */
    method?: string;
    /** Request headers. Sent exactly as specified — no automatic headers added. */
    headers?: Record<string, string>;
    /** Request body — string or ReadableStream. */
    body?: string | ReadableStream | null;
    /** Request timeout in milliseconds. Default: 30000. */
    timeout?: number;
    /** Maximum number of redirects to follow. Default: 10. */
    maxRedirects?: number;
    /** Set to false to skip SSL certificate validation (e.g. self-signed certs). Default: true. */
    rejectUnauthorized?: boolean;
}
