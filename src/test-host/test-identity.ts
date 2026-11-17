import path from "node:path";

export interface TestIdentity { file: string; name: string; }

export function normalizeTestFile(file: string): string {
    const normalized = path.normalize(path.resolve(file));
    return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

export function testIdentityKey(identity: TestIdentity): string {
    return `${normalizeTestFile(identity.file)}\0${identity.name}`;
}
