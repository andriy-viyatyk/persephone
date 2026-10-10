import type { LanguagePack } from "./pack";
import { englishCatalog } from "./en";

/** Match the Settings picker: count the union of translated keys across packs for one code. */
export function languageCompleteness(packs: readonly LanguagePack[]): number {
    const totalEnglishKeys = Object.values(englishCatalog).reduce<number>((count, area) => count + Object.keys(area).length, 0);
    if (totalEnglishKeys <= 0) return 0;
    const translatedKeys = new Set(packs.flatMap((pack) => Object.keys(pack.messages)));
    return Math.round(100 * translatedKeys.size / totalEnglishKeys);
}
