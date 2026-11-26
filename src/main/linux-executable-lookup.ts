import fs from "node:fs";
import path from "node:path";

/** Resolve an executable name using the main process PATH, or validate an explicit path. */
export function findLinuxExecutable(value: string): string | undefined {
    if (!value) return undefined;
    const candidates = path.isAbsolute(value)
        ? [value]
        : (process.env.PATH ?? "").split(path.delimiter).filter(Boolean).map((entry) => path.join(entry, value));

    for (const candidate of candidates) {
        try {
            fs.accessSync(candidate, fs.constants.X_OK);
            if (!fs.statSync(candidate).isFile()) continue;
            return fs.realpathSync(candidate);
        } catch {
            // Missing and non-executable PATH entries are ordinary lookup misses.
        }
    }
    return undefined;
}
