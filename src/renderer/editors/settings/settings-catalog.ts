export interface SettingsCatalogRow {
    readonly key: string;
    readonly label: string;
    readonly purpose: string;
    readonly where?: string;
}

export interface SettingsCatalogSection {
    readonly groupId: string;
    readonly groupTitle: string;
    readonly id: string;
    readonly title: string;
    readonly description: string;
    readonly elementName: string;
    readonly panelName: string;
    readonly where: string;
    readonly rows: readonly SettingsCatalogRow[];
}

export const SETTINGS_CATALOG: readonly SettingsCatalogSection[] = [
    {
        groupId: "general",
        groupTitle: "General",
        id: "theme",
        title: "Theme",
        description: "Application appearance and color theme.",
        elementName: "settings-section-theme",
        panelName: "settings-panel-theme",
        where: "Settings > General > Theme",
        rows: [
            { key: "theme", label: "Theme", purpose: "Application color theme; the available dark and light themes are selected here." },
        ],
    },
    {
        groupId: "general",
        groupTitle: "General",
        id: "window-behavior",
        title: "Window Behavior",
        description: "Controls what happens when the last Persephone window closes.",
        elementName: "settings-section-window-behavior",
        panelName: "settings-panel-window-behavior",
        where: "Settings > General > Window Behavior",
        rows: [
            { key: "window.close-to-tray", label: "Close to tray", purpose: "Whether closing the last window hides Persephone in the tray or quits it." },
        ],
    },
    {
        groupId: "general",
        groupTitle: "General",
        id: "clipboard",
        title: "Clipboard",
        description: "Configure the opt-in clipboard history tracker and its item limit.",
        elementName: "settings-section-clipboard",
        panelName: "settings-panel-clipboard",
        where: "Settings > General > Clipboard",
        rows: [
            { key: "clipboard.enabled", label: "Clipboard history", purpose: "Whether copied clipboard content is recorded for the history feature; disabled by default." },
            { key: "clipboard.max-items", label: "Maximum clipboard items", purpose: "The number of clipboard history items to retain, from 1 through 1000; invalid stored values fall back to 100." },
        ],
    },
    {
        groupId: "general",
        groupTitle: "General",
        id: "terminal",
        title: "Terminal",
        description: "Choose the command used by Open Terminal here.",
        elementName: "settings-section-terminal",
        panelName: "settings-panel-terminal",
        where: "Settings > General > Terminal",
        rows: [
            { key: "terminal.command", label: "Terminal command", purpose: "The command used by Open Terminal here; empty auto-detects pwsh, powershell, or cmd." },
        ],
    },
    {
        groupId: "general",
        groupTitle: "General",
        id: "file-search",
        title: "File Search",
        description: "Choose which files content search includes and skips.",
        elementName: "settings-section-file-search",
        panelName: "settings-panel-file-search",
        where: "Settings > General > File Search",
        rows: [
            { key: "search-extensions", label: "Search extensions", purpose: "Comma-separated file extensions included in content search." },
            { key: "search-exclude", label: "Search exclusions", purpose: "Folders and globs skipped by content search." },
        ],
    },
    {
        groupId: "editors",
        groupTitle: "Editors",
        id: "editor-behavior",
        title: "Editor Behavior",
        description: "Choose the default word-wrapping behavior for newly shown Text Editor pages.",
        elementName: "settings-section-editor",
        panelName: "settings-panel-editor",
        where: "Settings > Editors > Editor Behavior",
        rows: [
            { key: "editor.word-wrap", label: "Text Editor word wrap", purpose: "Whether newly shown Text Editor pages start with word wrapping; existing pages keep their own persisted choice." },
        ],
    },
    {
        groupId: "editors",
        groupTitle: "Editors",
        id: "script-library",
        title: "Script Library",
        description: "Choose the folder for saved scripts and reusable modules.",
        elementName: "settings-section-script-library",
        panelName: "settings-panel-script-library",
        where: "Settings > Editors > Script Library",
        rows: [
            { key: "script-library.path", label: "Script library path", purpose: "The folder for saved scripts and reusable modules; empty means no library is linked." },
        ],
    },
    {
        groupId: "editors",
        groupTitle: "Editors",
        id: "video-player",
        title: "Video Player",
        description: "Configure external video decoding and the local video stream.",
        elementName: "settings-section-video-player",
        panelName: "settings-panel-video-player",
        where: "Settings > Editors > Video Player",
        rows: [
            { key: "vlc-path", label: "VLC path", purpose: "The vlc.exe path used for formats Chromium cannot decode; empty enables auto-detection." },
            { key: "video-stream.port", label: "Video stream port", purpose: "The local port used by the video streaming server." },
        ],
    },
    {
        groupId: "editors",
        groupTitle: "Editors",
        id: "drawing-library",
        title: "Drawing Library",
        description: "Choose the folder for reusable Excalidraw shapes.",
        elementName: "settings-section-drawing-library",
        panelName: "settings-panel-drawing-library",
        where: "Settings > Editors > Drawing Library",
        rows: [
            { key: "drawing.library-path", label: "Drawing library path", purpose: "The Excalidraw reusable-shapes folder; empty uses the automatic default." },
        ],
    },
    {
        groupId: "browser",
        groupTitle: "Browser",
        id: "browser-profiles",
        title: "Browser Profiles",
        description: "Manage isolated browser sessions, defaults, bookmarks, and Tor.",
        elementName: "settings-section-browser-profiles",
        panelName: "settings-panel-browser-profiles",
        where: "Settings > Browser > Browser Profiles",
        rows: [
            { key: "browser-profiles", label: "Browser profiles", purpose: "Isolated browser profiles with their own cookies, storage, and cache." },
            { key: "browser-default-profile", label: "Default browser profile", purpose: "The profile used when opening a new browser tab; empty selects the built-in default." },
            { key: "browser-default-bookmarks-file", label: "Default profile bookmarks", purpose: "The .link.json file holding bookmarks for the default browser profile." },
            { key: "browser-incognito-bookmarks-file", label: "Incognito bookmarks", purpose: "The separate .link.json bookmarks file used in incognito mode." },
            { key: "tor.exe-path", label: "Tor executable", purpose: "The tor.exe path required for Browser (Tor) mode; empty disables it." },
            { key: "tor.socks-port", label: "Tor SOCKS port", purpose: "The SOCKS proxy port used by Tor." },
            { key: "tor.bookmarks-file", label: "Tor bookmarks", purpose: "The .link.json bookmarks file used for Browser (Tor) mode." },
        ],
    },
    {
        groupId: "browser",
        groupTitle: "Browser",
        id: "default-browser",
        title: "Default Browser",
        description: "Register Persephone as a Windows default browser and inspect registration status.",
        elementName: "settings-section-default-browser",
        panelName: "settings-panel-default-browser",
        where: "Settings > Browser > Default Browser",
        rows: [],
    },
    {
        groupId: "browser",
        groupTitle: "Browser",
        id: "link-behavior",
        title: "Links",
        description: "Choose where links opened from editors go.",
        elementName: "settings-section-link-behavior",
        panelName: "settings-panel-link-behavior",
        where: "Settings > Browser > Links",
        rows: [
            { key: "link-open-behavior", label: "Link opening behavior", purpose: "Whether external links open in the default OS browser or the nearest internal Browser tab." },
        ],
    },
    {
        groupId: "integrations",
        groupTitle: "Integrations",
        id: "mcp",
        title: "MCP Server / Mneme",
        description: "Configure MCP, main-process scripting, and Mneme services.",
        elementName: "settings-section-mcp",
        panelName: "settings-panel-mcp",
        where: "Settings > Integrations > MCP Server / Mneme",
        rows: [
            { key: "mcp.enabled", label: "MCP server", purpose: "Whether the MCP HTTP server is enabled for AI agents to drive Persephone." },
            { key: "mcp.port", label: "MCP port", purpose: "The loopback port used by the MCP HTTP server." },
            { key: "main.scripting.enabled", label: "Main-process scripting", purpose: "Whether call → main.script.execute may run code in Persephone's main process." },
            { key: "mneme.enabled", label: "Mneme", purpose: "Whether the local Mneme markdown knowledge base is enabled." },
            { key: "mneme.port", label: "Mneme port", purpose: "The loopback port used by Mneme's HTTP/MCP server." },
        ],
    },
    {
        groupId: "integrations",
        groupTitle: "Integrations",
        id: "git-integration",
        title: "Git Integration",
        description: "Enable the Git Tree and Git Diff editors.",
        elementName: "settings-section-git-integration",
        panelName: "settings-panel-git-integration",
        where: "Settings > Integrations > Git Integration",
        rows: [
            { key: "git.enabled", label: "Git integration", purpose: "Whether Git Tree and Git Diff editors are enabled; Git must be on PATH." },
        ],
    },
    {
        groupId: "integrations",
        groupTitle: "Integrations",
        id: "board-vars",
        title: "Board Environment Variables",
        description: "Choose the external file holding per-board variables and secrets.",
        elementName: "settings-section-board-vars",
        panelName: "settings-panel-board-vars",
        where: "Settings > Integrations > Board Environment Variables",
        rows: [
            { key: "board-vars.file", label: "Board environment variables file", purpose: "The external .env.json file holding per-board variables and secrets." },
        ],
    },
];
