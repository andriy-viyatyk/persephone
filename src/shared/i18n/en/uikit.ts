import type { EnglishCatalogEntry } from "./common";

export const uikitCatalog = {
    collapse: { message: "Collapse" },
    expand: { message: "Expand" },
    resetZoom: { message: "Reset Zoom" },
    noRows: { message: "no rows" },
    noResults: { message: "no results" },
    noItems: { message: "no items" },
    progress: { message: "Progress" },
    removeTag: { message: "Remove tag" },
    moreActions: { message: "More actions" },
    tagsInputPlaceholder: { message: "Type + Enter to add" },
    all: { message: "All" },
    selectAll: { message: "Select all" },
} satisfies Record<string, EnglishCatalogEntry>;
