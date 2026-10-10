import { englishCatalog, type MessageKey } from "./en";
import { hashEnglishMessage } from "./hash";
import type { LanguagePack } from "./pack";

export interface PackAudit {
    missingKeys: string[];
    staleKeys: string[];
    unverified: number;
}

/** Audit one validated pack against the English source catalog. */
export function auditLanguagePack(pack: LanguagePack, area?: string): PackAudit {
    const englishKeys = Object.entries(englishCatalog).flatMap(([catalogArea, messages]) =>
        Object.keys(messages).map((key) => `${catalogArea}.${key}`),
    );
    const keysInArea = (key: string): boolean => area === undefined || key.startsWith(`${area}.`);
    const translated = new Set(Object.keys(pack.messages));
    const missingKeys = englishKeys.filter((key) => keysInArea(key) && !translated.has(key));
    const staleKeys: string[] = [];
    let unverified = 0;
    for (const key of translated) {
        if (!keysInArea(key)) continue;
        const sourceHash = pack.source?.[key as MessageKey];
        if (!sourceHash) {
            unverified += 1;
            continue;
        }
        const [catalogArea, entryKey] = key.split(".");
        const englishMessage = (englishCatalog as Record<string, Record<string, string | Readonly<Record<string, string>>>>)[catalogArea]?.[entryKey];
        if (englishMessage !== undefined && sourceHash !== hashEnglishMessage(englishMessage)) staleKeys.push(key);
    }
    return { missingKeys, staleKeys, unverified };
}
