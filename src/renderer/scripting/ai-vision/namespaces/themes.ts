import type { IThemes } from "../../../api/types/themes";
import type { IAiMember, IAiVisionDescriptor } from "ai-vision";

const THEME_MEMBERS: readonly IAiMember[] = [
    { name: "list", kind: "method", signature: "list()", summary: "List cloned built-in and saved custom theme definitions." },
    { name: "get", kind: "method", signature: "get(id)", summary: "Read a cloned theme definition by id." },
    { name: "current", kind: "property", summary: "Current cloned definition, including a temporary preview." },
    { name: "derive", kind: "method", signature: "derive(base, isDark?)", summary: "Derive a complete theme from a base palette." },
    { name: "contrast", kind: "method", signature: "contrast(themeOrFile)", summary: "Measure declared text and surface contrast pairs." },
    { name: "fork", kind: "method", signature: "fork(id)", summary: "Create an id-less draft preserving a theme's colors." },
    { name: "file", kind: "method", signature: "file(id)", summary: "Read a saved custom theme's stored file, or null for built-ins." },
    { name: "save", kind: "method", signature: "save(draft)", summary: "Create or replace a custom theme file.", caution: "writes a custom theme file to the user's data folder" },
    { name: "rename", kind: "method", signature: "rename(id, name)", summary: "Rename a saved custom theme without changing its id.", caution: "writes a custom theme file to the user's data folder" },
    { name: "delete", kind: "method", signature: "delete(id)", summary: "Delete a custom theme file.", caution: "deletes a custom theme file; deleting the selected theme persists the persephone fallback" },
    { name: "apply", kind: "method", signature: "apply(id)", summary: "Apply and persist the selected theme.", caution: "changes this window's appearance and persists the selected theme" },
    { name: "preview", kind: "method", signature: "preview(themeDraft)", summary: "Apply a temporary theme in this window.", caution: "changes this window's appearance until endPreview() or explicit selection" },
    { name: "endPreview", kind: "method", signature: "endPreview()", summary: "End the temporary preview and restore the persisted theme." },
];

export function describeThemes(instance: unknown): IAiVisionDescriptor {
    const themes = instance as IThemes;
    return {
        kind: "Themes",
        summary: "Inspect, derive, preview, and manage built-in and custom themes.",
        members: THEME_MEMBERS,
        help: `app.themes.fork(id) returns an id-less draft; preview(draft) accepts that draft without saving it. Preview is renderer-memory state local to this window. It writes no settings or files, survives theme-file and settings-file reloads, and stays active until endPreview() or explicit selection while this renderer remains open. A window reload or app restart ends it. A board-owned preview ends when that board closes or reloads. file(id) returns a saved custom theme's stored file (base intent, isDark, overrides, id) for editing in place; fork(id) pins every base color. app.themes.apply(id) immediately changes this window's appearance and saves the selected id for other windows. Saving a draft only writes a custom theme file; it does not select the theme or end a preview.`,
        summarize: () => ({ kind: "Themes", count: themes.list().length, current: themes.current.id }),
    };
}
