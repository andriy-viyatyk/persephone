import { TextFileModel } from "../text/TextPageModel";

// =============================================================================
// Drag Types
// =============================================================================

export const LINK_DRAG = "LINK_DRAG";
export const LINK_CATEGORY_DRAG = "LINK_CATEGORY_DRAG";
export const LINK_PIN_DRAG = "LINK_PIN_DRAG";

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
        /** View mode per hostname (empty string = all) */
        hostnameViewMode?: Record<string, LinkViewMode>;
        /** Ordered array of pinned link IDs */
        pinnedLinks?: string[];
        /** Width of the pinned links panel */
        pinnedPanelWidth?: number;
    };
}

// =============================================================================
// Component Props
// =============================================================================

export interface LinkEditorProps {
    model: TextFileModel;
    /** When true, the categories/tags panel appears on the right instead of the left. */
    swapLayout?: boolean;
    /** Portal target for the first toolbar section (breadcrumb). When omitted, portal is not rendered. */
    toolbarRefFirst?: HTMLDivElement | null;
    /** Portal target for the last toolbar section (buttons, search). When omitted, portal is not rendered. */
    toolbarRefLast?: HTMLDivElement | null;
    /** Portal target for the footer section (link count). When omitted, portal is not rendered. */
    footerRefLast?: HTMLDivElement | null;
}
