import { fs } from "../../api/fs";
import { fpJoin } from "../../core/utils/file-path";
import { getActiveLocale } from "../../../shared/i18n/active-locale";
import { parsePackMessage, hasSamePlaceholders, messagePlaceholders } from "../../../shared/i18n/validate-pack";
import { pseudoText } from "../../../shared/i18n/pseudo-text";
import type { BoardI18nContext, BoardI18nMessage, BoardI18nTable } from "../../../ipc/board-bridge-channels";
import type { BoardLanguages } from "./board-manifest";

interface BoardPack {
    messages: BoardI18nTable;
    warnings: string[];
}

export interface BoardI18nLoadResult {
    context: BoardI18nContext;
    warnings: string[];
}

export async function loadBoardI18n(boardRoot: string, languages?: BoardLanguages): Promise<BoardI18nLoadResult> {
    const code = getActiveLocale();
    if (!languages) return { context: { locale: { code }, tables: [{}, {}, {}] }, warnings: [] };

    const base = code.split("-")[0];
    const codes = code === "en-XA"
        ? [languages.default]
        : [...new Set([code, base, languages.default])];
    const loaded = new Map<string, BoardPack>();
    const warnings: string[] = [];

    for (const packCode of codes) {
        const result = await readBoardPack(boardRoot, languages.folder, packCode);
        if (result) {
            loaded.set(packCode, result);
        } else if (packCode === languages.default) {
            warnings.push(`Board language pack ${packCode}.json is missing or unreadable.`);
        }
    }

    const defaultTable = loaded.get(languages.default)?.messages ?? {};
    for (const packCode of codes) {
        if (packCode === languages.default) continue;
        const pack = loaded.get(packCode);
        if (!pack) continue;
        for (const [key, message] of Object.entries(pack.messages)) {
            if (key.startsWith("manifest.")) continue;
            const defaultMessage = defaultTable[key];
            if (!defaultMessage) {
                delete pack.messages[key];
                pack.warnings.push(`${packCode}.json: unknown key ${key}; ignored.`);
                continue;
            }
            if (!hasSamePlaceholders(message, defaultMessage)) {
                delete pack.messages[key];
                pack.warnings.push(`${packCode}.json: placeholder mismatch for ${key}; ignored.`);
            }
        }
    }
    for (const pack of loaded.values()) warnings.push(...pack.warnings);

    if (code === "en-XA") {
        return {
            context: {
                locale: { code },
                tables: [pseudoTable(defaultTable), {}, defaultTable],
            },
            warnings,
        };
    }

    return {
        context: {
            locale: { code },
            tables: [loaded.get(code)?.messages ?? {}, loaded.get(base)?.messages ?? {}, defaultTable],
        },
        warnings,
    };
}

async function readBoardPack(boardRoot: string, folder: string, code: string): Promise<BoardPack | undefined> {
    const filePath = fpJoin(boardRoot, folder, `${code}.json`);
    let text: string;
    try {
        text = await fs.read(filePath, "utf-8");
    } catch {
        return undefined;
    }

    const warnings: string[] = [];
    let input: unknown;
    try {
        input = JSON.parse(text);
    } catch {
        return { messages: {}, warnings: [`${code}.json: malformed JSON; pack ignored.`] };
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

function pseudoTable(table: BoardI18nTable): BoardI18nTable {
    return Object.fromEntries(Object.entries(table).map(([key, message]) => [
        key,
        typeof message === "string"
            ? pseudoText(message)
            : Object.fromEntries(Object.entries(message).map(([category, text]) => [category, pseudoText(text)])),
    ]));
}
