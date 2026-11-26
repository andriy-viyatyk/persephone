import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import { isKeyInside } from "../shared/path-containment";
import { comparePathKey } from "./utils";

interface SensitiveFolders {
    blockAll: string[];
    blockSelf: string[];
}

let rootLibraryEntries: string[] | undefined;

function absoluteEnvironmentPath(value: string | undefined): string | undefined {
    return value && path.isAbsolute(value) ? value : undefined;
}

function rootLibraries(): string[] {
    if (!rootLibraryEntries) {
        const names = new Set(["lib", "lib32", "lib64", "libx32"]);
        try {
            for (const name of fs.readdirSync("/")) {
                if (name.startsWith("lib")) names.add(name);
            }
        } catch { /* Keep the fixed system library paths when root cannot be read. */ }
        rootLibraryEntries = [...names].map((name) => path.join("/", name));
    }
    return rootLibraryEntries;
}

function definedPaths(values: Array<string | undefined>): string[] {
    return values.filter((value): value is string => !!value && path.isAbsolute(value));
}

function sensitiveFolders(): SensitiveFolders {
    const home = app.getPath("home");
    const configHome = absoluteEnvironmentPath(process.env.XDG_CONFIG_HOME) ?? path.join(home, ".config");
    const dataHome = absoluteEnvironmentPath(process.env.XDG_DATA_HOME) ?? path.join(home, ".local", "share");
    const rootEntries = [
        "/etc", "/usr", "/bin", "/sbin", "/boot", "/dev", "/proc", "/sys", "/var", "/root", "/run", "/snap",
        ...rootLibraries(),
    ];

    return {
        blockAll: definedPaths([
            app.getPath("appData"),
            configHome,
            path.join(dataHome, "keyrings"),
            path.join(home, ".local", "share", "keyrings"),
            app.getPath("userData"),
            path.dirname(app.getPath("exe")),
            ...rootEntries,
            path.join(home, ".ssh"),
            path.join(home, ".gnupg"),
            path.join(home, ".mozilla"),
            path.join(home, ".pki"),
        ]),
        blockSelf: definedPaths(["/", home]),
    };
}

function protectedPathKeys(folders: SensitiveFolders): SensitiveFolders {
    const withResolvedIdentities = (values: string[]): string[] => {
        const keys = new Set<string>();
        for (const folder of values) {
            keys.add(comparePathKey(folder));
            try {
                keys.add(comparePathKey(fs.realpathSync.native(folder)));
            } catch { /* Keep the lexical identity when it does not resolve. */ }
        }
        return [...keys];
    };

    return {
        blockAll: withResolvedIdentities(folders.blockAll),
        blockSelf: withResolvedIdentities(folders.blockSelf),
    };
}

function candidatePaths(filePath: string): string[] {
    const candidates = [comparePathKey(filePath)];
    try {
        candidates.push(comparePathKey(fs.realpathSync.native(filePath)));
    } catch {
        try {
            const parent = fs.realpathSync.native(path.dirname(filePath));
            candidates.push(comparePathKey(path.join(parent, path.basename(filePath))));
        } catch { /* Neither target nor immediate parent resolves; retain the supplied path. */ }
    }
    return candidates;
}

function isSensitive(candidateKey: string, folders: SensitiveFolders): boolean {
    // resolvedPathCompareKey removes the slash from `/`, so its empty key must be handled first.
    if (candidateKey === "") return true;
    for (const folderKey of folders.blockAll) {
        if (folderKey !== "" && (isKeyInside(folderKey, candidateKey) || isKeyInside(candidateKey, folderKey))) return true;
    }
    return folders.blockSelf.some((folderKey) =>
        folderKey !== "" && (candidateKey === folderKey || isKeyInside(candidateKey, folderKey)));
}

/** Classify an absolute Linux target without changing the path shown in the browser prompt. */
export function fileSystemAccessToPromptLinux(filePath: string): boolean {
    if (!path.isAbsolute(filePath)) return false;
    const folders = protectedPathKeys(sensitiveFolders());
    return !candidatePaths(filePath).some((candidateKey) => isSensitive(candidateKey, folders));
}
