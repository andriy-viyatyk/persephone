import { debounce } from "../../shared/utils";
import { TModel } from "../core/state/model";
import { TGlobalState } from "../core/state/state";
import { settings } from "./settings";
import { scriptRunner } from "../scripting/ScriptRunner";

const nodefs = require("fs") as typeof import("fs");
const nodepath = require("path") as typeof import("path");

// =============================================================================
// Types
// =============================================================================

export interface ScriptPanelEntry {
    /** Display name (filename without extension) */
    name: string;
    /** Full absolute path */
    path: string;
    /** File extension (.ts or .js) */
    ext: string;
}

interface LibraryServiceState {
    /** Files in script-panel/ grouped by language subfolder */
    scriptPanelIndex: Record<string, ScriptPanelEntry[]>;
    /** All .ts/.js files in the library (relative paths) */
    allFiles: string[];
}

const defaultState: LibraryServiceState = {
    scriptPanelIndex: {},
    allFiles: [],
};

// =============================================================================
// Implementation
// =============================================================================

class LibraryService extends TModel<LibraryServiceState> {
    private initialized = false;
    private watcher: ReturnType<typeof nodefs.watch> | undefined;
    private settingsSub: { dispose: () => void } | undefined;

    constructor() {
        super(new TGlobalState(defaultState));
        this.settingsSub = settings.onChanged.subscribe(({ key }) => {
            if (key === "script-library.path" && this.initialized) {
                this.deactivate();
                this.activate();
            }
        });
    }

    /** Call before using any service state. Idempotent — only initializes once. */
    ensureInitialized(): void {
        if (this.initialized) return;
        this.initialized = true;
        this.activate();
    }

    get scriptPanelIndex(): Record<string, ScriptPanelEntry[]> {
        return this.state.get().scriptPanelIndex;
    }

    get allFiles(): string[] {
        return this.state.get().allFiles;
    }

    dispose(): void {
        this.deactivate();
        this.settingsSub?.dispose();
        this.settingsSub = undefined;
    }

    // ── Private ──────────────────────────────────────────────────────────

    private activate(): void {
        const libraryPath = settings.get("script-library.path");
        if (!libraryPath || !nodefs.existsSync(libraryPath)) {
            this.state.update((s) => {
                s.scriptPanelIndex = {};
                s.allFiles = [];
            });
            return;
        }

        this.scan(libraryPath);
        this.startWatching(libraryPath);
    }

    private deactivate(): void {
        this.stopWatching();
        this.state.update((s) => {
            s.scriptPanelIndex = {};
            s.allFiles = [];
        });
    }

    private scan(libraryPath: string): void {
        const scriptPanelIndex = this.scanScriptPanel(libraryPath);
        const allFiles = this.scanAllFiles(libraryPath);
        this.state.update((s) => {
            s.scriptPanelIndex = scriptPanelIndex;
            s.allFiles = allFiles;
        });
    }

    private scanScriptPanel(libraryPath: string): Record<string, ScriptPanelEntry[]> {
        const scriptPanelDir = nodepath.join(libraryPath, "script-panel");
        if (!nodefs.existsSync(scriptPanelDir)) {
            return {};
        }

        const index: Record<string, ScriptPanelEntry[]> = {};

        try {
            const langDirs = nodefs.readdirSync(scriptPanelDir, { withFileTypes: true });
            for (const dirent of langDirs) {
                if (!dirent.isDirectory()) continue;
                const langKey = dirent.name;
                const langDir = nodepath.join(scriptPanelDir, langKey);
                const entries = this.readScriptFiles(langDir);
                if (entries.length > 0) {
                    index[langKey] = entries;
                }
            }
        } catch {
            // Directory read failed — return empty index
        }

        return index;
    }

    private readScriptFiles(dir: string): ScriptPanelEntry[] {
        const entries: ScriptPanelEntry[] = [];
        try {
            const files = nodefs.readdirSync(dir, { withFileTypes: true });
            for (const dirent of files) {
                if (!dirent.isFile()) continue;
                const ext = nodepath.extname(dirent.name).toLowerCase();
                if (ext !== ".ts" && ext !== ".js") continue;
                entries.push({
                    name: nodepath.basename(dirent.name, ext),
                    path: nodepath.join(dir, dirent.name),
                    ext,
                });
            }
        } catch {
            // Directory read failed — return empty
        }
        return entries;
    }

    private scanAllFiles(libraryPath: string): string[] {
        const files: string[] = [];
        this.walkDir(libraryPath, libraryPath, files);
        return files;
    }

    private walkDir(baseDir: string, currentDir: string, result: string[]): void {
        try {
            const entries = nodefs.readdirSync(currentDir, { withFileTypes: true });
            for (const dirent of entries) {
                const fullPath = nodepath.join(currentDir, dirent.name);
                if (dirent.isDirectory()) {
                    this.walkDir(baseDir, fullPath, result);
                } else if (dirent.isFile()) {
                    const ext = nodepath.extname(dirent.name).toLowerCase();
                    if (ext === ".ts" || ext === ".js") {
                        const relativePath = nodepath.relative(baseDir, fullPath).replace(/\\/g, "/");
                        result.push(relativePath);
                    }
                }
            }
        } catch {
            // Directory read failed — skip
        }
    }

    // ── File Watching ────────────────────────────────────────────────────

    private startWatching(libraryPath: string): void {
        try {
            this.watcher = nodefs.watch(libraryPath, { recursive: true }, () => {
                this.onChangeDebounced(libraryPath);
            });
        } catch {
            // Watcher setup failed — service works without live updates
        }
    }

    private stopWatching(): void {
        this.watcher?.close();
        this.watcher = undefined;
    }

    private onChangeDebounced = debounce((libraryPath: string) => {
        this.scan(libraryPath);
        scriptRunner.invalidateLibraryCache();
    }, 300);
}

export const libraryService = new LibraryService();

// =============================================================================
// Example Scripts
// =============================================================================

/**
 * Copy bundled example scripts from assets to the target library folder.
 * Skips files that already exist in the destination (never overwrites).
 */
export async function copyExampleScripts(targetPath: string): Promise<void> {
    const { api } = await import("../../ipc/renderer/api");
    const appRoot = await api.getAppRootPath();
    const sourcePath = nodepath.join(appRoot, "assets", "script-library");

    if (!nodefs.existsSync(sourcePath)) {
        return;
    }

    copyDirRecursive(sourcePath, targetPath);
}

function copyDirRecursive(src: string, dest: string): void {
    if (!nodefs.existsSync(dest)) {
        nodefs.mkdirSync(dest, { recursive: true });
    }

    const entries = nodefs.readdirSync(src, { withFileTypes: true });
    for (const entry of entries) {
        const srcPath = nodepath.join(src, entry.name);
        const destPath = nodepath.join(dest, entry.name);
        if (entry.isDirectory()) {
            copyDirRecursive(srcPath, destPath);
        } else if (entry.isFile()) {
            if (!nodefs.existsSync(destPath)) {
                nodefs.copyFileSync(srcPath, destPath);
            }
        }
    }
}
