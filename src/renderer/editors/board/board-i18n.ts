import { fs } from "../../api/fs";
import { fpJoin } from "../../core/utils/file-path";
import { getActiveLocale } from "../../../shared/i18n/active-locale";
import { parseBoardLanguagePack, validateBoardTranslationPack, type BoardPack } from "../../../shared/i18n/board-pack";
import { pseudoText } from "../../../shared/i18n/pseudo-text";
import type { BoardI18nContext, BoardI18nTable } from "../../../ipc/board-bridge-channels";
import { readNormalizedBoardManifest, type BoardLanguages } from "./board-manifest";

export interface BoardI18nLoadResult {
    context: BoardI18nContext;
    warnings: string[];
}

export interface BoardLanguageValidation {
    boardRoot: string;
    code: string;
    defaultCode: string | null;
    valid: boolean;
    warnings: string[];
    /** Default-pack message keys the requested pack does not translate; they fall back, so they do not affect `valid`. */
    missing: string[];
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
        if (pack) loaded.set(packCode, validateBoardTranslationPack(packCode, pack, defaultTable));
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

export async function validateBoardLanguagePack(boardRoot: string, code: string): Promise<BoardLanguageValidation> {
    const manifest = await readNormalizedBoardManifest(boardRoot);
    const languages = manifest?.languages;
    if (!languages) {
        return {
            boardRoot,
            code,
            defaultCode: null,
            valid: false,
            missing: [],
            warnings: [manifest
                ? "Board manifest has no usable languages configuration."
                : "Board manifest is missing or invalid; language configuration is unavailable."],
        };
    }

    const warnings: string[] = [];
    const requested = await readBoardPack(boardRoot, languages.folder, code);
    if (!requested) warnings.push(`Board language pack ${code}.json is missing or unreadable.`);
    else warnings.push(...requested.warnings);

    const defaultPack = code === languages.default
        ? requested
        : await readBoardPack(boardRoot, languages.folder, languages.default);
    if (!defaultPack) {
        if (code !== languages.default) warnings.push(`Board language pack ${languages.default}.json is missing or unreadable.`);
    } else if (code !== languages.default) {
        warnings.push(...defaultPack.warnings);
    }

    const missing: string[] = [];
    if (requested && code !== languages.default && defaultPack) {
        const warningCount = requested.warnings.length;
        const validated = validateBoardTranslationPack(code, requested, defaultPack.messages);
        warnings.push(...validated.warnings.slice(warningCount));
        missing.push(...Object.keys(defaultPack.messages).filter((key) => !(key in validated.messages)));
    }

    return {
        boardRoot,
        code,
        defaultCode: languages.default,
        valid: warnings.length === 0,
        warnings,
        missing,
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

    return parseBoardLanguagePack(text, code);
}

export { parseBoardLanguagePack } from "../../../shared/i18n/board-pack";

function pseudoTable(table: BoardI18nTable): BoardI18nTable {
    return Object.fromEntries(Object.entries(table).map(([key, message]) => [
        key,
        typeof message === "string"
            ? pseudoText(message)
            : Object.fromEntries(Object.entries(message).map(([category, text]) => [category, pseudoText(text)])),
    ]));
}
