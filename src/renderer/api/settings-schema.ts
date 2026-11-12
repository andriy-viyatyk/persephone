import { profileDefaultPort, rendererProfileName } from "../../shared/application-profile";
import { defaultSearchableExtensions, defaultMaxFileSize, defaultExcludePatterns } from "../../ipc/search-ipc";
import type { BrowserNetwork } from "../../ipc/browser-network-ipc";
import { normalizeVoiceTypingShortcut } from "../../shared/voice-typing-shortcut";
import { MICROPHONE_NOTCH_FREQUENCY_RANGE, MICROPHONE_TUNING, normalizeMicrophoneSetting, type MicrophoneNotch } from "../../shared/microphone-cleaning-types";

export interface BrowserProfile { name: string; color: string; bookmarksFile?: string; network?: BrowserNetwork }
export interface EditorCategory { id: string; name: string; items: string[] }

export const DEFAULT_PINNED_EDITORS: readonly string[] = [
    "open-folder", "open-file", "script-ts", "bundled-board:excalidraw", "grid-csv", "browser",
];

export const SETTINGS_SCHEMA = {
    "tab-recent-languages": { default: ["plaintext"] as string[], comment: "Languages recently chosen from a tab's language menu, most recent first.\nMaintained automatically; they sort to the top of that menu. Safe to trim or clear." },
    "language": { default: "auto", comment: "Application language code. Use \"auto\" to follow the system's preferred languages, or a BCP-47 code such as \"uk\" or \"en-XA\". Changes apply after reloading windows. Default: auto." },
    "theme": { default: "persephone", comment: "Application color theme. Applies as soon as this file is saved. Built-in ids and custom theme ids are accepted; custom choices are stored in the data/themes folder. Default: persephone." },
    "search-extensions": { default: defaultSearchableExtensions as string[], comment: "File extensions to include in file content search.\nAdd or remove extensions to customize which files are searchable." },
    "search-exclude": { default: defaultExcludePatterns as string[], comment: "Folders and globs always skipped by file content search.\nA plain name skips any folder with that name; a glob (with / * ?) is matched against the path relative to the search root.\nNever applied to the search root itself — searching inside node_modules works, while nested ones are still skipped." },
    "search-max-file-size": { default: defaultMaxFileSize, comment: "Maximum file size (in bytes) for file content search.\nFiles larger than this are skipped. Default: 1048576 (1 MB)." },
    "browser-profiles": { default: [] as BrowserProfile[], comment: "Browser profiles — isolated sessions, each with its own cookies, storage, and cache.\nArray of profile objects. Use separate profiles to stay signed into several accounts\non the same site at once. A profile may carry \"network\" — same shape as \"browser-default-network\"." },
    "browser-default-profile": { default: "", comment: "Profile name used when opening a new browser tab.\nMust match a name in \"browser-profiles\". Empty string = the built-in default profile." },
    "browser-default-bookmarks-file": { default: "", comment: "Absolute path to the .link.json file holding bookmarks for the default browser profile.\nIt is an ordinary Links-editor file and can be opened as a tab." },
    "browser-default-network": { default: { kind: "direct" } as BrowserNetwork, comment: "Network route for the built-in default browser profile (named profiles carry their own \"network\").\n{ \"kind\": \"direct\" } (default), or { \"kind\": \"proxy\", \"protocol\": \"socks5\" | \"http\", \"host\": \"127.0.0.1\", \"port\": 1080 }.\nA proxied profile never falls back to direct: when the proxy is unreachable its pages fail to load.\nWith SOCKS5 the proxy also resolves host names. localhost and link-local addresses always go direct." },
    "browser-incognito-network": { default: { kind: "direct" } as BrowserNetwork, comment: "Network route for Incognito browser pages — same shape as \"browser-default-network\".\nEach Incognito page has its own in-memory session; this route applies to every one of them." },
    "browser-incognito-bookmarks-file": { default: "", comment: "Absolute path to the .link.json bookmarks file used in incognito mode.\nKept separate so incognito bookmarks never mix with the normal profile's." },
    "browser-windows-sso": { default: false, comment: "Allow Windows single sign-on for Microsoft, work, and school accounts (Windows only).\nOn an Entra-joined device, browser profile pages send Windows' device sign-in proof to\nlogin.microsoftonline.com and login.live.com, as Edge and Chrome do, so company sign-in rules\nthat require a registered device accept the sign-in. Never applies to Incognito or Tor pages." },
    "browser-search-engine": { default: "google", comment: "Search engine preselected in new profile browser pages (the default and named profiles).\nMaintained automatically: the last engine picked in the URL bar of such a page.\nOne of: google, bing, duckduckgo, yahoo, ecosia, brave, startpage, qwant, baidu, perplexity, gibiru.\nDefault: google." },
    "browser-translate-target": { default: "app", comment: "Target language for browser page translation. Use \"app\" to follow the active application language, or a BCP-47 language code supported by a trusted text translation provider. Default: app." },
    "browser-private-search-engine": { default: "google", comment: "Search engine preselected in new Incognito and Tor browser pages — same values as\n\"browser-search-engine\", remembered separately from it. Default: google." },
    "link-open-behavior": { default: "default-browser" as "default-browser" | "internal-browser", comment: "Where external links open from editors.\nOne of: \"default-browser\" (the OS default browser), \"internal-browser\" (the nearest\nPersephone Browser tab). Default: default-browser.", options: ["default-browser", "internal-browser"] as const },
    "agent-tips.enabled": { default: true, comment: "Allow optional, non-blocking suggestions to MCP agents.\nBoolean. Default: true. Changes take effect immediately." },
    "mcp.enabled": { default: false, comment: "Enable the MCP (Model Context Protocol) HTTP server, so AI agents can drive Persephone.\nBoolean. Default: false. Setting it true here starts the server immediately — no restart.\nThe agent connects to http://127.0.0.1:<mcp.port>/mcp and should start with a bare call for the overview.\nThe server listens on loopback only and is never reachable from another machine." },
    "mcp.port": { default: profileDefaultPort(7865, rendererProfileName()), comment: "Port for the MCP HTTP server.\nNumber. Default: 7865; named application profiles (--profile): 7965 (+100).\nChanging this alone does NOT move a running server — set \"mcp.enabled\": false, save, then set it back to true.", range: { min: 1024, max: 65535 } as const },
    "clipboard.enabled": { default: false, comment: "Enable the clipboard history tracker.\nBoolean. Default: false. When enabled, clipboard content is recorded for the history feature.\nOccasionally-copied secrets may remain on disk in readable form." },
    "clipboard.max-items": { default: 100, comment: "Maximum number of clipboard history items to retain.\nOnly integers from 1 through 1000 are accepted; any other stored value falls back to 100.\nDefault: 100. This item count limits history retention, including content that may remain readable on disk.", range: { min: 1, max: 1000 } as const },
    "main.scripting.enabled": { default: import.meta.env.DEV, comment: "Allow call → main.script.execute to run code in Persephone's main process.\nBoolean. Default: on in development and off in packaged builds. Main-process code can freeze or crash the entire app." },
    "capabilities.preferredProviders": { default: {} as Record<string, string>, comment: "Preferred capability provider keys, indexed by capability id. Default: {}.", normalize: normalizeCapabilityPreferences },
    "mneme.enabled": { default: false, comment: "Enable Mneme, the local markdown knowledge base with full-text and semantic search.\nBoolean. Default: false. Persephone runs mneme.exe as a sidecar and connects over loopback HTTP.\nMneme exposes its OWN MCP server on \"mneme.port\" — separate from \"mcp.port\" above." },
    "mneme.port": { default: profileDefaultPort(7700, rendererProfileName()), comment: "Port for the Mneme HTTP (MCP) server.\nNumber. Default: 7700; named application profiles (--profile): 7800 (+100).\nChanging this alone does NOT move a running server — set \"mneme.enabled\": false, save, then set it back to true.", range: { min: 1024, max: 65535 } as const },
    "script-library.path": { default: "", comment: "Absolute path to the script library folder — saved scripts and reusable modules.\nEmpty means no library is linked; the Menu Bar's Script Library category then offers\nto pick one. Changing it here re-points the category immediately." },
    "site-extensions.path": { default: "", comment: "Absolute path to the site extensions folder: one sub-folder per extension, each with\nmanifest.json and its script. Empty means the default, <userData>/data/site-extensions.\nChanging it revokes trust for every extension: each one in the new folder asks to be trusted again.\nPages that already ran an extension keep it until they reload or navigate." },
    "editor-categories": { default: [{ id: "top", name: "", items: [...DEFAULT_PINNED_EDITORS] }] as EditorCategory[], comment: "Ordered editor categories for the '+' new-page menu. Each entry has id, name, and item refs; Top is fixed first and Other is derived from eligible items not assigned to a category.", normalize: normalizeEditorCategories },
    "disabled-bundled-boards": { default: [] as string[], comment: "Bundled boards disabled in Tools & Editors.\nArray of stable bundled board folder ids; changes apply live without restarting. Default: []." },
    "tor.exe-path": { default: "", comment: "Absolute path to tor.exe. Required for Browser (Tor) mode; empty disables it.\nGet it from the Tor Expert Bundle, or reuse the tor.exe inside a Tor Browser installation." },
    "tor.socks-port": { default: rendererProfileName() ? 9052 : 9050, comment: "SOCKS proxy port for Tor.\nNumber. Default: 9050; named application profiles (--profile): 9052.\nChange if the port is already in use on this machine.", range: { min: 1024, max: 65535 } as const },
    "tor.bookmarks-file": { default: "", comment: "Path to the .link.json bookmarks file for Browser (Tor) mode." },
    "vlc-path": { default: "", comment: "Absolute path to vlc.exe, used for formats Chromium cannot decode (AVI, MKV, WMA).\nLeave empty to auto-detect C:\\Program Files\\VideoLAN\\VLC\\vlc.exe." },
    "terminal.command": { default: "", comment: "Terminal launched by \"Open Terminal here\".\nCommand name or absolute path — pwsh, powershell, cmd, or wt.\nLeave empty to auto-detect on first use (pwsh -> powershell -> cmd)." },
    "video-stream.port": { default: profileDefaultPort(7866, rendererProfileName()), comment: "Port for the local video streaming server, which serves media to the player and to VLC.\nNumber. Default: 7866; named application profiles (--profile): 7966 (+100).\nChange if the port is already in use.", range: { min: 1024, max: 65535 } as const },
    "git.enabled": { default: false, comment: "Enable Git integration — the Git Tree and Git Diff editors.\nBoolean. Default: false, and with it off Persephone performs no git activity at all.\nRequires git installed and on PATH. This is usually why a user cannot find git features." },
    "window.close-to-tray": { default: true, comment: "Keep Persephone running in the notification tray after its last window is closed.\nBoolean. Default: true — closing the last window only hides it, and the app is\nrestored from the tray icon. Background services (MCP server, Mneme, the launcher\npipe that makes \"Open with persephone\" instant) stay up, which is the point.\nSet false to make closing the last window quit the app outright. The tray icon is\nstill there while the app runs; Quit from it always exits regardless of this setting." },
    "editor.word-wrap": { default: false, comment: "Default word wrapping for newly shown Text Editor pages.\nBoolean. Default: false. This is read when a Text Editor page is first shown\nwithout saved page state; existing pages keep their own persisted choice." },
    "board-vars.file": { default: "", comment: "Absolute path to the board environment-variables file (.env.json).\nHolds per-board variables and secrets, deliberately OUTSIDE board folders so a board\nfolder can be shared without its secrets. May be password-encrypted via the file's\nencryption menu, in which case its values cannot be read until the user unlocks it." },
    "boards.default-author": { default: "", comment: "Default author written into manifests for boards created by Persephone.\nEmpty means newly created boards have no stable author until you set one." },
    "voice-typing.shortcut": { default: "Alt+V", comment: "Shortcut used to start and stop voice typing. Modifiers are written Ctrl, Alt, Shift, or Meta followed by one key; at least one modifier is required. Default: Alt+V.", normalize: (value: unknown) => normalizeVoiceTypingShortcut(value) ?? "Alt+V" },
    "voice-typing.translate-shortcut": { default: "Alt+Shift+V", comment: "Shortcut used to start and stop voice typing with translation to English. Default: Alt+Shift+V.", normalize: (value: unknown) => normalizeVoiceTypingShortcut(value) ?? "Alt+Shift+V" },
    "voice-typing.auto-stop-silence-ms": { default: 0, comment: "Stop voice typing and boards that take dictation after this many milliseconds of microphone silence once a committed speech segment exists and no utterance is pending. Allowed: 0 (off), 2000, 3000, 5000, 10000. Default: 0.", normalize: normalizeVoiceTypingAutoStopSilence, options: [0, 2000, 3000, 5000, 10000] as const },
    "voice-typing.auto-stop-inactivity-ms": { default: 0, comment: "Stop voice typing after this many milliseconds in which the transcription provider produced no new draft or committed text, measured from when recording started. Unlike the silence setting this ignores microphone level, so it still ends a session in a noisy room, or one in which nothing was ever said and so no committed segment exists for silence detection to arm on. Only applies to providers that support live transcription, because a provider without it sends no text until the session ends. The short values suit a fast machine, where a draft arrives within a second of speech; allow more on a slow one or when transcription runs on the CPU. Allowed: 0 (off), 2000, 3000, 4000, 5000, 10000, 15000, 30000. Default: 0.", normalize: normalizeVoiceTypingAutoStopInactivity, options: [0, 2000, 3000, 4000, 5000, 10000, 15000, 30000] as const },
    "microphone.clean": { default: true, comment: "Enable DTLN noise cleaning. A consumer requesting computer sound cancellation also enables DTLN noise removal when this is off. Default: true.", normalize: (value: unknown) => normalizeMicrophoneSetting("microphone.clean", value) },
    "microphone.attenuation-db": { default: MICROPHONE_TUNING.attenuationDb as number, comment: "Maximum DTLN suppression by frame RMS in dB; 0 means unlimited. Default: 30. Applies whenever DTLN runs.", normalize: (value: unknown) => normalizeMicrophoneSetting("microphone.attenuation-db", value), range: { min: 0, max: 100 } as const },
    "microphone.notches": { default: {} as Record<string, MicrophoneNotch>, comment: "Device-specific resonance cuts keyed by resolved microphone device ID. Frequencies must be between 20 and 7999 Hz inclusive; invalid device profiles are discarded. Device IDs are stored locally and may change.", normalize: (value: unknown) => normalizeMicrophoneSetting("microphone.notches", value), range: { frequency: MICROPHONE_NOTCH_FREQUENCY_RANGE, q: { min: 0.1, max: 50 }, gainDb: { min: -60, max: 0 } } },
    "boards.excalidraw-library-migrated": { default: false, comment: "Bookkeeping: whether the pre-5.0.4 \"drawing.library-path\" has already been\noffered to the bundled Excalidraw board as its own \"library-path\" setting.\nBoolean. Set to true once that one-time import has run, so clearing the setting\nin Settings stays cleared instead of being re-imported on the next start.\nSet it back to false AND restart Persephone to run the import once more:\nthe import is attempted once per run, so clearing the flag alone changes nothing." },
} as const;

export type AppSettingsKey = keyof typeof SETTINGS_SCHEMA;
type WidenDefault<K extends AppSettingsKey, Value> = K extends "link-open-behavior"
    ? "default-browser" | "internal-browser"
    : Value extends string ? string : Value extends number ? number : Value extends boolean ? boolean : Value;
type SettingsDefaults = { [K in AppSettingsKey]: WidenDefault<K, (typeof SETTINGS_SCHEMA)[K]["default"]> };
export type AppSettingsState = { settings: SettingsDefaults };

export const defaultSettings = Object.fromEntries(
    Object.entries(SETTINGS_SCHEMA).map(([key, entry]) => [key, entry.default]),
) as SettingsDefaults;
export const settingsComments = Object.fromEntries(
    Object.entries(SETTINGS_SCHEMA).map(([key, entry]) => [key, entry.comment]),
) as Partial<Record<AppSettingsKey, string>>;

type SettingsWithOptions = { [K in AppSettingsKey]: (typeof SETTINGS_SCHEMA)[K] extends { options: readonly unknown[] } ? K : never }[AppSettingsKey];
type SettingsWithRange = { [K in AppSettingsKey]: (typeof SETTINGS_SCHEMA)[K] extends { range: unknown } ? K : never }[AppSettingsKey];
type OptionsFor<K extends SettingsWithOptions> = (typeof SETTINGS_SCHEMA)[K] extends { options: infer Options } ? Options : never;
type RangeFor<K extends SettingsWithRange> = (typeof SETTINGS_SCHEMA)[K] extends { range: infer Range } ? Range : never;
export const settingDefault = <K extends AppSettingsKey>(key: K): SettingsDefaults[K] => SETTINGS_SCHEMA[key].default as SettingsDefaults[K];
export const settingOptions = <K extends SettingsWithOptions>(key: K): OptionsFor<K> => SETTINGS_SCHEMA[key].options as OptionsFor<K>;
export const settingRange = <K extends SettingsWithRange>(key: K): RangeFor<K> => SETTINGS_SCHEMA[key].range as RangeFor<K>;

export function normalizeClipboardMaxItems(value: unknown): number {
    return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 1000 ? value : 100;
}
export function normalizeVoiceTypingAutoStopSilence(value: unknown): number {
    return typeof value === "number" && [0, 2000, 3000, 5000, 10000].includes(value) ? value : 0;
}
export function normalizeVoiceTypingAutoStopInactivity(value: unknown): number {
    return typeof value === "number" && [0, 2000, 3000, 4000, 5000, 10000, 15000, 30000].includes(value) ? value : 0;
}
export function normalizeCapabilityPreferences(value: unknown): Record<string, string> {
    if (!value || typeof value !== "object" || Array.isArray(value) || Object.values(value).some((item) => typeof item !== "string")) return {};
    return { ...value } as Record<string, string>;
}
export function migrateLegacyPinnedEditors(value: unknown): string[] | undefined {
    if (!Array.isArray(value)) return undefined;
    let changed = false;
    const migrated = value.map((entry) => {
        if (entry !== "draw-view") return entry;
        changed = true;
        return "bundled-board:excalidraw";
    });
    return changed ? migrated as string[] : undefined;
}
export function normalizeEditorCategories(value: unknown, legacyValue: unknown = undefined): EditorCategory[] {
    const source = Array.isArray(value) ? value : [];
    const seenIds = new Set<string>();
    const seenItems = new Set<string>();
    const categories: EditorCategory[] = [{ id: "top", name: "", items: [] }];
    const topRaw = source.find((raw) => !!raw && typeof raw === "object" && (raw as Partial<EditorCategory>).id === "top");
    const orderedSource = topRaw ? [topRaw, ...source.filter((raw) => raw !== topRaw)] : source;
    let foundTop = Boolean(topRaw);
    for (const raw of orderedSource) {
        if (!raw || typeof raw !== "object") continue;
        const category = raw as Partial<EditorCategory>;
        if (category.id === "top") {
            foundTop = true;
            for (const item of Array.isArray(category.items) ? category.items : []) if (typeof item === "string" && !seenItems.has(item)) { seenItems.add(item); categories[0].items.push(item); }
            continue;
        }
        if (typeof category.id !== "string" || !category.id || seenIds.has(category.id)) continue;
        seenIds.add(category.id);
        const items: string[] = [];
        for (const item of Array.isArray(category.items) ? category.items : []) if (typeof item === "string" && !seenItems.has(item)) { seenItems.add(item); items.push(item); }
        categories.push({ id: category.id, name: typeof category.name === "string" ? category.name : "", items });
    }
    if (!Array.isArray(value)) categories[0].items = migrateLegacyPinnedEditors(legacyValue) ?? (Array.isArray(legacyValue) ? legacyValue.filter((item): item is string => typeof item === "string") : [...DEFAULT_PINNED_EDITORS]);
    else if (!foundTop) categories[0].items = [...DEFAULT_PINNED_EDITORS];
    return categories;
}

export interface SettingsMigrationContext {
    uiPreferences: { write(key: string, value: number): void };
    legacyPinnedEditors?: unknown;
}
export const SETTINGS_MIGRATIONS: readonly ((settings: Record<string, unknown>, context: SettingsMigrationContext) => boolean)[] = [
    (settings, context) => {
        let changed = false;
        for (const key of ["voice-assistant.enabled", "voice-assistant.microphone", "voice-assistant.silence-ms", "voice-assistant.threshold"]) {
            if (Object.prototype.hasOwnProperty.call(settings, key)) { delete settings[key]; changed = true; }
        }
        if (Object.prototype.hasOwnProperty.call(settings, "pinned-editors")) {
            const migrated = migrateLegacyPinnedEditors(settings["pinned-editors"]);
            context.legacyPinnedEditors = migrated ?? settings["pinned-editors"];
            delete settings["pinned-editors"];
            changed = true;
        }
        return changed;
    },
    (settings, { uiPreferences }) => {
        if (!Object.prototype.hasOwnProperty.call(settings, "editor-categories-popover-size")) return false;
        const size = settings["editor-categories-popover-size"];
        if (size && typeof size === "object") {
            const { width, height } = size as { width?: unknown; height?: unknown };
            if (typeof width === "number" && Number.isFinite(width) && width > 0 && typeof height === "number" && Number.isFinite(height) && height > 0) {
                uiPreferences.write("editor-categories-popover-width", width);
                uiPreferences.write("editor-categories-popover-height", height);
            }
        }
        delete settings["editor-categories-popover-size"];
        return true;
    },
];

