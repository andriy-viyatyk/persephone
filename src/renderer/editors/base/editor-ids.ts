export const InternalEditorIds = {
    explorer: "explorer",
    boards: "boards",
    clipboard: "clipboard",
    fileDiff: "file-diff",
    restoreFailed: "restore-failed",
} as const;

export type InternalEditorId = typeof InternalEditorIds[keyof typeof InternalEditorIds];

export type NavigationSourceId = "explorer" | "link-category" | "link-tag" | "link-hostname";

export const BOARD_CONTEXT_SOURCE_IDS = new Set<NavigationSourceId>([
    "explorer",
    "link-category",
    "link-tag",
]);

export function isBoardContextSourceId(sourceId: string | undefined): sourceId is NavigationSourceId {
    return sourceId !== undefined && BOARD_CONTEXT_SOURCE_IDS.has(sourceId as NavigationSourceId);
}
