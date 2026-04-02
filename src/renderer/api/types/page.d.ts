import type { EditorView } from "./common";
import type { ITextEditor } from "./text-editor";
import type { IGridEditor } from "./grid-editor";
import type { INotebookEditor } from "./notebook-editor";
import type { ITodoEditor } from "./todo-editor";
import type { ILinkEditor } from "./link-editor";
import type { IBrowserEditor } from "./browser-editor";
import type { IMarkdownEditor } from "./markdown-editor";
import type { ISvgEditor } from "./svg-editor";
import type { IHtmlEditor } from "./html-editor";
import type { IMermaidEditor } from "./mermaid-editor";
import type { IGraphEditor } from "./graph-editor";
import type { IMcpInspectorEditor } from "./mcp-inspector-editor";

/**
 * IPage — represents a page (tab) in the current window.
 *
 * Available as the `page` global in scripts, or via `app.pages.activePage`.
 *
 * @example
 * // Read/write content
 * page.content = page.content.toUpperCase();
 *
 * // Access grouped page (auto-creates if none)
 * page.grouped.content = JSON.stringify(result);
 *
 * // Store data across script runs
 * page.data.counter = (page.data.counter || 0) + 1;
 */
export interface IPage {
    /** Unique page identifier. */
    readonly id: string;

    /** Page type (e.g., "textFile", "browserPage"). */
    readonly type: string;

    /** Display title. */
    readonly title: string;

    /** True if page has unsaved changes. */
    readonly modified: boolean;

    /** True if tab is pinned. */
    readonly pinned: boolean;

    /** Absolute file path, if the page is backed by a file. */
    readonly filePath?: string;

    /** Text content. Get/set. Only meaningful for text-based pages. */
    content: string;

    /** Language ID (e.g., "json", "typescript"). Get/set. */
    language: string;

    /** Active editor ID (e.g., "monaco", "grid-json"). Get/set. */
    editor: EditorView;

    /**
     * In-memory data storage for scripts.
     * Persists across script runs for this page, but does not survive app restart.
     */
    readonly data: Record<string, any>;

    /**
     * Grouped (side-by-side) partner page.
     * Auto-creates and groups a new text page if none exists.
     */
    readonly grouped: IPage;

    // ── Editor Facades ─────────────────────────────────────────────

    /** Get text editor interface (Monaco-specific features). Only for text pages. */
    asText(): Promise<ITextEditor>;

    /** Get grid editor interface (data manipulation). Only for text pages with JSON/CSV content. */
    asGrid(): Promise<IGridEditor>;

    /** Get notebook editor interface. Only for text pages with `.note.json` content. */
    asNotebook(): Promise<INotebookEditor>;

    /** Get todo editor interface. Only for text pages with `.todo.json` content. */
    asTodo(): Promise<ITodoEditor>;

    /** Get link editor interface. Only for text pages with `.link.json` content. */
    asLink(): Promise<ILinkEditor>;

    /** Get markdown preview interface. Only for text pages with markdown content. */
    asMarkdown(): Promise<IMarkdownEditor>;

    /** Get SVG preview interface. Only for text pages with SVG content. */
    asSvg(): Promise<ISvgEditor>;

    /** Get HTML preview interface. Only for text pages with HTML content. */
    asHtml(): Promise<IHtmlEditor>;

    /** Get Mermaid diagram preview interface. Only for text pages with mermaid content. */
    asMermaid(): Promise<IMermaidEditor>;

    /** Get graph editor interface. Only for text pages with force-graph JSON content. */
    asGraph(): Promise<IGraphEditor>;

    /** Get drawing editor interface. Only for text pages with `.excalidraw` content. */
    asDraw(): Promise<IDrawEditor>;

    /** Get browser editor interface. Only for browser pages. */
    asBrowser(): Promise<IBrowserEditor>;

    /** Get MCP Inspector interface. Only for MCP Inspector pages. */
    asMcpInspector(): Promise<IMcpInspectorEditor>;

    /**
     * Run this page's content as a script (same as pressing F5).
     * Only works for javascript/typescript pages.
     * Returns the script result as text.
     *
     * @example
     * const scriptPage = app.pages.find(p => p.title === "my-script.js");
     * await scriptPage.runScript();
     */
    runScript(): Promise<string>;
}
