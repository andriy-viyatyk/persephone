import { fs } from "../../api/fs";
import { fpBasename, fpExtname, fpIsAbsolute, fpJoin } from "../../core/utils/file-path";

export interface TemporaryExtensionSourceFile {
    path: string;
    name: string;
    startLine: number;
}

export interface ResolvedTemporaryExtensionSources {
    source: string;
    files: TemporaryExtensionSourceFile[];
}

/** Resolve and read a temporary extension's current file set. */
export async function resolveTemporaryExtensionSources(scriptPath: string | string[]): Promise<ResolvedTemporaryExtensionSources> {
    const isFileList = Array.isArray(scriptPath);
    const paths = isFileList ? [...scriptPath] : [scriptPath];
    if (paths.length === 0) throw new Error("scriptPath file list must not be empty.");

    const selected: Array<{ path: string; name: string }> = [];
    if (!isFileList) {
        const path = paths[0];
        const stat = await fs.stat(path).catch(() => {
            throw new Error(`scriptPath does not exist or cannot be read: ${path}`);
        });
        if (!stat.exists) throw new Error(`scriptPath does not exist or cannot be read: ${path}`);
        if (stat.isDirectory) {
            let entries;
            try { entries = await fs.listDirWithTypes(path); }
            catch { throw new Error(`scriptPath directory could not be read: ${path}`); }
            const names = entries.filter((entry) => !entry.isDirectory && fpExtname(entry.name).toLowerCase() === ".js")
                .map((entry) => entry.name)
                .sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
            if (names.length === 0) throw new Error(`scriptPath folder contains no direct .js files: ${path}`);
            for (const name of names) selected.push({ path: fpJoin(path, name), name });
        } else selected.push({ path, name: fpBasename(path) });
    } else {
        for (const path of paths) selected.push({ path, name: fpBasename(path) });
    }

    const contents: string[] = [];
    for (const file of selected) {
        const stat = await fs.stat(file.path).catch(() => {
            throw new Error(`scriptPath is missing or cannot be read: ${file.path}`);
        });
        if (!stat.exists || stat.isDirectory) throw new Error(`scriptPath is missing or is not a readable file: ${file.path}`);
        try { contents.push(await fs.read(file.path)); }
        catch { throw new Error(`scriptPath is missing or unreadable: ${file.path}`); }
    }

    if (contents.length === 1) {
        return { source: contents[0], files: [{ ...selected[0], startLine: 1 }] };
    }

    let source = "";
    const files: TemporaryExtensionSourceFile[] = [];
    for (let index = 0; index < selected.length; index++) {
        const file = selected[index];
        if (index > 0 && !source.endsWith("\n")) source += "\n";
        source += `// --- ${file.name} ---\n`;
        const startLine = source.split("\n").length;
        files.push({ ...file, startLine });
        source += contents[index];
    }
    return { source, files };
}

/** Map an expression stack line (one-based) or CDP line (zero-based) to its source file. */
export function mapTemporaryExtensionErrorLocation(
    location: { stack?: string; lineNumber?: number; lineNumberIsZeroBased?: boolean },
    sourceStartLine: number,
    files: TemporaryExtensionSourceFile[],
): string | undefined {
    let expressionLine: number | undefined;
    if (location.stack) {
        const match = location.stack.match(/(?:<anonymous>|eval at [^\n]*?)\D+(\d+):\d+/u);
        if (match) expressionLine = Number(match[1]);
    }
    if (expressionLine === undefined && location.lineNumber !== undefined) {
        expressionLine = location.lineNumber + (location.lineNumberIsZeroBased ? 1 : 0);
    }
    if (expressionLine === undefined) return undefined;
    const sourceLine = expressionLine - sourceStartLine + 1;
    if (sourceLine < 1) return undefined;
    let file = files[0];
    for (const candidate of files) {
        if (candidate.startLine > sourceLine) break;
        file = candidate;
    }
    if (!file) return undefined;
    return `${file.path}:${sourceLine - file.startLine + 1}`;
}

export function validateTemporaryExtensionPath(scriptPath: string | string[]): void {
    const paths = Array.isArray(scriptPath) ? scriptPath : [scriptPath];
    if (paths.length === 0) throw new Error("scriptPath must be a non-empty absolute file path or a non-empty list of file paths.");
    for (const path of paths) {
        if (typeof path !== "string" || !path || path.length > 4096) {
            throw new Error("scriptPath must contain non-empty paths of at most 4096 characters.");
        }
        if (!fpIsAbsolute(path)) throw new Error("scriptPath entries must be absolute paths.");
    }
}
