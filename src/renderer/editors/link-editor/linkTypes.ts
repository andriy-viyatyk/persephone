import { TextFileModel } from "../text/TextPageModel";

// =============================================================================
// Link Item
// =============================================================================

/** Single link item */
export interface LinkItem {
    id: string;
    title: string;
    href: string;
    category: string;
    tags: string[];
    /** Optional preview image URL for tile view */
    imgSrc?: string;
}

// =============================================================================
// View Modes
// =============================================================================

export type LinkViewMode =
    | "list"
    | "tiles-landscape"
    | "tiles-landscape-big"
    | "tiles-portrait"
    | "tiles-portrait-big";

// =============================================================================
// Link Editor Data (root structure)
// =============================================================================

/** Root data structure for .link.json file */
export interface LinkEditorData {
    links: LinkItem[];
    state: {
        /** View mode per category path (empty string = root/all) */
        categoryViewMode?: Record<string, LinkViewMode>;
        /** View mode per tag (empty string = all) */
        tagViewMode?: Record<string, LinkViewMode>;
    };
}

// =============================================================================
// Component Props
// =============================================================================

export interface LinkEditorProps {
    model: TextFileModel;
    /** When true, the categories/tags panel appears on the right instead of the left. */
    swapLayout?: boolean;
}
