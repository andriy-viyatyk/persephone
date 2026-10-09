import { api } from "../../../ipc/renderer/api";
import { ThemeDefinition } from "./types";
import { defaultDark } from "./default-dark";
import { persephone } from "./persephone";
import { solarizedDark } from "./solarized-dark";
import { monokai } from "./monokai";
import { lightModern } from "./light-modern";
import { solarizedLight } from "./solarized-light";
import { quietLight } from "./quiet-light";
import { persephoneLight } from "./persephone-light";
import { fpJoin } from "../../core/utils/file-path";
import { installAppTokenVars } from "../token-vars";
import { installPVarBridge } from "../p-vars";
import { themeState } from "../theme-state";
import { isThemeColorVar } from "../theme-color-vars";
import { validateCustomThemeFile, buildCustomTheme } from "../custom-theme";

// Persephone's own themes lead each group (the Settings page lists them in this order).
const builtInThemes: ThemeDefinition[] = [
    persephone,
    defaultDark,
    solarizedDark,
    monokai,
    persephoneLight,
    lightModern,
    solarizedLight,
    quietLight,
];

function readCustomThemesSync(): ThemeDefinition[] {
    try {
        const fs = require("fs");
        const themesPath = fpJoin(process.env.APPDATA, "persephone", "data", "themes");
        if (!fs.existsSync(themesPath)) return [];
        const definitions: ThemeDefinition[] = [];
        for (const filename of fs.readdirSync(themesPath)) {
            if (typeof filename !== "string" || !filename.endsWith(".theme.json")) continue;
            try {
                const filePath = fpJoin(themesPath, filename);
                if (!fs.statSync(filePath).isFile()) continue;
                const parsed: unknown = JSON.parse(fs.readFileSync(filePath, "utf-8"));
                const result = validateCustomThemeFile(parsed);
                if (!result.value) {
                    console.warn(`[Custom themes] Skipping invalid ${filename}`, result.warnings);
                    continue;
                }
                if (!isSafeCustomThemeId(result.value.id) || filename !== `${result.value.id}.theme.json`) {
                    console.warn(`[Custom themes] Skipping ${filename}: filename and safe theme id must match.`);
                    continue;
                }
                result.warnings.forEach((warning) => console.warn(`[Custom themes] ${filename}: ${warning}`));
                definitions.push(buildCustomTheme(result.value));
            } catch (error) {
                console.warn(`[Custom themes] Skipping unreadable ${filename}`, error);
            }
        }
        return sortCustomThemes(definitions);
    } catch (error) {
        console.warn("[Custom themes] Could not read themes directory", error);
        return [];
    }
}

const themes: ThemeDefinition[] = [...builtInThemes, ...readCustomThemesSync()];
let activePreview: ThemeDefinition | undefined;
let previewGeneration = 0;

/** Internal ownership token for temporary theme overlays. */
export function getPreviewGeneration(): number {
    return previewGeneration;
}

function isSafeCustomThemeId(id: string): boolean {
    return /^custom-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id);
}

function sortCustomThemes(customThemes: ThemeDefinition[]): ThemeDefinition[] {
    return [...customThemes].sort((left, right) =>
        left.name.localeCompare(right.name, undefined, { sensitivity: "base" }) || left.id.localeCompare(right.id)
    );
}

/**
 * Replace the registry's custom definitions after a validated storage reload, then show
 * `selectedId` (the persisted `theme` setting) when it exists, or `persephone` in memory only.
 * Resolving from the setting rather than the theme on screen is what lets a window that fell
 * back while a file was briefly missing return to it once the file is back.
 */
export function replaceCustomThemes(customThemes: ThemeDefinition[], selectedId?: string): void {
    const builtInIds = new Set(builtInThemes.map((theme) => theme.id));
    const safeCustomThemes = customThemes.filter((theme) =>
        isSafeCustomThemeId(theme.id) && !builtInIds.has(theme.id)
    );
    themes.splice(builtInThemes.length, themes.length, ...sortCustomThemes(safeCustomThemes));
    const wantedId = selectedId ?? themeState.get().id;
    applyThemePreservingPreview(getThemeById(wantedId) ? wantedId : persephone.id);
}

/** Remove a custom definition from the in-memory registry. */
export function removeCustomTheme(id: string): void {
    if (!isSafeCustomThemeId(id) || builtInThemes.some((theme) => theme.id === id)) return;
    replaceCustomThemes(themes.filter((theme) => theme.id !== id && !builtInThemes.some((builtin) => builtin.id === theme.id)));
}

// Read saved theme synchronously at startup to avoid flash of wrong theme.
// Uses fs.readFileSync so the correct CSS variables are set before first paint.
function readStartupThemeId(): string {
    try {
        const fs = require("fs");
        const settingsPath = fpJoin(
            process.env.APPDATA, "persephone", "data", "appSettings.json"
        );
        const raw = fs.readFileSync(settingsPath, "utf-8");
        // Strip // comments — appSettings.json uses JSON5 comments
        const content = raw.replace(/^\s*\/\/.*$/gm, "");
        const parsed = JSON.parse(content);
        if (parsed.theme && themes.some((t) => t.id === parsed.theme)) {
            return parsed.theme;
        }
    } catch {
        // File doesn't exist yet or parse error — use default
    }
    return persephone.id;
}

export function getAvailableThemes(): ThemeDefinition[] {
    return themes;
}

export function getCurrentThemeId(): string {
    return themeState.get().id;
}

export function getThemeById(id: string): ThemeDefinition | undefined {
    if (id === "preview" && activePreview) return activePreview;
    return themes.find((t) => t.id === id);
}

function applyThemeDefinition(theme: ThemeDefinition): void {
    const root = document.documentElement;
    for (const [key, value] of Object.entries(theme.colors)) {
        root.style.setProperty(key, value);
    }
    root.style.colorScheme = theme.isDark ? "dark" : "light";

    // Set Chromium's native theme (affects native tooltips, scrollbars, etc.)
    api.setNativeTheme(theme.isDark ? "dark" : "light").catch(() => {});

    // Notify consumers only after CSS and native theme state are current.
    themeState.set({ id: theme.id, isDark: theme.isDark, revision: themeState.get().revision + 1 });
}

/** Explicit selection clears a temporary preview before applying a registry definition. */
export function applyTheme(themeId: string): void {
    const theme = themes.find((item) => item.id === themeId);
    if (!theme) return;
    activePreview = undefined;
    previewGeneration++;
    applyThemeDefinition(theme);
}

/** Apply a reloaded setting without replacing a preview active in this renderer. */
export function applyThemePreservingPreview(themeId: string): void {
    if (activePreview) {
        applyThemeDefinition(activePreview);
        return;
    }
    applyTheme(themeId);
}

/** Apply and publish the renderer-local temporary definition. */
export function previewTheme(theme: ThemeDefinition): void {
    activePreview = { ...theme, id: "preview" };
    previewGeneration++;
    applyThemeDefinition(activePreview);
}

/** Clear the private overlay; callers choose the persisted or fallback theme to restore. */
export function clearThemePreview(): void {
    activePreview = undefined;
    previewGeneration++;
}

export function resolveColor(value: string): string {
    const trimmed = value.trim();
    const cssVar = trimmed.startsWith("var(") && trimmed.endsWith(")")
        ? trimmed.slice(4, -1).trim()
        : trimmed;
    const theme = getThemeById(themeState.get().id);
    return theme && isThemeColorVar(cssVar) ? theme.colors[cssVar] : "transparent";
}

export function cycleTheme(direction: 1 | -1): void {
    const currentIndex = themes.findIndex((t) => t.id === themeState.get().id);
    const nextIndex = currentIndex < 0
        ? direction > 0 ? 0 : themes.length - 1
        : (currentIndex + direction + themes.length) % themes.length;
    applyTheme(themes[nextIndex].id);
}

// Apply saved theme immediately on module load (synchronous read avoids flash)
installAppTokenVars();
installPVarBridge();
applyTheme(readStartupThemeId());
