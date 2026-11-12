import { fpJoin } from "../core/utils/file-path";
import { startupEnvironment } from "../core/startup-environment";
import { buildCustomTheme, validateCustomThemeFile } from "./custom-theme";
import type { CustomThemeFile } from "./custom-theme-types";
import type { ThemeDefinition } from "./themes/types";

const THEME_SUFFIX = ".theme.json";

export interface CustomThemeCatalogEntry {
    file: CustomThemeFile;
    theme: ThemeDefinition;
}

export interface CustomThemeReadFile {
    filename: string;
    content: string;
}

export function isSafeCustomThemeId(id: string): boolean {
    return /^custom-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id);
}

function buildEntries(files: CustomThemeReadFile[]): CustomThemeCatalogEntry[] {
    const entries: CustomThemeCatalogEntry[] = [];
    for (const { filename, content } of files) {
        try {
            const result = validateCustomThemeFile(JSON.parse(content) as unknown);
            if (!result.value) {
                result.warnings.forEach((warning) => console.warn(`[Custom themes] ${filename}: ${warning}`));
                continue;
            }
            if (!isSafeCustomThemeId(result.value.id) || filename !== `${result.value.id}${THEME_SUFFIX}`) {
                console.warn(`[Custom themes] Skipping ${filename}: filename and safe theme id must match.`);
                continue;
            }
            result.warnings.forEach((warning) => console.warn(`[Custom themes] ${filename}: ${warning}`));
            entries.push({ file: result.value, theme: buildCustomTheme(result.value) });
        } catch (error) {
            console.warn(`[Custom themes] Skipping unreadable ${filename}`, error);
        }
    }
    return entries.sort((left, right) =>
        left.theme.name.localeCompare(right.theme.name, undefined, { sensitivity: "base" }) ||
        left.theme.id.localeCompare(right.theme.id)
    );
}

export const customThemeCatalog = {
    loadSync(): CustomThemeCatalogEntry[] {
        try {
            const nodeFs = require("fs") as typeof import("fs");
            const directory = fpJoin(startupEnvironment.dataDirectory, "themes");
            if (!nodeFs.existsSync(directory)) return [];
            const files: CustomThemeReadFile[] = [];
            for (const filename of nodeFs.readdirSync(directory)) {
                if (typeof filename !== "string" || !filename.endsWith(THEME_SUFFIX)) continue;
                try {
                    const filePath = fpJoin(directory, filename);
                    if (nodeFs.statSync(filePath).isFile()) {
                        files.push({ filename, content: nodeFs.readFileSync(filePath, "utf8") });
                    }
                } catch (error) {
                    console.warn(`[Custom themes] Skipping unreadable ${filename}`, error);
                }
            }
            return buildEntries(files);
        } catch (error) {
            console.warn("[Custom themes] Could not read themes directory", error);
            return [];
        }
    },

    async load(readFiles: () => Promise<CustomThemeReadFile[]>): Promise<CustomThemeCatalogEntry[]> {
        try {
            return buildEntries(await readFiles());
        } catch (error) {
            console.warn("[Custom themes] Could not read themes directory", error);
            return [];
        }
    },
};
