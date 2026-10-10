import { parseJSON5 } from "../core/utils/parse-utils";
import { fpJoin } from "../core/utils/file-path";
import { errMessage } from "../../shared/utils";
import { loadLanguagePacks } from "../../shared/i18n/load-packs";
import { resolveLocale } from "../../shared/i18n/resolve-locale";
import { createPseudoLocalePack } from "../../shared/i18n/pseudo-locale";
import { getActiveLocale, setActiveLocale } from "../../shared/i18n/active-locale";
import { setLocalePacks, t, getPluralCategories } from "../../shared/i18n/t";
import { hashEnglishMessage } from "../../shared/i18n/hash";
import { formatDate, formatDateTime, formatTime, formatRelativeTime, formatNumber, formatUnit, formatBytes } from "../core/utils/format";
import { api } from "../../ipc/renderer/api";
import type { LanguagePack } from "../../shared/i18n/pack";
import { setUikitText } from "../uikit/shared/uikit-text";

const nodeFs = require("fs") as typeof import("fs");

function readDirectory(directory: string): LanguagePack[] {
    try {
        if (!nodeFs.existsSync(directory)) return [];
        const files = nodeFs.readdirSync(directory, { withFileTypes: true });
        const packFiles = files.flatMap((entry) => {
            if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".lang.json")) return [];
            try {
                const filePath = fpJoin(directory, entry.name);
                const text = nodeFs.readFileSync(filePath, "utf8");
                let parseError: unknown;
                const value = parseJSON5(text, (error) => { parseError = error; });
                if (parseError || value === undefined) {
                    console.warn(`[i18n] Skipping ${entry.name}: ${errMessage(parseError, "invalid JSON5")}`);
                    return [];
                }
                return [{ filename: entry.name, value }];
            } catch (error) {
                console.warn(`[i18n] Skipping ${entry.name}: ${errMessage(error)}`);
                return [];
            }
        });
        const result = loadLanguagePacks(packFiles);
        result.warnings.forEach((warning) => console.warn(`[i18n] ${warning}`));
        return result.packs;
    } catch (error) {
        console.warn(`[i18n] Could not read ${directory}: ${errMessage(error)}`);
        return [];
    }
}

function readStartupLanguage(): string {
    try {
        const settingsPath = fpJoin(process.env.APPDATA, "persephone", "data", "appSettings.json");
        const parsed = parseJSON5(nodeFs.readFileSync(settingsPath, "utf8")) as { settings?: { language?: unknown }; language?: unknown } | undefined;
        const language = parsed?.settings?.language ?? parsed?.language;
        return typeof language === "string" ? language : "auto";
    } catch {
        return "auto";
    }
}

const PREFERRED_LANGUAGES_ARG = "--persephone-preferred-languages=";
const LANGUAGES_DIR_ARG = "--persephone-languages-dir=";

function readStartupArguments(): { preferred: string[]; assetDirectory: string } {
    let preferred: string[] = [];
    let assetDirectory = "";
    for (const argument of process.argv) {
        if (argument.startsWith(PREFERRED_LANGUAGES_ARG)) {
            try {
                const parsed: unknown = JSON.parse(argument.slice(PREFERRED_LANGUAGES_ARG.length));
                if (Array.isArray(parsed) && parsed.every((value) => typeof value === "string")) preferred = parsed;
            } catch { /* A malformed list leaves the OS preference empty, which resolves to English. */ }
        } else if (argument.startsWith(LANGUAGES_DIR_ARG)) {
            assetDirectory = argument.slice(LANGUAGES_DIR_ARG.length);
        }
    }
    return { preferred, assetDirectory };
}

const startupArguments = readStartupArguments();
const builtInPacks = readDirectory(startupArguments.assetDirectory);
const userPacks = readDirectory(fpJoin(process.env.APPDATA, "persephone", "data", "languages"));
const allPacks = [...builtInPacks, ...userPacks];
const requestedLocale = readStartupLanguage();
const activeLocale = resolveLocale(requestedLocale, startupArguments.preferred, allPacks);
const builtInPack = builtInPacks.find((pack) => pack.code.toLowerCase() === activeLocale.toLowerCase());
const userPack = userPacks.find((pack) => pack.code.toLowerCase() === activeLocale.toLowerCase());
const pseudoPack = activeLocale === "en-XA" ? createPseudoLocalePack() : undefined;

setActiveLocale(activeLocale);
setLocalePacks(userPack ?? pseudoPack, builtInPack);
setUikitText({
    close: t("common.close"),
    loading: t("common.loading"),
    searchPlaceholder: t("menus.searchPlaceholder"),
    collapse: t("uikit.collapse"),
    expand: t("uikit.expand"),
    resetZoom: t("uikit.resetZoom"),
    noRows: t("uikit.noRows"),
    noResults: t("uikit.noResults"),
    noItems: t("uikit.noItems"),
    progress: t("uikit.progress"),
    removeTag: t("uikit.removeTag"),
    moreActions: t("uikit.moreActions"),
    tagsInputPlaceholder: t("uikit.tagsInputPlaceholder"),
    all: t("uikit.all"),
    selectAll: t("uikit.selectAll"),
});

export interface RefreshedLanguagePacks {
    readonly builtInPacks: LanguagePack[];
    readonly userPacks: LanguagePack[];
    readonly preferredLanguages: string[];
}

/** Re-scan the same pack directories used during startup, applying the shared validator. */
export async function refreshLanguagePacks(): Promise<RefreshedLanguagePacks> {
    const [assetDirectory, userDataDirectory] = await Promise.all([
        api.getAssetsPath("languages"),
        api.getCommonFolder("userData"),
    ]);
    return {
        builtInPacks: readDirectory(assetDirectory),
        userPacks: readDirectory(fpJoin(userDataDirectory, "data", "languages")),
        preferredLanguages: [...startupArguments.preferred],
    };
}

export function getStartupPreferredLanguages(): readonly string[] {
    return startupArguments.preferred;
}

if (import.meta.env.DEV) {
    Object.defineProperty(globalThis, "__persephoneI18nDebug", {
        configurable: false,
        enumerable: false,
        writable: false,
        value: Object.freeze({
            t,
            getActiveLocale,
            pluralCategories: getPluralCategories,
            hashEnglishMessage,
            formatDate,
            formatDateTime,
            formatTime,
            formatRelativeTime,
            formatNumber,
            formatUnit,
            formatBytes,
        }),
    });
}

void api.setActiveLocale(activeLocale).catch((error: unknown) => {
    console.warn(`[i18n] Could not report locale to main: ${errMessage(error)}`);
});
