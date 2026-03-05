/**
 * A user-configured folder shown in the sidebar.
 */
export interface IMenuFolder {
    /** Unique folder identifier. */
    readonly id: string;
    /** Display name. */
    readonly name: string;
    /** Folder path on disk. */
    readonly path?: string;
    /** Explicit list of file paths (for virtual folders). */
    readonly files?: string[];
}

/**
 * Manage user-configured sidebar folders.
 *
 * Available as `app.menuFolders`.
 *
 * Folders are persisted to `menuFolders.json` in the app data directory
 * and auto-reload when the file changes externally.
 *
 * @example
 * const folders = app.menuFolders.folders;
 * app.menuFolders.add({ name: "My Project", path: "C:/projects/my-app" });
 */
export interface IMenuFolders {
    /** Current list of configured folders. */
    readonly folders: readonly IMenuFolder[];

    /** Add a new folder. Returns the generated ID. */
    add(folder: { name: string; path?: string; files?: string[] }): string;

    /** Remove a folder by ID. */
    remove(id: string): void;

    /** Find a folder by ID. */
    find(id: string): IMenuFolder | undefined;

    /** Reorder: move a folder from one position to another. */
    move(sourceId: string, targetId: string): void;
}
