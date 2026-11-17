import fs from "node:fs/promises";
import path from "node:path";
import { errMessage } from "../shared/utils.js";
import { testIdentityKey, type TestIdentity } from "./test-identity.js";

export async function readTestSelection(file: string): Promise<Set<string>> {
    let value: unknown;
    try { value = JSON.parse(await fs.readFile(file, "utf8")); }
    catch (error) { throw new Error(`Cannot read test selection ${file}: ${errMessage(error)}`, { cause: error }); }
    if (!value || typeof value !== "object" || !("version" in value) || value.version !== 1 || !("tests" in value) || !Array.isArray(value.tests)) {
        throw new Error(`Invalid test selection ${file}: expected version 1 and a tests array.`);
    }
    if (Object.keys(value).some((key) => key !== "version" && key !== "tests")) throw new Error(`Invalid test selection ${file}: only version and tests fields are supported.`);
    const identities: TestIdentity[] = [];
    for (const item of value.tests) {
        if (!item || typeof item !== "object" || !("file" in item) || typeof item.file !== "string" || !item.file.trim()
            || !("name" in item) || typeof item.name !== "string" || !item.name.trim()
            || Object.keys(item).some((key) => key !== "file" && key !== "name")) {
            throw new Error(`Invalid test selection ${file}: each tests entry must contain only non-empty file and name strings.`);
        }
        identities.push({ file: path.resolve(item.file), name: item.name });
    }
    const keys = identities.map(testIdentityKey);
    if (new Set(keys).size !== keys.length) throw new Error(`Invalid test selection ${file}: duplicate test identities.`);
    return new Set(keys);
}

export function selectedByManifest(file: string, name: string, selected: Set<string> | undefined): boolean {
    return selected === undefined || selected.has(testIdentityKey({ file, name }));
}
