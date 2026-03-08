import { IPageState, PageEditor, PageType } from "../../shared/types";
import { PageModel } from "./base";
import type { IContentHost } from "./base/IContentHost";
import type { ContentViewModel } from "./base/ContentViewModel";

export type FileEditorPage<T extends PageModel | IContentHost = PageModel | IContentHost> = React.ComponentType<{
    model: T;
}>;

export interface EditorModelCreations {
    newPageModel(filePath?: string): Promise<PageModel>;
    newEmptyPageModel(pageType: PageType): Promise<PageModel | null>;
    newPageModelFromState(state: Partial<IPageState>): Promise<PageModel>;
}

export interface EditorPageModule {
    Editor: FileEditorPage;
}

/** Factory function that creates a ContentViewModel for a given host. */
export type ViewModelFactory = (host: IContentHost) => ContentViewModel<any>;

export type EditorModule = EditorPageModule & EditorModelCreations & {
    /** Optional factory for creating a content view model. Content-view editors provide this. */
    createViewModel?: ViewModelFactory;
};

/**
 * Editor category distinguishes between two types of editors:
 *
 * - "page-editor": Standalone editors with their own PageModel (e.g., PDF viewer, Image viewer).
 *   These render instead of TextPageView and handle their own UI entirely.
 *
 * - "content-view": Views of text-based content that share TextFileModel (e.g., Monaco, Grid, Markdown).
 *   These render inside TextPageView via ActiveEditor and share toolbar, script panel, footer.
 *   Content views can switch between each other (e.g., JSON text → Grid view).
 */
export type EditorCategory = "page-editor" | "content-view";

export interface EditorDefinition {
    id: PageEditor;
    name: string;
    pageType: PageType;
    /** Distinguishes standalone page editors from content views */
    category: EditorCategory;

    /**
     * Determines if this editor can open a file.
     * @param fileName - The file path/name to check
     * @returns Priority (>= 0) if editor accepts this file, -1 if not applicable.
     *          Higher priority wins when multiple editors match.
     */
    acceptFile?(fileName: string): number;

    /**
     * Checks if this editor is valid for a given language.
     * Used when language changes to validate current editor selection.
     * @param languageId - The Monaco language ID
     * @returns true if editor supports this language, false otherwise
     */
    validForLanguage?(languageId: string): boolean;

    /**
     * Determines if this editor should appear in the view switch dropdown.
     * @param languageId - Current language ID
     * @param fileName - Optional file path for context
     * @returns Priority (>= 0) to include in switch options, -1 to exclude.
     *          Lower priority appears first in the list (monaco should be 0).
     */
    switchOption?(languageId: string, fileName?: string): number;

    /**
     * Detects if file content belongs to this editor based on a `type` property
     * embedded in the content. Used for structured JSON editors (notebook, todo, link)
     * to show the correct switch button even when the file name doesn't match.
     * Checked via fast regex — no JSON parsing.
     * @param languageId - Current language ID (must be "json" for structured editors)
     * @param content - The raw text content of the file
     * @returns true if the content matches this editor's expected structure
     */
    isEditorContent?(languageId: string, content: string): boolean;

    loadModule: () => Promise<EditorModule>;
}
