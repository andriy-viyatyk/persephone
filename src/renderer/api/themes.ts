import { settings } from "./settings";
import { deleteCustomTheme, getCustomThemeFile, renameCustomTheme, saveCustomTheme } from "./custom-theme-storage";
import type { ThemeDraft, CustomThemeFile, ThemeDefinition, IThemes } from "./types/themes";
import {
    baseFromTheme,
    buildCustomTheme,
    contrastReport,
    deriveTheme,
    overridesFor,
    validateCustomThemeFile,
} from "../theme/custom-theme";
import type { CustomThemeBase } from "../theme/custom-theme-types";
import type { ThemeDefinition as RegistryThemeDefinition } from "../theme/themes/types";
import {
    applyTheme,
    clearThemePreview,
    getAvailableThemes,
    getCurrentThemeId,
    getThemeById,
    previewTheme,
} from "../theme/themes";
import { persephone } from "../theme/themes/persephone";

const PREVIEW_VALIDATION_ID = "custom-preview-draft";

function cloneDefinition(theme: RegistryThemeDefinition): ThemeDefinition {
    return {
        ...theme,
        colors: { ...theme.colors },
        monaco: { ...theme.monaco, colors: { ...theme.monaco.colors } },
    };
}

function cloneFile(file: CustomThemeFile): CustomThemeFile {
    return {
        ...file,
        base: { ...file.base },
        overrides: { ...file.overrides },
    };
}

function definitionFromThemeInput(
    value: ThemeDraft | CustomThemeFile | ThemeDefinition,
    ignoreId = false,
    allowDefinition = true,
): RegistryThemeDefinition {
    if (allowDefinition && "colors" in value && "monaco" in value && !("base" in value)) {
        return value as unknown as RegistryThemeDefinition;
    }

    const candidate = { ...value, id: ignoreId ? PREVIEW_VALIDATION_ID : value.id ?? PREVIEW_VALIDATION_ID };
    const result = validateCustomThemeFile(candidate);
    if (!result.value) throw new Error(result.warnings.join(" ") || "Invalid custom theme.");
    return buildCustomTheme(result.value);
}

function cloneSavedFile(result: Awaited<ReturnType<typeof saveCustomTheme>>): CustomThemeFile {
    return cloneFile(result.file);
}

export const themes: IThemes = {
    list(): ThemeDefinition[] {
        return getAvailableThemes().map(cloneDefinition);
    },

    get(id: string): ThemeDefinition | undefined {
        const theme = getThemeById(id);
        return theme ? cloneDefinition(theme) : undefined;
    },

    get current(): ThemeDefinition {
        const current = getThemeById(getCurrentThemeId()) ?? getThemeById(settings.theme) ?? persephone;
        return cloneDefinition(current);
    },

    derive(base: CustomThemeBase, isDark?: boolean | null): ThemeDefinition {
        return cloneDefinition(deriveTheme({ ...base }, isDark));
    },

    contrast(themeOrFile: ThemeDraft | CustomThemeFile | ThemeDefinition) {
        return contrastReport(definitionFromThemeInput(themeOrFile));
    },

    fork(id: string): ThemeDraft {
        const theme = getThemeById(id);
        if (!theme || id === "preview") throw new Error(`Theme does not exist: ${id}`);
        const base = baseFromTheme(theme);
        return {
            schemaVersion: 1,
            name: `${theme.name} copy`,
            base: { ...base },
            isDark: theme.isDark,
            overrides: { ...overridesFor(theme, base) },
        };
    },

    file(id: string): CustomThemeFile | null {
        const file = getCustomThemeFile(id);
        return file ? cloneFile(file) : null;
    },

    async save(draft: ThemeDraft): Promise<CustomThemeFile> {
        return cloneSavedFile(await saveCustomTheme(draft));
    },

    async rename(id: string, name: string): Promise<CustomThemeFile> {
        const result = await renameCustomTheme(id, name);
        return cloneFile(result.file);
    },

    async delete(id: string): Promise<void> {
        await deleteCustomTheme(id);
    },

    async apply(id: string): Promise<void> {
        const theme = getThemeById(id);
        if (!theme || id === "preview") throw new Error(`Theme does not exist: ${id}`);
        applyTheme(id);
        settings.set("theme", id);
    },

    preview(themeDraft: ThemeDraft): ThemeDefinition {
        const theme = definitionFromThemeInput(themeDraft, true, false);
        previewTheme({ ...theme, id: "preview", name: themeDraft.name });
        return cloneDefinition({ ...theme, id: "preview", name: themeDraft.name });
    },

    async endPreview(): Promise<void> {
        clearThemePreview();
        const id = getThemeById(settings.theme) ? settings.theme : persephone.id;
        applyTheme(id);
    },
};
