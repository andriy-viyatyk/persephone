import { englishCatalog, type MessageKey } from "../../shared/i18n/en";
import { aboutCatalog } from "../../shared/i18n/en/about";
import { apiCatalog } from "../../shared/i18n/en/api";
import { boardCatalog } from "../../shared/i18n/en/board";
import { browserCatalog } from "../../shared/i18n/en/browser";
import { commonCatalog } from "../../shared/i18n/en/common";
import { dialogsCatalog } from "../../shared/i18n/en/dialogs";
import { editorsCatalog } from "../../shared/i18n/en/editors";
import { explorerCatalog } from "../../shared/i18n/en/explorer";
import { gitCatalog } from "../../shared/i18n/en/git";
import { linksCatalog } from "../../shared/i18n/en/links";
import { logViewCatalog } from "../../shared/i18n/en/logView";
import { mainCatalog } from "../../shared/i18n/en/main";
import { menusCatalog } from "../../shared/i18n/en/menus";
import { mnemeCatalog } from "../../shared/i18n/en/mneme";
import { notebookCatalog } from "../../shared/i18n/en/notebook";
import { settingsCatalog } from "../../shared/i18n/en/settings";
import { shellCatalog } from "../../shared/i18n/en/shell";
import { toolsCatalog } from "../../shared/i18n/en/tools";
import { uikitCatalog } from "../../shared/i18n/en/uikit";
import { auditLanguagePack } from "../../shared/i18n/audit-pack";
import { getActiveLocale } from "../../shared/i18n/active-locale";
import { hashEnglishMessage } from "../../shared/i18n/hash";
import { languageCompleteness } from "../../shared/i18n/language-completeness";
import type { LanguagePack, PackMessage } from "../../shared/i18n/pack";
import { messagePlaceholders, normalizeLanguageCode, validateLanguagePack } from "../../shared/i18n/validate-pack";
import { fpJoin } from "../core/utils/file-path";
import { fs } from "./fs";
import { flushSettingsSave, settings } from "./settings";
import { api } from "../../ipc/renderer/api";
import type {
    BoardValidationView,
    EnglishCatalogEntryView,
    EnglishMessagePage,
    ILanguages,
    LanguageAreaSummary,
    LanguageAudit,
    LanguageMetadata,
    LanguageMessage,
    LanguageMessageEntry,
    LanguageMessagePage,
    LanguagePageOptions,
    LanguageSummary,
    PackValidationView,
    StaleLanguageAudit,
    LanguageApplyResult,
    LanguageDeleteResult,
    LanguageSaveOptions,
    LanguageSaveResult,
} from "./types/languages";

const LANGUAGE_CODE_PATTERN = /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]+)*$/;

function normalizeSafeLanguageCode(code: unknown): string {
    if (typeof code !== "string" || !LANGUAGE_CODE_PATTERN.test(code)) {
        throw new Error(`Invalid language code: ${code}`);
    }
    return normalizeLanguageCode(code);
}

function languagePackPath(directory: string, code: string): string {
    return fpJoin(directory, `${code}.lang.json`);
}

function mergeUserPack(existing: LanguagePack | undefined, incoming: LanguagePack): LanguagePack {
    if (!existing) return incoming;
    const messages = { ...existing.messages, ...incoming.messages };
    const source = { ...existing.source };
    for (const key of Object.keys(incoming.messages)) {
        const hash = incoming.source?.[key as MessageKey];
        if (hash) source[key as MessageKey] = hash;
        else delete source[key as MessageKey];
    }
    return {
        ...incoming,
        messages,
        ...(Object.keys(source).length ? { source } : {}),
    };
}

function writeLanguagePackAtomically(path: string, pack: LanguagePack): Promise<void> {
    const temporary = `${path}.tmp`;
    return fs.write(temporary, `${JSON.stringify(pack, null, 2)}\n`).then(() => fs.rename(temporary, path));
}

const ENGLISH_ENTRY_CATALOGS = {
    common: commonCatalog,
    main: mainCatalog,
    settings: settingsCatalog,
    dialogs: dialogsCatalog,
    shell: shellCatalog,
    editors: editorsCatalog,
    menus: menusCatalog,
    api: apiCatalog,
    browser: browserCatalog,
    board: boardCatalog,
    explorer: explorerCatalog,
    links: linksCatalog,
    git: gitCatalog,
    mneme: mnemeCatalog,
    about: aboutCatalog,
    tools: toolsCatalog,
    uikit: uikitCatalog,
    notebook: notebookCatalog,
    logView: logViewCatalog,
} as const;

type CatalogEntry = { message: LanguageMessage; note?: string };
const entryCatalogs = ENGLISH_ENTRY_CATALOGS as unknown as Record<string, Record<string, CatalogEntry>>;
const messagesByArea = englishCatalog as unknown as Record<string, Record<string, LanguageMessage>>;

function cloneMessage(message: PackMessage): LanguageMessage {
    return typeof message === "string" ? message : { ...message };
}

function clonePack(pack: LanguagePack): LanguagePack {
    return {
        schemaVersion: 1,
        code: pack.code,
        name: pack.name,
        englishName: pack.englishName,
        ...(pack.direction === undefined ? {} : { direction: pack.direction }),
        messages: Object.fromEntries(Object.entries(pack.messages).map(([key, message]) => [key, cloneMessage(message)])),
        ...(pack.source ? { source: { ...pack.source } } : {}),
    };
}

function normalizePage(options?: LanguagePageOptions): { offset: number; limit: number } {
    const offset = Number.isFinite(options?.offset) ? Math.max(0, Math.floor(options?.offset ?? 0)) : 0;
    const requestedLimit = Number.isFinite(options?.limit) ? Math.floor(options?.limit ?? 100) : 100;
    return { offset, limit: Math.min(200, Math.max(1, requestedLimit)) };
}

function page<T>(area: string, allEntries: readonly T[], options?: LanguagePageOptions): {
    area: string; total: number; offset: number; entries: T[]; next?: number;
} {
    const { offset, limit } = normalizePage(options);
    const entries = allEntries.slice(offset, offset + limit);
    const next = offset + entries.length < allEntries.length ? offset + entries.length : undefined;
    return { area, total: allEntries.length, offset, entries, ...(next === undefined ? {} : { next }) };
}

function packsByCode(packs: readonly LanguagePack[]): Map<string, LanguagePack> {
    const result = new Map<string, LanguagePack>();
    for (const pack of packs) result.set(pack.code.toLowerCase(), pack);
    return result;
}

function combinePacks(builtIn: LanguagePack | undefined, user: LanguagePack | undefined): LanguagePack | undefined {
    if (!builtIn && !user) return undefined;
    const messages: LanguagePack["messages"] = { ...(builtIn?.messages ?? {}), ...(user?.messages ?? {}) };
    const source: LanguagePack["source"] = { ...(builtIn?.source ?? {}), ...(user?.source ?? {}) };
    for (const key of Object.keys(user?.messages ?? {})) {
        const userHash = user?.source?.[key as MessageKey];
        if (userHash) source[key as MessageKey] = userHash;
        else delete source[key as MessageKey];
    }
    const metadata = user ?? builtIn;
    if (!metadata) return undefined;
    return {
        schemaVersion: 1,
        code: metadata.code,
        name: metadata.name,
        englishName: metadata.englishName,
        ...(metadata.direction ? { direction: metadata.direction } : {}),
        messages,
        source,
    };
}

async function loadPacks(): Promise<{ builtIn: Map<string, LanguagePack>; user: Map<string, LanguagePack> }> {
    const { refreshLanguagePacks } = await import("../i18n/startup");
    const refreshed = await refreshLanguagePacks();
    return { builtIn: packsByCode(refreshed.builtInPacks), user: packsByCode(refreshed.userPacks) };
}

function languageSummary(code: string, builtIn: LanguagePack | undefined, user: LanguagePack | undefined): LanguageSummary {
    const metadata = user ?? builtIn;
    return {
        code: metadata?.code ?? code,
        name: metadata?.name ?? "English",
        englishName: metadata?.englishName ?? "English",
        completeness: code.toLowerCase() === "en" ? 100 : languageCompleteness([builtIn, user].filter((pack): pack is LanguagePack => !!pack)),
        builtIn: !!builtIn,
        user: !!user,
        overridesBuiltIn: !!builtIn && !!user,
    };
}

function englishEntries(area: string): EnglishCatalogEntryView[] {
    const messages = messagesByArea[area];
    if (!messages) return [];
    return Object.keys(messages).sort().map((name) => {
        const key = `${area}.${name}`;
        const message = messages[name];
        const texts = typeof message === "string" ? [message] : Object.values(message);
        const placeholders = [...new Set(texts.flatMap(messagePlaceholders))].sort();
        const note = entryCatalogs[area]?.[name]?.note;
        return {
            key,
            message: cloneMessage(message),
            placeholders,
            ...(note === undefined ? {} : { note }),
            sourceHash: hashEnglishMessage(message),
        };
    });
}

export const languages: ILanguages = {
    get current() {
        const requested = settings.get<string>("language");
        const selection: "auto" | "setting" = requested === "auto" ? "auto" : "setting";
        return {
            code: getActiveLocale(),
            requested,
            selection,
        };
    },

    async list(): Promise<LanguageSummary[]> {
        const { builtIn, user } = await loadPacks();
        const codes = new Set([...builtIn.keys(), ...user.keys()]);
        const result = [languageSummary("en", undefined, undefined)];
        for (const code of codes) {
            if (code === "en") continue;
            result.push(languageSummary(code, builtIn.get(code), user.get(code)));
        }
        if (import.meta.env.DEV) {
            result.push({ code: "en-XA", name: "Pseudo-English", englishName: "Pseudo-English", completeness: 100, builtIn: false, user: false, overridesBuiltIn: false });
        }
        return result;
    },

    get: getLanguage,

    areas(): LanguageAreaSummary[] {
        return Object.entries(messagesByArea).map(([area, entries]) => ({ area, count: Object.keys(entries).length }));
    },

    english(area: string, options?: LanguagePageOptions): EnglishMessagePage {
        return page(area, englishEntries(area), options);
    },

    async missing(code: string, area?: string): Promise<LanguageAudit> {
        const result: LanguageAudit = { code, ...(area === undefined ? {} : { area }), keys: [], count: 0 };
        if (code.toLowerCase() === "en") return result;
        const { builtIn, user } = await loadPacks();
        const pack = combinePacks(builtIn.get(code.toLowerCase()), user.get(code.toLowerCase()));
        if (!pack) return { ...result, warning: `No pack for ${code}` };
        const audit = auditLanguagePack(pack, area);
        return { ...result, keys: audit.missingKeys, count: audit.missingKeys.length };
    },

    async stale(code: string, area?: string): Promise<StaleLanguageAudit> {
        const result: StaleLanguageAudit = { code, ...(area === undefined ? {} : { area }), keys: [], count: 0, unverified: 0 };
        if (code.toLowerCase() === "en") return result;
        const { builtIn, user } = await loadPacks();
        const pack = combinePacks(builtIn.get(code.toLowerCase()), user.get(code.toLowerCase()));
        if (!pack) return { ...result, warning: `No pack for ${code}` };
        const audit = auditLanguagePack(pack, area);
        return { ...result, keys: audit.staleKeys, count: audit.staleKeys.length, unverified: audit.unverified };
    },

    validate(input: unknown): PackValidationView {
        if (!input || typeof input !== "object" || Array.isArray(input) || typeof (input as { code?: unknown }).code !== "string") {
            return { valid: false, warnings: ["A string pack code is required to validate a language pack."] };
        }
        const code = (input as { code: string }).code;
        const result = validateLanguagePack(input, `${code}.lang.json`);
        return {
            valid: !!result.value && result.warnings.length === 0,
            ...(result.value ? { pack: clonePack(result.value) as PackValidationView["pack"] } : {}),
            warnings: [...result.warnings],
        };
    },

    async validateBoard(boardRoot: string, code: string): Promise<BoardValidationView> {
        const { validateBoardLanguagePack } = await import("../editors/board/board-i18n");
        return await validateBoardLanguagePack(boardRoot, code);
    },

    async save(input: unknown, options?: LanguageSaveOptions): Promise<LanguageSaveResult> {
        const candidateCode = input && typeof input === "object" && !Array.isArray(input)
            ? (input as { code?: unknown }).code
            : undefined;
        if (typeof candidateCode === "string") {
            const normalizedCode = normalizeSafeLanguageCode(candidateCode);
            if (normalizedCode.toLowerCase() === "en" || normalizedCode.toLowerCase() === "en-xa") {
                throw new Error(`Language pack ${normalizedCode} cannot be saved.`);
            }
        }

        const validation = languages.validate(input);
        const code = typeof candidateCode === "string" ? normalizeLanguageCode(candidateCode) : undefined;
        if (!validation.valid || !validation.pack) {
            return { ...(code ? { code } : {}), saved: false, warnings: [...validation.warnings] };
        }

        const normalizedCode = normalizeSafeLanguageCode(validation.pack.code);
        if (normalizedCode.toLowerCase() === "en" || normalizedCode.toLowerCase() === "en-xa") {
            throw new Error(`Language pack ${normalizedCode} cannot be saved.`);
        }
        let pack = validation.pack as unknown as LanguagePack;

        if (options?.merge) {
            const { user } = await loadPacks();
            pack = mergeUserPack(user.get(normalizedCode.toLowerCase()), pack);
            const mergedValidation = languages.validate(pack);
            if (!mergedValidation.valid || !mergedValidation.pack) {
                return { code: normalizedCode, saved: false, warnings: [...mergedValidation.warnings] };
            }
            pack = mergedValidation.pack as unknown as LanguagePack;
        }

        const directory = fs.resolveDataPath("languages");
        await fs.mkdir(directory);
        const path = languagePackPath(directory, normalizedCode);
        await writeLanguagePackAtomically(path, pack);
        return { code: normalizedCode, path, saved: true, warnings: [] };
    },

    async delete(code: string): Promise<LanguageDeleteResult> {
        const normalizedCode = normalizeSafeLanguageCode(code);
        const directory = fs.resolveDataPath("languages");
        const path = languagePackPath(directory, normalizedCode);
        if (!await fs.exists(path)) return { code: normalizedCode, deleted: false };
        await fs.delete(path);
        return { code: normalizedCode, deleted: true };
    },

    async apply(code: string): Promise<LanguageApplyResult> {
        const normalizedCode = code === "auto" ? "auto" : normalizeSafeLanguageCode(code);
        const lowerCode = normalizedCode.toLowerCase();
        if (lowerCode === "en-xa") {
            if (!import.meta.env.DEV) throw new Error("Pseudo-English (en-XA) is available only in development.");
        } else if (lowerCode !== "auto" && lowerCode !== "en") {
            const { builtIn, user } = await loadPacks();
            if (!builtIn.has(lowerCode) && !user.has(lowerCode)) {
                throw new Error(`No language pack is available for ${normalizedCode}.`);
            }
        }

        settings.set("language", normalizedCode);
        await flushSettingsSave();
        window.setTimeout(() => {
            void api.reloadAllWindows();
        }, 100);
        return { code: normalizedCode, scheduled: true };
    },
};

async function getLanguage(code: string): Promise<LanguageMetadata | undefined>;
async function getLanguage(code: string, area: string, options?: LanguagePageOptions): Promise<LanguageMessagePage | undefined>;
async function getLanguage(code: string, area?: string, options?: LanguagePageOptions): Promise<LanguageMetadata | LanguageMessagePage | undefined> {
        const { builtIn, user } = await loadPacks();
        const normalizedCode = code.toLowerCase();
        const builtInPack = builtIn.get(normalizedCode);
        const userPack = user.get(normalizedCode);
        if (!builtInPack && !userPack) return undefined;
        const merged = combinePacks(builtInPack, userPack);
        if (!merged) return undefined;
        if (area === undefined) {
            const summary = languageSummary(code, builtInPack, userPack);
            return {
                code: summary.code,
                name: summary.name,
                englishName: summary.englishName,
                builtIn: summary.builtIn,
                user: summary.user,
                overridesBuiltIn: summary.overridesBuiltIn,
                counts: {
                    user: Object.keys(userPack?.messages ?? {}).length,
                    builtIn: Object.keys(builtInPack?.messages ?? {}).length,
                    total: Object.keys(merged.messages).length,
                },
            };
        }
        const entries: LanguageMessageEntry[] = Object.keys(merged.messages)
            .filter((key) => key.startsWith(`${area}.`))
            .sort()
            .map((key) => {
                const message = merged.messages[key as MessageKey];
                if (message === undefined) {
                    throw new Error(`Language pack key disappeared while reading ${key}`);
                }
                return {
                    key,
                    message: cloneMessage(message),
                    from: Object.hasOwn(userPack?.messages ?? {}, key) ? "user" : "builtIn",
                };
            });
        return page(area, entries, options);
}
