import { fs } from "./fs";
import { fpBasename, fpExtname, fpJoin, fpNormalizeForCompare, fpRelative, fpResolve } from "../core/utils/file-path";
import type { TsProject } from "./ts-project-registry";

// ── Tuning constants (US-1744) ───────────────────────────────────────────────
/** Most `.ts`/`.tsx` files registered for one project. */
export const TS_PROJECT_MAX_SOURCE_FILES = 2000;
/** Largest source file loaded, in bytes. */
export const TS_PROJECT_MAX_SOURCE_BYTES = 1024 * 1024;
/** Largest JSON file loaded, in bytes. */
export const TS_PROJECT_MAX_JSON_BYTES = 512 * 1024;
/** Total bytes of text loaded for one project. */
export const TS_PROJECT_MAX_TOTAL_BYTES = 16 * 1024 * 1024;

export interface ProjectFileSet {
    /** Absolute paths, `.ts`/`.tsx` (incl. `.d.ts`), matched by include/exclude, plus tsconfig `files`. */
    sources: string[];
    /** Absolute paths, `*.json` under the root outside the excludes (only if `resolveJsonModule`). */
    jsons: string[];
    /** A cap was hit; some files were skipped. */
    truncated: boolean;
}

/** Compile one tsconfig glob (`*`, `?`, `**`) to a regex over a root-relative, `/`-separated path. */
export function compileTsGlob(pattern: string): RegExp {
    let glob = pattern.trim().replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
    const lastSegment = glob.slice(glob.lastIndexOf("/") + 1);
    if (!/[*?]/.test(lastSegment) && !lastSegment.includes(".")) glob += "/**/*";
    let source = "";
    for (let index = 0; index < glob.length; index++) {
        const char = glob[index];
        if (char === "*") {
            if (glob[index + 1] === "*") {
                if (glob[index + 2] === "/") { source += "(?:.*/)?"; index += 2; }
                else { source += ".*"; index += 1; }
            } else {
                source += "[^/]*";
            }
        } else if (char === "?") {
            source += "[^/]";
        } else {
            source += char.replace(/[.+^${}()|[\]\\/]/g, "\\$&");
        }
    }
    return new RegExp(`^${source}$`, process.platform === "win32" ? "i" : "");
}

function relativePosix(project: TsProject, absolutePath: string): string {
    return fpRelative(project.root, absolutePath).replace(/\\/g, "/");
}

function isExcluded(project: TsProject, relativePath: string): boolean {
    return project.exclude.some((pattern) => pattern.test(relativePath));
}

function isIncluded(project: TsProject, relativePath: string): boolean {
    return project.include.some((pattern) => pattern.test(relativePath));
}

function isSourceExtension(extension: string): boolean {
    return extension === ".ts" || extension === ".tsx";
}

function isConfigJson(name: string): boolean {
    const lower = name.toLowerCase();
    return lower === "package-lock.json" || /^tsconfig(\..*)?\.json$/.test(lower);
}

/** Whether a single absolute path belongs in the project's file set, and as what. */
export function classifyProjectFile(project: TsProject, filePath: string): "source" | "json" | undefined {
    const relative = relativePosix(project, filePath);
    if (!relative || relative.startsWith("..") || isExcluded(project, relative)) return undefined;
    const extension = fpExtname(filePath).toLowerCase();
    if (isSourceExtension(extension)) {
        const key = fpNormalizeForCompare(filePath);
        const listed = project.files.some((file) => fpNormalizeForCompare(file) === key);
        return listed || isIncluded(project, relative) ? "source" : undefined;
    }
    if (extension === ".json" && project.resolveJsonModule && !isConfigJson(fpBasename(filePath))) return "json";
    return undefined;
}

export async function enumerateProjectFiles(project: TsProject): Promise<ProjectFileSet> {
    const sources: string[] = [];
    const jsons: string[] = [];
    const seen = new Set<string>();
    let truncated = false;
    let totalBytes = 0;

    const tryAdd = async (filePath: string, isJson: boolean): Promise<void> => {
        if (truncated) return;
        const key = fpNormalizeForCompare(filePath);
        if (seen.has(key)) return;
        if ((isJson ? jsons : sources).length >= TS_PROJECT_MAX_SOURCE_FILES) { truncated = true; return; }
        const stat = await fs.stat(filePath);
        if (!stat.exists || stat.isDirectory) return;
        if (stat.size > (isJson ? TS_PROJECT_MAX_JSON_BYTES : TS_PROJECT_MAX_SOURCE_BYTES)) { truncated = true; return; }
        if (totalBytes + stat.size > TS_PROJECT_MAX_TOTAL_BYTES) { truncated = true; return; }
        totalBytes += stat.size;
        seen.add(key);
        (isJson ? jsons : sources).push(filePath);
    };

    const walk = async (directory: string): Promise<void> => {
        if (truncated) return;
        const entries = await fs.listDirWithTypes(directory);
        for (const entry of entries) {
            if (truncated) return;
            const entryPath = fpJoin(directory, entry.name);
            const relative = relativePosix(project, entryPath);
            if (entry.isDirectory) {
                if (!isExcluded(project, `${relative}/`)) await walk(entryPath);
                continue;
            }
            const kind = classifyProjectFile(project, entryPath);
            if (kind) await tryAdd(entryPath, kind === "json");
        }
    };

    await walk(project.root);
    for (const filePath of project.files) {
        if (classifyProjectFile(project, filePath) === "source") await tryAdd(filePath, false);
    }

    project.knownPaths.clear();
    for (const filePath of [...sources, ...jsons]) project.knownPaths.set(fpNormalizeForCompare(filePath), filePath);
    return { sources, jsons, truncated };
}

/**
 * The spelling used for a page's model URI. On Windows a page path may differ in case from the on-disk
 * path the enumeration saw, which would yield a different URI string and break relative resolution.
 */
export function canonicalizeProjectPath(project: TsProject, filePath: string): string {
    const known = project.knownPaths.get(fpNormalizeForCompare(filePath));
    if (known) return known;
    const resolved = fpResolve(filePath).replace(/\\/g, "/");
    const rest = resolved.slice(project.key.length).replace(/^\/+/, "");
    return rest ? fpJoin(project.root, rest) : project.root;
}
