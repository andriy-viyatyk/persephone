import { debounce } from "../../shared/utils";
import { TGlobalState } from "../core/state/state";
import { Subscription } from "../core/state/events";
import { parseJSON5 } from "../core/utils/parse-utils";
import { createEchoGuard } from "../core/utils/echo-guard";
import { fs } from "./fs";
import { FileWatcher } from "../core/utils/file-watcher";
import { wrapSubscription } from "./internal";
import type { ISettings } from "./types/settings";
import { load as loadUiPreferences, uiPreferences } from "./ui-preferences";
import { AppSettingsKey, AppSettingsState, SETTINGS_MIGRATIONS, defaultSettings, SETTINGS_SCHEMA, settingsComments } from "./settings-schema";
// =============================================================================
const settingsFileName = "appSettings.json";

/**
 * Header prepended to the saved settings file.
 *
 * The audience for this file's comments is an AI agent as much as a human: an agent helping a
 * new user configure Persephone reaches this file with its ordinary filesystem tools, often
 * before Persephone's MCP server is even on. The header therefore says what the file is, that
 * edits apply live, and where to read more — the three things you cannot infer from a key list.
 */
const settingsFileHeader = [
    "// Persephone settings. JSON5 — comments and trailing commas are allowed.",
    "//",
    "// Edits made here apply immediately: Persephone watches this file and reloads it, so there",
    "// is no need to restart the app. Persephone rewrites the file (and these comments) whenever",
    "// a setting changes in the UI, so any comment you add here will be replaced.",
    "//",
    "// Deleting a key restores its default. Deleting the whole file is safe — it is recreated.",
    "//",
    "// To let an AI agent drive Persephone, set \"mcp.enabled\": true below, then point the agent",
    "// at http://127.0.0.1:7865/mcp (see \"mcp.port\"). Once connected, the agent can call",
    "// Start with a bare call for the overview.",
    "//",
    "// Docs: https://github.com/andriy-viyatyk/persephone",
].join("\n");

function settingsValueEqual(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
    return JSON.stringify(a) === JSON.stringify(b);
}

// Implementation
// =============================================================================

class Settings implements ISettings {
    readonly onChanged;

    private readonly state = new TGlobalState({ settings: defaultSettings });
    private readonly _initPromise: Promise<void>;
    private fileWatcher: FileWatcher | undefined;
    private readonly echoGuard = createEchoGuard<string>();

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

    get language(): string {
        return this.state.get().settings["language"];
    }

    set language(value: string) {
        this.set("language", value);
    }

    get<K extends AppSettingsKey>(key: K): AppSettingsState["settings"][K];
    /**
     * Arbitrary-key escape hatch. The default stays `unknown` **deliberately** — do not widen it
     * to `any`.
     *
     * Callers reading a key outside the typed union must opt into a narrow type at the call site,
     * for example `settings.get<string>(key)`.
     */
    get<T = unknown>(key: string): T;
    get(key: string) {
        return this.state.get().settings[key as AppSettingsKey];
    }

    watch<K extends AppSettingsKey>(
        key: K,
        callback: (value: AppSettingsState["settings"][K]) => void,
    ): () => void {
        return this._onChanged.subscribe((change) => {
            if (change.key === key) callback(change.value as AppSettingsState["settings"][K]);
        });
    }

    set<K extends AppSettingsKey>(key: K, value: AppSettingsState["settings"][K]): void;
    set<T = unknown>(key: string, value: T): void;
    set(key: string, value: unknown): void {
        const entry = SETTINGS_SCHEMA[key as AppSettingsKey];
        if (entry && "normalize" in entry && entry.normalize && key !== "editor-categories") value = entry.normalize(value);
        this.state.update((s) => {
            (s.settings as Record<string, unknown>)[key] = value;
        });
        this._onChanged.send({ key, value });
        this.saveSettingsDebounced();
    }

    get settingsFilePath(): string {
        return this.fileWatcher?.filePath || "";
    }

    // -------------------------------------------------------------------------
    // Internal
    // -------------------------------------------------------------------------

    private readonly _onChanged = new Subscription<{ key: string; value: unknown }>();

    private init = async () => {
        await loadUiPreferences();
        await fs.prepareDataFile(settingsFileName, "{}");
        this.fileWatcher = new FileWatcher(
            await fs.dataFileName(settingsFileName),
            this.fileChanged,
            "settings",
        );
        await this.loadSettings();
    };

    private fileChanged = async () => {
        const content = await this.fileWatcher?.getTextContent();
        if (content !== undefined && this.echoGuard.consume(content)) return;
        await this.loadSettings(true, content);
    };

    /**
     * Load settings from disk.
     *
     * `emitChanges` is false for the initial load and true for watcher-triggered reloads.
     * The distinction matters: settings that merely get *read* (theme, paths, search config)
     * take effect from the state update alone, but settings that *do* something — starting the
     * MCP server, the browser tools, Mneme — are actuated by settings-change subscribers
     * (see `settings-effects.ts`). Without an emit here, editing `appSettings.json` on disk would
     * flip the value and the Settings UI toggle while the server stayed down: it would look
     * like it worked. Editing the file is the one way an agent can turn MCP on *before* it has
     * MCP, so this path has to work.
     *
     * The initial load must NOT emit — startup already starts MCP/Mneme explicitly after
     * `settings.wait()`, and emitting would start them a second time.
     */
    private loadSettings = async (emitChanges = false, rawContent?: string) => {
        const content = parseJSON5(
            rawContent ?? await this.fileWatcher?.getTextContent(),
        ) as Record<string, unknown> | undefined;
        if (content) {
            const previous = this.state.get().settings as Record<string, unknown>;
            let migrationChanged = false;
            const migrationContext = { uiPreferences, legacyPinnedEditors: undefined as unknown };
            for (const migrate of SETTINGS_MIGRATIONS) {
                migrationChanged = migrate(content, migrationContext) || migrationChanged;
            }
            const newSettings = {
                ...defaultSettings,
                ...content,
            };
            const normalizedSettings = newSettings as Record<string, unknown>;
            const entries = Object.entries(SETTINGS_SCHEMA) as [AppSettingsKey, (typeof SETTINGS_SCHEMA)[AppSettingsKey]][];
            for (const [key, entry] of entries) {
                if (key === "editor-categories" || !("normalize" in entry) || !entry.normalize) continue;
                normalizedSettings[key] = entry.normalize(normalizedSettings[key]);
            }
            const categoriesAbsent = !Object.prototype.hasOwnProperty.call(content, "editor-categories");
            const rawCategories = content["editor-categories"];
            const categories = SETTINGS_SCHEMA["editor-categories"].normalize(rawCategories, migrationContext.legacyPinnedEditors);
            newSettings["editor-categories"] = categories;
            this.state.update((s) => {
                s.settings = newSettings as AppSettingsState["settings"];
            });

            if (migrationChanged || categoriesAbsent || JSON.stringify(categories) !== JSON.stringify(rawCategories)) {
                this.saveSettingsDebounced();
            }

            if (emitChanges) {
                const next = newSettings as Record<string, unknown>;
                // Union of both key sets: a key deleted from the file reverts to its default,
                // which is as much a change as an edited one.
                for (const key of new Set([...Object.keys(previous), ...Object.keys(next)])) {
                    if (!settingsValueEqual(previous[key], next[key])) {
                        this._onChanged.send({ key, value: next[key] });
                    }
                }
            }
        }
    };

    private saveSettings = async (): Promise<void> => {
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

        const contentWithComments = `${settingsFileHeader}\n${lines.join("\n")}`;
        this.echoGuard.arm(contentWithComments);
        await fs.saveDataFile(settingsFileName, contentWithComments);
    };

    private saveSettingsDebounced = debounce(this.saveSettings, 300);

    flushSave = async (): Promise<void> => {
        this.saveSettingsDebounced.cancel();
        await this.saveSettings();
    };
}

export const settings = new Settings();

export async function flushSettingsSave(): Promise<void> {
    await settings.flushSave();
}
