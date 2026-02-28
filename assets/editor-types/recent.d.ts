/**
 * Access and manage the list of recently opened files.
 *
 * Available as `app.recent`.
 *
 * **Important:** The file list is loaded lazily. `files` returns `[]` until
 * `load()` has been called — either by the sidebar UI or manually by a script.
 *
 * @example
 * await app.recent.load();
 * console.log(app.recent.files);
 *
 * await app.recent.add("C:/docs/notes.txt");
 * await app.recent.clear();
 */
export interface IRecentFiles {
    /** Currently loaded list of recent file paths (most recent first). */
    readonly files: string[];

    /**
     * Load the recent files list from disk.
     * Must be called at least once before `files` returns data.
     * Safe to call multiple times — reloads from disk each time.
     */
    load(): Promise<void>;

    /** Add a file path to the top of the recent list. Deduplicates and caps at 100. */
    add(filePath: string): Promise<void>;

    /** Remove a file path from the recent list. */
    remove(filePath: string): Promise<void>;

    /** Clear all recent files. */
    clear(): Promise<void>;
}
