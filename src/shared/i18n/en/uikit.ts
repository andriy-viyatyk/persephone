import type { EnglishCatalogEntry } from "./common";

export const uikitCatalog = {
    collapse: { message: "Collapse", note: "Shared control that collapses the associated panel, group, or content region." },
    expand: { message: "Expand", note: "Shared control that expands the associated panel, group, or content region." },
    resetZoom: { message: "Reset Zoom" },
    noRows: { message: "no rows" },
    noResults: { message: "no results" },
    noItems: { message: "no items" },
    progress: { message: "Progress" },
    removeTag: { message: "Remove tag" },
    moreActions: { message: "More actions" },
    tagsInputPlaceholder: { message: "Type + Enter to add" },
    all: { message: "All", note: "Filter option that includes every available item." },
    selectAll: { message: "Select all", note: "Selection command that selects every row in the current list." },
} satisfies Record<string, EnglishCatalogEntry>;
