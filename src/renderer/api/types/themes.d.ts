/** User-editable palette inputs consumed by the custom-theme derivation helpers. */
export interface CustomThemeBase {
    background: string;
    text: string;
    accent: string;
    link?: string;
    error?: string;
    warning?: string;
    success?: string;
}

export type ThemeColors = Record<string, string>;
export type MonacoColorKey =
    | "editor.background"
    | "menu.background"
    | "menu.foreground"
    | "menu.selectionBackground"
    | "menu.selectionForeground"
    | "menu.separatorBackground"
    | "menu.border";
export type MonacoColors = Partial<Record<MonacoColorKey, string>> & Record<string, string>;
export type ThemeOverrideKey = string | `monaco:${MonacoColorKey}`;

/** Serializable custom theme file stored in the user's themes directory. */
export interface CustomThemeFile {
    schemaVersion: 1;
    id: `custom-${string}`;
    name: string;
    base: CustomThemeBase;
    isDark: boolean | null;
    overrides: Partial<Record<ThemeOverrideKey, string>>;
}

/** Drafts may omit their id so storage can allocate one when they are saved. */
export type ThemeDraft = Omit<CustomThemeFile, "id"> & { id?: string };

/** Plain theme data; no renderer registry object is exposed. */
export interface ThemeDefinition {
    id: string;
    name: string;
    isDark: boolean;
    colors: ThemeColors;
    monaco: {
        base: "vs-dark" | "vs" | "hc-black";
        colors: MonacoColors;
    };
}

export interface ContrastMeasurement {
    ratio: number;
    meetsAA: boolean;
}

export type ContrastReport = Record<string, ContrastMeasurement>;

/** Inspect, derive, preview, and manage built-in and custom themes. */
export interface IThemes {
    /** Return cloned definitions for selectable built-in and saved custom themes. */
    list(): ThemeDefinition[];
    /** Return a cloned definition by id, or undefined when it does not exist. */
    get(id: string): ThemeDefinition | undefined;
    /** Current cloned definition, including the active temporary preview. */
    readonly current: ThemeDefinition;
    /** Derive a complete palette from its three required colors and optional semantic colors. */
    derive(base: CustomThemeBase, isDark?: boolean | null): ThemeDefinition;
    /** Measure AA contrast pairs for a definition, custom file, or draft. */
    contrast(themeOrFile: ThemeDefinition | CustomThemeFile | ThemeDraft): ContrastReport;
    /** Create an id-less draft that preserves the selected definition's colors. */
    fork(id: string): ThemeDraft;
    /** Return a saved custom theme's stored file (base intent, isDark, overrides), or null for built-ins and unknown ids. */
    file(id: string): CustomThemeFile | null;
    /** Create a custom theme or replace an existing custom theme when draft.id is supplied. */
    save(draft: ThemeDraft): Promise<CustomThemeFile>;
    /** Rename a saved custom theme without changing its id or selection. */
    rename(id: string, name: string): Promise<CustomThemeFile>;
    /** Delete a saved custom theme. */
    delete(id: string): Promise<void>;
    /** Apply a theme in this window and persist its selected id. */
    apply(id: string): Promise<void>;
    /** Apply an in-memory preview in this window without saving settings or files. */
    preview(themeDraft: ThemeDraft): ThemeDefinition;
    /** End the preview and restore the latest persisted theme or the built-in fallback. */
    endPreview(): Promise<void>;
}
