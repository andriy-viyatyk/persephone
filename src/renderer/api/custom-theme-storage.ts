import { settings } from "./settings";
import { fs } from "./fs";
import { DirectoryWatcher } from "../core/utils/file-watcher";
import { fpJoin } from "../core/utils/file-path";
import { buildCustomTheme, validateCustomThemeFile } from "../theme/custom-theme";
import type { CustomThemeFile } from "../theme/custom-theme-types";
import type { ThemeDefinition } from "../theme/themes/types";
import { replaceCustomThemes, getAvailableThemes } from "../theme/themes";

export type CustomThemeDraft = Omit<CustomThemeFile, "id"> & { id?: string };

export interface SavedCustomTheme {
    file: CustomThemeFile;
    theme: ThemeDefinition;
}

const SAFE_CUSTOM_ID = /^custom-[a-z0-9]+(?:-[a-z0-9]+)*$/;
const THEME_SUFFIX = ".theme.json";
let themesDirectory = "";
let directoryWatcher: DirectoryWatcher | undefined;
let initialization: Promise<void> | undefined;
let savedFiles = new Map<string, CustomThemeFile>();

function isSafeCustomId(id: string): boolean {
    return SAFE_CUSTOM_ID.test(id);
}

function pathFor(id: string): string {
    if (!isSafeCustomId(id)) throw new Error(`Invalid custom theme id: ${id}`);
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
    const entries = await fs.listDirWithTypes(themesDirectory);
    const loaded: SavedCustomTheme[] = [];
    for (const entry of entries) {
        if (entry.isDirectory || !entry.name.endsWith(THEME_SUFFIX)) continue;
        const filename = entry.name;
        try {
            const filePath = fpJoin(themesDirectory, filename);
            const stat = await fs.stat(filePath);
            if (!stat.exists || stat.isDirectory) continue;
            const parsed: unknown = JSON.parse(await fs.read(filePath));
            const result = validateCustomThemeFile(parsed);
            if (!result.value) {
                reportWarnings(filename, result.warnings);
                continue;
            }
            const id = result.value.id;
            if (!isSafeCustomId(id) || filename !== `${id}${THEME_SUFFIX}`) {
                console.warn(`[Custom themes] Skipping ${filename}: filename and safe theme id must match.`);
                continue;
            }
            if (getAvailableThemes().some((theme) => theme.id === id && !theme.id.startsWith("custom-"))) {
                console.warn(`[Custom themes] Skipping ${filename}: custom themes cannot replace built-in themes.`);
                continue;
            }
            reportWarnings(filename, result.warnings);
            loaded.push({ file: result.value, theme: buildCustomTheme(result.value) });
        } catch (error) {
            console.warn(`[Custom themes] Skipping unreadable ${filename}`, error);
        }
    }
    return loaded.sort((left, right) =>
        left.theme.name.localeCompare(right.theme.name, undefined, { sensitivity: "base" }) ||
        left.theme.id.localeCompare(right.theme.id)
    );
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
        .filter(isSafeCustomId));
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
    if (!isSafeCustomId(result.value.id)) throw new Error("Custom theme id must be a safe slug.");
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
        if (!isSafeCustomId(id)) throw new Error("Custom theme id must be a safe slug.");
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
    if (!isSafeCustomId(id)) throw new Error("Built-in themes cannot be deleted.");
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
            });
        })();
    }
    await initialization;
    void directoryWatcher;
}
