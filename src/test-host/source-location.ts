import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeTestFile } from "./test-identity.js";

export function testFileLocation(error: unknown, testFile: string): string | undefined {
    if (!error || typeof error !== "object" || !("stack" in error) || typeof error.stack !== "string") return undefined;
    const expected = normalizeTestFile(testFile);
    for (const line of error.stack.split(/\r?\n/)) {
        const frame = /^\s*at\s+(?:.*?\s+\()?(.+?)(?:\))?\s*$/.exec(line)?.[1];
        if (!frame) continue;
        const position = /^(.*):(\d+):(\d+)$/.exec(frame);
        if (!position) continue;
        let candidate = position[1];
        try {
            if (candidate.startsWith("file:")) candidate = fileURLToPath(candidate);
            else candidate = path.resolve(candidate);
        } catch { continue; }
        if (normalizeTestFile(candidate) === expected) return `${candidate}:${position[2]}`;
    }
    return undefined;
}

/** Relative to the caller's cwd when the file is inside it; otherwise the absolute path. */
export function displayPath(cwd: string, file: string): string {
    const relative = path.relative(cwd, file);
    return relative && !relative.startsWith("..") && !path.isAbsolute(relative) ? relative : file;
}
