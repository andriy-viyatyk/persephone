import { readdir, readFile } from "node:fs/promises";
import { basename, join, parse as parsePath, resolve } from "node:path";
import process from "node:process";
import { errMessage } from "../src/shared/utils";
import { englishCatalog } from "../src/shared/i18n/en";
import { auditLanguagePack } from "../src/shared/i18n/audit-pack";
import { checkTranslatedMessage } from "../src/shared/i18n/broken-text";
import { normalizeBoardLanguages, parseBoardLanguagePack, validateBoardTranslationPack } from "../src/shared/i18n/board-pack";
import { createPseudoLocalePack } from "../src/shared/i18n/pseudo-locale";
import { validateLanguagePack } from "../src/shared/i18n/validate-pack";

interface PackFile {
    filename: string;
    fullPath: string;
}

interface LoadedPack {
    value: unknown;
    error?: string;
}

const englishMessages = englishCatalog as Record<string, Record<string, string | Readonly<Record<string, string>>>>;
const englishKeys = Object.entries(englishMessages).flatMap(([area, entries]) =>
    Object.keys(entries).map((entry) => `${area}.${entry}`),
);

function isPackFile(filename: string): boolean {
    return filename.toLowerCase().endsWith(".lang.json");
}

async function listPackFiles(directory: string): Promise<PackFile[]> {
    const entries = await readdir(directory, { withFileTypes: true });
    return entries
        .filter((entry) => entry.isFile() && isPackFile(entry.name))
        .map((entry) => ({ filename: entry.name, fullPath: resolve(directory, entry.name) }))
        .sort((left, right) => left.filename.localeCompare(right.filename));
}

async function readPackFile(file: PackFile): Promise<LoadedPack> {
    try {
        const raw = await readFile(file.fullPath, "utf8");
        return { value: JSON.parse(raw) as unknown };
    } catch (error) {
        return { value: undefined, error: errMessage(error, "Could not read or parse pack file.") };
    }
}

const LISTED_KEYS_LIMIT = 20;

function listKeys(keys: readonly string[]): string {
    if (!keys.length) return "none";
    const listed = keys.slice(0, LISTED_KEYS_LIMIT).join(", ");
    return keys.length > LISTED_KEYS_LIMIT ? `${listed}, … (${keys.length - LISTED_KEYS_LIMIT} more)` : listed;
}

function reportPack(
    filename: string,
    loaded: LoadedPack,
    fatal: { value: boolean },
    reportIdentical: boolean,
): void {
    if (loaded.error) {
        console.error(`INVALID ${filename}: ${loaded.error}`);
        fatal.value = true;
        return;
    }

    const result = validateLanguagePack(loaded.value, filename);
    for (const warning of result.warnings) {
        console.error(`INVALID ${warning}`);
        fatal.value = true;
    }
    const pack = result.value;
    if (!pack) return;

    const audit = auditLanguagePack(pack);
    const translated = Object.keys(pack.messages).length;
    console.log(`${filename}: ${translated}/${englishKeys.length} translated messages.`);
    console.log(`  Missing (${audit.missingKeys.length}): ${listKeys(audit.missingKeys)}`);
    console.log(`  Stale source hashes (${audit.staleKeys.length}): ${listKeys(audit.staleKeys)}`);
    console.log(`  Unverified source hashes: ${audit.unverified}`);
    if (reportIdentical) {
        const identicalKeys = Object.entries(pack.messages)
            .filter(([key, message]) => {
                const [area, entry] = key.split(".");
                const english = englishMessages[area]?.[entry];
                return english !== undefined && messagesAreIdentical(message, english as never);
            })
            .map(([key]) => key)
            .sort();
        console.log(`  Identical to English (${identicalKeys.length}): ${listKeys(identicalKeys)}`);
    }
    for (const [key, message] of Object.entries(pack.messages)) {
        const [area, entry] = key.split(".");
        const english = englishMessages[area]?.[entry];
        if (english === undefined) continue;
        for (const issue of checkTranslatedMessage(message, english as never, pack.code)) {
            console.error(`BROKEN ${filename} ${key}: ${issue.kind}${issue.detail ? ` (${issue.detail})` : ""}`);
            fatal.value = true;
        }
    }
}

function messagesAreIdentical(
    candidate: string | Readonly<Record<string, string>>,
    reference: string | Readonly<Record<string, string>>,
): boolean {
    if (typeof candidate === "string" || typeof reference === "string") return candidate === reference;
    const candidateKeys = Object.keys(candidate).sort();
    const referenceKeys = Object.keys(reference).sort();
    return candidateKeys.length === referenceKeys.length
        && candidateKeys.every((key, index) => key === referenceKeys[index] && candidate[key] === reference[key]);
}

function boardManifestEnglishMessages(manifest: unknown): Map<string, string> {
    const result = new Map<string, string>();
    if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) return result;
    const source = manifest as Record<string, unknown>;
    for (const key of ["name", "description", "editorName"] as const) {
        if (typeof source[key] === "string") result.set(`manifest.${key}`, source[key] as string);
    }
    const addList = (
        keyArea: "views" | "settings" | "capabilities",
        sourceProperty: "secondaryViews" | "settings" | "capabilities",
        fields: readonly string[],
    ) => {
        const entries = source[sourceProperty];
        if (!Array.isArray(entries)) return;
        for (const entry of entries) {
            if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
            const candidate = entry as Record<string, unknown>;
            if (typeof candidate.id !== "string") continue;
            for (const field of fields) {
                if (typeof candidate[field] === "string") {
                    result.set(`manifest.${keyArea}.${candidate.id}.${field}`, candidate[field] as string);
                }
            }
        }
    };
    addList("views", "secondaryViews", ["title"]);
    addList("settings", "settings", ["label", "description"]);
    addList("capabilities", "capabilities", ["title"]);
    return result;
}

function parseArguments(arguments_: readonly string[]): { userDirectory?: string; boardPatterns: string[]; identical: boolean; error?: string } {
    const positional: string[] = [];
    const boardPatterns: string[] = [];
    let identical = false;
    for (let index = 0; index < arguments_.length; index += 1) {
        const argument = arguments_[index];
        if (argument === "--boards") {
            let count = 0;
            while (index + 1 < arguments_.length && !arguments_[index + 1].startsWith("--")) {
                boardPatterns.push(arguments_[index + 1]);
                index += 1;
                count += 1;
            }
            if (count === 0) return { boardPatterns, identical, error: "--boards requires at least one board root." };
        } else if (argument === "--identical") {
            identical = true;
        } else if (argument.startsWith("--")) {
            return { boardPatterns, identical, error: `Unknown option ${argument}.` };
        } else positional.push(argument);
    }
    if (positional.length > 1) return { boardPatterns, identical, error: "Only one optional user-pack directory is supported." };
    return { userDirectory: positional[0], boardPatterns, identical };
}

function wildcardMatcher(segment: string): RegExp {
    return new RegExp(`^${segment.split("*").map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`, "i");
}

async function expandPattern(pattern: string): Promise<string[]> {
    const absolute = resolve(process.cwd(), pattern);
    const root = parsePath(absolute).root;
    const segments = absolute.slice(root.length).split(/[\\/]+/).filter(Boolean);
    let paths = [root];
    for (const segment of segments) {
        if (!segment.includes("*")) {
            paths = paths.map((path) => join(path, segment));
            continue;
        }
        const matcher = wildcardMatcher(segment);
        const next: string[] = [];
        for (const path of paths) {
            try {
                const children = await readdir(path, { withFileTypes: true });
                for (const child of children) if (matcher.test(child.name)) next.push(join(path, child.name));
            } catch { /* no matches below this path */ }
        }
        paths = next;
    }
    return paths;
}

async function checkBoards(patterns: readonly string[], fatal: { value: boolean }, reportIdentical: boolean): Promise<void> {
    for (const pattern of patterns) {
        const roots = await expandPattern(pattern);
        for (const boardRoot of roots) {
            let manifest: unknown;
            try {
                manifest = JSON.parse(await readFile(join(boardRoot, "board-manifest.json"), "utf8")) as unknown;
            } catch {
                continue;
            }
            const rawLanguages = manifest && typeof manifest === "object" && !Array.isArray(manifest)
                ? (manifest as Record<string, unknown>).languages
                : undefined;
            const languages = normalizeBoardLanguages(rawLanguages);
            const manifestMessages = boardManifestEnglishMessages(manifest);
            if (!languages) {
                console.log(`${boardRoot}: board has no declared language packs; skipped.`);
                continue;
            }
            let files: string[];
            try {
                files = (await readdir(resolve(boardRoot, languages.folder), { withFileTypes: true }))
                    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".json"))
                    .map((entry) => entry.name)
                    .sort((left, right) => left.localeCompare(right));
            } catch (error) {
                console.error(`INVALID board ${boardRoot}: could not read language folder ${languages.folder}: ${errMessage(error)}`);
                fatal.value = true;
                continue;
            }
            const byCode = new Map(files.map((file) => [basename(file, ".json"), file]));
            const defaultFile = byCode.get(languages.default);
            if (!defaultFile) {
                console.error(`INVALID board ${boardRoot} ${languages.default}: default pack is missing or unreadable.`);
                fatal.value = true;
                continue;
            }
            const defaultPack = await loadBoardFile(boardRoot, languages.folder, languages.default);
            if (!defaultPack) {
                console.error(`INVALID board ${boardRoot} ${languages.default}: default pack is missing or unreadable.`);
                fatal.value = true;
                continue;
            }
            for (const warning of defaultPack.warnings) {
                console.error(`INVALID board ${boardRoot} ${languages.default}: ${warning}`);
                fatal.value = true;
            }
            console.log(`Board ${boardRoot}: default ${languages.default}, ${Object.keys(defaultPack.messages).length} messages.`);
            for (const [key, message] of Object.entries(defaultPack.messages)) {
                if (key.startsWith("manifest.")) continue;
                for (const issue of checkTranslatedMessage(message, message as never, languages.default)) {
                    console.error(`BROKEN board ${boardRoot} ${languages.default} ${key}: ${issue.kind}${issue.detail ? ` (${issue.detail})` : ""}`);
                    fatal.value = true;
                }
            }
            for (const file of files) {
                const code = basename(file, ".json");
                if (code === languages.default) continue;
                const parsed = await loadBoardFile(boardRoot, languages.folder, code);
                if (!parsed) {
                    console.error(`INVALID board ${boardRoot} ${code}: pack is missing or unreadable.`);
                    fatal.value = true;
                    continue;
                }
                const pack = validateBoardTranslationPack(code, parsed, defaultPack.messages);
                for (const warning of pack.warnings) {
                    console.error(`INVALID board ${boardRoot} ${code}: ${warning}`);
                    fatal.value = true;
                }
                const missing = Object.keys(defaultPack.messages).filter((key) => !key.startsWith("manifest.") && !Object.hasOwn(pack.messages, key));
                console.log(`  ${code}: ${Object.keys(pack.messages).length}/${Object.keys(defaultPack.messages).length} messages.`);
                if (missing.length) {
                    console.error(`MISSING board ${boardRoot} ${code}: ${missing.join(", ")}`);
                    fatal.value = true;
                }
                for (const [key, message] of Object.entries(pack.messages)) {
                    if (key.startsWith("manifest.")) continue;
                    const english = defaultPack.messages[key];
                    if (english === undefined) continue;
                    for (const issue of checkTranslatedMessage(message, english as never, code)) {
                        console.error(`BROKEN board ${boardRoot} ${code} ${key}: ${issue.kind}${issue.detail ? ` (${issue.detail})` : ""}`);
                        fatal.value = true;
                    }
                }
                if (reportIdentical) {
                    const identicalKeys = Object.entries(pack.messages)
                        .filter(([key, message]) => {
                            const english = key.startsWith("manifest.")
                                ? manifestMessages.get(key)
                                : defaultPack.messages[key];
                            return english !== undefined && messagesAreIdentical(message, english as never);
                        })
                        .map(([key]) => key)
                        .sort();
                    console.log(`  ${code} identical to English (${identicalKeys.length}): ${listKeys(identicalKeys)}`);
                }
            }
        }
    }
}

async function loadBoardFile(boardRoot: string, folder: string, code: string): Promise<ReturnType<typeof parseBoardLanguagePack> | undefined> {
    try {
        const text = await readFile(resolve(boardRoot, folder, `${code}.json`), "utf8");
        return parseBoardLanguagePack(text, code);
    } catch {
        return undefined;
    }
}

function validatePseudoLocale(fatal: { value: boolean }): void {
    const pseudo = createPseudoLocalePack();
    const filename = "en-XA.lang.json";
    const result = validateLanguagePack(pseudo, filename);
    if (result.warnings.length > 0 || !result.value) {
        for (const warning of result.warnings) console.error(`INVALID generated ${warning}`);
        if (!result.value) console.error("INVALID generated en-XA pack was not accepted.");
        fatal.value = true;
        return;
    }
    const actualKeys = Object.keys(result.value.messages);
    const complete = actualKeys.length === englishKeys.length
        && englishKeys.every((key) => Object.hasOwn(result.value?.messages ?? {}, key));
    if (!complete) {
        console.error(`INVALID generated en-XA pack is incomplete (${actualKeys.length}/${englishKeys.length}).`);
        fatal.value = true;
        return;
    }
    console.log(`Generated ${filename}: valid and complete (${actualKeys.length} messages).`);
}

export async function runI18nCheck(arguments_: readonly string[]): Promise<void> {
    const fatal = { value: false };
    const parsedArguments = parseArguments(arguments_);
    if (parsedArguments.error) {
        console.error(`Usage: npm run i18n:check [user-pack-directory] [--identical] [--boards <folder>...] (${parsedArguments.error})`);
        process.exitCode = 1;
        return;
    }

    const builtInDirectory = resolve(process.cwd(), "assets/languages");
    let builtIns: PackFile[];
    try {
        builtIns = await listPackFiles(builtInDirectory);
    } catch (error) {
        console.error(`Could not read built-in language directory: ${errMessage(error)}`);
        process.exitCode = 1;
        return;
    }

    if (builtIns.length === 0) console.log("No built-in language pack files found in assets/languages/.");
    for (const file of builtIns) reportPack(file.filename, await readPackFile(file), fatal, parsedArguments.identical);

    if (parsedArguments.userDirectory) {
        const userDirectory = resolve(process.cwd(), parsedArguments.userDirectory);
        try {
            const userPacks = await listPackFiles(userDirectory);
            if (userPacks.length === 0) console.log(`No user language pack files found in ${userDirectory}.`);
            for (const file of userPacks) reportPack(file.filename, await readPackFile(file), fatal, parsedArguments.identical);
        } catch (error) {
            console.error(`Could not read user language directory: ${errMessage(error)}`);
            fatal.value = true;
        }
    }

    if (parsedArguments.boardPatterns.length > 0) await checkBoards(parsedArguments.boardPatterns, fatal, parsedArguments.identical);
    validatePseudoLocale(fatal);
    if (fatal.value) process.exitCode = 1;
}
