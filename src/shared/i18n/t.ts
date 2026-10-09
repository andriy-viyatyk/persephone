import { englishCatalog, type MessageKey, type MessageParams } from "./en";
import { getActiveLocale } from "./active-locale";
import { pluralCategory } from "./plurals";
import type { LanguagePack, PackMessage } from "./pack";
import { resolveMessage } from "./resolve-message";

let userPack: LanguagePack | undefined;
let builtInPack: LanguagePack | undefined;

export function setLocalePacks(user: LanguagePack | undefined, builtIn: LanguagePack | undefined): void {
    userPack = user;
    builtInPack = builtIn;
}

function formatMessage(message: PackMessage | undefined, fallback: PackMessage | undefined, params?: Record<string, unknown>): string {
    let selected = message ?? fallback;
    if (selected && typeof selected === "object") {
        const count = params?.count;
        const category = typeof count === "number" ? pluralCategory(getActiveLocale(), count) : "other";
        const fallbackMessage = fallback && typeof fallback === "object"
            ? fallback[category] ?? fallback.other
            : fallback;
        selected = selected[category] ?? selected.other ?? fallbackMessage;
    }
    if (typeof selected !== "string") return "";
    return selected.replace(/\{([\w.-]+)\}/g, (match, name: string) => {
        const value = params?.[name];
        return value === undefined || value === null ? match : String(value);
    });
}

export function t<K extends MessageKey>(key: K, params?: MessageParams<K>): string {
    const resolved = resolveMessage(key, userPack, builtInPack);
    if (resolved === undefined) return key;
    const [area, name] = key.split(".");
    const fallback = (englishCatalog as Record<string, Record<string, PackMessage>>)[area]?.[name];
    return formatMessage(resolved, fallback, params as Record<string, unknown> | undefined);
}

export function getPluralCategories(locale: string, counts: readonly number[]): Intl.LDMLPluralRule[] {
    return counts.map((count) => pluralCategory(locale, count));
}
