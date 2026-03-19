import { editorRegistry } from "./registry";
import { EditorModule } from "./types";

// =============================================================================
// Helper functions for common patterns
// =============================================================================

/** Check if file matches any of the given extensions */
const matchesExtension = (fileName: string, extensions: string[]): boolean => {
    const lower = fileName.toLowerCase();
    return extensions.some((ext) => lower.endsWith(ext));
};

/** Check if file matches a pattern */
const matchesPattern = (fileName: string, pattern: RegExp): boolean => {
    return pattern.test(fileName.toLowerCase());
};

// Patterns for specialized JSON editors (excluded from grid-json)
const SPECIALIZED_JSON_PATTERNS = [
    /\.note\.json$/i,
    /\.todo\.json$/i,
    /\.link\.json$/i,
    /\.fg\.json$/i,
    /\.excalidraw$/i,
];

const isSpecializedJson = (fileName?: string): boolean => {
    if (!fileName) return false;
    return SPECIALIZED_JSON_PATTERNS.some((p) => p.test(fileName));
};

// =============================================================================
// Text Editor Module (shared by content-view editors)
// =============================================================================

const textEditorModule: EditorModule = {
    get Editor() {
        // Lazy access to avoid circular dependency
        return require("./text/TextPageView").TextPageView;
    },
    newPageModel: async (filePath?: string) => {
        const { newTextFileModel } = await import("./text/TextPageModel");
        return newTextFileModel(filePath);
    },
    newEmptyPageModel: async (pageType) => {
        if (pageType !== "textFile") return null;
        const { newTextFileModel } = await import("./text/TextPageModel");
        return newTextFileModel();
    },
    newPageModelFromState: async (state) => {
        const { newTextFileModelFromState } = await import("./text/TextPageModel");
        return newTextFileModelFromState(state);
    },
};

// =============================================================================
// Editor Registrations
// =============================================================================

// Monaco (default text editor - fallback for all text files)
editorRegistry.register({
    id: "monaco",
    name: "Text Editor",
    pageType: "textFile",
    category: "content-view",
    acceptFile: () => 0, // Lowest priority - fallback for all files
    validForLanguage: () => true, // Valid for all languages
    switchOption: () => 0, // Always available as first option
    loadModule: async () => {
        const { createTextViewModel } = await import("./text/TextEditor");
        // Object.create preserves the lazy `get Editor()` getter on the prototype
        // (spread would call the getter eagerly, triggering require() too early)
        const module: EditorModule = Object.create(textEditorModule);
        module.createViewModel = createTextViewModel;
        return module;
    },
});

// Grid JSON editor
editorRegistry.register({
    id: "grid-json",
    name: "Grid",
    pageType: "textFile",
    category: "content-view",
    acceptFile: (fileName) => {
        // High priority for .grid.json files
        if (matchesPattern(fileName, /\.grid\.json$/i)) return 20;
        return -1;
    },
    validForLanguage: (languageId) => languageId === "json",
    switchOption: (languageId, fileName) => {
        if (languageId !== "json") return -1;
        // Exclude for specialized JSON editors
        if (isSpecializedJson(fileName)) return -1;
        return 10;
    },
    loadModule: async () => {
        const [module, { createGridViewModel }] = await Promise.all([
            import("./grid/GridEditor"),
            import("./grid/GridViewModel"),
        ]);
        return {
            Editor: module.GridEditor,
            createViewModel: createGridViewModel,
            newPageModel: textEditorModule.newPageModel,
            newEmptyPageModel: textEditorModule.newEmptyPageModel,
            newPageModelFromState: textEditorModule.newPageModelFromState,
        };
    },
});

// Grid CSV editor
editorRegistry.register({
    id: "grid-csv",
    name: "Grid",
    pageType: "textFile",
    category: "content-view",
    acceptFile: (fileName) => {
        // High priority for .grid.csv files
        if (matchesPattern(fileName, /\.grid\.csv$/i)) return 20;
        return -1;
    },
    validForLanguage: (languageId) => languageId === "csv",
    switchOption: (languageId) => {
        if (languageId !== "csv") return -1;
        return 10;
    },
    loadModule: async () => {
        const [module, { createGridViewModel }] = await Promise.all([
            import("./grid/GridEditor"),
            import("./grid/GridViewModel"),
        ]);
        return {
            Editor: module.GridEditor,
            createViewModel: createGridViewModel,
            newPageModel: textEditorModule.newPageModel,
            newEmptyPageModel: textEditorModule.newEmptyPageModel,
            newPageModelFromState: textEditorModule.newPageModelFromState,
        };
    },
});

// Grid JSONL editor
editorRegistry.register({
    id: "grid-jsonl",
    name: "Grid",
    pageType: "textFile",
    category: "content-view",
    acceptFile: (fileName) => {
        if (matchesPattern(fileName, /\.grid\.jsonl$/i)) return 20;
        return -1;
    },
    validForLanguage: (languageId) => languageId === "jsonl",
    switchOption: (languageId) => {
        if (languageId !== "jsonl") return -1;
        return 10;
    },
    loadModule: async () => {
        const [module, { createGridViewModel }] = await Promise.all([
            import("./grid/GridEditor"),
            import("./grid/GridViewModel"),
        ]);
        return {
            Editor: module.GridEditor,
            createViewModel: createGridViewModel,
            newPageModel: textEditorModule.newPageModel,
            newEmptyPageModel: textEditorModule.newEmptyPageModel,
            newPageModelFromState: textEditorModule.newPageModelFromState,
        };
    },
});

// Log View editor (content-view for .log.jsonl files)
editorRegistry.register({
    id: "log-view",
    name: "Log View",
    pageType: "textFile",
    category: "content-view",
    acceptFile: (fileName) => {
        if (matchesPattern(fileName, /\.log\.jsonl$/i)) return 20;
        return -1;
    },
    validForLanguage: (languageId) => languageId === "jsonl",
    switchOption: (languageId, fileName) => {
        if (languageId !== "jsonl") return -1;
        // Only show for .log.jsonl files
        if (!fileName || !matchesPattern(fileName, /\.log\.jsonl$/i)) return -1;
        return 10;
    },
    isEditorContent: (languageId, content) => {
        if (languageId !== "jsonl") return false;
        return /\"type\"\s*:\s*\"log\./.test(content);
    },
    loadModule: async () => {
        const [module, { createLogViewModel }] = await Promise.all([
            import("./log-view/LogViewEditor"),
            import("./log-view/LogViewModel"),
        ]);
        return {
            Editor: module.LogViewEditor,
            createViewModel: createLogViewModel,
            newPageModel: textEditorModule.newPageModel,
            newEmptyPageModel: textEditorModule.newEmptyPageModel,
            newPageModelFromState: textEditorModule.newPageModelFromState,
        };
    },
});

// Markdown preview
editorRegistry.register({
    id: "md-view",
    name: "Preview",
    pageType: "textFile",
    category: "content-view",
    validForLanguage: (languageId) => languageId === "markdown",
    switchOption: (languageId) => {
        if (languageId !== "markdown") return -1;
        return 10;
    },
    loadModule: async () => {
        const [module, { createMarkdownViewModel }] = await Promise.all([
            import("./markdown/MarkdownView"),
            import("./markdown/MarkdownViewModel"),
        ]);
        return {
            Editor: module.MarkdownView,
            createViewModel: createMarkdownViewModel,
            newPageModel: textEditorModule.newPageModel,
            newEmptyPageModel: textEditorModule.newEmptyPageModel,
            newPageModelFromState: textEditorModule.newPageModelFromState,
        };
    },
});

// PDF viewer (standalone page editor)
editorRegistry.register({
    id: "pdf-view",
    name: "PDF Viewer",
    pageType: "pdfFile",
    category: "page-editor",
    acceptFile: (fileName) => {
        if (matchesExtension(fileName, [".pdf"])) return 100;
        return -1;
    },
    loadModule: async () => {
        const module = await import("./pdf/PdfViewer");
        return module.default;
    },
});

// Image viewer (standalone page editor for binary images)
editorRegistry.register({
    id: "image-view",
    name: "Image Viewer",
    pageType: "imageFile",
    category: "page-editor",
    acceptFile: (fileName) => {
        const imageExtensions = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".ico"];
        if (matchesExtension(fileName, imageExtensions)) return 100;
        return -1;
    },
    loadModule: async () => {
        const module = await import("./image/ImageViewer");
        return module.default;
    },
});

// Notebook editor (content-view for .note.json files)
editorRegistry.register({
    id: "notebook-view",
    name: "Notebook",
    pageType: "textFile",
    category: "content-view",
    acceptFile: (fileName) => {
        // High priority for .note.json files - opens in notebook by default
        if (matchesPattern(fileName, /\.note\.json$/i)) return 20;
        return -1;
    },
    validForLanguage: (languageId) => languageId === "json",
    switchOption: (languageId, fileName) => {
        // Only show for .note.json files
        if (languageId !== "json") return -1;
        if (!fileName || !matchesPattern(fileName, /\.note\.json$/i)) return -1;
        return 10;
    },
    isEditorContent: (languageId, content) => {
        if (languageId !== "json") return false;
        if (!content.includes('"type"')) return false;
        return /"type"\s*:\s*"note-editor"/.test(content) && content.includes('"notes"');
    },
    loadModule: async () => {
        const [module, { createNotebookViewModel }] = await Promise.all([
            import("./notebook/NotebookEditor"),
            import("./notebook/NotebookViewModel"),
        ]);
        return {
            Editor: module.NotebookEditor,
            createViewModel: createNotebookViewModel,
            newPageModel: textEditorModule.newPageModel,
            newEmptyPageModel: textEditorModule.newEmptyPageModel,
            newPageModelFromState: textEditorModule.newPageModelFromState,
        };
    },
});

// SVG preview (content-view for SVG files)
editorRegistry.register({
    id: "svg-view",
    name: "Preview",
    pageType: "textFile",
    category: "content-view",
    validForLanguage: (languageId) => languageId === "xml",
    switchOption: (_languageId, fileName) => {
        // Only show for .svg files
        if (fileName && matchesExtension(fileName, [".svg"])) return 10;
        return -1;
    },
    loadModule: async () => {
        const [module, { createSvgViewModel }] = await Promise.all([
            import("./svg/SvgView"),
            import("./svg/SvgViewModel"),
        ]);
        return {
            Editor: module.SvgView,
            createViewModel: createSvgViewModel,
            newPageModel: textEditorModule.newPageModel,
            newEmptyPageModel: textEditorModule.newEmptyPageModel,
            newPageModelFromState: textEditorModule.newPageModelFromState,
        };
    },
});

// HTML preview (content-view for HTML files)
editorRegistry.register({
    id: "html-view",
    name: "Preview",
    pageType: "textFile",
    category: "content-view",
    validForLanguage: (languageId) => languageId === "html",
    switchOption: (languageId) => {
        if (languageId !== "html") return -1;
        return 10;
    },
    loadModule: async () => {
        const [module, { createHtmlViewModel }] = await Promise.all([
            import("./html/HtmlView"),
            import("./html/HtmlViewModel"),
        ]);
        return {
            Editor: module.HtmlView,
            createViewModel: createHtmlViewModel,
            newPageModel: textEditorModule.newPageModel,
            newEmptyPageModel: textEditorModule.newEmptyPageModel,
            newPageModelFromState: textEditorModule.newPageModelFromState,
        };
    },
});

// Mermaid diagram preview (content-view for .mmd files)
editorRegistry.register({
    id: "mermaid-view",
    name: "Mermaid",
    pageType: "textFile",
    category: "content-view",
    validForLanguage: (languageId) => languageId === "mermaid",
    switchOption: (languageId) => {
        if (languageId !== "mermaid") return -1;
        return 10;
    },
    loadModule: async () => {
        const [module, { createMermaidViewModel }] = await Promise.all([
            import("./mermaid/MermaidView"),
            import("./mermaid/MermaidViewModel"),
        ]);
        return {
            Editor: module.MermaidView,
            createViewModel: createMermaidViewModel,
            newPageModel: textEditorModule.newPageModel,
            newEmptyPageModel: textEditorModule.newEmptyPageModel,
            newPageModelFromState: textEditorModule.newPageModelFromState,
        };
    },
});

// Todo editor (content-view for .todo.json files)
editorRegistry.register({
    id: "todo-view",
    name: "ToDo",
    pageType: "textFile",
    category: "content-view",
    acceptFile: (fileName) => {
        if (matchesPattern(fileName, /\.todo\.json$/i)) return 20;
        return -1;
    },
    validForLanguage: (languageId) => languageId === "json",
    switchOption: (languageId, fileName) => {
        if (languageId !== "json") return -1;
        if (!fileName || !matchesPattern(fileName, /\.todo\.json$/i)) return -1;
        return 10;
    },
    isEditorContent: (languageId, content) => {
        if (languageId !== "json") return false;
        if (!content.includes('"type"')) return false;
        return /"type"\s*:\s*"todo-editor"/.test(content) && content.includes('"items"');
    },
    loadModule: async () => {
        const [module, { createTodoViewModel }] = await Promise.all([
            import("./todo/TodoEditor"),
            import("./todo/TodoViewModel"),
        ]);
        return {
            Editor: module.TodoEditor,
            createViewModel: createTodoViewModel,
            newPageModel: textEditorModule.newPageModel,
            newEmptyPageModel: textEditorModule.newEmptyPageModel,
            newPageModelFromState: textEditorModule.newPageModelFromState,
        };
    },
});

// Link editor (content-view for .link.json files)
editorRegistry.register({
    id: "link-view",
    name: "Links",
    pageType: "textFile",
    category: "content-view",
    acceptFile: (fileName) => {
        if (matchesPattern(fileName, /\.link\.json$/i)) return 20;
        return -1;
    },
    validForLanguage: (languageId) => languageId === "json",
    switchOption: (languageId, fileName) => {
        if (languageId !== "json") return -1;
        if (!fileName || !matchesPattern(fileName, /\.link\.json$/i)) return -1;
        return 10;
    },
    isEditorContent: (languageId, content) => {
        if (languageId !== "json") return false;
        if (!content.includes('"type"')) return false;
        return /"type"\s*:\s*"link-editor"/.test(content) && content.includes('"links"');
    },
    loadModule: async () => {
        const [module, { createLinkViewModel }] = await Promise.all([
            import("./link-editor/LinkEditor"),
            import("./link-editor/LinkViewModel"),
        ]);
        return {
            Editor: module.LinkEditor,
            createViewModel: createLinkViewModel,
            newPageModel: textEditorModule.newPageModel,
            newEmptyPageModel: textEditorModule.newEmptyPageModel,
            newPageModelFromState: textEditorModule.newPageModelFromState,
        };
    },
});

// Force graph viewer (content-view for .fg.json files)
editorRegistry.register({
    id: "graph-view",
    name: "Graph",
    pageType: "textFile",
    category: "content-view",
    acceptFile: (fileName) => {
        if (matchesPattern(fileName, /\.fg\.json$/i)) return 20;
        return -1;
    },
    validForLanguage: (languageId) => languageId === "json",
    switchOption: (languageId, fileName) => {
        if (languageId !== "json") return -1;
        // Always offer Graph switch for .fg.json files
        if (fileName && matchesPattern(fileName, /\.fg\.json$/i)) return 10;
        if (isSpecializedJson(fileName)) return -1;
        return 10;
    },
    isEditorContent: (languageId, content) => {
        if (languageId !== "json") return false;
        if (!content.includes('"type"')) return false;
        return /"type"\s*:\s*"force-graph"/.test(content) && content.includes('"nodes"');
    },
    loadModule: async () => {
        const [module, { createGraphViewModel }] = await Promise.all([
            import("./graph/GraphView"),
            import("./graph/GraphViewModel"),
        ]);
        return {
            Editor: module.GraphView,
            createViewModel: createGraphViewModel,
            newPageModel: textEditorModule.newPageModel,
            newEmptyPageModel: textEditorModule.newEmptyPageModel,
            newPageModelFromState: textEditorModule.newPageModelFromState,
        };
    },
});

// Drawing editor (content-view for .excalidraw files — Excalidraw canvas)
editorRegistry.register({
    id: "draw-view",
    name: "Drawing",
    pageType: "textFile",
    category: "content-view",
    acceptFile: (fileName) => {
        if (matchesExtension(fileName, [".excalidraw"])) return 50;
        return -1;
    },
    validForLanguage: (languageId) => languageId === "json",
    switchOption: (_languageId, fileName) => {
        if (fileName && matchesExtension(fileName, [".excalidraw"])) return 10;
        return -1;
    },
    isEditorContent: (_languageId, content) => {
        return /^\s*\{\s*"type"\s*:\s*"excalidraw"/.test(content);
    },
    loadModule: async () => {
        const [module, { createDrawViewModel }] = await Promise.all([
            import("./draw/DrawView"),
            import("./draw/DrawViewModel"),
        ]);
        return {
            Editor: module.DrawView,
            createViewModel: createDrawViewModel,
            newPageModel: textEditorModule.newPageModel,
            newEmptyPageModel: textEditorModule.newEmptyPageModel,
            newPageModelFromState: textEditorModule.newPageModelFromState,
        };
    },
});

// MCP Inspector (standalone page editor — no file association)
editorRegistry.register({
    id: "mcp-view",
    name: "MCP Inspector",
    pageType: "mcpInspectorPage",
    category: "page-editor",
    loadModule: async () => {
        const module = await import("./mcp-inspector/McpInspectorView");
        return module.default;
    },
});

// Browser (standalone page editor - no file acceptance)
editorRegistry.register({
    id: "browser-view",
    name: "Browser",
    pageType: "browserPage",
    category: "page-editor",
    loadModule: async () => {
        const module = await import("./browser/BrowserPageView");
        return module.default;
    },
});

// About page (standalone page editor - no file acceptance)
editorRegistry.register({
    id: "about-view",
    name: "About",
    pageType: "aboutPage",
    category: "page-editor",
    loadModule: async () => {
        const module = await import("./about/AboutPage");
        return module.default;
    },
});

// Settings page (standalone page editor - no file acceptance)
editorRegistry.register({
    id: "settings-view",
    name: "Settings",
    pageType: "settingsPage",
    category: "page-editor",
    loadModule: async () => {
        const module = await import("./settings/SettingsPage");
        return module.default;
    },
});
