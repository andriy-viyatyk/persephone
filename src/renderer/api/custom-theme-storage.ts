import { settings } from "./settings";
import { fs } from "./fs";
import { DirectoryWatcher } from "../core/utils/file-watcher";
import { fpJoin } from "../core/utils/file-path";
import { buildCustomTheme, validateCustomThemeFile } from "../theme/custom-theme";
import { customThemeCatalog, isSafeCustomThemeId } from "../theme/custom-theme-catalog";
import type { CustomThemeFile } from "../theme/custom-theme-types";
import type { ThemeDefinition } from "../theme/themes/types";
import { replaceCustomThemes, getAvailableThemes } from "../theme/themes";

export type CustomThemeDraft = Omit<CustomThemeFile, "id"> & { id?: string };

export interface SavedCustomTheme {
    file: CustomThemeFile;
    theme: ThemeDefinition;
}

const THEME_SUFFIX = ".theme.json";
let themesDirectory = "";
let directoryWatcher: DirectoryWatcher | undefined;
let initialization: Promise<void> | undefined;
let savedFiles = new Map<string, CustomThemeFile>();

function pathFor(id: string): string {
    if (!isSafeCustomThemeId(id)) throw new Error(`Invalid custom theme id: ${id}`);
    return fpJoin(themesDirectory, `${id}${THEME_SUFFIX}`);
}

function reportWarnings(filename: string, warnings: string[]): void {
    warnings.forEach((warning) => console.warn(`[Custom themes] ${filename}: ${warning}`));
}

/** Load and validate every custom theme file. Invalid files are isolated and skipped. */
export async function loadAll(): Promise<SavedCustomTheme[]> {
    await fs.wait();
    if (!themesDirectory) themesDirectory = fs.resolveDataPath("themes");
    await fs.mkdir(themesDirectory);
    const loaded = await customThemeCatalog.load(async () => {
        const entries = await fs.listDirWithTypes(themesDirectory);
        const files: Array<{ filename: string; content: string }> = [];
        for (const entry of entries) {
            if (entry.isDirectory || !entry.name.endsWith(THEME_SUFFIX)) continue;
            try {
                const filePath = fpJoin(themesDirectory, entry.name);
                const stat = await fs.stat(filePath);
                if (stat.exists && !stat.isDirectory) {
                    files.push({ filename: entry.name, content: await fs.read(filePath) });
                }
            } catch (error) {
                console.warn(`[Custom themes] Skipping unreadable ${entry.name}`, error);
            }
        }
        return files;
    });
    return loaded.filter((item) => {
        if (getAvailableThemes().some((theme) => theme.id === item.file.id && !theme.id.startsWith("custom-"))) {
            console.warn(`[Custom themes] Skipping ${item.file.id}${THEME_SUFFIX}: custom themes cannot replace built-in themes.`);
            return false;
        }
        return true;
    });
}

async function reloadRegistry(): Promise<SavedCustomTheme[]> {
    const loaded = await loadAll();
    savedFiles = new Map(loaded.map((item) => [item.file.id, item.file]));
    replaceCustomThemes(loaded.map((item) => item.theme), settings.theme);
    return loaded;
}

function slugify(name: string): string {
    return name.trim().normalize("NFKD").toLowerCase()
        .replace(/\p{Diacritic}/gu, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "") || "theme";
}

async function uniqueId(name: string): Promise<string> {
    const existing = new Set((await fs.listDir(themesDirectory))
        .filter((filename) => filename.endsWith(THEME_SUFFIX))
        .map((filename) => filename.slice(0, -THEME_SUFFIX.length))
        .filter(isSafeCustomThemeId));
    const base = `custom-${slugify(name)}`;
    if (!existing.has(base)) return base;
    let suffix = 2;
    while (existing.has(`${base}-${suffix}`)) suffix++;
    return `${base}-${suffix}`;
}

function validateDraft(draft: CustomThemeDraft, id: string): SavedCustomTheme {
    const result = validateCustomThemeFile({ ...draft, id });
    reportWarnings(`${id}${THEME_SUFFIX}`, result.warnings);
    if (!result.value) throw new Error(result.warnings.join(" ") || "Invalid custom theme.");
    if (!isSafeCustomThemeId(result.value.id)) throw new Error("Custom theme id must be a safe slug.");
    return { file: result.value, theme: buildCustomTheme(result.value) };
}

async function writeAtomically(file: CustomThemeFile): Promise<void> {
    const destination = pathFor(file.id);
    const temporary = `${destination}.tmp`;
    await fs.write(temporary, `${JSON.stringify(file, null, 2)}\n`);
    await fs.rename(temporary, destination);
}

/** Create a theme with a generated id, or replace a theme at an existing custom id. */
export async function saveCustomTheme(draft: CustomThemeDraft): Promise<SavedCustomTheme> {
    await fs.wait();
    if (!themesDirectory) themesDirectory = fs.resolveDataPath("themes");
    await fs.mkdir(themesDirectory);
    let id: string;
    if (draft.id !== undefined) {
        id = draft.id;
        if (!isSafeCustomThemeId(id)) throw new Error("Custom theme id must be a safe slug.");
        const existing = await loadAll();
        if (!existing.some((item) => item.file.id === id)) throw new Error(`Custom theme does not exist: ${id}`);
    } else {
        id = await uniqueId(draft.name);
    }
    if (getAvailableThemes().some((theme) => theme.id === id && !theme.id.startsWith("custom-"))) {
        throw new Error("Built-in themes cannot be replaced.");
    }
    const saved = validateDraft(draft, id);
    await writeAtomically(saved.file);
    const loaded = await reloadRegistry();
    return loaded.find((item) => item.file.id === id) ?? saved;
}

/** Rename a saved theme without changing its stable id or selected setting. */
export async function renameCustomTheme(id: string, name: string): Promise<SavedCustomTheme> {
    const existing = (await loadAll()).find((item) => item.file.id === id);
    if (!existing) throw new Error(`Custom theme does not exist: ${id}`);
    return saveCustomTheme({ ...existing.file, name, id });
}

/** Return the stored file of a loaded custom theme, as of the last registry reload. */
export function getCustomThemeFile(id: string): CustomThemeFile | undefined {
    return savedFiles.get(id);
}

/** Delete one custom theme; persist the fallback only in this window when it was selected. */
export async function deleteCustomTheme(id: string): Promise<void> {
    if (!isSafeCustomThemeId(id)) throw new Error("Built-in themes cannot be deleted.");
    const wasSelected = settings.theme === id;
    const filePath = pathFor(id);
    if (!(await fs.exists(filePath))) throw new Error(`Custom theme does not exist: ${id}`);
    await fs.delete(filePath);
    if (wasSelected) settings.set("theme", "persephone");
    await reloadRegistry();
}

/** Initialize custom definitions and the cross-window file watcher once per renderer. */
export async function initCustomThemeStorage(): Promise<void> {
    if (!initialization) {
        initialization = (async () => {
            await fs.wait();
            await settings.wait();
            themesDirectory = fs.resolveDataPath("themes");
            await fs.mkdir(themesDirectory);
            await reloadRegistry();
            directoryWatcher = new DirectoryWatcher(themesDirectory, () => {
                void reloadRegistry().catch((error: unknown) => {
                    console.warn("[Custom themes] Failed to reload changed theme files", error);
                });
            }, 500, "custom themes");
        })();
    }
    await initialization;
    void directoryWatcher;
}
