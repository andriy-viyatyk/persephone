import fs from "node:fs";
import path from "node:path";
import JSON5 from "json5";
import { errMessage } from "../shared/utils";
import { loadLanguagePacks } from "../shared/i18n/load-packs";
import { resolveLocale } from "../shared/i18n/resolve-locale";
import { createPseudoLocalePack } from "../shared/i18n/pseudo-locale";
import { setActiveLocale } from "../shared/i18n/active-locale";
import { setLocalePacks } from "../shared/i18n/t";
import type { LanguagePack } from "../shared/i18n/pack";
import { getAssetPath, getDataFolder } from "./utils";
import { rebuildTray } from "./tray-setup";

function readPacks(directory: string): LanguagePack[] {
    try {
        if (!fs.existsSync(directory)) return [];
        const files = fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
            if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".lang.json")) return [];
            try {
                const value: unknown = JSON5.parse(fs.readFileSync(path.join(directory, entry.name), "utf8"));
                return [{ filename: entry.name, value }];
            } catch (error) {
                console.warn(`[i18n] Skipping ${entry.name}: ${errMessage(error, "invalid JSON5")}`);
                return [];
            }
        });
        const result = loadLanguagePacks(files);
        result.warnings.forEach((warning) => console.warn(`[i18n] ${warning}`));
        return result.packs;
    } catch (error) {
        console.warn(`[i18n] Could not read ${directory}: ${errMessage(error)}`);
        return [];
    }
}

export function setMainLocale(reportedCode: string): void {
    const builtInPacks = readPacks(getAssetPath("languages"));
    const userPacks = readPacks(path.join(getDataFolder(), "languages"));
    const available = [...builtInPacks, ...userPacks];
    const locale = resolveLocale(reportedCode, [reportedCode], available);
    const builtInPack = builtInPacks.find((pack) => pack.code.toLowerCase() === locale.toLowerCase());
    const userPack = userPacks.find((pack) => pack.code.toLowerCase() === locale.toLowerCase());
    setActiveLocale(locale);
    setLocalePacks(locale === "en-XA" ? createPseudoLocalePack() : userPack, builtInPack);
    rebuildTray();
}
