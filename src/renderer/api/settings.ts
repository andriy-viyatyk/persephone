import { debounce } from "../../shared/utils";
import { TGlobalState } from "../core/state/state";
import { Subscription } from "../core/state/events";
import { parseJSON5 } from "../core/utils/parse-utils";
import { fs } from "./fs";
import { FileWatcher } from "../core/utils/file-watcher";
import { applyTheme } from "../theme/themes";
import { defaultSearchableExtensions, defaultMaxFileSize } from "../../ipc/search-ipc";
import { wrapSubscription } from "./internal";
import type { ISettings } from "./types/settings";

// =============================================================================
// Types
// =============================================================================

export interface BrowserProfile {
    name: string;
    color: string;
    bookmarksFile?: string;
}

export type AppSettingsKey =
    | "tab-recent-languages"
    | "theme"
    | "search-extensions"
    | "search-max-file-size"
    | "browser-profiles"
    | "browser-default-profile"
    | "browser-default-bookmarks-file"
    | "browser-incognito-bookmarks-file"
    | "link-open-behavior"
    | "mcp.enabled"
    | "mcp.port";

// =============================================================================
// State
// =============================================================================

const settingsFileName = "appSettings.json";

const settingsComments: Partial<Record<AppSettingsKey, string>> = {
    "tab-recent-languages":
        "Recently selected languages.\nMore recent languages will appear on top of 'change language' menu.",
    "theme": "Application color theme.\nAvailable themes: default-dark, solarized-dark, monokai, abyss, red, tomorrow-night-blue, light-modern, solarized-light, quiet-light",
    "search-extensions": "File extensions to include in file content search.\nAdd or remove extensions to customize which files are searchable.",
    "search-max-file-size": "Maximum file size (in bytes) for file content search.\nFiles larger than this are skipped. Default: 1048576 (1 MB).",
    "browser-profiles": "Browser profiles for isolated browsing sessions.\nEach profile has its own cookies, storage, and cache.",
    "browser-default-profile": "Default browser profile name used when opening a new browser tab.\nEmpty string means the built-in default profile.",
    "browser-default-bookmarks-file": "Path to the .link.json bookmarks file for the default browser profile.",
    "browser-incognito-bookmarks-file": "Path to the .link.json bookmarks file for incognito mode.",
    "link-open-behavior": "How external links open from editors.\n\"default-browser\" opens in the OS default browser, \"internal-browser\" opens in the nearest Browser tab.",
    "mcp.enabled": "Enable MCP (Model Context Protocol) HTTP server.\nAllows AI agents like Claude Desktop and Claude Code to control js-notepad.",
    "mcp.port": "Port number for the MCP HTTP server.\nDefault: 7865. Change requires toggling MCP off and on.",
};

const defaultAppSettingsState = {
    settings: {
        "tab-recent-languages": ["plaintext"] as string[],
        "theme": "default-dark",
        "search-extensions": defaultSearchableExtensions as string[],
        "search-max-file-size": defaultMaxFileSize,
        "browser-profiles": [] as BrowserProfile[],
        "browser-default-profile": "",
        "browser-default-bookmarks-file": "",
        "browser-incognito-bookmarks-file": "",
        "link-open-behavior": "default-browser" as "default-browser" | "internal-browser",
        "mcp.enabled": false,
        "mcp.port": 7865,
    },
};

type AppSettingsState = typeof defaultAppSettingsState;

// =============================================================================
// Implementation
// =============================================================================

class Settings implements ISettings {
    readonly onChanged;

    private readonly state = new TGlobalState(defaultAppSettingsState);
    private readonly _initPromise: Promise<void>;
    private fileWatcher: FileWatcher | undefined;
    private skipNextFileChange = false;

    constructor() {
        this.onChanged = wrapSubscription(this._onChanged);
        this._initPromise = this.init();
    }

    /** Wait until settings are loaded from disk. */
    wait = async (): Promise<void> => {
        await this._initPromise;
    };

    get theme(): string {
        return this.state.get().settings["theme"];
    }

    get<K extends AppSettingsKey>(key: K): AppSettingsState["settings"][K];
    get<T = any>(key: string): T;
    get(key: string) {
        return this.state.get().settings[key as AppSettingsKey];
    }

    set<K extends AppSettingsKey>(key: K, value: AppSettingsState["settings"][K]): void;
    set<T = any>(key: string, value: T): void;
    set(key: string, value: any): void {
        this.state.update((s) => {
            (s.settings as any)[key] = value;
        });
        this._onChanged.send({ key, value });
        this.saveSettingsDebounced();
    }

    /** React hook for reactive reading. Not exposed in script .d.ts. */
    use<K extends AppSettingsKey>(key: K): AppSettingsState["settings"][K] {
        return this.state.use((s) => s.settings[key]);
    }

    get settingsFilePath(): string {
        return this.fileWatcher?.filePath || "";
    }

    // -------------------------------------------------------------------------
    // Internal
    // -------------------------------------------------------------------------

    private readonly _onChanged = new Subscription<{ key: string; value: any }>();

    private init = async () => {
        await fs.prepareDataFile(settingsFileName, "{}");
        this.fileWatcher = new FileWatcher(
            await fs.dataFileName(settingsFileName),
            this.fileChanged
        );
        await this.loadSettings();
    };

    private fileChanged = () => {
        if (this.skipNextFileChange) {
            this.skipNextFileChange = false;
            return;
        }
        this.loadSettings();
    };

    private loadSettings = async () => {
        const content = parseJSON5(await this.fileWatcher?.getTextContent());
        if (content) {
            const newSettings = {
                ...defaultAppSettingsState.settings,
                ...content,
            };
            this.state.update((s) => {
                s.settings = newSettings;
            });

            applyTheme(newSettings["theme"]);
        }
    };

    private saveSettings = () => {
        this.skipNextFileChange = true;
        const content = JSON.stringify(this.state.get().settings, null, 4);
        const lines = content.split("\n");

        // Loop backward through lines to insert comments
        for (let i = lines.length - 1; i >= 0; i--) {
            const line = lines[i];
            const trimmedLine = line.trimStart();

            for (const key of Object.keys(
                settingsComments
            ) as AppSettingsKey[]) {
                if (trimmedLine.startsWith(`"${key}":`)) {
                    const comment = settingsComments[key];
                    if (!comment) break;
                    const indent = line.substring(
                        0,
                        line.length - trimmedLine.length
                    );

                    const commentLines = comment.split("\n");
                    for (let j = commentLines.length - 1; j >= 0; j--) {
                        lines.splice(i, 0, `${indent}// ${commentLines[j]}`);
                    }

                    break;
                }
            }
        }

        const contentWithComments = lines.join("\n");
        fs.saveDataFile(settingsFileName, contentWithComments);
    };

    private saveSettingsDebounced = debounce(this.saveSettings, 300);
}

export const settings = new Settings();
