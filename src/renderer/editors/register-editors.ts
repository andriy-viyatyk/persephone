import { editorRegistry } from "./base/editorRegistry";
import { seedPlatformCapabilities } from "../api/capabilities";
import type {
    EditorCapabilityDeclaration,
    EditorDefinition,
    EditorModule,
} from "./base/editorRegistry";
import { EDITOR_MATCHERS, makeAccepts } from "./base/editor-matchers";
import { customEditorRegistry } from "./board/custom-editor-registry";
import { BOARD_SECONDARY_PREFIX } from "./board/board-secondary";
import { secondaryViewRegistry } from "../ui/secondary-views/secondary-view-registry";
import { englishMessage } from "../../shared/i18n/t";
import type { MessageKey } from "../../shared/i18n/en";

// =============================================================================
// Secondary Editor Registrations (EPIC-016)
// =============================================================================

secondaryViewRegistry.register({
    id: "archive-tree",
    labelKey: "shell.archive",
    label: englishMessage("shell.archive"),
    loadView: () => import("./archive/ArchiveSecondaryView"),
});

secondaryViewRegistry.register({
    id: "explorer",
    labelKey: "shell.explorer",
    label: englishMessage("shell.explorer"),
    loadView: () => import("./explorer/ExplorerSecondaryView"),
});

secondaryViewRegistry.register({
    id: "search",
    labelKey: "shell.search",
    label: englishMessage("shell.search"),
    // Sidebar-only sub-panel of Explorer — give it the search glyph (the one on
    // the Explorer header's "open search" button) instead of Explorer's folder icon.
    icon: "search",
    loadView: () => import("./explorer/SearchSecondaryView"),
});

secondaryViewRegistry.register({
    id: "boards",
    labelKey: "shell.boards",
    label: englishMessage("shell.boards"),
    // Sidebar-only sub-panel of Explorer (EPIC-036 / US-761) — its own boards glyph,
    // mirroring how "search" overrides to the search registry name. Lists trusted boards under the
    // Explorer root via the shared BoardsTree. Uses the colored variant so the panel
    // header reads as an accent.
    icon: "board-color",
    loadView: () => import("./explorer/BoardsSecondaryView"),
});

secondaryViewRegistry.register({
    id: "clipboard",
    labelKey: "shell.clipboard",
    label: englishMessage("shell.clipboard"),
    icon: "paste",
    loadView: () => import("./explorer/ClipboardSecondaryView"),
});

secondaryViewRegistry.register({
    id: "link-category",
    labelKey: "shell.categories",
    label: englishMessage("shell.categories"),
    loadView: () => import("./link-editor/panels/LinkCategorySecondaryView"),
});

secondaryViewRegistry.register({
    id: "link-tags",
    labelKey: "shell.tags",
    label: englishMessage("shell.tags"),
    loadView: () => import("./link-editor/panels/LinkTagsSecondaryView"),
});

secondaryViewRegistry.register({
    id: "link-hostnames",
    labelKey: "shell.hostnames",
    label: englishMessage("shell.hostnames"),
    loadView: () => import("./link-editor/panels/LinkHostnamesSecondaryView"),
});

secondaryViewRegistry.register({
    id: "notebook-categories",
    labelKey: "shell.categories",
    label: englishMessage("shell.categories"),
    loadView: () => import("./notebook/panels/NotebookCategoriesSecondaryView"),
});

secondaryViewRegistry.register({
    id: "notebook-tags",
    labelKey: "shell.tags",
    label: englishMessage("shell.tags"),
    loadView: () => import("./notebook/panels/NotebookTagsSecondaryView"),
});

secondaryViewRegistry.register({
    id: "git-changes",
    labelKey: "shell.git",
    label: englishMessage("shell.git"),
    loadView: () => import("./git-tree/GitPanelSecondaryView"),
});

secondaryViewRegistry.register({
    id: "git-diff-revisions",
    labelKey: "shell.fileHistory",
    label: englishMessage("shell.fileHistory"),
    loadView: () => import("./file-diff/GitDiffRevisionsSecondaryView"),
});

secondaryViewRegistry.register({
    id: "mneme-tree",
    labelKey: "shell.wiki",
    label: englishMessage("shell.wiki"),
    // No icon override → falls back to the editor's MemoryIcon (EPIC-032 / US-663).
    loadView: () => import("./mneme-root/MnemeTreeSecondaryView"),
});

// Board secondary views (EPIC-044 / US-853): one registration serves the whole
// `board-secondary:*` id family — a board declares zero-or-more views in its manifest
// (or via `persephone.setSecondaryViews`), each mapped to a `board-secondary:<viewId>`
// panel. BoardSecondaryView reads its `panelId` to render the matching view over the
// board's model. No icon override → falls back to the board's own glyph.
secondaryViewRegistry.registerPrefix(BOARD_SECONDARY_PREFIX, {
    id: BOARD_SECONDARY_PREFIX,
    labelKey: "shell.boardView",
    label: englishMessage("shell.boardView"), // never shown — BoardSecondaryView renders its own header from the decl
    loadView: () => import("./board/BoardSecondaryView"),
});

// =============================================================================
// Editor Registrations — table-driven
// =============================================================================
// One row per editor. Derived defaults keep the rows to the three things that
// actually differ (id, name, module importer):
//   - `match` comes from EDITOR_MATCHERS[id] (absent for pure standalone
//     editors that never match a file and never appear in the switch widget);
//   - `accepts` defaults to makeAccepts(match) when a matcher exists, else
//     `() => -1`; rows with special acceptance semantics override it.
// Each row's `load` MUST keep a literal `import("./…")` so Vite code splitting
// is preserved — never build the specifier dynamically.

interface EditorRow {
    id: string;
    nameKey: MessageKey;
    guidePath?: string;
    hasContentHost?: boolean;
    mcpHint?: string;
    folderIcon?: string;
    capabilities?: readonly EditorCapabilityDeclaration[];
    /** Explicit acceptance override (monaco, file-diff). */
    accepts?: EditorDefinition["accepts"];
    load: () => Promise<EditorModule>;
}

const EDITORS: EditorRow[] = [
    {
        id: "monaco",
        nameKey: "editors.textEditor",
        guidePath: "editors/monaco",
        hasContentHost: true,
        // Explicit accepts (NOT makeAccepts): monaco is the universal text fallback
        // and the page-switch floor — walkthrough 20 §accepts. Its number outranks
        // content editors so it leads `findEditorsAccepting`; specific viewers
        // outrank it in view mode. Its matcher carries the separate file-resolution
        // floor (0) + switch-first (0) priorities for the registry's resolve /
        // getSwitchOptions / validateForLanguage.
        accepts: (input) => {
            if (input.mode === "view") return 10;
            return 50;
        },
        capabilities: [{ id: "text.open" }],
        load: async () => (await import("./monaco")).monacoModule,
    },
    { id: "grid-json", nameKey: "editors.gridJson", guidePath: "editors/grid", hasContentHost: true, capabilities: [{ id: "content.view", representation: "grid" }], load: async () => (await import("./grid")).gridJsonModule },
    { id: "grid-csv", nameKey: "editors.gridCsv", guidePath: "editors/grid", hasContentHost: true, load: async () => (await import("./grid")).gridCsvModule },
    { id: "grid-jsonl", nameKey: "editors.gridJsonl", guidePath: "editors/grid", hasContentHost: true, load: async () => (await import("./grid")).gridJsonlModule },
    { id: "log-view", nameKey: "editors.logView", guidePath: "editors/log-view", hasContentHost: true, mcpHint: 'Use pages.logView.push(entries) to write entries to the MCP Log View; use pages.logView.dialogResult(id) to read an answer.', capabilities: [{ id: "content.view", representation: "log" }], load: async () => (await import("./log-view")).logViewModule },
    { id: "md-view", nameKey: "editors.preview", guidePath: "editors/markdown", hasContentHost: true, capabilities: [{ id: "content.view", representation: "markdown" }], load: async () => (await import("./markdown")).markdownModule },
    { id: "svg-view", nameKey: "editors.preview", guidePath: "editors/svg", hasContentHost: true, capabilities: [{ id: "content.view", representation: "svg" }], load: async () => (await import("./svg")).svgModule },
    { id: "html-view", nameKey: "editors.preview", guidePath: "editors/html", hasContentHost: true, capabilities: [{ id: "content.view", representation: "html" }], load: async () => (await import("./html")).htmlModule },
    { id: "mermaid-view", nameKey: "editors.mermaid", guidePath: "editors/mermaid", hasContentHost: true, capabilities: [{ id: "content.view", representation: "mermaid" }], load: async () => (await import("./mermaid")).mermaidModule },
    { id: "link-view", nameKey: "editors.links", guidePath: "editors/links", hasContentHost: true, load: async () => (await import("./link-editor")).linkModule },
    { id: "notebook-view", nameKey: "editors.notebook", guidePath: "editors/notebook", hasContentHost: true, load: async () => (await import("./notebook")).notebookModule },
    { id: "env-vars-view", nameKey: "editors.envVars", guidePath: "editors/env-vars", hasContentHost: true, load: async () => (await import("./env-vars")).envVarsModule },
    { id: "browser-view", nameKey: "editors.browser", guidePath: "editors/browser", mcpHint: "Use pages.openUrlInBrowserTab(url, options) to open or reuse a URL in the built-in browser, then use pages[i].editor after narrowing editor.id to \"browser-view\".", load: async () => (await import("./browser")).browserModule },
    { id: "image-view", nameKey: "editors.imageViewer", guidePath: "editors/image", mcpHint: 'Use script.execute with: await app.pages.openFile("/path/to/image.png")', load: async () => (await import("./image")).imageModule },
    { id: "archive-view", nameKey: "editors.archive", guidePath: "editors/archive", mcpHint: 'Use script.execute with: await app.pages.openFile("/path/to/archive.zip")', load: async () => (await import("./archive")).archiveModule },
    { id: "video-view", nameKey: "editors.videoPlayer", guidePath: "editors/video", mcpHint: 'Use script.execute with: await app.pages.openFile("/path/to/video.mp4")', load: async () => (await import("./video")).videoModule },
    { id: "settings-view", nameKey: "editors.settings", guidePath: "screens/settings", mcpHint: "Use script.execute with: await app.pages.showSettingsPage()", load: async () => (await import("./settings")).settingsModule },
    { id: "about-view", nameKey: "editors.about", guidePath: "screens/index", mcpHint: "Use script.execute with: await app.pages.showAboutPage()", load: async () => (await import("./about")).aboutModule },
    // Reached only via showToolsHubPage (the AppBar panel's "Open in new tab" button) —
    // never a file-open target.
    { id: "tools-hub-view", nameKey: "editors.toolsAndEditors", guidePath: "screens/index", load: async () => (await import("./tools-hub")).toolsHubModule },
    { id: "mcp-view", nameKey: "editors.mcpInspector", guidePath: "screens/mcp-inspector", mcpHint: 'Open with pages.showMcpInspectorPage() or pages.showMcpInspectorPage({ url: "http://host:port/mcp" }) using a credential-free URL, then use pages[i].editor after narrowing editor.id to "mcp-view" to inspect connection and panel state.', load: async () => (await import("./mcp-inspector")).mcpModule },
    { id: "mneme-config", nameKey: "editors.mneme", guidePath: "mneme", mcpHint: 'Use pages.showMnemeConfigPage(), then the "mneme-config" editor facade for configuration and status; use the Mneme MCP server for document contents and document operations. This facade does not expose transport credentials.', load: async () => (await import("./mneme-config")).mnemeConfigModule },
    // Importer touched for the Storybook editor's .tsx -> .ts native-view conversion.
    { id: "storybook-view", nameKey: "editors.storybook", load: async () => (await import("./storybook")).storybookModule },
    { id: "category-view", nameKey: "editors.folderView", guidePath: "editors/folder", load: async () => (await import("./category")).categoryModule },
    { id: "git-tree", nameKey: "editors.gitTree", guidePath: "editors/git-tree", folderIcon: "git", load: async () => (await import("./git-tree")).gitTreeModule },
    { id: "mneme-root", nameKey: "editors.mneme", guidePath: "mneme", folderIcon: "mneme", mcpHint: 'Use the "mneme-root" editor facade for root and search state; use the Mneme MCP server for document contents and document operations. This facade does not expose transport credentials.', load: async () => (await import("./mneme-root")).mnemeRootModule },
    { id: "board-view", nameKey: "editors.boards", guidePath: "editors/board", load: async () => (await import("./board")).boardModule },
    { id: "toolset-view", nameKey: "editors.agentTool", guidePath: "agent-tools", load: async () => (await import("./toolset")).toolsetModule },
    {
        id: "board-info",
        nameKey: "editors.boardInfo",
        guidePath: "boards",
        // Host-capable holder (EPIC-045): adopts/yields the shared content host WITHOUT rendering
        // it, so `Text ↔ + ↔ installed board` switches transfer the same host with no reload.
        hasContentHost: true,
        // Never a default open target — reached only via the "+" switch entry or explicit
        // navigation (hub / update toast / Properties button, US-867). No matcher → accepts -1.
        load: async () => (await import("./board-info")).boardInfoModule,
    },
    {
        id: "file-diff",
        nameKey: "editors.gitDiff",
        guidePath: "editors/file-diff",
        hasContentHost: true,
        // Host-aware (EPIC-030 / US-613): offered for any file detected in a git
        // repo, regardless of changes (Concern 2A). No host (file-open resolution)
        // → -1, so it never becomes a default open target. Below monaco (50) so
        // editing stays the primary editor.
        accepts: (input) =>
            (input.host?.state.get() as { gitRepo?: unknown } | undefined)?.gitRepo ? 25 : -1,
        load: async () => (await import("./file-diff")).fileDiffModule,
    },
];

for (const e of EDITORS) {
    const match = EDITOR_MATCHERS[e.id];
    editorRegistry.register({
        id: e.id,
        name: englishMessage(e.nameKey),
        nameKey: e.nameKey,
        guidePath: e.guidePath,
        hasContentHost: e.hasContentHost ?? false,
        mcpHint: e.mcpHint,
        folderIcon: e.folderIcon,
        capabilities: e.capabilities,
        accepts: e.accepts ?? (match ? makeAccepts(match) : () => -1),
        match,
        loadModule: e.load,
    });
}

seedPlatformCapabilities();

// Warm the custom-editor registry (EPIC-042 / EPIC-109) while bootstrap joins this same
// initialization before restoring pages. The fire-and-forget warm-up preserves the existing
// preload path for callers that load the editor registry independently.
void customEditorRegistry.ensureInitialized();

// Warm the content-host editor modules so the synchronous construction path
// (`attachEditorToPage` under the sync public APIs `addEditorPage` / `openLinks` /
// `page.grouped`) can build any text-host editor from the registry's module cache.
// Fire-and-forget: the chunks load in the background right after registration.
editorRegistry.preloadContentHostModules();

