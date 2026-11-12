import { startupEnvironment } from "../../core/startup-environment";
import { api } from "../../../ipc/renderer/api";
import type { ThemeDefinition } from "./types";
import { defaultDark } from "./default-dark";
import { persephone } from "./persephone";
import { solarizedDark } from "./solarized-dark";
import { monokai } from "./monokai";
import { lightModern } from "./light-modern";
import { solarizedLight } from "./solarized-light";
import { quietLight } from "./quiet-light";
import { persephoneLight } from "./persephone-light";
import { installAppTokenVars } from "../token-vars";
import { installPVarBridge } from "../p-vars";
import { themeState } from "../theme-state";
import { isThemeColorVar } from "../theme-color-vars";

// Persephone's own themes lead each group (the Settings page lists them in this order).
const builtInThemes: ThemeDefinition[] = [
    persephone, defaultDark, solarizedDark, monokai,
    persephoneLight, lightModern, solarizedLight, quietLight,
];
const themes: ThemeDefinition[] = [...builtInThemes];
let activePreview: ThemeDefinition | undefined;
let previewGeneration = 0;

/** Internal ownership token for temporary theme overlays. */
export function getPreviewGeneration(): number {
    return previewGeneration;
}

/** Replace the validated custom definitions and apply the selected setting or fallback. */
export function replaceCustomThemes(customThemes: ThemeDefinition[], selectedId?: string): void {
    const builtInIds = new Set(builtInThemes.map((theme) => theme.id));
    themes.splice(builtInThemes.length, themes.length, ...customThemes.filter((theme) => !builtInIds.has(theme.id)));
    const wantedId = selectedId ?? themeState.get().id;
    applyThemePreservingPreview(getThemeById(wantedId) ? wantedId : persephone.id);
}

export function getAvailableThemes(): ThemeDefinition[] {
    return themes;
}

export function getCurrentThemeId(): string {
    return themeState.get().id;
}

export function getThemeById(id: string): ThemeDefinition | undefined {
    if (id === "preview" && activePreview) return activePreview;
    return themes.find((theme) => theme.id === id);
}

function applyThemeDefinition(theme: ThemeDefinition): void {
    const root = document.documentElement;
    for (const [key, value] of Object.entries(theme.colors)) root.style.setProperty(key, value);
    root.style.colorScheme = theme.isDark ? "dark" : "light";
    api.setNativeTheme(theme.isDark ? "dark" : "light").catch(() => {});
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

export function getNextThemeId(direction: 1 | -1): string {
    const currentIndex = themes.findIndex((theme) => theme.id === themeState.get().id);
    const nextIndex = currentIndex < 0
        ? direction > 0 ? 0 : themes.length - 1
        : (currentIndex + direction + themes.length) % themes.length;
    return themes[nextIndex].id;
}

export function cycleTheme(direction: 1 | -1): void {
    applyTheme(getNextThemeId(direction));
}

export function installThemeAtStartup(customThemes: ThemeDefinition[]): void {
    installAppTokenVars();
    installPVarBridge();
    const selectedId = startupEnvironment.settings.theme;
    replaceCustomThemes(customThemes, typeof selectedId === "string" ? selectedId : persephone.id);
}
