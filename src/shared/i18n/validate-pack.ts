import { englishCatalog, type MessageKey } from "./en";
import type { EnglishMessage } from "./en/common";
import type { LanguagePack, PackMessage } from "./pack";

export function messagePlaceholders(message: string): string[] {
    return [...message.matchAll(/\{([\w.-]+)\}/g)].map((match) => match[1]).sort();
}

export function hasSamePlaceholders(candidate: PackMessage, reference: PackMessage): boolean {
    const candidateValues = typeof candidate === "string" ? [candidate] : Object.values(candidate);
    const referenceValues = typeof reference === "string" ? [reference] : Object.values(reference);
    const expected = [...new Set(referenceValues.flatMap(messagePlaceholders))].sort();
    return candidateValues.every((value) => JSON.stringify([...new Set(messagePlaceholders(value))].sort()) === JSON.stringify(expected));
}

export function parsePackMessage(raw: unknown): PackMessage | undefined {
    if (typeof raw === "string") return raw;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
    const entries = Object.entries(raw as Record<string, unknown>);
    if (!entries.length || !entries.every(([category, value]) => ["zero", "one", "two", "few", "many", "other"].includes(category) && typeof value === "string")) return undefined;
    return Object.fromEntries(entries) as PackMessage;
}

function englishMessage(key: MessageKey): EnglishMessage | undefined {
    const [area, name] = key.split(".");
    return (englishCatalog as Record<string, Record<string, EnglishMessage>>)[area]?.[name];
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
        const message = parsePackMessage(raw);
        if (!message) {
            warnings.push(`${filename}: invalid message ${key}; ignored.`);
            continue;
        }
        if (english && !hasSamePlaceholders(message, english)) {
            warnings.push(`${filename}: placeholder mismatch for ${key}; ignored.`);
            continue;
        }
        messages[messageKey] = message;
    }
    const source = candidate.source && typeof candidate.source === "object" && !Array.isArray(candidate.source)
        ? candidate.source as LanguagePack["source"] : undefined;
    return { value: { schemaVersion: 1, code: normalizeLanguageCode(code), name: candidate.name, englishName: candidate.englishName, direction: candidate.direction as "ltr" | undefined, messages, source }, warnings };
}
