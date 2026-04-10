export type EditorType = "textFile" | "pdfFile" | "imageFile" | "aboutPage" | "settingsPage" | "browserPage" | "mcpInspectorPage" | "categoryPage" | "archiveFile" | "fileExplorer";
export type EditorView = "monaco" | "grid-json" | "grid-csv" | "grid-jsonl" | "md-view" | "pdf-view" | "image-view" | "svg-view" | "about-view" | "notebook-view" | "mermaid-view" | "html-view" | "settings-view" | "todo-view" | "link-view" | "log-view" | "browser-view" | "graph-view" | "draw-view" | "mcp-view" | "rest-client" | "category-view" | "archive-view";

import type { ILinkData } from "../renderer/api/types/io.link-data";

export interface IEditorState {
    id: string,
    type: EditorType,
    title: string,
    modified: boolean,
    language?: string,
    filePath?: string,
    /** Serialized content pipe descriptor (provider + persistent transformers). */
    pipe?: { provider: { type: string; config: Record<string, unknown> }; transformers: { type: string; config: Record<string, unknown> }[]; encoding?: string },
    editor?: EditorView,
    /** The link that opened this page — cleaned ILinkData (ephemeral fields stripped). Persisted across restarts. */
    sourceLink?: ILinkData,
    /** Active secondary editor panel IDs (e.g., ["archive-tree"]). Array supports multi-panel models. */
    secondaryEditor?: string[],
}

/** Serialized page descriptor for persistence (new format since v3.0.1). */
export interface PageDescriptor {
    /** Stable page UUID. */
    id: string;
    /** Page-level pinned flag. */
    pinned: boolean;
    /** Aggregate modified (mainEditor OR secondaryEditors). */
    modified: boolean;
    /** Whether sidebar exists (for restore). */
    hasSidebar: boolean;
    /** Main editor state. */
    editor: Partial<IEditorState>;
}

export interface WindowState {
    pages: PageDescriptor[];
    groupings?: [string, string][];
    activePageId?: string;
}

export interface WindowPages {
    pages: PageDescriptor[];
    windowIndex: number;
}

export interface PageDragData {
    sourceWindowIndex?: number;
    targetWindowIndex?: number;
    page?: PageDescriptor;
    dropPosition?: { x: number; y: number };
}

export interface FileStats {
    size: number;
    mtime: number;
    exists: boolean;
}