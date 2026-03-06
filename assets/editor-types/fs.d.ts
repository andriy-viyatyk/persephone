/**
 * Result of reading a text file with encoding information.
 * Used by app code that needs to preserve encoding (e.g., TextPageModel).
 */
export interface ITextFile {
    /** File content as string. */
    readonly content: string;
    /** Detected or specified encoding (e.g., "utf-8", "utf-16le", "windows-1251"). */
    readonly encoding: string;
}

/** File type filter for open/save dialogs. */
export interface IFileFilter {
    /** Display name (e.g., "Text Files"). */
    name: string;
    /** Extensions without dots (e.g., ["txt", "md"]). */
    extensions: string[];
}

/** Options for the native Open File dialog. */
export interface IOpenDialogOptions {
    /** Dialog window title. */
    title?: string;
    /** Initial directory or file path. */
    defaultPath?: string;
    /** File type filters. */
    filters?: IFileFilter[];
    /** Allow selecting multiple files (default: false). */
    multiSelect?: boolean;
}

/** Options for the native Save File dialog. */
export interface ISaveDialogOptions {
    /** Dialog window title. */
    title?: string;
    /** Suggested file name or path. */
    defaultPath?: string;
    /** File type filters. */
    filters?: IFileFilter[];
}

/** Options for the native Select Folder dialog. */
export interface IFolderDialogOptions {
    /** Dialog window title. */
    title?: string;
    /** Initial directory. */
    defaultPath?: string;
}

/**
 * Unified file system API.
 *
 * Combines direct Node.js file operations (read/write/exists/delete)
 * with IPC-based dialogs (open/save/folder) and OS integration
 * (commonFolder, showInExplorer).
 *
 * Used by both application code and scripts.
 *
 * @example
 * // Simple read (scripts)
 * const text = await app.fs.read("C:/data/file.txt");
 *
 * // Full read with encoding info (app code)
 * const { content, encoding } = await app.fs.readFile("C:/data/file.txt");
 *
 * // Write with specific encoding
 * await app.fs.write("C:/data/out.txt", content, "utf-16le");
 *
 * // Show open dialog
 * const paths = await app.fs.showOpenDialog({ filters: [{ name: "JSON", extensions: ["json"] }] });
 */
export interface IFileSystem {
    // ── File I/O — simple (for scripts) ──────────────────────────────

    /**
     * Read a text file with auto-detected encoding.
     * @param filePath Absolute path to file.
     * @param encoding Optional encoding override.
     * @returns File content as string.
     */
    read(filePath: string, encoding?: string): Promise<string>;

    // ── File I/O — full (for app code and scripts needing encoding) ──

    /**
     * Read a text file, returning content and detected encoding.
     * @param filePath Absolute path to file.
     * @param encoding Optional encoding override.
     * @returns Object with content and encoding.
     */
    readFile(filePath: string, encoding?: string): Promise<ITextFile>;

    /**
     * Read a file as binary data.
     * @param filePath Absolute path to file.
     */
    readBinary(filePath: string): Promise<Buffer>;

    /**
     * Write text content to a file. Creates parent directories if needed.
     * @param filePath Absolute path to file.
     * @param content Text content to write.
     * @param encoding Encoding to use (default: "utf-8").
     */
    write(filePath: string, content: string, encoding?: string): Promise<void>;

    /**
     * Write binary data to a file. Creates parent directories if needed.
     * @param filePath Absolute path to file.
     * @param data Binary data to write.
     */
    writeBinary(filePath: string, data: Buffer): Promise<void>;

    /**
     * Check if a file or directory exists.
     * @param filePath Absolute path to check.
     */
    exists(filePath: string): Promise<boolean>;

    /**
     * Delete a file. No-op if file doesn't exist.
     * @param filePath Absolute path to file.
     */
    delete(filePath: string): Promise<void>;

    // ── Directory operations ────────────────────────────────────────

    /**
     * List files and directories in a folder.
     * @param dirPath Absolute path to directory.
     * @param pattern Optional extension filter (e.g., ".json") or RegExp.
     * @returns Array of file/directory names (not full paths). Empty array if directory doesn't exist.
     */
    listDir(dirPath: string, pattern?: string | RegExp): Promise<string[]>;

    /**
     * Create a directory (and parent directories if needed). No-op if already exists.
     * @param dirPath Absolute path to directory.
     */
    mkdir(dirPath: string): Promise<void>;

    // ── Path resolution ──────────────────────────────────────────────

    /**
     * Resolve a relative path within the per-window app data folder.
     * Supports `{windowIndex}` placeholder in the path.
     * @param relativePath Relative path (e.g., "settings.json").
     * @returns Absolute path in the data folder.
     */
    resolveDataPath(relativePath: string): string;

    /**
     * Resolve a relative path within the per-window cache folder.
     * @param relativePath Relative path (e.g., "preview.html").
     * @returns Absolute path in the cache folder.
     */
    resolveCachePath(relativePath: string): string;

    /**
     * Get the path to a standard OS folder.
     * @param name Folder name: "documents", "downloads", "desktop", "userData", "home", "temp", "pictures", "music", "videos", "appData", "exe".
     */
    commonFolder(name: string): Promise<string>;

    // ── Dialogs ──────────────────────────────────────────────────────

    /**
     * Show the native "Open File" dialog.
     * @returns Selected file paths, or null if cancelled.
     */
    showOpenDialog(options?: IOpenDialogOptions): Promise<string[] | null>;

    /**
     * Show the native "Save File" dialog.
     * @returns Selected save path, or null if cancelled.
     */
    showSaveDialog(options?: ISaveDialogOptions): Promise<string | null>;

    /**
     * Show the native "Select Folder" dialog.
     * @returns Selected folder paths, or null if cancelled.
     */
    showFolderDialog(options?: IFolderDialogOptions): Promise<string[] | null>;

    // ── OS integration ───────────────────────────────────────────────

    /**
     * Show a file in the OS file explorer (select it in the parent folder).
     * @param filePath Path to file or folder.
     */
    showInExplorer(filePath: string): void;

    /**
     * Open a folder in the OS file explorer.
     * @param folderPath Path to folder.
     */
    showFolder(folderPath: string): void;
}
