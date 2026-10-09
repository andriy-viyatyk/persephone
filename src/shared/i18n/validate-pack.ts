import { englishCatalog, type MessageKey } from "./en";
import type { EnglishMessage } from "./en/common";
import type { LanguagePack, PackMessage } from "./pack";

// D15 blocked names, lowercase (names are compared lowercased), written as escapes so the source
// holds no Russian text.
const blockedNames = ["russian", "русский", "руский"];

export function isBlockedLanguagePack(pack: { code?: unknown; name?: unknown; englishName?: unknown }): boolean {
    const code = typeof pack.code === "string" ? pack.code.trim().toLowerCase() : "";
    if (code === "ru" || code.startsWith("ru-")) return true;
    return [pack.name, pack.englishName].some((name) => typeof name === "string" && blockedNames.includes(name.trim().toLowerCase()));
}

function placeholders(message: string): string[] {
    return [...message.matchAll(/\{([\w.-]+)\}/g)].map((match) => match[1]).sort();
}

function englishMessage(key: MessageKey): EnglishMessage | undefined {
    const [area, name] = key.split(".");
    return (englishCatalog as Record<string, Record<string, EnglishMessage>>)[area]?.[name];
}

function samePlaceholders(candidate: PackMessage, english: EnglishMessage): boolean {
    const candidateValues = typeof candidate === "string" ? [candidate] : Object.values(candidate);
    const englishValues = typeof english === "string" ? [english] : Object.values(english);
    const expected = [...new Set(englishValues.flatMap(placeholders))].sort();
    return candidateValues.every((value) => JSON.stringify([...new Set(placeholders(value))].sort()) === JSON.stringify(expected));
}

export interface PackValidationResult { value?: LanguagePack; warnings: string[]; }

export function normalizeLanguageCode(code: string): string {
    return code.trim().replace(/_/g, "-").split("-").map((part, index) =>
        index === 0 ? part.toLowerCase() : part.length === 2 ? part.toUpperCase() : part.toLowerCase(),
    ).join("-");
}

export function validateLanguagePack(input: unknown, filename: string): PackValidationResult {
    const warnings: string[] = [];
    if (!input || typeof input !== "object" || Array.isArray(input)) return { warnings: [`${filename}: expected an object.`] };
    const candidate = input as Record<string, unknown>;
    if (isBlockedLanguagePack(candidate)) return { warnings: [`${filename}: rejected by D15 because the language code or name is blocked.`] };
    const code = candidate.code;
    const match = filename.match(/^(.+)\.lang\.json$/i);
    if (!match || typeof code !== "string" || match[1].toLowerCase() !== code.toLowerCase()) {
        return { warnings: [`${filename}: filename must be <code>.lang.json and match the pack code.`] };
    }
    if (candidate.schemaVersion !== 1 || typeof candidate.name !== "string" || typeof candidate.englishName !== "string" || !candidate.messages || typeof candidate.messages !== "object" || Array.isArray(candidate.messages)) {
        return { warnings: [`${filename}: malformed language pack.`] };
    }
    if (candidate.direction !== undefined && candidate.direction !== "ltr") return { warnings: [`${filename}: direction must be "ltr".`] };
    const messages: Partial<Record<MessageKey, PackMessage>> = {};
    for (const [key, raw] of Object.entries(candidate.messages as Record<string, unknown>)) {
        const [area, name] = key.split(".");
        if (!area || !name || !Object.hasOwn(englishCatalog[area as keyof typeof englishCatalog] ?? {}, name)) {
            warnings.push(`${filename}: unknown message key ${key}; ignored.`);
            continue;
        }
        const messageKey = key as MessageKey;
        const english = englishMessage(messageKey);
        let message: PackMessage | undefined;
        if (typeof raw === "string") message = raw;
        else if (raw && typeof raw === "object" && !Array.isArray(raw)) {
            const entries = Object.entries(raw as Record<string, unknown>);
            if (entries.length > 0 && entries.every(([category, value]) => ["zero", "one", "two", "few", "many", "other"].includes(category) && typeof value === "string")) {
                message = Object.fromEntries(entries) as PackMessage;
            }
        }
        if (!message) {
            warnings.push(`${filename}: invalid message ${key}; ignored.`);
            continue;
        }
        if (english && !samePlaceholders(message, english)) {
            warnings.push(`${filename}: placeholder mismatch for ${key}; ignored.`);
            continue;
        }
        messages[messageKey] = message;
    }
    const source = candidate.source && typeof candidate.source === "object" && !Array.isArray(candidate.source)
        ? candidate.source as LanguagePack["source"] : undefined;
    return { value: { schemaVersion: 1, code: normalizeLanguageCode(code), name: candidate.name, englishName: candidate.englishName, direction: candidate.direction as "ltr" | undefined, messages, source }, warnings };
}
