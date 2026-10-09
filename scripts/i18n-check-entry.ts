import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";
import { errMessage } from "../src/shared/utils";
import { englishCatalog } from "../src/shared/i18n/en";
import { filterLanguagePack } from "../src/shared/i18n/filter-pack";
import { hashEnglishMessage } from "../src/shared/i18n/hash";
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

function deepEqual(left: unknown, right: unknown): boolean {
    if (left === right) return true;
    if (!left || !right || typeof left !== "object" || typeof right !== "object") return false;
    if (Array.isArray(left) || Array.isArray(right)) {
        return Array.isArray(left) && Array.isArray(right)
            && left.length === right.length
            && left.every((value, index) => deepEqual(value, right[index]));
    }
    const leftRecord = left as Record<string, unknown>;
    const rightRecord = right as Record<string, unknown>;
    const leftKeys = Object.keys(leftRecord).sort();
    const rightKeys = Object.keys(rightRecord).sort();
    return leftKeys.length === rightKeys.length
        && leftKeys.every((key, index) => key === rightKeys[index] && deepEqual(leftRecord[key], rightRecord[key]));
}

function reportPack(
    filename: string,
    loaded: LoadedPack,
    builtIn: boolean,
    fatal: { value: boolean },
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

    const packKeys = new Set(Object.keys(pack.messages));
    const missing = englishKeys.filter((key) => !packKeys.has(key as keyof typeof pack.messages));
    const stale: string[] = [];
    for (const key of packKeys) {
        const [area, entry] = key.split(".");
        const english = englishMessages[area]?.[entry];
        if (english === undefined) continue;
        const englishHash = hashEnglishMessage(english);
        if (pack.source?.[key as keyof typeof pack.source] !== englishHash) stale.push(key);
    }

    console.log(`${filename}: ${packKeys.size}/${englishKeys.length} translated messages.`);
    if (missing.length > 0) console.log(`  Missing (${missing.length}): ${missing.join(", ")}`);
    if (stale.length > 0) console.log(`  Stale source hashes (${stale.length}): ${stale.join(", ")}`);

    if (builtIn) {
        const filtered = filterLanguagePack(pack);
        if (!deepEqual(filtered.messages, pack.messages)) {
            console.error(`INVALID ${filename}: D16 would change one or more built-in messages.`);
            fatal.value = true;
        }
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
    if (arguments_.length > 1) {
        console.error("Usage: npm run i18n:check [user-pack-directory]");
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
    for (const file of builtIns) reportPack(file.filename, await readPackFile(file), true, fatal);

    if (arguments_[0]) {
        const userDirectory = resolve(process.cwd(), arguments_[0]);
        try {
            const userPacks = await listPackFiles(userDirectory);
            if (userPacks.length === 0) console.log(`No user language pack files found in ${userDirectory}.`);
            for (const file of userPacks) reportPack(file.filename, await readPackFile(file), false, fatal);
        } catch (error) {
            console.error(`Could not read user language directory: ${errMessage(error)}`);
            fatal.value = true;
        }
    }

    validatePseudoLocale(fatal);
    if (fatal.value) process.exitCode = 1;
}
