import { fs } from "./fs";
import { parseJSON5 } from "../core/utils/parse-utils";
import { errMessage } from "../../shared/utils";
import { fpJoin, fpNormalizeForCompare, fpRelative, fpResolve, isArchivePath, isAsarPath, isPlainLocalPath } from "../core/utils/file-path";
import { compileTsGlob } from "./ts-project-files";

export interface TsProject {
    /** Absolute root in the BOARD's spelling (not the realpath). */
    root: string;
    /** `fpNormalizeForCompare(root)`. */
    key: string;
    tsconfigPath: string;
    resolveJsonModule: boolean;
    /** tsconfig `files` (absolute), may be empty. */
    files: readonly string[];
    include: readonly RegExp[];
    exclude: readonly RegExp[];
    /** Board frame ids (`BoardPortEntry.boardId`). */
    owners: Set<string>;
    /** Bumped when the tsconfig content changed on re-register or reload. */
    revision: number;
    /** Normalized path -> on-disk spelling of every file the last enumeration saw. */
    knownPaths: Map<string, string>;
}

export type TsProjectChange = { type: "added" | "changed" | "removed"; project: TsProject };

interface ParsedConfig {
    signature: string;
    resolveJsonModule: boolean;
    files: string[];
    include: RegExp[];
    exclude: RegExp[];
}

const DEFAULT_EXCLUDES = ["**/node_modules", "**/bower_components", "**/jspm_packages", "**/.git"];

function stringArray(value: unknown): string[] {
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

async function readConfig(root: string, tsconfigPath: string): Promise<ParsedConfig> {
    let text: string;
    try {
        text = await fs.read(tsconfigPath);
    } catch (error: unknown) {
        throw new Error(`Could not read tsconfig.json in the project folder: ${errMessage(error)}`);
    }
    let parseError: unknown;
    const parsed = parseJSON5(text, (error) => { parseError = error; });
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error(`tsconfig.json is not valid JSON${parseError ? `: ${errMessage(parseError)}` : "."}`);
    }
    const config = parsed as { files?: unknown; include?: unknown; exclude?: unknown; compilerOptions?: unknown };
    const options = (config.compilerOptions && typeof config.compilerOptions === "object"
        ? config.compilerOptions : {}) as { resolveJsonModule?: unknown; outDir?: unknown };
    const files = stringArray(config.files).map((file) => fpResolve(root, file));
    const hasFiles = Array.isArray(config.files);
    const includeGlobs = Array.isArray(config.include) ? stringArray(config.include) : (hasFiles ? [] : ["**/*"]);
    const excludeGlobs = [...DEFAULT_EXCLUDES, ...stringArray(config.exclude)];
    if (typeof options.outDir === "string" && options.outDir.trim()) {
        const outDir = fpRelative(root, fpResolve(root, options.outDir)).replace(/\\/g, "/");
        if (outDir && !outDir.startsWith("..") && !/^[a-z]:/i.test(outDir)) excludeGlobs.push(outDir);
    }
    return {
        signature: JSON.stringify([options.resolveJsonModule === true, files, includeGlobs, excludeGlobs]),
        resolveJsonModule: options.resolveJsonModule === true,
        files,
        include: includeGlobs.map(compileTsGlob),
        exclude: excludeGlobs.map(compileTsGlob),
    };
}

class TsProjectRegistry {
    private readonly projects = new Map<string, TsProject>();
    private readonly signatures = new Map<string, string>();
    private readonly listeners = new Set<(change: TsProjectChange) => void>();

    /** Register `root` for `owner`; reads only `tsconfig.json`. Idempotent per key. */
    async register(root: string, owner: string): Promise<void> {
        const resolvedRoot = fpResolve(root);
        const key = fpNormalizeForCompare(resolvedRoot);
        const tsconfigPath = fpJoin(resolvedRoot, "tsconfig.json");
        const config = await readConfig(resolvedRoot, tsconfigPath);
        const existing = this.projects.get(key);
        if (existing) {
            existing.owners.add(owner);
            if (this.signatures.get(key) !== config.signature) this.applyConfig(existing, config);
            return;
        }
        const project: TsProject = {
            root: resolvedRoot,
            key,
            tsconfigPath,
            resolveJsonModule: config.resolveJsonModule,
            files: config.files,
            include: config.include,
            exclude: config.exclude,
            owners: new Set([owner]),
            revision: 0,
            knownPaths: new Map(),
        };
        this.projects.set(key, project);
        this.signatures.set(key, config.signature);
        this.emit({ type: "added", project });
    }

    /** Re-read `tsconfig.json` of a registered project (the loader calls this when the file changes). */
    async reload(project: TsProject): Promise<void> {
        if (this.projects.get(project.key) !== project) return;
        try {
            const config = await readConfig(project.root, project.tsconfigPath);
            if (this.signatures.get(project.key) !== config.signature) this.applyConfig(project, config);
        } catch (error: unknown) {
            console.warn(`TypeScript project reload failed: ${errMessage(error)}`);
        }
    }

    unregister(root: string, owner: string): void {
        const project = this.projects.get(fpNormalizeForCompare(fpResolve(root)));
        if (project) this.dropOwner(project, owner);
    }

    releaseOwner(owner: string): void {
        for (const project of [...this.projects.values()]) this.dropOwner(project, owner);
    }

    /** The longest registered root that contains `filePath`. */
    findForFile(filePath: string | undefined): TsProject | undefined {
        if (!filePath || !isPlainLocalPath(filePath) || isArchivePath(filePath) || isAsarPath(filePath)) return undefined;
        if (!this.projects.size) return undefined;
        const key = fpNormalizeForCompare(filePath);
        let best: TsProject | undefined;
        for (const project of this.projects.values()) {
            if (!key.startsWith(`${project.key}/`)) continue;
            if (!best || project.key.length > best.key.length) best = project;
        }
        return best;
    }

    list(): readonly TsProject[] {
        return [...this.projects.values()];
    }

    subscribe(listener: (change: TsProjectChange) => void): () => void {
        this.listeners.add(listener);
        return () => { this.listeners.delete(listener); };
    }

    private applyConfig(project: TsProject, config: ParsedConfig): void {
        project.resolveJsonModule = config.resolveJsonModule;
        project.files = config.files;
        project.include = config.include;
        project.exclude = config.exclude;
        project.revision += 1;
        this.signatures.set(project.key, config.signature);
        this.emit({ type: "changed", project });
    }

    private dropOwner(project: TsProject, owner: string): void {
        if (!project.owners.delete(owner) || project.owners.size) return;
        this.projects.delete(project.key);
        this.signatures.delete(project.key);
        this.emit({ type: "removed", project });
    }

    private emit(change: TsProjectChange): void {
        for (const listener of [...this.listeners]) {
            try {
                listener(change);
            } catch (error: unknown) {
                console.warn(`TypeScript project listener failed: ${errMessage(error)}`);
            }
        }
    }
}

export const tsProjectRegistry = new TsProjectRegistry();
