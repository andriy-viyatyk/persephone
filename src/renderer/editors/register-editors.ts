import { EditorId } from "../../shared/editor-ids";
import { InternalEditorIds } from "./base/editor-ids";
import type { EditorView } from "../../shared/types";
import type { InternalEditorId } from "./base/editor-ids";
import { editorRegistry } from "./base/editorRegistry";
import { PLATFORM_CAPABILITIES } from "../../shared/platform-capabilities";
import type { EditorCapabilityDeclaration, EditorModule } from "./base/editorRegistry";
import { EDITOR_MATCHERS } from "./base/editor-matchers";
import { customEditorRegistry } from "../api/boards/custom-editor-registry";
import { BOARD_SECONDARY_PREFIX } from "./board/board-secondary";
import { secondaryViewRegistry } from "../ui/secondary-views/secondary-view-registry";
import { englishMessage } from "../../shared/i18n/t";
import type { MessageKey } from "../../shared/i18n/en";

// =============================================================================
// Secondary Editor Registrations 
// =============================================================================

secondaryViewRegistry.register({
    id: "archive-tree",
    labelKey: "shell.archive",
    label: englishMessage("shell.archive"),
    loadModelClass: async () => (await import("./archive/ArchiveEditor")).ArchiveEditor,
    loadView: () => import("./archive/ArchiveSecondaryView"),
});

secondaryViewRegistry.register({
    id: "explorer",
    labelKey: "shell.explorer",
    label: englishMessage("shell.explorer"),
    loadModelClass: async () => (await import("./explorer/ExplorerEditorModel")).ExplorerEditor,
    loadView: () => import("./explorer/ExplorerSecondaryView"),
});

secondaryViewRegistry.register({
    id: "search",
    labelKey: "shell.search",
    label: englishMessage("shell.search"),
    // Sidebar-only sub-panel of Explorer — give it the search glyph (the one on
    // the Explorer header's "open search" button) instead of Explorer's folder icon.
    icon: "search",
    loadModelClass: async () => (await import("./explorer/ExplorerEditorModel")).ExplorerEditor,
    loadView: () => import("./explorer/SearchSecondaryView"),
});

secondaryViewRegistry.register({
    id: "boards",
    labelKey: "shell.boards",
    label: englishMessage("shell.boards"),
    // Sidebar-only sub-panel of Explorer — its own boards glyph,
    // mirroring how "search" overrides to the search registry name. Lists trusted boards under the
    // Explorer root via the shared BoardsTree. Uses the colored variant so the panel
    // header reads as an accent.
    icon: "board-color",
    loadModelClass: async () => (await import("./explorer/ExplorerEditorModel")).ExplorerEditor,
    loadView: () => import("./explorer/BoardsSecondaryView"),
});

secondaryViewRegistry.register({
    id: "clipboard",
    labelKey: "shell.clipboard",
    label: englishMessage("shell.clipboard"),
    icon: "paste",
    loadModelClass: async () => (await import("./explorer/ExplorerEditorModel")).ExplorerEditor,
    loadView: () => import("./explorer/ClipboardSecondaryView"),
});

secondaryViewRegistry.register({
    id: "link-category",
    labelKey: "shell.categories",
    label: englishMessage("shell.categories"),
    loadModelClass: async () => (await import("./link-editor/LinkEditor")).LinkEditor,
    loadView: () => import("./link-editor/panels/LinkCategorySecondaryView"),
});

secondaryViewRegistry.register({
    id: "link-tags",
    labelKey: "shell.tags",
    label: englishMessage("shell.tags"),
    loadModelClass: async () => (await import("./link-editor/LinkEditor")).LinkEditor,
    loadView: () => import("./link-editor/panels/LinkTagsSecondaryView"),
});

secondaryViewRegistry.register({
    id: "link-hostnames",
    labelKey: "shell.hostnames",
    label: englishMessage("shell.hostnames"),
    loadModelClass: async () => (await import("./link-editor/LinkEditor")).LinkEditor,
    loadView: () => import("./link-editor/panels/LinkHostnamesSecondaryView"),
});

secondaryViewRegistry.register({
    id: "git-changes",
    labelKey: "shell.git",
    label: englishMessage("shell.git"),
    loadModelClass: async () => (await import("./git-tree/GitTreeEditorModel")).GitTreeEditorModel,
    loadView: () => import("./git-tree/GitPanelSecondaryView"),
});

secondaryViewRegistry.register({
    id: "git-diff-revisions",
    labelKey: "shell.fileHistory",
    label: englishMessage("shell.fileHistory"),
    loadModelClass: async () => (await import("./file-diff/FileDiffEditor")).FileDiffEditor,
    loadView: () => import("./file-diff/GitDiffRevisionsSecondaryView"),
});

secondaryViewRegistry.register({
    id: "mneme-tree",
    labelKey: "shell.wiki",
    label: englishMessage("shell.wiki"),
    // No icon override → falls back to the editor's MemoryIcon.
    loadModelClass: async () => (await import("./mneme-root/MnemeRootEditorModel")).MnemeRootEditorModel,
    loadView: () => import("./mneme-root/MnemeTreeSecondaryView"),
});

// Board secondary views: one registration serves the whole
// `board-secondary:*` id family — a board declares zero-or-more views in its manifest
// (or via `persephone.setSecondaryViews`), each mapped to a `board-secondary:<viewId>`
// panel. BoardSecondaryView reads its `panelId` to render the matching view over the
// board's model. No icon override → falls back to the board's own glyph.
secondaryViewRegistry.registerPrefix(BOARD_SECONDARY_PREFIX, {
    id: BOARD_SECONDARY_PREFIX,
    labelKey: "shell.boardView",
    label: englishMessage("shell.boardView"), // never shown
    loadModelClass: async () => (await import("./board/BoardEditorModel")).BoardEditorModel,
    loadView: () => import("./board/BoardSecondaryView"),
});

// =============================================================================
// Editor Registrations — table-driven
// =============================================================================
// One row per editor. Matching rules are owned by EDITOR_MATCHERS[id]; standalone
// editors have no matcher claim.
// Each row's `load` MUST keep a literal `import("./…")` so Vite code splitting
// is preserved — never build the specifier dynamically.

interface EditorRow {
    id: EditorView | InternalEditorId;
    nameKey: MessageKey;
    guidePath?: string;
    hasContentHost?: boolean;
    mcpHint?: string;
    folderIcon?: string;
    load: () => Promise<EditorModule>;
}

const EDITORS: EditorRow[] = [
    {
        id: EditorId.monaco,
        nameKey: "editors.textEditor",
        guidePath: "editors/monaco",
        hasContentHost: true,
        load: async () => (await import("./monaco")).monacoModule,
    },
    { id: EditorId.gridJson, nameKey: "editors.gridJson", guidePath: "editors/grid", hasContentHost: true, load: async () => (await import("./grid")).gridJsonModule },
    { id: EditorId.gridCsv, nameKey: "editors.gridCsv", guidePath: "editors/grid", hasContentHost: true, load: async () => (await import("./grid")).gridCsvModule },
    { id: EditorId.gridJsonl, nameKey: "editors.gridJsonl", guidePath: "editors/grid", hasContentHost: true, load: async () => (await import("./grid")).gridJsonlModule },
    { id: EditorId.logView, nameKey: "editors.logView", guidePath: "editors/log-view", hasContentHost: true, mcpHint: 'Use pages.logView.push(entries) to write entries to the MCP Log View; use pages.logView.dialogResult(id) to read an answer.', load: async () => (await import("./log-view")).logViewModule },
    { id: EditorId.mdView, nameKey: "editors.preview", guidePath: "editors/markdown", hasContentHost: true, load: async () => (await import("./markdown")).markdownModule },
    { id: EditorId.svgView, nameKey: "editors.preview", guidePath: "editors/svg", hasContentHost: true, load: async () => (await import("./svg")).svgModule },
    { id: EditorId.htmlView, nameKey: "editors.preview", guidePath: "editors/html", hasContentHost: true, load: async () => (await import("./html")).htmlModule },
    { id: EditorId.mermaidView, nameKey: "editors.mermaid", guidePath: "editors/mermaid", hasContentHost: true, load: async () => (await import("./mermaid")).mermaidModule },
    { id: EditorId.linkView, nameKey: "editors.links", guidePath: "editors/links", hasContentHost: true, load: async () => (await import("./link-editor")).linkModule },
    { id: EditorId.envVarsView, nameKey: "editors.envVars", guidePath: "editors/env-vars", hasContentHost: true, load: async () => (await import("./env-vars")).envVarsModule },
    { id: EditorId.browserView, nameKey: "editors.browser", guidePath: "editors/browser", mcpHint: "Use pages.openUrlInBrowserTab(url, options) to open or reuse a URL in the built-in browser, then use pages[i].editor after narrowing editor.id to \"browser-view\".", load: async () => (await import("./browser")).browserModule },
    { id: EditorId.imageView, nameKey: "editors.imageViewer", guidePath: "editors/image", mcpHint: 'Use script.execute with: await app.pages.openFile("/path/to/image.png")', load: async () => (await import("./image")).imageModule },
    { id: EditorId.archiveView, nameKey: "editors.archive", guidePath: "editors/archive", mcpHint: 'Use script.execute with: await app.pages.openFile("/path/to/archive.zip")', load: async () => (await import("./archive")).archiveModule },
    { id: EditorId.videoView, nameKey: "editors.videoPlayer", guidePath: "editors/video", mcpHint: 'Use script.execute with: await app.pages.openFile("/path/to/video.mp4")', load: async () => (await import("./video")).videoModule },
    { id: EditorId.settingsView, nameKey: "editors.settings", guidePath: "screens/settings", mcpHint: "Use script.execute with: await app.pages.showSettingsPage()", load: async () => (await import("./settings")).settingsModule },
    { id: InternalEditorIds.restoreFailed, nameKey: "editors.restoreFailedTitle", load: async () => (await import("./restore-failed")).restoreFailedModule },
    { id: EditorId.aboutView, nameKey: "editors.about", guidePath: "screens/index", mcpHint: "Use script.execute with: await app.pages.showAboutPage()", load: async () => (await import("./about")).aboutModule },
    // Reached only via showToolsHubPage (the AppBar panel's "Open in new tab" button) —
    // never a file-open target.
    { id: EditorId.toolsHubView, nameKey: "editors.toolsAndEditors", guidePath: "screens/index", load: async () => (await import("./tools-hub")).toolsHubModule },
    { id: EditorId.mcpView, nameKey: "editors.mcpInspector", guidePath: "screens/mcp-inspector", mcpHint: 'Open with pages.showMcpInspectorPage() or pages.showMcpInspectorPage({ url: "http://host:port/mcp" }) using a credential-free URL, then use pages[i].editor after narrowing editor.id to "mcp-view" to inspect connection and panel state.', load: async () => (await import("./mcp-inspector")).mcpModule },
    { id: EditorId.mnemeConfig, nameKey: "editors.mneme", guidePath: "mneme", mcpHint: 'Use pages.showMnemeConfigPage(), then the "mneme-config" editor facade for configuration and status; use the Mneme MCP server for document contents and document operations. This facade does not expose transport credentials.', load: async () => (await import("./mneme-config")).mnemeConfigModule },
    // Importer touched for the Storybook editor's .tsx -> .ts native-view conversion.
    { id: EditorId.storybookView, nameKey: "editors.storybook", load: async () => (await import("./storybook")).storybookModule },
    { id: EditorId.categoryView, nameKey: "editors.folderView", guidePath: "editors/folder", load: async () => (await import("./category")).categoryModule },
    { id: EditorId.gitTree, nameKey: "editors.gitTree", guidePath: "editors/git-tree", folderIcon: "git", load: async () => (await import("./git-tree")).gitTreeModule },
    { id: EditorId.mnemeRoot, nameKey: "editors.mneme", guidePath: "mneme", folderIcon: "mneme", mcpHint: 'Use the "mneme-root" editor facade for root and search state; use the Mneme MCP server for document contents and document operations. This facade does not expose transport credentials.', load: async () => (await import("./mneme-root")).mnemeRootModule },
    { id: EditorId.boardView, nameKey: "editors.boards", guidePath: "editors/board", load: async () => (await import("./board")).boardModule },
    { id: EditorId.toolsetView, nameKey: "editors.agentTool", guidePath: "agent-tools", load: async () => (await import("./toolset")).toolsetModule },
    {
        id: EditorId.boardInfo,
        nameKey: "editors.boardInfo",
        guidePath: "boards",
        // Host-capable holder: adopts/yields the shared content host WITHOUT rendering
        // it, so `Text ↔ + ↔ installed board` switches transfer the same host with no reload.
        hasContentHost: true,
        // Never a default open target — reached only via the "+" switch entry or explicit
        // navigation (hub, update toast, or Properties button). No matcher claim.
        load: async () => (await import("./board-info")).boardInfoModule,
    },
    {
        id: InternalEditorIds.fileDiff,
        nameKey: "editors.gitDiff",
        guidePath: "editors/file-diff",
        hasContentHost: true,
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
        capabilities: PLATFORM_CAPABILITIES.filter((item) => item.editorId === e.id) as readonly EditorCapabilityDeclaration[],
        match,
        loadModule: e.load,
    });
}

editorRegistry.registerRestoreOnly(InternalEditorIds.explorer, async () => (await import("./explorer")).explorerRestoreModule);
editorRegistry.registerRestoreOnly("draw-view", async () => (await import("./board")).boardModule);


// Warm the custom-editor registry while bootstrap joins this same
// initialization before restoring pages. The fire-and-forget warm-up preserves the existing
// preload path for callers that load the editor registry independently.
void customEditorRegistry.ensureInitialized();

// Warm the content-host editor modules so the synchronous construction path
// (the editor factory's synchronous host construction under the sync public APIs `addEditorPage` / `openLinks` /
// `page.grouped`) can build any text-host editor from the registry's module cache.
// Fire-and-forget: the chunks load in the background right after registration.
editorRegistry.preloadContentHostModules();

