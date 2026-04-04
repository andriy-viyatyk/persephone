import type { ILink } from "../../api/types/io.tree";
import { TextFileModel } from "../text/TextEditorModel";

// =============================================================================
// Drag Types
// =============================================================================

/** Unified drag type for all ILink items (links, categories, files, archive entries). */
export const LINK_DRAG_TYPE = "link-drag";

/** Drag payload for ILink items. Carries an array of links + optional source identifier. */
export interface LinkDragEvent {
    type: typeof LINK_DRAG_TYPE;
    items: ILink[];
    /** Source identifier — provider sourceUrl or model id. Used to distinguish internal vs external drops. */
    sourceId?: string;
}

export const LINK_PIN_DRAG = "LINK_PIN_DRAG";

// =============================================================================
// Link Item
// =============================================================================

/** Link item with required id — used in .link.json collections. */
export interface LinkItem extends ILink {
    id: string;
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
