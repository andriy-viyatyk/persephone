export type PageType = "textFile" | "pdfFile" | "imageFile" | "aboutPage" | "settingsPage" | "browserPage" | "mcpInspectorPage" | "categoryPage";
export type PageEditor = "monaco" | "grid-json" | "grid-csv" | "grid-jsonl" | "md-view" | "pdf-view" | "image-view" | "svg-view" | "about-view" | "notebook-view" | "mermaid-view" | "html-view" | "settings-view" | "todo-view" | "link-view" | "log-view" | "browser-view" | "graph-view" | "draw-view" | "mcp-view" | "rest-client" | "category-view";

/** Describes the link that opened a page — origin identity + metadata. */
export interface ISourceLink {
    /** Resolved URL (file path, HTTP URL, archive path). */
    url: string;
    /** Target editor that was requested (if any). */
    target?: string;
    /** Accumulated metadata from the link pipeline (excluding ephemeral fields). */
    metadata?: Record<string, unknown>;
}

export interface IPageState {
    id: string,
    type: PageType,
    title: string,
    modified: boolean,
    language?: string,
    filePath?: string,
    /** Serialized content pipe descriptor (provider + persistent transformers). */
    pipe?: { provider: { type: string; config: Record<string, unknown> }; transformers: { type: string; config: Record<string, unknown> }[]; encoding?: string },
    editor?: PageEditor,
    hasNavigator?: boolean,
    pinned?: boolean,
    /** The link that opened this page — informational, not functional. Persisted across restarts. */
    sourceLink?: ISourceLink,
}

export interface WindowState {
    pages: Partial<IPageState>[];
    groupings?: [string, string][];
    activePageId?: string;
}

export interface WindowPages {
    pages: Partial<IPageState>[];
    windowIndex: number;
}

export interface PageDragData {
    sourceWindowIndex?: number;
    targetWindowIndex?: number;
    page?: Partial<IPageState>;
    dropPosition?: { x: number; y: number };
}

export interface FileStats {
    size: number;
    mtime: number;
    exists: boolean;
}