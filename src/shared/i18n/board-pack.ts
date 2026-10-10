import { normalizeBoardRelativePath } from "../guides/mounted-source";
import { parsePackMessage, messagePlaceholders, hasSamePlaceholders } from "./validate-pack";
import type { BoardI18nMessage, BoardI18nTable } from "../../ipc/board-bridge-channels";

export interface BoardLanguages {
    folder: string;
    default: string;
}

export interface BoardPack {
    messages: BoardI18nTable;
    warnings: string[];
}

export function normalizeBoardLanguages(raw: unknown): BoardLanguages | undefined {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
    const candidate = raw as Record<string, unknown>;
    const folder = candidate.folder === undefined ? "lang" : normalizeBoardRelativePath(candidate.folder);
    const defaultCode = candidate.default === undefined ? "en" : candidate.default;
    if (!folder || typeof defaultCode !== "string" || !/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(defaultCode)) return undefined;
    try {
        const canonical = Intl.getCanonicalLocales(defaultCode)[0];
        return canonical ? { folder, default: canonical } : undefined;
    } catch {
        return undefined;
    }
}

/** Parse and normalize a board language pack using the host's rules. */
export function parseBoardLanguagePack(value: unknown, code: string): BoardPack {
    const warnings: string[] = [];
    let input = value;
    if (typeof value === "string") {
        try {
            input = JSON.parse(value) as unknown;
        } catch {
            return { messages: {}, warnings: [`${code}.json: malformed JSON; pack ignored.`] };
        }
    }
    if (!input || typeof input !== "object" || Array.isArray(input)) {
        return { messages: {}, warnings: [`${code}.json: expected a pack object; pack ignored.`] };
    }
    const rawMessages = (input as Record<string, unknown>).messages;
    if (!rawMessages || typeof rawMessages !== "object" || Array.isArray(rawMessages)) {
        return { messages: {}, warnings: [`${code}.json: expected a messages object; pack ignored.`] };
    }
    const messages: BoardI18nTable = {};
    for (const [key, raw] of Object.entries(rawMessages as Record<string, unknown>)) {
        if (!key.trim()) {
            warnings.push(`${code}.json: invalid empty message key; ignored.`);
            continue;
        }
        if (key.startsWith("manifest.")) {
            if (key.length === "manifest.".length || typeof raw !== "string" || messagePlaceholders(raw).length > 0) {
                warnings.push(`${code}.json: invalid manifest entry ${key}; expected a plain string without placeholders.`);
                continue;
            }
            messages[key] = raw;
            continue;
        }
        const message = parsePackMessage(raw);
        if (!message) {
            warnings.push(`${code}.json: invalid message ${key}; ignored.`);
            continue;
        }
        messages[key] = message as BoardI18nMessage;
    }
    return { messages, warnings };
}

/** Filter invalid non-default entries while returning host-equivalent warnings. */
export function validateBoardTranslationPack(packCode: string, pack: BoardPack, defaultTable: BoardI18nTable): BoardPack {
    const messages: BoardI18nTable = {};
    const warnings = [...pack.warnings];
    for (const [key, message] of Object.entries(pack.messages)) {
        if (key.startsWith("manifest.")) {
            messages[key] = message;
            continue;
        }
        const defaultMessage = defaultTable[key];
        if (!defaultMessage) {
            warnings.push(`${packCode}.json: unknown key ${key}; ignored.`);
            continue;
        }
        if (!hasSamePlaceholders(message, defaultMessage)) {
            warnings.push(`${packCode}.json: placeholder mismatch for ${key}; ignored.`);
            continue;
        }
        messages[key] = message;
    }
    return { messages, warnings };
}
