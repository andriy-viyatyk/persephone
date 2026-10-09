import type { ThemeColorVar } from "./theme-color-vars";

export interface CustomThemeBase {
    background: string;
    text: string;
    accent: string;
    link?: string;
    error?: string;
    warning?: string;
    success?: string;
}

export type MonacoColorKey =
    | "editor.background"
    | "menu.background"
    | "menu.foreground"
    | "menu.selectionBackground"
    | "menu.selectionForeground"
    | "menu.separatorBackground"
    | "menu.border";

export type CustomThemeOverrideKey = ThemeColorVar | `monaco:${MonacoColorKey}`;

export interface CustomThemeFile {
    schemaVersion: 1;
    id: `custom-${string}`;
    name: string;
    base: CustomThemeBase;
    isDark: boolean | null;
    overrides: Partial<Record<CustomThemeOverrideKey, string>>;
}

export interface CustomThemeValidationResult {
    value?: CustomThemeFile;
    warnings: string[];
}

export interface ContrastMeasurement {
    ratio: number;
    meetsAA: boolean;
}

export type ContrastReport = Record<string, ContrastMeasurement>;
