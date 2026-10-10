/** Shared UI defaults for UIKit. Standalone consumers use these English values. */
export const defaultUikitText = {
    close: "Close",
    loading: "Loading",
    collapse: "Collapse",
    expand: "Expand",
    resetZoom: "Reset Zoom",
    searchPlaceholder: "Search...",
    noRows: "no rows",
    noResults: "no results",
    noItems: "no items",
    progress: "Progress",
    removeTag: "Remove tag",
    moreActions: "More actions",
    tagsInputPlaceholder: "Type + Enter to add",
    all: "All",
    selectAll: "Select all",
} as const;

export type UikitText = { [K in keyof typeof defaultUikitText]: string };
export type UikitTextName = keyof UikitText;

let currentUikitText: UikitText = { ...defaultUikitText };

export function uikitText(name: UikitTextName): string {
    return currentUikitText[name];
}

export function setUikitText(overrides: Partial<UikitText>): void {
    currentUikitText = { ...defaultUikitText, ...overrides };
}
