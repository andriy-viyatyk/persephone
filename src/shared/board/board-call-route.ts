export const BOARD_THEME_METHODS = new Set([
    "list", "get", "current", "derive", "contrast", "fork", "file", "save", "rename", "delete", "apply", "preview", "endPreview",
]);

export function boardThemeMethodOf(path: string): string | undefined {
    return /^themes\.([a-zA-Z]+)$/.exec(path)?.[1];
}
